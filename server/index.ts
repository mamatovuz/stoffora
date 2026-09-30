import "dotenv/config";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { z } from "zod";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import compression from "compression";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import {
  audit,
  checkDatabaseHealth,
  dataIndexes,
  dataVersion,
  flushDb,
  queryAuditLogs,
  readDb,
  scrubAuditForEntities,
  updateDb,
} from "../lib/store";
import { calculateAttendance, isValidClockTime } from "../lib/attendance";
import {
  dateParts,
  tashkentClock,
  tashkentIsoDate,
} from "../lib/format";
import { can, canAny } from "../lib/permissions";
import { isPracticeDay } from "../lib/counting";
import { dayPlan } from "../lib/schedule";
import { alignDepartment, assertEmployeeCapacity, limitInfo, purgeEmployees } from "../lib/limits";
import { createCompany, createUser } from "../lib/seed";
import type {
  Announcement,
  AnnouncementTarget,
  Attendance,
  Branch,
  Database,
  Employee,
  LeaveRequest,
  PanelSession,
  Schedule,
  User,
} from "../lib/types";
import { normalizePayrollSettings } from "../lib/payroll";
import {
  requireAuth,
  requireRole,
  signSession,
  type AuthedRequest,
  type Session,
} from "./auth";
import {
  createPanelLinkCode,
  getTelegramBotState,
  sendTelegramMessage,
  startTelegramBot,
  stopTelegramBot,
  telegramBotUsername,
  telegramWebhook,
} from "./telegram";
import { createMiniRouter } from "./mini-routes";
import { startAttendanceReminders } from "./reminders";
import { serveMedia, slimPhotos } from "./media";
import { startPhotoChannelWorker, testPhotoChannel } from "./photo-channel";
import { payrollRows, penaltyText, registerExcelReports } from "./reports";
import { createIntegrationRouter, createIntegrationWebhookRouter } from "./integrations/routes";
import { startIntegrationWorker } from "./integrations/worker";
import { closedPeriod, createPayrollRouter } from "./payroll-routes";
import {
  createCompanyBotRouter,
  createCompanyBotWebhookRouter,
  startCompanyBots,
  stopAllCompanyBots,
} from "./company-bots";
import { notifyEmployee } from "./integrations/hooks";
import { activeIntegration } from "./integrations/model";
import { enqueueAnnouncementToBot, targetEmployees, targetLabel } from "./integrations/announce";

const fieldLabels: Record<string, string> = {
  firstName: "Ism",
  lastName: "Familiya",
  phone: "Telefon",
  email: "Email",
  password: "Parol",
  name: "Nomi",
  address: "Manzil",
  latitude: "Kenglik",
  longitude: "Uzunlik",
  radiusMeters: "Radius",
  startDate: "Boshlanish sanasi",
  endDate: "Tugash sanasi",
  reason: "Sabab",
  checkIn: "Kelish vaqti",
  checkOut: "Ketish vaqti",
  title: "Sarlavha",
  message: "Xabar",
  days: "Ish kunlari",
};
z.setErrorMap((issue, ctx) => {
  if (issue.code === "invalid_type" && issue.received === "undefined")
    return { message: "to‘ldirilishi shart." };
  if (issue.code === "too_small" && issue.type === "string")
    return { message: `kamida ${issue.minimum} belgi bo‘lsin.` };
  if (issue.code === "too_small" && issue.type === "number")
    return { message: `kamida ${issue.minimum} bo‘lsin.` };
  if (issue.code === "too_big" && issue.type === "number")
    return { message: `ko‘pi bilan ${issue.maximum} bo‘lsin.` };
  if (issue.code === "invalid_string" && issue.validation === "email")
    return { message: "email manzil noto‘g‘ri." };
  if (issue.code === "invalid_type") return { message: "qiymat noto‘g‘ri." };
  return { message: ctx.defaultError };
});

const app = express();
const port = Number(process.env.PORT || 4000);
const production = process.env.NODE_ENV === "production";
const publicAppUrl = (
  process.env.APP_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : "http://localhost:3000")
).replace(/\/+$/, "");

if (production) {
  for (const key of [
    "SESSION_SECRET",
    "JWT_SECRET",
    "QR_SIGNING_SECRET",
  ] as const) {
    if ((process.env[key] || "").length < 32)
      throw new Error(
        `${key} production uchun kamida 32 belgi bo‘lishi kerak.`,
      );
  }
  if (process.env.TELEGRAM_DEV_MODE === "true")
    throw new Error(
      "Production muhitida TELEGRAM_DEV_MODE=false bo‘lishi kerak.",
    );
}

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: production
      ? {
          useDefaults: true,
          directives: {
            "script-src": ["'self'", "https://telegram.org"],
            "img-src": ["'self'", "data:", "blob:"],
            "media-src": ["'self'", "blob:"],
            "worker-src": ["'self'", "blob:"],
            "connect-src": ["'self'"],
            // Telegram Web (web.telegram.org) Mini App’ni iframe ichida ochadi.
            "frame-ancestors": [
              "'self'",
              "https://web.telegram.org",
              "https://*.telegram.org",
              "https://t.me",
            ],
          },
        }
      : false,
    frameguard: false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(cors({ origin: publicAppUrl, credentials: true }));
// Javoblarni siqish (JSON 5–10 barobar kichrayadi). Rasmlar allaqachon siqilgan.
app.use(compression({ threshold: 1024 }));
app.use(
  express.json({
    limit: "2mb",
    // Integratsiya webhook imzosi xom tana ustida tekshiriladi.
    verify: (req, _res, buf) => {
      const url = (req as Request).url || "";
      if (url.startsWith("/api/integrations/") && url.endsWith("/webhook"))
        (req as Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  }),
);
// Imzolangan rasm URL’lari — auth va umumiy limitdan oldin, uzoq keshlanadi.
app.get("/api/media/:kind/:file", (req, res, next) => {
  Promise.resolve(serveMedia(req, res)).catch(next);
});
// Bitta IP’dan juda ko‘p so‘rov (flood) serverni band qilmasligi uchun.
// Ofisdagi hamma xodim bitta IP’dan kirishi mumkin, shuning uchun limit keng.
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    limit: Number(process.env.API_RATE_LIMIT_PER_MINUTE) || 3000,
    standardHeaders: true,
    legacyHeaders: false,
    // Mini App yo‘llari o‘z (xodim bo‘yicha) limitiga ega — umumiy IP limiti ofisni bloklamasin.
    skip: (req) =>
      req.path === "/telegram/webhook" ||
      req.path.startsWith("/mini/") ||
      req.path === "/telegram/auth" ||
      req.path.startsWith("/telegram/company/") ||
      /^\/integrations\/[^/]+\/webhook$/.test(req.path),
    message: { message: "Juda ko‘p so‘rov. Birozdan keyin qayta urinib ko‘ring." },
  }),
);
app.use("/api", slimPhotos);
app.use(cookieParser());

// Event loop kechikishi — server "qotayotgani"ni ko‘rsatadi.
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();
setInterval(() => loopDelay.reset(), 60_000).unref();
let integrity: { ok: boolean; at: number } | undefined;
app.get("/health", async (_req, res) => {
  try {
    // To‘liq tekshiruv og‘ir — 10 daqiqada bir marta.
    if (!integrity || Date.now() - integrity.at > 10 * 60_000)
      integrity = { ok: await checkDatabaseHealth(), at: Date.now() };
    const database = integrity.ok;
    const telegram = getTelegramBotState();
    const memory = process.memoryUsage();
    res.status(database ? 200 : 503).json({
      status: database ? "ok" : "degraded",
      database: database ? "sqlite-ready" : "sqlite-error",
      eventLoopLagMs: Math.round(loopDelay.percentile(99) / 1e6),
      memoryMb: Math.round(memory.rss / 1024 / 1024),
      telegram: telegram.state,
      telegramMode: telegram.mode,
      telegramBot: telegram.username ? `@${telegram.username}` : undefined,
      telegramError: telegram.error,
      uptimeSeconds: Math.round(process.uptime()),
    });
  } catch {
    res.status(503).json({ status: "error", database: "sqlite-unavailable" });
  }
});

app.post("/api/telegram/webhook", telegramWebhook);

const asyncRoute =
  (handler: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthedRequest, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req, res)).catch(next);
const id = () => crypto.randomUUID();
const httpError = (message: string, status: number) =>
  Object.assign(new Error(message), { status });
const companyId = (req: AuthedRequest) => {
  if (!req.session?.companyId)
    throw httpError("Kompaniya tanlanmagan.", 403);
  return req.session.companyId;
};
/**
 * Filial rahbari faqat o‘ziga biriktirilgan filiallarni ko‘radi.
 * Boshqa rollar uchun null — cheklov yo‘q.
 */
const branchScope = (req: AuthedRequest, db: Database): Set<string> | null => {
  if (req.session?.role !== "BRANCH_MANAGER") return null;
  const user = db.users.find((u) => u.id === req.session!.userId);
  return new Set(user?.branchIds || []);
};
const inScope = (scope: Set<string> | null, branchId?: string) => !scope || Boolean(branchId && scope.has(branchId));
const scopeRoster = <T extends { employee: { branchId: string } }>(scope: Set<string> | null, rows: T[]) =>
  scope ? rows.filter((row) => scope.has(row.employee.branchId)) : rows;

/** Ruxsatlardan kamida bittasi bo‘lsa o‘tkazadi. */
const requireAnyPermission =
  (...permissions: string[]) =>
  (req: AuthedRequest, res: Response, next: NextFunction) =>
    canAny(req.session!.role, permissions)
      ? next()
      : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
const requirePermission =
  (permission: string) =>
  (req: AuthedRequest, res: Response, next: NextFunction) =>
    can(req.session!.role, permission)
      ? next()
      : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Sana YYYY-MM-DD formatida bo‘lsin.");
const timeSchema = z
  .string()
  .refine(isValidClockTime, "Vaqt HH:MM formatida bo‘lsin.");
const csvCell = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;
const sendCsv = (res: Response, name: string, rows: unknown[][]) =>
  res
    .type("text/csv")
    .attachment(name)
    .send("﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\n"));

function setSessionCookie(res: Response, session: Session) {
  // Cookie 4 KB dan oshmasligi uchun tokenda faqat identifikatorlar saqlanadi.
  const minimal: Session = {
    sid: session.sid,
    userId: session.userId,
    companyId: session.companyId,
    name: session.name,
    email: session.email,
    role: session.role,
  };
  res.cookie("staffora_session", signSession(minimal), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 12 * 3600_000,
  });
}

/** Yangi panel qurilmasini (sessiyani) ro‘yxatga oladi va cookie o‘rnatadi. */
async function startPanelSession(req: Request, res: Response, user: User) {
  const now = new Date().toISOString();
  const device: PanelSession = {
    id: id(),
    userId: user.id,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    ip: String(req.ip || "").replace(/^::ffff:/, ""),
    createdAt: now,
    lastSeenAt: now,
  };
  await updateDb((db) => {
    // Eski (30 kundan oshgan yoki bekor qilingan) sessiyalarni tozalaymiz.
    const cutoff = Date.now() - 30 * 86_400_000;
    db.panelSessions = db.panelSessions.filter(
      (s) => !s.revokedAt && new Date(s.lastSeenAt).getTime() > cutoff,
    );
    db.panelSessions.push(device);
  });
  const session: Session = {
    sid: device.id,
    userId: user.id,
    companyId: user.companyId,
    name: user.name,
    email: user.email,
    role: user.role,
    photoDataUrl: user.photoDataUrl,
  };
  setSessionCookie(res, session);
  return session;
}

/* 2 bosqichli kirish: Telegram orqali yuborilgan 6 xonali kod. */
type LoginChallenge = {
  userId: string;
  codeHash: string;
  expires: number;
  attempts: number;
};
const loginChallenges = new Map<string, LoginChallenge>();
function cleanupChallenges() {
  for (const [key, value] of loginChallenges)
    if (value.expires < Date.now()) loginChallenges.delete(key);
}
const hashCode = (code: string) =>
  createHash("sha256")
    .update(`${code}:${process.env.SESSION_SECRET || "staffora"}`)
    .digest("hex");

// ---------------------------------------------------------------- setup ---
const needsSetup = (db: Database) =>
  !db.users.some((user) => user.role !== "SUPER_ADMIN");

