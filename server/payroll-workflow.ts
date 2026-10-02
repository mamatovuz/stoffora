import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, dataIndexes, readDb, updateDb } from "../lib/store";
import { can, canAny } from "../lib/permissions";
import { tashkentIsoDate } from "../lib/format";
import { dayPlan } from "../lib/schedule";
import type { Database, PayrollPeriod, PayrollWorkflow, PayslipLine } from "../lib/types";
import type { AuthedRequest } from "./auth";
import { decryptSecret } from "./integrations/secrets";
import { closedPeriod, monthLabel, sendPeriodPayslips } from "./payroll-routes";
import { payrollRows } from "./reports";

/*
 * Payroll Workspace — oyni yopish jarayoni:
 *   Hisoblanmoqda → HR tekshirdi (timesheet) → Moliya tekshirdi → Direktor tasdiqladi (oy muzlatiladi,
 *   hisob varaqalari) → To‘landi 🔒.
 * Har bosqich kim/qachon — tarixda va auditda. Qayta ochish — faqat direktor, sabab bilan.
 * Yopilgan oyning davomati to‘g‘ridan-to‘g‘ri o‘zgarmaydi (assertMonthOpen) — avval qayta ochiladi.
 * Shuningdek: timesheet, oldingi oy bilan farq («nima sababdan o‘zgardi»), bank to‘lov fayli.
 */

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req as AuthedRequest, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "Oy YYYY-MM ko‘rinishida bo‘lsin.");
const som = (v: number) => `${Math.round(v).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;

export const STAGES = ["CALCULATING", "HR_CHECKED", "FINANCE_CHECKED", "APPROVED", "PAID"] as const;
export const STAGE_LABELS: Record<PayrollWorkflow["stage"], string> = {
  CALCULATING: "Hisoblanmoqda",
  HR_CHECKED: "HR tekshirdi",
  FINANCE_CHECKED: "Moliya tekshirdi",
  APPROVED: "Direktor tasdiqladi — to‘lovga tayyor",
  PAID: "To‘landi",
};

/** Davomatni o‘zgartirishdan oldin: oy yopilgan bo‘lsa — rad (oylik yashirincha o‘zgarmasin). */
export function assertMonthOpen(db: Pick<Database, "payrollPeriods">, companyId: string, date: string) {
  const month = date.slice(0, 7);
  if (closedPeriod(db, companyId, month))
    throw httpError(`${monthLabel(month)} ish haqi yopilgan — davomatni o‘zgartirish uchun direktor oyni qayta ochishi kerak (Ish haqi → Jarayon).`, 409);
}

export function workflowOf(db: Database, companyId: string, month: string): PayrollWorkflow {
  const found = db.payrollWorkflows.find((w) => w.companyId === companyId && w.month === month);
  if (found) return found;
  // Eski usulda (jarayonsiz) yopilgan oy — «tasdiqlangan».
  return { id: "", companyId, month, stage: closedPeriod(db, companyId, month) ? "APPROVED" : "CALCULATING", history: [] };
}

/** Oyni muzlatadi (vedomost qatorlari saqlanadi). updateDb ichida. */
export function freezeMonth(db: Database, tenant: string, month: string, actor: string): PayrollPeriod {
  if (closedPeriod(db, tenant, month)) throw httpError(`${monthLabel(month)} allaqachon yopilgan.`, 409);
  const positions = new Map(db.positions.map((p) => [p.id, p.name]));
  const lines: PayslipLine[] = payrollRows(db, tenant, month).map((r) => ({
    employeeId: r.employee.id,
    employeeNo: r.employee.employeeNo,
    name: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
    position: positions.get(r.employee.positionId),
    base: r.base,
    days: r.days,
    expectedDays: r.expectedDays,
    absentDays: r.absentDays,
    lateMinutes: r.lateMinutes,
    overtimeAmount: r.overtimeAmount,
    bonus: r.bonus,
    lateDeduction: r.deduction,
    absenceDeduction: r.absenceDeduction,
    fine: r.fine,
    advance: r.advance,
    net: r.net,
    explanation: r.explanation,
  }));
  const period: PayrollPeriod = { id: randomUUID(), companyId: tenant, month, closedAt: new Date().toISOString(), closedBy: actor, lines, total: lines.reduce((s, l) => s + l.net, 0) };
  db.payrollPeriods.push(period);
  db.auditLogs.unshift(audit(tenant, actor, `${monthLabel(month)} ish haqi yopildi (${lines.length} xodim, ${som(period.total)})`, "payroll", period.id));
  return period;
}

/** Jarayonga bosqich yozadi (yo‘q bo‘lsa yaratadi). */
export function setStage(db: Database, tenant: string, month: string, stage: PayrollWorkflow["stage"], actor: string, note?: string) {
  let row = db.payrollWorkflows.find((w) => w.companyId === tenant && w.month === month);
  if (!row) {
    row = { id: randomUUID(), companyId: tenant, month, stage: "CALCULATING", history: [] };
    db.payrollWorkflows.push(row);
  }
  row.stage = stage;
  row.history.push({ stage, by: actor, at: new Date().toISOString(), note: note || undefined });
  if (stage === "PAID") {
    row.paidAt = new Date().toISOString();
    row.paidBy = actor;
  }
  if (stage === "CALCULATING") {
    row.paidAt = undefined;
    row.paidBy = undefined;
  }
  db.auditLogs.unshift(audit(tenant, actor, `Ish haqi jarayoni (${monthLabel(month)}): ${STAGE_LABELS[stage]}${note ? ` — ${note}` : ""}`, "payroll", row.id));
  return row;
}

/** Timesheet: rejadagi va ishlangan vaqt, kechikish, overtime, ta’til va kelmagan kunlar. */
export function timesheet(db: Database, tenant: string, month: string) {
  const index = dataIndexes(db);
  const today = tashkentIsoDate();
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return db.employees
    .filter((e) => e.companyId === tenant && e.status === "ACTIVE")
    .map((e) => {
      let plannedMinutes = 0;
      let leaveDays = 0;
      let absentDays = 0;
      const leaves = index.approvedLeaveByEmployee.get(e.id) || [];
      for (let d = 1; d <= last; d += 1) {
        const date = `${month}-${String(d).padStart(2, "0")}`;
        if (date < e.startDate) continue;
        const plan = dayPlan(db, e, date);
        if (!plan.enabled) continue;
        if (leaves.some((l) => l.startDate <= date && l.endDate >= date)) {
          leaveDays += 1;
          continue;
        }
        let span = toMin(plan.end) - toMin(plan.start);
        if (span <= 0) span += 24 * 60;
        plannedMinutes += span;
        if (date < today && !index.attendanceByKey.get(`${e.id}|${date}`)?.checkIn) absentDays += 1;
      }
      const rows = (index.attendanceByEmployee.get(e.id) || []).filter((a) => a.date.startsWith(month));
      return {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        employeeNo: e.employeeNo,
        branch: db.branches.find((b) => b.id === e.branchId)?.name || "",
        plannedMinutes,
        workedMinutes: rows.reduce((s, a) => s + (a.workedMinutes || 0), 0),
        lateMinutes: rows.reduce((s, a) => s + (a.lateMinutes || 0), 0),
        overtimeMinutes: rows.reduce((s, a) => s + (a.overtimeMinutes || 0), 0),
        days: rows.filter((a) => a.checkIn).length,
        leaveDays,
        absentDays,
        manualEdits: rows.filter((a) => a.verification.includes("MANUAL")).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

type Line = { employeeId: string; name: string; base: number; net: number; lateDeduction: number; absenceDeduction: number; fine: number; bonus: number; overtimeAmount: number; advance: number; days: number };
function linesFor(db: Database, tenant: string, month: string): Line[] {
  const closed = closedPeriod(db, tenant, month);
  if (closed) return closed.lines.map((l) => ({ ...l }));
  return payrollRows(db, tenant, month).map((r) => ({
    employeeId: r.employee.id,
    name: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
    base: r.base,
    net: r.net,
    lateDeduction: r.deduction,
    absenceDeduction: r.absenceDeduction,
    fine: r.fine,
    bonus: r.bonus,
    overtimeAmount: r.overtimeAmount,
    advance: r.advance,
    days: r.days,
  }));
}

/** Oldingi oy bilan farq va sabablari (har bir xodim bo‘yicha). */
export function compareMonths(db: Database, tenant: string, month: string) {
  const prevDate = new Date(`${month}-15T00:00:00Z`);
  prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
  const prev = prevDate.toISOString().slice(0, 7);
  const now = new Map(linesFor(db, tenant, month).map((l) => [l.employeeId, l]));
  const before = new Map(linesFor(db, tenant, prev).map((l) => [l.employeeId, l]));
  const ids = new Set([...now.keys(), ...before.keys()]);
  const rows = [...ids].map((id) => {
    const a = before.get(id);
    const b = now.get(id);
    const diff = (key: keyof Line) => Number(b?.[key] || 0) - Number(a?.[key] || 0);
    const reasons: { text: string; amount: number }[] = [];
    const add = (text: string, amount: number) => amount && reasons.push({ text, amount });
    add("Oklad o‘zgardi", diff("base"));
    add("Kechikish ushlanmasi", -diff("lateDeduction"));
    add("Kelmagan kunlar ushlanmasi", -diff("absenceDeduction"));
    add("Jarima", -diff("fine"));
    add("Bonus / mukofot", diff("bonus"));
    add("Qo‘shimcha ish", diff("overtimeAmount"));
    add("Avans", -diff("advance"));
    if (!a) reasons.push({ text: "Yangi xodim (o‘tgan oyda yo‘q edi)", amount: b?.net || 0 });
    if (!b) reasons.push({ text: "Bu oy hisobda yo‘q (ishdan ketgan)", amount: -(a?.net || 0) });
    return { employeeId: id, name: b?.name || a?.name || "—", prevNet: a?.net || 0, net: b?.net || 0, change: (b?.net || 0) - (a?.net || 0), reasons: reasons.sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount)) };
  });
  return {
    month,
    prev,
    total: rows.reduce((s, r) => s + r.net, 0),
    prevTotal: rows.reduce((s, r) => s + r.prevNet, 0),
    rows: rows.sort((x, y) => Math.abs(y.change) - Math.abs(x.change)),
  };
}

export function createPayrollWorkflowRouter() {
  const router = Router();
  const canSee = (req: Request, res: Response, next: NextFunction) =>
    canAny((req as AuthedRequest).session!.role, ["payroll.view", "payroll.edit", "employees.edit"]) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });

  router.get(
    "/payroll/:month/workflow",
    canSee,
    route(async (req, res) => {
      const month = monthSchema.parse(req.params.month);
      const db = await readDb();
      const wf = workflowOf(db, req.session!.companyId!, month);
      const role = req.session!.role;
      const hasHr = db.users.some((u) => u.companyId === req.session!.companyId && ["HR_ADMIN", "HR_MANAGER"].includes(u.role));
      res.json({
        ...wf,
        label: STAGE_LABELS[wf.stage],
        stages: STAGES.map((s) => ({ key: s, label: STAGE_LABELS[s] })),
        // Joriy foydalanuvchi qila oladigan amallar.
        can: {
          hrCheck: wf.stage === "CALCULATING" && canAny(role, ["employees.edit"]),
          financeCheck: (wf.stage === "HR_CHECKED" || (wf.stage === "CALCULATING" && !hasHr)) && can(role, "payroll.edit"),
          approve: wf.stage === "FINANCE_CHECKED" && role === "COMPANY_OWNER",
          markPaid: wf.stage === "APPROVED" && can(role, "payroll.edit"),
          reopen: wf.stage !== "CALCULATING" && role === "COMPANY_OWNER",
          back: (wf.stage === "HR_CHECKED" || wf.stage === "FINANCE_CHECKED") && canAny(role, ["payroll.edit", "employees.edit"]),
        },
      });
    }),
  );

  router.post(
    "/payroll/:month/workflow",
    canSee,
    route(async (req, res) => {
      const month = monthSchema.parse(req.params.month);
      const tenant = req.session!.companyId!;
      const role = req.session!.role;
      const actor = req.session!.name;
      const { action, note } = z
        .object({ action: z.enum(["hr_check", "finance_check", "approve", "mark_paid", "reopen", "back"]), note: z.string().trim().max(300).optional() })
        .parse(req.body);
      let periodId: string | undefined;
      const wf = await updateDb((db) => {
        const current = workflowOf(db, tenant, month);
        const hasHr = db.users.some((u) => u.companyId === tenant && ["HR_ADMIN", "HR_MANAGER"].includes(u.role));
        switch (action) {
          case "hr_check":
            if (!canAny(role, ["employees.edit"])) throw httpError("Timesheet’ni HR tasdiqlaydi.", 403);
            if (current.stage !== "CALCULATING") throw httpError("Bu bosqich o‘tilgan.", 409);
            if (db.attendanceCorrections.some((c) => c.companyId === tenant && c.status === "PENDING" && c.date.startsWith(month)))
              throw httpError("Bu oy uchun ko‘rib chiqilmagan belgilash so‘rovlari bor — avval ularni hal qiling.", 409);
            return setStage(db, tenant, month, "HR_CHECKED", actor, note || "Timesheet tekshirildi");
          case "finance_check":
            if (!can(role, "payroll.edit")) throw httpError("Bu bosqich — moliya.", 403);
            if (!(current.stage === "HR_CHECKED" || (current.stage === "CALCULATING" && !hasHr))) throw httpError("Avval HR timesheet’ni tasdiqlashi kerak.", 409);
            if (db.advanceRequests.some((a) => a.companyId === tenant && a.month === month && (a.status === "PENDING" || a.status === "HR_APPROVED")))
              throw httpError("Bu oy uchun ko‘rib chiqilmagan avans so‘rovlari bor.", 409);
            return setStage(db, tenant, month, "FINANCE_CHECKED", actor, note);
          case "approve": {
            if (role !== "COMPANY_OWNER") throw httpError("Yakuniy tasdiq — direktor.", 403);
            if (current.stage !== "FINANCE_CHECKED") throw httpError("Avval moliya tekshirishi kerak.", 409);
            periodId = freezeMonth(db, tenant, month, actor).id;
            return setStage(db, tenant, month, "APPROVED", actor, note);
          }
          case "mark_paid":
            if (!can(role, "payroll.edit")) throw httpError("To‘lovni moliya belgilaydi.", 403);
            if (current.stage !== "APPROVED") throw httpError("Avval direktor tasdiqlashi kerak.", 409);
            return setStage(db, tenant, month, "PAID", actor, note);
          case "back":
            if (!canAny(role, ["payroll.edit", "employees.edit"])) throw httpError("Ruxsat yo‘q.", 403);
            if (current.stage !== "HR_CHECKED" && current.stage !== "FINANCE_CHECKED") throw httpError("Bu bosqichdan orqaga qaytarib bo‘lmaydi.", 409);
            return setStage(db, tenant, month, "CALCULATING", actor, note || "Qayta tekshirishga qaytarildi");
          case "reopen": {
            if (role !== "COMPANY_OWNER") throw httpError("Oyni qayta ochish — faqat direktor.", 403);
            if (!note || note.length < 3) throw httpError("Qayta ochish sababini yozing.", 422);
            const period = closedPeriod(db, tenant, month);
            if (period) db.payrollPeriods = db.payrollPeriods.filter((p) => p.id !== period.id);
            return setStage(db, tenant, month, "CALCULATING", actor, `Qayta ochildi: ${note}`);
          }
        }
      });
      if (periodId) void sendPeriodPayslips(tenant, periodId).catch(() => 0);
      res.json({ ...wf, label: STAGE_LABELS[wf.stage] });
    }),
  );

  router.get(
    "/payroll/:month/timesheet",
    canSee,
    route(async (req, res) => {
      const month = monthSchema.parse(req.params.month);
      const db = await readDb();
      res.json({ month, rows: timesheet(db, req.session!.companyId!, month) });
    }),
  );

  router.get(
    "/payroll/:month/compare",
    (req, res, next) => (canAny((req as AuthedRequest).session!.role, ["payroll.view", "payroll.edit"]) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." })),
    route(async (req, res) => {
      const month = monthSchema.parse(req.params.month);
      const db = await readDb();
      res.json(compareMonths(db, req.session!.companyId!, month));
    }),
  );

  /** Bank to‘lov fayli (CSV): F.I.Sh, karta, summa — faqat tasdiqlangan oy; har yuklash auditda. */
  router.get(
    "/payroll/:month/bank.csv",
    (req, res, next) => (can((req as AuthedRequest).session!.role, "payroll.edit") ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." })),
    route(async (req, res) => {
      const month = monthSchema.parse(req.params.month);
      const tenant = req.session!.companyId!;
      const db = await readDb();
      const period = closedPeriod(db, tenant, month);
      if (!period) throw httpError("Avval oy direktor tomonidan tasdiqlanishi (yopilishi) kerak.", 409);
      const quote = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
      const lines = ["F.I.Sh;Xodim ID;Karta raqami;Karta egasi;Summa"];
      let noCard = 0;
      for (const l of period.lines) {
        if (l.net <= 0) continue;
        const card = db.payoutCards.find((c) => c.employeeId === l.employeeId && c.companyId === tenant);
        let number = "";
        if (card)
          try {
            number = decryptSecret(card.cardEnc);
          } catch {
            number = "";
          }
        if (!number) noCard += 1;
        lines.push([quote(l.name), quote(l.employeeNo), quote(number || "KARTA YO‘Q — naqd"), quote(card?.holder || ""), Math.round(l.net)].join(";"));
      }
      await updateDb((next) => void next.auditLogs.unshift(audit(tenant, req.session!.name, `Bank to‘lov fayli yuklab olindi (${monthLabel(month)}, kartasizlar: ${noCard})`, "payroll", period.id)));
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="bank-${month}.csv"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(`﻿${lines.join("\r\n")}`);
    }),
  );
  return router;
}
