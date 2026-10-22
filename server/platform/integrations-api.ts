import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import type { LookupFunction } from "node:net";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { opsStore, readDb, updateDb } from "../../lib/store";
import type { ApiKey, WebhookEndpoint } from "../../lib/platform/types";
import { isPrivateAddress, maskSecrets, webhookUrlError } from "../../lib/platform/security";
import { recordSecurityEvent } from "./security-events";

/*
 * Kompaniyalar uchun integratsiya:
 *   API kalitlar — faqat yaratilganda bir marta ko‘rsatiladi; bazada HMAC-SHA256 xesh (xom kalit yo‘q).
 *     Format: stf_<prefix>_<secret>. Har bir kalit — bitta kompaniya va aniq ruxsatlar (scopes).
 *   Webhooklar — HMAC imzo (X-Staffora-Signature), Delivery ID (idempotentlik), qayta urinish (eksponensial),
 *     SSRF himoyasi: faqat https, DNS natijasi xususiy/lokal manzil bo‘lsa — ulanmaydi (ulanish paytida ham tekshiriladi),
 *     TLS sertifikati tekshiriladi (o‘chirib bo‘lmaydi).
 */

const serverSecret = () => process.env.SESSION_SECRET || "staffora-local-session-secret-change-me";
const allowPrivate = () => process.env.NODE_ENV !== "production" && process.env.WEBHOOK_ALLOW_PRIVATE === "true";

/* ------------------------------------------------------------- API kalitlar --- */
export const API_SCOPES = {
  "employees.read": "Xodimlar ro‘yxati",
  "branches.read": "Filiallar",
  "attendance.read": "Davomat (keldi-ketdi)",
} as const;
export type ApiScope = keyof typeof API_SCOPES;

export const hashApiKey = (key: string) => createHmac("sha256", `${serverSecret()}:api-keys`).update(key).digest("hex");

export function generateApiKey() {
  const prefix = randomBytes(6).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const key = `stf_${prefix}_${secret}`;
  return { key, prefix: `stf_${prefix}`, hash: hashApiKey(key) };
}