app.get(
  "/api/setup/status",
  asyncRoute(async (_req, res) => {
    const db = await readDb();
    res.json({
      needsSetup: needsSetup(db),
      requiresToken: Boolean(process.env.SETUP_TOKEN),
    });
  }),
);
app.post(
  "/api/setup",
  rateLimit({ windowMs: 15 * 60_000, limit: 10 }),
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        companyName: z.string().trim().min(2).max(120),
        ownerName: z.string().trim().min(2).max(120),
        email: z.string().trim().email(),
        password: z.string().min(10, "Parol kamida 10 belgidan iborat bo‘lsin."),
        setupToken: z.string().optional(),
      })
      .parse(req.body);
    if (
      process.env.SETUP_TOKEN &&
      input.setupToken !== process.env.SETUP_TOKEN
    )
      throw httpError("Sozlash kaliti noto‘g‘ri.", 403);
    const owner = await createUser({
      name: input.ownerName,
      email: input.email,
      password: input.password,
      role: "COMPANY_OWNER",
    });
    const user = await updateDb((db) => {
      if (!needsSetup(db))
        throw httpError("Tizim allaqachon sozlangan. Tizimga kiring.", 409);
      // Egasiz qolgan eski kompaniya bo‘lsa — shunga biriktiramiz.
      let company = db.companies[0];
      if (company) {
        company.name = input.companyName;
        company.ownerName = input.ownerName;
      } else {
        company = createCompany({
          name: input.companyName,
          ownerName: input.ownerName,
        });
        db.companies.push(company);
      }
      owner.companyId = company.id;
      db.users.push(owner);
      db.auditLogs.unshift(
        audit(company.id, owner.name, "Kompaniya sozlandi", "company", company.id),
      );
      return owner;
    });
    const session = await startPanelSession(req, res, user);
    res.status(201).json({ user: session, redirect: "/dashboard" });
  }),
);

// ----------------------------------------------------------------- auth ---
app.post(
  "/api/auth/login",
  rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Juda ko‘p urinish. Bir daqiqadan keyin qayta urinib ko‘ring." },
  }),
  asyncRoute(async (req, res) => {
    const input = z
      .object({ email: z.string().trim().email(), password: z.string().min(1) })
      .parse(req.body);
    const db = await readDb();
    const user = db.users.find(
      (u) => u.email.toLowerCase() === input.email.toLowerCase(),
    );
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash)))
      return res.status(401).json({ message: "Email yoki parol noto‘g‘ri." });
    const company = db.companies.find((item) => item.id === user.companyId);
    if (user.role !== "SUPER_ADMIN" && company?.status === "SUSPENDED")
      return res
        .status(403)
        .json({ message: "Kompaniya hisobi to‘xtatilgan. Qo‘llab-quvvatlashga murojaat qiling." });
    if (user.twoFactorEnabled && user.telegramId) {
      cleanupChallenges();
      const code = String(randomInt(100000, 1000000));
      const challengeId = id();
      loginChallenges.set(challengeId, {
        userId: user.id,
        codeHash: hashCode(code),
        expires: Date.now() + 5 * 60_000,
        attempts: 0,
      });
      try {
        const sent = await sendTelegramMessage(
          user.telegramId,
          `🔐 Staffora panelga kirish kodi: ${code}\n\nKod 5 daqiqa amal qiladi. Uni hech kimga bermang.\nAgar kirishga siz urinmagan bo‘lsangiz, darhol parolingizni o‘zgartiring.`,
        );
        if (!sent) throw new Error("bot");
      } catch {
        loginChallenges.delete(challengeId);
        throw httpError(
          "Tasdiqlash kodini Telegram’ga yuborib bo‘lmadi. Bot ishlayotganini tekshiring.",
          503,
        );
      }
      return res.json({
        requires2fa: true,
        challengeId,
        telegram: user.telegramUsername ? `@${user.telegramUsername}` : "Telegram",
      });
    }
    const session = await startPanelSession(req, res, user);
    return res.json({
      user: session,
      redirect: user.role === "SUPER_ADMIN" ? "/super-admin" : "/dashboard",
    });
  }),
);
app.post(
  "/api/auth/login/verify",
  rateLimit({ windowMs: 60_000, limit: 15 }),
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        challengeId: z.string().min(10),
        code: z.string().trim().regex(/^\d{6}$/, "Kod 6 ta raqam bo‘lsin."),
      })
      .parse(req.body);
    cleanupChallenges();
    const challenge = loginChallenges.get(input.challengeId);
    if (!challenge) throw httpError("Kod muddati tugagan. Qaytadan kiring.", 410);
    challenge.attempts += 1;
    if (challenge.attempts > 5) {
      loginChallenges.delete(input.challengeId);
      throw httpError("Juda ko‘p noto‘g‘ri urinish. Qaytadan kiring.", 429);
    }
    const expected = Buffer.from(challenge.codeHash, "hex");
    const received = Buffer.from(hashCode(input.code), "hex");
    if (!timingSafeEqual(expected, received))
      throw httpError(
        `Kod noto‘g‘ri. Yana ${5 - challenge.attempts} ta urinish qoldi.`,
        400,
      );
    loginChallenges.delete(input.challengeId);
    const db = await readDb();
    const user = db.users.find((u) => u.id === challenge.userId);
    if (!user) throw httpError("Foydalanuvchi topilmadi.", 404);
    const session = await startPanelSession(req, res, user);
    res.json({
      user: session,
      redirect: user.role === "SUPER_ADMIN" ? "/super-admin" : "/dashboard",
    });
  }),
);
app.post("/api/auth/logout", async (req, res) => {
  try {
    const token = req.cookies?.staffora_session;
    const payload = token ? (jwt.decode(token) as Session | null) : null;
    if (payload?.sid)
      await updateDb((db) => {
        const row = db.panelSessions.find((s) => s.id === payload.sid);
        if (row) row.revokedAt = new Date().toISOString();
      });
  } catch {
    /* chiqishdagi xatoni e’tiborsiz qoldiramiz */
  }
  res.clearCookie("staffora_session");
  res.json({ ok: true });
});
app.get(
  "/api/auth/me",
  requireAuth,
  asyncRoute(async (req, res) => {
    const db = await readDb();
    const user = db.users.find((u) => u.id === req.session!.userId);
    const device = db.panelSessions.find((s) => s.id === req.session!.sid);
    const lock = user?.screenLock;
    res.json({
      user: {
        ...req.session,
        companyName: db.companies.find((c) => c.id === user?.companyId)?.name,
        screenLock: {
          enabled: Boolean(lock?.enabled && lock.passwordHash),
          minutes: lock?.minutes || 5,
          hasPassword: Boolean(lock?.passwordHash),
        },
        locked: Boolean(device?.lockedAt && lock?.enabled && lock.passwordHash),
      },
    });
  }),
);

app.use("/api", createMiniRouter());
app.use("/api", createIntegrationWebhookRouter());
app.use("/api", createCompanyBotWebhookRouter());
app.use("/api", requireAuth);
app.use("/api", createIntegrationRouter());
app.use("/api", createCompanyBotRouter());
app.use("/api", createPayrollRouter());

app.get("/api/telegram/status", (_req, res) => {
  const state = getTelegramBotState();
  res.json({ ...state, username: state.username || telegramBotUsername() });
});
app.put(
  "/api/auth/password",
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(10, "Yangi parol kamida 10 belgi bo‘lsin."),
      })
      .parse(req.body);
    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    const db = await readDb();
    const current = db.users.find((item) => item.id === req.session!.userId);
    if (
      !current ||
      !(await bcrypt.compare(input.currentPassword, current.passwordHash))
    )
      throw httpError("Joriy parol noto‘g‘ri.", 400);
    await updateDb((next) => {
      const row = next.users.find((item) => item.id === current.id);
      if (row) row.passwordHash = passwordHash;
      if (row?.companyId)
        next.auditLogs.unshift(
          audit(row.companyId, row.name, "Parol o‘zgartirildi", "user", row.id),
        );
    });
    res.json({ ok: true });
  }),
);
app.put(
  "/api/profile/photo",
  asyncRoute(async (req, res) => {
    const { photoDataUrl } = z
      .object({
        photoDataUrl: z
          .string()
          .max(700_000)
          .regex(/^data:image\/(jpeg|jpg|png|webp);base64,/),
      })
      .parse(req.body);
    const user = await updateDb((db) => {
      const row = db.users.find((item) => item.id === req.session!.userId);
      if (!row) throw httpError("Foydalanuvchi topilmadi.", 404);
      row.photoDataUrl = photoDataUrl;
      if (row.companyId)
        db.auditLogs.unshift(
          audit(
            row.companyId,
            row.name,
            "Panel profil rasmi yangilandi",
            "user",
            row.id,
          ),
        );
      return row;
    });
    return res.json({
      user: { ...req.session!, photoDataUrl: user.photoDataUrl },
    });
  }),
);
app.put(
  "/api/profile",
  asyncRoute(async (req, res) => {
    const { name } = z
      .object({
        name: z.string().trim().min(3, "Ism familiya kamida 3 harf.").max(80),
      })
      .parse(req.body);
    const user = await updateDb((db) => {
      const row = db.users.find((item) => item.id === req.session!.userId);
      if (!row) throw httpError("Foydalanuvchi topilmadi.", 404);
      const before = row.name;
      row.name = name;
      if (row.role === "COMPANY_OWNER" && row.companyId) {
        const company = db.companies.find((c) => c.id === row.companyId);
        if (company) company.ownerName = name;
      }
      if (row.companyId)
        db.auditLogs.unshift(
          audit(row.companyId, name, "Ism familiya o‘zgartirildi", "user", row.id, { name: before }, { name }),
        );
      return row;
    });
    setSessionCookie(res, { ...req.session!, name: user.name });
    res.json({ user: { ...req.session!, name: user.name } });
  }),
);

/* ---- qurilmalar (panel sessiyalari) ---- */
app.get(
  "/api/auth/devices",
  asyncRoute(async (req, res) => {
    const db = await readDb();
    res.json(
      db.panelSessions
        .filter((s) => s.userId === req.session!.userId && !s.revokedAt)
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
        .map((s) => ({ ...s, current: s.id === req.session!.sid })),
    );
  }),
);
app.delete(
  "/api/auth/devices/:id",
  asyncRoute(async (req, res) => {
    await updateDb((db) => {
      const row = db.panelSessions.find(
        (s) => s.id === req.params.id && s.userId === req.session!.userId,
      );
      if (!row) throw httpError("Qurilma topilmadi.", 404);
      row.revokedAt = new Date().toISOString();
    });
    res.json({ ok: true, current: req.params.id === req.session!.sid });
  }),
);
app.post(
  "/api/auth/devices/revoke-others",
  asyncRoute(async (req, res) => {
    const count = await updateDb((db) => {
      let n = 0;
      for (const row of db.panelSessions)
        if (
          row.userId === req.session!.userId &&
          row.id !== req.session!.sid &&
          !row.revokedAt
        ) {
          row.revokedAt = new Date().toISOString();
          n += 1;
        }
      return n;
    });
    res.json({ ok: true, count });
  }),
);

