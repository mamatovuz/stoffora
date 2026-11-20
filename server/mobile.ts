import { randomInt, randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { checkLoginInput } from "../lib/staff-login";
import { credentialByLogin, normalizeLogin } from "../lib/staff-credentials";
import { desiredStaffRole, syncStaffRoles } from "../lib/staff-roles";
import { audit, readDb, updateDb } from "../lib/store";
import { can } from "../lib/permissions";
import { adaptProfile, assertConsistentSamples, faceMatchThreshold, isReplayedDescriptor, matchFace, matchPassPercent, matchPercent, verifyIdentity } from "../lib/face";
import { lookalikeAlert } from "./face-reference";
import type { Company, Database, Employee, MobileDevice, MobileSession, PanelSession, User } from "../lib/types";
import { MOBILE_ACCESS_TTL_SECONDS, requireEmployee, signMobileAccess, signSession, type AuthedRequest, type EmployeeSession, type Session } from "./auth";
import { signFaceProof } from "./face-proof";
import { describeFace } from "./face-server";
import {
  codeHash,
  consumeChallenge,
  issueChallenge,
  newActivationCode,
  newSecret,
  normalizeCode,
  normalizePublicKey,
  safeEqualHex,
  sha256,
  signedMessage,
  verifyDeviceSignature,
} from "./mobile-crypto";
import { sendTelegramMessage } from "./telegram";

/*
 * Native mobil ilova (iOS / Android) — o‘sha Staffora backend va o‘sha xodimlar bazasi.
 *
 * Kirish:          login (ozodbek@staffora.uz) + parol + qurilma kaliti imzosi (/mobile/auth/login);
 *                  eski ilovalar uchun bir martalik kod (Mini App’dan yoki HR’dan) — /mobile/activate
 * Rahbar rejimi:   xodim profili yo‘q direktor (panel foydalanuvchisi) — o‘z logini + panel paroli;
 *                  access token — panel sessiyasi (panel API’lari), refresh — qurilma imzosi bilan
 * Qoida:           bir xodim (rahbar) — bitta faol telefon; bitta telefon — bitta faol hisob
 * Yangi telefon:   Mini App’dan kod → yangi telefonda kiritiladi → darhol kiradi, eski telefon o‘chiriladi
 *                  (HR tasdig‘i yo‘q: davomat baribir Face ID bilan, kodni faqat Telegram egasi oladi)
 * Sessiya:         15 daqiqalik access token + almashadigan refresh token (qurilma imzosi bilan)
 * Chiqish (logout) qurilma bog‘lanishini O‘CHIRMAYDI — faqat sessiyani yopadi.
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number, code?: string) => Object.assign(new Error(message), { status, code });
/** Xato, lekin bazadagi o‘zgarish (audit, bekor qilish) saqlanishi kerak — updateDb’dan qaytariladi, keyin tashlanadi. */
type Failure = { failure: Error };
const fail = (message: string, status: number, code?: string): Failure => ({ failure: httpError(message, status, code) });
const unwrap = <T>(value: T | Failure): T => {
  if (value && typeof value === "object" && "failure" in value) throw (value as Failure).failure;
  return value as T;
};
const nameOf = (e?: Pick<Employee, "firstName" | "lastName">) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
const employeeSessionOf = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;

const REFRESH_TTL_MS = 30 * 86_400_000;
/** PIN tiklash kodlari (qurilma bo‘yicha, faqat xesh) — qisqa muddatli, xotirada. */
const pinCodes = new Map<string, { hash: string; expiresAt: number; attempts: number }>();
export const MINI_CODE_TTL_MS = 15 * 60_000;
export const HR_CODE_TTL_MS = 72 * 3_600_000;
const MAX_CODE_ATTEMPTS = 5;
/** Jonlilik (bosh burish): burilgan kadr to‘g‘ri kadrlardan kamida shuncha yaw farq qilishi kerak. */
export const TURN_MIN_YAW = 0.1;

const deviceSchema = z.object({
  publicKey: z.string().min(80).max(120),
  platform: z.enum(["ios", "android"]),
  model: z.string().trim().max(80).optional(),
  osVersion: z.string().trim().max(40).optional(),
  appVersion: z.string().trim().max(40).optional(),
});

/** Kirish natijasi: access + yangi refresh token (refresh xom holda faqat shu javobda). */
function issueSession(db: Database, device: MobileDevice) {
  const now = new Date();
  const refreshToken = newSecret(32);
  const session: MobileSession = {
    id: randomUUID(),
    companyId: device.companyId,
    employeeId: device.employeeId,
    ...(!device.employeeId && device.userId ? { userId: device.userId } : {}),
    deviceId: device.id,
    refreshHash: sha256(refreshToken),
    createdAt: now.toISOString(),
    lastUsedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + REFRESH_TTL_MS).toISOString(),
  };
  db.mobileSessions.push(session);
  return { session, refreshToken };
}
function tokens(employee: Employee, device: MobileDevice, session: MobileSession, refreshToken: string) {
  return {
    mode: "employee" as const,
    accessToken: signMobileAccess({ employeeId: employee.id, companyId: employee.companyId, telegramId: employee.telegramId || "", kind: "employee", msid: session.id, mdid: device.id }),
    accessExpiresIn: MOBILE_ACCESS_TTL_SECONDS,
    refreshToken,
    sessionId: session.id,
    deviceId: device.id,
    employee: { id: employee.id, firstName: employee.firstName, lastName: employee.lastName, companyId: employee.companyId },
  };
}
function revokeDevice(db: Database, device: MobileDevice, actor: string, reason: string) {
  const now = new Date().toISOString();
  device.status = "REVOKED";
  device.revokedAt = now;
  device.revokedBy = actor;
  device.revokeReason = reason;
  for (const s of db.mobileSessions) if (s.deviceId === device.id && !s.revokedAt) Object.assign(s, { revokedAt: now, revokeReason: reason });
  for (const t of db.mobilePushTokens) if (t.deviceId === device.id) t.active = false;
  // Shu telefondan ochilgan rahbar (panel) sessiyalari ham yopiladi.
  for (const s of db.panelSessions) if (!s.revokedAt && s.userAgent.startsWith(managerAgent(device.id))) s.revokedAt = now;
}
/** Rahbar sessiyasi qaysi telefonga tegishli ekanini bildiruvchi belgi (panel «Kirgan qurilmalar»da ko‘rinadi). */
export const managerAgent = (deviceId: string) => `Staffora mobil ilova · ${deviceId}`;
const MANAGER_ROLES = new Set(["COMPANY_OWNER", "HR_ADMIN", "HR_MANAGER", "BRANCH_MANAGER", "FINANCE", "IT_ADMIN"]);
/** Xodimning Telegram hisobi bilan bog‘langan panel hisobi (rahbar) — shu kompaniyada. */
export function managerUserOf(db: Database, employee: Employee): User | undefined {
  const telegram = employee.telegramId && !employee.telegramId.startsWith("dev") ? employee.telegramId : undefined;
  return db.users.find(
    (u) => u.companyId === employee.companyId && MANAGER_ROLES.has(u.role) && ((u.autoRole && u.employeeId === employee.id) || (telegram && u.telegramId === telegram)),
  );
}
const securityLog = (db: Database, companyId: string, actor: string, action: string, employeeId: string, meta?: Record<string, unknown>) =>
  db.auditLogs.unshift(audit(companyId, actor, action, "mobile-device", employeeId, undefined, meta));

/**
 * Rahbar rejimi tokenlari: access — panel sessiyasi JWT’si (panel API’larida Bearer), mobil sessiyaga
 * bog‘langan bitta PanelSession yozuvi (har refresh’da shu yozuv ishlatiladi; telefon bekor qilinsa yoki
 * chiqilsa — yopiladi). Panel «Kirgan qurilmalar»dan yopilsa — keyingi refresh rad etiladi.
 */
function managerTokens(db: Database, user: User, company: Pick<Company, "id" | "name">, device: MobileDevice, session: MobileSession, refreshToken: string, ip: string) {
  const now = new Date().toISOString();
  let row = session.panelSessionId ? db.panelSessions.find((s) => s.id === session.panelSessionId && !s.revokedAt) : undefined;
  if (row) row.lastSeenAt = now;
  else {
    row = { id: randomUUID(), userId: user.id, userAgent: `${managerAgent(device.id)} · ${device.model || device.platform}`.slice(0, 300), ip, createdAt: now, lastSeenAt: now };
    db.panelSessions.push(row);
    session.panelSessionId = row.id;
  }
  const panel: Session = { sid: row.id, userId: user.id, companyId: user.companyId, name: user.name, email: user.email, role: user.role };
  return {
    mode: "manager" as const,
    accessToken: signSession(panel, MOBILE_ACCESS_TTL_SECONDS),
    accessExpiresIn: MOBILE_ACCESS_TTL_SECONDS,
    refreshToken,
    sessionId: session.id,
    deviceId: device.id,
    user: { id: user.id, name: user.name, role: user.role, branchIds: user.branchIds || [], photoDataUrl: user.photoDataUrl },
    company: { id: company.id, name: company.name },
  };
}

type DeviceInput = z.infer<typeof deviceSchema>;
/** Qurilma kimniki: xodim yoki (xodim profili yo‘q) rahbar. */
type DeviceOwner = { kind: "employee"; employee: Employee } | { kind: "manager"; user: User };
const ownsDevice = (d: MobileDevice, owner: DeviceOwner) =>
  owner.kind === "employee" ? d.employeeId === owner.employee.id : !d.employeeId && d.userId === owner.user.id;

