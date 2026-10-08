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
  /** Native mobil ilova: sessiya va ishonchli qurilma (Telegram sessiyasida bo‘lmaydi). */
  msid?: string;
  mdid?: string;
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
/*
 * Rahbar Mini App’i va mobil ilovasi hisobotni (Excel/CSV) Telegram yoki telefon
 * orqali yuklaydi — u yerda sessiya sarlavhasi yuborilmaydi. Shuning uchun 5 daqiqalik
 * imzolangan havola: ichida yo‘l va o‘sha foydalanuvchining sessiyasi (huquqlar o‘zgarmaydi).
 */
export const FILE_LINK_PATH = /^\/(reports\/[\w.-]+\.(xlsx|csv)|payroll\/\d{4}-\d{2}\/bank\.csv)(\?[\w=&%.-]*)?$/;
export function signFileLink(path: string, sessionToken: string) {
  return jwt.sign({ t: "FILE_LINK", p: path, s: sessionToken }, `${secret}-file-link`, { expiresIn: 300, issuer: "staffora" });
}
export function verifyFileLink(token: string) {
  try {
    const payload = jwt.verify(token, `${secret}-file-link`, { issuer: "staffora" }) as { t: string; p: string; s: string };
    return payload.t === "FILE_LINK" && FILE_LINK_PATH.test(payload.p) ? payload : undefined;
  } catch {
    return undefined;
  }
}
const lastSeenWrites = new Map<string, number>();
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  // Rahbar Mini App’i cookie o‘rniga Bearer token yuboradi (Telegram ichida cookie ishonchsiz).
  const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined;
  const token = req.cookies?.staffora_session || bearer;
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
/** Mobil ilova uchun qisqa muddatli (15 daqiqa) kirish tokeni — sessiya va qurilmaga bog‘langan. */
export const MOBILE_ACCESS_TTL_SECONDS = 15 * 60;
export function signMobileAccess(session: EmployeeSession & { msid: string; mdid: string }) {
  return jwt.sign(session, employeeSecret, { expiresIn: MOBILE_ACCESS_TTL_SECONDS, issuer: "staffora-mini-app" });
}
export function signEmployeeSession(session: EmployeeSession) {
  return jwt.sign(session, employeeSecret, {
    expiresIn: "24h",
    issuer: "staffora-mini-app",
  });
}
/** Xodim (Mini App) tokenini tekshiradi; yaroqsiz bo‘lsa — undefined. */
export function verifyEmployeeToken(token: string): EmployeeSession | undefined {
  try {
    return jwt.verify(token, employeeSecret, { issuer: "staffora-mini-app" }) as EmployeeSession;
  } catch {
    return undefined;
  }
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
  let session: EmployeeSession;
  try {
    session = jwt.verify(token, employeeSecret, {
      issuer: "staffora-mini-app",
    }) as EmployeeSession;
  } catch {
    return res.status(401).json({
      message: "Telegram sessiyasi tugagan. Mini App’ni qayta oching.",
    });
  }
  req.employeeSession = session;
  // Telegram Mini App tokeni — avvalgidek, qo‘shimcha tekshiruvsiz.
  if (!session.msid) return next();
  // Native ilova: sessiya bekor qilinmagan va qurilma hali ishonchli bo‘lishi shart.
  readDb()
    .then((db) => {
      const mobile = db.mobileSessions.find((s) => s.id === session.msid);
      const device = db.mobileDevices.find((d) => d.id === session.mdid);
      if (!mobile || mobile.revokedAt || mobile.employeeId !== session.employeeId || !device || device.status !== "ACTIVE" || device.employeeId !== session.employeeId)
        return res.status(401).json({ code: "DEVICE_REVOKED", message: "Bu qurilma endi ishonchli emas. Ilovani qayta faollashtiring." });
      next();
    })
    .catch(next);
}