/* ---- ekran qulfi ---- */
app.post(
  "/api/auth/lock",
  asyncRoute(async (req, res) => {
    const locked = await updateDb((db) => {
      const user = db.users.find((u) => u.id === req.session!.userId);
      const device = db.panelSessions.find((s) => s.id === req.session!.sid);
      if (!user?.screenLock?.enabled || !user.screenLock.passwordHash || !device) return false;
      device.lockedAt = new Date().toISOString();
      return true;
    });
    res.json({ locked });
  }),
);
app.post(
  "/api/auth/unlock",
  rateLimit({
    windowMs: 60_000,
    limit: 8,
    message: { message: "Juda ko‘p urinish. Bir daqiqa kuting." },
  }),
  asyncRoute(async (req, res) => {
    const { password } = z.object({ password: z.string().min(1, "Parolni kiriting.") }).parse(req.body);
    const db = await readDb();
    const user = db.users.find((u) => u.id === req.session!.userId);
    const hash = user?.screenLock?.passwordHash;
    if (!user || !hash || !(await bcrypt.compare(password, hash)))
      throw httpError("Parol noto‘g‘ri.", 400);
    await updateDb((next) => {
      const device = next.panelSessions.find((s) => s.id === req.session!.sid);
      if (device) device.lockedAt = undefined;
    });
    res.json({ locked: false });
  }),
);
app.put(
  "/api/auth/screen-lock",
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        enabled: z.boolean(),
        minutes: z.coerce.number().int().min(1, "Kamida 1 daqiqa.").max(240),
        lockPassword: z.string().min(4, "Qulf paroli kamida 4 belgi.").max(64).optional(),
        accountPassword: z.string().min(1, "Hisob parolingizni kiriting."),
      })
      .parse(req.body);
    const db = await readDb();
    const current = db.users.find((u) => u.id === req.session!.userId);
    if (!current || !(await bcrypt.compare(input.accountPassword, current.passwordHash)))
      throw httpError("Hisob paroli noto‘g‘ri.", 400);
    if (input.enabled && !input.lockPassword && !current.screenLock?.passwordHash)
      throw httpError("Qulf uchun parol o‘rnating.", 400);
    const hash = input.lockPassword ? await bcrypt.hash(input.lockPassword, 10) : undefined;
    const lock = await updateDb((next) => {
      const user = next.users.find((u) => u.id === current.id)!;
      user.screenLock = {
        enabled: input.enabled,
        minutes: input.minutes,
        passwordHash: hash || user.screenLock?.passwordHash,
      };
      if (user.companyId)
        next.auditLogs.unshift(
          audit(user.companyId, user.name, input.enabled ? "Ekran qulfi yoqildi" : "Ekran qulfi o‘chirildi", "user", user.id),
        );
      return user.screenLock;
    });
    res.json({ enabled: lock.enabled, minutes: lock.minutes, hasPassword: Boolean(lock.passwordHash) });
  }),
);

/* ---- Telegram ulash va 2 bosqichli kirish ---- */
app.get(
  "/api/auth/security",
  asyncRoute(async (req, res) => {
    const db = await readDb();
    const user = db.users.find((u) => u.id === req.session!.userId);
    res.json({
      telegramLinked: Boolean(user?.telegramId),
      telegramUsername: user?.telegramUsername,
      twoFactorEnabled: Boolean(user?.twoFactorEnabled && user.telegramId),
      botUsername: telegramBotUsername(),
    });
  }),
);
app.post(
  "/api/auth/telegram-link",
  asyncRoute(async (req, res) => {
    const username = telegramBotUsername();
    if (!username) throw httpError("Telegram bot sozlanmagan.", 503);
    const code = createPanelLinkCode(req.session!.userId);
    res.json({
      code,
      link: `https://t.me/${username}?start=adm_${code}`,
      expiresInMinutes: 10,
    });
  }),
);
app.delete(
  "/api/auth/telegram-link",
  asyncRoute(async (req, res) => {
    await updateDb((db) => {
      const user = db.users.find((u) => u.id === req.session!.userId);
      if (!user) throw httpError("Foydalanuvchi topilmadi.", 404);
      user.telegramId = undefined;
      user.telegramUsername = undefined;
      user.twoFactorEnabled = false;
    });
    res.json({ ok: true });
  }),
);
app.put(
  "/api/auth/two-factor",
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        enabled: z.boolean(),
        password: z.string().min(1, "Parolni kiriting."),
      })
      .parse(req.body);
    const db = await readDb();
    const user = db.users.find((u) => u.id === req.session!.userId);
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash)))
      throw httpError("Parol noto‘g‘ri.", 400);
    if (input.enabled && !user.telegramId)
      throw httpError("Avval Telegram hisobingizni ulang.", 409);
    await updateDb((next) => {
      const row = next.users.find((u) => u.id === user.id);
      if (row) row.twoFactorEnabled = input.enabled;
      if (row?.companyId)
        next.auditLogs.unshift(
          audit(
            row.companyId,
            row.name,
            input.enabled ? "2 bosqichli kirish yoqildi" : "2 bosqichli kirish o‘chirildi",
            "user",
            row.id,
          ),
        );
    });
    if (input.enabled && user.telegramId)
      void sendTelegramMessage(
        user.telegramId,
        "✅ Staffora: 2 bosqichli kirish yoqildi. Endi har safar panelga kirganda shu yerga kod keladi.",
      ).catch(() => undefined);
    res.json({ ok: true, enabled: input.enabled });
  }),
);

// ----------------------------------------------------------- directory ---
app.get(
  "/api/meta",
  asyncRoute(async (req, res) => {
    const db = await readDb();
    const tenant = companyId(req);
    const active = db.employees.filter(
      (e) => e.companyId === tenant && e.status === "ACTIVE",
    );
    const scope = branchScope(req, db);
    res.json({
      branches: db.branches.filter((x) => x.companyId === tenant && inScope(scope, x.id)),
      departments: db.departments
        .filter((x) => x.companyId === tenant)
        .map((x) => ({
          ...x,
          employees: active.filter((e) => e.departmentId === x.id).length,
        })),
      positions: db.positions
        .filter((x) => x.companyId === tenant)
        .map((x) => ({
          ...x,
          employees: active.filter((e) => e.positionId === x.id).length,
        })),
      schedules: db.schedules.filter((x) => x.companyId === tenant),
    });
  }),
);
app.get(
  "/api/company",
  asyncRoute(async (req, res) => {
    const db = await readDb();
    const company = db.companies.find((c) => c.id === companyId(req));
    if (!company) throw httpError("Kompaniya topilmadi.", 404);
    // Maxfiy qismlar (bot tokeni) qaytmaydi.
    res.json({ ...company, bot: undefined, limits: limitInfo(db, company) });
  }),
);
app.put(
  "/api/company",
  requirePermission("settings.manage"),
  asyncRoute(async (req, res) => {
    const input = z
        .object({
          name: z.string().trim().min(2),
          timezone: z.string().min(2),
        })
        .parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const company = db.companies.find((c) => c.id === tenant);
      if (!company) throw httpError("Kompaniya topilmadi.", 404);
      const before = { ...company };
      Object.assign(company, input);
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Kompaniya sozlamalari yangilandi",
          "company",
          tenant,
          before,
          company,
        ),
      );
      return company;
    });
    res.json(row);
  }),
);

const departmentSchema = z.object({
  name: z.string().trim().min(2),
  manager: z.string().trim().optional(),
});
app.post(
  "/api/departments",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const input = departmentSchema.parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      if (
        db.departments.some(
          (d) =>
            d.companyId === tenant &&
            d.name.toLowerCase() === input.name.toLowerCase(),
        )
      )
        throw httpError("Bu nomdagi bo‘lim mavjud.", 409);
      const value = { id: id(), companyId: tenant, ...input };
      db.departments.push(value);
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Bo‘lim yaratildi", "department", value.id),
      );
      return value;
    });
    res.status(201).json(row);
  }),
);
app.put(
  "/api/departments/:id",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const input = departmentSchema.partial().parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const value = db.departments.find(
        (d) => d.id === req.params.id && d.companyId === tenant,
      );
      if (!value) throw httpError("Bo‘lim topilmadi.", 404);
      Object.assign(value, input);
      return value;
    });
    res.json(row);
  }),
);
app.delete(
  "/api/departments/:id",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    await updateDb((db) => {
      const value = db.departments.find(
        (d) => d.id === req.params.id && d.companyId === tenant,
      );
      if (!value) throw httpError("Bo‘lim topilmadi.", 404);
      if (
        db.employees.some(
          (e) => e.departmentId === value.id && occupiesSlot(e),
        ) ||
        db.positions.some((p) => p.departmentId === value.id)
      )
        throw httpError(
          "Bo‘limda xodim yoki lavozim bor. Avval ularni boshqa bo‘limga o‘tkazing.",
          409,
        );
      db.departments = db.departments.filter((d) => d.id !== value.id);
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Bo‘lim o‘chirildi", "department", value.id),
      );
    });
    res.json({ ok: true });
  }),
);

const positionSchema = z.object({
  name: z.string().trim().min(2),
  departmentId: z.string().min(1),
});
app.post(
  "/api/positions",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const input = positionSchema.parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      if (
        !db.departments.some(
          (d) => d.id === input.departmentId && d.companyId === tenant,
        )
      )
        throw httpError("Bo‘lim topilmadi.", 404);
      const value = { id: id(), companyId: tenant, ...input };
      db.positions.push(value);
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Lavozim yaratildi", "position", value.id),
      );
      return value;
    });
    res.status(201).json(row);
  }),
);
app.put(
  "/api/positions/:id",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const input = positionSchema.partial().parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const value = db.positions.find(
        (p) => p.id === req.params.id && p.companyId === tenant,
      );
      if (!value) throw httpError("Lavozim topilmadi.", 404);
      if (
        input.departmentId &&
        !db.departments.some(
          (d) => d.id === input.departmentId && d.companyId === tenant,
        )
      )
        throw httpError("Bo‘lim topilmadi.", 404);
      Object.assign(value, input);
      // Lavozim boshqa bo‘limga o‘tsa — shu lavozimdagi xodimlar ham o‘sha bo‘limga.
      for (const employee of db.employees)
        if (employee.companyId === tenant && employee.positionId === value.id) alignDepartment(db, employee);
      return value;
    });
    res.json(row);
  }),
);
app.delete(
  "/api/positions/:id",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    await updateDb((db) => {
      const value = db.positions.find(
        (p) => p.id === req.params.id && p.companyId === tenant,
      );
      if (!value) throw httpError("Lavozim topilmadi.", 404);
      if (
        db.employees.some(
          (e) => e.positionId === value.id && occupiesSlot(e),
        )
      )
        throw httpError("Bu lavozimda xodimlar bor.", 409);
      db.positions = db.positions.filter((p) => p.id !== value.id);
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Lavozim o‘chirildi", "position", value.id),
      );
    });
    res.json({ ok: true });
  }),
);

// -------------------------------------------------------------- roster ---
type RosterState =
  | "PRACTICE"
  | "IN"
  | "LEFT"
  | "ABSENT"
  | "ON_LEAVE"
  | "DAY_OFF"
  | "NOT_YET"
  | "UPCOMING";

/** Ro‘yxat uchun xodimning faqat kerakli (va maxfiy bo‘lmagan) maydonlari. */
function rosterEmployee(employee: Employee) {
  return {
    id: employee.id,
    companyId: employee.companyId,
    employeeNo: employee.employeeNo,
    firstName: employee.firstName,
    lastName: employee.lastName,
    phone: employee.phone,
    branchId: employee.branchId,
    departmentId: employee.departmentId,
    positionId: employee.positionId,
    scheduleId: employee.scheduleId,
    status: employee.status,
    startDate: employee.startDate,
    photoDataUrl: employee.photoDataUrl,
    telegramConnected: employee.telegramConnected,
    faceEnrolledAt: employee.faceEnrolledAt,
  } as Employee;
}

// Bir xil (kompaniya, sana, ma’lumot versiyasi, daqiqa) uchun natija qayta hisoblanmaydi.
const rosterCache = new Map<string, ReturnType<typeof computeDayRoster>>();
function dayRoster(db: Database, tenant: string, date: string) {
  const key = `${tenant}|${date}|${dataVersion()}|${tashkentClock()}`;
  const cached = rosterCache.get(key);
  if (cached) return cached;
  const value = computeDayRoster(db, tenant, date);
  if (rosterCache.size > 300) rosterCache.clear();
  rosterCache.set(key, value);
  return value;
}

