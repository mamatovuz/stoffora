import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { canAny } from "../lib/permissions";
import { tashkentIsoDate } from "../lib/format";
import { PAY_TYPE_LABEL, effectiveRate } from "../lib/pay-types";
import type { Database, PayType } from "../lib/types";
import type { AuthedRequest } from "./auth";
import { closedPeriod, monthLabel } from "./payroll-routes";
import { STAGE_LABELS, assertMonthOpen, workflowOf } from "./payroll-workflow";
import { payrollRows } from "./reports";

/*
 * Ish haqi moduli: xodim stavkalari (tur + tarix), ishbay natijalar, to‘lovlar (qisman/to‘liq) va
 * oy bo‘yicha umumiy ko‘rinish. Hisoblashning o‘zi — server/reports.ts employeePayrollRow.
 *   • Stavka kuchga kirish sanasi bilan saqlanadi; yopilgan oyga ta’sir qilmaydi.
 *   • Ishbay yozuv rahbar tasdiqlagachgina hisobga kiradi; yopilgan oyda o‘zgarmaydi.
 *   • To‘lov faqat yopilgan (muzlatilgan) oy uchun, qoldiqdan oshmaydi; idempotency kaliti bilan.
 * Har bir yozuv auditga tushadi. Ruxsatlar serverda tekshiriladi.
 */

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req as AuthedRequest, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const permit =
  (...permissions: string[]) =>
  (req: Request, res: Response, next: NextFunction) =>
    canAny((req as AuthedRequest).session!.role, permissions) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
const tenantOf = (req: AuthedRequest) => {
  if (!req.session?.companyId) throw httpError("Kompaniya tanlanmagan.", 403);
  return req.session.companyId;
};
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana YYYY-MM-DD ko‘rinishida bo‘lsin.");
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "Oy YYYY-MM ko‘rinishida bo‘lsin.");
const money = z.coerce.number().int("Butun so‘m kiriting.").min(0).max(100_000_000_000);
const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
const nameOf = (e?: { firstName: string; lastName: string }) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
export const PAY_METHOD_LABEL = { CASH: "Naqd", CARD: "Karta", BANK: "Bank o‘tkazmasi" } as const;

/** Oy bo‘yicha xodimga to‘langan summa (qayd etilgan to‘lovlar yig‘indisi). */
export function paidFor(db: Pick<Database, "payrollPayments">, tenant: string, month: string, employeeId: string) {
  return db.payrollPayments.filter((p) => p.companyId === tenant && p.month === month && p.employeeId === employeeId).reduce((s, p) => s + p.amount, 0);
}

/** Oy qatorlari: yopilgan bo‘lsa — muzlatilgan, aks holda jonli hisob (bir xil shakl). */
function monthLines(db: Database, tenant: string, month: string) {
  const closed = closedPeriod(db, tenant, month);
  if (closed)
    return closed.lines.map((l) => ({
      employeeId: l.employeeId,
      name: l.name,
      payType: (l.payType || "MONTHLY") as PayType,
      rate: l.rate ?? l.base,
      gross: l.gross ?? l.net + l.advance,
      net: l.net,
      advance: l.advance,
      bonus: l.bonus,
      deductions: l.lateDeduction + l.absenceDeduction + l.fine,
      openDays: 0,
    }));
  return payrollRows(db, tenant, month).map((r) => ({
    employeeId: r.employee.id,
    name: nameOf(r.employee),
    payType: r.payType,
    rate: r.rate,
    gross: r.gross,
    net: r.net,
    advance: r.advance,
    bonus: r.bonus,
    deductions: r.deduction + r.absenceDeduction + r.fine,
    openDays: r.openDays.length,
  }));
}