export function findApiKey(keys: ApiKey[], raw: string) {
  const match = /^(stf_[0-9a-f]{12})_[A-Za-z0-9_-]{20,}$/.exec(raw);
  if (!match) return undefined;
  const candidate = keys.find((k) => k.prefix === match[1]);
  if (!candidate) return undefined;
  const a = Buffer.from(candidate.hash, "hex");
  const b = Buffer.from(hashApiKey(raw), "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? candidate : undefined;
}

type KeyRequest = Request & { apiKey?: ApiKey };
const lastUsedWrites = new Map<string, number>();

/** /api/v1 — API kalit bilan himoyalangan ochiq API (requireAuth dan oldin ulanadi). */
export function createPublicApiRouter() {
  const router = Router();
  router.use(
    "/v1",
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => String(req.headers.authorization || req.ip).slice(0, 40),
      message: { message: "Juda ko‘p so‘rov (daqiqasiga 120 ta)." },
    }),
  );
  router.use("/v1", async (req: KeyRequest, res: Response, next: NextFunction) => {
    try {
      const raw = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : String(req.headers["x-api-key"] || "");
      if (!raw) return res.status(401).json({ code: "API_KEY_REQUIRED", message: "API kalit kerak (Authorization: Bearer stf_…)." });
      const db = await readDb();
      const key = findApiKey(db.apiKeys, raw);
      const now = new Date().toISOString();
      if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < now)) {
        void recordSecurityEvent({ type: "API_KEY_REJECTED", severity: "MEDIUM", req, subject: raw.slice(0, 16), detail: key ? (key.revokedAt ? "bekor qilingan" : "muddati o‘tgan") : "topilmadi" });
        return res.status(401).json({ code: "API_KEY_INVALID", message: "API kalit yaroqsiz, bekor qilingan yoki muddati o‘tgan." });
      }
      const company = db.companies.find((c) => c.id === key.companyId);
      if (!company || company.archive || company.status === "SUSPENDED") return res.status(403).json({ code: "COMPANY_INACTIVE", message: "Kompaniya faol emas." });
      req.apiKey = key;
      const last = lastUsedWrites.get(key.id) || 0;
      if (Date.now() - last > 5 * 60_000) {
        lastUsedWrites.set(key.id, Date.now());
        void updateDb((next) => {
          const row = next.apiKeys.find((k) => k.id === key.id);
          if (row) row.lastUsedAt = now;
        }).catch(() => undefined);
      }
      next();
    } catch (error) {
      next(error);
    }
  });
  const scope = (needed: ApiScope) => (req: KeyRequest, res: Response, next: NextFunction) =>
    req.apiKey?.scopes.includes(needed) ? next() : res.status(403).json({ code: "SCOPE_MISSING", message: `Kalitda «${needed}» ruxsati yo‘q.` });
  const page = (req: Request) => ({ limit: Math.max(1, Math.min(500, Number(req.query.limit) || 100)), offset: Math.max(0, Number(req.query.offset) || 0) });

  router.get("/v1/employees", scope("employees.read"), async (req: KeyRequest, res) => {
    const db = await readDb();
    const { limit, offset } = page(req);
    const rows = db.employees.filter((e) => e.companyId === req.apiKey!.companyId);
    res.json({
      total: rows.length,
      data: rows.slice(offset, offset + limit).map((e) => ({
        id: e.id,
        employeeNo: e.employeeNo,
        firstName: e.firstName,
        lastName: e.lastName,
        status: e.status,
        branchId: e.branchId,
        departmentId: e.departmentId,
        positionId: e.positionId,
        startDate: e.startDate,
      })),
    });
  });
  router.get("/v1/branches", scope("branches.read"), async (req: KeyRequest, res) => {
    const db = await readDb();
    res.json({
      data: db.branches.filter((b) => b.companyId === req.apiKey!.companyId).map((b) => ({ id: b.id, name: b.name, address: b.address, status: b.status, latitude: b.latitude, longitude: b.longitude, radiusMeters: b.radiusMeters })),
    });
  });
  router.get("/v1/attendance", scope("attendance.read"), async (req: KeyRequest, res) => {
    const from = String(req.query.from || "");
    const to = String(req.query.to || from);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.status(400).json({ message: "from va to — YYYY-MM-DD formatida bo‘lsin." });
    if (Date.parse(to) - Date.parse(from) > 62 * 86_400_000) return res.status(400).json({ message: "Oraliq 62 kundan oshmasin." });
    const db = await readDb();
    const { limit, offset } = page(req);
    const rows = db.attendance.filter((a) => a.companyId === req.apiKey!.companyId && a.date >= from && a.date <= to).sort((a, b) => a.date.localeCompare(b.date));
    res.json({
      total: rows.length,
      data: rows.slice(offset, offset + limit).map((a) => ({
        id: a.id,
        employeeId: a.employeeId,
        branchId: a.branchId,
        date: a.date,
        checkIn: a.checkIn || null,
        checkOut: a.checkOut || null,
        status: a.status,
        lateMinutes: a.lateMinutes,
        workedMinutes: a.workedMinutes,
      })),
    });
  });
  router.use("/v1", (_req, res) => res.status(404).json({ message: "API manzili topilmadi." }));
  return router;
}

/* --------------------------------------------------------------- webhooklar --- */
export const WEBHOOK_EVENTS = {
  "attendance.check_in": "Xodim ishga keldi",
  "attendance.check_out": "Xodim ishdan ketdi",
  "employee.created": "Yangi xodim qo‘shildi",
  "employee.updated": "Xodim ma’lumoti o‘zgardi",
  "leave.decided": "Ta’til so‘rovi bo‘yicha qaror",
  ping: "Sinov (ping)",
} as const;
export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