function computeDayRoster(db: Database, tenant: string, date: string) {
  const today = tashkentIsoDate();
  const nowClock = tashkentClock();
  const weekday = dateParts(date).weekday;
  // O‘qish indekslari: xodim+sana bo‘yicha davomat O(1) — katta bazada ham tez.
  const index = dataIndexes(db);
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
  const schedules = byId(db.schedules.filter((s) => s.companyId === tenant));
  const branches = byId(db.branches.filter((b) => b.companyId === tenant));
  const departments = byId(db.departments.filter((d) => d.companyId === tenant));
  const positions = byId(db.positions.filter((p) => p.companyId === tenant));
  const company = db.companies.find((c) => c.id === tenant);
  return db.employees
    .filter(
      (employee) =>
        employee.companyId === tenant &&
        (employee.status === "ACTIVE" ||
          index.attendanceByKey.has(`${employee.id}|${date}`)) &&
        employee.startDate <= date,
    )
    .map((employee) => {
      const record = index.attendanceByKey.get(`${employee.id}|${date}`);
      const schedule = schedules.get(employee.scheduleId);
      void weekday;
      // Grafik o‘zgarishi (smena almashish) hisobga olinadi.
      const day = dayPlan(db, employee, date);
      const leave = index.approvedLeaveByEmployee
        .get(employee.id)
        ?.find((l) => l.startDate <= date && l.endDate >= date);
      const practice = isPracticeDay(date, company, employee);
      let state: RosterState;
      if (record?.checkIn) state = record.checkOut ? "LEFT" : "IN";
      else if (leave) state = "ON_LEAVE";
      else if (!day?.enabled) state = "DAY_OFF";
      else if (date > today) state = "UPCOMING";
      else if (date === today && nowClock < day.end) {
        const [h, m] = day.start.split(":").map(Number);
        const deadline = h * 60 + m + (schedule?.graceMinutes || 0);
        const [nh, nm] = nowClock.split(":").map(Number);
        state = nh * 60 + nm <= deadline ? "NOT_YET" : "ABSENT";
      } else state = "ABSENT";
      // Mashq davrida kelmaslik "Kelmadi" deb sanalmaydi, kechikish ham hisoblanmaydi.
      if (practice && state === "ABSENT") state = "PRACTICE";
      return {
        employee: rosterEmployee(employee),
        record: record || null,
        state,
        practice,
        late: !practice && (record?.lateMinutes || 0) > 0,
        leaveType: leave?.type,
        scheduledStart: record?.scheduledStart || (day?.enabled ? day.start : undefined),
        scheduledEnd: record?.scheduledEnd || (day?.enabled ? day.end : undefined),
        branch: branches.get(employee.branchId)?.name,
        department: departments.get(employee.departmentId)?.name,
        position: positions.get(employee.positionId)?.name,
        schedule: schedule?.name,
      };
    });
}

function rosterStats(rows: ReturnType<typeof dayRoster>) {
  const count = (state: RosterState) =>
    rows.filter((row) => row.state === state).length;
  return {
    total: rows.filter((row) => row.employee.status === "ACTIVE").length,
    present: count("IN") + count("LEFT"),
    inNow: count("IN"),
    left: count("LEFT"),
    late: rows.filter((row) => row.late).length,
    absent: count("ABSENT"),
    leave: count("ON_LEAVE"),
    dayOff: count("DAY_OFF"),
    notYet: count("NOT_YET"),
  };
}

app.get(
  "/api/dashboard",
  requirePermission("dashboard.view"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const today = tashkentIsoDate();
    const scope = branchScope(req, db);
    const roster = scopeRoster(scope, dayRoster(db, tenant, today));
    const days = [7, 14, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    const weekly = Array.from({ length: days }, (_, index) => {
      const date = tashkentIsoDate(
        new Date(Date.now() - (days - 1 - index) * 86_400_000),
      );
      const stats = rosterStats(scopeRoster(scope, dayRoster(db, tenant, date)));
      const expected = stats.present + stats.absent;
      return {
        date,
        present: stats.present - stats.late,
        late: stats.late,
        absent: stats.absent,
        rate: expected ? Math.round((stats.present / expected) * 100) : null,
      };
    });
    const employees = db.employees.filter(
      (e) => e.companyId === tenant && e.status === "ACTIVE" && inScope(scope, e.branchId),
    );
    res.json({
      stats: rosterStats(roster),
      roster: roster
        .filter((row) => row.employee.status === "ACTIVE")
        .sort((a, b) =>
          (b.record?.updatedAt || "").localeCompare(a.record?.updatedAt || ""),
        ),
      weekly,
      setup: {
        branches: db.branches.filter((x) => x.companyId === tenant).length,
        departments: db.departments.filter((x) => x.companyId === tenant)
          .length,
        positions: db.positions.filter((x) => x.companyId === tenant).length,
        schedules: db.schedules.filter((x) => x.companyId === tenant).length,
        employees: employees.length,
        telegramLinked: employees.filter((e) => e.telegramConnected).length,
        faceEnrolled: employees.filter((e) => e.faceEnrolledAt).length,
      },
      bot: {
        state: getTelegramBotState().state,
        username: telegramBotUsername(),
      },
      notifications: db.notifications
        .filter((n) => n.companyId === tenant && !n.employeeId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 6),
      leave: db.leaveRequests.filter(
        (l) => l.companyId === tenant && l.status === "PENDING",
      ).length,
    });
  }),
);

// ----------------------------------------------------------- employees ---
const photoSchema = z
  .union([
    z
      .string()
      .max(700_000)
      .regex(/^data:image\/(jpeg|jpg|png|webp);base64,/),
    z.literal(""),
    // Forma javobdagi rasm URL’ini qaytarib yuborsa — "o‘zgarmagan" deb hisoblanadi.
    z.string().startsWith("/api/media/").transform(() => undefined),
  ])
  .optional();
const employeeSchema = z.object({
  firstName: z.string().trim().min(2, "Ism kamida 2 harf."),
  lastName: z.string().trim().min(2, "Familiya kamida 2 harf."),
  middleName: z.string().trim().optional(),
  phone: z
    .string()
    .trim()
    .refine((v) => v.replace(/\D/g, "").length >= 9, "Telefon raqami to‘liq emas."),
  email: z.union([z.string().trim().email(), z.literal("")]).default(""),
  employeeNo: z.string().trim().optional(),
  departmentId: z.string().min(1, "Bo‘limni tanlang."),
  positionId: z.string().min(1, "Lavozimni tanlang."),
  branchId: z.string().min(1, "Filialni tanlang."),
  scheduleId: z.string().min(1, "Ish grafigini tanlang."),
  startDate: dateSchema,
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT"]),
  baseSalary: z.coerce.number().min(0),
  currency: z.string().default("UZS"),
  address: z.string().trim().optional(),
  manager: z.string().trim().optional(),
  telegramUsername: z
    .string()
    .trim()
    .transform((v) => v.replace(/^@/, ""))
    .optional(),
  photoDataUrl: photoSchema,
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
});

function assertEmployeeRefs(
  db: Database,
  tenant: string,
  input: Partial<z.infer<typeof employeeSchema>>,
) {
  const check = (
    rows: { id: string; companyId: string }[],
    value: string | undefined,
    label: string,
  ) => {
    if (value !== undefined && !rows.some((r) => r.id === value && r.companyId === tenant))
      throw httpError(`${label} topilmadi. Avval uni yarating.`, 422);
  };
  check(db.branches, input.branchId, "Filial");
  check(db.departments, input.departmentId, "Bo‘lim");
  check(db.positions, input.positionId, "Lavozim");
  check(db.schedules, input.scheduleId, "Ish grafigi");
}

/** Faol (ishdan bo‘shatilmagan) xodim — bo‘lim, lavozim, filial va grafikni band qiladi. */
const occupiesSlot = (employee: Employee) =>
  employee.status !== "ARCHIVED" && employee.status !== "DISMISSED";

function nextEmployeeNo(db: Database, tenant: string) {
  const numbers = db.employees
    .filter((e) => e.companyId === tenant)
    .map((e) => Number(e.employeeNo.replace(/\D/g, "")) || 0);
  return `EMP-${String(Math.max(0, ...numbers) + 1).padStart(4, "0")}`;
}

