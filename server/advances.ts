import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { canAny } from "../lib/permissions";
import { tashkentIsoDate } from "../lib/format";
import { workingDaysInMonth } from "../lib/schedule";
import type { AdvanceRequest, Database, Employee } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";
import { notifyEmployee } from "./integrations/hooks";
import { closedPeriod, monthLabel } from "./payroll-routes";
import { payrollRows } from "./reports";

/*
 * «Mening oyligim» (real vaqtda) va avans so‘rovi.
 * Xodim oy davomida qancha ishlab topgani, ushlanmalar va taxminiy qo‘lga
 * tegadigan summani ko‘radi; avans so‘raydi → moliya tasdiqlaydi → avans
 * avtomatik ish haqidan ushlanadigan yozuvga aylanadi.
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const employeeSession = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
const nameOf = (e?: Employee) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");

export const DEFAULT_ADVANCE_PERCENT = 50;

/** Oy uchun avans chegarasi: oylikning N foizi − allaqachon berilgan − kutilayotgan. */
export function advanceLimit(db: Database, employee: Employee, month: string) {
  const company = db.companies.find((c) => c.id === employee.companyId);
  const enabled = company?.payroll?.advanceRequestsEnabled !== false;
  const percent = Math.min(100, Math.max(0, company?.payroll?.advanceMaxPercent ?? DEFAULT_ADVANCE_PERCENT));
  const max = Math.floor((employee.baseSalary * percent) / 100);
  const taken = db.payrollAdjustments
    .filter((a) => a.employeeId === employee.id && a.month === month && a.type === "ADVANCE")
    .reduce((sum, a) => sum + a.amount, 0);
  const pending = db.advanceRequests
    .filter((a) => a.employeeId === employee.id && a.month === month && a.status === "PENDING")
    .reduce((sum, a) => sum + a.amount, 0);
  const closed = Boolean(closedPeriod(db, employee.companyId, month));
  return {
    enabled: enabled && !closed && employee.baseSalary > 0,
    percent,
    max,
    taken,
    pending,
    available: enabled && !closed ? Math.max(0, max - taken - pending) : 0,
    closed,
  };
}

/** Xodimning shu oydagi ish haqi holati (bugungi kungacha). */
export function salarySnapshot(db: Database, employee: Employee, month = tashkentIsoDate().slice(0, 7)) {
  const row = payrollRows(db, employee.companyId, month).find((r) => r.employee.id === employee.id);
  const workingDays = workingDaysInMonth(db, employee, month);
  const closed = closedPeriod(db, employee.companyId, month);
  const frozen = closed?.lines.find((l) => l.employeeId === employee.id);
  return {
    month,
    label: monthLabel(month),
    closed: Boolean(closed),
    base: employee.baseSalary,
    workingDays,
    days: frozen?.days ?? row?.days ?? 0,
    expectedDays: frozen?.expectedDays ?? row?.expectedDays ?? 0,
    absentDays: frozen?.absentDays ?? row?.absentDays ?? 0,
    lateMinutes: frozen?.lateMinutes ?? row?.lateMinutes ?? 0,
    overtimeAmount: frozen?.overtimeAmount ?? row?.overtimeAmount ?? 0,
    pendingOvertimeMinutes: row?.pendingOvertimeMinutes ?? 0,
    bonus: frozen?.bonus ?? row?.bonus ?? 0,
    lateDeduction: frozen?.lateDeduction ?? row?.deduction ?? 0,
    absenceDeduction: frozen?.absenceDeduction ?? row?.absenceDeduction ?? 0,
    fine: frozen?.fine ?? row?.fine ?? 0,
    advance: frozen?.advance ?? row?.advance ?? 0,
    net: frozen?.net ?? row?.net ?? 0,
    // Bugungacha ishlab topilgani: oylikning ishlangan kunlarga to‘g‘ri keladigan qismi.
    earnedToDate: workingDays ? Math.round((employee.baseSalary / workingDays) * Math.min(workingDays, frozen?.days ?? row?.days ?? 0)) : 0,
  };
}

