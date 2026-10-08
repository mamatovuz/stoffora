import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { canAny } from "../lib/permissions";
import { assertAttendanceTimeOrder, calculateAttendance } from "../lib/attendance";
import { allowedBranches } from "../lib/branches";
import { tashkentClock, tashkentIsoDate } from "../lib/format";
import { dayPlan } from "../lib/schedule";
import type { Attendance, AttendanceCorrection, Database, Employee } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";
import { notifyEmployee } from "./integrations/hooks";
import { notifyRequest } from "./request-actions";
import { assertMonthOpen } from "./payroll-workflow";

/*
 * Belgilash so‘rovi (unutilgan kirish/chiqish):
 *   xodim: sana, vaqt, Kirish/Chiqish, filial, izoh → HR / filial rahbari tasdiqlaydi yoki rad etadi →
 *   tasdiqlansa davomat qaydiga shu vaqt yoziladi (kechikish, ishlangan vaqt qayta hisoblanadi).
 * Oddiy xodim — faqat o‘z filiali; lavozimida «istalgan filialdan» yoqilganlar — ruxsat etilgan filiallardan.
 * So‘rov paneldagi «Davomat so‘rovlari», Mini App va mobil ilovadagi rahbar bo‘limida ko‘rinadi.
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const sessionOf = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
const nameOf = (e?: Pick<Employee, "firstName" | "lastName">) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
const dmy = (iso: string) => iso.split("-").reverse().join(".");
const KIND = { IN: "Kirish", OUT: "Chiqish" } as const;
const MAX_DAYS_BACK = 31;
const MAX_PENDING = 10;
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function describeCorrection(db: Database, row: AttendanceCorrection) {
  const employee = db.employees.find((e) => e.id === row.employeeId);
  return {
    ...row,
    employeeName: nameOf(employee),
    employeeNo: employee?.employeeNo,
    photoDataUrl: employee?.photoDataUrl,
    position: db.positions.find((p) => p.id === employee?.positionId)?.name,
    homeBranchId: employee?.branchId,
    branchName: db.branches.find((b) => b.id === row.branchId)?.name || "—",
  };
}

/** Rahbarlarga (ilova va Mini App’dagi xodim profili orqali) bildirishnoma — push ham shu yozuvdan ketadi. */
function notifyManagerEmployees(db: Database, row: AttendanceCorrection, employee: Employee, now: string) {
  const branchIds = new Set([row.branchId, employee.branchId]);
  const managers = db.users.filter(
    (u) =>
      u.companyId === employee.companyId &&
      u.telegramId &&
      ["COMPANY_OWNER", "HR_ADMIN", "HR_MANAGER", "BRANCH_MANAGER"].includes(u.role) &&
      (u.role !== "BRANCH_MANAGER" || (u.branchIds || []).some((id) => branchIds.has(id))),
  );
  const seen = new Set<string>();
  for (const user of managers) {
    const self = db.employees.find((e) => e.companyId === employee.companyId && e.status === "ACTIVE" && e.telegramId === user.telegramId);
    if (!self || self.id === employee.id || seen.has(self.id)) continue;
    seen.add(self.id);
    db.notifications.unshift({
      id: randomUUID(),
      companyId: employee.companyId,
      employeeId: self.id,
      title: `Belgilash so‘rovi: ${nameOf(employee)}`,
      body: `${dmy(row.date)} · ${KIND[row.kind]} ${row.time} · ${db.branches.find((b) => b.id === row.branchId)?.name || ""}${row.comment ? ` — ${row.comment}` : ""}`,
      type: "MANAGER",
      read: false,
      createdAt: now,
      go: "manager_requests",
    });
  }
}