export function payrollOverview(db: Database, tenant: string, month: string) {
  const lines = monthLines(db, tenant, month);
  const employees = new Map(db.employees.filter((e) => e.companyId === tenant).map((e) => [e.id, e]));
  const branches = new Map(db.branches.filter((b) => b.companyId === tenant).map((b) => [b.id, b.name]));
  const closed = Boolean(closedPeriod(db, tenant, month));
  let paid = 0;
  let partial = 0;
  let partialPeople = 0;
  let paidPeople = 0;
  const byType = new Map<PayType, { employees: number; net: number }>();
  const byBranch = new Map<string, { employees: number; net: number }>();
  for (const line of lines) {
    const got = Math.min(line.net, paidFor(db, tenant, month, line.employeeId));
    paid += got;
    if (got > 0 && got < line.net) {
      partial += got;
      partialPeople += 1;
    }
    if (line.net > 0 && got >= line.net) paidPeople += 1;
    const t = byType.get(line.payType) || { employees: 0, net: 0 };
    t.employees += 1;
    t.net += line.net;
    byType.set(line.payType, t);
    const branch = branches.get(employees.get(line.employeeId)?.branchId || "") || "Filialsiz";
    const b = byBranch.get(branch) || { employees: 0, net: 0 };
    b.employees += 1;
    b.net += line.net;
    byBranch.set(branch, b);
  }
  const net = lines.reduce((s, l) => s + l.net, 0);
  const workflow = workflowOf(db, tenant, month);
  return {
    month,
    label: monthLabel(month),
    closed,
    stage: workflow.stage,
    stageLabel: STAGE_LABELS[workflow.stage],
    totals: {
      employees: lines.length,
      gross: lines.reduce((s, l) => s + l.gross, 0),
      net,
      paid,
      partial,
      remaining: Math.max(0, net - paid),
      advances: lines.reduce((s, l) => s + l.advance, 0),
      bonuses: lines.reduce((s, l) => s + l.bonus, 0),
      deductions: lines.reduce((s, l) => s + l.deductions, 0),
      paidPeople,
      partialPeople,
      unpaidPeople: lines.filter((l) => l.net > 0).length - paidPeople - partialPeople,
      openDays: lines.reduce((s, l) => s + l.openDays, 0),
      pendingPiece: db.pieceWorkEntries.filter((p) => p.companyId === tenant && p.status === "PENDING" && p.date.startsWith(month)).length,
    },
    byPayType: (["MONTHLY", "DAILY", "HOURLY", "PIECE"] as PayType[]).map((payType) => ({ payType, label: PAY_TYPE_LABEL[payType], ...(byType.get(payType) || { employees: 0, net: 0 }) })),
    byBranch: [...byBranch.entries()].map(([branch, v]) => ({ branch, ...v })).sort((a, b) => b.net - a.net),
    recentPayments: db.payrollPayments
      .filter((p) => p.companyId === tenant)
      .slice(-8)
      .reverse()
      .map((p) => ({ ...p, name: nameOf(employees.get(p.employeeId)) })),
  };
}

