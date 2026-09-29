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
import { calculateAttendance } from "../lib/attendance";
import { tashkentIsoDate } from "../lib/format";
import { can } from "../lib/permissions";
import type {
  Attendance,
  Branch,
  Employee,
  LeaveRequest,
  Schedule,
} from "../lib/types";
import {
  requireAuth,
  requireRole,
  signSession,
  type AuthedRequest,
} from "./auth";
import { sendTelegramMessage, startTelegramBot } from "./telegram";
import { createMiniRouter } from "./mini-routes";

const app = express();
const port = Number(process.env.PORT || 4000);
const publicAppUrl =
  process.env.APP_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : "http://localhost:3000");

if (process.env.NODE_ENV === "production") {
  const requiredSecrets = [
    "SESSION_SECRET",
    "JWT_SECRET",
    "QR_SIGNING_SECRET",
  ] as const;
  for (const key of requiredSecrets) {
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
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy:
      process.env.NODE_ENV === "production" ? undefined : false,
  }),
);
app.use(
  cors({
    origin: publicAppUrl,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/health", async (_req, res) => {
  try {
    const database = await checkDatabaseHealth();
    res.status(database ? 200 : 503).json({
      status: database ? "ok" : "degraded",
      database: database ? "sqlite-ready" : "sqlite-error",
      uptimeSeconds: Math.round(process.uptime()),
    });
  } catch {
    res.status(503).json({ status: "error", database: "sqlite-unavailable" });
  }
});

const asyncRoute =
  (handler: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthedRequest, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req, res)).catch(next);
const id = () => crypto.randomUUID();
const companyId = (req: AuthedRequest) => {
  if (!req.session?.companyId)
    throw Object.assign(new Error("Kompaniya tanlanmagan."), { status: 403 });
  return req.session.companyId;
};
const requirePermission =
  (permission: string) =>
  (req: AuthedRequest, res: Response, next: NextFunction) =>
    can(req.session!.role, permission)
      ? next()
      : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