/* ============================================================ Mini App / ilova === */
export function createMiniCorrectionRouter() {
  const router = Router();

  router.get(
    "/mini/corrections",
    route(async (req, res) => {
      const auth = sessionOf(req);
      const db = await readDb();
      const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId && e.status === "ACTIVE");
      if (!employee) throw httpError("Xodim topilmadi.", 404);
      const branches = allowedBranches(db, employee);
      const today = tashkentIsoDate();
      res.json({
        items: db.attendanceCorrections
          .filter((r) => r.employeeId === employee.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 40)
          .map((r) => describeCorrection(db, r)),
        branches: branches.map((b) => ({ id: b.id, name: b.name })),
        canChooseBranch: branches.length > 1,
        homeBranchId: employee.branchId,
        minDate: addDays(today, -MAX_DAYS_BACK),
        today,
        now: tashkentClock(),
      });
    }),
  );

  router.post(
    "/mini/corrections",
    rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `corr:${sessionOf(req)?.employeeId || req.ip}` }),
    route(async (req, res) => {
      const auth = sessionOf(req);
      const input = z
        .object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana noto‘g‘ri."),
          time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Vaqtni tanlang."),
          kind: z.enum(["IN", "OUT"]),
          branchId: z.string().optional(),
          comment: z.string().trim().min(3, "Izoh yozing (kamida 3 belgi).").max(500),
        })
        .parse(req.body);
      const today = tashkentIsoDate();
      const created = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId && e.status === "ACTIVE");
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        if (input.date > today || (input.date === today && input.time > tashkentClock())) throw httpError("Kelajakdagi vaqt uchun so‘rov yuborib bo‘lmaydi.", 422);
        if (input.date < addDays(today, -MAX_DAYS_BACK)) throw httpError(`Faqat oxirgi ${MAX_DAYS_BACK} kun uchun so‘rov yuborish mumkin.`, 422);
        const branches = allowedBranches(db, employee);
        const branch = input.branchId ? branches.find((b) => b.id === input.branchId) : branches.find((b) => b.id === employee.branchId) || branches[0];
        if (!branch) throw httpError(input.branchId ? "Bu filialda belgilash huquqingiz yo‘q." : "Filialingiz belgilanmagan. HR bilan bog‘laning.", 422);
        const mine = db.attendanceCorrections.filter((r) => r.employeeId === employee.id && r.status === "PENDING");
        if (mine.length >= MAX_PENDING) throw httpError("Ko‘rib chiqilmagan so‘rovlaringiz juda ko‘p. Javobni kuting.", 429);
        if (mine.some((r) => r.date === input.date && r.kind === input.kind)) throw httpError(`${dmy(input.date)} uchun «${KIND[input.kind]}» so‘rovi allaqachon yuborilgan.`, 409);
        const record = db.attendance.find((a) => a.employeeId === employee.id && a.date === input.date);
        if (input.kind === "IN" && record?.checkIn) throw httpError(`${dmy(input.date)} kuni kirish allaqachon belgilangan (${record.checkIn}).`, 409);
        if (input.kind === "OUT") {
          if (record?.checkOut) throw httpError(`${dmy(input.date)} kuni chiqish allaqachon belgilangan (${record.checkOut}).`, 409);
          const pendingIn = mine.find((r) => r.date === input.date && r.kind === "IN");
          if (!record?.checkIn && !pendingIn) throw httpError(`${dmy(input.date)} kuni kirish qaydi yo‘q — avval «Kirish» so‘rovini yuboring.`, 422);
          const from = record?.checkIn || pendingIn!.time;
          // Chiqish kirishdan kichik bo‘lsa — keyingi kunda (kechki smena: 14:00 → 00:30).
          if (input.time === from) throw httpError("Chiqish vaqti kirish vaqtidan farq qilishi kerak.", 422);
          if (input.time < from && input.date === today) throw httpError("Kelajakdagi vaqt uchun so‘rov yuborib bo‘lmaydi.", 422);
          assertAttendanceTimeOrder(from, input.time);
        }
        const now = new Date().toISOString();
        const row: AttendanceCorrection = {
          id: randomUUID(),
          companyId: employee.companyId,
          employeeId: employee.id,
          date: input.date,
          time: input.time,
          kind: input.kind,
          branchId: branch.id,
          comment: input.comment,
          status: "PENDING",
          createdAt: now,
          updatedAt: now,
        };
        db.attendanceCorrections.unshift(row);
        db.notifications.unshift({
          id: randomUUID(),
          companyId: employee.companyId,
          title: `Belgilash so‘rovi: ${nameOf(employee)}`,
          body: `${dmy(row.date)} · ${KIND[row.kind]} ${row.time} · ${branch.name} — ${row.comment}`,
          type: "ATTENDANCE_REQUEST",
          read: false,
          createdAt: now,
          go: `/attendance-requests?id=${row.id}`,
        });
        notifyManagerEmployees(db, row, employee, now);
        db.auditLogs.unshift(audit(employee.companyId, nameOf(employee), `Belgilash so‘rovi: ${dmy(row.date)} ${KIND[row.kind]} ${row.time} (${branch.name})`, "employee", employee.id));
        return { row, employee, branch };
      });
      const db = await readDb();
      void notifyRequest(db, {
        companyId: created.employee.companyId,
        branchId: created.row.branchId,
        kind: "mark",
        id: created.row.id,
        pushTitle: "Belgilash so‘rovi",
        text: `🕘 <b>Belgilash so‘rovi</b>\n${nameOf(created.employee)}\n${dmy(created.row.date)} · ${KIND[created.row.kind]} ${created.row.time}\nFilial: ${created.branch.name}\nIzoh: ${created.row.comment}`,
      }).catch(() => undefined);
      res.status(201).json(describeCorrection(db, created.row));
    }),
  );

  router.post(
    "/mini/corrections/:id/cancel",
    route(async (req, res) => {
      const auth = sessionOf(req);
      await updateDb((db) => {
        const row = db.attendanceCorrections.find((r) => r.id === req.params.id && r.employeeId === auth.employeeId && r.companyId === auth.companyId);
        if (!row) throw httpError("So‘rov topilmadi.", 404);
        if (row.status !== "PENDING") throw httpError("Faqat kutilayotgan so‘rovni bekor qilish mumkin.", 409);
        row.status = "CANCELLED";
        row.updatedAt = new Date().toISOString();
      });
      res.json({ ok: true });
    }),
  );
  return router;
}

