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
import { dateParts, tashkentIsoDate } from "../lib/format";
import { audit, readDb, updateDb } from "../lib/store";
import {
  assertFaceDescriptor,
  faceDistance,
  faceMatchThreshold,
} from "../lib/face";
import type { Attendance, LeaveRequest } from "../lib/types";
import {
  requireEmployee,
  signEmployeeSession,
  type AuthedRequest,
  type EmployeeSession,
} from "./auth";
import { sendTelegramMessage, verifyTelegramInitData } from "./telegram";

type EmployeeRequest = AuthedRequest & { employeeSession?: EmployeeSession };
const asyncRoute =
  (handler: (req: EmployeeRequest, res: Response) => Promise<unknown>) =>
  (req: EmployeeRequest, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req, res)).catch(next);
const id = () => crypto.randomUUID();
const nowInTashkent = () => {
  const now = new Date();
  return {
    now,
    date: tashkentIsoDate(now),
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tashkent",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now),
  };
};

export function createMiniRouter() {
  const router = Router();
  router.post(
    "/telegram/auth",
    rateLimit({ windowMs: 60_000, limit: 30 }),
    asyncRoute(async (req, res) => {
      const { initData } = z.object({ initData: z.string() }).parse(req.body);
      const devMode = process.env.TELEGRAM_DEV_MODE === "true";
      let telegramId: string;
      if (devMode && !initData) {
        telegramId = "dev-telegram-user";
      } else {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token)
          return res
            .status(503)
            .json({ message: "Telegram bot tokeni sozlanmagan." });
        telegramId = String(verifyTelegramInitData(initData, token).id);
      }
      const db = await readDb();
      const employee =
        devMode && !initData
          ? db.employees.find(
              (item) =>
                item.id === (process.env.TELEGRAM_DEV_EMPLOYEE_ID || "emp_001"),
            )
          : db.employees.find(
              (item) =>
                item.telegramId === telegramId && item.telegramConnected,
            );
      if (!employee || employee.status !== "ACTIVE")
        return res.status(403).json({
          message:
            "Telegram hisobingiz xodim profiliga ulanmagan. HR bilan bog‘laning.",
        });
      const session: EmployeeSession = {
        employeeId: employee.id,
        companyId: employee.companyId,
        telegramId,
        kind: "employee",
      };
      res.cookie("staffora_employee_session", signEmployeeSession(session), {
        httpOnly: true,
        sameSite: process.env.COOKIE_SECURE === "true" ? "none" : "lax",
        secure: process.env.COOKIE_SECURE === "true",
        maxAge: 24 * 3600_000,
      });
      return res.json({ ok: true, employeeId: employee.id });
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
      if (!employee)
        return res.status(404).json({ message: "Xodim topilmadi." });
      const { date } = nowInTashkent();
      return res.json({
        employee,
        company: db.companies.find((item) => item.id === employee.companyId),
        branch: db.branches.find((item) => item.id === employee.branchId),
        department: db.departments.find(
          (item) => item.id === employee.departmentId,
        ),
        position: db.positions.find((item) => item.id === employee.positionId),
        schedule: db.schedules.find((item) => item.id === employee.scheduleId),
        attendance: db.attendance.find(
          (item) => item.employeeId === employee.id && item.date === date,
        ),
        notifications: db.notifications
          .filter(
            (item) =>
              item.companyId === employee.companyId &&
              (!item.employeeId || item.employeeId === employee.id),
          )
          .slice(0, 4),
      });
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
          .sort((a, b) => b.date.localeCompare(a.date)),
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
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          type: z.enum(["VACATION", "SICK", "PERMISSION", "UNPAID", "OTHER"]),
          startDate: z.string(),
          endDate: z.string(),
          reason: z.string().min(3).max(1000),
        })
        .refine((value) => value.endDate >= value.startDate, {
          message:
            "Tugash sanasi boshlanish sanasidan oldin bo‘lishi mumkin emas.",
        })
        .parse(req.body);
      const session = req.employeeSession!;
      const row = await updateDb((db) => {
        const value: LeaveRequest = {
          id: id(),
          companyId: session.companyId,
          employeeId: session.employeeId,
          ...input,
          status: "PENDING",
          createdAt: new Date().toISOString(),
        };
        db.leaveRequests.push(value);
        db.auditLogs.unshift(
          audit(
            session.companyId,
            "Xodim (Mini App)",
            "Ta’til so‘rovi yuborildi",
            "leave",
            value.id,
          ),
        );
        return value;
      });
      return res.status(201).json(row);
    }),
  );
  router.post(
    "/mini/face/enroll",
    rateLimit({ windowMs: 60_000, limit: 5 }),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          descriptor: z.array(z.number()).length(128),
          photoDataUrl: z
            .string()
            .max(700_000)
            .regex(/^data:image\/(jpeg|jpg|webp);base64,/),
        })
        .parse(req.body);
      assertFaceDescriptor(input.descriptor);
      const auth = req.employeeSession!;
      const employee = await updateDb((db) => {
        const row = db.employees.find(
          (item) =>
            item.id === auth.employeeId && item.companyId === auth.companyId,
        );
        if (!row || row.status !== "ACTIVE")
          throw Object.assign(new Error("Xodim faol emas."), { status: 403 });
        if (db.faceProfiles.some((item) => item.employeeId === row.id))
          throw Object.assign(
            new Error(
              "Face ID avval ro‘yxatdan o‘tkazilgan. Qayta sozlash uchun HR’ga murojaat qiling.",
            ),
            { status: 409 },
          );
        const now = new Date().toISOString();
        db.faceProfiles.push({
          companyId: row.companyId,
          employeeId: row.id,
          descriptor: input.descriptor,
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
            "Face ID ro‘yxatdan o‘tkazildi",
            "employee",
            row.id,
          ),
        );
        return row;
      });
      return res.status(201).json({
        enrolledAt: employee.faceEnrolledAt,
        photoDataUrl: employee.photoDataUrl,
      });
    }),
  );
  router.post(
    "/mini/face/verify",
    rateLimit({ windowMs: 60_000, limit: 8 }),
    asyncRoute(async (req, res) => {
      const { descriptor } = z
        .object({ descriptor: z.array(z.number()).length(128) })
        .parse(req.body);
      assertFaceDescriptor(descriptor);
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
          throw Object.assign(
            new Error("Face ID hali ro‘yxatdan o‘tkazilmagan."),
            { status: 428 },
          );
        const distance = faceDistance(profile.descriptor, descriptor);
        const matched = distance <= faceMatchThreshold();
        db.auditLogs.unshift(
          audit(
            auth.companyId,
            `${employee.firstName} ${employee.lastName}`,
            matched
              ? "Face ID muvaffaqiyatli tasdiqlandi"
              : "Face ID mos kelmadi",
            "employee",
            employee.id,
            undefined,
            { matched, distance: Number(distance.toFixed(4)) },
          ),
        );
        return { matched, distance, employee };
      });
      if (!result.matched)
        return res.status(403).json({
          message: "Yuz xodim profilidagi Face ID bilan mos kelmadi.",
        });
      const proof = jwt.sign(
        {
          type: "FACE_VERIFICATION",
          employeeId: auth.employeeId,
          companyId: auth.companyId,
        },
        process.env.JWT_SECRET || "staffora-local-face-secret-change-me",
        { expiresIn: 120, issuer: "staffora-face" },
      );
      return res.json({
        proof,
        matched: true,
        score: Math.max(0, Math.round((1 - result.distance) * 100)),
      });
    }),
  );
  router.post(
    "/mini/attendance/session",
    rateLimit({ windowMs: 60_000, limit: 10 }),
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
        facePayload = jwt.verify(
          faceProof,
          process.env.JWT_SECRET || "staffora-local-face-secret-change-me",
          { issuer: "staffora-face" },
        ) as typeof facePayload;
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
          throw Object.assign(new Error("Xodim faol emas."), { status: 403 });
        const { date } = nowInTashkent();
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
          branchId: employee.branchId,
          action,
          nonce: id(),
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 2 * 60_000).toISOString(),
          faceVerifiedAt: now.toISOString(),
        };
        db.attendanceSessions.push(value);
        return value;
      });
      return res.status(201).json(session);
    }),
  );
  router.post(
    "/mini/attendance/commit",
    rateLimit({ windowMs: 60_000, limit: 10 }),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          sessionId: z.string().min(1),
          qrToken: z.string().min(20),
          latitude: z.coerce.number().min(-90).max(90),
          longitude: z.coerce.number().min(-180).max(180),
        })
        .parse(req.body);
      const auth = req.employeeSession!;
      let qrPayload: {
        companyId: string;
        branchId: string;
        nonce: string;
        type: string;
      };
      try {
        qrPayload = jwt.verify(
          input.qrToken,
          process.env.QR_SIGNING_SECRET || "staffora-local-qr-secret-change-me",
        ) as typeof qrPayload;
      } catch (reason) {
        const expired = reason instanceof jwt.TokenExpiredError;
        return res.status(expired ? 410 : 400).json({
          message: expired
            ? "QR kod muddati tugagan. Yangi kodni skanerlang."
            : "QR kod imzosi yaroqsiz.",
        });
      }
      if (qrPayload.type !== "ATTENDANCE_QR")
        return res.status(400).json({ message: "QR turi noto‘g‘ri." });
      const result = await updateDb((db) => {
        const session = db.attendanceSessions.find(
          (item) =>
            item.id === input.sessionId &&
            item.employeeId === auth.employeeId &&
            item.companyId === auth.companyId,
        );
        if (!session || session.usedAt)
          throw Object.assign(new Error("Davomat sessiyasi yaroqsiz."), {
            status: 409,
          });
        if (
          !session.faceVerifiedAt ||
          Date.now() - new Date(session.faceVerifiedAt).getTime() > 3 * 60_000
        )
          throw Object.assign(new Error("Face ID tasdig‘i eskirgan."), {
            status: 401,
          });
        if (new Date(session.expiresAt).getTime() < Date.now())
          throw Object.assign(new Error("Davomat sessiyasi muddati tugagan."), {
            status: 410,
          });
        const qrNonce = db.qrNonces.find(
          (item) =>
            item.nonce === qrPayload.nonce &&
            item.companyId === auth.companyId &&
            item.branchId === session.branchId,
        );
        assertQrNonceUsable(qrNonce, auth.employeeId);
        assertQrScope(qrPayload, {
          companyId: auth.companyId,
          branchId: session.branchId,
        });
        const branch = db.branches.find(
          (item) =>
            item.id === session.branchId && item.companyId === auth.companyId,
        );
        const employee = db.employees.find(
          (item) =>
            item.id === auth.employeeId && item.companyId === auth.companyId,
        );
        if (!branch || !employee)
          throw Object.assign(new Error("Filial yoki xodim topilmadi."), {
            status: 404,
          });
        const distanceMeters = haversineDistance(
          branch.latitude,
          branch.longitude,
          input.latitude,
          input.longitude,
        );
        if (distanceMeters > branch.radiusMeters)
          throw Object.assign(
            new Error(
              `Siz filial hududidan ${distanceMeters - branch.radiusMeters} metr tashqaridasiz.`,
            ),
            { status: 422 },
          );
        const schedule = db.schedules.find(
          (item) => item.id === employee.scheduleId,
        );
        const { date, time } = nowInTashkent();
        const day = schedule?.days.find(
          (item) => item.day === dateParts(date).weekday,
        );
        if (!day?.enabled)
          throw Object.assign(new Error("Bugun ish kuni emas."), {
            status: 422,
          });
        let attendance = db.attendance.find(
          (item) => item.employeeId === employee.id && item.date === date,
        );
        if (!attendance) {
          attendance = {
            id: id(),
            companyId: auth.companyId,
            employeeId: employee.id,
            branchId: branch.id,
            date,
            scheduledStart: day.start,
            scheduledEnd: day.end,
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
            throw Object.assign(
              new Error("Ishga kelish allaqachon qayd etilgan."),
              { status: 409 },
            );
          const calculated = calculateAttendance({
            scheduledStart: attendance.scheduledStart,
            scheduledEnd: attendance.scheduledEnd,
            checkIn: time,
            graceMinutes: schedule?.graceMinutes || 0,
          });
          attendance.checkIn = time;
          attendance.lateMinutes = calculated.lateMinutes;
          attendance.status = calculated.lateMinutes ? "LATE" : "WORKING";
        } else {
          if (!attendance.checkIn)
            throw Object.assign(new Error("Ishga kelish qayd etilmagan."), {
              status: 409,
            });
          if (attendance.checkOut)
            throw Object.assign(new Error("Chiqish allaqachon qayd etilgan."), {
              status: 409,
            });
          attendance.checkOut = time;
          Object.assign(
            attendance,
            calculateAttendance({
              scheduledStart: attendance.scheduledStart,
              scheduledEnd: attendance.scheduledEnd,
              checkIn: attendance.checkIn,
              checkOut: time,
              graceMinutes: schedule?.graceMinutes || 0,
            }),
          );
        }
        attendance.verification = ["GPS", "QR", "TELEGRAM", "DEVICE", "FACE"];
        attendance.latitude = input.latitude;
        attendance.longitude = input.longitude;
        attendance.distanceMeters = distanceMeters;
        attendance.updatedAt = new Date().toISOString();
        session.usedAt = attendance.updatedAt;
        qrNonce.usedEmployeeIds ||= [];
        qrNonce.usedEmployeeIds.push(auth.employeeId);
        db.auditLogs.unshift(
          audit(
            auth.companyId,
            `${employee.firstName} ${employee.lastName}`,
            session.action === "CHECK_IN"
              ? "Ishga kelish qayd etildi"
              : "Ishdan chiqish qayd etildi",
            "attendance",
            attendance.id,
            before,
            attendance,
          ),
        );
        return { attendance, employee };
      });
      const message = `${result.attendance.checkOut ? "🔴 Ishdan chiqish" : "🟢 Ishga kelish"} qayd etildi\nVaqt: ${result.attendance.checkOut || result.attendance.checkIn}\nFilialdan masofa: ${result.attendance.distanceMeters} m`;
      if (result.employee.telegramId)
        void sendTelegramMessage(result.employee.telegramId, message).catch(
          console.error,
        );
      return res.json(result.attendance);
    }),
  );
  return router;
}
