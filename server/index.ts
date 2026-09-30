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
import { existsSync } from "node:fs";
import { audit, checkDatabaseHealth, readDb, updateDb } from "../lib/store";
import { calculateAttendance, isValidClockTime } from "../lib/attendance";
import {
  dateParts,
  tashkentClock,
  tashkentIsoDate,
} from "../lib/format";
import { can } from "../lib/permissions";
import { createCompany, createUser } from "../lib/seed";
import type {
  Attendance,
  Branch,
  Database,
  Employee,
  LeaveRequest,
  Schedule,
} from "../lib/types";
import {
  requireAuth,
  requireRole,
  signSession,
  type AuthedRequest,
  type Session,
} from "./auth";
import {
  getTelegramBotState,
  sendTelegramMessage,
  startTelegramBot,
  stopTelegramBot,
  telegramBotUsername,
  telegramWebhook,
} from "./telegram";
import { createMiniRouter } from "./mini-routes";
import { startAttendanceReminders } from "./reminders";

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
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/health", async (_req, res) => {
  try {
    const database = await checkDatabaseHealth();
    const telegram = getTelegramBotState();
    res.status(database ? 200 : 503).json({
      status: database ? "ok" : "degraded",
      database: database ? "sqlite-ready" : "sqlite-error",
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
  res.cookie("staffora_session", signSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 12 * 3600_000,
  });
}

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
    const session: Session = {
      userId: user.id,
      companyId: user.companyId,
      name: user.name,
      email: user.email,
      role: user.role,
    };
    setSessionCookie(res, session);
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
    const session: Session = {
      userId: user.id,
      companyId: user.companyId,
      name: user.name,
      email: user.email,
      role: user.role,
      photoDataUrl: user.photoDataUrl,
    };
    setSessionCookie(res, session);
    return res.json({
      user: session,
      redirect: user.role === "SUPER_ADMIN" ? "/super-admin" : "/dashboard",
    });
  }),
);
app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("staffora_session");
  res.json({ ok: true });
});
app.get("/api/auth/me", requireAuth, (req: AuthedRequest, res) =>
  res.json({ user: req.session }),
);

