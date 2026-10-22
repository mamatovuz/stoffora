import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { readDb } from "../../lib/store";
import type { Database, User } from "../../lib/types";
import { platformCan, platformPermissionsOf, platformRoleOf, type PlatformPermission } from "../../lib/platform/permissions";
import type { PlatformRole } from "../../lib/platform/types";
import type { AuthedRequest } from "../auth";

/*
 * Super Admin so‘rov konteksti: request ID, platforma ruxsatlari (server tomonda — RBAC),
 * qayta autentifikatsiya (xavfli amallar oldidan parol), Origin tekshiruvi (CSRF himoyasi).
 */

export type PlatformActor = { id: string; name: string; email: string; role: PlatformRole };
export type PlatformRequest = AuthedRequest & { id?: string; platform?: { user: User; actor: PlatformActor; permissions: PlatformPermission[] } };

export const httpError = (message: string, status: number, code?: string) => Object.assign(new Error(message), { status, code });

export const asyncRoute =
  (handler: (req: PlatformRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req as PlatformRequest, res)).catch(next);

/** Har bir so‘rovga ID (javob sarlavhasida ham) — audit va xatolarni bog‘lash uchun. */
export function requestContext() {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = String(req.headers["x-request-id"] || "");
    const id = /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    (req as PlatformRequest).id = id;
    res.setHeader("X-Request-Id", id);
    next();
  };
}

export const clientIp = (req: Request) => String(req.ip || "").replace(/^::ffff:/, "");
export const userAgentOf = (req: Request) => String(req.headers["user-agent"] || "").slice(0, 300);

/** Platforma administratori (preview sessiyasi emas, bloklanmagan) va kerakli ruxsat. */
export function requirePlatform(...permissions: PlatformPermission[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const r = req as PlatformRequest;
    const session = r.session;
    if (!session || session.role !== "SUPER_ADMIN" || session.preview)
      return res.status(403).json({ code: "PLATFORM_ONLY", message: "Bu bo‘lim faqat platforma administratorlari uchun." });
    try {
      const db = await readDb();
      const user = db.users.find((u) => u.id === session.userId && u.role === "SUPER_ADMIN");
      if (!user || user.blockedAt) return res.status(403).json({ code: "ADMIN_BLOCKED", message: "Hisobingiz bloklangan." });
      const role = platformRoleOf(user.platformRole);
      if (permissions.length && !permissions.some((p) => platformCan(role, p)))
        return res.status(403).json({ code: "PLATFORM_FORBIDDEN", message: "Bu amal uchun platforma ruxsati yetarli emas." });
      r.platform = { user, actor: { id: user.id, name: user.name, email: user.email, role }, permissions: platformPermissionsOf(role) };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const actorOf = (req: PlatformRequest): PlatformActor => {
  if (!req.platform) throw httpError("Platforma konteksti yo‘q.", 500);
  return req.platform.actor;
};
export const hasPermission = (req: PlatformRequest, permission: PlatformPermission) => Boolean(req.platform?.permissions.includes(permission));

/* ------------------------------------------------- qayta autentifikatsiya --- */
const reauthAt = new Map<string, number>();
const reauthKey = (req: PlatformRequest) => `${req.session?.userId}:${req.session?.sid || "nosid"}`;
export function markReauthenticated(req: PlatformRequest) {
  reauthAt.set(reauthKey(req), Date.now());
  if (reauthAt.size > 5000) reauthAt.clear();
}
/** Xavfli amal: oxirgi N daqiqada parol qayta kiritilgan bo‘lishi shart (428 — panel parol so‘raydi). */
export function assertRecentAuth(req: PlatformRequest, db: Database) {
  const minutes = Math.max(1, Math.min(120, db.platformSettings?.session?.reauthMinutes || 10));
  const at = reauthAt.get(reauthKey(req));
  if (!at || Date.now() - at > minutes * 60_000)
    throw httpError("Bu xavfli amal. Davom etish uchun parolingizni qayta kiriting.", 428, "REAUTH_REQUIRED");
}

/**
 * CSRF: holatni o‘zgartiruvchi so‘rovda Origin/Referer berilgan bo‘lsa — u ruxsat etilgan domen bo‘lishi shart.
 * (Cookie SameSite=Lax bilan birga ikkinchi qatlam himoya.)
 */
export function originGuard(allowed: string[]) {
  const hosts = new Set(
    allowed
      .filter(Boolean)
      .map((value) => {
        try {
          return new URL(value).host;
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );
  return (req: Request, res: Response, next: NextFunction) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const source = String(req.headers.origin || req.headers.referer || "");
    if (!source) return next();
    let host = "";
    try {
      host = new URL(source).host;
    } catch {
      /* noto‘g‘ri sarlavha */
    }
    if (host && (hosts.has(host) || host === req.headers.host)) return next();
    return res.status(403).json({ code: "BAD_ORIGIN", message: "So‘rov manbasi tasdiqlanmadi." });
  };
}

/* ------------------------------------------------------------- sahifalash --- */
export function pageParams(req: Request, max = 200) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.max(1, Math.min(max, Number(req.query.pageSize) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export function paginate<T>(rows: T[], page: number, pageSize: number) {
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}
export const q = (req: Request, key: string) => (typeof req.query[key] === "string" ? String(req.query[key]).trim() : "");