const encKey = () => createHash("sha256").update(`${serverSecret()}:webhooks`).digest();
export function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}
export function decryptSecret(value: string) {
  const [v, iv, tag, data] = value.split(".");
  if (v !== "v1") throw new Error("Noma’lum shifr.");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
export function newWebhookSecret() {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  return { secret, secretEnc: encryptSecret(secret), secretHint: secret.slice(-4) };
}
/** Imzo: HMAC-SHA256(secret, `${timestamp}.${body}`) — qabul qiluvchi shu tarzda tekshiradi. */
export const signPayload = (secret: string, timestamp: number, body: string) => createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

/** Hodisani obuna bo‘lgan webhooklarga navbatga qo‘yadi («yubor va unut» — asosiy amalni buzmaydi). */
export function emitWebhook(companyId: string, event: WebhookEvent, data: Record<string, unknown>) {
  void (async () => {
    const db = await readDb();
    const endpoints = db.webhookEndpoints.filter((w) => w.companyId === companyId && w.enabled && (w.events.includes(event) || event === "ping"));
    if (!endpoints.length) return;
    const store = await opsStore();
    const now = new Date().toISOString();
    for (const endpoint of endpoints) {
      const id = randomUUID();
      const payload = JSON.stringify({ id, event, createdAt: now, companyId, data });
      await store.run(
        "INSERT INTO webhook_deliveries (id, endpoint_id, company_id, event, payload, status, attempts, next_attempt_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [id, endpoint.id, companyId, event, payload, "PENDING", 0, now, now, now],
      );
    }
    void dispatchWebhooks();
  })().catch((error) => console.error("Webhook navbatiga qo‘yishda xato", error));
}

/** DNS natijasi xususiy manzil bo‘lsa ulanishni to‘xtatadi (DNS rebinding’dan ham himoya). */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true })
    .then((addresses) => {
      const bad = addresses.find((a) => isPrivateAddress(a.address));
      if (bad && !allowPrivate()) return callback(Object.assign(new Error(`Xususiy manzil taqiqlangan: ${bad.address}`), { code: "EPRIVATE" }), "", 4);
      const first = addresses[0];
      if (!first) return callback(Object.assign(new Error("Manzil topilmadi"), { code: "ENOTFOUND" }), "", 4);
      if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof addresses) => void)(null, addresses);
      callback(null, first.address, first.family);
    })
    .catch((error) => callback(error, "", 4));
};

export async function deliverWebhook(url: string, secret: string, deliveryId: string, event: string, body: string): Promise<{ status: number; ms: number }> {
  const target = new URL(url);
  const urlError = webhookUrlError(url, allowPrivate());
  if (urlError) throw new Error(urlError);
  const timestamp = Math.floor(Date.now() / 1000);
  const started = Date.now();
  const send = target.protocol === "http:" ? httpRequest : httpsRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      target,
      {
        method: "POST",
        lookup: safeLookup,
        timeout: 10_000,
        headers: {
          "content-type": "application/json",
          "user-agent": "Staffora-Webhooks/1.0",
          "x-staffora-event": event,
          "x-staffora-delivery": deliveryId,
          "x-staffora-signature": `t=${timestamp},v1=${signPayload(secret, timestamp, body)}`,
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve({ status: response.statusCode || 0, ms: Date.now() - started }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("Javob 10 soniyada kelmadi.")));
    req.on("error", reject);
    req.end(body);
  });
}

type RawWebhookDelivery = { id: string; endpoint_id: string; company_id: string; event: string; payload: string; status: string; attempts: number; next_attempt_at: string; response_status: number | null; error: string | null; duration_ms: number | null; created_at: string; updated_at: string };
const RETRY_MINUTES = [1, 5, 30, 120, 360, 720];
let dispatching = false;