/** Tasdiqlangan so‘rovni davomat qaydiga yozadi (yangi qayd yoki mavjudini to‘ldiradi). */
function applyCorrection(db: Database, row: AttendanceCorrection, employee: Employee, actor: string): Attendance {
  const schedule = db.schedules.find((s) => s.id === employee.scheduleId);
  const grace = schedule?.graceMinutes || 0;
  const now = new Date().toISOString();
  const note = `Belgilash so‘rovi (${KIND[row.kind]} ${row.time}) — tasdiqladi: ${actor}`;
  const record = db.attendance.find((a) => a.employeeId === employee.id && a.date === row.date);
  if (!record) {
    if (row.kind === "OUT") throw httpError("Bu kun uchun kirish qaydi yo‘q — avval kirish so‘rovini tasdiqlang.", 409);
    const day = dayPlan(db, employee, row.date);
    const scheduledStart = day.enabled ? day.start : row.time;
    const scheduledEnd = day.enabled ? day.end : row.time;
    const created: Attendance = {
      id: randomUUID(),
      companyId: employee.companyId,
      employeeId: employee.id,
      branchId: row.branchId,
      date: row.date,
      scheduledStart,
      scheduledEnd,
      checkIn: row.time,
      ...calculateAttendance({ scheduledStart, scheduledEnd, checkIn: row.time, graceMinutes: grace }),
      verification: ["MANUAL"],
      note,
      updatedAt: now,
    };
    db.attendance.push(created);
    return created;
  }
  const checkIn = row.kind === "IN" ? row.time : record.checkIn;
  const checkOut = row.kind === "OUT" ? row.time : record.checkOut;
  if (!checkIn) throw httpError("Bu kun uchun kirish qaydi yo‘q — avval kirish so‘rovini tasdiqlang.", 409);
  if (row.kind === "IN" && record.checkIn) throw httpError(`Kirish allaqachon belgilangan (${record.checkIn}). Kerak bo‘lsa davomatni qo‘lda tahrirlang.`, 409);
  if (row.kind === "OUT" && record.checkOut) throw httpError(`Chiqish allaqachon belgilangan (${record.checkOut}). Kerak bo‘lsa davomatni qo‘lda tahrirlang.`, 409);
  Object.assign(record, calculateAttendance({ scheduledStart: record.scheduledStart, scheduledEnd: record.scheduledEnd, checkIn, checkOut, graceMinutes: grace }), {
    checkIn,
    checkOut,
    note: record.note ? `${record.note}; ${note}` : note,
    verification: [...new Set([...record.verification, "MANUAL"])] as Attendance["verification"],
    updatedAt: now,
  });
  return record;
}

