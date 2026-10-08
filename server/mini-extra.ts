import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { audit, dataIndexes, readDb, updateDb } from "../lib/store";
import { tashkentClock, tashkentIsoDate } from "../lib/format";
import { dayPlan, shiftDateAt } from "../lib/schedule";
import { can } from "../lib/permissions";
import { attendanceStreak, biometricNeedsFace, breakMinutes, DEFAULT_FACE_EVERY, streakBadge, type StreakDay } from "../lib/mini";
import { countingStartDate } from "../lib/counting";
import type { Database, Employee, LateNotice, User } from "../lib/types";
import { verifyEmployeeToken, type AuthedRequest, type EmployeeSession } from "./auth";
import { signFaceProof, verifyFaceProof } from "./face-proof";
import { botApi, sendTelegramMessage } from "./telegram";
import { companyBotApi } from "./bot-registry";
import { readDocumentFile } from "./documents";
import { createWorkbook, sendWorkbook } from "./excel";
import { closedPeriod, monthLabel } from "./payroll-routes";

/*
 * Mini App’ning qo‘shimcha imkoniyatlari:
 *   biometriya (barmoq izi / Face ID telefonda), oylik grafik, statistika va seriyalar,
 *   «kechikaman» ogohlantirishi, qo‘shimcha ish izohi, hamkasblar ma’lumotnomasi,
 *   tanaffus, e’lon tasdig‘i va so‘rovnoma, fayl yuklab olish, xabar ulashish, xato jurnali.
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number, code?: string) => Object.assign(new Error(message), { status, code });
const sessionOf = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
const nameOf = (e?: Pick<Employee, "firstName" | "lastName">) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
const dmy = (iso: string) => iso.split("-").reverse().join(".");
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const fileSecret = () => `${process.env.JWT_SECRET || "staffora-local-face-secret-change-me"}:mini-file`;
const MONTH = /^\d{4}-\d{2}$/;

function ownEmployee(db: Database, auth: EmployeeSession) {
  const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId && e.status === "ACTIVE");
  if (!employee) throw httpError("Xodim profili faol emas. HR bilan bog‘laning.", 403);
  return employee;
}

/** Kompaniyada yoqilgan Mini App imkoniyatlari (standart qiymatlar bilan). */
export function miniFeatures(db: Database, employee: Employee) {
  const company = db.companies.find((c) => c.id === employee.companyId);
  const settings = company?.miniApp || {};
  return {
    biometric: settings.biometricEnabled !== false,
    biometricRegistered: db.biometricDevices.some((d) => d.employeeId === employee.id && !d.revokedAt),
    faceEvery: settings.faceEvery || DEFAULT_FACE_EVERY,
    directory: settings.directoryEnabled !== false,
    breaks: settings.breaksEnabled === true,
    leaderboard: settings.leaderboardEnabled !== false,
    advances: company?.payroll?.advanceRequestsEnabled !== false && employee.baseSalary > 0,
    overtimeApproval: Boolean(company?.payroll?.overtimeRequiresApproval),
    /** Ishda bo‘lganda Telegram emoji-statusi (Premium) — server sozlamasida berilgan bo‘lsa. */
    workEmojiId: process.env.TELEGRAM_WORK_EMOJI_ID?.trim() || undefined,
  };
}

/* -------------------------------------------------- rahbarlarga xabar --- */
const MANAGER_ROLES = new Set<User["role"]>(["COMPANY_OWNER", "HR_ADMIN", "HR_MANAGER", "BRANCH_MANAGER"]);

/** Filial uchun javobgar rahbarlar (Telegram ulangan): egasi, HR va shu filial rahbari. */
export function branchManagers(db: Database, companyId: string, branchId?: string) {
  return db.users.filter(
    (u) =>
      u.companyId === companyId &&
      u.telegramId &&
      MANAGER_ROLES.has(u.role) &&
      (u.role !== "BRANCH_MANAGER" || Boolean(branchId && (u.branchIds || []).includes(branchId))),
  );
}

export async function notifyManagers(db: Database, companyId: string, branchId: string | undefined, text: string, go = "manager") {
  const managers = branchManagers(db, companyId, branchId);
  const results = await Promise.allSettled(managers.map((u) => sendTelegramMessage(u.telegramId!, text, { go })));
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}

