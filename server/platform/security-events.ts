import type { Request } from "express";
import { opsStore } from "../../lib/store";
import { maskEmail, maskSecrets } from "../../lib/platform/security";
import { clientIp, userAgentOf } from "./context";

/*
 * Xavfsizlik hodisalari (platform_security): muvaffaqiyatsiz kirish, bloklangan hisobdan urinish,
 * sessiya bekor qilish, ko‘rish/yordam kirishi, qayta autentifikatsiya xatosi va h.k.
 * Email to‘liq saqlanmaydi (a***@domen), parol hech qachon yozilmaydi.
 */

export type SecurityEventType =
  | "LOGIN_FAILED"
  | "LOGIN_BLOCKED"
  | "LOGIN_SUCCESS_ADMIN"
  | "CODE_FAILED"
  | "REAUTH_FAILED"
  | "SESSION_REVOKED"
  | "PREVIEW_STARTED"
  | "SUPPORT_ACCESS"
  | "ROLE_CHANGED"
  | "USER_BLOCKED"
  | "API_KEY_REJECTED";

export async function recordSecurityEvent(input: { type: SecurityEventType; severity?: "LOW" | "MEDIUM" | "HIGH"; userId?: string; email?: string; subject?: string; req?: Request; detail?: string }) {
  try {
    const store = await opsStore();
    await store.run("INSERT INTO platform_security (at, type, severity, user_id, subject, ip, user_agent, detail) VALUES (?,?,?,?,?,?,?,?)", [
      new Date().toISOString(),
      input.type,
      input.severity || "LOW",
      input.userId || null,
      input.subject || (input.email ? maskEmail(input.email) : null),
      input.req ? clientIp(input.req) : null,
      input.req ? userAgentOf(input.req).slice(0, 200) : null,
      input.detail ? maskSecrets(input.detail, 500) : null,
    ]);
  } catch (error) {
    console.error("Xavfsizlik hodisasini yozishda xato", error);
  }
}

type RawEvent = { id: number; at: string; type: string; severity: string; user_id: string | null; subject: string | null; ip: string | null; user_agent: string | null; detail: string | null };

export async function querySecurityEvents(filters: { type?: string; since?: string; userId?: string }, limit = 50, offset = 0) {
  const store = await opsStore();
  const parts: string[] = [];
  const params: unknown[] = [];
  if (filters.type) {
    parts.push("type = ?");
    params.push(filters.type);
  }
  if (filters.since) {
    parts.push("at >= ?");
    params.push(filters.since);
  }
  if (filters.userId) {
    parts.push("user_id = ?");
    params.push(filters.userId);
  }
  const where = parts.length ? `WHERE ${parts.join(" AND ")}` : "";
  const rows = await store.all<RawEvent>(`SELECT * FROM platform_security ${where} ORDER BY at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const total = Number((await store.all<{ n: number | string }>(`SELECT COUNT(*) AS n FROM platform_security ${where}`, params))[0]?.n || 0);
  return {
    total,
    rows: rows.map((r) => ({ id: Number(r.id), at: r.at, type: r.type, severity: r.severity, userId: r.user_id, subject: r.subject, ip: r.ip, userAgent: r.user_agent, detail: r.detail })),
  };
}

/** Oxirgi N daqiqada IP bo‘yicha muvaffaqiyatsiz kirishlar (shubhali faollik qoidasi uchun). */
export async function failedLoginsByIp(minutes: number) {
  const store = await opsStore();
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const rows = await store.all<{ ip: string | null; n: number | string }>(
    "SELECT ip, COUNT(*) AS n FROM platform_security WHERE type IN ('LOGIN_FAILED','CODE_FAILED') AND at >= ? GROUP BY ip ORDER BY n DESC LIMIT 20",
    [since],
  );
  return rows.map((r) => ({ ip: r.ip || "?", count: Number(r.n) }));
}

export async function securityCounts(sinceIso: string) {
  const store = await opsStore();
  const rows = await store.all<{ type: string; n: number | string }>("SELECT type, COUNT(*) AS n FROM platform_security WHERE at >= ? GROUP BY type", [sinceIso]);
  return Object.fromEntries(rows.map((r) => [r.type, Number(r.n)])) as Record<string, number>;
}

export async function purgeSecurityEvents(beforeIso: string) {
  const store = await opsStore();
  return store.run("DELETE FROM platform_security WHERE at < ?", [beforeIso]);
}