/**
 * Qurilmani hisobga bog‘lash — faollashtirish kodi va login uchun umumiy qoida (updateDb ichida):
 *  - shu hisobning o‘sha telefoni (qayta o‘rnatish/qayta kirish) — o‘sha qurilma yozuvi ishlatiladi;
 *  - telefonda boshqa hisob kirgan bo‘lsa — u shu telefondan chiqariladi (hisobi o‘zgarmaydi);
 *  - hisobning boshqa faol telefoni bo‘lsa — u o‘chiriladi, yangisi darhol ishlaydi (HR tasdig‘isiz).
 */
function bindDevice(db: Database, owner: DeviceOwner, key: { spki: string; fingerprint: string }, input: DeviceInput, actor: string) {
  const now = new Date().toISOString();
  const companyId = owner.kind === "employee" ? owner.employee.companyId : owner.user.companyId!;
  const keyOwner = db.mobileDevices.find((d) => d.keyFingerprint === key.fingerprint && d.status === "ACTIVE");
  if (keyOwner && ownsDevice(keyOwner, owner)) {
    keyOwner.lastSeenAt = now;
    keyOwner.appVersion = input.appVersion || keyOwner.appVersion;
    return { device: keyOwner, reused: true, replaced: 0 };
  }
  if (keyOwner) {
    revokeDevice(db, keyOwner, actor, "Telefonda boshqa xodim kirdi");
    securityLog(db, companyId, actor, "Telefonda avval boshqa xodim kirgan edi — u shu telefondan chiqarildi", keyOwner.employeeId || keyOwner.userId || "", {
      platform: input.platform,
      ...(owner.kind === "employee" ? { newEmployeeId: owner.employee.id } : { newUserId: owner.user.id }),
    });
  }
  if (owner.kind === "employee") for (const r of db.deviceChangeRequests) if (r.employeeId === owner.employee.id && r.status === "PENDING") r.status = "CANCELLED";
  const previous = db.mobileDevices.filter((d) => d.status === "ACTIVE" && ownsDevice(d, owner));
  for (const d of previous) revokeDevice(db, d, actor, "Yangi telefonga o‘tildi");
  if (previous.length && owner.kind === "employee")
    db.notifications.unshift({
      id: randomUUID(),
      companyId,
      employeeId: owner.employee.id,
      title: "Ilova yangi telefonda ulandi",
      body: `Staffora ilovasi ${input.model || input.platform} telefoniga ulandi. Eski telefondagi ilovadan chiqildi. Siz qilmagan bo‘lsangiz — HR’ga xabar bering.`,
      type: "SECURITY",
      read: false,
      createdAt: now,
    });
  const device: MobileDevice = {
    id: randomUUID(),
    companyId,
    employeeId: owner.kind === "employee" ? owner.employee.id : "",
    ...(owner.kind === "manager" ? { userId: owner.user.id } : {}),
    publicKey: key.spki,
    keyFingerprint: key.fingerprint,
    platform: input.platform,
    model: input.model,
    osVersion: input.osVersion,
    appVersion: input.appVersion,
    status: "ACTIVE",
    createdAt: now,
    lastSeenAt: now,
  };
  db.mobileDevices.push(device);
  return { device, reused: false, replaced: previous.length };
}

/* ------------------------------------------- login: urinishlar va 2FA --- */
/**
 * Xato urinishlar hisoblagichi: oynada `max` ta xato → `lockMs` qulf. Map qo‘shilish tartibida saqlanadi
 * (yangi oyna — oxiriga ko‘chadi), shuning uchun eskirganlari boshidan arzon tozalanadi (to‘liq aylanishsiz).
 */
function failureCounter(max: number, windowMs: number, lockMs: number) {
  const rows = new Map<string, { count: number; first: number; lockedUntil?: number }>();
  const prune = (now: number) => {
    for (const [key, row] of rows) {
      if (now - row.first <= windowMs + lockMs) break;
      rows.delete(key);
    }
    while (rows.size > 20_000) rows.delete(rows.keys().next().value as string);
  };
  return {
    /** Qulf qolgan vaqti (ms), qulf yo‘q bo‘lsa — 0. */
    remaining(key: string) {
      const row = rows.get(key);
      if (!row?.lockedUntil) return 0;
      const left = row.lockedUntil - Date.now();
      if (left > 0) return left;
      rows.delete(key);
      return 0;
    },
    /** Xatoni qayd etadi; aynan shu xatoda qulf tushgan bo‘lsa — true. */
    fail(key: string) {
      const now = Date.now();
      prune(now);
      let row = rows.get(key);
      if (!row || now - row.first > windowMs) {
        rows.delete(key);
        row = { count: 0, first: now };
      }
      row.count += 1;
      const lockedNow = row.count >= max && !row.lockedUntil;
      if (lockedNow) row.lockedUntil = now + lockMs;
      rows.set(key, row);
      return lockedNow;
    },
    clear: (key: string) => void rows.delete(key),
    reset: () => rows.clear(),
  };
}
/**
 * Parol tanlashga qarshi: (login + telefon kaliti) bo‘yicha 8 xato → 15 daqiqa qulf; login bo‘yicha umumiy
 * chegara (barcha telefonlardan) — 50 xato / 15 daqiqa. Hisobning o‘z ishonchli (faol) telefoni umumiy qulfdan
 * o‘tadi — begona odam boshqa telefondan ataylab xato yozib egasini qulflab qo‘ya olmaydi.
 */
export const LOGIN_MAX_FAILURES = 8;
export const LOGIN_GLOBAL_MAX_FAILURES = Number(process.env.MOBILE_LOGIN_GLOBAL_MAX_FAILURES) || 50;
const LOGIN_LOCK_MS = 15 * 60_000;
const loginPerDevice = failureCounter(LOGIN_MAX_FAILURES, LOGIN_LOCK_MS, LOGIN_LOCK_MS);
const loginPerAccount = failureCounter(LOGIN_GLOBAL_MAX_FAILURES, LOGIN_LOCK_MS, LOGIN_LOCK_MS);
/** 2FA: foydalanuvchi bo‘yicha 10 ta noto‘g‘ri kod (barcha telefonlardan) → 15 daqiqa qulf. */
const twoFactorFailures = failureCounter(10, LOGIN_LOCK_MS, LOGIN_LOCK_MS);
/** Testlar uchun: login qulflarini tozalash. */
export const resetLoginGuards = () => {
  loginPerDevice.reset();
  loginPerAccount.reset();
  twoFactorFailures.reset();
  twoFactorCodes.clear();
};
/** Mavjud bo‘lmagan login uchun ham bcrypt ishlaydi — javob vaqti bo‘yicha login borligini bilib bo‘lmasin. */
let dummyHash: Promise<string> | undefined;
const dummy = () => (dummyHash ||= bcrypt.hash("staffora-login-timing-guard", 12));

/** Rahbar Telegram 2FA: 5 xonali kod, 5 daqiqa, 5 urinish — foydalanuvchi + telefon kaliti bo‘yicha. */
const twoFactorCodes = new Map<string, { hash: string; expiresAt: number; attempts: number }>();
const twoFactorHash = (key: string, code: string) => sha256(`staffora-mobile-2fa:${key}:${code}`);

/** Bir martalik faollashtirish kodi yaratadi (eski faol kodlari bekor qilinadi). */
export function createActivationCode(db: Database, employee: Employee, source: "MINI_APP" | "HR", createdBy: string) {
  const now = new Date();
  for (const c of db.mobileActivationCodes) if (c.employeeId === employee.id && !c.usedAt && !c.revokedAt) c.revokedAt = now.toISOString();
  const code = newActivationCode();
  db.mobileActivationCodes.push({
    id: randomUUID(),
    companyId: employee.companyId,
    employeeId: employee.id,
    codeHash: codeHash(code),
    hint: code.slice(-2),
    source,
    createdBy,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (source === "HR" ? HR_CODE_TTL_MS : MINI_CODE_TTL_MS)).toISOString(),
    attempts: 0,
  });
  return { code, expiresAt: new Date(now.getTime() + (source === "HR" ? HR_CODE_TTL_MS : MINI_CODE_TTL_MS)).toISOString() };
}
export const activationLink = (code: string) => `staffora://activate?code=${encodeURIComponent(code)}`;