/* ------------------------------------------------------------- router --- */
export function createMiniExtraRouter() {
  const router = Router();
  const perEmployee = (limit: number) =>
    rateLimit({
      windowMs: 60_000,
      limit,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => `x:${sessionOf(req)?.employeeId || req.ip}`,
      message: { message: "Juda ko‘p urinish. Bir daqiqadan keyin qayta urinib ko‘ring." },
    });

  /* ------------------------------------------------------ biometriya --- */
  router.post(
    "/mini/biometric/register",
    perEmployee(6),
    route(async (req, res) => {
      const auth = sessionOf(req);
      const input = z.object({ faceProof: z.string().min(20), label: z.string().trim().max(60).optional() }).parse(req.body);
      const proof = verifyFaceProof(input.faceProof);
      // Faqat haqiqiy yuz tekshiruvidan keyin (biometriya o‘zini o‘zi ulay olmaydi).
      if (!proof || proof.method === "BIOMETRIC" || proof.employeeId !== auth.employeeId || proof.companyId !== auth.companyId)
        throw httpError("Avval Face ID orqali yuzingizni tasdiqlang.", 401);
      const token = randomBytes(32).toString("base64url");
      const device = await updateDb((db) => {
        const employee = ownEmployee(db, auth);
        if (!miniFeatures(db, employee).biometric) throw httpError("Kompaniyada biometriya o‘chirilgan.", 403);
        const now = new Date().toISOString();
        // Bir xodimga ko‘pi bilan 3 ta qurilma — eskisi bekor qilinadi.
        const active = db.biometricDevices.filter((d) => d.employeeId === employee.id && !d.revokedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        for (const old of active.slice(0, Math.max(0, active.length - 2))) old.revokedAt = now;
        const row = {
          id: randomUUID(),
          companyId: employee.companyId,
          employeeId: employee.id,
          tokenHash: sha256(token),
          label: input.label || "Telefon",
          uses: 0,
          createdAt: now,
          lastFaceAt: now,
        };
        db.biometricDevices.push(row);
        db.auditLogs.unshift(audit(employee.companyId, nameOf(employee), `Telefon biometriyasi ulandi (${row.label})`, "employee", employee.id));
        return row;
      });
      res.status(201).json({ token, deviceId: device.id });
    }),
  );

  router.post(
    "/mini/biometric/verify",
    perEmployee(12),
    route(async (req, res) => {
      const auth = sessionOf(req);
      const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
      const result = await updateDb((db) => {
        const employee = ownEmployee(db, auth);
        const features = miniFeatures(db, employee);
        if (!features.biometric) throw httpError("Kompaniyada biometriya o‘chirilgan — Face ID ishlating.", 403, "BIOMETRIC_DISABLED");
        const device = db.biometricDevices.find((d) => d.tokenHash === sha256(token) && !d.revokedAt);
        if (!device || device.employeeId !== employee.id || device.companyId !== employee.companyId)
          throw httpError("Bu qurilmadagi biometriya yaroqsiz. Face ID orqali qayta ulang.", 401, "BIOMETRIC_REVOKED");
        if (!db.faceProfiles.some((p) => p.employeeId === employee.id)) throw httpError("Face ID hali sozlanmagan.", 428, "FACE_REQUIRED");
        if (biometricNeedsFace(device, features.faceEvery))
          return { needsFace: true as const };
        device.uses += 1;
        device.lastUsedAt = new Date().toISOString();
        return { needsFace: false as const, proof: signFaceProof(employee.id, employee.companyId, "BIOMETRIC") };
      });
      if (result.needsFace)
        return res.status(428).json({ code: "FACE_REQUIRED", message: "Xavfsizlik uchun bu safar yuzingizni ham tekshiramiz." });
      res.json({ proof: result.proof });
    }),
  );

  router.delete(
    "/mini/biometric",
    route(async (req, res) => {
      const auth = sessionOf(req);
      const revoked = await updateDb((db) => {
        const now = new Date().toISOString();
        let count = 0;
        for (const d of db.biometricDevices)
          if (d.employeeId === auth.employeeId && !d.revokedAt) {
            d.revokedAt = now;
            count += 1;
          }
        return count;
      });
      res.json({ ok: true, revoked });
    }),
  );

  /* ---------------------------------------------------- oylik grafik --- */
  router.get(
    "/mini/schedule",
    route(async (req, res) => {
      const auth = sessionOf(req);
      const today = tashkentIsoDate();
      const month = String(req.query.month || today.slice(0, 7));
      if (!MONTH.test(month)) throw httpError("Oy YYYY-MM ko‘rinishida bo‘lsin.", 400);
      const db = await readDb();
      const employee = ownEmployee(db, auth);
      const index = dataIndexes(db);
      const leaves = (index.approvedLeaveByEmployee.get(employee.id) || []) as Database["leaveRequests"];
      const [y, m] = month.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const days = Array.from({ length: last }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, "0")}`;
        const plan = dayPlan(db, employee, date);
        const leave = leaves.find((l) => l.startDate <= date && l.endDate >= date);
        const record = index.attendanceByKey.get(`${employee.id}|${date}`);
        return {
          date,
          working: plan.enabled && !leave,
          start: plan.start,
          end: plan.end,
          overridden: plan.overridden,
          reason: plan.reason,
          leave: leave?.type,
          checkIn: record?.checkIn,
          checkOut: record?.checkOut,
          lateMinutes: record?.lateMinutes || 0,
          workedMinutes: record?.workedMinutes || 0,
        };
      });
      const planned = days.filter((d) => d.working);
      res.json({
        month,
        label: monthLabel(month),
        days,
        totals: {
          workdays: planned.length,
          plannedMinutes: planned.reduce((sum, d) => {
            const [sh, sm] = d.start.split(":").map(Number);
            const [eh, em] = d.end.split(":").map(Number);
            return sum + Math.max(0, eh * 60 + em - (sh * 60 + sm));
          }, 0),
          leaveDays: days.filter((d) => d.leave).length,
        },
      });
    }),
  );

  /* ------------------------------------------- statistika va seriya --- */
  router.get(
    "/mini/stats",
    route(async (req, res) => {
      const auth = sessionOf(req);
      const db = await readDb();
      const employee = ownEmployee(db, auth);
      const company = db.companies.find((c) => c.id === employee.companyId);
      const index = dataIndexes(db);
      const today = tashkentIsoDate();
      const records = new Map((index.attendanceByEmployee.get(employee.id) || []).map((a) => [a.date, a]));
      const leaves = (index.approvedLeaveByEmployee.get(employee.id) || []) as Database["leaveRequests"];
      const startFrom = [employee.startDate, countingStartDate(company, employee)].filter(Boolean).sort().pop() || employee.startDate;
      const days: StreakDay[] = [];
      for (let back = 180; back >= 0; back -= 1) {
        const date = tashkentIsoDate(new Date(Date.now() - back * 86_400_000));
        if (date < startFrom) continue;
        const onLeave = leaves.some((l) => l.startDate <= date && l.endDate >= date);
        const record = records.get(date);
        days.push({ date, workday: dayPlan(db, employee, date).enabled && !onLeave, checkIn: record?.checkIn, lateMinutes: record?.lateMinutes });
      }
      const streak = attendanceStreak(days, today);
      // Oxirgi 6 oy.
      const months = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(`${today.slice(0, 7)}-15T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() - (5 - i));
        const month = d.toISOString().slice(0, 7);
        const rows = [...records.values()].filter((a) => a.date.startsWith(month));
        const present = rows.filter((a) => a.checkIn).length;
        const late = rows.filter((a) => a.lateMinutes > 0).length;
        return {
          month,
          label: monthLabel(month),
          present,
          late,
          lateMinutes: rows.reduce((s, a) => s + a.lateMinutes, 0),
          workedHours: Math.round(rows.reduce((s, a) => s + a.workedMinutes, 0) / 60),
          overtimeHours: Math.round(rows.reduce((s, a) => s + a.overtimeMinutes, 0) / 60),
          onTimeRate: present ? Math.round(((present - late) / present) * 100) : null,
        };
      });
      // Filial ichidagi reyting (shu oy): vaqtida kelgan kunlar ulushi.
      let leaderboard: { rank: number; total: number; top: { name: string; rate: number; me: boolean }[] } | null = null;
      if (miniFeatures(db, employee).leaderboard) {
        const month = today.slice(0, 7);
        const scores = db.employees
          .filter((e) => e.companyId === employee.companyId && e.branchId === employee.branchId && e.status === "ACTIVE")
          .map((e) => {
            const rows = (index.attendanceByEmployee.get(e.id) || []).filter((a) => a.date.startsWith(month) && a.checkIn);
            const onTime = rows.filter((a) => !a.lateMinutes).length;
            return { id: e.id, name: `${e.firstName} ${(e.lastName || "").slice(0, 1)}.`.trim(), present: rows.length, rate: rows.length ? Math.round((onTime / rows.length) * 100) : 0 };
          })
          .filter((s) => s.present > 0)
          .sort((a, b) => b.rate - a.rate || b.present - a.present);
        const position = scores.findIndex((s) => s.id === employee.id);
        if (scores.length >= 3)
          leaderboard = {
            rank: position + 1,
            total: scores.length,
            top: scores.slice(0, 3).map((s) => ({ name: s.name, rate: s.rate, me: s.id === employee.id })),
          };
      }
      res.json({ streak: { ...streak, badge: streakBadge(streak.current) }, months, leaderboard });
    }),
  );

  /* ------------------------------------------------------ kechikaman --- */
  router.post(
    "/mini/late-notice",
    perEmployee(5),
    route(async (req, res) => {
      const auth = sessionOf(req);
      const input = z
        .object({ minutes: z.coerce.number().int().min(5).max(240), reason: z.string().trim().min(3, "Sababni qisqacha yozing.").max(200) })
        .parse(req.body);
      const date = tashkentIsoDate();
      const result = await updateDb((db) => {
        const employee = ownEmployee(db, auth);
        const record = dataIndexes(db).attendanceByKey.get(`${employee.id}|${date}`);
        if (record?.checkIn) throw httpError("Siz bugun allaqachon kelgansiz.", 409);
        const plan = dayPlan(db, employee, date);
        if (!plan.enabled) throw httpError("Bugun sizning ish kuningiz emas.", 422);
        const now = new Date().toISOString();
        db.lateNotices = db.lateNotices.filter((n) => !(n.employeeId === employee.id && n.date === date));
        const notice: LateNotice = { id: randomUUID(), companyId: employee.companyId, employeeId: employee.id, date, minutes: input.minutes, reason: input.reason, createdAt: now };
        db.lateNotices.unshift(notice);
        const branch = db.branches.find((b) => b.id === employee.branchId);
        db.notifications.unshift({
          id: randomUUID(),
          companyId: employee.companyId,
          title: "Kechikish haqida ogohlantirish",
          body: `${nameOf(employee)} ~${input.minutes} daqiqa kechikadi (${branch?.name || "filial"}, ish ${plan.start} da). Sabab: ${input.reason}`,
          type: "ATTENDANCE",
          read: false,
          createdAt: now,
        });
        db.auditLogs.unshift(audit(employee.companyId, nameOf(employee), `Kechikish haqida ogohlantirdi: ~${input.minutes} daq`, "employee", employee.id));
        return { notice, employee, branch, plan };
      });
      const db = await readDb();
      const sent = await notifyManagers(
        db,
        result.employee.companyId,
        result.employee.branchId,
        `⏳ <b>${esc(nameOf(result.employee))}</b> ~${input.minutes} daqiqa kechikadi\n📍 ${result.branch?.name || "—"} · ish ${result.plan.start} da\n💬 ${esc(input.reason)}`,
      ).catch(() => 0);
      res.status(201).json({ ...result.notice, managersNotified: sent });
    }),
  );

  /* --------------------------------------------------- qo‘shimcha ish --- */
  router.get(
    "/mini/overtime",
    route(async (req, res) => {
      const auth = sessionOf(req);
      const db = await readDb();
      const employee = ownEmployee(db, auth);
      const company = db.companies.find((c) => c.id === employee.companyId);
      const rows = (dataIndexes(db).attendanceByEmployee.get(employee.id) || [])
        .filter((a) => a.overtimeMinutes > 0)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 40)
        .map((a) => ({
          id: a.id,
          date: a.date,
          checkIn: a.checkIn,
          checkOut: a.checkOut,
          scheduledEnd: a.scheduledEnd,
          overtimeMinutes: a.overtimeMinutes,
          approved: a.overtimeApproved,
          decidedBy: a.overtimeDecidedBy,
          note: a.overtimeNote,
          closed: Boolean(closedPeriod(db, employee.companyId, a.date.slice(0, 7))),
        }));
      res.json({ requiresApproval: Boolean(company?.payroll?.overtimeRequiresApproval), paid: company?.payroll?.overtimePay !== false, rows });
    }),
  );

  router.post(
    "/mini/overtime/:id/note",
    perEmployee(10),
    route(async (req, res) => {
      const auth = sessionOf(req);
      const { note } = z.object({ note: z.string().trim().min(3, "Izohni yozing.").max(300) }).parse(req.body);
      const result = await updateDb((db) => {
        const employee = ownEmployee(db, auth);
        const record = db.attendance.find((a) => a.id === req.params.id && a.employeeId === employee.id);
        if (!record || record.overtimeMinutes <= 0) throw httpError("Qo‘shimcha ish yozuvi topilmadi.", 404);
        if (record.overtimeApproved !== undefined) throw httpError("Bu qo‘shimcha ish allaqachon ko‘rib chiqilgan.", 409);
        if (closedPeriod(db, employee.companyId, record.date.slice(0, 7))) throw httpError("Bu oy yopilgan.", 409);
        record.overtimeNote = note;
        record.updatedAt = new Date().toISOString();
        db.notifications.unshift({
          id: randomUUID(),
          companyId: employee.companyId,
          title: "Qo‘shimcha ish — izoh",
          body: `${nameOf(employee)} ${dmy(record.date)}: ${record.overtimeMinutes} daq. «${note}». Ish haqi → Qo‘shimcha ish bo‘limida tasdiqlang.`,
          type: "PAYROLL",
          read: false,
          createdAt: record.updatedAt,
        });
        return { record: { ...record }, employee };
      });
      const db = await readDb();
      void notifyManagers(
        db,
        result.employee.companyId,
        result.employee.branchId,
        `⏱ <b>Qo‘shimcha ish</b>\n${esc(nameOf(result.employee))} · ${dmy(result.record.date)} · ${result.record.overtimeMinutes} daq\n💬 ${esc(note)}`,
        "manager_requests",
      ).catch(() => undefined);
      res.json({ ok: true, note });
    }),
  );

  /* ------------------------------------------- hamkasblar ma’lumotnomasi --- */
  router.get(
    "/mini/directory",
    route(async (req, res) => {
      const auth = sessionOf(req);
      const db = await readDb();
      const me = ownEmployee(db, auth);
      const company = db.companies.find((c) => c.id === me.companyId);
      if (!miniFeatures(db, me).directory) throw httpError("Ma’lumotnoma kompaniyada o‘chirilgan.", 403);
      const phones = company?.miniApp?.directoryPhones === true;
      const today = tashkentIsoDate();
      const index = dataIndexes(db);
      const rows = db.employees
        .filter((e) => e.companyId === me.companyId && e.status === "ACTIVE" && e.id !== me.id)
        .map((e) => {
          const record = index.attendanceByKey.get(`${e.id}|${today}`);
          return {
            id: e.id,
            name: nameOf(e),
            position: db.positions.find((p) => p.id === e.positionId)?.name,
            department: db.departments.find((d) => d.id === e.departmentId)?.name,
            branch: db.branches.find((b) => b.id === e.branchId)?.name,
            sameBranch: e.branchId === me.branchId,
            photoDataUrl: e.photoDataUrl,
            username: e.telegramUsername?.replace(/^@/, "") || undefined,
            phone: phones ? e.phone || undefined : undefined,
            atWork: Boolean(record?.checkIn && !record.checkOut),
          };
        })
        .sort((a, b) => Number(b.sameBranch) - Number(a.sameBranch) || a.name.localeCompare(b.name));
      res.json({ rows, phones });
    }),
  );

  /* -------------------------------------------------------- tanaffus --- */
  router.post(
    "/mini/break",
    perEmployee(20),
    route(async (req, res) => {
      const auth = sessionOf(req);
      const { action } = z.object({ action: z.enum(["start", "end"]) }).parse(req.body);
      const time = tashkentClock();
      const row = await updateDb((db) => {
        const employee = ownEmployee(db, auth);
        const date = shiftDateAt(db, employee, tashkentIsoDate(), time);
        if (!miniFeatures(db, employee).breaks) throw httpError("Tanaffus belgilash kompaniyada yoqilmagan.", 403);
        const record = db.attendance.find((a) => a.employeeId === employee.id && a.date === date);
        if (!record?.checkIn || record.checkOut) throw httpError("Tanaffus faqat ish vaqtida belgilanadi.", 409);
        record.breaks ||= [];
        const open = record.breaks.find((b) => !b.end);
        if (action === "start") {
          if (open) throw httpError("Tanaffus allaqachon boshlangan.", 409);
          if (record.breaks.length >= 6) throw httpError("Bugun juda ko‘p tanaffus belgilangan.", 422);
          record.breaks.push({ start: time });
        } else {
          if (!open) throw httpError("Ochiq tanaffus yo‘q.", 409);
          open.end = time;
        }
        record.updatedAt = new Date().toISOString();
        return { breaks: record.breaks, totalMinutes: breakMinutes(record.breaks, time) };
      });
      res.json(row);
    }),
  );

  /* --------------------------------------- e’lon: tanishdim / so‘rovnoma --- */
  router.post(
    "/mini/notifications/:id/ack",
    perEmployee(30),
    route(async (req, res) => {
      const auth = sessionOf(req);
      const { answer } = z.object({ answer: z.string().trim().max(60).optional() }).parse(req.body || {});
      const row = await updateDb((db) => {
        const item = db.notifications.find((n) => n.id === req.params.id && n.employeeId === auth.employeeId && n.companyId === auth.companyId);
        if (!item) throw httpError("Xabar topilmadi.", 404);
        if (item.ackAt) throw httpError(item.options ? "Siz allaqachon javob bergansiz." : "Allaqachon tasdiqlangan.", 409);
        if (item.options?.length) {
          if (!answer || !item.options.includes(answer)) throw httpError("Javob variantini tanlang.", 400);
          item.answer = answer;
        }
        item.ackAt = new Date().toISOString();
        item.readAt ||= item.ackAt;
        item.read = true;
        const announcement = item.announcementId ? db.announcements.find((a) => a.id === item.announcementId) : undefined;
        if (announcement) {
          const staffora = (announcement.report ||= {}).staffora || { recipients: 0, delivered: 0 };
          if (announcement.ackRequired || !announcement.options) staffora.acknowledged = (staffora.acknowledged || 0) + 1;
          if (item.answer) staffora.answers = { ...(staffora.answers || {}), [item.answer]: (staffora.answers?.[item.answer] || 0) + 1 };
          announcement.report!.staffora = staffora;
        }
        return { ...item };
      });
      res.json(row);
    }),
  );

  /* -------------------------------------------- fayl yuklab olish havolasi --- */
  router.post(
    "/mini/download",
    perEmployee(20),
    route(async (req, res) => {
      const auth = sessionOf(req);
      const input = z
        .discriminatedUnion("kind", [
          z.object({ kind: z.literal("payslip"), month: z.string().regex(MONTH) }),
          z.object({ kind: z.literal("document"), id: z.string().min(1).max(64) }),
        ])
        .parse(req.body);
      const db = await readDb();
      const employee = ownEmployee(db, auth);
      let fileName: string;
      if (input.kind === "payslip") {
        const period = closedPeriod(db, employee.companyId, input.month);
        if (!period?.lines.some((l) => l.employeeId === employee.id)) throw httpError("Bu oy uchun hisob varaqasi yo‘q.", 404);
        fileName = `Hisob-varaqa-${input.month}.xlsx`;
      } else {
        const doc = db.documents.find((d) => d.id === input.id && d.employeeId === employee.id && d.companyId === employee.companyId);
        if (!doc) throw httpError("Hujjat topilmadi.", 404);
        fileName = `${doc.title.replace(/[^\p{L}\p{N} ._-]/gu, "").trim() || "hujjat"}${doc.mime === "application/pdf" ? ".pdf" : doc.mime === "image/png" ? ".png" : ".jpg"}`;
      }
      const ref = input.kind === "payslip" ? input.month : input.id;
      // Telegram faylni o‘zi yuklaydi (sessiyasiz) — shuning uchun 5 daqiqalik imzolangan havola.
      const token = jwt.sign({ t: "MINI_FILE", e: employee.id, c: employee.companyId, k: input.kind, r: ref }, fileSecret(), { expiresIn: 300 });
      res.json({ path: `/api/mini-file/${token}`, fileName });
    }),
  );

  /* ---------------------------------------------- xabar ulashish (8.0) --- */
  router.post(
    "/mini/share",
    perEmployee(10),
    route(async (req, res) => {
      const auth = sessionOf(req);
      const input = z.object({ title: z.string().trim().min(1).max(64), text: z.string().trim().min(1).max(1500) }).parse(req.body);
      const db = await readDb();
      const employee = ownEmployee(db, auth);
      const api = employee.telegramChannel === "COMPANY_BOT" ? companyBotApi(employee.companyId) : employee.telegramChannel === "EMPLOYEE_BOT" ? undefined : botApi();
      const userId = Number(auth.telegramId);
      if (!api || !Number.isSafeInteger(userId)) return res.status(204).end();
      try {
        const prepared = await api.savePreparedInlineMessage(
          userId,
          {
            type: "article",
            id: randomUUID().slice(0, 32),
            title: input.title,
            input_message_content: { message_text: input.text },
          },
          { allow_user_chats: true, allow_group_chats: true, allow_channel_chats: false, allow_bot_chats: false },
        );
        res.json({ id: prepared.id });
      } catch {
        // Bot inline rejimi yoqilmagan yoki eski Telegram — mijoz oddiy ulashish havolasini ishlatadi.
        res.status(204).end();
      }
    }),
  );

  return router;
}

