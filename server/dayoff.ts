import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { canAny } from "../lib/permissions";
import { tashkentIsoDate } from "../lib/format";
import { dayPlan, weeklyHours } from "../lib/schedule";
import type { Database, DayOffMove, Employee } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";
import { notifyEmployee } from "./integrations/hooks";
import { notifyRequest } from "./request-actions";

/*
 * Dam olish kunini bir martaga ko‘chirish:
 *   xodim: «bu hafta juma o‘rniga shanba dam olaman» → rahbar tasdiqlaydi →
 *   juma — ish kuni, shanba — dam olish kuni (faqat shu ikki sana; keyingi hafta yana odatdagidek).
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const sessionOf = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
const nameOf = (e?: Pick<Employee, "firstName" | "lastName">) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
const dmy = (iso: string) => iso.split("-").reverse().join(".");
const WEEKDAYS = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const weekdayOf = (iso: string) => WEEKDAYS[new Date(`${iso}T12:00:00+05:00`).getUTCDay()];
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const MAX_GAP_DAYS = 6;
const HORIZON_DAYS = 28;

const onLeave = (db: Database, employeeId: string, date: string) =>
  db.leaveRequests.some((l) => l.employeeId === employeeId && l.status === "APPROVED" && l.startDate <= date && l.endDate >= date);
const busy = (db: Database, employeeId: string, date: string) =>
  db.dayOffMoves.some((m) => m.employeeId === employeeId && m.status === "PENDING" && (m.fromDate === date || m.toDate === date));

/** Yaqin 4 haftadagi tanlov: qaysi dam kunlarini va qaysi ish kunlariga ko‘chirish mumkin. */
export function dayOffOptions(db: Database, employee: Employee, today = tashkentIsoDate()) {
  const restDays: string[] = [];
  const workDays: string[] = [];
  for (let i = 0; i <= HORIZON_DAYS; i += 1) {
    const date = addDays(today, i);
    if (onLeave(db, employee.id, date) || busy(db, employee.id, date)) continue;
    const plan = dayPlan(db, employee, date);
    // Bugun ishga kelingan bo‘lsa — bugungi kunni ko‘chirib bo‘lmaydi.
    if (date === today && db.attendance.some((a) => a.employeeId === employee.id && a.date === date && a.checkIn)) continue;
    if (!plan.enabled && !plan.overridden) restDays.push(date);
    else if (plan.enabled) workDays.push(date);
  }
  return { restDays, workDays, maxGapDays: MAX_GAP_DAYS };
}

function describe(db: Database, move: DayOffMove) {
  const employee = db.employees.find((e) => e.id === move.employeeId);
  return { ...move, employeeName: nameOf(employee), branchId: employee?.branchId, fromWeekday: weekdayOf(move.fromDate), toWeekday: weekdayOf(move.toDate) };
}

