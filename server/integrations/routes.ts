import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, readDb, updateDb } from "../../lib/store";
import { can } from "../../lib/permissions";
import type { AnnouncementTarget, Integration, IntegrationSettings } from "../../lib/types";
import type { AuthedRequest } from "../auth";
import { BotApiError, BotClient, normalizeBaseUrl } from "./client";
import {
  PROVIDER,
  activeIntegration,
  clientFor,
  defaultIntegrationSettings,
  integrationById,
  newId,
  normalizeSettings,
  publicIntegration,
} from "./model";
import { decryptSecret, encryptSecret, keyHint } from "./secrets";
import {
  deliveriesByRef,
  latestAccessDeliveries,
  listEvents,
  listLogs,
  listOutbox,
  logIntegration,
  outboxStats,
  recordEvent,
  retryDeadEvent,
  retryOutbox,
} from "./sqlstore";
import {
  buildPreview,
  createSyncJob,
  fetchRemote,
  isSyncRunning,
  resolveConflict,
  runSyncJob,
  type BotEventEnvelope,
} from "./sync";
import { verifySignature } from "./webhook";
import { processRecordedEvent, runWorkerOnce } from "./worker";
import { accessCandidates, inviteLink, issueInvite, revokeInvites, runAccessSendJob } from "./access";
import { mappingByLocal } from "./model";
import { telegramBotUsername } from "../telegram";

/*
 * Integratsiya markazi API (Sozlamalar → Integratsiyalar → Xodimlar boshqaruv boti).
 * Barcha so‘rovlar kompaniya doirasida (companyId) — boshqa kompaniya
 * integratsiyasiga kirib bo‘lmaydi. API kalit hech qachon javobda qaytmaydi.
 */

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(handler(req as AuthedRequest, res)).catch((error) => next(toHttpError(error)));

const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });

function toHttpError(error: unknown) {
  if (error instanceof BotApiError) {
    const status = error.status === 401 || error.status === 403 ? 400 : error.status === 429 ? 429 : 502;
    return httpError(`Xodimlar boti: ${error.message}`, status);
  }
  return error;
}

const tenantOf = (req: AuthedRequest) => {
  if (!req.session?.companyId) throw httpError("Kompaniya tanlanmagan.", 403);
  return req.session.companyId;
};
const permit = (permission: string) => (req: Request, res: Response, next: NextFunction) =>
  can((req as AuthedRequest).session!.role, permission)
    ? next()
    : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });

/** Minimal ruxsatlar: shular bo‘lmasa import ishlamaydi. */
export const REQUIRED_SCOPES = ["integration:read", "employees:read", "branches:read", "departments:read", "positions:read", "attendance:read"];
/** Kerakli emas va xavfli ruxsatlar — kalitdan olib tashlash tavsiya etiladi. */
export const EXCESSIVE_SCOPES = ["employees:sensitive", "admin"];
const FEATURE_SCOPES: Record<string, string[]> = {
  "Staffora → bot (xodim/filial tahrirlari)": ["employees:write", "branches:write", "departments:write", "positions:write", "integration:write"],
  "Keldi-ketdini botga yuborish": ["attendance:write"],
  "Maoshlarni import qilish (ixtiyoriy)": ["employees:salary"],
  "Bot orqali xabar va havola yuborish": ["notifications:write", "notifications:read"],
  "Bot orqali e’lon": ["announcements:write", "announcements:read"],
  "Webhook (real vaqt)": ["webhooks:write"],
};

