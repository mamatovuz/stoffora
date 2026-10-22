import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "../lib/types";
import { readDb, updateDb } from "../lib/store";
import { platformCan } from "../lib/platform/permissions";

export interface Session {
  /** Qurilma (panel sessiyasi) ID — chiqarib yuborish uchun. */
  sid?: string;
  userId: string;
  companyId?: string;
  name: string;
  email: string;
  role: Role;
  photoDataUrl?: string;
  /**
   * Super admin kompaniya panelini ko‘rmoqda: READ_ONLY — faqat o‘qish (yozish API’lari bloklanadi);
   * SUPPORT — vaqt cheklangan yordam kirishi (har bir yozuv auditga tushadi).
   */
  preview?: { id: string; mode: "READ_ONLY" | "SUPPORT"; adminId: string; companyName?: string; expiresAt: string };
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

/**
 * Kompaniya panelini ko‘rish tokeni: rahbar paroli va tokeni ishlatilmaydi — alohida, qisqa muddatli,
 * previewSessions yozuviga (adminId + companyId) bog‘langan. Har so‘rovda yozuv holati tekshiriladi.
 */
export function signPreviewToken(input: { previewId: string; adminId: string; companyId: string; mode: "READ_ONLY" | "SUPPORT"; ttlSeconds: number }) {
  return jwt.sign({ kind: "preview", pid: input.previewId, adminId: input.adminId, companyId: input.companyId, mode: input.mode }, secret, {
    expiresIn: Math.max(60, Math.min(4 * 3600, input.ttlSeconds)),
    issuer: "staffora",
  });
}
type PreviewToken = { kind: "preview"; pid: string; adminId: string; companyId: string; mode: "READ_ONLY" | "SUPPORT" };

/** Ko‘rish rejimida (READ_ONLY) ham ruxsat etilgan yozish yo‘llari: chiqish va yuklab olish havolasi. */
const PREVIEW_WRITE_ALLOWED = new Set(["/api/auth/preview/exit", "/api/auth/logout", "/api/file-link"]);
/** Faqat o‘qish rejimi: barcha yozish so‘rovlari serverda bloklanadi (UI ga ishonilmaydi). */
export function previewGuard() {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const preview = req.session?.preview;
    if (!preview || preview.mode !== "READ_ONLY" || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (PREVIEW_WRITE_ALLOWED.has(req.originalUrl.split("?")[0])) return next();
    return res.status(403).json({ code: "READ_ONLY_PREVIEW", message: "Ko‘rish rejimida o‘zgartirib bo‘lmaydi (faqat o‘qish)." });
  };
}
/*
 * Rahbar Mini App’i va mobil ilovasi hisobotni (Excel/CSV) Telegram yoki telefon
 * orqali yuklaydi — u yerda sessiya sarlavhasi yuborilmaydi. Shuning uchun 5 daqiqalik
 * imzolangan havola: ichida yo‘l va o‘sha foydalanuvchining sessiyasi (huquqlar o‘zgarmaydi).
 */
export const FILE_LINK_PATH = /^\/(reports\/[\w.-]+\.(xlsx|csv)|payroll\/\d{4}-\d{2}\/bank\.csv|payroll\/advances\.xlsx|attendance\/grid\.xlsx)(\?[\w=&%.-]*)?$/;
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
  let token = req.cookies?.staffora_session || bearer;
  // Ko‘rish rejimi alohida tabda Bearer bilan keladi — o‘sha tabda super admin cookie’sidan ustun.
  if (bearer && token !== bearer && (jwt.decode(bearer) as { kind?: string } | null)?.kind === "preview") token = bearer;
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
  if ((session as unknown as PreviewToken).kind === "preview") return previewSession(req, res, next, session as unknown as PreviewToken);
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
    if (user.blockedAt)
      return res.status(401).json({ code: "ACCOUNT_BLOCKED", message: "Hisobingiz bloklangan. Administratorga murojaat qiling." });
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
    // Bir nechta kompaniyaga ruxsat berilgan rahbar: tanlangan kompaniya ro‘yxatda bo‘lsa — o‘sha, aks holda asosiysi.
    const activeCompany =
      session.companyId &&
      session.companyId !== user.companyId &&
      user.extraCompanyIds?.includes(session.companyId) &&
      db.companies.some((c) => c.id === session.companyId && !c.archive)
        ? session.companyId
        : user.companyId;
    // Ism/rasm o‘zgargan bo‘lsa — yangi qiymat ishlatiladi.
    req.session = {
      ...session,
      name: user.name,
      role: user.role,
      companyId: activeCompany,
      photoDataUrl: user.photoDataUrl,
      preview: undefined,
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
/** Ko‘rish/yordam sessiyasi: yozuv faol, muddati o‘tmagan, administrator ruxsati va kompaniya mavjud bo‘lishi shart. */
async function previewSession(req: AuthedRequest, res: Response, next: NextFunction, token: PreviewToken) {
  try {
    const db = await readDb();
    const record = db.previewSessions.find((p) => p.id === token.pid);
    const admin = db.users.find((u) => u.id === token.adminId && u.role === "SUPER_ADMIN");
    const company = db.companies.find((c) => c.id === token.companyId);
    const now = new Date().toISOString();
    const permission = token.mode === "SUPPORT" ? "companies.support" : "companies.preview";
    if (
      !record ||
      record.status !== "ACTIVE" ||
      record.expiresAt < now ||
      record.companyId !== token.companyId ||
      record.adminId !== token.adminId ||
      record.mode !== token.mode ||
      !admin ||
      admin.blockedAt ||
      !platformCan(admin.platformRole, permission) ||
      !company
    )
      return res.status(401).json({ code: "PREVIEW_ENDED", message: "Ko‘rish sessiyasi tugagan yoki bekor qilingan." });
    req.session = {
      userId: admin.id,
      companyId: company.id,
      name: token.mode === "SUPPORT" ? `${admin.name} (Staffora yordam)` : admin.name,
      email: admin.email,
      role: "COMPANY_OWNER",
      preview: { id: record.id, mode: record.mode, adminId: admin.id, companyName: company.name, expiresAt: record.expiresAt },
    };
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