/* ============================================================ Mini App === */
export function createMiniDayOffRouter() {
  const router = Router();

  router.get(
    "/mini/dayoff-moves",
    route(async (req, res) => {
      const auth = sessionOf(req);
      const db = await readDb();
      const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId && e.status === "ACTIVE");
      if (!employee) throw httpError("Xodim topilmadi.", 404);
      res.json({
        items: db.dayOffMoves
          .filter((m) => m.employeeId === employee.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 20)
          .map((m) => describe(db, m)),
        options: dayOffOptions(db, employee),
        restWeekdays: employee.restDays || [],
      });
    }),
  );

  router.post(
    "/mini/dayoff-moves",
    route(async (req, res) => {
      const auth = sessionOf(req);
      const input = z
        .object({
          fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          reason: z.string().trim().max(200).optional(),
        })
        .parse(req.body);
      const created = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId && e.status === "ACTIVE");
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        const options = dayOffOptions(db, employee);
        if (!options.restDays.includes(input.fromDate)) throw httpError(`${dmy(input.fromDate)} — sizning dam olish kuningiz emas (yoki band).`, 422);
        if (!options.workDays.includes(input.toDate)) throw httpError(`${dmy(input.toDate)} — ish kuningiz emas (yoki band).`, 422);
        const gap = Math.abs(Date.parse(input.toDate) - Date.parse(input.fromDate)) / 86_400_000;
        if (gap > MAX_GAP_DAYS) throw httpError("Dam olish kunini faqat shu hafta ichida (6 kungacha) ko‘chirish mumkin.", 422);
        const now = new Date().toISOString();
        const move: DayOffMove = { id: randomUUID(), companyId: employee.companyId, employeeId: employee.id, ...input, reason: input.reason || undefined, status: "PENDING", createdAt: now, updatedAt: now };
        db.dayOffMoves.unshift(move);
        db.notifications.unshift({
          id: randomUUID(),
          companyId: employee.companyId,
          title: "Dam olish kunini ko‘chirish",
          body: `${nameOf(employee)}: ${dmy(move.fromDate)} (${weekdayOf(move.fromDate)}) → ${dmy(move.toDate)} (${weekdayOf(move.toDate)})${move.reason ? ` · ${move.reason}` : ""}. Ta’til va yo‘qlik sahifasida tasdiqlang.`,
          type: "LEAVE",
          read: false,
          createdAt: now,
        });
        db.auditLogs.unshift(audit(employee.companyId, nameOf(employee), `Dam kunini ko‘chirish so‘rovi: ${dmy(move.fromDate)} → ${dmy(move.toDate)}`, "employee", employee.id));
        return { move, employee };
      });
      const db = await readDb();
      void notifyRequest(db, {
        companyId: created.employee.companyId,
        branchId: created.employee.branchId,
        kind: "dayoff",
        id: created.move.id,
        pushTitle: "Dam kunini ko‘chirish so‘rovi",
        text: `🔁 <b>Dam olish kunini ko‘chirish</b>\n${nameOf(created.employee)}\n${dmy(created.move.fromDate)} (${weekdayOf(created.move.fromDate)}) ishlaydi → ${dmy(created.move.toDate)} (${weekdayOf(created.move.toDate)}) dam oladi`,
      }).catch(() => undefined);
      res.status(201).json(describe(db, created.move));
    }),
  );

  router.post(
    "/mini/dayoff-moves/:id/cancel",
    route(async (req, res) => {
      const auth = sessionOf(req);
      await updateDb((db) => {
        const row = db.dayOffMoves.find((m) => m.id === req.params.id && m.employeeId === auth.employeeId && m.companyId === auth.companyId);
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

/* ============================================================== Panel === */
export function createDayOffRouter() {
  const router = Router();
  const permit = (req: Request, res: Response, next: NextFunction) =>
    canAny((req as AuthedRequest).session!.role, ["leave.approve", "attendance.edit"]) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  const scopeOf = (req: AuthedRequest, db: Database) =>
    req.session!.role === "BRANCH_MANAGER" ? new Set(db.users.find((u) => u.id === req.session!.userId)?.branchIds || []) : null;

  router.get(
    "/dayoff-moves",
    permit,
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = auth.session!.companyId!;
      const db = await readDb();
      const scope = scopeOf(auth, db);
      const status = String(req.query.status || "");
      res.json(
        db.dayOffMoves
          .filter((m) => m.companyId === tenant && (!status || m.status === status))
          .map((m) => describe(db, m))
          .filter((m) => !scope || (m.branchId && scope.has(m.branchId)))
          .slice(0, 200),
      );
    }),
  );

  router.post(
    "/dayoff-moves/:id/decide",
    permit,
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = auth.session!.companyId!;
      const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
      const result = await updateDb((db) => {
        const row = db.dayOffMoves.find((m) => m.id === req.params.id && m.companyId === tenant);
        if (!row) throw httpError("So‘rov topilmadi.", 404);
        const employee = db.employees.find((e) => e.id === row.employeeId);
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        const scope = scopeOf(auth, db);
        if (scope && !scope.has(employee.branchId)) throw httpError("So‘rov topilmadi.", 404);
        if (row.status !== "PENDING") throw httpError("So‘rov allaqachon ko‘rib chiqilgan.", 409);
        if (approve && row.fromDate < tashkentIsoDate()) throw httpError("Sana o‘tib ketgan — so‘rovni tasdiqlab bo‘lmaydi.", 409);
        row.status = approve ? "APPROVED" : "REJECTED";
        row.decidedBy = auth.session!.name;
        row.updatedAt = new Date().toISOString();
        if (approve) {
          const schedule = db.schedules.find((s) => s.id === employee.scheduleId);
          const hours = weeklyHours(schedule, new Date(`${row.fromDate}T12:00:00+05:00`).getUTCDay());
          // Faqat shu ikki sanaga grafik o‘zgarishi — keyingi haftalar odatdagidek.
          db.scheduleOverrides = db.scheduleOverrides.filter((o) => !(o.employeeId === employee.id && (o.date === row.fromDate || o.date === row.toDate)));
          db.scheduleOverrides.push(
            { id: randomUUID(), companyId: tenant, employeeId: employee.id, date: row.fromDate, working: true, start: hours.start, end: hours.end, reason: `Dam kuni ${dmy(row.toDate)} ga ko‘chirildi`, dayOffMoveId: row.id },
            { id: randomUUID(), companyId: tenant, employeeId: employee.id, date: row.toDate, working: false, reason: `Dam olish (${dmy(row.fromDate)} dan ko‘chirildi)`, dayOffMoveId: row.id },
          );
        }
        db.notifications.unshift({
          id: randomUUID(),
          companyId: tenant,
          employeeId: employee.id,
          title: approve ? "Dam olish kuni ko‘chirildi" : "Dam kunini ko‘chirish rad etildi",
          body: `${dmy(row.fromDate)} (${weekdayOf(row.fromDate)}) → ${dmy(row.toDate)} (${weekdayOf(row.toDate)})`,
          type: "LEAVE",
          read: false,
          createdAt: row.updatedAt,
          go: "dayoff",
        });
        db.auditLogs.unshift(audit(tenant, auth.session!.name, `Dam kunini ko‘chirish ${approve ? "tasdiqlandi" : "rad etildi"}: ${nameOf(employee)} (${dmy(row.fromDate)} → ${dmy(row.toDate)})`, "employee", employee.id));
        return { row: { ...row }, employee };
      });
      const db = await readDb();
      void notifyEmployee(
        db,
        result.employee,
        "leave",
        approve
          ? `✅ <b>Dam olish kuni ko‘chirildi</b>\n${dmy(result.row.fromDate)} (${weekdayOf(result.row.fromDate)}) — ish kuni\n${dmy(result.row.toDate)} (${weekdayOf(result.row.toDate)}) — dam olasiz`
          : `❌ Dam kunini ko‘chirish (${dmy(result.row.fromDate)} → ${dmy(result.row.toDate)}) rad etildi.`,
        { go: "dayoff" },
      ).catch(() => undefined);
      res.json(describe(db, result.row));
    }),
  );
  return router;
}
