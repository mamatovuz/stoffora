import { Router, type NextFunction, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import jwt from "jsonwebtoken";
import { z } from "zod";
import {
  assertAttendanceTransition,
  assertQrNonceUsable,
  assertQrScope,
  calculateAttendance,
  haversineDistance,
} from "../lib/attendance";
import { dateParts, tashkentClock, tashkentIsoDate } from "../lib/format";
import { audit, dataIndexes, readDb, updateDb } from "../lib/store";
import {
  assertConsistentSamples,
  assertFaceDescriptor,
  isReplayedDescriptor,
  matchFace,
  faceMatchThreshold,
} from "../lib/face";
import type { Attendance, Database, LeaveRequest } from "../lib/types";
import { calculatePayroll, normalizePayrollSettings } from "../lib/payroll";
import { onStafforaAttendance } from "./integrations/hooks";
import { countedRecords, countingStartDate, isPracticeDay } from "../lib/counting";
import { enqueueAttendancePhoto } from "./photo-channel";
import {
  requireEmployee,
  signEmployeeSession,
  type AuthedRequest,
  type EmployeeSession,
} from "./auth";
import {
  linkEmployeeByInvite,
  linkEmployeeByKnownTelegramId,
  sendTelegramMessage,
  telegramBotUsername,
  verifyTelegramInitData,
} from "./telegram";

type EmployeeRequest = AuthedRequest & { employeeSession?: EmployeeSession };
const asyncRoute =
  (handler: (req: EmployeeRequest, res: Response) => Promise<unknown>) =>
  (req: EmployeeRequest, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req, res)).catch(next);
const id = () => crypto.randomUUID();
const httpError = (message: string, status: number) =>
  Object.assign(new Error(message), { status });
const faceSecret = () =>
  process.env.JWT_SECRET || "staffora-local-face-secret-change-me";
const qrSecret = () =>
  process.env.QR_SIGNING_SECRET || "staffora-local-qr-secret-change-me";
/** GPS aniqligi past bo‘lsa ham adolatli bo‘lishi uchun maksimal qo‘shimcha tolerantlik. */
const GPS_ACCURACY_ALLOWANCE = 35;

const descriptorSchema = z.array(z.number()).length(128);
const livenessSchema = z
  .object({
    challenge: z.string().max(40),
    passed: z.boolean(),
    frames: z.number().int().min(0).max(500).optional(),
  })
  .optional();

function signFaceProof(employeeId: string, companyId: string) {
  return jwt.sign(
    { type: "FACE_VERIFICATION", employeeId, companyId },
    faceSecret(),
    { expiresIn: 180, issuer: "staffora-face" },
  );
}

function monthSummary(db: Database, employeeId: string) {
  const month = tashkentIsoDate().slice(0, 7);
  const rows = (dataIndexes(db).attendanceByEmployee.get(employeeId) || []).filter((item) =>
    item.date.startsWith(month),
  );
  const employee = db.employees.find((e) => e.id === employeeId);
  const company = db.companies.find((c) => c.id === employee?.companyId);
  const counted = countedRecords(rows, company, employee);
  const pay = calculatePayroll(employee?.baseSalary || 0, counted, company?.payroll);
  const practiceUntil = countingStartDate(company, employee);
  return {
    practiceUntil: practiceUntil && practiceUntil > tashkentIsoDate() ? practiceUntil : undefined,
    deduction: pay.deduction,
    penaltyMode: normalizePayrollSettings(company?.payroll).latePenaltyMode,
    days: rows.filter((item) => item.checkIn).length,
    late: counted.filter((item) => item.lateMinutes > 0).length,
    lateMinutes: counted.reduce((sum, item) => sum + item.lateMinutes, 0),
    workedMinutes: rows.reduce((sum, item) => sum + item.workedMinutes, 0),
    overtimeMinutes: rows.reduce((sum, item) => sum + item.overtimeMinutes, 0),
  };
}