/* ------------------------------------------------- ochiq (sessiyasiz) yo‘llar --- */
export function createMiniPublicRouter() {
  const router = Router();

  router.get(
    "/mini-file/:token",
    route(async (req, res) => {
      let payload: { t: string; e: string; c: string; k: "payslip" | "document"; r: string };
      try {
        payload = jwt.verify(String(req.params.token), fileSecret()) as typeof payload;
      } catch {
        return res.status(410).type("text/plain; charset=utf-8").send("Havola muddati tugagan. Ilovadan qayta yuklab oling.");
      }
      if (payload.t !== "MINI_FILE") return res.status(400).end();
      const db = await readDb();
      const employee = db.employees.find((e) => e.id === payload.e && e.companyId === payload.c && e.status === "ACTIVE");
      if (!employee) return res.status(404).end();
      res.setHeader("Cache-Control", "private, no-store");
      if (payload.k === "payslip") {
        const period = closedPeriod(db, payload.c, payload.r);
        const line = period?.lines.find((l) => l.employeeId === employee.id);
        if (!period || !line) return res.status(404).end();
        const company = db.companies.find((c) => c.id === payload.c);
        const workbook = createWorkbook();
        const sheet = workbook.addWorksheet("Hisob varaqasi", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true } });
        sheet.columns = [{ width: 34 }, { width: 22 }];
        const money = (v: number) => Math.round(v);
        sheet.addRow([`${company?.name || "Staffora"} — hisob varaqasi`]).font = { bold: true, size: 14 };
        sheet.addRow([monthLabel(period.month)]).font = { size: 12, color: { argb: "FF5E6B67" } };
        sheet.addRow([]);
        const rows: [string, string | number][] = [
          ["Xodim", line.name],
          ["Tabel raqami", line.employeeNo],
          ["Lavozim", line.position || "—"],
          ["Ish kunlari", `${line.days} / ${line.expectedDays}`],
          ["Oylik (stavka)", money(line.base)],
          ["Qo‘shimcha ish", money(line.overtimeAmount)],
          ["Bonus", money(line.bonus)],
          [`Kechikish ushlanmasi (${line.lateMinutes} daq)`, -money(line.lateDeduction)],
          [`Kelmagan kunlar (${line.absentDays})`, -money(line.absenceDeduction)],
          ["Jarima", -money(line.fine)],
          ["Avans", -money(line.advance)],
        ];
        for (const [label, value] of rows) {
          const r = sheet.addRow([label, value]);
          if (typeof value === "number") r.getCell(2).numFmt = '#,##0" so‘m";[Red]-#,##0" so‘m"';
          r.getCell(1).font = { color: { argb: "FF5E6B67" } };
        }
        sheet.addRow([]);
        const net = sheet.addRow(["Qo‘lga", money(line.net)]);
        net.font = { bold: true, size: 13 };
        net.getCell(2).numFmt = '#,##0" so‘m"';
        sheet.addRow([]);
        sheet.addRow([`Yopilgan: ${dmy(period.closedAt.slice(0, 10))}`]).font = { size: 10, color: { argb: "FF8A94A6" } };
        if (line.explanation) sheet.addRow([line.explanation]).font = { size: 10, color: { argb: "FF8A94A6" } };
        return sendWorkbook(res, workbook, `Hisob-varaqa-${period.month}.xlsx`);
      }
      const doc = db.documents.find((d) => d.id === payload.r && d.employeeId === employee.id);
      const file = doc && (await readDocumentFile(doc.id));
      if (!doc || !file) return res.status(404).end();
      const ext = file.mime === "application/pdf" ? ".pdf" : file.mime === "image/png" ? ".png" : ".jpg";
      res.setHeader("Content-Type", file.mime);
      res.attachment(`${doc.title}${ext}`);
      res.send(file.data);
    }),
  );

  /** Mini App xatolari jurnali (kamera, GPS, kirish…). Sessiya bo‘lsa — xodimga bog‘lanadi. */
  router.post(
    "/mini-log",
    rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }),
    route(async (req, res) => {
      const input = z
        .object({
          kind: z.string().trim().min(1).max(40),
          message: z.string().trim().min(1).max(500),
          detail: z.string().max(2000).optional(),
          platform: z.string().max(30).optional(),
          version: z.string().max(20).optional(),
        })
        .parse(req.body);
      const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined;
      const session = bearer ? verifyEmployeeToken(bearer) : undefined;
      await updateDb((db) => {
        db.clientLogs.unshift({
          id: randomUUID(),
          companyId: session?.companyId,
          employeeId: session?.employeeId,
          kind: input.kind,
          message: input.message,
          detail: input.detail,
          platform: input.platform,
          version: input.version,
          at: new Date().toISOString(),
        });
      });
      res.status(204).end();
    }),
  );
  return router;
}

