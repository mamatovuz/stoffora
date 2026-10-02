import { randomInt, randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { can } from "../lib/permissions";
import { adaptProfile, assertConsistentSamples, faceMatchThreshold, isReplayedDescriptor, matchFace, matchPassPercent, matchPercent } from "../lib/face";
import type { Database, DeviceChangeRequest, Employee, MobileDevice, MobileSession, PanelSession, User } from "../lib/types";
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
  sha256,
  signedMessage,
  verifyDeviceSignature,
} from "./mobile-crypto";
import { sendTelegramMessage } from "./telegram";

/*
 * Native mobil ilova (iOS / Android) — o‘sha Staffora backend va o‘sha xodimlar bazasi.
 *
 * Faollashtirish:  bir martalik kod (Mini App’dan yoki HR’dan) + qurilma kaliti imzosi
 * Qoida:           bir xodim — bitta faol ishonchli qurilma; bitta qurilma — bitta xodim
 * Yangi telefon:   almashtirish so‘rovi → HR tasdiqlaydi → eski qurilma va sessiyalar bekor
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

const deviceSchema = z.object({
  publicKey: z.string().min(80).max(120),
  platform: z.enum(["ios", "android"]),
  model: z.string().trim().max(80).optional(),
  osVersion: z.string().trim().max(40).optional(),
  appVersion: z.string().trim().max(40).optional(),
});

/** Kirish natijasi: access + yangi refresh token (refresh xom holda faqat shu javobda). */
function issueSession(db: Database, employee: Employee, device: MobileDevice) {
  const now = new Date();
  const refreshToken = newSecret(32);
  const session: MobileSession = {
    id: randomUUID(),
    companyId: employee.companyId,
    employeeId: employee.id,
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
const managerAgent = (deviceId: string) => `Staffora mobil ilova · ${deviceId}`;
const MANAGER_ROLES = new Set(["COMPANY_OWNER", "HR_ADMIN", "HR_MANAGER", "BRANCH_MANAGER", "FINANCE"]);
/** Xodimning Telegram hisobi bilan bog‘langan panel hisobi (rahbar) — shu kompaniyada. */
function managerUserOf(db: Database, employee: Employee): User | undefined {
  if (!employee.telegramId || employee.telegramId.startsWith("dev")) return undefined;
  return db.users.find((u) => u.telegramId === employee.telegramId && u.companyId === employee.companyId && MANAGER_ROLES.has(u.role));
}
const securityLog = (db: Database, companyId: string, actor: string, action: string, employeeId: string, meta?: Record<string, unknown>) =>
  db.auditLogs.unshift(audit(companyId, actor, action, "mobile-device", employeeId, undefined, meta));

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

  /** Faollashtirish/holat uchun challenge — hali ro‘yxatdan o‘tmagan kalit uchun. */
  router.post(
    "/mobile/activation/challenge",
    strict,
    route(async (req, res) => {
      const { publicKey } = z.object({ publicKey: z.string().min(80).max(120) }).parse(req.body);
      const { fingerprint } = normalizePublicKey(publicKey);
      res.json(issueChallenge(fingerprint, "activate"));
    }),
  );

  /**
   * Faollashtirish: kod + qurilma kaliti + challenge imzosi.
   *  - kod: xeshi bo‘yicha, muddati, bir martalik, bekor qilinmagan, ≤5 urinish;
   *  - bu kalit boshqa xodimga bog‘langan bo‘lsa — rad (bitta qurilma — bitta xodim);
   *  - xodimning boshqa faol qurilmasi bo‘lsa — almashtirish so‘rovi (HR tasdiqlaydi).
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

        // Bitta qurilma — bitta xodim: bu kalit boshqa xodimda faol bo‘lsa — rad.
        const keyOwner = db.mobileDevices.find((d) => d.keyFingerprint === key.fingerprint && d.status === "ACTIVE");
        if (keyOwner && keyOwner.employeeId !== employee.id) {
          securityLog(db, employee.companyId, nameOf(employee), "Boshqa xodimga bog‘langan qurilmada faollashtirishga urinish", employee.id, { platform: input.platform, otherEmployeeId: keyOwner.employeeId });
          return fail("Bu telefon boshqa xodimga bog‘langan. Har bir xodim o‘z telefonidan foydalanishi kerak.", 409, "DEVICE_BOUND_OTHER");
        }
        code.usedAt = now.toISOString();
        // Shu xodimning o‘sha telefoni (qayta o‘rnatish/qayta kirish) — yangi sessiya.
        if (keyOwner) {
          keyOwner.lastSeenAt = now.toISOString();
          keyOwner.appVersion = input.appVersion || keyOwner.appVersion;
          const { session, refreshToken } = issueSession(db, employee, keyOwner);
          securityLog(db, employee.companyId, nameOf(employee), "Mobil ilovaga qayta kirildi (o‘sha qurilma)", employee.id, { platform: keyOwner.platform });
          return { kind: "session" as const, out: tokens(employee, keyOwner, session, refreshToken) };
        }
        // Bitta xodim — bitta faol qurilma: boshqasi bor — almashtirish so‘rovi.
        const active = db.mobileDevices.find((d) => d.employeeId === employee.id && d.status === "ACTIVE");
        if (active) {
          for (const r of db.deviceChangeRequests) if (r.employeeId === employee.id && r.status === "PENDING") r.status = "CANCELLED";
          const request: DeviceChangeRequest = {
            id: randomUUID(),
            companyId: employee.companyId,
            employeeId: employee.id,
            oldDeviceId: active.id,
            publicKey: key.spki,
            keyFingerprint: key.fingerprint,
            platform: input.platform,
            model: input.model,
            osVersion: input.osVersion,
            appVersion: input.appVersion,
            status: "PENDING",
            createdAt: now.toISOString(),
          };
          db.deviceChangeRequests.unshift(request);
          db.notifications.unshift({
            id: randomUUID(),
            companyId: employee.companyId,
            title: "Yangi telefon so‘rovi",
            body: `${nameOf(employee)} mobil ilovani yangi telefonda (${input.model || input.platform}) faollashtirmoqchi. Xodim profili → Mobil qurilma bo‘limida tasdiqlang.`,
            type: "SECURITY",
            read: false,
            createdAt: now.toISOString(),
          });
          securityLog(db, employee.companyId, nameOf(employee), "Qurilma almashtirish so‘rovi yaratildi", employee.id, { platform: input.platform, model: input.model });
          return { kind: "pending" as const, out: { requestId: request.id, status: "PENDING", message: "Sizda boshqa faol telefon bor. HR tasdiqlagach shu telefon ishlaydi, eskisi o‘chiriladi." } };
        }
        const device: MobileDevice = {
          id: randomUUID(),
          companyId: employee.companyId,
          employeeId: employee.id,
          publicKey: key.spki,
          keyFingerprint: key.fingerprint,
          platform: input.platform,
          model: input.model,
          osVersion: input.osVersion,
          appVersion: input.appVersion,
          status: "ACTIVE",
          createdAt: now.toISOString(),
          lastSeenAt: now.toISOString(),
        };
        db.mobileDevices.push(device);
        const { session, refreshToken } = issueSession(db, employee, device);
        securityLog(db, employee.companyId, nameOf(employee), "Mobil ilova faollashtirildi (ishonchli qurilma)", employee.id, { platform: device.platform, model: device.model, source: code.source });
        return { kind: "session" as const, out: tokens(employee, device, session, refreshToken) };
      }));
      if (result.kind === "pending") return res.status(202).json(result.out);
      res.status(201).json(result.out);
    }),
  );

  /** Almashtirish so‘rovi holati — yangi telefon kaliti bilan imzolanadi; tasdiqlansa sessiya beriladi. */
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
        const { session, refreshToken } = issueSession(db, employee, device);
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
        const employee = db.employees.find((e) => e.id === session.employeeId && e.status === "ACTIVE");
        if (!employee) throw httpError("Xodim profili faol emas.", 403, "EMPLOYEE_INACTIVE");
        const refreshToken = newSecret(32);
        const now = new Date();
        session.prevRefreshHash = session.refreshHash;
        session.refreshHash = sha256(refreshToken);
        session.lastUsedAt = now.toISOString();
        session.expiresAt = new Date(now.getTime() + REFRESH_TTL_MS).toISOString();
        device.lastSeenAt = now.toISOString();
        return tokens(employee, device, session, refreshToken);
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
      const user = employee && managerUserOf(db, employee);
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
      const { photos } = z.object({ photos: z.array(z.string().min(100).max(300_000)).min(2).max(3) }).parse(req.body);
      const faces = await Promise.all(photos.map((p) => describeFace(p)));
      if (faces.some((f) => !f)) throw httpError("Kadrlarda yuz aniq ko‘rinmadi. Kameraga to‘g‘ri qarang.", 422, "NO_FACE");
      const descriptors = faces.map((f) => f!.descriptor);
      const spread = Math.max(...descriptors.slice(1).map((d) => Math.sqrt(d.reduce((s, v, i) => s + (v - descriptors[0][i]) ** 2, 0))));
      if (spread < 0.002) throw httpError("Jonli yuz aniqlanmadi. Qayta urinib ko‘ring.", 422, "NOT_LIVE");
      const result = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId);
        const profile = db.faceProfiles.find((p) => p.employeeId === auth.employeeId && p.companyId === auth.companyId);
        if (!employee || !profile) throw httpError("Face ID hali sozlanmagan.", 428, "FACE_NOT_ENROLLED");
        if (descriptors.some((d) => isReplayedDescriptor(profile.lastDescriptor, d))) throw httpError("Takroriy so‘rov aniqlandi.", 409, "REPLAY");
        const matches = descriptors.map((d) => matchFace(profile, d));
        const best = matches.reduce((a, b) => (b.distance < a.distance ? b : a));
        const matched = matches.every((m) => m.matched);
        db.auditLogs.unshift(
          audit(auth.companyId, nameOf(employee), matched ? "Face ID tasdiqlandi (mobil ilova)" : "Face ID mos kelmadi (mobil ilova)", "employee", employee.id, undefined, {
            matched,
            distance: Number(best.distance.toFixed(4)),
            deviceId: auth.mdid,
          }),
        );
        if (matched) {
          profile.lastDescriptor = descriptors[descriptors.length - 1];
          profile.lastVerifiedAt = new Date().toISOString();
          if (adaptProfile(profile, descriptors[0], best)) profile.updatedAt = profile.lastVerifiedAt;
          for (const device of db.biometricDevices) if (device.employeeId === employee.id && !device.revokedAt) Object.assign(device, { uses: 0, lastFaceAt: profile.lastVerifiedAt });
        }
        return { matched, percent: matchPercent(best.distance) };
      });
      if (!result.matched)
        return res.status(403).json({ code: "FACE_MISMATCH", message: "Yuz profildagi Face ID bilan mos kelmadi.", percent: result.percent });
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
    permit("employees.edit"),
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
    permit("employees.edit"),
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