/* ===================================================== ochiq (sessiyasiz) === */
export function createMobilePublicRouter() {
  const router = Router();
  const strict = rateLimit({ windowMs: 60_000, limit: Number(process.env.MOBILE_ACTIVATION_RATE_LIMIT) || 10, standardHeaders: true, legacyHeaders: false, message: { message: "Juda ko‘p urinish. Bir daqiqadan keyin qayta urinib ko‘ring." } });
  const normal = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
  // Login: bitta IP’dan (ofis Wi‑Fi) bir nechta xodim kirishi mumkin — chegara kengroq; parol tanlashga qarshi — login qulfi.
  const loginLimit = rateLimit({
    windowMs: 60_000,
    limit: Number(process.env.MOBILE_LOGIN_RATE_LIMIT || process.env.MOBILE_ACTIVATION_RATE_LIMIT) || 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: "LOGIN_LOCKED", message: "Juda ko‘p urinish. Bir daqiqadan keyin qayta urinib ko‘ring." },
  });

  // Challenge arzon (xotiradagi nonce) va endi login uchun ham kerak — ofisdagi bitta IP’dan ko‘p xodim kiradi.
  const challengeLimit = rateLimit({
    windowMs: 60_000,
    limit: Number(process.env.MOBILE_CHALLENGE_RATE_LIMIT || process.env.MOBILE_ACTIVATION_RATE_LIMIT) || 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Juda ko‘p urinish. Bir daqiqadan keyin qayta urinib ko‘ring." },
  });
  /** Faollashtirish/login/holat uchun challenge — hali ro‘yxatdan o‘tmagan kalit uchun. */
  router.post(
    "/mobile/activation/challenge",
    challengeLimit,
    route(async (req, res) => {
      const { publicKey } = z.object({ publicKey: z.string().min(80).max(120) }).parse(req.body);
      const { fingerprint } = normalizePublicKey(publicKey);
      res.json(issueChallenge(fingerprint, "activate"));
    }),
  );

  /**
   * Faollashtirish: kod + qurilma kaliti + challenge imzosi.
   *  - kod: xeshi bo‘yicha, muddati, bir martalik, bekor qilinmagan, ≤5 urinish;
   *  - telefonda boshqa xodim kirgan bo‘lsa — u shu telefondan chiqariladi;
   *  - xodimning boshqa faol telefoni bo‘lsa — u o‘chiriladi, yangisi darhol ishlaydi.
   */
  router.post(
    "/mobile/activate",
    strict,
    route(async (req, res) => {
      const input = deviceSchema.extend({ code: z.string().min(8).max(20), nonce: z.string().min(10).max(80), signature: z.string().min(40).max(200) }).parse(req.body);
      const key = normalizePublicKey(input.publicKey);
      if (!consumeChallenge(input.nonce, key.fingerprint, "activate")) throw httpError("Tasdiqlash muddati tugadi — qayta urinib ko‘ring.", 401, "CHALLENGE");
      if (!verifyDeviceSignature(key.spki, signedMessage("activate", input.nonce, normalizeCode(input.code)), input.signature))
        throw httpError("Qurilma imzosi yaroqsiz.", 401, "SIGNATURE");
      const hash = codeHash(input.code);
      const result = unwrap(await updateDb((db) => {
        const now = new Date();
        const code = db.mobileActivationCodes.find((c) => c.codeHash === hash);
        if (!code) throw httpError("Kod noto‘g‘ri. Mini App yoki HR bergan kodni tekshiring.", 400, "CODE_INVALID");
        const employee = db.employees.find((e) => e.id === code.employeeId && e.companyId === code.companyId);
        if (code.usedAt) {
          securityLog(db, code.companyId, nameOf(employee), "Ishlatilgan faollashtirish kodi qayta kiritildi", code.employeeId, { platform: input.platform });
          return fail("Bu kod allaqachon ishlatilgan. Yangi kod oling.", 409, "CODE_USED");
        }
        if (code.revokedAt) throw httpError("Bu kod bekor qilingan. Yangi kod oling.", 409, "CODE_REVOKED");
        if (code.expiresAt < now.toISOString()) throw httpError("Kod muddati tugagan. Yangi kod oling.", 410, "CODE_EXPIRED");
        code.attempts += 1;
        if (code.attempts > MAX_CODE_ATTEMPTS) {
          code.revokedAt = now.toISOString();
          return fail("Urinishlar soni oshib ketdi — kod bekor qilindi. Yangi kod oling.", 429, "CODE_LOCKED");
        }
        if (!employee || employee.status !== "ACTIVE") throw httpError("Xodim profili faol emas. HR bilan bog‘laning.", 403, "EMPLOYEE_INACTIVE");
        const company = db.companies.find((c) => c.id === employee.companyId);
        if (company?.status === "SUSPENDED") throw httpError("Kompaniya hisobi to‘xtatilgan.", 403, "COMPANY_SUSPENDED");

        code.usedAt = now.toISOString();
        // Yangi telefon: HR so‘rovisiz — kod Telegram orqali xodimning o‘ziga berilgan. Eski telefon o‘chiriladi;
        // telefonda boshqa xodim kirgan bo‘lsa — u shu telefondan chiqariladi. Davomat baribir Face ID bilan.
        const { device, reused } = bindDevice(db, { kind: "employee", employee }, key, input, nameOf(employee));
        const { session, refreshToken } = issueSession(db, device);
        if (reused) securityLog(db, employee.companyId, nameOf(employee), "Mobil ilovaga qayta kirildi (o‘sha qurilma)", employee.id, { platform: device.platform });
        else securityLog(db, employee.companyId, nameOf(employee), "Mobil ilova faollashtirildi (ishonchli qurilma)", employee.id, { platform: device.platform, model: device.model, source: code.source });
        return { kind: "session" as const, out: tokens(employee, device, session, refreshToken) };
      }));
      res.status(201).json(result.out);
    }),
  );

  /**
   * Login + parol bilan kirish (barcha xodimlar va rahbarlar uchun yagona yo‘l):
   *   login = <nom>@staffora.uz, parol — xodimniki (staffCredentials) yoki direktorniki (panel paroli);
   *   telefon kaliti /mobile/activation/challenge nonce’ini imzolaydi: "staffora:login:<nonce>:<login>".
   * Xodim — xodim sessiyasi (check-in/out); xodim profili yo‘q rahbar — rahbar sessiyasi (faqat panel).
   * Qurilma qoidasi /mobile/activate bilan bir xil (bitta hisob — bitta faol telefon).
   * Himoya: IP chegarasi; login+telefon bo‘yicha 8 xato → 15 daqiqa qulf; login bo‘yicha umumiy 50 xato (faol telefon
   * bundan mustasno); Telegram 2FA yoqilgan rahbarga 5 xonali kod (foydalanuvchi bo‘yicha 10 xato → qulf).
   */
  router.post(
    "/mobile/auth/login",
    loginLimit,
    route(async (req, res) => {
      const input = deviceSchema
        .extend({
          login: z.string().max(120),
          password: z.string().max(200),
          nonce: z.string().min(10).max(80),
          signature: z.string().min(40).max(200),
          code: z.string().trim().max(12).optional(),
        })
        .parse(req.body);
      const check = checkLoginInput(input.login);
      if (!check.ok) throw httpError(check.error, 400, "LOGIN_INVALID");
      const login = check.login;
      const key = normalizePublicKey(input.publicKey);
      if (!consumeChallenge(input.nonce, key.fingerprint, "activate")) throw httpError("Tasdiqlash muddati tugadi — qayta urinib ko‘ring.", 401, "CHALLENGE");
      const typed = input.login.trim().toLowerCase();
      const signed = [typed, login].some((context) => verifyDeviceSignature(key.spki, signedMessage("login", input.nonce, context), input.signature));
      if (!signed) throw httpError("Qurilma imzosi yaroqsiz.", 401, "SIGNATURE");
      const lockedText = (ms: number) => `Juda ko‘p noto‘g‘ri urinish. ${Math.ceil(ms / 60_000)} daqiqadan keyin qayta urinib ko‘ring.`;
      const deviceKey = `${login}|${key.fingerprint}`;
      const deviceLocked = loginPerDevice.remaining(deviceKey);
      if (deviceLocked) throw httpError(lockedText(deviceLocked), 429, "LOGIN_LOCKED");

      const db = await readDb();
      const credential = credentialByLogin(db, login);
      const panelUser = credential ? undefined : db.users.find((u) => u.role !== "SUPER_ADMIN" && u.mobileLogin && normalizeLogin(u.mobileLogin) === login);
      // Shu hisobning hozir faol telefoni — umumiy (login bo‘yicha) qulf unga ta’sir qilmaydi.
      const trusted = db.mobileDevices.some(
        (d) =>
          d.keyFingerprint === key.fingerprint &&
          d.status === "ACTIVE" &&
          (credential
            ? d.employeeId === credential.employeeId
            : Boolean(panelUser && ((!d.employeeId && d.userId === panelUser.id) || (panelUser.employeeId && d.employeeId === panelUser.employeeId)))),
      );
      const accountLocked = loginPerAccount.remaining(login);
      if (accountLocked && !trusted) throw httpError(lockedText(accountLocked), 429, "LOGIN_LOCKED");
      const hash = credential?.passwordHash || panelUser?.passwordHash;
      const ok = hash && input.password ? await bcrypt.compare(input.password, hash) : (await bcrypt.compare(input.password || "x", await dummy()), false);
      if (!ok) {
        const lockedDevice = loginPerDevice.fail(deviceKey);
        const lockedAccount = loginPerAccount.fail(login);
        if ((lockedDevice || lockedAccount) && (credential || panelUser))
          await updateDb((next) =>
            securityLog(
              next,
              credential?.companyId || panelUser!.companyId || "",
              "Tizim",
              lockedAccount
                ? `Ilovaga kirish ${LOGIN_GLOBAL_MAX_FAILURES} marta noto‘g‘ri parol bilan urinildi — login boshqa telefonlar uchun 15 daqiqaga qulflandi`
                : `Ilovaga bitta telefondan ${LOGIN_MAX_FAILURES} marta noto‘g‘ri parol bilan urinildi — o‘sha telefon 15 daqiqaga qulflandi`,
              credential?.employeeId || panelUser!.id,
              { login, platform: input.platform, model: input.model },
            ),
          ).catch(() => undefined);
        throw httpError("Login yoki parol noto‘g‘ri.", 401, "LOGIN_FAILED");
      }

      // Kim sifatida kiradi: xodim logini → xodim; direktor logini — xodimga bog‘langan bo‘lsa o‘sha xodim, aks holda rahbar.
      const telegramOf = (u: User) => (u.telegramId && !u.telegramId.startsWith("dev") ? u.telegramId : undefined);
      let employee = credential ? db.employees.find((e) => e.id === credential.employeeId && e.companyId === credential.companyId) : undefined;
      if (panelUser) {
        if (panelUser.blockedAt) throw httpError("Hisobingiz bloklangan. Administratorga murojaat qiling.", 403, "ACCOUNT_BLOCKED");
        employee = db.employees.find(
          (e) => e.companyId === panelUser.companyId && e.status === "ACTIVE" && (e.id === panelUser.employeeId || (telegramOf(panelUser) && e.telegramId === telegramOf(panelUser))),
        );
        if (!employee && !MANAGER_ROLES.has(panelUser.role)) throw httpError("Bu hisob bilan ilovaga kirib bo‘lmaydi.", 403, "NOT_MANAGER");
      }
      if (credential && (!employee || employee.status !== "ACTIVE")) throw httpError("Xodim profili faol emas. HR bilan bog‘laning.", 403, "EMPLOYEE_INACTIVE");
      const companyId = employee?.companyId || panelUser?.companyId;
      const company = db.companies.find((c) => c.id === companyId);
      if (!company) throw httpError("Kompaniya topilmadi.", 403, "COMPANY_SUSPENDED");
      if (company.status === "SUSPENDED") throw httpError("Kompaniya hisobi to‘xtatilgan.", 403, "COMPANY_SUSPENDED");

      // Telegram 2FA: panel hisobida yoqilgan bo‘lsa (direktor yoki xodimga bog‘langan rahbar) — kod bilan.
      const secondFactor = panelUser || (employee ? managerUserOf(db, employee) : undefined);
      if (secondFactor?.twoFactorEnabled && !secondFactor.blockedAt) {
        // Kod rahbarning Telegram’iga (bo‘lmasa — xodimning o‘z Telegram’iga) boradi; hech biri bo‘lmasa — 2FA o‘tkazib yuborilmaydi.
        const target = telegramOf(secondFactor) || (employee?.telegramId && !employee.telegramId.startsWith("dev") ? employee.telegramId : undefined);
        if (!target)
          throw httpError("Ikki bosqichli kirish yoqilgan, lekin Telegram ulanmagan. Panelda Telegram’ni ulang yoki administratorga murojaat qiling.", 403, "TWO_FACTOR_UNAVAILABLE");
        const codeLocked = twoFactorFailures.remaining(secondFactor.id);
        if (codeLocked) throw httpError(`Juda ko‘p noto‘g‘ri kod. ${Math.ceil(codeLocked / 60_000)} daqiqadan keyin qayta urinib ko‘ring.`, 429, "CODE_LOCKED");
        const slot = `${secondFactor.id}:${key.fingerprint}`;
        if (!input.code) {
          const code = String(randomInt(0, 100_000)).padStart(5, "0");
          if (twoFactorCodes.size > 1000) for (const [k, v] of twoFactorCodes) if (v.expiresAt < Date.now()) twoFactorCodes.delete(k);
          twoFactorCodes.set(slot, { hash: twoFactorHash(slot, code), expiresAt: Date.now() + 5 * 60_000, attempts: 0 });
          const sent = await sendTelegramMessage(
            target,
            `🔐 Staffora ilovasiga kirish kodi: <code>${code}</code>\n\nKod 5 daqiqa amal qiladi. Uni hech kimga bermang.\nKirishga siz urinmagan bo‘lsangiz — darhol parolingizni o‘zgartiring.`,
          ).catch(() => false);
          if (!sent) {
            twoFactorCodes.delete(slot);
            throw httpError("Tasdiqlash kodini Telegram’ga yuborib bo‘lmadi. Keyinroq urinib ko‘ring.", 503, "CODE_NOT_SENT");
          }
          return res.json({ requires2fa: true, message: "Telegram’ga 5 xonali kod yuborildi. Kodni kiriting." });
        }
        const row = twoFactorCodes.get(slot);
        if (!row || row.expiresAt < Date.now()) {
          twoFactorCodes.delete(slot);
          throw httpError("Kod muddati tugagan. Qaytadan kiring.", 410, "CODE_EXPIRED");
        }
        row.attempts += 1;
        if (row.attempts > 5) {
          twoFactorCodes.delete(slot);
          throw httpError("Juda ko‘p noto‘g‘ri urinish. Qaytadan kiring.", 429, "CODE_LOCKED");
        }
        if (!safeEqualHex(row.hash, twoFactorHash(slot, input.code.replace(/\D/g, "")))) {
          if (twoFactorFailures.fail(secondFactor.id)) twoFactorCodes.delete(slot);
          throw httpError(`Kod noto‘g‘ri. Yana ${5 - row.attempts} ta urinish qoldi.`, 400, "CODE_INVALID");
        }
        twoFactorCodes.delete(slot);
        twoFactorFailures.clear(secondFactor.id);
      }
      loginPerDevice.clear(deviceKey);
      loginPerAccount.clear(login);

      const ip = String(req.ip || "").replace(/^::ffff:/, "");
      const out = await updateDb((next) => {
        if (employee) {
          const fresh = next.employees.find((e) => e.id === employee!.id && e.companyId === employee!.companyId && e.status === "ACTIVE");
          if (!fresh) throw httpError("Xodim profili faol emas. HR bilan bog‘laning.", 403, "EMPLOYEE_INACTIVE");
          const { device, reused } = bindDevice(next, { kind: "employee", employee: fresh }, key, input, nameOf(fresh));
          const { session, refreshToken } = issueSession(next, device);
          securityLog(next, fresh.companyId, nameOf(fresh), reused ? "Mobil ilovaga login bilan qayta kirildi (o‘sha qurilma)" : "Mobil ilovaga login bilan kirildi (ishonchli qurilma)", fresh.id, {
            platform: device.platform,
            model: device.model,
          });
          return tokens(fresh, device, session, refreshToken);
        }
        const user = next.users.find((u) => u.id === panelUser!.id);
        const freshCompany = user && next.companies.find((c) => c.id === user.companyId);
        if (!user || user.blockedAt) throw httpError("Hisobingiz bloklangan. Administratorga murojaat qiling.", 403, "ACCOUNT_BLOCKED");
        if (!freshCompany || freshCompany.status === "SUSPENDED") throw httpError("Kompaniya hisobi to‘xtatilgan.", 403, "COMPANY_SUSPENDED");
        const { device } = bindDevice(next, { kind: "manager", user }, key, input, user.name);
        const { session, refreshToken } = issueSession(next, device);
        user.lastLoginAt = new Date().toISOString();
        next.auditLogs.unshift(audit(freshCompany.id, user.name, "Rahbar mobil ilovaga login bilan kirdi", "user", user.id, undefined, { deviceId: device.id, platform: device.platform }));
        return managerTokens(next, user, freshCompany, device, session, refreshToken, ip);
      });
      res.status(201).json(out);
    }),
  );

  /** Eski (HR tasdig‘ini kutayotgan) almashtirish so‘rovlari holati — eski ilova versiyalari uchun saqlanadi. */
  router.post(
    "/mobile/activation/status",
    normal,
    route(async (req, res) => {
      const input = z.object({ requestId: z.string().uuid(), publicKey: z.string().min(80).max(120), nonce: z.string().min(10).max(80), signature: z.string().min(40).max(200) }).parse(req.body);
      const key = normalizePublicKey(input.publicKey);
      if (!consumeChallenge(input.nonce, key.fingerprint, "activate")) throw httpError("Tasdiqlash muddati tugadi.", 401, "CHALLENGE");
      if (!verifyDeviceSignature(key.spki, signedMessage("status", input.nonce, input.requestId), input.signature)) throw httpError("Qurilma imzosi yaroqsiz.", 401, "SIGNATURE");
      const result = await updateDb((db) => {
        const request = db.deviceChangeRequests.find((r) => r.id === input.requestId && r.keyFingerprint === key.fingerprint);
        if (!request) throw httpError("So‘rov topilmadi.", 404);
        if (request.status !== "APPROVED") return { status: request.status };
        const device = db.mobileDevices.find((d) => d.id === request.newDeviceId && d.status === "ACTIVE");
        const employee = db.employees.find((e) => e.id === request.employeeId && e.status === "ACTIVE");
        if (!device || !employee) return { status: "REJECTED" };
        // Tasdiqlangandan keyin sessiya faqat bir marta beriladi (so‘rov qayta ishlatilmaydi).
        if (db.mobileSessions.some((s) => s.deviceId === device.id)) throw httpError("Bu so‘rov bo‘yicha kirish allaqachon berilgan.", 409, "ALREADY_ISSUED");
        const { session, refreshToken } = issueSession(db, device);
        return { status: "APPROVED", ...tokens(employee, device, session, refreshToken) };
      });
      res.json(result);
    }),
  );

  /** Sessiyani yangilash uchun challenge (ro‘yxatdagi qurilma). */
  router.post(
    "/mobile/auth/challenge",
    normal,
    route(async (req, res) => {
      const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(req.body);
      const db = await readDb();
      const device = db.mobileDevices.find((d) => d.id === deviceId);
      if (!device || device.status !== "ACTIVE") throw httpError("Bu qurilma endi ishonchli emas. Ilovani qayta faollashtiring.", 401, "DEVICE_REVOKED");
      res.json(issueChallenge(device.keyFingerprint, "refresh"));
    }),
  );

  /** Refresh: eski refresh token + qurilma imzosi → yangi juftlik (rotatsiya; qayta ishlatish — sessiya yopiladi). */
  router.post(
    "/mobile/auth/refresh",
    normal,
    route(async (req, res) => {
      const input = z.object({ sessionId: z.string().uuid(), refreshToken: z.string().min(20).max(120), nonce: z.string().min(10).max(80), signature: z.string().min(40).max(200) }).parse(req.body);
      const out = unwrap(await updateDb((db) => {
        const session = db.mobileSessions.find((s) => s.id === input.sessionId);
        const device = session && db.mobileDevices.find((d) => d.id === session.deviceId);
        if (!session || !device) throw httpError("Sessiya topilmadi. Qayta faollashtiring.", 401, "SESSION_INVALID");
        if (!consumeChallenge(input.nonce, device.keyFingerprint, "refresh")) throw httpError("Tasdiqlash muddati tugadi.", 401, "CHALLENGE");
        if (!verifyDeviceSignature(device.publicKey, signedMessage("refresh", input.nonce, session.id), input.signature)) throw httpError("Qurilma imzosi yaroqsiz.", 401, "SIGNATURE");
        if (session.revokedAt || device.status !== "ACTIVE") throw httpError("Bu qurilma endi ishonchli emas.", 401, "DEVICE_REVOKED");
        const hash = sha256(input.refreshToken);
        if (session.prevRefreshHash === hash) {
          // Oldingi (almashtirilgan) token qayta keldi — o‘g‘irlangan bo‘lishi mumkin: sessiya yopiladi.
          session.revokedAt = new Date().toISOString();
          session.revokeReason = "Refresh token qayta ishlatildi";
          securityLog(db, session.companyId, "Tizim", "Refresh token qayta ishlatildi — sessiya yopildi", session.employeeId, { deviceId: device.id });
          return fail("Sessiya xavfsizlik uchun yopildi. Qayta kiring.", 401, "SESSION_REUSED");
        }
        if (session.refreshHash !== hash) throw httpError("Sessiya yaroqsiz.", 401, "SESSION_INVALID");
        if (session.expiresAt < new Date().toISOString()) throw httpError("Sessiya muddati tugagan. Qayta kiring.", 401, "SESSION_EXPIRED");
        const rotate = () => {
          const refreshToken = newSecret(32);
          const now = new Date();
          session.prevRefreshHash = session.refreshHash;
          session.refreshHash = sha256(refreshToken);
          session.lastUsedAt = now.toISOString();
          session.expiresAt = new Date(now.getTime() + REFRESH_TTL_MS).toISOString();
          device.lastSeenAt = now.toISOString();
          return refreshToken;
        };
        // Rahbar rejimi (xodim profili yo‘q direktor): panel hisobi va panel sessiyasi tekshiriladi.
        if (!session.employeeId && session.userId) {
          const close = (reason: string) => Object.assign(session, { revokedAt: new Date().toISOString(), revokeReason: reason });
          const user = db.users.find((u) => u.id === session.userId);
          if (!user) {
            close("Foydalanuvchi o‘chirilgan");
            return fail("Sessiya topilmadi. Qayta kiring.", 401, "SESSION_INVALID");
          }
          if (user.blockedAt) {
            close("Hisob bloklangan");
            return fail("Hisobingiz bloklangan. Administratorga murojaat qiling.", 403, "ACCOUNT_BLOCKED");
          }
          const company = db.companies.find((c) => c.id === user.companyId);
          if (!MANAGER_ROLES.has(user.role) || !company) throw httpError("Rahbar huquqi topilmadi.", 403, "NOT_MANAGER");
          if (company.status === "SUSPENDED") throw httpError("Kompaniya hisobi to‘xtatilgan.", 403, "COMPANY_SUSPENDED");
          const panel = session.panelSessionId ? db.panelSessions.find((s) => s.id === session.panelSessionId) : undefined;
          if (!panel || panel.revokedAt) {
            close("Panel sessiyasi yopilgan");
            return fail("Bu qurilmadan chiqarildingiz. Qayta kiring.", 401, "SESSION_INVALID");
          }
          return managerTokens(db, user, company, device, session, rotate(), String(req.ip || "").replace(/^::ffff:/, ""));
        }
        const employee = db.employees.find((e) => e.id === session.employeeId && e.status === "ACTIVE");
        if (!employee) throw httpError("Xodim profili faol emas.", 403, "EMPLOYEE_INACTIVE");
        return tokens(employee, device, session, rotate());
      }));
      res.json(out);
    }),
  );

  /** Chiqish — faqat sessiya yopiladi; qurilma bog‘lanishi saqlanadi (boshqa xodim kira olmaydi). */
  router.post(
    "/mobile/auth/logout",
    normal,
    route(async (req, res) => {
      const { sessionId, refreshToken } = z.object({ sessionId: z.string().uuid(), refreshToken: z.string().min(20).max(120) }).parse(req.body);
      await updateDb((db) => {
        const session = db.mobileSessions.find((s) => s.id === sessionId && s.refreshHash === sha256(refreshToken));
        if (session && !session.revokedAt) Object.assign(session, { revokedAt: new Date().toISOString(), revokeReason: "Chiqish" });
        // Rahbar rejimi: unga bog‘langan panel sessiyasi ham yopiladi (access token darhol ishlamay qoladi).
        const panel = session?.panelSessionId ? db.panelSessions.find((s) => s.id === session.panelSessionId) : undefined;
        if (panel && !panel.revokedAt) panel.revokedAt = new Date().toISOString();
      });
      res.json({ ok: true });
    }),
  );
  return router;
}

