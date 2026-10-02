import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { canAny } from "../lib/permissions";
import type { Database, PayrollPeriod, PayslipLine } from "../lib/types";
import type { AuthedRequest } from "./auth";
import { notifyEmployee } from "./integrations/hooks";
import { payrollRows } from "./reports";
import { freezeMonth, setStage } from "./payroll-workflow";

/*
 * Ish haqi: avans / bonus / jarima, oyni yopish (raqamlar muzlatiladi),
 * xodimlarga hisob varaqasi (bot va Staffora), qo‘shimcha ishni tasdiqlash.
 */

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(handler(req as AuthedRequest, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const permit = (...permissions: string[]) => (req: Request, res: Response, next: NextFunction) =>
  canAny((req as AuthedRequest).session!.role, permissions) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
const tenantOf = (req: AuthedRequest) => {
  if (!req.session?.companyId) throw httpError("Kompaniya tanlanmagan.", 403);
  return req.session.companyId;
};
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "Oy YYYY-MM ko‘rinishida bo‘lsin.");
const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
const monthNames = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
export const monthLabel = (month: string) => `${monthNames[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

export function closedPeriod(db: Pick<Database, "payrollPeriods">, companyId: string, month: string) {
  return db.payrollPeriods.find((p) => p.companyId === companyId && p.month === month);
}
function assertOpen(db: Database, companyId: string, month: string) {
  if (closedPeriod(db, companyId, month)) throw httpError(`${monthLabel(month)} yopilgan — o‘zgartirish uchun avval oyni qayta oching.`, 409);
}

/** Xodimga boradigan hisob varaqasi matni. */
export function payslipText(line: PayslipLine, month: string, company: string) {
  const rows = [
    `💰 <b>${monthLabel(month)} — hisob varaqasi</b>`,
    `🏢 ${company}`,
    "",
    `Oylik: ${som(line.base)}`,
    line.overtimeAmount ? `➕ Qo‘shimcha ish: ${som(line.overtimeAmount)}` : "",
    line.bonus ? `➕ Bonus: ${som(line.bonus)}` : "",
    line.lateDeduction ? `➖ Kechikish (${line.lateMinutes} daq): ${som(line.lateDeduction)}` : "",
    line.absenceDeduction ? `➖ Kelmagan ${line.absentDays} kun: ${som(line.absenceDeduction)}` : "",
    line.fine ? `➖ Jarima: ${som(line.fine)}` : "",
    line.advance ? `➖ Avans (berilgan): ${som(line.advance)}` : "",
    "",
    `📅 Ish kunlari: ${line.days} / ${line.expectedDays}`,
    `✅ <b>Qo‘lga: ${som(line.net)}</b>`,
  ];
  return rows.filter((row, i, all) => row !== "" || (all[i - 1] !== "" && i > 0)).join("\n");
}

export function createPayrollRouter() {
  const router = Router();

  /* --------------------------------------------- avans / bonus / jarima --- */
  router.post(
    "/payroll/adjustments",
    permit("payroll.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const input = z
        .object({
          employeeId: z.string().min(1),
          month: monthSchema,
          type: z.enum(["ADVANCE", "BONUS", "FINE"]),
          amount: z.coerce.number().int("Butun son kiriting.").min(1, "Summa 0 dan katta bo‘lsin.").max(1_000_000_000),
          note: z.string().trim().max(200).optional(),
        })
        .parse(req.body);
      const row = await updateDb((db) => {
        assertOpen(db, tenant, input.month);
        const employee = db.employees.find((e) => e.id === input.employeeId && e.companyId === tenant);
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        const value = { id: randomUUID(), companyId: tenant, ...input, createdBy: req.session!.name, createdAt: new Date().toISOString() };
        db.payrollAdjustments.push(value);
        const label = { ADVANCE: "Avans", BONUS: "Bonus", FINE: "Jarima" }[input.type];
        db.auditLogs.unshift(audit(tenant, req.session!.name, `${label}: ${som(input.amount)} (${input.month})`, "employee", employee.id, undefined, value));
        return value;
      });
      res.status(201).json(row);
    }),
  );

  router.delete(
    "/payroll/adjustments/:id",
    permit("payroll.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      await updateDb((db) => {
        const row = db.payrollAdjustments.find((a) => a.id === req.params.id && a.companyId === tenant);
        if (!row) throw httpError("Yozuv topilmadi.", 404);
        assertOpen(db, tenant, row.month);
        db.payrollAdjustments = db.payrollAdjustments.filter((a) => a.id !== row.id);
        db.auditLogs.unshift(audit(tenant, req.session!.name, "Avans/bonus/jarima o‘chirildi", "employee", row.employeeId, row));
      });
      res.json({ ok: true });
    }),
  );

  /* ------------------------------------------------------ oyni yopish --- */
  router.post(
    "/payroll/:month/close",
    permit("payroll.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const month = monthSchema.parse(req.params.month);
      const { sendPayslips } = z.object({ sendPayslips: z.boolean().default(true) }).parse(req.body || {});
      const period = await updateDb((db) => {
        assertOpen(db, tenant, month);
        const value = freezeMonth(db, tenant, month, req.session!.name);
        setStage(db, tenant, month, "APPROVED", req.session!.name, "To‘g‘ridan-to‘g‘ri yopildi");
        return value;
      });
      let sent = 0;
      if (sendPayslips) sent = await sendPeriodPayslips(tenant, period.id);
      res.json({ ...period, sent });
    }),
  );

  router.post(
    "/payroll/:month/reopen",
    permit("payroll.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const month = monthSchema.parse(req.params.month);
      if (req.session!.role !== "COMPANY_OWNER" && req.session!.role !== "FINANCE")
        throw httpError("Oyni qayta ochish faqat kompaniya egasi yoki moliya bo‘limiga ruxsat etilgan.", 403);
      await updateDb((db) => {
        const period = closedPeriod(db, tenant, month);
        if (!period) throw httpError("Bu oy yopilmagan.", 404);
        // To‘langan oy — faqat direktor qayta ochadi (Jarayon orqali, sabab bilan).
        if (db.payrollWorkflows.some((w) => w.companyId === tenant && w.month === month && w.stage === "PAID") && req.session!.role !== "COMPANY_OWNER")
          throw httpError("To‘langan oyni faqat direktor qayta ochadi.", 403);
        db.payrollPeriods = db.payrollPeriods.filter((p) => p.id !== period.id);
        setStage(db, tenant, month, "CALCULATING", req.session!.name, "Qayta ochildi");
      });
      res.json({ ok: true });
    }),
  );

  router.post(
    "/payroll/:month/payslips",
    permit("payroll.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const month = monthSchema.parse(req.params.month);
      const db = await readDb();
      const period = closedPeriod(db, tenant, month);
      if (!period) throw httpError("Avval oyni yoping.", 409);
      res.json({ sent: await sendPeriodPayslips(tenant, period.id) });
    }),
  );

  /* -------------------------------------------- qo‘shimcha ish tasdig‘i --- */
  router.get(
    "/overtime",
    permit("attendance.edit", "payroll.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const month = monthSchema.parse(String(req.query.month || new Date().toISOString().slice(0, 7)));
      const db = await readDb();
      // Filial rahbari faqat o‘z filiallaridagi xodimlarni ko‘radi.
      const scope = req.session!.role === "BRANCH_MANAGER" ? new Set(db.users.find((u) => u.id === req.session!.userId)?.branchIds || []) : null;
      const employees = new Map(db.employees.filter((e) => e.companyId === tenant && (!scope || scope.has(e.branchId))).map((e) => [e.id, e]));
      const rows = db.attendance
        .filter((a) => a.companyId === tenant && a.date.startsWith(month) && a.overtimeMinutes > 0 && employees.has(a.employeeId))
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((a) => {
          const e = employees.get(a.employeeId)!;
          return {
            id: a.id,
            date: a.date,
            employeeId: e.id,
            name: `${e.firstName} ${e.lastName}`.trim(),
            employeeNo: e.employeeNo,
            checkIn: a.checkIn,
            checkOut: a.checkOut,
            scheduledEnd: a.scheduledEnd,
            overtimeMinutes: a.overtimeMinutes,
            approved: a.overtimeApproved,
            decidedBy: a.overtimeDecidedBy,
            note: a.overtimeNote,
            branchId: a.branchId,
          };
        });
      res.json({ month, closed: Boolean(closedPeriod(db, tenant, month)), rows });
    }),
  );

  router.post(
    "/attendance/:id/overtime",
    permit("attendance.edit", "payroll.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const { approved } = z.object({ approved: z.boolean() }).parse(req.body);
      const row = await updateDb((db) => {
        const record = db.attendance.find((a) => a.id === req.params.id && a.companyId === tenant);
        if (!record) throw httpError("Davomat yozuvi topilmadi.", 404);
        if (req.session!.role === "BRANCH_MANAGER" && !(db.users.find((u) => u.id === req.session!.userId)?.branchIds || []).includes(record.branchId))
          throw httpError("Davomat yozuvi topilmadi.", 404);
        assertOpen(db, tenant, record.date.slice(0, 7));
        record.overtimeApproved = approved;
        record.overtimeDecidedBy = req.session!.name;
        record.updatedAt = new Date().toISOString();
        db.auditLogs.unshift(
          audit(tenant, req.session!.name, `Qo‘shimcha ish ${approved ? "tasdiqlandi" : "rad etildi"} (${record.overtimeMinutes} daq, ${record.date})`, "attendance", record.id),
        );
        return record;
      });
      res.json(row);
    }),
  );

  /* --------------------------------------- shubhali joylashuvni ko‘rish --- */
  router.post(
    "/attendance/:id/review-flags",
    permit("attendance.edit"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const { verdict } = z.object({ verdict: z.enum(["OK", "SUSPICIOUS"]) }).parse(req.body);
      const row = await updateDb((db) => {
        const record = db.attendance.find((a) => a.id === req.params.id && a.companyId === tenant);
        if (!record) throw httpError("Davomat yozuvi topilmadi.", 404);
        // Filial rahbari faqat o‘z filiali yozuvlarini ko‘rib chiqadi.
        if (req.session!.role === "BRANCH_MANAGER" && !(db.users.find((u) => u.id === req.session!.userId)?.branchIds || []).includes(record.branchId))
          throw httpError("Davomat yozuvi topilmadi.", 404);
        record.flagsReviewedBy = `${req.session!.name} · ${verdict === "OK" ? "joyida edi" : "shubhali"}`;
        record.updatedAt = new Date().toISOString();
        db.auditLogs.unshift(audit(tenant, req.session!.name, `Shubhali joylashuv ko‘rib chiqildi: ${verdict === "OK" ? "hammasi joyida" : "shubhali deb belgilandi"}`, "attendance", record.id));
        return record;
      });
      res.json(row);
    }),
  );

  return router;
}

/** Yopilgan oy bo‘yicha har bir xodimga hisob varaqasini yuboradi (Staffora + bot). */
export async function sendPeriodPayslips(companyId: string, periodId: string) {
  const db = await readDb();
  const period = db.payrollPeriods.find((p) => p.id === periodId && p.companyId === companyId);
  const company = db.companies.find((c) => c.id === companyId);
  if (!period || !company) return 0;
  let sent = 0;
  await updateDb((next) => {
    const now = new Date().toISOString();
    for (const line of period.lines)
      next.notifications.unshift({
        id: randomUUID(),
        companyId,
        employeeId: line.employeeId,
        title: `${monthLabel(period.month)} hisob varaqasi`,
        body: `Qo‘lga: ${som(line.net)}. ${line.explanation}`,
        type: "PAYROLL",
        read: false,
        createdAt: now,
      });
    const row = next.payrollPeriods.find((p) => p.id === periodId);
    if (row) row.payslipsSentAt = now;
  });
  for (const line of period.lines) {
    const employee = db.employees.find((e) => e.id === line.employeeId && e.status === "ACTIVE");
    if (!employee) continue;
    const channels = await notifyEmployee(db, employee, "payroll", payslipText(line, period.month, company.name), { go: `payslip_${period.month}` }).catch(() => []);
    if (channels.length) sent += 1;
  }
  return sent;
}

/** Mini App: xodim faqat o‘zining yopilgan oylardagi hisob varaqalarini ko‘radi. */
export function createMiniPayrollRouter() {
  const router = Router();
  router.get(
    "/mini/payslips",
    route(async (req, res) => {
      const auth = (req as unknown as { employeeSession?: { employeeId: string; companyId: string } }).employeeSession!;
      const db = await readDb();
      res.json(
        db.payrollPeriods
          .filter((p) => p.companyId === auth.companyId)
          .sort((a, b) => b.month.localeCompare(a.month))
          .map((p) => ({ month: p.month, label: monthLabel(p.month), closedAt: p.closedAt, line: p.lines.find((l) => l.employeeId === auth.employeeId) }))
          .filter((p) => p.line)
          .slice(0, 12),
      );
    }),
  );
  return router;
}