export function publicAppBaseUrl() {
  return (
    process.env.APP_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${process.env.PORT || 4000}`)
  ).replace(/\/+$/, "");
}
const isLocalUrl = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(url);

/** Ulanishni tekshiradi: health, integration/info, company. Hech narsa saqlanmaydi. */
export async function testConnection(baseUrl: string, apiKey: string, fetchImpl?: typeof fetch) {
  const normalized = normalizeBaseUrl(baseUrl);
  const url = new URL(normalized);
  if (url.protocol !== "https:" && !isLocalUrl(normalized) && process.env.NODE_ENV === "production")
    throw httpError("Bot API manzili HTTPS bo‘lishi kerak.", 400);
  const client = new BotClient({ baseUrl: normalized, apiKey, fetchImpl, maxRetries: 1, timeoutMs: 12_000 });
  const started = Date.now();
  const { data: info } = await client.get<{
    name: string;
    api_version: string;
    build: string;
    source: string;
    your_key: { name: string; scopes: string[] };
  }>("/integration/info");
  const latencyMs = Date.now() - started;
  const scopes = info?.your_key?.scopes || [];
  const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s) && !scopes.includes("admin"));
  let companyName: string | undefined;
  if (scopes.includes("company:read") || scopes.includes("admin")) {
    try {
      companyName = (await client.get<{ name?: string }>("/company")).data?.name;
    } catch {
      companyName = undefined;
    }
  }
  const features = Object.entries(FEATURE_SCOPES).map(([label, need]) => ({
    label,
    enabled: need.every((s) => scopes.includes(s) || scopes.includes("admin")),
    missing: need.filter((s) => !scopes.includes(s) && !scopes.includes("admin")),
  }));
  return {
    baseUrl: normalized,
    latencyMs,
    remote: {
      companyName,
      apiName: info?.name,
      apiVersion: info?.api_version,
      build: info?.build,
      source: info?.source,
      keyName: info?.your_key?.name,
      scopes,
    },
    missingScopes: missing,
    excessiveScopes: EXCESSIVE_SCOPES.filter((s) => scopes.includes(s)),
    features,
  };
}

/** Bot'da webhook obunasini yaratadi (secret faqat shu javobda keladi — shifrlab saqlanadi). */
async function registerWebhook(integration: Integration) {
  const base = publicAppBaseUrl();
  const url = `${base}/api/integrations/${integration.id}/webhook`;
  const allowed = base.startsWith("https://") || (isLocalUrl(base) && isLocalUrl(integration.baseUrl));
  if (!allowed)
    return { registered: false, reason: "Staffora'ning ochiq HTTPS manzili yo‘q (APP_URL) — o‘zgarishlar lentasi (polling) ishlatiladi." };
  const client = clientFor(integration);
  if (integration.remoteWebhookId) {
    try {
      await client.request("DELETE", `/webhooks/${integration.remoteWebhookId}`);
    } catch {
      /* eskisi allaqachon yo‘q bo‘lishi mumkin */
    }
  }
  const { data } = await client.request<{ id: number; secret?: string }>("POST", "/webhooks", {
    body: { url, events: ["*"], description: "Staffora integratsiyasi", include_salary: false, active: true },
    idempotencyKey: `webhook:${integration.id}:${Date.now()}`,
  });
  if (!data?.secret) return { registered: false, reason: "Bot webhook secret qaytarmadi." };
  await updateDb((db) => {
    const current = db.integrations.find((i) => i.id === integration.id);
    if (current) {
      current.remoteWebhookId = data.id;
      current.webhookSecretEnc = encryptSecret(data.secret!);
      current.webhookUrl = url;
      current.updatedAt = new Date().toISOString();
    }
  });
  return { registered: true, webhookId: data.id, url };
}

/** O‘zgarishlar lentasini oxiriga suradi — importdan keyingi hodisalargina qayta ishlanadi. */
async function latestCursor(client: BotClient, from = 0) {
  let cursor = from;
  for (let page = 0; page < 200; page += 1) {
    const { data, meta } = await client.get<unknown[]>("/integration/changes", { since_id: cursor, limit: 500 });
    cursor = Number(meta?.next_cursor ?? cursor);
    if (!meta?.has_more || !data?.length) break;
  }
  return cursor;
}

const settingsSchema = z
  .object({
    syncModes: z
      .object(
        Object.fromEntries(
          ["branch", "department", "position", "employee", "attendance"].map((k) => [k, z.enum(["IMPORT", "EXPORT", "TWO_WAY", "OFF"])]),
        ) as Record<string, z.ZodEnum<["IMPORT", "EXPORT", "TWO_WAY", "OFF"]>>,
      )
      .partial(),
    conflictStrategy: z.enum(["STAFFORA_WINS", "BOT_WINS", "LATEST", "MANUAL"]),
    applyRemoteDeletes: z.boolean(),
    createInBot: z.boolean(),
    pushAttendance: z.boolean(),
    pollIntervalSeconds: z.number().int().min(0).max(3600).refine((v) => v === 0 || v >= 15, "Kamida 15 soniya yoki 0 (qo‘lda)."),
    inviteTtlHours: z.number().int().min(1).max(720),
    miniAppLink: z
      .union([
        z.literal(""),
        z.string().trim().regex(/^(https:\/\/)?t\.me\/[A-Za-z0-9_]{5,32}\/[A-Za-z0-9_]{3,30}\/?$/i, "Havola https://t.me/<bot>/<nomi> ko‘rinishida bo‘lsin."),
      ])
      .optional(),
    routing: z
      .object(
        Object.fromEntries(
          ["attendance", "leave", "announcements", "system", "payroll", "hr"].map((k) => [k, z.array(z.enum(["staffora", "telegram", "bot"])).max(3)]),
        ) as Record<string, z.ZodArray<z.ZodEnum<["staffora", "telegram", "bot"]>>>,
      )
      .partial(),
  })
  .partial();

const credentialsSchema = z.object({
  baseUrl: z.string().trim().min(4, "API manzilini kiriting.").max(300),
  apiKey: z.string().trim().min(10, "API kalitni kiriting.").max(300),
});

const entitySchema = z.array(z.enum(["branch", "department", "position", "employee", "attendance"])).min(1);

async function detail(integration: Integration) {
  const db = await readDb();
  const mappings: Record<string, number> = {};
  for (const m of db.entityMappings) if (m.integrationId === integration.id) mappings[m.entity] = (mappings[m.entity] || 0) + 1;
  mappings.attendance = db.attendance.filter((a) => a.companyId === integration.companyId && a.externalIds?.[PROVIDER]).length;
  const jobs = db.syncJobs.filter((j) => j.integrationId === integration.id).slice(0, 10);
  const conflicts = db.integrationConflicts.filter((c) => c.integrationId === integration.id && c.status === "OPEN").length;
  const events = await listEvents(integration.id, { limit: 200 });
  const eventStats: Record<string, number> = {};
  for (const e of events) eventStats[e.status] = (eventStats[e.status] || 0) + 1;
  return {
    integration: publicIntegration(integration),
    stats: { mappings, outbox: await outboxStats(integration.id), events: eventStats, conflicts, running: isSyncRunning(integration.id) },
    jobs,
    staffora: { botUsername: telegramBotUsername(), publicUrl: publicAppBaseUrl() },
  };
}

/* ------------------------------------------------------------- router --- */

export function createIntegrationRouter() {
  const router = Router();
  const manage = permit("settings.manage");

  router.get(
    "/integrations",
    manage,
    route(async (req, res) => {
      const db = await readDb();
      const tenant = tenantOf(req);
      res.json({
        providers: [{ id: PROVIDER, name: "Xodimlar boshqaruv boti", description: "Gulnora Farm HR bot (REST API v1) bilan ikki tomonlama integratsiya" }],
        items: db.integrations.filter((i) => i.companyId === tenant).map(publicIntegration),
        counting: db.companies.find((c) => c.id === tenant)?.attendanceCounting || null,
      });
    }),
  );

  router.post(
    "/integrations/test",
    manage,
    route(async (req, res) => {
      const input = credentialsSchema.parse(req.body);
      res.json(await testConnection(input.baseUrl, input.apiKey));
    }),
  );

  router.post(
    "/integrations",
    manage,
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const input = credentialsSchema.extend({ name: z.string().trim().max(80).optional() }).parse(req.body);
      const test = await testConnection(input.baseUrl, input.apiKey);
      if (test.missingScopes.length)
        throw httpError(`API kalitda kerakli ruxsatlar yo‘q: ${test.missingScopes.join(", ")}`, 400);
      const db0 = await readDb();
      if (activeIntegration(db0, tenant)) throw httpError("Bu kompaniyada integratsiya allaqachon ulangan. Avval uzing yoki kalitni yangilang.", 409);
      const client = new BotClient({ baseUrl: test.baseUrl, apiKey: input.apiKey });
      const cursor = await latestCursor(client).catch(() => 0);
      const now = new Date().toISOString();
      const integration = await updateDb((db) => {
        // Oldin uzilgan shu bot integratsiyasi bo‘lsa — o‘sha yozuv (va mapping'lar) qayta ishlatiladi: dublikat bo‘lmaydi.
        let row = db.integrations.find((i) => i.companyId === tenant && i.provider === PROVIDER && i.baseUrl === test.baseUrl);
        const reconnect = Boolean(row);
        if (!row) {
          row = {
            id: newId(),
            companyId: tenant,
            provider: PROVIDER,
            name: input.name || test.remote.companyName || "Xodimlar boti",
            baseUrl: test.baseUrl,
            apiKeyEnc: "",
            apiKeyHint: "",
            status: "CONNECTED",
            settings: defaultIntegrationSettings(),
            cursor,
            connectedAt: now,
            connectedBy: req.session!.name,
            updatedAt: now,
          };
          db.integrations.push(row);
        }
        row.apiKeyEnc = encryptSecret(input.apiKey);
        row.apiKeyHint = keyHint(input.apiKey);
        row.status = "CONNECTED";
        row.remote = test.remote;
        row.cursor = Math.max(row.cursor || 0, cursor);
        row.disconnectedAt = undefined;
        row.lastError = undefined;
        row.updatedAt = now;
        if (reconnect) {
          row.connectedAt = now;
          row.connectedBy = req.session!.name;
        }
        db.auditLogs.unshift(audit(tenant, req.session!.name, reconnect ? "Xodimlar boti qayta ulandi" : "Xodimlar boti ulandi", "integration", row.id, undefined, { baseUrl: row.baseUrl, key: row.apiKeyHint, scopes: test.remote.scopes }));
        return row;
      });
      await logIntegration(integration, "info", "connect", `Ulandi: ${test.remote.apiName || "bot"} (${test.remote.apiVersion || "v1"})`, { scopes: test.remote.scopes });
      let webhook: { registered: boolean; reason?: string } = { registered: false, reason: "webhooks:write ruxsati yo‘q" };
      if (test.remote.scopes.includes("webhooks:write") || test.remote.scopes.includes("admin"))
        webhook = await registerWebhook(integration).catch((error) => ({ registered: false, reason: (error as Error).message }));
      await logIntegration(integration, webhook.registered ? "info" : "warn", "webhook", webhook.registered ? "Webhook ro‘yxatdan o‘tdi" : `Webhook yo‘q: ${webhook.reason}`);
      const db = await readDb();
      res.status(201).json({ ...(await detail(db.integrations.find((i) => i.id === integration.id)!)), test, webhook });
    }),
  );

  const load = async (req: AuthedRequest) => {
    const db = await readDb();
    const integration = integrationById(db, tenantOf(req), String(req.params.id));
    if (!integration) throw httpError("Integratsiya topilmadi.", 404);
    return integration;
  };
  const requireConnected = (integration: Integration) => {
    if (integration.status === "DISCONNECTED") throw httpError("Integratsiya uzilgan. Avval qayta ulang.", 409);
  };

  router.get("/integrations/:id", manage, route(async (req, res) => res.json(await detail(await load(req)))));

  router.get(
    "/integrations/:id/preview",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      requireConnected(integration);
      const client = clientFor(integration);
      const remote = await fetchRemote(client, new Set(["branch", "department", "position", "employee", "attendance"]));
      remote.company = { name: integration.remote?.companyName };
      res.json(await buildPreview(integration, remote));
    }),
  );

  router.put(
    "/integrations/:id/settings",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      const input = settingsSchema.parse(req.body) as Partial<IntegrationSettings>;
      const row = await updateDb((db) => {
        const current = db.integrations.find((i) => i.id === integration.id)!;
        const before = current.settings;
        current.settings = normalizeSettings({
          ...current.settings,
          ...input,
          syncModes: { ...current.settings.syncModes, ...(input.syncModes || {}) },
          routing: { ...current.settings.routing, ...(input.routing || {}) },
        });
        current.updatedAt = new Date().toISOString();
        db.auditLogs.unshift(audit(current.companyId, req.session!.name, "Integratsiya sozlamalari o‘zgartirildi", "integration", current.id, before, current.settings));
        return current;
      });
      res.json(publicIntegration(row));
    }),
  );

  router.post(
    "/integrations/:id/sync",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      requireConnected(integration);
      const input = z
        .object({ entities: entitySchema.default(["branch", "department", "position", "employee", "attendance"]), type: z.enum(["INITIAL", "MANUAL"]).default("MANUAL") })
        .parse(req.body || {});
      const job = await createSyncJob(integration, input.type, input.entities, req.session!.name);
      void runSyncJob(job.id);
      res.status(202).json(job);
    }),
  );

  router.get(
    "/integrations/:id/jobs",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      const db = await readDb();
      res.json(db.syncJobs.filter((j) => j.integrationId === integration.id).slice(0, 50));
    }),
  );

  router.get(
    "/integrations/:id/jobs/:jobId",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      const db = await readDb();
      const job = db.syncJobs.find((j) => j.id === req.params.jobId && j.integrationId === integration.id);
      if (!job) throw httpError("Ish topilmadi.", 404);
      const deliveries = job.type === "ACCESS_SEND" ? await deliveriesByRef(integration.companyId, "ACCESS", job.id) : undefined;
      res.json({ ...job, deliveries });
    }),
  );

  router.post(
    "/integrations/:id/rotate-key",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      const input = z.object({ apiKey: credentialsSchema.shape.apiKey }).parse(req.body);
      const test = await testConnection(integration.baseUrl, input.apiKey);
      if (test.missingScopes.length) throw httpError(`Yangi kalitda kerakli ruxsatlar yo‘q: ${test.missingScopes.join(", ")}`, 400);
      if (integration.remote?.source && test.remote.source && integration.remote.source !== test.remote.source)
        throw httpError("Yangi kalit boshqa botga tegishli ko‘rinadi.", 400);
      const row = await updateDb((db) => {
        const current = db.integrations.find((i) => i.id === integration.id)!;
        current.apiKeyEnc = encryptSecret(input.apiKey);
        current.apiKeyHint = keyHint(input.apiKey);
        current.remote = test.remote;
        current.status = "CONNECTED";
        current.lastError = undefined;
        current.updatedAt = new Date().toISOString();
        db.auditLogs.unshift(audit(current.companyId, req.session!.name, "Integratsiya API kaliti yangilandi", "integration", current.id, undefined, { key: current.apiKeyHint }));
        return current;
      });
      await logIntegration(row, "info", "rotate", "API kalit yangilandi");
      res.json(publicIntegration(row));
    }),
  );

  router.post(
    "/integrations/:id/disconnect",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      if (integration.remoteWebhookId) {
        try {
          await clientFor(integration).request("DELETE", `/webhooks/${integration.remoteWebhookId}`);
        } catch (error) {
          await logIntegration(integration, "warn", "disconnect", `Bot'dagi webhook o‘chirilmadi: ${(error as Error).message}`);
        }
      }
      const row = await updateDb((db) => {
        const current = db.integrations.find((i) => i.id === integration.id)!;
        // Ma’lumotlar (xodimlar, davomat, mapping'lar) O‘CHIRILMAYDI — qayta ulanganda dublikat bo‘lmaydi.
        current.status = "DISCONNECTED";
        current.disconnectedAt = new Date().toISOString();
        current.remoteWebhookId = undefined;
        current.webhookSecretEnc = undefined;
        current.updatedAt = current.disconnectedAt;
        db.auditLogs.unshift(audit(current.companyId, req.session!.name, "Xodimlar boti uzildi (ma’lumotlar saqlandi)", "integration", current.id));
        return current;
      });
      await logIntegration(row, "info", "disconnect", "Integratsiya uzildi, ma’lumotlar saqlandi");
      res.json(publicIntegration(row));
    }),
  );

  router.post(
    "/integrations/:id/webhook/register",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      requireConnected(integration);
      const result = await registerWebhook(integration);
      await logIntegration(integration, result.registered ? "info" : "warn", "webhook", result.registered ? "Webhook qayta ro‘yxatdan o‘tdi" : `Webhook: ${result.reason}`);
      await updateDb((db) => db.auditLogs.unshift(audit(integration.companyId, req.session!.name, "Webhook qayta ro‘yxatdan o‘tkazildi", "integration", integration.id)));
      res.json(result);
    }),
  );

  router.post(
    "/integrations/:id/webhook/test",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      requireConnected(integration);
      if (!integration.remoteWebhookId) throw httpError("Webhook ro‘yxatdan o‘tmagan.", 409);
      const { data } = await clientFor(integration).request<{ status: string; last_status_code?: number; last_error?: string }>(
        "POST",
        `/webhooks/${integration.remoteWebhookId}/test`,
      );
      res.json(data);
    }),
  );

  router.post(
    "/integrations/:id/poll",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      requireConnected(integration);
      await runWorkerOnce({ force: true });
      const db = await readDb();
      res.json(publicIntegration(db.integrations.find((i) => i.id === integration.id)!));
    }),
  );

  router.get(
    "/integrations/:id/logs",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      const q = z.object({ level: z.enum(["info", "warn", "error"]).optional(), before: z.coerce.number().int().optional(), limit: z.coerce.number().int().optional() }).parse(req.query);
      res.json(await listLogs(integration.id, integration.companyId, q));
    }),
  );

  router.get(
    "/integrations/:id/events",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      res.json(await listEvents(integration.id, { status, limit: 200 }));
    }),
  );

  router.post(
    "/integrations/:id/events/:eventId/retry",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      const ok = await retryDeadEvent(integration.id, String(req.params.eventId));
      if (!ok) throw httpError("Qayta urinib bo‘lmaydigan hodisa.", 409);
      res.json({ ok });
    }),
  );

  router.get(
    "/integrations/:id/outbox",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      res.json(await listOutbox(integration.id, typeof req.query.status === "string" ? req.query.status : undefined));
    }),
  );

  router.post(
    "/integrations/:id/outbox/:outboxId/retry",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      const ok = await retryOutbox(integration.id, Number(req.params.outboxId));
      if (!ok) throw httpError("Qayta urinib bo‘lmaydi.", 409);
      res.json({ ok });
    }),
  );

  router.get(
    "/integrations/:id/conflicts",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      const db = await readDb();
      const name = (entity: string, id: string) => {
        const row =
          entity === "employee"
            ? db.employees.find((e) => e.id === id)
            : entity === "branch"
              ? db.branches.find((b) => b.id === id)
              : entity === "department"
                ? db.departments.find((d) => d.id === id)
                : db.positions.find((p) => p.id === id);
        if (!row) return "—";
        return "firstName" in row ? `${row.firstName} ${row.lastName}`.trim() : row.name;
      };
      res.json(
        db.integrationConflicts
          .filter((c) => c.integrationId === integration.id)
          .slice(0, 200)
          .map((c) => ({ ...c, remote: undefined, name: name(c.entity, c.localId) })),
      );
    }),
  );

  router.post(
    "/integrations/:id/conflicts/:conflictId/resolve",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      const input = z.object({ use: z.enum(["STAFFORA", "BOT"]) }).parse(req.body);
      await updateDb((db) => {
        const conflict = db.integrationConflicts.find(
          (c) => c.id === req.params.conflictId && c.integrationId === integration.id && c.companyId === integration.companyId,
        );
        if (!conflict) throw httpError("Konflikt topilmadi.", 404);
        if (conflict.status !== "OPEN") throw httpError("Konflikt allaqachon hal qilingan.", 409);
        resolveConflict(db, conflict, input.use, req.session!.name);
      });
      res.json({ ok: true });
    }),
  );

  router.get(
    "/integrations/:id/mappings",
    manage,
    route(async (req, res) => {
      const integration = await load(req);
      const db = await readDb();
      const entity = typeof req.query.entity === "string" ? req.query.entity : undefined;
      res.json(
        db.entityMappings
          .filter((m) => m.integrationId === integration.id && (!entity || m.entity === entity))
          .slice(0, 2000)
          .map((m) => ({ id: m.id, entity: m.entity, localId: m.localId, externalId: m.externalId, syncedAt: m.syncedAt })),
      );
    }),
  );

  /* -------------------------------------------------- xodimlar kirishi --- */

  router.get(
    "/integrations/:id/access",
    permit("employees.view"),
    route(async (req, res) => {
      const integration = await load(req);
      const db = await readDb();
      const deliveries = await latestAccessDeliveries(integration.companyId);
      const now = Date.now();
      const rows = db.employees
        .filter((e) => e.companyId === integration.companyId && e.status === "ACTIVE")
        .map((e) => {
          const mapping = mappingByLocal(db, integration.id, "employee", e.id);
          const invite = db.telegramInvites
            .filter((i) => i.employeeId === e.id && i.companyId === e.companyId)
            .sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];
          const inviteState = !invite
            ? "NONE"
            : invite.usedAt
              ? "USED"
              : invite.revokedAt
                ? "REVOKED"
                : new Date(invite.expiresAt).getTime() < now
                  ? "EXPIRED"
                  : "ACTIVE";
          const delivery = deliveries.get(e.id);
          return {
            employeeId: e.id,
            name: `${e.firstName} ${e.lastName}`.trim(),
            employeeNo: e.employeeNo,
            phone: e.phone,
            branchId: e.branchId,
            inBot: Boolean(mapping),
            botEmployeeId: mapping ? Number(mapping.externalId) : undefined,
            telegramKnown: Boolean(e.telegramId),
            connected: e.telegramConnected,
            invite: invite ? { state: inviteState, expiresAt: invite.expiresAt, sentAt: invite.sentAt, usedAt: invite.usedAt, channel: invite.channel } : null,
            delivery: delivery ? { status: delivery.status, error: delivery.error, updatedAt: delivery.updatedAt } : null,
          };
        });
      res.json({
        botUsername: telegramBotUsername(),
        summary: {
          total: rows.length,
          connected: rows.filter((r) => r.connected).length,
          inBot: rows.filter((r) => r.inBot).length,
          pending: rows.filter((r) => !r.connected && r.invite?.state === "ACTIVE").length,
        },
        rows,
      });
    }),
  );

  router.post(
    "/integrations/:id/access/send",
    permit("employees.edit"),
    route(async (req, res) => {
      const integration = await load(req);
      requireConnected(integration);
      const input = z
        .object({ employeeIds: z.array(z.string()).max(5000).optional(), all: z.boolean().optional(), onlyNotConnected: z.boolean().default(true) })
        .refine((v) => v.all || v.employeeIds?.length, "Xodimlarni tanlang.")
        .parse(req.body);
      if (!integration.settings.miniAppLink && !telegramBotUsername())
        throw httpError("Staffora Telegram boti ishga tushmagan — havola yaratib bo‘lmaydi.", 409);
      const db = await readDb();
      const target = input.all ? ("ALL" as const) : input.employeeIds!;
      const candidates = accessCandidates(db, integration, target, input.onlyNotConnected);
      const job = await createSyncJob(integration, "ACCESS_SEND", ["access"], req.session!.name).catch((error) => {
        throw error;
      });
      void runAccessSendJob(job.id, target, input.onlyNotConnected);
      res.status(202).json({ ...job, planned: candidates.filter((c) => c.remoteId).length, skipped: candidates.filter((c) => !c.remoteId).length });
    }),
  );

  router.post(
    "/integrations/:id/access/:employeeId/link",
    permit("employees.edit"),
    route(async (req, res) => {
      const integration = await load(req);
      if (!telegramBotUsername()) throw httpError("Staffora Telegram boti ishga tushmagan.", 409);
      const invite = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === req.params.employeeId && e.companyId === integration.companyId && e.status === "ACTIVE");
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        const value = issueInvite(db, employee, { ttlHours: integration.settings.inviteTtlHours, by: req.session!.name, channel: "MANUAL" });
        db.auditLogs.unshift(audit(integration.companyId, req.session!.name, "Staffora'ga kirish havolasi yaratildi", "employee", employee.id));
        return value;
      });
      res.status(201).json({ link: inviteLink(invite.code), expiresAt: invite.expiresAt });
    }),
  );

  router.post(
    "/employees/:employeeId/access/revoke",
    permit("employees.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const count = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === req.params.employeeId && e.companyId === tenant);
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        const n = revokeInvites(db, tenant, employee.id);
        db.auditLogs.unshift(audit(tenant, req.session!.name, `Kirish havolasi bekor qilindi (${n})`, "employee", employee.id));
        return n;
      });
      res.json({ revoked: count });
    }),
  );

  /* ------------------------------------------ hisoblash boshlanish sanasi --- */

  router.put(
    "/company/attendance-counting",
    manage,
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const input = z
        .object({
          startDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana YYYY-MM-DD formatida bo‘lsin."), z.literal(""), z.null()]),
          note: z.string().trim().max(300).optional(),
        })
        .parse(req.body);
      const row = await updateDb((db) => {
        const company = db.companies.find((c) => c.id === tenant);
        if (!company) throw httpError("Kompaniya topilmadi.", 404);
        const before = company.attendanceCounting;
        company.attendanceCounting = input.startDate
          ? { startDate: input.startDate, note: input.note, updatedAt: new Date().toISOString(), updatedBy: req.session!.name }
          : undefined;
        db.auditLogs.unshift(
          audit(tenant, req.session!.name, input.startDate ? `Davomat hisoblash boshlanish sanasi: ${input.startDate}` : "Hisoblash boshlanish sanasi olib tashlandi", "company", tenant, before, company.attendanceCounting),
        );
        return company.attendanceCounting || null;
      });
      res.json(row);
    }),
  );

  router.put(
    "/employees/:employeeId/counting-start",
    permit("employees.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const input = z.object({ startDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()]) }).parse(req.body);
      const row = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === req.params.employeeId && e.companyId === tenant);
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        const before = employee.countingStartDate;
        employee.countingStartDate = input.startDate || undefined;
        employee.updatedAt = new Date().toISOString();
        db.auditLogs.unshift(audit(tenant, req.session!.name, "Xodim hisoblash boshlanish sanasi o‘zgartirildi", "employee", employee.id, { countingStartDate: before }, { countingStartDate: employee.countingStartDate }));
        return { countingStartDate: employee.countingStartDate || null };
      });
      res.json(row);
    }),
  );

  return router;
}