app.get(
  "/api/employees",
  requirePermission("employees.view"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const scope = branchScope(req, db);
    let rows = db.employees.filter((e) => e.companyId === tenant && inScope(scope, e.branchId));
    const q = String(req.query.q || "").toLowerCase().trim();
    if (q)
      rows = rows.filter((e) =>
        `${e.firstName} ${e.lastName} ${e.employeeNo} ${e.phone} ${e.email} ${e.telegramUsername || ""}`
          .toLowerCase()
          .includes(q),
      );
    if (req.query.branch)
      rows = rows.filter((e) => e.branchId === req.query.branch);
    if (req.query.department)
      rows = rows.filter((e) => e.departmentId === req.query.department);
    if (req.query.position)
      rows = rows.filter((e) => e.positionId === req.query.position);
    if (req.query.schedule)
      rows = rows.filter((e) => e.scheduleId === req.query.schedule);
    if (req.query.status === "DISMISSED")
      rows = rows.filter((e) => e.status === "DISMISSED" || e.status === "ARCHIVED");
    else if (req.query.status)
      rows = rows.filter((e) => e.status === req.query.status);
    else rows = rows.filter((e) => e.status !== "ARCHIVED" && e.status !== "DISMISSED");
    const page = Math.max(1, Number(req.query.page || 1)),
      limit = Math.min(200, Math.max(1, Number(req.query.limit || 12))),
      total = rows.length;
    rows.sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
    );
    const today = tashkentIsoDate();
    const index = dataIndexes(db);
    const items = rows
      .slice((page - 1) * limit, page * limit)
      .map((employee) => ({
        ...employee,
        todayAttendance: index.attendanceByKey.get(`${employee.id}|${today}`),
      }));
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }),
);
app.post(
  "/api/employees",
  requirePermission("employees.create"),
  asyncRoute(async (req, res) => {
    const input = employeeSchema.parse(req.body),
      tenant = companyId(req);
    const created = await updateDb((db) => {
      assertEmployeeRefs(db, tenant, input);
      if ((input.status || "ACTIVE") === "ACTIVE") assertEmployeeCapacity(db, tenant);
      const employeeNo = input.employeeNo || nextEmployeeNo(db, tenant);
      if (
        db.employees.some(
          (e) => e.companyId === tenant && e.employeeNo === employeeNo,
        )
      )
        throw httpError("Bu xodim ID allaqachon mavjud.", 409);
      const now = new Date().toISOString();
      const row: Employee = {
        id: id(),
        companyId: tenant,
        ...input,
        employeeNo,
        email: input.email || "",
        photoDataUrl: input.photoDataUrl || undefined,
        telegramConnected: false,
        deviceStatus: "PENDING",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      };
      alignDepartment(db, row);
      db.employees.push(row);
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Xodim yaratildi", "employee", row.id),
      );
      return row;
    });
    res.status(201).json(created);
  }),
);
app.get(
  "/api/employees/:id",
  requirePermission("employees.view"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req),
      employee = db.employees.find(
        (e) => e.id === req.params.id && e.companyId === tenant,
      );
    if (!employee || !inScope(branchScope(req, db), employee.branchId))
      return res.status(404).json({ message: "Xodim topilmadi." });
    res.json({
      employee,
      attendance: db.attendance
        .filter((a) => a.companyId === tenant && a.employeeId === employee.id)
        .sort((a, b) => b.date.localeCompare(a.date)),
      leave: db.leaveRequests
        .filter((l) => l.companyId === tenant && l.employeeId === employee.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      activity: (await queryAuditLogs(tenant, { entityId: employee.id, limit: 50 })).map(
        ({ before: _b, after: _a, ...rest }) => rest,
      ),
      faceSamples:
        db.faceProfiles.find((f) => f.employeeId === employee.id)?.samples
          ?.length || 0,
    });
  }),
);
// Bir nechta xodim maoshini birdan kiritish (masalan, integratsiyadan keyin 0 bo‘lib qolganlar).
app.put(
  "/api/employees/salaries",
  asyncRoute(async (req, res) => {
    const role = req.session!.role;
    if (!can(role, "employees.edit") && !can(role, "payroll.edit"))
      return res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
    const input = z
      .object({
        items: z
          .array(z.object({ id: z.string().min(1), baseSalary: z.coerce.number().min(0).max(10_000_000_000) }))
          .min(1)
          .max(5000),
      })
      .parse(req.body);
    const tenant = companyId(req);
    const updated = await updateDb((db) => {
      const byId = new Map(db.employees.filter((e) => e.companyId === tenant).map((e) => [e.id, e]));
      let count = 0;
      const now = new Date().toISOString();
      for (const item of input.items) {
        const employee = byId.get(item.id);
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        const amount = Math.round(item.baseSalary);
        if (employee.baseSalary === amount) continue;
        db.auditLogs.unshift(
          audit(tenant, req.session!.name, "Oylik o‘zgartirildi", "employee", employee.id, { baseSalary: employee.baseSalary }, { baseSalary: amount }),
        );
        employee.baseSalary = amount;
        employee.updatedAt = now;
        count += 1;
      }
      return count;
    });
    res.json({ updated });
  }),
);
app.put(
  "/api/employees/:id",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const input = employeeSchema.partial().parse(req.body),
      tenant = companyId(req),
      employeeId = String(req.params.id);
    const row = await updateDb((db) => {
      const index = db.employees.findIndex(
        (e) => e.id === employeeId && e.companyId === tenant,
      );
      if (index < 0) throw httpError("Xodim topilmadi.", 404);
      assertEmployeeRefs(db, tenant, input);
      if (
        input.employeeNo &&
        db.employees.some(
          (e) =>
            e.companyId === tenant &&
            e.id !== employeeId &&
            e.employeeNo === input.employeeNo,
        )
      )
        throw httpError("Bu xodim ID boshqa xodimda bor.", 409);
      const before = { ...db.employees[index] };
      const next = {
        ...db.employees[index],
        ...Object.fromEntries(
          Object.entries(input).filter(([, value]) => value !== undefined),
        ),
        updatedAt: new Date().toISOString(),
      } as Employee;
      if (input.photoDataUrl === "") next.photoDataUrl = undefined;
      if (!next.employeeNo) next.employeeNo = before.employeeNo;
      alignDepartment(db, next);
      // Faol bo‘lmagan xodimni qayta faollashtirish ham tarif chegarasiga kiradi.
      if (next.status === "ACTIVE" && before.status !== "ACTIVE") assertEmployeeCapacity(db, tenant);
      db.employees[index] = next;
      const { photoDataUrl: _p1, ...beforeLog } = before;
      const { photoDataUrl: _p2, ...afterLog } = next;
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Xodim ma’lumoti yangilandi",
          "employee",
          employeeId,
          beforeLog,
          afterLog,
        ),
      );
      return next;
    });
    res.json(row);
  }),
);
app.delete(
  "/api/employees/:id/face-profile",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    await updateDb((db) => {
      const employee = db.employees.find(
        (item) => item.id === req.params.id && item.companyId === tenant,
      );
      if (!employee) throw httpError("Xodim topilmadi.", 404);
      db.faceProfiles = db.faceProfiles.filter(
        (item) =>
          !(item.employeeId === employee.id && item.companyId === tenant),
      );
      employee.faceEnrolledAt = undefined;
      employee.updatedAt = new Date().toISOString();
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Face ID qayta ro‘yxatdan o‘tkazish uchun tozalandi",
          "employee",
          employee.id,
        ),
      );
    });
    res.json({ ok: true });
  }),
);
app.delete(
  "/api/employees/:id/telegram",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    await updateDb((db) => {
      const employee = db.employees.find(
        (item) => item.id === req.params.id && item.companyId === tenant,
      );
      if (!employee) throw httpError("Xodim topilmadi.", 404);
      employee.telegramId = undefined;
      employee.telegramConnected = false;
      employee.deviceStatus = "PENDING";
      employee.updatedAt = new Date().toISOString();
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Telegram hisobi uzildi", "employee", employee.id),
      );
    });
    res.json({ ok: true });
  }),
);
app.delete(
  "/api/employees/:id",
  requirePermission("employees.delete"),
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    // ?permanent=1 — butunlay o‘chirish (faqat kompaniya egasi): hech qayerda qolmaydi.
    if (req.query.permanent === "1") {
      if (req.session!.role !== "COMPANY_OWNER" && req.session!.role !== "SUPER_ADMIN")
        throw httpError("Xodimni butunlay o‘chirish faqat kompaniya egasiga ruxsat etilgan.", 403);
      await updateDb((db) => {
        const row = db.employees.find((e) => e.id === req.params.id && e.companyId === tenant);
        if (!row) throw httpError("Xodim topilmadi.", 404);
        purgeEmployees(db, tenant, new Set([row.id]));
        db.auditLogs.unshift(
          audit(tenant, req.session!.name, `Xodim butunlay o‘chirildi: ${row.firstName} ${row.lastName} (${row.employeeNo})`, "employee", row.id),
        );
      });
      void scrubAuditForEntities(tenant, [String(req.params.id)]).catch(() => undefined);
      return res.json({ ok: true, deleted: 1 });
    }
    await updateDb((db) => {
      const row = db.employees.find(
        (e) => e.id === req.params.id && e.companyId === tenant,
      );
      if (!row) throw httpError("Xodim topilmadi.", 404);
      row.status = "ARCHIVED";
      row.telegramConnected = false;
      row.updatedAt = new Date().toISOString();
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Xodim arxivlandi", "employee", row.id),
      );
    });
    res.json({ ok: true });
  }),
);
// Xavfli: kompaniyadagi BARCHA xodimlarni butunlay o‘chirish (faqat egasi, tasdiq so‘zi bilan).
app.post(
  "/api/employees/delete-all",
  asyncRoute(async (req, res) => {
    if (req.session!.role !== "COMPANY_OWNER")
      return res.status(403).json({ message: "Bu amal faqat kompaniya egasiga ruxsat etilgan." });
    const { confirm } = z.object({ confirm: z.literal("O‘CHIRISH", { errorMap: () => ({ message: "Tasdiqlash so‘zi noto‘g‘ri." }) }) }).parse(req.body);
    void confirm;
    const tenant = companyId(req);
    const removedIds: string[] = [];
    const deleted = await updateDb((db) => {
      const ids = new Set(db.employees.filter((e) => e.companyId === tenant).map((e) => e.id));
      removedIds.push(...ids);
      const count = purgeEmployees(db, tenant, ids);
      db.auditLogs.unshift(audit(tenant, req.session!.name, `Barcha xodimlar butunlay o‘chirildi (${count} ta)`, "company", tenant));
      return count;
    });
    await scrubAuditForEntities(tenant, removedIds).catch(() => undefined);
    res.json({ ok: true, deleted });
  }),
);
app.post(
  "/api/employees/:id/dismiss",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        date: dateSchema,
        reason: z.string().trim().max(300).optional(),
      })
      .parse(req.body);
    const tenant = companyId(req);
    const row = await updateDb((db) => {
      const employee = db.employees.find(
        (e) => e.id === req.params.id && e.companyId === tenant,
      );
      if (!employee) throw httpError("Xodim topilmadi.", 404);
      if (employee.status === "DISMISSED") throw httpError("Xodim allaqachon ishdan bo‘shatilgan.", 409);
      employee.status = "DISMISSED";
      employee.dismissedAt = input.date;
      employee.dismissReason = input.reason || undefined;
      employee.updatedAt = new Date().toISOString();
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, `Xodim ishdan bo‘shatildi (${input.date})`, "employee", employee.id, undefined, { reason: input.reason }),
      );
      return employee;
    });
    res.json(row);
  }),
);
app.post(
  "/api/employees/:id/rehire",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        startDate: dateSchema.optional(),
        // Oldingi bo‘lim/lavozim o‘chirilgan bo‘lsa — yangisini tanlash mumkin.
        branchId: z.string().min(1).optional(),
        departmentId: z.string().min(1).optional(),
        positionId: z.string().min(1).optional(),
        scheduleId: z.string().min(1).optional(),
      })
      .parse(req.body);
    const tenant = companyId(req);
    const row = await updateDb((db) => {
      const employee = db.employees.find(
        (e) => e.id === req.params.id && e.companyId === tenant,
      );
      if (!employee) throw httpError("Xodim topilmadi.", 404);
      if (employee.status !== "ACTIVE") assertEmployeeCapacity(db, tenant);
      for (const key of ["branchId", "departmentId", "positionId", "scheduleId"] as const)
        if (input[key]) employee[key] = input[key]!;
      alignDepartment(db, employee);
      assertEmployeeRefs(db, tenant, {
        branchId: employee.branchId,
        scheduleId: employee.scheduleId,
        departmentId: employee.departmentId,
        positionId: employee.positionId,
      });
      employee.status = "ACTIVE";
      employee.dismissedAt = undefined;
      employee.dismissReason = undefined;
      if (input.startDate) employee.startDate = input.startDate;
      employee.updatedAt = new Date().toISOString();
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Xodim qayta ishga olindi", "employee", employee.id),
      );
      return employee;
    });
    res.json(row);
  }),
);
app.post(
  "/api/employees/:id/telegram-invite",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    const invite = await updateDb((db) => {
      const employee = db.employees.find(
        (item) => item.id === req.params.id && item.companyId === tenant,
      );
      if (!employee) throw httpError("Xodim topilmadi.", 404);
      const value = {
        id: id(),
        companyId: tenant,
        employeeId: employee.id,
        code: crypto.randomUUID().replaceAll("-", ""),
        expiresAt: new Date(Date.now() + 72 * 3600_000).toISOString(),
      };
      db.telegramInvites = db.telegramInvites.filter(
        (item) =>
          (item.employeeId !== employee.id || Boolean(item.usedAt)) &&
          new Date(item.expiresAt).getTime() > Date.now() - 30 * 86_400_000,
      );
      db.telegramInvites.push(value);
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Telegram taklif havolasi yaratildi",
          "employee",
          employee.id,
        ),
      );
      return value;
    });
    const username = telegramBotUsername();
    res.status(201).json({
      ...invite,
      link: username ? `https://t.me/${username}?start=${invite.code}` : undefined,
      appLink: username
        ? `https://t.me/${username}?startapp=${invite.code}`
        : undefined,
      botUsername: username,
      startParam: invite.code,
    });
  }),
);

