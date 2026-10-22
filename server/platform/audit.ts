import { randomUUID } from "node:crypto";
import { opsStore, scrubSensitive } from "../../lib/store";
import { maskSecrets } from "../../lib/platform/security";
import { clientIp, userAgentOf, type PlatformRequest } from "./context";

/*
 * Platforma audit jurnali (platform_audit jadvali).
 * Yozuvlar faqat qo‘shiladi: API orqali o‘zgartirish yoki o‘chirish yo‘q (faqat saqlash muddati bo‘yicha tozalash).
 * Parol, token, maxfiy kalit, biometrika va rasmlar yozilmaydi — scrubSensitive + maskSecrets.
 */

export type AuditResult = "SUCCESS" | "FAILURE" | "DENIED";
export type PlatformAuditInput = {
  req?: PlatformRequest;
  actor?: { id?: string; name: string; role?: string };
  companyId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  summary: string;
  details?: unknown;
  result?: AuditResult;
  privileged?: boolean;
};

const SECRET_KEYS = new Set(["password", "passwordHash", "token", "secret", "secretEnc", "hash", "key", "apiKey", "tokenEnc", "authorization", "cookie"]);
function clean(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return maskSecrets(value, 500);
  if (typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => clean(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(scrubSensitive(value) as Record<string, unknown>))
    out[key] = SECRET_KEYS.has(key) ? "[redacted]" : clean(item, depth + 1);
  return out;
}

/** Audit yozuvi. Hech qachon xato otmaydi (asosiy amal buzilmasligi uchun) — xato faqat logga. */
export async function platformAudit(input: PlatformAuditInput) {
  try {
    const actor = input.actor || input.req?.platform?.actor || (input.req?.session ? { id: input.req.session.userId, name: input.req.session.name, role: input.req.session.role } : { name: "Tizim" });
    let details = input.details === undefined ? null : JSON.stringify(clean(input.details));
    if (details && details.length > 4000) details = `${details.slice(0, 4000)}…`;
    const store = await opsStore();
    await store.run(
      "INSERT INTO platform_audit (id, at, actor_id, actor_name, actor_role, company_id, action, entity, entity_id, result, request_id, ip, user_agent, summary, details, privileged) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        randomUUID(),
        new Date().toISOString(),
        actor.id || null,
        actor.name,
        actor.role || null,
        input.companyId || null,
        input.action,
        input.entity || null,
        input.entityId || null,
        input.result || "SUCCESS",
        input.req?.id || null,
        input.req ? clientIp(input.req) : null,
        input.req ? userAgentOf(input.req).slice(0, 200) : null,
        maskSecrets(input.summary, 500),
        details,
        input.privileged ? 1 : 0,
      ],
    );
  } catch (error) {
    console.error("Platforma auditiga yozishda xato", error);
  }
}

export type AuditRow = {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string;
  actorRole: string | null;
  companyId: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  result: AuditResult;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  summary: string;
  details: unknown;
  privileged: boolean;
};

type RawAudit = {
  id: string;
  at: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string | null;
  company_id: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  result: AuditResult;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
  summary: string;
  details: string | null;
  privileged: number;
};
const toRow = (r: RawAudit): AuditRow => ({
  id: r.id,
  at: r.at,
  actorId: r.actor_id,
  actorName: r.actor_name,
  actorRole: r.actor_role,
  companyId: r.company_id,
  action: r.action,
  entity: r.entity,
  entityId: r.entity_id,
  result: r.result,
  requestId: r.request_id,
  ip: r.ip,
  userAgent: r.user_agent,
  summary: r.summary,
  details: r.details ? safeParse(r.details) : null,
  privileged: Boolean(Number(r.privileged)),
});
const safeParse = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export type AuditFilters = {
  companyId?: string;
  actorId?: string;
  action?: string;
  entityId?: string;
  result?: string;
  from?: string;
  to?: string;
  q?: string;
  privileged?: boolean;
};

function where(f: AuditFilters) {
  const parts: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value?: unknown) => {
    parts.push(sql);
    if (value !== undefined) params.push(value);
  };
  if (f.companyId) add("company_id = ?", f.companyId);
  if (f.actorId) add("actor_id = ?", f.actorId);
  if (f.action) add("action LIKE ?", `${f.action}%`);
  if (f.entityId) add("entity_id = ?", f.entityId);
  if (f.result) add("result = ?", f.result);
  if (f.from) add("at >= ?", f.from);
  if (f.to) add("at <= ?", f.to);
  if (f.privileged) add("privileged = 1");
  if (f.q) {
    parts.push("(summary LIKE ? OR actor_name LIKE ?)");
    params.push(`%${f.q}%`, `%${f.q}%`);
  }
  return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

export async function queryPlatformAudit(filters: AuditFilters, limit = 50, offset = 0) {
  const store = await opsStore();
  const w = where(filters);
  const rows = await store.all<RawAudit>(`SELECT * FROM platform_audit ${w.sql} ORDER BY at DESC LIMIT ? OFFSET ?`, [...w.params, Math.min(5000, limit), offset]);
  const total = Number((await store.all<{ n: number | string }>(`SELECT COUNT(*) AS n FROM platform_audit ${w.sql}`, w.params))[0]?.n || 0);
  return { rows: rows.map(toRow), total };
}

/** Saqlash muddatidan eski yozuvlarni o‘chiradi (retention). Qaytaradi: o‘chirilganlar soni. */
export async function purgePlatformAudit(beforeIso: string) {
  const store = await opsStore();
  return store.run("DELETE FROM platform_audit WHERE at < ?", [beforeIso]);
}