/* ---------------------------------------------- ochiq webhook endpoint --- */

/**
 * POST /api/integrations/:id/webhook — autentifikatsiyasiz, lekin HMAC imzo bilan.
 * Xom (raw) tana express.json verify orqali req.rawBody ga saqlanadi.
 */
export function createIntegrationWebhookRouter() {
  const router = Router();
  router.post("/integrations/:id/webhook", (req, res, next) => {
    void (async () => {
      const db = await readDb();
      const integration = db.integrations.find((i) => i.id === req.params.id);
      if (!integration || integration.status === "DISCONNECTED" || !integration.webhookSecretEnc)
        return res.status(404).json({ message: "Integratsiya topilmadi." });
      const raw = (req as Request & { rawBody?: string }).rawBody;
      if (typeof raw !== "string") return res.status(400).json({ message: "Tana o‘qilmadi." });
      const check = verifySignature(decryptSecret(integration.webhookSecretEnc), req.header("x-webhook-signature"), raw);
      if (!check.ok) {
        await logIntegration(integration, "warn", "webhook.rejected", `Webhook rad etildi: ${check.reason}`, { ip: req.ip });
        return res.status(401).json({ message: "Imzo noto‘g‘ri yoki eskirgan." });
      }
      let envelope: BotEventEnvelope;
      try {
        envelope = JSON.parse(raw);
      } catch {
        return res.status(400).json({ message: "JSON noto‘g‘ri." });
      }
      if (!envelope?.id || !envelope.event) return res.status(400).json({ message: "id va event majburiy." });
      await updateDb((next) => {
        const current = next.integrations.find((i) => i.id === integration.id);
        if (current) current.lastWebhookAt = new Date().toISOString();
      });
      if (envelope.event === "ping") return res.json({ ok: true, pong: true });
      const fresh = await recordEvent(integration.id, String(envelope.id), String(envelope.event), "webhook", raw);
      if (!fresh) return res.json({ ok: true, duplicate: true });
      // Tez javob beramiz; qayta ishlash fonda (xato bo‘lsa — o‘zimiz qayta urinamiz).
      res.status(202).json({ ok: true });
      void processRecordedEvent(integration, envelope);
      return undefined;
    })().catch(next);
  });
  return router;
}

export type { AnnouncementTarget };