export function createMiniAdvanceRouter() {
  const router = Router();
  router.get(
    "/mini/salary",
    route(async (req, res) => {
      const auth = employeeSession(req);
      const db = await readDb();
      const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId);
      if (!employee) throw httpError("Xodim topilmadi.", 404);
      const month = tashkentIsoDate().slice(0, 7);
      res.json({
        ...salarySnapshot(db, employee, month),
        limit: advanceLimit(db, employee, month),
        requests: db.advanceRequests
          .filter((a) => a.employeeId === employee.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 12),
      });
    }),
  );
  router.post(
    "/mini/advances",
    route(async (req, res) => {
      const auth = employeeSession(req);
      const input = z
        .object({
          amount: z.coerce.number().int("Butun son kiriting.").min(10_000, "Eng kam summa — 10 000 so‘m.").max(1_000_000_000),
          reason: z.string().trim().max(200).optional(),
        })
        .parse(req.body);
      const month = tashkentIsoDate().slice(0, 7);
      const created = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId && e.status === "ACTIVE");
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        const limit = advanceLimit(db, employee, month);
        if (!limit.enabled) throw httpError(limit.closed ? "Bu oy yopilgan — avans so‘rab bo‘lmaydi." : "Kompaniyada avans so‘rash yoqilmagan.", 422);
        if (db.advanceRequests.some((a) => a.employeeId === employee.id && a.status === "PENDING"))
          throw httpError("Avvalgi so‘rovingiz hali ko‘rib chiqilmoqda.", 409);
        if (input.amount > limit.available) throw httpError(`Bu oy ko‘pi bilan ${som(limit.available)} so‘rash mumkin.`, 422);
        const now = new Date().toISOString();
        const row: AdvanceRequest = {
          id: randomUUID(),
          companyId: employee.companyId,
          employeeId: employee.id,
          month,
          amount: input.amount,
          reason: input.reason || undefined,
          status: "PENDING",
          createdAt: now,
          updatedAt: now,
        };
        db.advanceRequests.unshift(row);
        db.notifications.unshift({
          id: randomUUID(),
          companyId: employee.companyId,
          title: "Avans so‘rovi",
          body: `${nameOf(employee)} ${som(input.amount)} avans so‘radi${input.reason ? ` («${input.reason}»)` : ""}. Ish haqi sahifasida ko‘rib chiqing.`,
          type: "PAYROLL",
          read: false,
          createdAt: now,
        });
        db.auditLogs.unshift(audit(employee.companyId, nameOf(employee), `Avans so‘rovi: ${som(input.amount)}`, "employee", employee.id));
        return row;
      });
      res.status(201).json(created);
    }),
  );
  router.post(
    "/mini/advances/:id/cancel",
    route(async (req, res) => {
      const auth = employeeSession(req);
      await updateDb((db) => {
        const row = db.advanceRequests.find((a) => a.id === req.params.id && a.employeeId === auth.employeeId && a.companyId === auth.companyId);
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

/** Panel (va rahbar Mini App’i): avans so‘rovlarini ko‘rish va hal qilish. */
export function createAdvanceRouter() {
  const router = Router();
  const permit = (req: Request, res: Response, next: NextFunction) =>
    canAny((req as AuthedRequest).session!.role, ["payroll.edit"]) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });

  router.get(
    "/payroll/advances",
    permit,
    route(async (req, res) => {
      const tenant = (req as AuthedRequest).session!.companyId!;
      const db = await readDb();
      const status = String(req.query.status || "");
      res.json(
        db.advanceRequests
          .filter((a) => a.companyId === tenant && (!status || a.status === status))
          .slice(0, 300)
          .map((a) => {
            const employee = db.employees.find((e) => e.id === a.employeeId);
            return {
              ...a,
              employeeName: nameOf(employee),
              employeeNo: employee?.employeeNo,
              baseSalary: employee?.baseSalary || 0,
              limit: employee ? advanceLimit(db, employee, a.month) : undefined,
            };
          }),
      );
    }),
  );

  router.post(
    "/payroll/advances/:id/decide",
    permit,
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = auth.session!.companyId!;
      const input = z
        .object({
          approve: z.boolean(),
          amount: z.coerce.number().int().min(1).max(1_000_000_000).optional(),
          note: z.string().trim().max(200).optional(),
        })
        .parse(req.body);
      const result = await updateDb((db) => {
        const row = db.advanceRequests.find((a) => a.id === req.params.id && a.companyId === tenant);
        if (!row) throw httpError("So‘rov topilmadi.", 404);
        if (row.status !== "PENDING") throw httpError("So‘rov allaqachon ko‘rib chiqilgan.", 409);
        const employee = db.employees.find((e) => e.id === row.employeeId);
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        const now = new Date().toISOString();
        if (input.approve) {
          if (closedPeriod(db, tenant, row.month)) throw httpError(`${monthLabel(row.month)} yopilgan — avval oyni qayta oching.`, 409);
          // Tasdiqlovchi summani kamaytirishi mumkin, oshirib bo‘lmaydi.
          const amount = Math.min(row.amount, input.amount || row.amount);
          const adjustment = {
            id: randomUUID(),
            companyId: tenant,
            employeeId: employee.id,
            month: row.month,
            type: "ADVANCE" as const,
            amount,
            note: `Mini App so‘rovi${row.reason ? `: ${row.reason}` : ""}`,
            createdBy: auth.session!.name,
            createdAt: now,
          };
          db.payrollAdjustments.push(adjustment);
          row.adjustmentId = adjustment.id;
          row.amount = amount;
        }
        row.status = input.approve ? "APPROVED" : "REJECTED";
        row.decidedBy = auth.session!.name;
        row.decidedNote = input.note || undefined;
        row.updatedAt = now;
        db.auditLogs.unshift(
          audit(tenant, auth.session!.name, `Avans so‘rovi ${input.approve ? "tasdiqlandi" : "rad etildi"}: ${nameOf(employee)}, ${som(row.amount)}`, "employee", employee.id),
        );
        return { row: { ...row }, employee };
      });
      const db = await readDb();
      const { row, employee } = result;
      const text = input.approve
        ? `✅ <b>Avans tasdiqlandi</b>\n${som(row.amount)} — ${monthLabel(row.month)} ish haqidan ushlanadi.${row.decidedNote ? `\nIzoh: ${row.decidedNote}` : ""}`
        : `❌ Avans so‘rovingiz (${som(row.amount)}) rad etildi.${row.decidedNote ? `\nSabab: ${row.decidedNote}` : ""}`;
      await updateDb(
        (next) =>
          void next.notifications.unshift({
            id: randomUUID(),
            companyId: tenant,
            employeeId: employee.id,
            title: input.approve ? "Avans tasdiqlandi" : "Avans rad etildi",
            body: text.replace(/<[^>]+>/g, ""),
            type: "PAYROLL",
            read: false,
            createdAt: new Date().toISOString(),
          }),
      );
      const fresh = db.employees.find((e) => e.id === employee.id);
      if (fresh) await notifyEmployee(db, fresh, "payroll", text, { title: "Avans", openButton: true }).catch(() => undefined);
      res.json(row);
    }),
  );
  return router;
}