export function createPayRouter() {
  const router = Router();

  router.get(
    "/payroll/overview",
    permit("payroll.view", "payroll.edit"),
    route(async (req, res) => {
      const month = monthSchema.parse(String(req.query.month || tashkentIsoDate().slice(0, 7)));
      res.json(payrollOverview(await readDb(), tenantOf(req), month));
    }),
  );

  /* --------------------------------------------------------- stavkalar --- */
  router.get(
    "/payroll/rates",
    permit("payroll.view", "payroll.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const db = await readDb();
      const today = tashkentIsoDate();
      const rates = db.payRates.filter((r) => r.companyId === tenant);
      const branches = new Map(db.branches.filter((b) => b.companyId === tenant).map((b) => [b.id, b.name]));
      const positions = new Map(db.positions.filter((p) => p.companyId === tenant).map((p) => [p.id, p.name]));
      res.json(
        db.employees
          .filter((e) => e.companyId === tenant && e.status === "ACTIVE")
          .map((e) => {
            const own = rates.filter((r) => r.employeeId === e.id).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt));
            return {
              employeeId: e.id,
              name: nameOf(e),
              employeeNo: e.employeeNo,
              photoDataUrl: e.photoDataUrl,
              branch: branches.get(e.branchId),
              position: positions.get(e.positionId),
              current: effectiveRate(own, e, today),
              upcoming: own.find((r) => r.effectiveFrom > today) || null,
              history: own,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name, "uz")),
      );
    }),
  );
  router.post(
    "/payroll/rates",
    permit("payroll.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const input = z
        .object({
          employeeId: z.string().min(1),
          payType: z.enum(["MONTHLY", "DAILY", "HOURLY", "PIECE"]),
          rate: money,
          effectiveFrom: dateSchema,
          note: z.string().trim().max(300).optional(),
        })
        .parse(req.body);
      if (input.payType !== "PIECE" && input.rate <= 0) throw httpError("Stavka 0 dan katta bo‘lsin.", 422);
      const row = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === input.employeeId && e.companyId === tenant);
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        // Yopilgan oyga orqaga qarab stavka kiritilmaydi — eski hisob-kitoblar o‘zgarmasin.
        if (closedPeriod(db, tenant, input.effectiveFrom.slice(0, 7))) throw httpError(`${monthLabel(input.effectiveFrom.slice(0, 7))} ish haqi yopilgan — stavka keyingi oydan kuchga kirsin.`, 409);
        const before = effectiveRate(db.payRates.filter((r) => r.companyId === tenant && r.employeeId === employee.id), employee, input.effectiveFrom);
        const value = { id: randomUUID(), companyId: tenant, ...input, rate: Math.round(input.rate), currency: "UZS" as const, createdAt: new Date().toISOString(), createdBy: req.session!.name };
        db.payRates.push(value);
        // Oylik stavka bugundan amal qilsa — xodim kartasidagi oylik ham yangilanadi (avans limiti va eski hisobotlar uchun).
        if (input.payType === "MONTHLY" && input.effectiveFrom <= tashkentIsoDate()) {
          employee.baseSalary = value.rate;
          employee.updatedAt = value.createdAt;
        }
        db.auditLogs.unshift(
          audit(tenant, req.session!.name, `Stavka: ${nameOf(employee)} — ${PAY_TYPE_LABEL[input.payType]} ${som(value.rate)} (${input.effectiveFrom} dan)`, "employee", employee.id, before, { payType: value.payType, rate: value.rate, effectiveFrom: value.effectiveFrom }),
        );
        return value;
      });
      res.status(201).json(row);
    }),
  );

  /* ------------------------------------------------------------ ishbay --- */
  router.get(
    "/payroll/piece",
    permit("payroll.view", "payroll.edit", "employees.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const month = monthSchema.parse(String(req.query.month || tashkentIsoDate().slice(0, 7)));
      const db = await readDb();
      const employees = new Map(db.employees.filter((e) => e.companyId === tenant).map((e) => [e.id, e]));
      res.json(
        db.pieceWorkEntries
          .filter((p) => p.companyId === tenant && p.date.startsWith(month))
          .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
          .map((p) => ({ ...p, name: nameOf(employees.get(p.employeeId)), employeeNo: employees.get(p.employeeId)?.employeeNo })),
      );
    }),
  );
  router.post(
    "/payroll/piece",
    permit("payroll.edit", "employees.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const input = z
        .object({
          employeeId: z.string().min(1),
          date: dateSchema,
          workType: z.string().trim().min(2, "Ish turini yozing.").max(120),
          unit: z.string().trim().min(1).max(30).default("dona"),
          quantity: z.coerce.number().positive("Miqdor 0 dan katta bo‘lsin.").max(10_000_000),
          unitPrice: money,
          note: z.string().trim().max(300).optional(),
        })
        .parse(req.body);
      if (input.date > tashkentIsoDate()) throw httpError("Kelajak sanasi uchun ishbay natija kiritilmaydi.", 422);
      const quantity = Math.round(input.quantity * 100) / 100;
      const amount = Math.round(quantity * input.unitPrice);
      if (!Number.isSafeInteger(amount) || amount > 100_000_000_000) throw httpError("Summa juda katta — miqdor yoki narxni tekshiring.", 422);
      const row = await updateDb((db) => {
        assertMonthOpen(db, tenant, input.date);
        const employee = db.employees.find((e) => e.id === input.employeeId && e.companyId === tenant);
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        const value = { id: randomUUID(), companyId: tenant, ...input, quantity, amount, status: "PENDING" as const, createdAt: new Date().toISOString(), createdBy: req.session!.name };
        db.pieceWorkEntries.push(value);
        db.auditLogs.unshift(audit(tenant, req.session!.name, `Ishbay: ${nameOf(employee)} — ${input.workType} ${quantity} ${input.unit} × ${som(input.unitPrice)}`, "employee", employee.id, undefined, value));
        return value;
      });
      res.status(201).json(row);
    }),
  );
  router.post(
    "/payroll/piece/:id/decide",
    permit("payroll.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
      const row = await updateDb((db) => {
        const item = db.pieceWorkEntries.find((p) => p.id === req.params.id && p.companyId === tenant);
        if (!item) throw httpError("Yozuv topilmadi.", 404);
        assertMonthOpen(db, tenant, item.date);
        if (item.status !== "PENDING") throw httpError("Bu yozuv allaqachon ko‘rib chiqilgan.", 409);
        item.status = approve ? "APPROVED" : "REJECTED";
        item.decidedAt = new Date().toISOString();
        item.decidedBy = req.session!.name;
        db.auditLogs.unshift(audit(tenant, req.session!.name, `Ishbay ${approve ? "tasdiqlandi" : "rad etildi"}: ${item.workType} ${som(item.amount)}`, "employee", item.employeeId));
        return item;
      });
      res.json(row);
    }),
  );

  /* ---------------------------------------------------------- to‘lovlar --- */
  router.get(
    "/payroll/payments",
    permit("payroll.view", "payroll.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const month = req.query.month ? monthSchema.parse(String(req.query.month)) : undefined;
      const db = await readDb();
      const employees = new Map(db.employees.filter((e) => e.companyId === tenant).map((e) => [e.id, e]));
      res.json(
        db.payrollPayments
          .filter((p) => p.companyId === tenant && (!month || p.month === month))
          .slice()
          .reverse()
          .map((p) => ({ ...p, name: nameOf(employees.get(p.employeeId)), employeeNo: employees.get(p.employeeId)?.employeeNo })),
      );
    }),
  );
  router.post(
    "/payroll/payments",
    permit("payroll.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const input = z
        .object({
          employeeId: z.string().min(1),
          month: monthSchema,
          amount: money.refine((v) => v > 0, "Summa 0 dan katta bo‘lsin."),
          method: z.enum(["CASH", "CARD", "BANK"]),
          paidAt: dateSchema,
          note: z.string().trim().max(300).optional(),
          idempotencyKey: z.string().trim().min(8).max(120),
        })
        .parse(req.body);
      if (input.paidAt > tashkentIsoDate()) throw httpError("To‘lov sanasi kelajakda bo‘lmasin.", 422);
      const result = await updateDb((db) => {
        const duplicate = db.payrollPayments.find((p) => p.companyId === tenant && p.idempotencyKey === input.idempotencyKey);
        if (duplicate) {
          // Kalit boshqa to‘lov uchun ishlatilgan bo‘lsa — jim qaytarmaymiz.
          if (duplicate.employeeId !== input.employeeId || duplicate.month !== input.month || duplicate.amount !== Math.round(input.amount)) throw httpError("Bu so‘rov kaliti boshqa to‘lov uchun ishlatilgan.", 409);
          return { row: duplicate, created: false };
        }
        const period = closedPeriod(db, tenant, input.month);
        if (!period) throw httpError("To‘lov faqat tasdiqlangan (yopilgan) oy uchun qayd etiladi. Avval oyni yoping.", 409);
        const line = period.lines.find((l) => l.employeeId === input.employeeId);
        if (!line) throw httpError("Bu xodim shu oy qaydnomasida yo‘q.", 404);
        const remaining = line.net - paidFor(db, tenant, input.month, input.employeeId);
        if (remaining <= 0) throw httpError("Bu xodimga shu oy uchun to‘liq to‘langan.", 409);
        if (input.amount > remaining) throw httpError(`Summa qoldiqdan oshib ketdi. Qoldiq: ${som(remaining)}.`, 422);
        const row = { id: randomUUID(), companyId: tenant, ...input, amount: Math.round(input.amount), createdAt: new Date().toISOString(), createdBy: req.session!.name };
        db.payrollPayments.push(row);
        db.auditLogs.unshift(
          audit(tenant, req.session!.name, `Ish haqi to‘landi (${monthLabel(input.month)}): ${line.name} — ${som(row.amount)}, ${PAY_METHOD_LABEL[row.method]}${row.amount < remaining ? " (qisman)" : ""}`, "payroll", period.id, undefined, row),
        );
        return { row, created: true };
      });
      res.status(result.created ? 201 : 200).json(result.row);
    }),
  );

  return router;
}