/* =========================================== mobil (sessiya bilan) === */
export function createMobileRouter() {
  const router = Router();
  const mobileOnly = (req: Request, res: Response, next: NextFunction) =>
    employeeSessionOf(req).mdid ? next() : res.status(403).json({ message: "Faqat mobil ilova uchun." });
  const faceLimit = rateLimit({
    windowMs: 60_000,
    limit: 90,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `mface:${employeeSessionOf(req)?.employeeId || req.ip}`,
    message: { message: "Juda ko‘p urinish. Biroz kuting." },
  });
  router.use("/mobile/me", requireEmployee, mobileOnly);
  router.use("/mobile/push-token", requireEmployee, mobileOnly);
  router.use("/mobile/face", requireEmployee, mobileOnly);
  router.use("/mobile/manager", requireEmployee, mobileOnly);
  router.use("/mobile/pin", requireEmployee, mobileOnly);

  /**
   * «PIN-kodni unutdingizmi?»: 5 xonali bir martalik kod Telegram (Mini App boti) va bildirishnoma
   * orqali yuboriladi. Kod faqat shu telefon uchun, 10 daqiqa, 5 urinish. PIN’ning o‘zi serverga
   * yuborilmaydi — u faqat telefonda (Keychain/Keystore) xeshlangan holda saqlanadi.
   */
  router.post(
    "/mobile/pin/reset-code",
    rateLimit({ windowMs: 10 * 60_000, limit: 3, keyGenerator: (req) => `mpin:${employeeSessionOf(req)?.mdid || req.ip}`, message: { message: "Kod juda ko‘p so‘raldi. 10 daqiqadan keyin urinib ko‘ring." } }),
    route(async (req, res) => {
      const auth = employeeSessionOf(req);
      const code = String(randomInt(0, 100_000)).padStart(5, "0");
      pinCodes.set(auth.mdid!, { hash: sha256(`staffora-pin-reset:${auth.mdid}:${code}`), expiresAt: Date.now() + 10 * 60_000, attempts: 0 });
      const out = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId);
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        db.notifications.unshift({
          id: randomUUID(),
          companyId: employee.companyId,
          employeeId: employee.id,
          title: "PIN-kodni tiklash",
          body: `Staffora ilovasi PIN-kodini tiklash kodi: ${code}. 10 daqiqa amal qiladi. Siz so‘ramagan bo‘lsangiz — e’tibor bermang.`,
          type: "SECURITY",
          read: false,
          createdAt: new Date().toISOString(),
          // Push sifatida yuborilmaydi: kod qulflangan telefonning ekraniga chiqmasin.
          pushedAt: new Date().toISOString(),
        });
        securityLog(db, employee.companyId, nameOf(employee), "Ilova PIN-kodini tiklash kodi so‘raldi", employee.id, { deviceId: auth.mdid });
        return { telegramId: employee.telegramConnected ? employee.telegramId : undefined, name: employee.firstName };
      });
      let sentToTelegram = false;
      if (out.telegramId && !out.telegramId.startsWith("dev"))
        sentToTelegram = await sendTelegramMessage(
          out.telegramId,
          `🔐 <b>Staffora ilovasi</b>

${out.name}, PIN-kodni tiklash kodi:

<code>${code}</code>

10 daqiqa amal qiladi. Siz so‘ramagan bo‘lsangiz — e’tibor bermang va kodni hech kimga bermang.`,
        )
          .then(() => true)
          .catch(() => false);
      res.json({ ok: true, sentToTelegram });
    }),
  );
  router.post(
    "/mobile/pin/reset-verify",
    rateLimit({ windowMs: 10 * 60_000, limit: 10, keyGenerator: (req) => `mpinv:${employeeSessionOf(req)?.mdid || req.ip}` }),
    route(async (req, res) => {
      const auth = employeeSessionOf(req);
      const { code } = z.object({ code: z.string().regex(/^\d{5}$/, "5 xonali kodni kiriting.") }).parse(req.body);
      const row = pinCodes.get(auth.mdid!);
      if (!row || row.expiresAt < Date.now()) throw httpError("Kod muddati tugagan. Yangi kod so‘rang.", 410, "PIN_CODE_EXPIRED");
      row.attempts += 1;
      if (row.attempts > 5) {
        pinCodes.delete(auth.mdid!);
        throw httpError("Urinishlar soni tugadi. Yangi kod so‘rang.", 429, "PIN_CODE_LOCKED");
      }
      if (row.hash !== sha256(`staffora-pin-reset:${auth.mdid}:${code}`)) throw httpError("Kod noto‘g‘ri.", 400, "PIN_CODE_INVALID");
      pinCodes.delete(auth.mdid!);
      await updateDb((db) => securityLog(db, auth.companyId, "Xodim", "Ilova PIN-kodi tiklandi", auth.employeeId, { deviceId: auth.mdid }));
      res.json({ ok: true });
    }),
  );

  /** Bu xodim rahbarmi (panel hisobi Telegram orqali bog‘langan) — «Rahbar» bo‘limini ko‘rsatish uchun. */
  router.get(
    "/mobile/manager/check",
    route(async (req, res) => {
      const auth = employeeSessionOf(req);
      const db = await readDb();
      const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId && e.status === "ACTIVE");
      let user = employee && managerUserOf(db, employee);
      // Lavozim/filial orqali huquq berilgan, lekin hisob hali ochilmagan — moslab olamiz.
      if (employee && !user && desiredStaffRole(db, employee))
        user = await updateDb((next) => {
          syncStaffRoles(next, employee.companyId);
          const fresh = next.employees.find((e) => e.id === employee.id);
          return fresh ? managerUserOf(next, fresh) : undefined;
        });
      res.json({ allowed: Boolean(user), role: user?.role });
    }),
  );
  /**
   * Rahbar sessiyasi: ishonchli telefon + bog‘langan panel hisobi. Panelning o‘z API’lari ishlatiladi
   * (huquq, filial chegarasi, audit — paneldagidek). Sessiya «Kirgan qurilmalar»da ko‘rinadi va
   * telefon bekor qilinsa avtomatik yopiladi.
   */
  router.post(
    "/mobile/manager/session",
    rateLimit({ windowMs: 60_000, limit: 20, keyGenerator: (req) => `mmgr:${employeeSessionOf(req)?.employeeId || req.ip}` }),
    route(async (req, res) => {
      const auth = employeeSessionOf(req);
      const out = await updateDb((db) => {
        syncStaffRoles(db, auth.companyId);
        const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId && e.status === "ACTIVE");
        const user = employee && managerUserOf(db, employee);
        const company = user && db.companies.find((c) => c.id === user.companyId);
        if (!employee || !user || !company || company.status === "SUSPENDED") throw httpError("Rahbar huquqi topilmadi.", 403, "NOT_MANAGER");
        const now = new Date().toISOString();
        const agent = managerAgent(auth.mdid!);
        for (const s of db.panelSessions) if (s.userId === user.id && !s.revokedAt && s.userAgent.startsWith(agent)) s.revokedAt = now;
        const device = db.mobileDevices.find((d) => d.id === auth.mdid);
        const row: PanelSession = {
          id: randomUUID(),
          userId: user.id,
          userAgent: `${agent} · ${device?.model || device?.platform || ""}`.trim(),
          ip: String(req.ip || "").replace(/^::ffff:/, ""),
          createdAt: now,
          lastSeenAt: now,
        };
        db.panelSessions.push(row);
        db.auditLogs.unshift(audit(user.companyId!, user.name, "Rahbar mobil ilova orqali kirdi", "user", user.id, undefined, { deviceId: auth.mdid }));
        const session: Session = { sid: row.id, userId: user.id, companyId: user.companyId, name: user.name, email: user.email, role: user.role };
        return {
          token: signSession(session),
          user: { id: user.id, name: user.name, role: user.role, branchIds: user.branchIds || [], photoDataUrl: user.photoDataUrl },
          company: { id: company.id, name: company.name },
        };
      });
      res.json(out);
    }),
  );

  router.get(
    "/mobile/me",
    route(async (req, res) => {
      const auth = employeeSessionOf(req);
      const db = await readDb();
      const device = db.mobileDevices.find((d) => d.id === auth.mdid);
      const push = db.mobilePushTokens.find((t) => t.deviceId === auth.mdid && t.active);
      res.json({
        device: device && { id: device.id, platform: device.platform, model: device.model, status: device.status, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt },
        push: Boolean(push),
        faceEnrolled: db.faceProfiles.some((p) => p.employeeId === auth.employeeId),
        passPercent: matchPassPercent(faceMatchThreshold()),
      });
    }),
  );

  router.post(
    "/mobile/push-token",
    route(async (req, res) => {
      const auth = employeeSessionOf(req);
      const input = z.object({ token: z.string().min(10).max(300).regex(/^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/), platform: z.enum(["ios", "android"]) }).parse(req.body);
      await updateDb((db) => {
        const now = new Date().toISOString();
        // Token boshqa qurilma/xodimga yozilgan bo‘lsa (qayta o‘rnatish) — o‘sha yozuv o‘chadi.
        for (const t of db.mobilePushTokens) if (t.token === input.token && t.deviceId !== auth.mdid) t.active = false;
        // Token aylanishi: shu qurilmaning eski tokenlari o‘chadi.
        for (const t of db.mobilePushTokens) if (t.deviceId === auth.mdid && t.token !== input.token) t.active = false;
        const existing = db.mobilePushTokens.find((t) => t.deviceId === auth.mdid && t.token === input.token);
        if (existing) Object.assign(existing, { active: true, updatedAt: now, lastSeenAt: now, lastError: undefined });
        else
          db.mobilePushTokens.push({
            id: randomUUID(),
            companyId: auth.companyId,
            employeeId: auth.employeeId,
            deviceId: auth.mdid!,
            provider: "expo",
            token: input.token,
            platform: input.platform,
            active: true,
            createdAt: now,
            updatedAt: now,
            lastSeenAt: now,
          });
      });
      res.json({ ok: true });
    }),
  );
  router.delete(
    "/mobile/push-token",
    route(async (req, res) => {
      const auth = employeeSessionOf(req);
      await updateDb((db) => {
        for (const t of db.mobilePushTokens) if (t.deviceId === auth.mdid) t.active = false;
      });
      res.json({ ok: true });
    }),
  );

  /**
   * Jonli tekshiruv (ramka rangi va foiz uchun): kadrdagi yuzni topadi va profil bilan
   * solishtiradi. Tasdiq (proof) BERILMAYDI — faqat ko‘rsatkich.
   */
  router.post(
    "/mobile/face/check",
    faceLimit,
    route(async (req, res) => {
      const auth = employeeSessionOf(req);
      const { photo } = z.object({ photo: z.string().min(100).max(300_000) }).parse(req.body);
      const [face, db] = await Promise.all([describeFace(photo), readDb()]);
      if (!face) return res.json({ face: null, percent: null, passPercent: matchPassPercent() });
      const profile = db.faceProfiles.find((p) => p.employeeId === auth.employeeId && p.companyId === auth.companyId);
      const match = profile ? matchFace(profile, face.descriptor) : null;
      res.json({
        face: { box: face.box, yaw: face.yaw, roll: face.roll, light: Math.round(face.light), score: face.score },
        percent: match ? matchPercent(match.distance) : null,
        passPercent: matchPassPercent(),
        enrolled: Boolean(profile),
      });
    }),
  );

  /**
   * Yakuniy Face ID: 2–3 kadr (bir necha yuz millisoniya oralig‘ida). Har biri profilga mos
   * bo‘lishi, kadrlar aynan bir xil bo‘lmasligi (qotgan rasm emas) va avvalgi so‘rovning
   * takrori bo‘lmasligi kerak. Muvaffaqiyatda — davomat sessiyasi uchun 3 daqiqalik dalil.
   */
  router.post(
    "/mobile/face/verify",
    faceLimit,
    route(async (req, res) => {
      const auth = employeeSessionOf(req);
      const { photos, liveness } = z
        .object({
          photos: z.array(z.string().min(100).max(300_000)).min(2).max(3),
          /**
           * «turn» — kadrlardan biri bosh biroz burilgan holatda. Tekis rasm (qog‘oz yoki ekran) burilganda
           * burunning ko‘zlarga nisbatan joyi (yaw) deyarli o‘zgarmaydi, haqiqiy yuzda esa aniq o‘zgaradi.
           * Maydonsiz so‘rov — eski ilova versiyalari (avvalgi tekshiruv).
           */
          liveness: z.enum(["turn"]).optional(),
        })
        .parse(req.body);
      const found = await Promise.all(photos.map((p) => describeFace(p)));
      if (found.some((f) => !f)) throw httpError("Kadrlarda yuz aniq ko‘rinmadi. Kameraga to‘g‘ri qarang.", 422, "NO_FACE");
      const faces = found.map((f) => f!);
      // Burilgan kadr — o‘rtacha yo‘nalishdan eng uzoq; qolganlari (to‘g‘ri qaragan) shaxsni tasdiqlaydi.
      let turned: (typeof faces)[number] | undefined;
      let frontal = faces;
      if (liveness === "turn") {
        const byTurn = [...faces].sort((a, b) => Math.abs(b.yaw - faces[0].yaw) - Math.abs(a.yaw - faces[0].yaw));
        turned = byTurn[0] === faces[0] ? faces[faces.length - 1] : byTurn[0];
        frontal = faces.filter((f) => f !== turned);
        const baseYaw = frontal.reduce((s, f) => s + f.yaw, 0) / frontal.length;
        if (Math.abs(turned.yaw - baseYaw) < TURN_MIN_YAW) throw httpError("Jonli yuz aniqlanmadi — boshingizni biroz yon tomonga buring.", 422, "NOT_LIVE");
      }
      const descriptors = frontal.map((f) => f.descriptor);
      const all = faces.map((f) => f.descriptor);
      const spread = Math.max(...all.slice(1).map((d) => Math.sqrt(d.reduce((s, v, i) => s + (v - all[0][i]) ** 2, 0))));
      if (spread < 0.002) throw httpError("Jonli yuz aniqlanmadi. Qayta urinib ko‘ring.", 422, "NOT_LIVE");
      const result = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId);
        const profile = db.faceProfiles.find((p) => p.employeeId === auth.employeeId && p.companyId === auth.companyId);
        if (!employee || !profile) throw httpError("Face ID hali sozlanmagan.", 428, "FACE_NOT_ENROLLED");
        if (all.some((d) => isReplayedDescriptor(profile.lastDescriptor, d))) throw httpError("Takroriy so‘rov aniqlandi.", 409, "REPLAY");
        // Bir nechta kadr + 1:N (boshqa xodimlar profillari) — begona yuz «sen» deb qabul qilinmaydi.
        const others = db.faceProfiles.filter((p) => p.companyId === auth.companyId && p.employeeId !== auth.employeeId);
        const identity = verifyIdentity(profile, descriptors, others);
        // Burilgan kadr ham shu odamniki (burilishda aniqlik pastroq — biroz yumshoq chegara).
        const sameTurned = !turned || matchFace(profile, turned.descriptor, faceMatchThreshold() + 0.1).matched;
        const matched = identity.matched && sameTurned;
        if (identity.reason === "LOOKALIKE") lookalikeAlert(db, auth.companyId, employee, identity.lookalikeEmployeeId, "mobil ilova");
        db.auditLogs.unshift(
          audit(auth.companyId, nameOf(employee), matched ? "Face ID tasdiqlandi (mobil ilova)" : `Face ID rad etildi (mobil ilova: ${sameTurned ? identity.reason : "TURN_MISMATCH"})`, "employee", employee.id, undefined, {
            matched,
            distance: Number(identity.distance.toFixed(4)),
            reason: identity.reason,
            lookalike: identity.lookalikeEmployeeId,
            deviceId: auth.mdid,
          }),
        );
        if (matched) {
          profile.lastDescriptor = descriptors[descriptors.length - 1];
          profile.lastVerifiedAt = new Date().toISOString();
          if (adaptProfile(profile, descriptors[0], matchFace(profile, descriptors[0]))) profile.updatedAt = profile.lastVerifiedAt;
          for (const device of db.biometricDevices) if (device.employeeId === employee.id && !device.revokedAt) Object.assign(device, { uses: 0, lastFaceAt: profile.lastVerifiedAt });
        }
        return { matched, percent: identity.percent, reason: identity.reason };
      });
      if (!result.matched)
        return res.status(403).json({
          code: "FACE_MISMATCH",
          message: result.reason === "LOOKALIKE" ? "Yuz boshqa xodimga o‘xshab chiqdi — har kim faqat o‘zi belgilaydi. HR’ga xabar berildi." : "Yuz profildagi Face ID bilan mos kelmadi.",
          percent: result.percent,
        });
      res.json({ proof: signFaceProof(auth.employeeId, auth.companyId, "FACE"), percent: result.percent, score: result.percent });
    }),
  );

  /** Ilovada birinchi marta Face ID sozlash: 3–6 kadr (to‘g‘ri va biroz burilgan), server tekshiradi. */
  router.post(
    "/mobile/face/enroll",
    rateLimit({ windowMs: 60_000, limit: 6, keyGenerator: (req) => `menroll:${employeeSessionOf(req)?.employeeId || req.ip}` }),
    route(async (req, res) => {
      const auth = employeeSessionOf(req);
      const { photos } = z.object({ photos: z.array(z.string().min(100).max(300_000)).min(3).max(6) }).parse(req.body);
      const faces = (await Promise.all(photos.map((p) => describeFace(p)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof describeFace>>>[];
      if (faces.length < 3) throw httpError("Kamida 3 ta kadrda yuz aniq ko‘rinishi kerak. Yorug‘ joyda qayta urinib ko‘ring.", 422, "NO_FACE");
      const samples = faces.map((f) => f.descriptor);
      const center = assertConsistentSamples(samples);
      const front = faces.reduce((a, b) => (Math.abs(b.yaw) < Math.abs(a.yaw) ? b : a));
      const photo = photos[faces.indexOf(front)] || photos[0];
      await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId);
        if (!employee || employee.status !== "ACTIVE") throw httpError("Xodim faol emas.", 403);
        if (db.faceProfiles.some((p) => p.employeeId === employee.id)) throw httpError("Face ID avval sozlangan. Qayta sozlash uchun HR’ga murojaat qiling.", 409, "FACE_EXISTS");
        const duplicate = db.faceProfiles.find((p) => p.companyId === employee.companyId && matchFace(p, center, 0.42).matched);
        if (duplicate) throw httpError("Bu yuz boshqa xodim profiliga biriktirilgan. HR bilan bog‘laning.", 409, "FACE_DUPLICATE");
        const now = new Date().toISOString();
        db.faceProfiles.push({ companyId: employee.companyId, employeeId: employee.id, descriptor: center, samples, lastDescriptor: samples[samples.length - 1], lastVerifiedAt: now, enrolledAt: now, updatedAt: now });
        if (employee.photoSource !== "PANEL" || !employee.photoDataUrl) {
          employee.photoDataUrl = photo.startsWith("data:") ? photo : `data:image/jpeg;base64,${photo}`;
          employee.photoUpdatedAt = now;
          employee.photoSource = "FACE";
        }
        employee.faceEnrolledAt = now;
        employee.updatedAt = now;
        db.auditLogs.unshift(audit(employee.companyId, nameOf(employee), `Face ID sozlandi (mobil ilova, ${samples.length} namuna)`, "employee", employee.id));
      });
      res.status(201).json({ ok: true, proof: signFaceProof(auth.employeeId, auth.companyId, "FACE") });
    }),
  );
  return router;
}