// ---------------------------------------------------------- attendance ---
app.get(
  "/api/attendance/day",
  requirePermission("attendance.view"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const date = dateSchema.parse(String(req.query.date || tashkentIsoDate()));
    const rows = scopeRoster(branchScope(req, db), dayRoster(db, tenant, date));
    res.json({ date, stats: rosterStats(rows), rows });
  }),
);
app.get(
  "/api/attendance",
  requirePermission("attendance.view"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const scope = branchScope(req, db);
    const scopedEmployees = scope
      ? new Set(db.employees.filter((e) => e.companyId === tenant && inScope(scope, e.branchId)).map((e) => e.id))
      : null;
    let rows = db.attendance.filter(
      (a) => a.companyId === tenant && (!scopedEmployees || scopedEmployees.has(a.employeeId) || inScope(scope, a.branchId)),
    );
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    if (req.query.date) rows = rows.filter((a) => a.date === req.query.date);
    if (from) rows = rows.filter((a) => a.date >= from);
    if (to) rows = rows.filter((a) => a.date <= to);
    if (req.query.employee)
      rows = rows.filter((a) => a.employeeId === req.query.employee);
    if (req.query.status)
      rows = rows.filter((a) => a.status === req.query.status);
    if (req.query.branch)
      rows = rows.filter((a) => a.branchId === req.query.branch);
    res.json(
      rows
        .map((a) => {
          const employee = db.employees.find((e) => e.id === a.employeeId);
          return {
            ...a,
            employee,
            branch: db.branches.find((b) => b.id === a.branchId)?.name,
            department: db.departments.find(
              (d) => d.id === employee?.departmentId,
            )?.name,
          };
        })
        .sort((a, b) => b.date.localeCompare(a.date)),
    );
  }),
);
app.post(
  "/api/attendance",
  requirePermission("attendance.edit"),
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        employeeId: z.string().min(1),
        date: dateSchema,
        checkIn: timeSchema,
        checkOut: z.union([timeSchema, z.literal("")]).optional(),
        note: z.string().trim().max(300).optional(),
      })
      .parse(req.body);
    const tenant = companyId(req);
    if (input.date > tashkentIsoDate())
      throw httpError("Kelajakdagi sana uchun davomat kiritib bo‘lmaydi.", 422);
    const row = await updateDb((db) => {
      const employee = db.employees.find(
        (e) => e.id === input.employeeId && e.companyId === tenant,
      );
      if (!employee || !inScope(branchScope(req, db), employee.branchId)) throw httpError("Xodim topilmadi.", 404);
      if (
        db.attendance.some(
          (a) => a.employeeId === employee.id && a.date === input.date,
        )
      )
        throw httpError(
          "Bu kun uchun davomat qaydi mavjud. Uni tahrirlang.",
          409,
        );
      const schedule = db.schedules.find((s) => s.id === employee.scheduleId);
      const day = dayPlan(db, employee, input.date);
      const scheduledStart = day?.enabled ? day.start : input.checkIn;
      const scheduledEnd = day?.enabled
        ? day.end
        : input.checkOut || input.checkIn;
      const calculated = calculateAttendance({
        scheduledStart,
        scheduledEnd,
        checkIn: input.checkIn,
        checkOut: input.checkOut || undefined,
        graceMinutes: schedule?.graceMinutes || 0,
      });
      const record: Attendance = {
        id: id(),
        companyId: tenant,
        employeeId: employee.id,
        branchId: employee.branchId,
        date: input.date,
        scheduledStart,
        scheduledEnd,
        checkIn: input.checkIn,
        checkOut: input.checkOut || undefined,
        ...calculated,
        verification: ["MANUAL"],
        note: input.note || `Qo‘lda kiritdi: ${req.session!.name}`,
        updatedAt: new Date().toISOString(),
      };
      db.attendance.push(record);
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Davomat qo‘lda kiritildi",
          "attendance",
          record.id,
          undefined,
          record,
        ),
      );
      return record;
    });
    res.status(201).json(row);
  }),
);
app.put(
  "/api/attendance/:id",
  requirePermission("attendance.edit"),
  asyncRoute(async (req, res) => {
    const input = z
        .object({
          checkIn: timeSchema,
          checkOut: z.union([timeSchema, z.literal("")]).optional(),
          note: z.string().trim().max(300).optional(),
        })
        .parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const record = db.attendance.find(
        (a) => a.id === req.params.id && a.companyId === tenant,
      );
      const owner = record && db.employees.find((e) => e.id === record.employeeId);
      if (!record || !inScope(branchScope(req, db), owner?.branchId || record.branchId))
        throw httpError("Davomat yozuvi topilmadi.", 404);
      const before = { ...record },
        schedule = db.schedules.find(
          (s) =>
            s.id ===
            db.employees.find((e) => e.id === record.employeeId)?.scheduleId,
        );
      const checkOut = input.checkOut || undefined;
      Object.assign(
        record,
        calculateAttendance({
          scheduledStart: record.scheduledStart,
          scheduledEnd: record.scheduledEnd,
          checkIn: input.checkIn,
          checkOut,
          graceMinutes: schedule?.graceMinutes || 0,
        }),
        {
          checkIn: input.checkIn,
          checkOut,
          note: input.note ?? record.note,
          verification: [
            ...new Set([...record.verification, "MANUAL"]),
          ] as Attendance["verification"],
          updatedAt: new Date().toISOString(),
        },
      );
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Davomat qo‘lda tahrirlandi",
          "attendance",
          record.id,
          before,
          record,
        ),
      );
      return record;
    });
    res.json(row);
  }),
);
app.delete(
  "/api/attendance/:id",
  requirePermission("attendance.edit"),
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    await updateDb((db) => {
      const record = db.attendance.find(
        (a) => a.id === req.params.id && a.companyId === tenant,
      );
      const owner = record && db.employees.find((e) => e.id === record.employeeId);
      if (!record || !inScope(branchScope(req, db), owner?.branchId || record.branchId))
        throw httpError("Davomat yozuvi topilmadi.", 404);
      db.attendance = db.attendance.filter((a) => a.id !== record.id);
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Davomat qaydi o‘chirildi",
          "attendance",
          record.id,
          record,
        ),
      );
    });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------ branches ---
const branchSchema = z.object({
  name: z.string().trim().min(2),
  address: z.string().trim().min(3),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().min(20).max(2000),
  manager: z.string().trim().default(""),
  scheduleId: z.string().default(""),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  attendanceMode: z.enum(["QR_GPS_FACE", "GPS_FACE"]).default("QR_GPS_FACE"),
});
app.get(
  "/api/branches",
  requireAnyPermission("org.view", "employees.view", "attendance.view"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const today = tashkentIsoDate();
    const scope = branchScope(req, db);
    res.json(
      db.branches
        .filter((b) => b.companyId === tenant && inScope(scope, b.id))
        .map((b) => ({
          ...b,
          employees: db.employees.filter(
            (e) => e.branchId === b.id && e.status === "ACTIVE",
          ).length,
          presentToday: db.attendance.filter(
            (a) => a.branchId === b.id && a.date === today && a.checkIn,
          ).length,
        })),
    );
  }),
);
app.post(
  "/api/branches",
  requirePermission("branches.create"),
  asyncRoute(async (req, res) => {
    const input = branchSchema.parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const branch: Branch = { id: id(), companyId: tenant, ...input };
      db.branches.push(branch);
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Filial yaratildi", "branch", branch.id),
      );
      return branch;
    });
    res.status(201).json(row);
  }),
);
app.put(
  "/api/branches/:id",
  requirePermission("branches.edit"),
  asyncRoute(async (req, res) => {
    const input = branchSchema.partial().parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const branch = db.branches.find(
        (b) => b.id === req.params.id && b.companyId === tenant,
      );
      if (!branch) throw httpError("Filial topilmadi.", 404);
      const before = { ...branch };
      Object.assign(branch, input);
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Filial yangilandi",
          "branch",
          branch.id,
          before,
          branch,
        ),
      );
      return branch;
    });
    res.json(row);
  }),
);
app.delete(
  "/api/branches/:id",
  requirePermission("branches.edit"),
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    await updateDb((db) => {
      const branch = db.branches.find(
        (b) => b.id === req.params.id && b.companyId === tenant,
      );
      if (!branch) throw httpError("Filial topilmadi.", 404);
      if (
        db.employees.some(
          (e) => e.branchId === branch.id && occupiesSlot(e),
        )
      )
        throw httpError(
          "Filialda xodimlar bor. Avval ularni boshqa filialga o‘tkazing yoki filialni nofaol qiling.",
          409,
        );
      db.branches = db.branches.filter((b) => b.id !== branch.id);
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Filial o‘chirildi", "branch", branch.id),
      );
    });
    res.json({ ok: true });
  }),
);

// ----------------------------------------------------------- schedules ---
const scheduleSchema = z.object({
  name: z.string().trim().min(2),
  type: z.enum(["FIXED", "FLEXIBLE", "SHIFT"]),
  graceMinutes: z.coerce.number().min(0).max(120),
  overtimeEnabled: z.boolean(),
  days: z
    .array(
      z.object({
        day: z.number().int().min(0).max(6),
        enabled: z.boolean(),
        start: timeSchema,
        end: timeSchema,
        breakMinutes: z.coerce.number().min(0).max(480),
      }),
    )
    .length(7)
    .refine(
      (days) => days.every((d) => !d.enabled || d.end > d.start),
      "Ish tugash vaqti boshlanishdan keyin bo‘lishi kerak.",
    ),
});
app.get(
  "/api/schedules",
  requireAnyPermission("org.view", "employees.view", "attendance.view"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    res.json(
      db.schedules
        .filter((s) => s.companyId === tenant)
        .map((s) => ({
          ...s,
          employees: db.employees.filter(
            (e) => e.scheduleId === s.id && e.status === "ACTIVE",
          ).length,
        })),
    );
  }),
);
app.post(
  "/api/schedules",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const input = scheduleSchema.parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const schedule: Schedule = { id: id(), companyId: tenant, ...input };
      db.schedules.push(schedule);
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Ish grafigi yaratildi", "schedule", schedule.id),
      );
      return schedule;
    });
    res.status(201).json(row);
  }),
);
app.put(
  "/api/schedules/:id",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const input = scheduleSchema.parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const schedule = db.schedules.find(
        (s) => s.id === req.params.id && s.companyId === tenant,
      );
      if (!schedule) throw httpError("Grafik topilmadi.", 404);
      const before = { ...schedule };
      Object.assign(schedule, input);
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Ish grafigi yangilandi",
          "schedule",
          schedule.id,
          before,
          schedule,
        ),
      );
      return schedule;
    });
    res.json(row);
  }),
);
app.delete(
  "/api/schedules/:id",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    await updateDb((db) => {
      const schedule = db.schedules.find(
        (s) => s.id === req.params.id && s.companyId === tenant,
      );
      if (!schedule) throw httpError("Grafik topilmadi.", 404);
      if (
        db.employees.some(
          (e) => e.scheduleId === schedule.id && occupiesSlot(e),
        )
      )
        throw httpError("Bu grafikdan xodimlar foydalanmoqda.", 409);
      db.schedules = db.schedules.filter((s) => s.id !== schedule.id);
      for (const branch of db.branches)
        if (branch.scheduleId === schedule.id) branch.scheduleId = "";
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Ish grafigi o‘chirildi", "schedule", schedule.id),
      );
    });
    res.json({ ok: true });
  }),
);

// --------------------------------------------------------------- leave ---
app.get(
  "/api/leave",
  requirePermission("leave.view"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const scope = branchScope(req, db);
    const employeeBranch = new Map(db.employees.filter((e) => e.companyId === tenant).map((e) => [e.id, e.branchId]));
    res.json(
      db.leaveRequests
        .filter((l) => l.companyId === tenant && inScope(scope, employeeBranch.get(l.employeeId)))
        .map((l) => ({
          ...l,
          employee: db.employees.find((e) => e.id === l.employeeId),
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }),
);
app.post(
  "/api/leave",
  requirePermission("leave.view"),
  asyncRoute(async (req, res) => {
    const input = z
        .object({
          employeeId: z.string(),
          type: z.enum(["VACATION", "SICK", "PERMISSION", "UNPAID", "OTHER"]),
          startDate: dateSchema,
          endDate: dateSchema,
          reason: z.string().trim().min(3),
          approve: z.boolean().optional(),
        })
        .refine((v) => v.endDate >= v.startDate, {
          message: "Tugash sanasi boshlanishdan oldin bo‘lishi mumkin emas.",
        })
        .parse(req.body),
      tenant = companyId(req);
    const autoApprove = input.approve && can(req.session!.role, "leave.approve");
    const row = await updateDb((db) => {
      if (
        !db.employees.some(
          (e) => e.id === input.employeeId && e.companyId === tenant,
        )
      )
        throw httpError("Xodim topilmadi.", 404);
      const { approve: _approve, ...data } = input;
      const leave: LeaveRequest = {
        id: id(),
        companyId: tenant,
        ...data,
        status: autoApprove ? "APPROVED" : "PENDING",
        decidedBy: autoApprove ? req.session!.name : undefined,
        createdAt: new Date().toISOString(),
      };
      db.leaveRequests.push(leave);
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Ta’til so‘rovi yaratildi", "leave", leave.id),
      );
      return leave;
    });
    res.status(201).json(row);
  }),
);
app.patch(
  "/api/leave/:id",
  requirePermission("leave.approve"),
  asyncRoute(async (req, res) => {
    const { status } = z
        .object({ status: z.enum(["APPROVED", "REJECTED", "CANCELLED"]) })
        .parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const leave = db.leaveRequests.find(
        (l) => l.id === req.params.id && l.companyId === tenant,
      );
      if (!leave) throw httpError("So‘rov topilmadi.", 404);
      const before = leave.status;
      leave.status = status;
      leave.decidedBy = req.session!.name;
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          `Ta’til so‘rovi: ${status}`,
          "leave",
          leave.id,
          { status: before },
          { status },
        ),
      );
      const employee = db.employees.find((item) => item.id === leave.employeeId);
      if (employee && status !== "CANCELLED")
        db.notifications.unshift({
          id: id(),
          companyId: tenant,
          employeeId: employee.id,
          title:
            status === "APPROVED"
              ? "Ta’til so‘rovingiz tasdiqlandi"
              : "Ta’til so‘rovingiz rad etildi",
          body: `${leave.startDate} – ${leave.endDate}`,
          type: "LEAVE",
          read: false,
          createdAt: new Date().toISOString(),
        });
      return { leave, employee };
    });
    if (row.employee && status !== "CANCELLED") {
      const label = status === "APPROVED" ? "tasdiqlandi ✅" : "rad etildi ❌";
      // Sozlamadagi yo‘nalish bo‘yicha: Staffora boti va/yoki xodimlar boti.
      void notifyEmployee(
        await readDb(),
        row.employee,
        "leave",
        `Ta’til so‘rovingiz ${label}\n📅 ${row.leave.startDate} – ${row.leave.endDate}`,
      ).catch(console.error);
    }
    res.json(row.leave);
  }),
);