app.post(
  "/api/auth/login",
  rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  asyncRoute(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const db = await readDb();
    const user = db.users.find(
      (u) => u.email.toLowerCase() === input.email.toLowerCase(),
    );
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash)))
      return res.status(401).json({ message: "Email yoki parol noto‘g‘ri." });
    const session = {
      userId: user.id,
      companyId: user.companyId,
      name: user.name,
      email: user.email,
      role: user.role,
      photoDataUrl: user.photoDataUrl,
    };
    res.cookie("staffora_session", signSession(session), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 8 * 3600_000,
    });
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
      if (!row)
        throw Object.assign(new Error("Foydalanuvchi topilmadi."), {
          status: 404,
        });
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
    const session = {
      ...req.session!,
      photoDataUrl: user.photoDataUrl,
    };
    res.cookie("staffora_session", signSession(session), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 8 * 3600_000,
    });
    return res.json({ user: session });
  }),
);
app.get(
  "/api/meta",
  asyncRoute(async (req, res) => {
    const db = await readDb();
    const tenant = companyId(req);
    res.json({
      branches: db.branches.filter((x) => x.companyId === tenant),
      departments: db.departments.filter((x) => x.companyId === tenant),
      positions: db.positions.filter((x) => x.companyId === tenant),
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
        .object({ name: z.string().min(2), timezone: z.string().min(2) })
        .parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const company = db.companies.find((c) => c.id === tenant);
      if (!company)
        throw Object.assign(new Error("Kompaniya topilmadi."), { status: 404 });
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
app.post(
  "/api/departments",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const input = z
        .object({ name: z.string().min(2), manager: z.string().optional() })
        .parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const value = { id: id(), companyId: tenant, ...input };
      db.departments.push(value);
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Bo‘lim yaratildi",
          "department",
          value.id,
        ),
      );
      return value;
    });
    res.status(201).json(row);
  }),
);
app.post(
  "/api/positions",
  requirePermission("employees.edit"),
  asyncRoute(async (req, res) => {
    const input = z
        .object({ name: z.string().min(2), departmentId: z.string() })
        .parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      if (
        !db.departments.some(
          (d) => d.id === input.departmentId && d.companyId === tenant,
        )
      )
        throw Object.assign(new Error("Bo‘lim topilmadi."), { status: 404 });
      const value = { id: id(), companyId: tenant, ...input };
      db.positions.push(value);
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Lavozim yaratildi",
          "position",
          value.id,
        ),
      );
      return value;
    });
    res.status(201).json(row);
  }),
);
app.get(
  "/api/dashboard",
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req),
      employees = db.employees.filter(
        (e) => e.companyId === tenant && e.status === "ACTIVE",
      ),
      rows = db.attendance.filter((a) => a.companyId === tenant);
    const today = tashkentIsoDate();
    const attendance = rows.filter((a) => a.date === today);
    const employeesOnLeave = new Set(
      db.leaveRequests
        .filter(
          (leave) =>
            leave.companyId === tenant &&
            leave.status === "APPROVED" &&
            leave.startDate <= today &&
            leave.endDate >= today,
        )
        .map((leave) => leave.employeeId),
    );
    const count = (s: string) =>
      attendance.filter((a) => a.status === s).length;
    const enriched = attendance.map((a) => ({
      ...a,
      employee: employees.find((e) => e.id === a.employeeId),
      branch: db.branches.find((b) => b.id === a.branchId)?.name,
      department: db.departments.find(
        (d) =>
          d.id === employees.find((e) => e.id === a.employeeId)?.departmentId,
      )?.name,
      position: db.positions.find(
        (p) =>
          p.id === employees.find((e) => e.id === a.employeeId)?.positionId,
      )?.name,
    }));
    const weekly = [...new Set(rows.map((row) => row.date))]
      .sort()
      .slice(-7)
      .map((date) => {
        const dayRows = rows.filter((row) => row.date === date);
        return {
          date,
          present: dayRows.filter((row) =>
            ["PRESENT", "WORKING", "CHECKED_OUT"].includes(row.status),
          ).length,
          late: dayRows.filter((row) => row.status === "LATE").length,
          absent: dayRows.filter((row) => row.status === "ABSENT").length,
        };
      });
    res.json({
      stats: {
        total: employees.length,
        present: attendance.filter((a) =>
          ["PRESENT", "WORKING", "CHECKED_OUT"].includes(a.status),
        ).length,
        late: count("LATE"),
        absent: employees.filter(
          (employee) =>
            !employeesOnLeave.has(employee.id) &&
            !attendance.some(
              (row) =>
                row.employeeId === employee.id && row.status !== "ABSENT",
            ),
        ).length,
        leave: employeesOnLeave.size,
      },
      attendance: enriched,
      weekly,
      notifications: db.notifications
        .filter((n) => n.companyId === tenant)
        .slice(0, 5),
      leave: db.leaveRequests.filter(
        (l) => l.companyId === tenant && l.status === "PENDING",
      ).length,
    });
  }),
);

const employeeSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  phone: z.string().min(7),
  email: z.string().email(),
  employeeNo: z.string().min(2),
  departmentId: z.string(),
  positionId: z.string(),
  branchId: z.string(),
  scheduleId: z.string(),
  startDate: z.string(),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT"]),
  baseSalary: z.coerce.number().min(0),
  currency: z.string().default("UZS"),
  address: z.string().optional(),
  manager: z.string().optional(),
  telegramUsername: z.string().optional(),
  photoDataUrl: z
    .union([
      z
        .string()
        .max(700_000)
        .regex(/^data:image\/(jpeg|jpg|png|webp);base64,/),
      z.literal(""),
    ])
    .optional(),
});
app.get(
  "/api/employees",
  requirePermission("employees.view"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    let rows = db.employees.filter((e) => e.companyId === tenant);
    const q = String(req.query.q || "").toLowerCase();
    if (q)
      rows = rows.filter((e) =>
        `${e.firstName} ${e.lastName} ${e.employeeNo} ${e.phone} ${e.telegramUsername || ""}`
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
    const page = Math.max(1, Number(req.query.page || 1)),
      limit = Math.min(50, Number(req.query.limit || 10)),
      total = rows.length;
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latestDate = tashkentIsoDate();
    const items = rows
      .slice((page - 1) * limit, page * limit)
      .map((employee) => ({
        ...employee,
        todayAttendance: db.attendance.find(
          (item) => item.employeeId === employee.id && item.date === latestDate,
        ),
      }));
    res.json({
      items,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  }),
);
app.post(
  "/api/employees",
  requirePermission("employees.create"),
  asyncRoute(async (req, res) => {
    const input = employeeSchema.parse(req.body),
      tenant = companyId(req);
    const created = await updateDb((db) => {
      if (
        db.employees.some(
          (e) => e.companyId === tenant && e.employeeNo === input.employeeNo,
        )
      )
        throw Object.assign(new Error("Bu xodim ID allaqachon mavjud."), {
          status: 409,
        });
      const now = new Date().toISOString();
      const row: Employee = {
        id: id(),
        companyId: tenant,
        ...input,
        telegramConnected: false,
        deviceStatus: "PENDING",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      };
      db.employees.push(row);
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Xodim yaratildi",
          "employee",
          row.id,
          undefined,
          row,
        ),
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
      attendance: db.attendance.filter(
        (a) => a.companyId === tenant && a.employeeId === employee.id,
      ),
      leave: db.leaveRequests.filter(
        (l) => l.companyId === tenant && l.employeeId === employee.id,
      ),
      activity: db.auditLogs.filter(
        (a) => a.companyId === tenant && a.entityId === employee.id,
      ),
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
      if (index < 0)
        throw Object.assign(new Error("Xodim topilmadi."), { status: 404 });
      const before = { ...db.employees[index] };
      db.employees[index] = {
        ...db.employees[index],
        ...input,
        updatedAt: new Date().toISOString(),
      };
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Xodim ma’lumoti yangilandi",
          "employee",
          employeeId,
          before,
          db.employees[index],
        ),
      );
      return db.employees[index];
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
      if (!employee)
        throw Object.assign(new Error("Xodim topilmadi."), { status: 404 });
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
  "/api/employees/:id",
  requirePermission("employees.delete"),
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    await updateDb((db) => {
      const row = db.employees.find(
        (e) => e.id === req.params.id && e.companyId === tenant,
      );
      if (!row)
        throw Object.assign(new Error("Xodim topilmadi."), { status: 404 });
      row.status = "ARCHIVED";
      row.updatedAt = new Date().toISOString();
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Xodim arxivlandi",
          "employee",
          row.id,
          undefined,
          { status: "ARCHIVED" },
        ),
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
      if (!employee)
        throw Object.assign(new Error("Xodim topilmadi."), { status: 404 });
      const value = {
        id: id(),
        companyId: tenant,
        employeeId: employee.id,
        code: crypto.randomUUID().replaceAll("-", ""),
        expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      };
      db.telegramInvites = db.telegramInvites.filter(
        (item) => item.employeeId !== employee.id || Boolean(item.usedAt),
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
    const username = process.env.TELEGRAM_BOT_USERNAME;
    res.status(201).json({
      ...invite,
      link: username
        ? `https://t.me/${username.replace(/^@/, "")}?start=${invite.code}`
        : undefined,
      startParam: invite.code,
    });
  }),
);

app.get(
  "/api/attendance",
  requirePermission("attendance.view"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    let rows = db.attendance.filter((a) => a.companyId === tenant);
    if (req.query.status)
      rows = rows.filter((a) => a.status === req.query.status);
    if (req.query.branch)
      rows = rows.filter((a) => a.branchId === req.query.branch);
    if (req.query.date) rows = rows.filter((a) => a.date === req.query.date);
    if (req.query.department)
      rows = rows.filter((a) =>
        db.employees.some(
          (employee) =>
            employee.id === a.employeeId &&
            employee.departmentId === req.query.department,
        ),
      );
    if (req.query.verification)
      rows = rows.filter((a) =>
        a.verification.includes(
          String(req.query.verification) as Attendance["verification"][number],
        ),
      );
    res.json(
      rows
        .map((a) => ({
          ...a,
          employee: db.employees.find((e) => e.id === a.employeeId),
          branch: db.branches.find((b) => b.id === a.branchId)?.name,
          department: db.departments.find(
            (department) =>
              department.id ===
              db.employees.find((employee) => employee.id === a.employeeId)
                ?.departmentId,
          )?.name,
          schedule: db.schedules.find(
            (schedule) =>
              schedule.id ===
              db.employees.find((employee) => employee.id === a.employeeId)
                ?.scheduleId,
          )?.name,
        }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    );
  }),
);
app.put(
  "/api/attendance/:id",
  requirePermission("attendance.edit"),
  asyncRoute(async (req, res) => {
    const input = z
        .object({
          checkIn: z.string().regex(/^\d{2}:\d{2}$/),
          checkOut: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .optional(),
        })
        .parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const record = db.attendance.find(
        (a) => a.id === req.params.id && a.companyId === tenant,
      );
      if (!record)
        throw Object.assign(new Error("Davomat yozuvi topilmadi."), {
          status: 404,
        });
      const before = { ...record },
        schedule = db.schedules.find(
          (s) =>
            s.id ===
            db.employees.find((e) => e.id === record.employeeId)?.scheduleId,
        );
      Object.assign(
        record,
        input,
        calculateAttendance({
          ...record,
          ...input,
          graceMinutes: schedule?.graceMinutes || 0,
        }),
        {
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

const branchSchema = z.object({
  name: z.string().min(2),
  address: z.string().min(4),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  radiusMeters: z.coerce.number().min(20).max(2000),
  manager: z.string().min(2),
  scheduleId: z.string(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
app.get(
  "/api/branches",
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    res.json(
      db.branches
        .filter((b) => b.companyId === tenant)
        .map((b) => ({
          ...b,
          employees: db.employees.filter(
            (e) => e.branchId === b.id && e.status === "ACTIVE",
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
        audit(
          tenant,
          req.session!.name,
          "Filial yaratildi",
          "branch",
          branch.id,
          undefined,
          branch,
        ),
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
      if (!branch)
        throw Object.assign(new Error("Filial topilmadi."), { status: 404 });
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
  asyncRoute(async (req, res) => {
    const input = z
        .object({
          name: z.string().min(2),
          type: z.enum(["FIXED", "FLEXIBLE", "SHIFT"]),
          graceMinutes: z.coerce.number().min(0).max(120),
          overtimeEnabled: z.boolean(),
          days: z.array(
            z.object({
              day: z.number(),
              enabled: z.boolean(),
              start: z.string(),
              end: z.string(),
              breakMinutes: z.number(),
            }),
          ),
        })
        .parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const schedule: Schedule = { id: id(), companyId: tenant, ...input };
      db.schedules.push(schedule);
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Ish grafigi yaratildi",
          "schedule",
          schedule.id,
        ),
      );
      return schedule;
    });
    res.status(201).json(row);
  }),
);

app.get(
  "/api/leave",
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
  asyncRoute(async (req, res) => {
    const input = z
        .object({
          employeeId: z.string(),
          type: z.enum(["VACATION", "SICK", "PERMISSION", "UNPAID", "OTHER"]),
          startDate: z.string(),
          endDate: z.string(),
          reason: z.string().min(3),
        })
        .parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      if (
        !db.employees.some(
          (e) => e.id === input.employeeId && e.companyId === tenant,
        )
      )
        throw Object.assign(new Error("Xodim topilmadi."), { status: 404 });
      const leave: LeaveRequest = {
        id: id(),
        companyId: tenant,
        ...input,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      };
      db.leaveRequests.push(leave);
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "Ta’til so‘rovi yaratildi",
          "leave",
          leave.id,
        ),
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
      if (!leave)
        throw Object.assign(new Error("So‘rov topilmadi."), { status: 404 });
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
      return {
        leave,
        employee: db.employees.find((item) => item.id === leave.employeeId),
      };
    });
    if (row.employee?.telegramId) {
      const label = status === "APPROVED" ? "tasdiqlandi ✅" : "rad etildi ❌";
      void sendTelegramMessage(
        row.employee.telegramId,
        `Ta’til so‘rovingiz ${label}\n${row.leave.startDate} – ${row.leave.endDate}`,
      ).catch(console.error);
    }
    res.json(row.leave);
  }),
);

app.get(
  "/api/audit",
  requirePermission("audit.view"),
  asyncRoute(async (req, res) => {
    const db = await readDb();
    res.json(
      db.auditLogs.filter((a) => a.companyId === companyId(req)).slice(0, 200),
    );
  }),
);
app.get(
  "/api/notifications",
  asyncRoute(async (req, res) => {
    const db = await readDb();
    res.json(
      db.notifications
        .filter((n) => n.companyId === companyId(req))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
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
    res.json(db.announcements.filter((a) => a.companyId === companyId(req)));
  }),
);
app.post(
  "/api/announcements",
  asyncRoute(async (req, res) => {
    const input = z
        .object({
          title: z.string().min(3),
          message: z.string().min(5),
          audience: z.string(),
          channel: z.array(z.string()),
          scheduledAt: z.string(),
          status: z.enum(["DRAFT", "SCHEDULED", "SENT"]),
        })
        .parse(req.body),
      tenant = companyId(req);
    const row = await updateDb((db) => {
      const value = { id: id(), companyId: tenant, ...input };
      db.announcements.unshift(value);
      db.auditLogs.unshift(
        audit(
          tenant,
          req.session!.name,
          "E’lon yaratildi",
          "announcement",
          value.id,
        ),
      );
      return {
        value,
        recipients: db.employees
          .filter(
            (item) =>
              item.companyId === tenant &&
              item.status === "ACTIVE" &&
              Boolean(item.telegramId),
          )
          .map((item) => item.telegramId!),
      };
    });
    if (row.value.status === "SENT" && row.value.channel.includes("TELEGRAM")) {
      void Promise.allSettled(
        row.recipients.map((telegramId) =>
          sendTelegramMessage(
            telegramId,
            `📢 ${row.value.title}\n\n${row.value.message}`,
          ),
        ),
      );
    }
    res.status(201).json(row.value);
  }),
);

app.get(
  "/api/reports/attendance.csv",
  requirePermission("reports.export"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const lines = [
      "Xodim ID,Xodim,Sana,Kelish,Chiqish,Holat,Kechikish (daqiqa)",
      ...db.attendance
        .filter((a) => a.companyId === tenant)
        .map((a) => {
          const e = db.employees.find((x) => x.id === a.employeeId);
          return [
            e?.employeeNo,
            `\"${e?.firstName} ${e?.lastName}\"`,
            a.date,
            a.checkIn || "",
            a.checkOut || "",
            a.status,
            a.lateMinutes,
          ].join(",");
        }),
    ];
    res
      .type("text/csv")
      .attachment("staffora-davomat.csv")
      .send("\ufeff" + lines.join("\n"));
  }),
);
app.get(
  "/api/reports/employees.csv",
  requirePermission("reports.export"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const lines = [
      "Xodim ID,Ism,Familiya,Telefon,Email,Filial,Bo‘lim,Lavozim,Holat",
      ...db.employees
        .filter((e) => e.companyId === tenant)
        .map((e) =>
          [
            e.employeeNo,
            e.firstName,
            e.lastName,
            e.phone,
            e.email,
            db.branches.find((b) => b.id === e.branchId)?.name || "",
            db.departments.find((d) => d.id === e.departmentId)?.name || "",
            db.positions.find((p) => p.id === e.positionId)?.name || "",
            e.status,
          ]
            .map((v) => `\"${String(v).replaceAll('"', '""')}\"`)
            .join(","),
        ),
    ];
    res
      .type("text/csv")
      .attachment("staffora-xodimlar.csv")
      .send("\ufeff" + lines.join("\n"));
  }),
);
app.get(
  "/api/payroll",
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    res.json(
      db.employees
        .filter((e) => e.companyId === tenant && e.status === "ACTIVE")
        .map((e) => {
          const a = db.attendance.filter((x) => x.employeeId === e.id);
          const overtime = a.reduce((s, x) => s + x.overtimeMinutes, 0),
            deduction = a.reduce((s, x) => s + x.lateMinutes, 0) * 5000;
          return {
            employee: e,
            base: e.baseSalary,
            overtimeAmount: Math.round((overtime / 60) * (e.baseSalary / 176)),
            deduction,
            net:
              e.baseSalary +
              Math.round((overtime / 60) * (e.baseSalary / 176)) -
              deduction,
          };
        }),
    );
  }),
);
app.get(
  "/api/reports/payroll.csv",
  requirePermission("reports.export"),
  asyncRoute(async (req, res) => {
    const db = await readDb(),
      tenant = companyId(req);
    const lines = [
      "Xodim ID,Xodim,Bazaviy,Kechikish ushlanmasi,Sof summa",
      ...db.employees
        .filter((e) => e.companyId === tenant && e.status === "ACTIVE")
        .map((e) => {
          const deduction =
            db.attendance
              .filter((a) => a.employeeId === e.id)
              .reduce((s, a) => s + a.lateMinutes, 0) * 5000;
          return [
            e.employeeNo,
            `\"${e.firstName} ${e.lastName}\"`,
            e.baseSalary,
            deduction,
            e.baseSalary - deduction,
          ].join(",");
        }),
    ];
    res
      .type("text/csv")
      .attachment("staffora-ish-haqi.csv")
      .send("\ufeff" + lines.join("\n"));
  }),
);

app.get(
  "/api/qr/:branchId",
  asyncRoute(async (req, res) => {
    const tenant = companyId(req);
    const expiresIn = 60;
    const now = Date.now();
    const value = await updateDb((db) => {
      const branch = db.branches.find(
        (item) => item.id === req.params.branchId && item.companyId === tenant,
      );
      if (!branch)
        throw Object.assign(new Error("Filial topilmadi."), { status: 404 });
      const nonce = id();
      const expiresAt = new Date(now + expiresIn * 1000).toISOString();
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
        {
          companyId: tenant,
          branchId: branch.id,
          nonce,
          type: "ATTENDANCE_QR",
        },
        process.env.QR_SIGNING_SECRET || "staffora-local-qr-secret-change-me",
        { expiresIn },
      );
      return { branch, token, expiresAt };
    });
    const dataUrl = await QRCode.toDataURL(value.token, {
      width: 520,
      margin: 2,
      color: { dark: "#10241f", light: "#ffffff" },
    });
    res.json({
      branch: value.branch,
      token: value.token,
      dataUrl,
      expiresAt: new Date(value.expiresAt).getTime(),
    });
  }),
);

app.get(
  "/api/admin/overview",
  requireRole("SUPER_ADMIN"),
  asyncRoute(async (_req, res) => {
    const db = await readDb();
    res.json({
      stats: {
        companies: db.companies.length,
        active: db.companies.filter((c) => c.status === "ACTIVE").length,
        trial: db.companies.filter((c) => c.status === "TRIAL").length,
        employees: db.employees.length,
        eventsToday: db.attendance.length,
      },
      companies: db.companies.map((c) => ({
        ...c,
        employees: db.employees.filter((e) => e.companyId === c.id).length,
        branches: db.branches.filter((b) => b.companyId === c.id).length,
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
        name: z.string().min(2),
        ownerName: z.string().min(2),
        plan: z.string().min(2),
        status: z.enum(["ACTIVE", "TRIAL", "SUSPENDED"]),
      })
      .parse(req.body);
    const row = await updateDb((db) => {
      const slug =
        input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || `company-${Date.now()}`;
      if (db.companies.some((c) => c.slug === slug))
        throw Object.assign(new Error("Bu nomdagi kompaniya mavjud."), {
          status: 409,
        });
      const value = {
        id: id(),
        name: input.name,
        slug,
        ownerName: input.ownerName,
        plan: input.plan,
        status: input.status,
        timezone: "Asia/Tashkent",
        createdAt: new Date().toISOString(),
      };
      db.companies.push(value);
      return value;
    });
    res.status(201).json(row);
  }),
);

const dist = path.join(process.cwd(), "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}
app.use(
  (
    error: Error & { status?: number; issues?: unknown },
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    if (!error.status || error.status >= 500) console.error(error);
    if (error instanceof z.ZodError)
      return res.status(400).json({
        message: "Kiritilgan ma’lumotlarni tekshiring.",
        issues: error.flatten(),
      });
    res.status(error.status || 500).json({
      message: error.status
        ? error.message
        : "Kutilmagan xatolik yuz berdi. Qayta urinib ko‘ring.",
    });
  },
);
app.listen(port, () => console.log(`Staffora API http://localhost:${port}`));
void startTelegramBot();