/* ============================= Mini App: ilovani ulash kodi (xodimning o‘zi) === */
export function createMiniMobileRouter() {
  const router = Router();
  router.post(
    "/mini/mobile/activation-code",
    rateLimit({ windowMs: 60_000, limit: 5, keyGenerator: (req) => `mcode:${employeeSessionOf(req)?.employeeId || req.ip}` }),
    route(async (req, res) => {
      const auth = employeeSessionOf(req);
      // Faqat Telegram orqali kirgan xodim (Telegram hisobi egasi) kod oladi.
      if (auth.mdid) throw httpError("Kodni Telegram Mini App’dan oling.", 403);
      const out = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId && e.status === "ACTIVE");
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        const created = createActivationCode(db, employee, "MINI_APP", `${nameOf(employee)} (Telegram)`);
        securityLog(db, employee.companyId, nameOf(employee), "Mobil ilova faollashtirish kodi olindi (Mini App)", employee.id);
        const device = db.mobileDevices.find((d) => d.employeeId === employee.id && d.status === "ACTIVE");
        return { ...created, link: activationLink(created.code), hasDevice: Boolean(device), device: device && { platform: device.platform, model: device.model } };
      });
      res.json(out);
    }),
  );
  router.get(
    "/mini/mobile/status",
    route(async (req, res) => {
      const auth = employeeSessionOf(req);
      const db = await readDb();
      const device = db.mobileDevices.find((d) => d.employeeId === auth.employeeId && d.status === "ACTIVE");
      const pending = db.deviceChangeRequests.find((r) => r.employeeId === auth.employeeId && r.status === "PENDING");
      res.json({ device: device && { platform: device.platform, model: device.model, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt }, pendingReplacement: Boolean(pending) });
    }),
  );
  return router;
}