// ---------------------------------------------------- audit & messages ---
app.get(
  "/api/audit",
  requirePermission("audit.view"),
  asyncRoute(async (req, res) => {
    const rows = await queryAuditLogs(companyId(req), { limit: 300 });
    res.json(rows.map(({ before: _b, after: _a, ...rest }) => rest));
  }),
);
app.get(
  "/api/notifications",
  asyncRoute(async (req, res) => {
    const db = await readDb();
    res.json(
      db.notifications
        .filter((n) => n.companyId === companyId(req) && !n.employeeId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 200),
    );
  }),
);
app.patch(
  "/api/notifications/read-all",
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    await updateDb((db) => {
      for (const n of db.notifications)
        if (n.companyId === tenant && !n.employeeId) n.read = true;
    });
    res.json({ ok: true });
  }),
);
app.patch(
  "/api/notifications/:id/read",
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    await updateDb((db) => {
      const n = db.notifications.find(
        (x) => x.id === req.params.id && x.companyId === tenant,
      );
      if (n) n.read = true;
    });
    res.json({ ok: true });
  }),
);
app.get(
  "/api/announcements",
  asyncRoute(async (req, res) => {
    const db = await readDb();
    res.json(
      db.announcements
        .filter((a) => a.companyId === companyId(req))
        .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)),
    );
  }),
);
app.post(
  "/api/announcements",
  requirePermission("announcements.create"),
  asyncRoute(async (req, res) => {
    const input = z
        .object({
          title: z.string().trim().min(3).max(200),
          message: z.string().trim().min(5).max(3500),
          audience: z.string().optional(),
          branchId: z.string().optional(),
          // WEB/TELEGRAM — eski nomlar; STAFFORA = ichki bildirishnoma, BOT = xodimlar boti.
          channel: z.array(z.enum(["WEB", "TELEGRAM", "STAFFORA", "BOT"])).min(1),
          target: z
            .object({
              type: z.enum(["ALL", "BRANCHES", "DEPARTMENTS", "POSITIONS", "EMPLOYEES"]),
              ids: z.array(z.string()).max(5000).default([]),
            })
            .optional(),
        })
        .parse(req.body),
      tenant = companyId(req);
    const channels = [...new Set(input.channel.map((c) => (c === "WEB" ? "STAFFORA" : c)))];
    const target: AnnouncementTarget =
      input.target || (input.branchId ? { type: "BRANCHES", ids: [input.branchId] } : { type: "ALL", ids: [] });
    if (target.type !== "ALL" && !target.ids.length)
      throw httpError("Qabul qiluvchilarni tanlang.", 400);
    const row = await updateDb((db) => {
      if (channels.includes("BOT") && !activeIntegration(db, tenant))
        throw httpError("Xodimlar boti ulanmagan — «Xodimlar boti» kanalini tanlab bo‘lmaydi.", 400);
      const now = new Date().toISOString();
      const recipients = targetEmployees(db, tenant, target);
      const value: Announcement = {
        id: id(),
        companyId: tenant,
        title: input.title,
        message: input.message,
        audience: targetLabel(db, tenant, target),
        channel: channels,
        target,
        createdBy: req.session!.name,
        scheduledAt: now,
        status: "SENT",
        report: {},
      };
      if (channels.includes("STAFFORA")) {
        for (const employee of recipients)
          db.notifications.unshift({
            id: id(),
            companyId: tenant,
            employeeId: employee.id,
            title: `📢 ${input.title}`,
            body: input.message,
            type: "ANNOUNCEMENT",
            read: false,
            createdAt: now,
          });
        value.report!.staffora = { recipients: recipients.length, delivered: recipients.length };
      }
      db.announcements.unshift(value);
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, `E’lon yuborildi (${channels.join(", ")})`, "announcement", value.id, undefined, { audience: value.audience, recipients: recipients.length }),
      );
      return {
        value,
        telegramIds: recipients
          .filter((item) => item.telegramConnected && item.telegramId && !item.telegramId.startsWith("dev"))
          .map((item) => item.telegramId!),
      };
    });
    let delivered = 0;
    if (channels.includes("TELEGRAM")) {
      const results = await Promise.allSettled(
        row.telegramIds.map((telegramId) =>
          sendTelegramMessage(telegramId, `📢 ${row.value.title}\n\n${row.value.message}`),
        ),
      );
      delivered = results.filter((r) => r.status === "fulfilled" && r.value).length;
      await updateDb((db) => {
        const a = db.announcements.find((x) => x.id === row.value.id);
        if (a) a.report = { ...(a.report || {}), telegram: { recipients: row.telegramIds.length, delivered, failed: row.telegramIds.length - delivered } };
      });
    }
    if (channels.includes("BOT")) await enqueueAnnouncementToBot(row.value.id);
    const db = await readDb();
    res.status(201).json({ ...db.announcements.find((a) => a.id === row.value.id), delivered });
  }),
);
app.get(
  "/api/announcements/:id",
  asyncRoute(async (req, res) => {
    const db = await readDb();
    const row = db.announcements.find((a) => a.id === req.params.id && a.companyId === companyId(req));
    if (!row) throw httpError("E’lon topilmadi.", 404);
    res.json(row);
  }),
);

// ------------------------------------------------------------- reports ---
function periodFromQuery(req: Request) {
  const today = tashkentIsoDate();
  const from = req.query.from ? dateSchema.parse(String(req.query.from)) : `${today.slice(0, 7)}-01`;
  const to = req.query.to ? dateSchema.parse(String(req.query.to)) : today;
  return { from, to };
}
app.get(
  "/api/reports/attendance.csv",
  requirePermission("reports.export"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const { from, to } = periodFromQuery(req);
    const lateOnly = req.query.type === "late";
    const rows = db.attendance
      .filter(
        (a) =>
          a.companyId === tenant &&
          a.date >= from &&
          a.date <= to &&
          (!lateOnly || a.lateMinutes > 0),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    sendCsv(res, `staffora-davomat-${from}_${to}.csv`, [
      [
        "Xodim ID",
        "Xodim",
        "Filial",
        "Sana",
        "Reja",
        "Kelish",
        "Ketish",
        "Holat",
        "Kechikish (daq)",
        "Erta ketish (daq)",
        "Ishlangan (daq)",
        "Qo‘shimcha (daq)",
        "Tasdiq",
        "Izoh",
      ],
      ...rows.map((a) => {
        const e = db.employees.find((x) => x.id === a.employeeId);
        return [
          e?.employeeNo,
          `${e?.firstName || ""} ${e?.lastName || ""}`.trim(),
          db.branches.find((b) => b.id === a.branchId)?.name,
          a.date,
          `${a.scheduledStart}-${a.scheduledEnd}`,
          a.checkIn,
          a.checkOut,
          a.status,
          a.lateMinutes,
          a.earlyLeaveMinutes,
          a.workedMinutes,
          a.overtimeMinutes,
          a.verification.join(" "),
          a.note,
        ];
      }),
    ]);
  }),
);
app.get(
  "/api/reports/employees.csv",
  requirePermission("reports.export"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    sendCsv(res, "staffora-xodimlar.csv", [
      [
        "Xodim ID",
        "Ism",
        "Familiya",
        "Telefon",
        "Email",
        "Filial",
        "Bo‘lim",
        "Lavozim",
        "Telegram",
        "Face ID",
        "Holat",
      ],
      ...db.employees
        .filter((e) => e.companyId === tenant)
        .map((e) => [
          e.employeeNo,
          e.firstName,
          e.lastName,
          e.phone,
          e.email,
          db.branches.find((b) => b.id === e.branchId)?.name || "",
          db.departments.find((d) => d.id === e.departmentId)?.name || "",
          db.positions.find((p) => p.id === e.positionId)?.name || "",
          e.telegramConnected ? "Ulangan" : "Ulanmagan",
          e.faceEnrolledAt ? "Faol" : "Yo‘q",
          e.status,
        ]),
    ]);
  }),
);

app.get(
  "/api/payroll",
  requirePermission("payroll.view"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const month = z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .parse(String(req.query.month || tashkentIsoDate().slice(0, 7)));
    const settings = normalizePayrollSettings(
      db.companies.find((c) => c.id === tenant)?.payroll,
    );
    // Yopilgan oy — muzlatilgan raqamlar; ochiq oy — jonli hisob.
    res.json({
      month,
      settings,
      rule: penaltyText(settings),
      rows: payrollRows(db, tenant, month),
      closed: closedPeriod(db, tenant, month) || null,
    });
  }),
);
app.get(
  "/api/reports/payroll.csv",
  requirePermission("reports.export"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const month = z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .parse(String(req.query.month || tashkentIsoDate().slice(0, 7)));
    sendCsv(res, `staffora-ish-haqi-${month}.csv`, [
      [
        "Xodim ID",
        "Xodim",
        "Ish kunlari",
        "Ishlangan (soat)",
        "Bazaviy",
        "Qo‘shimcha ish",
        "Kechikish ushlanmasi",
        "Sof summa",
      ],
      ...payrollRows(db, tenant, month).map((x) => [
        x.employee.employeeNo,
        `${x.employee.firstName} ${x.employee.lastName}`,
        x.days,
        (x.workedMinutes / 60).toFixed(1),
        x.base,
        x.overtimeAmount,
        x.deduction,
        x.net,
      ]),
    ]);
  }),
);

registerExcelReports(app, {
  requirePermission: requirePermission as unknown as (
    permission: string,
  ) => express.RequestHandler,
  companyId: companyId as (req: Request) => string,
});

app.put(
  "/api/company/payroll",
  requireAnyPermission("settings.manage", "payroll.edit"),
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        latePenaltyMode: z.enum(["NONE", "HOURLY", "PER_MINUTE"]),
        latePenaltyPerMinute: z.coerce.number().min(0).max(10_000_000),
        freeLateMinutesPerMonth: z.coerce.number().min(0).max(10_000),
        monthlyHours: z.coerce.number().min(1).max(400),
        overtimePay: z.boolean(),
        absencePenalty: z.enum(["NONE", "DAILY"]).default("NONE"),
        overtimeRequiresApproval: z.boolean().default(false),
      })
      .parse(req.body);
    const tenant = companyId(req);
    const settings = normalizePayrollSettings(input);
    await updateDb((db) => {
      const company = db.companies.find((c) => c.id === tenant);
      if (!company) throw httpError("Kompaniya topilmadi.", 404);
      const before = company.payroll;
      company.payroll = settings;
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Ish haqi / jarima sozlamalari o‘zgartirildi", "company", tenant, before, settings),
      );
    });
    res.json(settings);
  }),
);

app.get(
  "/api/company/photo-channel",
  requirePermission("settings.manage"),
  asyncRoute(async (req, res) => {
    const db = await readDb();
    const tenant = companyId(req);
    const company = db.companies.find((c) => c.id === tenant);
    const queue = db.photoQueue.filter((j) => j.companyId === tenant);
    res.json({
      settings: company?.photoChannel || { enabled: false, chatId: "", retentionDays: 30 },
      pending: queue.length,
      lastError: queue.find((j) => j.lastError)?.lastError,
      sent: db.channelPosts.filter((p) => p.companyId === tenant).length,
      botUsername: telegramBotUsername(),
    });
  }),
);
app.post(
  "/api/company/photo-channel/test",
  requirePermission("settings.manage"),
  asyncRoute(async (req, res) => {
    const { chatId } = z.object({ chatId: z.string().trim().min(2, "Kanal ID yoki @username kiriting.") }).parse(req.body);
    res.json(await testPhotoChannel(chatId));
  }),
);
app.put(
  "/api/company/photo-channel",
  requirePermission("settings.manage"),
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        enabled: z.boolean(),
        chatId: z.string().trim().max(100).default(""),
        retentionDays: z.coerce.number().int().min(0).max(3650),
      })
      .parse(req.body);
    const tenant = companyId(req);
    let chatId = input.chatId;
    let chatTitle: string | undefined;
    if (input.enabled) {
      if (!chatId) throw httpError("Kanal ID yoki @username kiriting.", 400);
      const checked = await testPhotoChannel(chatId);
      chatId = checked.chatId;
      chatTitle = checked.title;
    }
    const settings = await updateDb((db) => {
      const company = db.companies.find((c) => c.id === tenant);
      if (!company) throw httpError("Kompaniya topilmadi.", 404);
      company.photoChannel = {
        enabled: input.enabled,
        chatId,
        chatTitle: chatTitle || company.photoChannel?.chatTitle,
        retentionDays: input.retentionDays,
      };
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Rasm kanali sozlamasi o‘zgartirildi", "company", tenant),
      );
      return company.photoChannel;
    });
    res.json(settings);
  }),
);