/* -------------------------------------------- panel (rahbar Mini App’i) --- */
export function createManagerExtraRouter() {
  const router = Router();
  const tenantOf = (req: AuthedRequest) => {
    if (!req.session?.companyId) throw httpError("Kompaniya tanlanmagan.", 403);
    return req.session.companyId;
  };

  /** Bugungi «kechikaman» ogohlantirishlari. */
  router.get(
    "/late-notices",
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      if (!can(auth.session!.role, "attendance.view")) return res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
      const tenant = tenantOf(auth);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || "")) ? String(req.query.date) : tashkentIsoDate();
      const db = await readDb();
      const scope = auth.session!.role === "BRANCH_MANAGER" ? new Set(db.users.find((u) => u.id === auth.session!.userId)?.branchIds || []) : null;
      res.json(
        db.lateNotices
          .filter((n) => n.companyId === tenant && n.date === date)
          .map((n) => ({ ...n, employee: db.employees.find((e) => e.id === n.employeeId) }))
          .filter((n) => n.employee && (!scope || scope.has(n.employee.branchId)))
          .map(({ employee, ...n }) => ({ ...n, employeeName: nameOf(employee), branchId: employee!.branchId })),
      );
    }),
  );

  /** Mini App xatolari: kompaniya admini o‘z xodimlarinikini, super admin — hammasini. */
  router.get(
    "/client-logs",
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const role = auth.session!.role;
      if (!["SUPER_ADMIN", "COMPANY_OWNER", "IT_ADMIN", "HR_ADMIN"].includes(role)) return res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
      const db = await readDb();
      const rows = db.clientLogs
        .filter((l) => role === "SUPER_ADMIN" || l.companyId === auth.session!.companyId)
        .slice(0, 200)
        .map((l) => ({ ...l, employeeName: l.employeeId ? nameOf(db.employees.find((e) => e.id === l.employeeId)) : undefined }));
      res.json(rows);
    }),
  );

  /** Mini App sozlamalari (biometriya, ma’lumotnoma, tanaffus, reyting, rahbar xulosasi). */
  router.put(
    "/company/mini-app",
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      if (!can(auth.session!.role, "settings.manage")) return res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
      const tenant = tenantOf(auth);
      const input = z
        .object({
          biometricEnabled: z.boolean(),
          faceEvery: z.coerce.number().int().min(2).max(50),
          directoryEnabled: z.boolean(),
          directoryPhones: z.boolean(),
          breaksEnabled: z.boolean(),
          leaderboardEnabled: z.boolean(),
          managerDigest: z.boolean(),
        })
        .parse(req.body);
      const company = await updateDb((db) => {
        const row = db.companies.find((c) => c.id === tenant);
        if (!row) throw httpError("Kompaniya topilmadi.", 404);
        row.miniApp = input;
        if (!input.biometricEnabled) {
          const now = new Date().toISOString();
          for (const d of db.biometricDevices) if (d.companyId === tenant && !d.revokedAt) d.revokedAt = now;
        }
        db.auditLogs.unshift(audit(tenant, auth.session!.name, "Mini App sozlamalari o‘zgartirildi", "company", tenant, undefined, input));
        return row;
      });
      res.json(company.miniApp);
    }),
  );
  return router;
}