/* ============================================================== Panel === */
export function createCorrectionRouter() {
  const router = Router();
  const permit = (req: Request, res: Response, next: NextFunction) =>
    canAny((req as AuthedRequest).session!.role, ["attendance.edit", "leave.approve"]) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  const scopeOf = (req: AuthedRequest, db: Database) =>
    req.session!.role === "BRANCH_MANAGER" ? new Set(db.users.find((u) => u.id === req.session!.userId)?.branchIds || []) : null;
  const inScope = (scope: Set<string> | null, row: AttendanceCorrection, employee?: Employee) => !scope || scope.has(row.branchId) || Boolean(employee && scope.has(employee.branchId));

  router.get(
    "/attendance-corrections",
    permit,
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = auth.session!.companyId!;
      const db = await readDb();
      const scope = scopeOf(auth, db);
      const status = String(req.query.status || "");
      res.json(
        db.attendanceCorrections
          .filter((r) => r.companyId === tenant && (!status || status.split(",").includes(r.status)))
          .filter((r) => inScope(scope, r, db.employees.find((e) => e.id === r.employeeId)))
          .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
          .slice(0, 500)
          .map((r) => describeCorrection(db, r)),
      );
    }),
  );

  router.post(
    "/attendance-corrections/:id/decide",
    permit,
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = auth.session!.companyId!;
      const { approve, note } = z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() }).parse(req.body);
      const result = await updateDb((db) => {
        const row = db.attendanceCorrections.find((r) => r.id === req.params.id && r.companyId === tenant);
        if (!row) throw httpError("So‘rov topilmadi.", 404);
        const employee = db.employees.find((e) => e.id === row.employeeId);
        if (!employee || !inScope(scopeOf(auth, db), row, employee)) throw httpError("So‘rov topilmadi.", 404);
        if (row.status !== "PENDING") throw httpError("So‘rov allaqachon ko‘rib chiqilgan.", 409);
        const now = new Date().toISOString();
        if (approve) {
          assertMonthOpen(db, tenant, row.date);
          const before = db.attendance.find((a) => a.employeeId === employee.id && a.date === row.date);
          row.previous = before ? { checkIn: before.checkIn, checkOut: before.checkOut } : {};
          row.attendanceId = applyCorrection(db, row, employee, auth.session!.name).id;
        }
        row.status = approve ? "APPROVED" : "REJECTED";
        row.decidedBy = auth.session!.name;
        row.decidedNote = note || undefined;
        row.decidedAt = now;
        row.updatedAt = now;
        // Shu so‘rov haqidagi panel bildirishnomasi o‘qilgan bo‘ladi.
        for (const n of db.notifications) if (n.companyId === tenant && !n.employeeId && n.go === `/attendance-requests?id=${row.id}`) n.read = true;
        db.notifications.unshift({
          id: randomUUID(),
          companyId: tenant,
          employeeId: employee.id,
          title: approve ? "Belgilash so‘rovi tasdiqlandi" : "Belgilash so‘rovi rad etildi",
          body: `${dmy(row.date)} · ${KIND[row.kind]} ${row.time}${note ? ` — ${note}` : ""}`,
          type: "ATTENDANCE",
          read: false,
          createdAt: now,
          go: "marks",
        });
        db.auditLogs.unshift(
          audit(tenant, auth.session!.name, `Belgilash so‘rovi ${approve ? "tasdiqlandi" : "rad etildi"}: ${nameOf(employee)} (${dmy(row.date)} ${KIND[row.kind]} ${row.time})`, "employee", employee.id),
        );
        return { row: { ...row }, employee };
      });
      const db = await readDb();
      const { row } = result;
      void notifyEmployee(
        db,
        result.employee,
        "attendance",
        approve
          ? `✅ <b>Belgilash so‘rovi tasdiqlandi</b>\n${dmy(row.date)} · ${KIND[row.kind]} ${row.time} davomatga yozildi.${note ? `\nIzoh: ${note}` : ""}`
          : `❌ <b>Belgilash so‘rovi rad etildi</b>\n${dmy(row.date)} · ${KIND[row.kind]} ${row.time}${note ? `\nSabab: ${note}` : ""}`,
        { go: "marks" },
      ).catch(() => undefined);
      res.json(describeCorrection(db, row));
    }),
  );
  return router;
}