/** Navbatdagi webhooklarni yetkazadi (har siklda 20 tagacha). */
export async function dispatchWebhooks() {
  if (dispatching) return 0;
  dispatching = true;
  let done = 0;
  try {
    const store = await opsStore();
    const due = await store.all<RawWebhookDelivery>("SELECT * FROM webhook_deliveries WHERE status = 'PENDING' AND next_attempt_at <= ? ORDER BY created_at LIMIT 20", [new Date().toISOString()]);
    if (!due.length) return 0;
    const db = await readDb();
    for (const row of due) {
      const endpoint = db.webhookEndpoints.find((w) => w.id === row.endpoint_id);
      const now = () => new Date().toISOString();
      if (!endpoint || !endpoint.enabled) {
        await store.run("UPDATE webhook_deliveries SET status = 'CANCELLED', error = ?, updated_at = ? WHERE id = ?", ["Endpoint o‘chirilgan", now(), row.id]);
        continue;
      }
      const attempts = Number(row.attempts) + 1;
      let ok = false;
      let status: number | null = null;
      let error: string | null = null;
      let ms: number | null = null;
      try {
        const result = await deliverWebhook(endpoint.url, decryptSecret(endpoint.secretEnc), row.id, row.event, row.payload);
        status = result.status;
        ms = result.ms;
        ok = status >= 200 && status < 300;
        if (!ok) error = `HTTP ${status}`;
      } catch (reason) {
        error = maskSecrets(reason instanceof Error ? reason.message : String(reason), 300);
      }
      const final = ok || attempts > RETRY_MINUTES.length;
      await store.run(
        "UPDATE webhook_deliveries SET status = ?, attempts = ?, response_status = ?, error = ?, duration_ms = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?",
        [ok ? "DELIVERED" : final ? "FAILED" : "PENDING", attempts, status, error, ms, final ? now() : new Date(Date.now() + RETRY_MINUTES[attempts - 1] * 60_000).toISOString(), now(), row.id],
      );
      await updateDb((next) => {
        const w = next.webhookEndpoints.find((x) => x.id === endpoint.id);
        if (!w) return;
        w.lastDeliveryAt = now();
        w.lastStatus = status ?? 0;
        w.failures = ok ? 0 : (w.failures || 0) + 1;
        // Juda ko‘p ketma-ket xato — avtomatik to‘xtatiladi (keraksiz yuk bo‘lmasligi uchun), qayta yoqish mumkin.
        if (w.failures >= 50) {
          w.enabled = false;
          w.disabledReason = "50 marta ketma-ket muvaffaqiyatsiz yetkazish";
        }
      });
      done += 1;
    }
  } catch (error) {
    console.error("Webhook yetkazishda xato", error);
  } finally {
    dispatching = false;
  }
  return done;
}

export async function listWebhookDeliveries(filters: { endpointId?: string; companyId?: string; status?: string }, limit = 50, offset = 0) {
  const store = await opsStore();
  const parts: string[] = [];
  const params: unknown[] = [];
  if (filters.endpointId) {
    parts.push("endpoint_id = ?");
    params.push(filters.endpointId);
  }
  if (filters.companyId) {
    parts.push("company_id = ?");
    params.push(filters.companyId);
  }
  if (filters.status) {
    parts.push("status = ?");
    params.push(filters.status);
  }
  const where = parts.length ? `WHERE ${parts.join(" AND ")}` : "";
  const rows = await store.all<RawWebhookDelivery>(`SELECT * FROM webhook_deliveries ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const total = Number((await store.all<{ n: number | string }>(`SELECT COUNT(*) AS n FROM webhook_deliveries ${where}`, params))[0]?.n || 0);
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      endpointId: r.endpoint_id,
      companyId: r.company_id,
      event: r.event,
      status: r.status,
      attempts: Number(r.attempts),
      responseStatus: r.response_status === null ? null : Number(r.response_status),
      error: r.error,
      durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      nextAttemptAt: r.next_attempt_at,
    })),
  };
}

export async function retryWebhookDelivery(id: string) {
  const store = await opsStore();
  const now = new Date().toISOString();
  const count = await store.run("UPDATE webhook_deliveries SET status = 'PENDING', next_attempt_at = ?, updated_at = ? WHERE id = ? AND status IN ('FAILED','CANCELLED')", [now, now, id]);
  if (count) void dispatchWebhooks();
  return count;
}

export async function purgeWebhookDeliveries(beforeIso: string) {
  const store = await opsStore();
  return store.run("DELETE FROM webhook_deliveries WHERE created_at < ? AND status <> 'PENDING'", [beforeIso]);
}

/** Webhook yozuvi frontendga (maxfiy kalitsiz). */
export const publicWebhook = (w: WebhookEndpoint) => {
  const { secretEnc: _secret, ...rest } = w;
  return rest;
};
export const publicApiKey = (k: ApiKey) => {
  const { hash: _hash, ...rest } = k;
  return rest;
};
