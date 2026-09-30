import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "../lib/types";
import { readDb, updateDb } from "../lib/store";

export interface Session {
  /** Qurilma (panel sessiyasi) ID — chiqarib yuborish uchun. */
  sid?: string;
  userId: string;
  companyId?: string;
  name: string;
  email: string;
  role: Role;
  photoDataUrl?: string;
}
export interface EmployeeSession {
  employeeId: string;
  companyId: string;
  telegramId: string;
  kind: "employee";
}
export interface AuthedRequest extends Request {
  session?: Session;
}
const secret =
  process.env.SESSION_SECRET || "staffora-local-session-secret-change-me";
const employeeSecret = process.env.JWT_SECRET || `${secret}-employee`;

export function signSession(session: Session) {
  return jwt.sign(session, secret, { expiresIn: "8h", issuer: "staffora" });
}
const lastSeenWrites = new Map<string, number>();
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const token = req.cookies?.staffora_session;
  if (!token)
    return res
      .status(401)
      .json({ message: "Sessiya topilmadi. Qayta kiring." });
  let session: Session;
  try {
    session = jwt.verify(token, secret, { issuer: "staffora" }) as Session;
  } catch {
    return res
      .status(401)
      .json({ message: "Sessiya muddati tugagan. Qayta kiring." });
  }
  try {
    const db = await readDb();
    const user = db.users.find((u) => u.id === session.userId);
    const device = session.sid
      ? db.panelSessions.find((s) => s.id === session.sid)
      : undefined;
    if (!user || (session.sid && (!device || device.revokedAt)))
      return res.status(401).json({
        message: "Bu qurilmadan chiqarildingiz. Qayta kiring.",
      });
    // Ekran qulflangan bo‘lsa — faqat holatni bilish va qulfni ochish mumkin.
    const path = req.originalUrl.split("?")[0];
    if (
      device?.lockedAt &&
      user.screenLock?.enabled &&
      !["/api/auth/me", "/api/auth/unlock"].includes(path)
    )
      return res.status(423).json({
        code: "LOCKED",
        message: "Ekran qulflangan. Davom etish uchun parolni kiriting.",
      });
    // Ism/rasm o‘zgargan bo‘lsa — yangi qiymat ishlatiladi.
    req.session = {
      ...session,
      name: user.name,
      role: user.role,
      companyId: user.companyId,
      photoDataUrl: user.photoDataUrl,
    };
    if (device) {
      const last = lastSeenWrites.get(device.id) || 0;
      if (Date.now() - last > 5 * 60_000) {
        lastSeenWrites.set(device.id, Date.now());
        void updateDb((next) => {
          const row = next.panelSessions.find((s) => s.id === device.id);
          if (row) row.lastSeenAt = new Date().toISOString();
        }).catch(() => undefined);
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}
export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) =>
    roles.includes(req.session!.role)
      ? next()
      : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
}
export function signEmployeeSession(session: EmployeeSession) {
  return jwt.sign(session, employeeSecret, {
    expiresIn: "24h",
    issuer: "staffora-mini-app",
  });
}
export function requireEmployee(
  req: AuthedRequest & { employeeSession?: EmployeeSession },
  res: Response,
  next: NextFunction,
) {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = bearer || req.cookies?.staffora_employee_session;
  if (!token)
    return res.status(401).json({
      message: "Telegram sessiyasi topilmadi. Mini App’ni bot orqali oching.",
    });
  try {
    req.employeeSession = jwt.verify(token, employeeSecret, {
      issuer: "staffora-mini-app",
    }) as EmployeeSession;
    next();
  } catch {
    return res.status(401).json({
      message: "Telegram sessiyasi tugagan. Mini App’ni qayta oching.",
    });
  }
}