// ------------------------------------------------------------------ QR ---
const QR_LIFETIME_SECONDS = 90;
const QR_REFRESH_SECONDS = 30;
app.get(
  "/api/qr/:branchId",
  requirePermission("attendance.view"),
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    const now = Date.now();
    const value = await updateDb((db) => {
      const branch = db.branches.find(
        (item) => item.id === req.params.branchId && item.companyId === tenant,
      );
      if (!branch || !inScope(branchScope(req, db), branch.id)) throw httpError("Filial topilmadi.", 404);
      const nonce = id();
      const expiresAt = new Date(now + QR_LIFETIME_SECONDS * 1000).toISOString();
      db.qrNonces = db.qrNonces.filter(
        (item) => new Date(item.expiresAt).getTime() > now,
      );
      db.qrNonces.push({
        id: id(),
        companyId: tenant,
        branchId: branch.id,
        nonce,
        expiresAt,
        usedEmployeeIds: [],
      });
      const token = jwt.sign(
        { companyId: tenant, branchId: branch.id, nonce, type: "ATTENDANCE_QR" },
        process.env.QR_SIGNING_SECRET || "staffora-local-qr-secret-change-me",
        { expiresIn: QR_LIFETIME_SECONDS },
      );
      const today = tashkentIsoDate();
      const present = db.attendance.filter(
        (a) => a.branchId === branch.id && a.date === today && a.checkIn,
      );
      return {
        branch,
        token,
        stats: {
          in: present.filter((a) => !a.checkOut).length,
          total: db.employees.filter(
            (e) => e.branchId === branch.id && e.status === "ACTIVE",
          ).length,
        },
      };
    });
    const dataUrl = await QRCode.toDataURL(value.token, {
      width: 560,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0b1f1a", light: "#ffffff" },
    });
    res.json({
      branch: value.branch,
      stats: value.stats,
      dataUrl,
      refreshAt: now + QR_REFRESH_SECONDS * 1000,
      refreshSeconds: QR_REFRESH_SECONDS,
    });
  }),
);

// --------------------------------------------------------- panel users ---
const assignableRoles = [
  "HR_ADMIN",
  "HR_MANAGER",
  "FINANCE",
  "IT_ADMIN",
  "BRANCH_MANAGER",
] as const;
app.get(
  "/api/users",
  requirePermission("settings.manage"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    res.json(
      db.users
        .filter((u) => u.companyId === tenant)
        .map(({ passwordHash: _hash, ...user }) => user),
    );
  }),
);
app.post(
  "/api/users",
  requireRole("COMPANY_OWNER", "HR_ADMIN"),
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2),
        email: z.string().trim().email(),
        password: z.string().min(10, "Parol kamida 10 belgi bo‘lsin."),
        role: z.enum(assignableRoles),
        branchIds: z.array(z.string()).max(500).optional(),
      })
      .parse(req.body);
    const tenant = companyId(req);
    const { branchIds, ...userInput } = input;
    const user = await createUser({ ...userInput, companyId: tenant });
    await updateDb((db) => {
      if (db.users.some((u) => u.email === user.email))
        throw httpError("Bu email bilan foydalanuvchi mavjud.", 409);
      if (input.role === "BRANCH_MANAGER")
        user.branchIds = (branchIds || []).filter((id) => db.branches.some((b) => b.id === id && b.companyId === tenant));
      db.users.push(user);
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, `Panel foydalanuvchisi qo‘shildi (${input.role})`, "user", user.id),
      );
    });
    const { passwordHash: _hash, ...safe } = user;
    res.status(201).json(safe);
  }),
);
app.put(
  "/api/users/:id",
  requireRole("COMPANY_OWNER", "HR_ADMIN"),
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(3, "Ism familiya kamida 3 harf.").max(80),
        role: z.enum(assignableRoles).optional(),
        branchIds: z.array(z.string()).max(500).optional(),
      })
      .parse(req.body);
    const tenant = companyId(req);
    const user = await updateDb((db) => {
      const row = db.users.find(
        (u) => u.id === req.params.id && u.companyId === tenant,
      );
      if (!row) throw httpError("Foydalanuvchi topilmadi.", 404);
      if (input.role && row.role === "COMPANY_OWNER")
        throw httpError("Kompaniya egasining rolini o‘zgartirib bo‘lmaydi.", 409);
      const before = { name: row.name, role: row.role };
      row.name = input.name;
      if (input.role) row.role = input.role;
      // Filial rahbariga biriktirilgan filiallar (boshqa rollarda kerak emas).
      if (input.branchIds)
        row.branchIds = input.branchIds.filter((id) => db.branches.some((b) => b.id === id && b.companyId === tenant));
      if (row.role !== "BRANCH_MANAGER") row.branchIds = undefined;
      if (row.role === "COMPANY_OWNER") {
        const company = db.companies.find((c) => c.id === tenant);
        if (company) company.ownerName = input.name;
      }
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Panel foydalanuvchisi tahrirlandi", "user", row.id, before, { name: row.name, role: row.role }),
      );
      return row;
    });
    const { passwordHash: _hash, ...safe } = user;
    res.json(safe);
  }),
);
app.delete(
  "/api/users/:id",
  requireRole("COMPANY_OWNER", "HR_ADMIN"),
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    await updateDb((db) => {
      const user = db.users.find(
        (u) => u.id === req.params.id && u.companyId === tenant,
      );
      if (!user) throw httpError("Foydalanuvchi topilmadi.", 404);
      if (user.role === "COMPANY_OWNER" || user.id === req.session!.userId)
        throw httpError("Bu foydalanuvchini o‘chirib bo‘lmaydi.", 409);
      db.users = db.users.filter((u) => u.id !== user.id);
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "Panel foydalanuvchisi o‘chirildi", "user", user.id),
      );
    });
    res.json({ ok: true });
  }),
);

// --------------------------------------------------------- super admin ---
app.get(
  "/api/admin/overview",
  requireRole("SUPER_ADMIN"),
  asyncRoute(async (_req, res) => {
    const db = await readDb();
    const today = tashkentIsoDate();
    res.json({
      stats: {
        companies: db.companies.length,
        active: db.companies.filter((c) => c.status === "ACTIVE").length,
        trial: db.companies.filter((c) => c.status === "TRIAL").length,
        employees: db.employees.filter((e) => e.status === "ACTIVE").length,
        eventsToday: db.attendance.filter((a) => a.date === today).length,
      },
      telegram: getTelegramBotState(),
      companies: db.companies.map((c) => ({
        ...c,
        employees: db.employees.filter(
          (e) => e.companyId === c.id && e.status === "ACTIVE",
        ).length,
        bot: undefined,
        registrationForm: undefined,
        branches: db.branches.filter((b) => b.companyId === c.id).length,
        owner: db.users.find(
          (u) => u.companyId === c.id && u.role === "COMPANY_OWNER",
        )?.email,
      })),
    });
  }),
);
app.post(
  "/api/admin/companies",
  requireRole("SUPER_ADMIN"),
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2),
        ownerName: z.string().trim().min(2),
        ownerEmail: z.string().trim().email(),
        ownerPassword: z.string().min(10, "Parol kamida 10 belgi bo‘lsin."),
        plan: z.string().min(2),
        status: z.enum(["ACTIVE", "TRIAL", "SUSPENDED"]),
        employeeLimit: z.coerce.number().int().min(1).max(1_000_000).optional(),
        limitContact: z.string().trim().max(80).optional(),
      })
      .parse(req.body);
    const company = createCompany(input);
    if (input.employeeLimit) company.employeeLimit = input.employeeLimit;
    if (input.limitContact) company.limitContact = input.limitContact;
    const owner = await createUser({
      companyId: company.id,
      name: input.ownerName,
      email: input.ownerEmail,
      password: input.ownerPassword,
      role: "COMPANY_OWNER",
    });
    await updateDb((db) => {
      if (db.companies.some((c) => c.slug === company.slug))
        company.slug = `${company.slug}-${Date.now().toString(36)}`;
      if (db.users.some((u) => u.email === owner.email))
        throw httpError("Bu email bilan foydalanuvchi mavjud.", 409);
      db.companies.push(company);
      db.users.push(owner);
    });
    res.status(201).json(company);
  }),
);
app.patch(
  "/api/admin/companies/:id",
  requireRole("SUPER_ADMIN"),
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        status: z.enum(["ACTIVE", "TRIAL", "SUSPENDED"]).optional(),
        plan: z.string().min(2).optional(),
        // null — cheklovsiz
        employeeLimit: z.union([z.coerce.number().int().min(1).max(1_000_000), z.null()]).optional(),
        limitContact: z.string().trim().max(80).optional(),
      })
      .parse(req.body);
    const row = await updateDb((db) => {
      const company = db.companies.find((c) => c.id === req.params.id);
      if (!company) throw httpError("Kompaniya topilmadi.", 404);
      const before = { plan: company.plan, status: company.status, employeeLimit: company.employeeLimit };
      const { employeeLimit, limitContact, ...rest } = input;
      Object.assign(company, rest);
      if (employeeLimit !== undefined) company.employeeLimit = employeeLimit ?? undefined;
      if (limitContact !== undefined) company.limitContact = limitContact || undefined;
      db.auditLogs.unshift(audit(company.id, req.session!.name, "Super admin tarifni o‘zgartirdi", "company", company.id, before, { plan: company.plan, status: company.status, employeeLimit: company.employeeLimit }));
      return { ...company, bot: undefined, registrationForm: undefined };
    });
    res.json(row);
  }),
);

app.use("/api", (_req, res) =>
  res.status(404).json({ message: "API manzili topilmadi." }),
);

const dist = path.join(process.cwd(), "dist");
if (existsSync(dist)) {
  app.use(
    express.static(dist, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`))
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        else if (filePath.includes(`${path.sep}face-models${path.sep}`))
          res.setHeader("Cache-Control", "public, max-age=604800");
      },
    }),
  );
  app.get("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(dist, "index.html"));
  });
}
app.use(
  (
    error: Error & { status?: number; issues?: unknown },
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    if (error instanceof z.ZodError) {
      const first = error.issues[0];
      const field = first?.path.length ? fieldLabels[String(first.path[0])] : "";
      return res.status(400).json({
        message: `${field ? `${field}: ` : ""}${first?.message || "Kiritilgan ma’lumotlarni tekshiring."}`,
        issues: error.flatten(),
      });
    }
    if (!error.status || error.status >= 500) console.error(error);
    res.status(error.status || 500).json({
      message: error.status
        ? error.message
        : "Kutilmagan xatolik yuz berdi. Qayta urinib ko‘ring.",
    });
  },
);

const server = app.listen(port, () =>
  console.log(`Staffora API http://localhost:${port}`),
);
// Osilib qolgan ulanishlar resurslarni band qilmasin (proksi keep-alive’dan uzunroq).
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 60_000;
// Bazani oldindan yuklab qo‘yamiz — birinchi foydalanuvchi kutmasin.
void readDb().catch((error) => console.error("Bazani yuklashda xato", error));
void startTelegramBot();
startAttendanceReminders();
startPhotoChannelWorker();
startIntegrationWorker();
void startCompanyBots();
void updateDb((db) => {
  const fixed = new Map<string, number>();
  for (const employee of db.employees)
    if (alignDepartment(db, employee)) fixed.set(employee.companyId, (fixed.get(employee.companyId) || 0) + 1);
  for (const [tenant, count] of fixed)
    db.auditLogs.unshift(audit(tenant, "Tizim", `Xodimlar bo‘limi lavozimiga moslandi (${count} ta)`, "company", tenant));
}).catch((error) => console.error("Bo‘limlarni moslashda xato", error));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.all([stopTelegramBot(), stopAllCompanyBots()])
      .catch(() => undefined)
      .then(() => flushDb())
      .finally(() => {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5_000).unref();
      });
  });
}