/* ===================================================== panel (HR/Admin) === */
export function createMobileAdminRouter() {
  const router = Router();
  const tenantOf = (req: AuthedRequest) => {
    if (!req.session?.companyId) throw httpError("Kompaniya tanlanmagan.", 403);
    return req.session.companyId;
  };
  const permit = (permission: string) => (req: Request, res: Response, next: NextFunction) =>
    can((req as AuthedRequest).session!.role, permission) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  /** IT (devices.*) ham telefonlarni boshqaradi. */
  const permitAny = (permissions: string[]) => (req: Request, res: Response, next: NextFunction) =>
    permissions.some((p) => can((req as AuthedRequest).session!.role, p)) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  const scopeOk = (req: AuthedRequest, db: Database, employee: Employee) =>
    req.session!.role !== "BRANCH_MANAGER" || (db.users.find((u) => u.id === req.session!.userId)?.branchIds || []).includes(employee.branchId);
  const publicDevice = (db: Database, d: MobileDevice) => ({
    id: d.id,
    platform: d.platform,
    model: d.model,
    osVersion: d.osVersion,
    appVersion: d.appVersion,
    status: d.status,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
    revokedAt: d.revokedAt,
    revokedBy: d.revokedBy,
    revokeReason: d.revokeReason,
    push: db.mobilePushTokens.some((t) => t.deviceId === d.id && t.active),
  });

  router.get(
    "/employees/:id/mobile-devices",
    permit("employees.view"),
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = tenantOf(auth);
      const db = await readDb();
      const employee = db.employees.find((e) => e.id === req.params.id && e.companyId === tenant);
      if (!employee || !scopeOk(auth, db, employee)) throw httpError("Xodim topilmadi.", 404);
      const codes = db.mobileActivationCodes.filter((c) => c.employeeId === employee.id && !c.usedAt && !c.revokedAt && c.expiresAt > new Date().toISOString());
      res.json({
        devices: db.mobileDevices.filter((d) => d.employeeId === employee.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((d) => publicDevice(db, d)),
        requests: db.deviceChangeRequests
          .filter((r) => r.employeeId === employee.id)
          .slice(0, 10)
          .map(({ publicKey: _k, keyFingerprint: _f, ...r }) => r),
        activeCodes: codes.map((c) => ({ id: c.id, hint: c.hint, source: c.source, expiresAt: c.expiresAt })),
      });
    }),
  );

  /** HR taklifi: 72 soatlik bir martalik kod (xodimga Telegram’da ham yuboriladi). */
  router.post(
    "/employees/:id/mobile-invite",
    permit("employees.edit"),
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = tenantOf(auth);
      const out = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === req.params.id && e.companyId === tenant && e.status === "ACTIVE");
        if (!employee || !scopeOk(auth, db, employee)) throw httpError("Xodim topilmadi.", 404);
        const created = createActivationCode(db, employee, "HR", auth.session!.name);
        securityLog(db, tenant, auth.session!.name, "Mobil ilova taklif kodi yaratildi (72 soat)", employee.id);
        return { ...created, link: activationLink(created.code), telegramId: employee.telegramConnected ? employee.telegramId : undefined, name: employee.firstName };
      });
      if (out.telegramId && !out.telegramId.startsWith("dev"))
        void sendTelegramMessage(
          out.telegramId,
          `📱 <b>Staffora mobil ilovasi</b>\n\n${out.name}, ilovani o‘rnating va shu kodni kiriting:\n\n<code>${out.code}</code>\n\nKod 72 soat amal qiladi va faqat bir marta ishlaydi. Uni hech kimga bermang.`,
        ).catch(() => undefined);
      res.status(201).json({ code: out.code, expiresAt: out.expiresAt, link: out.link, sentToTelegram: Boolean(out.telegramId) });
    }),
  );

  /** Sozlamalar → Ilovalar: kompaniyadagi barcha ulangan (va yaqinda o‘chirilgan) telefonlar. */
  router.get(
    "/mobile-devices",
    permit("employees.view"),
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = tenantOf(auth);
      const db = await readDb();
      const status = String(req.query.status || "ACTIVE");
      const rows = db.mobileDevices
        .filter((d) => d.companyId === tenant && (status === "ALL" || d.status === status))
        .map((d) => ({ d, employee: db.employees.find((e) => e.id === d.employeeId) }))
        .filter(({ employee }) => employee && scopeOk(auth, db, employee))
        .sort((a, b) => (b.d.lastSeenAt || b.d.createdAt).localeCompare(a.d.lastSeenAt || a.d.createdAt))
        .slice(0, 500)
        .map(({ d, employee }) => ({
          ...publicDevice(db, d),
          employeeId: employee!.id,
          employeeName: nameOf(employee),
          employeeNo: employee!.employeeNo,
          branch: db.branches.find((b) => b.id === employee!.branchId)?.name,
          photoDataUrl: employee!.photoDataUrl,
          sessions: db.mobileSessions.filter((x) => x.deviceId === d.id && !x.revokedAt && x.expiresAt > new Date().toISOString()).length,
        }));
      res.json({
        rows,
        pendingRequests: db.deviceChangeRequests.filter((r) => r.companyId === tenant && r.status === "PENDING").length,
      });
    }),
  );

  router.post(
    "/mobile-devices/:id/revoke",
    permitAny(["employees.edit", "devices.manage"]),
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = tenantOf(auth);
      const { reason } = z.object({ reason: z.string().trim().max(200).optional() }).parse(req.body || {});
      await updateDb((db) => {
        const device = db.mobileDevices.find((d) => d.id === req.params.id && d.companyId === tenant);
        const employee = device && db.employees.find((e) => e.id === device.employeeId);
        if (!device || !employee || !scopeOk(auth, db, employee)) throw httpError("Qurilma topilmadi.", 404);
        if (device.status !== "ACTIVE") throw httpError("Qurilma allaqachon bekor qilingan.", 409);
        revokeDevice(db, device, auth.session!.name, reason || "HR bekor qildi");
        securityLog(db, tenant, auth.session!.name, `Mobil qurilma bekor qilindi: ${nameOf(employee)} (${device.model || device.platform})`, employee.id, { deviceId: device.id, reason });
      });
      res.json({ ok: true });
    }),
  );

  router.get(
    "/mobile/device-requests",
    permit("employees.view"),
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = tenantOf(auth);
      const status = String(req.query.status || "PENDING");
      const db = await readDb();
      res.json(
        db.deviceChangeRequests
          .filter((r) => r.companyId === tenant && (status === "ALL" || r.status === status))
          .map((r) => ({ r, employee: db.employees.find((e) => e.id === r.employeeId) }))
          .filter(({ employee }) => employee && scopeOk(auth, db, employee))
          .slice(0, 100)
          .map(({ r: { publicKey: _k, keyFingerprint: _f, ...r }, employee }) => {
            const old = r.oldDeviceId ? db.mobileDevices.find((d) => d.id === r.oldDeviceId) : undefined;
            return { ...r, employeeName: nameOf(employee), employeeNo: employee!.employeeNo, oldDevice: old && publicDevice(db, old) };
          }),
      );
    }),
  );

  /** Almashtirishni tasdiqlash: eski qurilma va uning sessiyalari bekor, yangi qurilma faol. */
  router.post(
    "/mobile/device-requests/:id/decide",
    permitAny(["employees.edit", "devices.manage"]),
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = tenantOf(auth);
      const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
      const out = await updateDb((db) => {
        const request = db.deviceChangeRequests.find((r) => r.id === req.params.id && r.companyId === tenant);
        const employee = request && db.employees.find((e) => e.id === request.employeeId);
        if (!request || !employee || !scopeOk(auth, db, employee)) throw httpError("So‘rov topilmadi.", 404);
        if (request.status !== "PENDING") throw httpError("So‘rov allaqachon ko‘rib chiqilgan.", 409);
        const now = new Date().toISOString();
        request.status = approve ? "APPROVED" : "REJECTED";
        request.decidedAt = now;
        request.decidedBy = auth.session!.name;
        if (approve) {
          // Yangi kalit boshqa xodimda faol bo‘lsa — tasdiqlab bo‘lmaydi (bitta qurilma — bitta xodim).
          if (db.mobileDevices.some((d) => d.keyFingerprint === request.keyFingerprint && d.status === "ACTIVE" && d.employeeId !== employee.id))
            throw httpError("Bu telefon boshqa xodimga bog‘langan.", 409, "DEVICE_BOUND_OTHER");
          for (const d of db.mobileDevices) if (d.employeeId === employee.id && d.status === "ACTIVE") revokeDevice(db, d, auth.session!.name, "Yangi telefonga almashtirildi");
          const device: MobileDevice = {
            id: randomUUID(),
            companyId: employee.companyId,
            employeeId: employee.id,
            publicKey: request.publicKey,
            keyFingerprint: request.keyFingerprint,
            platform: request.platform,
            model: request.model,
            osVersion: request.osVersion,
            appVersion: request.appVersion,
            status: "ACTIVE",
            createdAt: now,
          };
          db.mobileDevices.push(device);
          request.newDeviceId = device.id;
        }
        securityLog(db, tenant, auth.session!.name, `Qurilma almashtirish ${approve ? "tasdiqlandi" : "rad etildi"}: ${nameOf(employee)}`, employee.id, { requestId: request.id });
        return { ok: true, telegramId: employee.telegramConnected ? employee.telegramId : undefined };
      });
      if (out.telegramId && !out.telegramId.startsWith("dev"))
        void sendTelegramMessage(out.telegramId, approve ? "✅ Yangi telefoningiz tasdiqlandi — Staffora ilovasini oching. Eski telefondagi ilova o‘chirildi." : "❌ Yangi telefonni ulash so‘rovingiz rad etildi.").catch(
          () => undefined,
        );
      res.json({ ok: true });
    }),
  );
  return router;
}