app.use("/api", createMiniRouter());
app.use("/api", requireAuth);

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
    const session = { ...req.session!, photoDataUrl: user.photoDataUrl };
    delete (session as { iat?: number }).iat;
    delete (session as { exp?: number }).exp;
    delete (session as { iss?: string }).iss;
    setSessionCookie(res, session);
    return res.json({ user: session });
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
    res.json({
      branches: db.branches.filter((x) => x.companyId === tenant),
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
    res.json(db.companies.find((c) => c.id === companyId(req)));
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
          (e) => e.departmentId === value.id && e.status !== "ARCHIVED",
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
          (e) => e.positionId === value.id && e.status !== "ARCHIVED",
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
  | "IN"
  | "LEFT"
  | "ABSENT"
  | "ON_LEAVE"
  | "DAY_OFF"
  | "NOT_YET"
  | "UPCOMING";

function dayRoster(db: Database, tenant: string, date: string) {
  const today = tashkentIsoDate();
  const nowClock = tashkentClock();
  const weekday = dateParts(date).weekday;
  return db.employees
    .filter(
      (employee) =>
        employee.companyId === tenant &&
        (employee.status === "ACTIVE" ||
          db.attendance.some(
            (a) => a.employeeId === employee.id && a.date === date,
          )) &&
        employee.startDate <= date,
    )
    .map((employee) => {
      const record = db.attendance.find(
        (a) => a.employeeId === employee.id && a.date === date,
      );
      const schedule = db.schedules.find((s) => s.id === employee.scheduleId);
      const day = schedule?.days.find((d) => d.day === weekday);
      const leave = db.leaveRequests.find(
        (l) =>
          l.employeeId === employee.id &&
          l.status === "APPROVED" &&
          l.startDate <= date &&
          l.endDate >= date,
      );
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
      return {
        employee,
        record: record || null,
        state,
        late: (record?.lateMinutes || 0) > 0,
        leaveType: leave?.type,
        scheduledStart: record?.scheduledStart || (day?.enabled ? day.start : undefined),
        scheduledEnd: record?.scheduledEnd || (day?.enabled ? day.end : undefined),
        branch: db.branches.find((b) => b.id === employee.branchId)?.name,
        department: db.departments.find((d) => d.id === employee.departmentId)
          ?.name,
        position: db.positions.find((p) => p.id === employee.positionId)?.name,
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
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const today = tashkentIsoDate();
    const roster = dayRoster(db, tenant, today);
    const weekly = Array.from({ length: 7 }, (_, index) => {
      const date = tashkentIsoDate(
        new Date(Date.now() - (6 - index) * 86_400_000),
      );
      const stats = rosterStats(dayRoster(db, tenant, date));
      return {
        date,
        present: stats.present - stats.late,
        late: stats.late,
        absent: stats.absent,
      };
    });
    const employees = db.employees.filter(
      (e) => e.companyId === tenant && e.status === "ACTIVE",
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
    let rows = db.employees.filter((e) => e.companyId === tenant);
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
    if (req.query.status)
      rows = rows.filter((e) => e.status === req.query.status);
    else rows = rows.filter((e) => e.status !== "ARCHIVED");
    const page = Math.max(1, Number(req.query.page || 1)),
      limit = Math.min(200, Math.max(1, Number(req.query.limit || 12))),
      total = rows.length;
    rows.sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
    );
    const today = tashkentIsoDate();
    const items = rows
      .slice((page - 1) * limit, page * limit)
      .map((employee) => ({
        ...employee,
        todayAttendance: db.attendance.find(
          (item) => item.employeeId === employee.id && item.date === today,
        ),
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
    if (!employee) return res.status(404).json({ message: "Xodim topilmadi." });
    res.json({
      employee,
      attendance: db.attendance
        .filter((a) => a.companyId === tenant && a.employeeId === employee.id)
        .sort((a, b) => b.date.localeCompare(a.date)),
      leave: db.leaveRequests
        .filter((l) => l.companyId === tenant && l.employeeId === employee.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      activity: db.auditLogs
        .filter((a) => a.companyId === tenant && a.entityId === employee.id)
        .slice(0, 50)
        .map(({ before: _b, after: _a, ...rest }) => rest),
      faceSamples:
        db.faceProfiles.find((f) => f.employeeId === employee.id)?.samples
          ?.length || 0,
    });
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
    const rows = dayRoster(db, tenant, date);
    res.json({ date, stats: rosterStats(rows), rows });
  }),
);
app.get(
  "/api/attendance",
  requirePermission("attendance.view"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    let rows = db.attendance.filter((a) => a.companyId === tenant);
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
      if (!employee) throw httpError("Xodim topilmadi.", 404);
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
      const day = schedule?.days.find(
        (d) => d.day === dateParts(input.date).weekday,
      );
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
      if (!record) throw httpError("Davomat yozuvi topilmadi.", 404);
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
      if (!record) throw httpError("Davomat yozuvi topilmadi.", 404);
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
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const today = tashkentIsoDate();
    res.json(
      db.branches
        .filter((b) => b.companyId === tenant)
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
          (e) => e.branchId === branch.id && e.status !== "ARCHIVED",
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
          (e) => e.scheduleId === schedule.id && e.status !== "ARCHIVED",
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
    res.json(
      db.leaveRequests
        .filter((l) => l.companyId === tenant)
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
    if (row.employee?.telegramId && status !== "CANCELLED") {
      const label = status === "APPROVED" ? "tasdiqlandi ✅" : "rad etildi ❌";
      void sendTelegramMessage(
        row.employee.telegramId,
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
    const db = await readDb();
    res.json(
      db.auditLogs
        .filter((a) => a.companyId === companyId(req))
        .slice(0, 300)
        .map(({ before: _b, after: _a, ...rest }) => rest),
    );
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
          title: z.string().trim().min(3),
          message: z.string().trim().min(5),
          audience: z.string().default("Barcha xodimlar"),
          branchId: z.string().optional(),
          channel: z.array(z.enum(["WEB", "TELEGRAM"])).min(1),
        })
        .parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const now = new Date().toISOString();
      const branch = input.branchId
        ? db.branches.find(
            (b) => b.id === input.branchId && b.companyId === tenant,
          )
        : undefined;
      const value = {
        id: id(),
        companyId: tenant,
        title: input.title,
        message: input.message,
        audience: branch ? `${branch.name} filiali` : input.audience,
        channel: input.channel,
        scheduledAt: now,
        status: "SENT" as const,
      };
      db.announcements.unshift(value);
      const recipients = db.employees.filter(
        (item) =>
          item.companyId === tenant &&
          item.status === "ACTIVE" &&
          (!branch || item.branchId === branch.id),
      );
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
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, "E’lon yuborildi", "announcement", value.id),
      );
      return {
        value,
        telegramIds: recipients
          .filter((item) => item.telegramConnected && item.telegramId)
          .map((item) => item.telegramId!),
      };
    });
    let delivered = 0;
    if (row.value.channel.includes("TELEGRAM")) {
      const results = await Promise.allSettled(
        row.telegramIds.map((telegramId) =>
          sendTelegramMessage(
            telegramId,
            `📢 ${row.value.title}\n\n${row.value.message}`,
          ),
        ),
      );
      delivered = results.filter(
        (r) => r.status === "fulfilled" && r.value,
      ).length;
    }
    res.status(201).json({ ...row.value, delivered });
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

function payrollRows(db: Database, tenant: string, month: string) {
  return db.employees
    .filter((e) => e.companyId === tenant && e.status === "ACTIVE")
    .map((e) => {
      const rows = db.attendance.filter(
        (x) => x.employeeId === e.id && x.date.startsWith(month),
      );
      const hourly = e.baseSalary / 176;
      const overtimeMinutes = rows.reduce((s, x) => s + x.overtimeMinutes, 0);
      const lateMinutes = rows.reduce((s, x) => s + x.lateMinutes, 0);
      const workedMinutes = rows.reduce((s, x) => s + x.workedMinutes, 0);
      const overtimeAmount = Math.round((overtimeMinutes / 60) * hourly);
      const deduction = Math.round((lateMinutes / 60) * hourly);
      return {
        employee: e,
        days: rows.filter((x) => x.checkIn).length,
        workedMinutes,
        overtimeMinutes,
        lateMinutes,
        base: e.baseSalary,
        overtimeAmount,
        deduction,
        net: Math.max(0, e.baseSalary + overtimeAmount - deduction),
      };
    });
}
app.get(
  "/api/payroll",
  requirePermission("employees.view"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const month = z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .parse(String(req.query.month || tashkentIsoDate().slice(0, 7)));
    res.json({ month, rows: payrollRows(db, tenant, month) });
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
      if (!branch) throw httpError("Filial topilmadi.", 404);
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
      })
      .parse(req.body);
    const tenant = companyId(req);
    const user = await createUser({ ...input, companyId: tenant });
    await updateDb((db) => {
      if (db.users.some((u) => u.email === user.email))
        throw httpError("Bu email bilan foydalanuvchi mavjud.", 409);
      db.users.push(user);
      db.auditLogs.unshift(
        audit(tenant, req.session!.name, `Panel foydalanuvchisi qo‘shildi (${input.role})`, "user", user.id),
      );
    });
    const { passwordHash: _hash, ...safe } = user;
    res.status(201).json(safe);
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
      })
      .parse(req.body);
    const company = createCompany(input);
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
      })
      .parse(req.body);
    const row = await updateDb((db) => {
      const company = db.companies.find((c) => c.id === req.params.id);
      if (!company) throw httpError("Kompaniya topilmadi.", 404);
      Object.assign(company, input);
      return company;
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
void startTelegramBot();
startAttendanceReminders();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void stopTelegramBot().finally(() => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5_000).unref();
    });
  });
}