function ownNotifications(db: Database, employeeId: string, companyId: string) {
  return db.notifications
    .filter((item) => item.companyId === companyId && item.employeeId === employeeId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createMiniRouter() {
  const router = Router();
  router.post(
    "/telegram/auth",
    rateLimit({ windowMs: 60_000, limit: 30 }),
    asyncRoute(async (req, res) => {
      const { initData } = z
        .object({ initData: z.string().max(8192) })
        .parse(req.body);
      const devMode =
        process.env.TELEGRAM_DEV_MODE === "true" &&
        process.env.NODE_ENV !== "production";
      let telegramId: string;
      let employeeId: string | undefined;
      if (devMode && !initData) {
        const db = await readDb();
        const preferred = process.env.TELEGRAM_DEV_EMPLOYEE_ID;
        const employee =
          db.employees.find(
            (item) => item.id === preferred && item.status === "ACTIVE",
          ) || db.employees.find((item) => item.status === "ACTIVE");
        if (!employee)
          return res.status(403).json({
            code: "NO_EMPLOYEES",
            message:
              "Dev rejim: bazada faol xodim yo‘q. Avval panelda xodim qo‘shing.",
          });
        telegramId = employee.telegramId || "dev-telegram-user";
        employeeId = employee.id;
      } else {
        if (!initData)
          return res.status(400).json({
            code: "NO_INIT_DATA",
            message:
              "Telegram kirish ma’lumoti kelmadi. Mini App’ni bot ichidagi «Staffora» tugmasi orqali oching.",
          });
        const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
        if (!token)
          return res.status(503).json({
            code: "BOT_NOT_CONFIGURED",
            message: "Serverda Telegram bot tokeni sozlanmagan.",
          });
        let identity: ReturnType<typeof verifyTelegramInitData>;
        try {
          identity = verifyTelegramInitData(initData, token);
        } catch (reason) {
          return res.status(401).json({
            code: "BAD_SIGNATURE",
            message:
              reason instanceof Error
                ? reason.message
                : "Telegram ma’lumoti yaroqsiz.",
          });
        }
        telegramId = String(identity.id);
        // startapp=<taklif kodi> orqali ochilgan bo‘lsa — shu yerning o‘zida ulaymiz.
        if (identity.startParam && /^[A-Za-z0-9_-]{16,64}$/.test(identity.startParam))
          await linkEmployeeByInvite(identity.startParam, identity);
        // Xodimlar botidan import qilingan xodim — Telegram ID (imzolangan) bo‘yicha avtomatik ulash.
        await linkEmployeeByKnownTelegramId(identity);
      }
      const db = await readDb();
      const employee = employeeId
        ? db.employees.find((item) => item.id === employeeId)
        : db.employees.find(
            (item) =>
              item.telegramId === telegramId &&
              item.telegramConnected &&
              item.status === "ACTIVE",
          );
      if (!employee || employee.status !== "ACTIVE")
        return res.status(403).json({
          code: "NOT_LINKED",
          botUsername: telegramBotUsername(),
          message:
            "Telegram hisobingiz hali xodim profiliga ulanmagan. Botda /start bosib, telefon raqamingizni yuboring yoki HR bergan havolani oching.",
        });
      const session: EmployeeSession = {
        employeeId: employee.id,
        companyId: employee.companyId,
        telegramId,
        kind: "employee",
      };
      const token = signEmployeeSession(session);
      const secure = process.env.COOKIE_SECURE === "true";
      res.cookie("staffora_employee_session", token, {
        httpOnly: true,
        // Telegram Web Mini App’ni iframe ichida ochadi — cookie uchun SameSite=None kerak.
        sameSite: secure ? "none" : "lax",
        secure,
        maxAge: 24 * 3600_000,
      });
      // Cookie bloklangan muhitlar (iOS, Telegram Web) uchun Bearer token ham qaytariladi.
      return res.json({ ok: true, employeeId: employee.id, token });
    }),
  );
  router.post("/telegram/logout", (_req, res) => {
    res.clearCookie("staffora_employee_session");
    res.json({ ok: true });
  });

  router.use("/mini", requireEmployee);
  router.get(
    "/mini/home",
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const session = req.employeeSession!;
      const employee = db.employees.find(
        (item) =>
          item.id === session.employeeId &&
          item.companyId === session.companyId,
      );
      if (!employee || employee.status !== "ACTIVE")
        return res
          .status(403)
          .json({ message: "Xodim profili faol emas. HR bilan bog‘laning." });
      const date = tashkentIsoDate();
      const todayLeave = db.leaveRequests.find(
        (item) =>
          item.employeeId === employee.id &&
          item.status === "APPROVED" &&
          item.startDate <= date &&
          item.endDate >= date,
      );
      return res.json({
        employee,
        company: db.companies.find((item) => item.id === employee.companyId),
        branch: db.branches.find((item) => item.id === employee.branchId) || null,
        department:
          db.departments.find((item) => item.id === employee.departmentId) ||
          null,
        position:
          db.positions.find((item) => item.id === employee.positionId) || null,
        schedule:
          db.schedules.find((item) => item.id === employee.scheduleId) || null,
        attendance: dataIndexes(db).attendanceByKey.get(`${employee.id}|${date}`),
        todayLeave: todayLeave || null,
        month: monthSummary(db, employee.id),
        serverTime: new Date().toISOString(),
        notifications: ownNotifications(db, employee.id, employee.companyId).slice(0, 5),
        unreadNotifications: ownNotifications(db, employee.id, employee.companyId).filter((n) => !n.read).length,
      });
    }),
  );
  // Xodimning shaxsiy xabarnomalari (o‘qilgan/o‘qilmagan holati bilan).
  router.get(
    "/mini/notifications",
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const session = req.employeeSession!;
      const rows = ownNotifications(db, session.employeeId, session.companyId);
      res.json({ items: rows.slice(0, 60), unread: rows.filter((n) => !n.read).length });
    }),
  );
  router.post(
    "/mini/notifications/read",
    asyncRoute(async (req, res) => {
      const input = z
        .object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() })
        .parse(req.body || {});
      const session = req.employeeSession!;
      const changed = await updateDb((db) => {
        let count = 0;
        const ids = new Set(input.ids || []);
        for (const item of db.notifications)
          if (
            item.employeeId === session.employeeId &&
            item.companyId === session.companyId &&
            !item.read &&
            (input.all || ids.has(item.id))
          ) {
            item.read = true;
            count += 1;
          }
        return count;
      });
      res.json({ ok: true, changed });
    }),
  );
  router.get(
    "/mini/attendance",
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const session = req.employeeSession!;
      return res.json(
        db.attendance
          .filter(
            (item) =>
              item.companyId === session.companyId &&
              item.employeeId === session.employeeId,
          )
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 90),
      );
    }),
  );
  router.get(
    "/mini/leave",
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const session = req.employeeSession!;
      return res.json(
        db.leaveRequests
          .filter(
            (item) =>
              item.companyId === session.companyId &&
              item.employeeId === session.employeeId,
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    }),
  );
  router.post(
    "/mini/leave",
    rateLimit({ windowMs: 60_000, limit: 10 }),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          type: z.enum(["VACATION", "SICK", "PERMISSION", "UNPAID", "OTHER"]),
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          reason: z.string().trim().min(3).max(1000),
        })
        .refine((value) => value.endDate >= value.startDate, {
          message:
            "Tugash sanasi boshlanish sanasidan oldin bo‘lishi mumkin emas.",
        })
        .parse(req.body);
      const session = req.employeeSession!;
      const row = await updateDb((db) => {
        const employee = db.employees.find(
          (item) =>
            item.id === session.employeeId &&
            item.companyId === session.companyId,
        );
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        const overlap = db.leaveRequests.some(
          (item) =>
            item.employeeId === employee.id &&
            ["PENDING", "APPROVED"].includes(item.status) &&
            item.startDate <= input.endDate &&
            item.endDate >= input.startDate,
        );
        if (overlap)
          throw httpError(
            "Bu sanalar uchun sizda allaqachon so‘rov mavjud.",
            409,
          );
        const value: LeaveRequest = {
          id: id(),
          companyId: session.companyId,
          employeeId: session.employeeId,
          ...input,
          status: "PENDING",
          createdAt: new Date().toISOString(),
        };
        db.leaveRequests.push(value);
        db.notifications.unshift({
          id: id(),
          companyId: session.companyId,
          title: "Yangi ta’til so‘rovi",
          body: `${employee.firstName} ${employee.lastName}: ${input.startDate} – ${input.endDate}`,
          type: "LEAVE",
          read: false,
          createdAt: value.createdAt,
        });
        db.auditLogs.unshift(
          audit(
            session.companyId,
            `${employee.firstName} ${employee.lastName}`,
            "Ta’til so‘rovi yuborildi (Mini App)",
            "leave",
            value.id,
          ),
        );
        return value;
      });
      return res.status(201).json(row);
    }),
  );
  router.patch(
    "/mini/leave/:id/cancel",
    asyncRoute(async (req, res) => {
      const session = req.employeeSession!;
      const row = await updateDb((db) => {
        const leave = db.leaveRequests.find(
          (item) =>
            item.id === req.params.id &&
            item.employeeId === session.employeeId &&
            item.companyId === session.companyId,
        );
        if (!leave) throw httpError("So‘rov topilmadi.", 404);
        if (leave.status !== "PENDING")
          throw httpError("Faqat kutilayotgan so‘rovni bekor qilish mumkin.", 409);
        leave.status = "CANCELLED";
        return leave;
      });
      return res.json(row);
    }),
  );

  router.post(
    "/mini/face/enroll",
    rateLimit({ windowMs: 60_000, limit: 6 }),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          samples: z.array(descriptorSchema).min(3).max(8).optional(),
          descriptor: descriptorSchema.optional(),
          photoDataUrl: z
            .string()
            .max(700_000)
            .regex(/^data:image\/(jpeg|jpg|webp);base64,/),
          liveness: livenessSchema,
        })
        .parse(req.body);
      const samples = input.samples || (input.descriptor ? [input.descriptor] : []);
      const center =
        samples.length >= 3
          ? assertConsistentSamples(samples)
          : (samples.forEach(assertFaceDescriptor), samples[0]);
      if (!center) throw httpError("Yuz namunasi yuborilmadi.", 400);
      const auth = req.employeeSession!;
      const employee = await updateDb((db) => {
        const row = db.employees.find(
          (item) =>
            item.id === auth.employeeId && item.companyId === auth.companyId,
        );
        if (!row || row.status !== "ACTIVE")
          throw httpError("Xodim faol emas.", 403);
        if (db.faceProfiles.some((item) => item.employeeId === row.id))
          throw httpError(
            "Face ID avval ro‘yxatdan o‘tkazilgan. Qayta sozlash uchun HR’ga murojaat qiling.",
            409,
          );
        // Boshqa xodimning yuzi bilan ro‘yxatdan o‘tishni oldini olish.
        const duplicate = db.faceProfiles.find(
          (item) =>
            item.companyId === row.companyId &&
            matchFace(item, center, 0.42).matched,
        );
        if (duplicate)
          throw httpError(
            "Bu yuz kompaniyadagi boshqa xodim profiliga biriktirilgan. HR bilan bog‘laning.",
            409,
          );
        const now = new Date().toISOString();
        db.faceProfiles.push({
          companyId: row.companyId,
          employeeId: row.id,
          descriptor: center,
          samples: samples.length > 1 ? samples : undefined,
          lastDescriptor: samples[samples.length - 1],
          lastVerifiedAt: now,
          enrolledAt: now,
          updatedAt: now,
        });
        row.photoDataUrl = input.photoDataUrl;
        row.faceEnrolledAt = now;
        row.updatedAt = now;
        db.auditLogs.unshift(
          audit(
            row.companyId,
            `${row.firstName} ${row.lastName}`,
            `Face ID ro‘yxatdan o‘tkazildi (${samples.length} namuna${input.liveness?.passed ? ", jonlilik tekshiruvi o‘tdi" : ""})`,
            "employee",
            row.id,
          ),
        );
        return row;
      });
      return res.status(201).json({
        enrolledAt: employee.faceEnrolledAt,
        photoDataUrl: employee.photoDataUrl,
        proof: signFaceProof(auth.employeeId, auth.companyId),
        matched: true,
        score: 100,
      });
    }),
  );
  router.post(
    "/mini/face/verify",
    rateLimit({ windowMs: 60_000, limit: 10 }),
    asyncRoute(async (req, res) => {
      const { descriptor, turnDescriptor, liveness } = z
        .object({ descriptor: descriptorSchema, turnDescriptor: descriptorSchema.optional(), liveness: livenessSchema })
        .parse(req.body);
      assertFaceDescriptor(descriptor);
      if (turnDescriptor) assertFaceDescriptor(turnDescriptor);
      const auth = req.employeeSession!;
      const result = await updateDb((db) => {
        const employee = db.employees.find(
          (item) =>
            item.id === auth.employeeId && item.companyId === auth.companyId,
        );
        const profile = db.faceProfiles.find(
          (item) =>
            item.employeeId === auth.employeeId &&
            item.companyId === auth.companyId,
        );
        if (!employee || !profile)
          throw httpError("Face ID hali ro‘yxatdan o‘tkazilmagan.", 428);
        if (isReplayedDescriptor(profile.lastDescriptor, descriptor))
          throw httpError(
            "Takroriy so‘rov aniqlandi. Yuzni kamerada qayta skanerlang.",
            409,
          );
        const front = matchFace(profile, descriptor);
        // Bosh burilgan kadr ham shu odamniki bo‘lishi shart (burilishda aniqlik pastroq — biroz yumshoq chegara).
        const turned = turnDescriptor ? matchFace(profile, turnDescriptor, faceMatchThreshold() + 0.1) : undefined;
        const match = { ...front, matched: front.matched && (!turned || turned.matched) };
        if (match.matched) {
          profile.lastDescriptor = descriptor;
          profile.lastVerifiedAt = new Date().toISOString();
        }
        db.auditLogs.unshift(
          audit(
            auth.companyId,
            `${employee.firstName} ${employee.lastName}`,
            match.matched
              ? "Face ID muvaffaqiyatli tasdiqlandi"
              : "Face ID mos kelmadi",
            "employee",
            employee.id,
            undefined,
            {
              matched: match.matched,
              distance: Number(match.distance.toFixed(4)),
              liveness: liveness?.passed ?? null,
            },
          ),
        );
        return match;
      });
      if (!result.matched)
        return res.status(403).json({
          message:
            "Yuz profildagi Face ID bilan mos kelmadi. Yorug‘ joyda, ko‘zoynak/niqobsiz qayta urinib ko‘ring.",
          score: result.score,
        });
      return res.json({
        proof: signFaceProof(auth.employeeId, auth.companyId),
        matched: true,
        score: result.score,
      });
    }),
  );
  router.post(
    "/mini/attendance/session",
    rateLimit({ windowMs: 60_000, limit: 12 }),
    asyncRoute(async (req, res) => {
      const { action, faceProof } = z
        .object({
          action: z.enum(["CHECK_IN", "CHECK_OUT"]),
          faceProof: z.string().min(20),
        })
        .parse(req.body);
      const auth = req.employeeSession!;
      let facePayload: {
        type: string;
        employeeId: string;
        companyId: string;
      };
      try {
        facePayload = jwt.verify(faceProof, faceSecret(), {
          issuer: "staffora-face",
        }) as typeof facePayload;
      } catch {
        return res.status(401).json({
          message: "Face ID tasdig‘i tugagan. Yuzni qayta skanerlang.",
        });
      }
      if (
        facePayload.type !== "FACE_VERIFICATION" ||
        facePayload.employeeId !== auth.employeeId ||
        facePayload.companyId !== auth.companyId
      )
        return res.status(403).json({ message: "Face ID tasdig‘i yaroqsiz." });
      const session = await updateDb((db) => {
        const employee = db.employees.find(
          (item) =>
            item.id === auth.employeeId && item.companyId === auth.companyId,
        );
        if (!employee || employee.status !== "ACTIVE")
          throw httpError("Xodim faol emas.", 403);
        const branch = db.branches.find(
          (item) =>
            item.id === employee.branchId && item.companyId === auth.companyId,
        );
        if (!branch || branch.status !== "ACTIVE")
          throw httpError(
            "Sizga faol filial biriktirilmagan. HR bilan bog‘laning.",
            422,
          );
        const date = tashkentIsoDate();
        const attendance = db.attendance.find(
          (item) => item.employeeId === employee.id && item.date === date,
        );
        assertAttendanceTransition(action, attendance);
        const now = new Date();
        db.attendanceSessions = db.attendanceSessions.filter(
          (item) =>
            new Date(item.expiresAt).getTime() > now.getTime() && !item.usedAt,
        );
        const value = {
          id: id(),
          companyId: employee.companyId,
          employeeId: employee.id,
          branchId: branch.id,
          action,
          nonce: id(),
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 3 * 60_000).toISOString(),
          faceVerifiedAt: now.toISOString(),
        };
        db.attendanceSessions.push(value);
        return {
          ...value,
          requiresQr: (branch.attendanceMode || "QR_GPS_FACE") === "QR_GPS_FACE",
        };
      });
      return res.status(201).json(session);
    }),
  );
  router.post(
    "/mini/attendance/commit",
    rateLimit({ windowMs: 60_000, limit: 12 }),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          sessionId: z.string().min(1),
          qrToken: z.string().min(20).max(2000).optional(),
          latitude: z.coerce.number().min(-90).max(90),
          longitude: z.coerce.number().min(-180).max(180),
          accuracy: z.coerce.number().min(0).max(100_000).optional(),
          photoDataUrl: z
            .string()
            .max(600_000)
            .regex(/^data:image\/(jpeg|jpg|webp);base64,/)
            .optional(),
        })
        .parse(req.body);
      const auth = req.employeeSession!;
      let qrPayload:
        | { companyId: string; branchId: string; nonce: string; type: string }
        | undefined;
      if (input.qrToken) {
        try {
          qrPayload = jwt.verify(input.qrToken.trim(), qrSecret(), {
            clockTolerance: 5,
          }) as typeof qrPayload;
        } catch (reason) {
          const expired = reason instanceof jwt.TokenExpiredError;
          return res.status(expired ? 410 : 400).json({
            message: expired
              ? "QR kod muddati tugagan. Ekrandagi yangi kodni skanerlang."
              : "Bu Staffora davomat QR kodi emas.",
          });
        }
        if (qrPayload?.type !== "ATTENDANCE_QR")
          return res.status(400).json({ message: "QR turi noto‘g‘ri." });
      }
      const result = await updateDb((db) => {
        const session = db.attendanceSessions.find(
          (item) =>
            item.id === input.sessionId &&
            item.employeeId === auth.employeeId &&
            item.companyId === auth.companyId,
        );
        if (!session || session.usedAt)
          throw httpError(
            "Davomat sessiyasi yaroqsiz. Jarayonni boshidan boshlang.",
            409,
          );
        if (
          !session.faceVerifiedAt ||
          Date.now() - new Date(session.faceVerifiedAt).getTime() > 4 * 60_000
        )
          throw httpError("Face ID tasdig‘i eskirgan. Qaytadan boshlang.", 401);
        if (new Date(session.expiresAt).getTime() < Date.now())
          throw httpError(
            "Davomat sessiyasi muddati tugagan. Qaytadan boshlang.",
            410,
          );
        const branch = db.branches.find(
          (item) =>
            item.id === session.branchId && item.companyId === auth.companyId,
        );
        const employee = db.employees.find(
          (item) =>
            item.id === auth.employeeId && item.companyId === auth.companyId,
        );
        if (!branch || !employee)
          throw httpError("Filial yoki xodim topilmadi.", 404);
        const requiresQr =
          (branch.attendanceMode || "QR_GPS_FACE") === "QR_GPS_FACE";
        let qrNonce: Database["qrNonces"][number] | undefined;
        if (requiresQr) {
          if (!qrPayload)
            throw httpError("Filial ekranidagi QR kodni skanerlang.", 400);
          assertQrScope(qrPayload, {
            companyId: auth.companyId,
            branchId: session.branchId,
          });
          qrNonce = db.qrNonces.find(
            (item) =>
              item.nonce === qrPayload!.nonce &&
              item.companyId === auth.companyId &&
              item.branchId === session.branchId,
          );
          assertQrNonceUsable(qrNonce, `${auth.employeeId}:${session.action}`);
        }
        const distanceMeters = haversineDistance(
          branch.latitude,
          branch.longitude,
          input.latitude,
          input.longitude,
        );
        const allowance = Math.min(
          GPS_ACCURACY_ALLOWANCE,
          Math.max(0, input.accuracy || 0),
        );
        if (distanceMeters - allowance > branch.radiusMeters)
          throw httpError(
            `Siz filial hududidan ${Math.round(distanceMeters - branch.radiusMeters)} metr tashqaridasiz. Filialga yaqinroq keling.`,
            422,
          );
        const schedule = db.schedules.find(
          (item) => item.id === employee.scheduleId,
        );
        const date = tashkentIsoDate();
        const time = tashkentClock();
        const day = schedule?.days.find(
          (item) => item.day === dateParts(date).weekday,
        );
        let attendance = db.attendance.find(
          (item) => item.employeeId === employee.id && item.date === date,
        );
        if (!attendance) {
          if (session.action === "CHECK_OUT")
            throw httpError("Avval ishga kelishni qayd eting.", 409);
          attendance = {
            id: id(),
            companyId: auth.companyId,
            employeeId: employee.id,
            branchId: branch.id,
            date,
            // Dam olish kunida ham kelishga ruxsat — overtime sifatida hisoblanadi.
            scheduledStart: day?.enabled ? day.start : time,
            scheduledEnd: day?.enabled ? day.end : time,
            lateMinutes: 0,
            earlyLeaveMinutes: 0,
            workedMinutes: 0,
            overtimeMinutes: 0,
            status: "ABSENT",
            verification: [],
            updatedAt: new Date().toISOString(),
          };
          db.attendance.push(attendance);
        }
        const before = { ...attendance };
        if (session.action === "CHECK_IN") {
          if (attendance.checkIn)
            throw httpError("Ishga kelish allaqachon qayd etilgan.", 409);
          const calculated = calculateAttendance({
            scheduledStart: attendance.scheduledStart,
            scheduledEnd: attendance.scheduledEnd,
            checkIn: time,
            graceMinutes: schedule?.graceMinutes || 0,
          });
          attendance.checkIn = time;
          attendance.lateMinutes = calculated.lateMinutes;
          attendance.status = calculated.status;
          if (!day?.enabled) attendance.note = "Dam olish kunida ishga keldi";
        } else {
          if (!attendance.checkIn)
            throw httpError("Ishga kelish qayd etilmagan.", 409);
          if (attendance.checkOut)
            throw httpError("Ketish allaqachon qayd etilgan.", 409);
          if (time <= attendance.checkIn)
            throw httpError(
              "Ketish vaqti kelish vaqtidan keyin bo‘lishi kerak.",
              409,
            );
          attendance.checkOut = time;
          const calculated = calculateAttendance({
            scheduledStart: attendance.scheduledStart,
            scheduledEnd: attendance.scheduledEnd,
            checkIn: attendance.checkIn,
            checkOut: time,
            graceMinutes: schedule?.graceMinutes || 0,
          });
          Object.assign(attendance, calculated);
          if (!day?.enabled) {
            attendance.overtimeMinutes = attendance.workedMinutes;
            attendance.earlyLeaveMinutes = 0;
          }
        }
        attendance.verification = [
          ...new Set<Attendance["verification"][number]>([
            ...attendance.verification.filter((item) => item !== "MANUAL"),
            "FACE",
            "GPS",
            "TELEGRAM",
            ...(requiresQr ? (["QR"] as const) : []),
          ]),
        ];
        attendance.latitude = input.latitude;
        attendance.longitude = input.longitude;
        attendance.distanceMeters = distanceMeters;
        attendance.updatedAt = new Date().toISOString();
        session.usedAt = attendance.updatedAt;
        if (qrNonce) {
          qrNonce.usedEmployeeIds ||= [];
          qrNonce.usedEmployeeIds.push(`${auth.employeeId}:${session.action}`);
        }
        const name = `${employee.firstName} ${employee.lastName}`;
        const company = db.companies.find((c) => c.id === auth.companyId);
        const practice = isPracticeDay(date, company, employee);
        // Mashq davrida rahbarlarga kechikish haqida xabar ketmaydi.
        if (session.action === "CHECK_IN" && attendance.lateMinutes > 0 && !practice)
          db.notifications.unshift({
            id: id(),
            companyId: auth.companyId,
            title: "Kechikish",
            body: `${name} ${attendance.lateMinutes} daqiqa kechikib keldi (${time}, ${branch.name}).`,
            type: "ATTENDANCE",
            read: false,
            createdAt: attendance.updatedAt,
          });
        db.auditLogs.unshift(
          audit(
            auth.companyId,
            name,
            session.action === "CHECK_IN"
              ? "Ishga kelish qayd etildi"
              : "Ishdan ketish qayd etildi",
            "attendance",
            attendance.id,
            before,
            attendance,
          ),
        );
        enqueueAttendancePhoto(db, {
          employee,
          branch,
          attendance,
          action: session.action,
          photoDataUrl: input.photoDataUrl,
        });
        return {
          attendance: { ...attendance },
          employee,
          branch,
          practiceUntil: practice ? countingStartDate(company, employee) : undefined,
          action: session.action,
        };
      });
      const a = result.attendance;
      // Integratsiya: keldi-ketdini xodimlar botiga ham yuborish (navbat orqali, xatoda qayta urinadi).
      onStafforaAttendance(auth.companyId, a, result.action);
      const practiceNote = result.practiceUntil
        ? `\n\n🧪 Mashq davri: ${result.practiceUntil.split("-").reverse().join(".")} gacha kechikish va ushlanmalar hisoblanmaydi.`
        : "";
      const message =
        a.checkOut && a.checkIn
          ? `🔴 Ishdan ketish qayd etildi\n🕔 ${a.checkOut}\n⏱ Ishlangan: ${Math.floor(a.workedMinutes / 60)} soat ${a.workedMinutes % 60} daqiqa\n📍 ${result.branch.name}`
          : `🟢 Ishga kelish qayd etildi\n🕘 ${a.checkIn}${a.lateMinutes ? `\n⚠️ Kechikish: ${a.lateMinutes} daqiqa` : ""}\n📍 ${result.branch.name} (${a.distanceMeters} m)`;
      if (result.employee.telegramId && !result.employee.telegramId.startsWith("dev"))
        void sendTelegramMessage(result.employee.telegramId, message + practiceNote).catch(
          console.error,
        );
      return res.json(a);
    }),
  );
  return router;
}
