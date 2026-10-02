import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { canAny } from "../lib/permissions";
import { tashkentIsoDate } from "../lib/format";
import type { Database, Employee, PayrollAdjustment, Role } from "../lib/types";
import type { AuthedRequest } from "./auth";
import { addTableSheet, createWorkbook, sendWorkbook } from "./excel";
import { notifyEmployee } from "./integrations/hooks";
import { decryptSecret } from "./integrations/secrets";
import { closedPeriod, monthLabel } from "./payroll-routes";
import { salarySnapshot } from "./advances";
import { sendTelegramMessage } from "./telegram";

/*
 * Moliya bo‘limi:
 *   • Jarimalar — HR, direktor va moliya to‘g‘ridan-to‘g‘ri qo‘llaydi (xodimga darhol xabar, shu oy oylikdan
 *     ushlanadi); filial rahbari faqat taklif qiladi → HR / direktor tasdiqlaydi yoki rad etadi.
 *   • Avans oluvchilar — oy bo‘yicha ro‘yxat (F.I.Sh, filial, karta, asl oylik, avans summasi).
 *   • Excel hisobotlar (jarimalar, avanslar).
 * Sayt, Mini App va mobil ilovadagi rahbar rejimi shu API’larni chaqiradi (huquq va filial chegarasi — shu yerda).
 */

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req as AuthedRequest, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const nameOf = (e?: Pick<Employee, "firstName" | "lastName">) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
export const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "Oy YYYY-MM ko‘rinishida bo‘lsin.");
const currentMonth = () => tashkentIsoDate().slice(0, 7);

/** To‘g‘ridan-to‘g‘ri jarima qo‘llay oladi: direktor (egasi), HR, moliya. */
export const canFineDirect = (role: Role) => canAny(role, ["employees.edit", "payroll.edit"]);
/** Jarima ko‘ra / taklif qila oladi: yuqoridagilar + filial rahbari (faqat o‘z filiali, HR tasdig‘i bilan). */
export const canFineView = (role: Role) => canFineDirect(role) || role === "BRANCH_MANAGER";
/** Avans ro‘yxati: moliya, HR, direktor. */
const canAdvances = (role: Role) => canAny(role, ["payroll.view", "payroll.edit", "leave.approve", "employees.edit"]);

const scopeOf = (req: AuthedRequest, db: Database) =>
  req.session!.role === "BRANCH_MANAGER" ? new Set(db.users.find((u) => u.id === req.session!.userId)?.branchIds || []) : null;

function describeFine(db: Database, row: PayrollAdjustment) {
  const employee = db.employees.find((e) => e.id === row.employeeId);
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: nameOf(employee),
    employeeNo: employee?.employeeNo,
    photoDataUrl: employee?.photoDataUrl,
    branchId: employee?.branchId,
    branchName: db.branches.find((b) => b.id === employee?.branchId)?.name || "—",
    position: db.positions.find((p) => p.id === employee?.positionId)?.name,
    month: row.month,
    amount: row.amount,
    reason: row.note || "",
    status: row.status || "APPROVED",
    createdBy: row.createdBy,
    proposedBy: row.proposedBy,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decidedNote: row.decidedNote,
    createdAt: row.createdAt,
  };
}

/** Xodimga jarima xabari: summa, sabab va shu oy qo‘lga tegadigan taxminiy summa. */
async function announceFine(employeeId: string, fineId: string) {
  const db = await readDb();
  const employee = db.employees.find((e) => e.id === employeeId);
  const fine = db.payrollAdjustments.find((a) => a.id === fineId);
  if (!employee || !fine) return;
  const snap = salarySnapshot(db, employee, fine.month);
  const text = [
    `⚠️ <b>Sizga jarima qo‘llanildi</b>`,
    `Summa: <b>${som(fine.amount)}</b>`,
    fine.note ? `Sabab: ${fine.note}` : "",
    `${monthLabel(fine.month)} oyligingizdan ushlanadi.`,
    snap.base ? `Jami jarimalar: ${som(snap.fine)}${snap.advance ? ` · avans: ${som(snap.advance)}` : ""}\nQo‘lga tegadigan (taxminiy): <b>${som(snap.net)}</b>` : "",
  ]
    .filter(Boolean)
    .join("\n");
  await notifyEmployee(db, employee, "payroll", text, { title: "Jarima", openButton: true, go: "salary" }).catch(() => undefined);
}

/** HR va direktorga: filial rahbari jarima taklif qildi (panel + Telegram + ilovadagi rahbar profili). */
function alertHr(db: Database, row: PayrollAdjustment, employee: Employee, proposer: string) {
  const branch = db.branches.find((b) => b.id === employee.branchId)?.name || "";
  const body = `${proposer} → ${nameOf(employee)} (${branch}): ${som(row.amount)} — ${row.note || "sabab yozilmagan"}`;
  db.notifications.unshift({
    id: randomUUID(),
    companyId: employee.companyId,
    title: "Jarima taklifi — tasdiq kutilmoqda",
    body,
    type: "FINE",
    read: false,
    createdAt: row.createdAt,
    go: `/fines?id=${row.id}`,
  });
  const hrUsers = db.users.filter((u) => u.companyId === employee.companyId && u.telegramId && canAny(u.role, ["employees.edit"]));
  const seen = new Set<string>();
  for (const user of hrUsers) {
    const self = db.employees.find((e) => e.companyId === employee.companyId && e.status === "ACTIVE" && e.telegramId === user.telegramId);
    if (!self || seen.has(self.id)) continue;
    seen.add(self.id);
    db.notifications.unshift({
      id: randomUUID(),
      companyId: employee.companyId,
      employeeId: self.id,
      title: "Jarima taklifi",
      body,
      type: "MANAGER",
      read: false,
      createdAt: row.createdAt,
      go: "manager_requests",
    });
  }
  return hrUsers.map((u) => u.telegramId!);
}

export function createFinanceRouter() {
  const router = Router();
  const permit = (check: (role: Role) => boolean) => (req: Request, res: Response, next: NextFunction) =>
    check((req as AuthedRequest).session!.role) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });

  /* ----------------------------------------------------------- jarimalar --- */
  router.get(
    "/fines",
    permit(canFineView),
    route(async (req, res) => {
      const tenant = req.session!.companyId!;
      const db = await readDb();
      const scope = scopeOf(req, db);
      const month = req.query.month ? monthSchema.parse(String(req.query.month)) : "";
      const statuses = String(req.query.status || "").split(",").filter(Boolean);
      res.json(
        db.payrollAdjustments
          .filter((a) => a.companyId === tenant && a.type === "FINE" && (!month || a.month === month) && (!statuses.length || statuses.includes(a.status || "APPROVED")))
          .map((a) => describeFine(db, a))
          .filter((f) => !scope || (f.branchId && scope.has(f.branchId)))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 1000),
      );
    }),
  );

  /** Jarima uchun xodim qidirish (filial rahbari — faqat o‘z filiali). */
  router.get(
    "/fines/employees",
    permit(canFineView),
    route(async (req, res) => {
      const tenant = req.session!.companyId!;
      const db = await readDb();
      const scope = scopeOf(req, db);
      const q = String(req.query.q || "").trim().toLowerCase();
      res.json(
        db.employees
          .filter((e) => e.companyId === tenant && e.status === "ACTIVE" && (!scope || scope.has(e.branchId)))
          .filter((e) => !q || `${e.firstName} ${e.lastName} ${e.employeeNo}`.toLowerCase().includes(q))
          .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
          .slice(0, Math.min(50, Number(req.query.limit) || 12))
          .map((e) => ({
            id: e.id,
            firstName: e.firstName,
            lastName: e.lastName,
            employeeNo: e.employeeNo,
            photoDataUrl: e.photoDataUrl,
            branchName: db.branches.find((b) => b.id === e.branchId)?.name || "",
            baseSalary: canFineDirect(req.session!.role) ? e.baseSalary : undefined,
          })),
      );
    }),
  );

  router.post(
    "/fines",
    permit(canFineView),
    route(async (req, res) => {
      const tenant = req.session!.companyId!;
      const input = z
        .object({
          employeeId: z.string().min(1),
          amount: z.coerce.number().int("Butun son kiriting.").min(1_000, "Summa kamida 1 000 so‘m.").max(1_000_000_000),
          reason: z.string().trim().min(3, "Sababni yozing (kamida 3 belgi).").max(300),
          month: monthSchema.optional(),
        })
        .parse(req.body);
      const direct = canFineDirect(req.session!.role);
      const month = input.month || currentMonth();
      const created = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === input.employeeId && e.companyId === tenant && e.status === "ACTIVE");
        const scope = scopeOf(req, db);
        if (!employee || (scope && !scope.has(employee.branchId))) throw httpError("Xodim topilmadi.", 404);
        if (closedPeriod(db, tenant, month)) throw httpError(`${monthLabel(month)} yopilgan — jarima keyingi oyga yoziladi yoki oyni qayta oching.`, 409);
        const now = new Date().toISOString();
        const row: PayrollAdjustment = {
          id: randomUUID(),
          companyId: tenant,
          employeeId: employee.id,
          month,
          type: "FINE",
          amount: input.amount,
          note: input.reason,
          createdBy: req.session!.name,
          createdAt: now,
          status: direct ? "APPROVED" : "PENDING",
          proposedBy: direct ? undefined : req.session!.name,
          decidedBy: direct ? req.session!.name : undefined,
          decidedAt: direct ? now : undefined,
        };
        db.payrollAdjustments.push(row);
        let hrChats: string[] = [];
        if (direct)
          db.notifications.unshift({
            id: randomUUID(),
            companyId: tenant,
            employeeId: employee.id,
            title: `Jarima: ${som(row.amount)}`,
            body: `Sabab: ${row.note}. ${monthLabel(month)} oyligingizdan ushlanadi.`,
            type: "PAYROLL",
            read: false,
            createdAt: now,
            go: "salary",
          });
        else hrChats = alertHr(db, row, employee, req.session!.name);
        db.auditLogs.unshift(
          audit(tenant, req.session!.name, `${direct ? "Jarima qo‘llandi" : "Jarima taklif qilindi"}: ${nameOf(employee)}, ${som(row.amount)} — ${row.note}`, "employee", employee.id, undefined, row),
        );
        return { row: { ...row }, employee, hrChats };
      });
      if (direct) void announceFine(created.employee.id, created.row.id);
      else
        for (const chat of created.hrChats)
          void sendTelegramMessage(
            chat,
            `🧾 <b>Jarima taklifi</b>\n${req.session!.name} → ${nameOf(created.employee)}\nSumma: ${som(created.row.amount)}\nSabab: ${created.row.note}\n\nSaytda «Jarimalar» bo‘limida yoki ilovadagi Rahbar → So‘rovlarda tasdiqlang.`,
            { go: "manager_requests" },
          ).catch(() => undefined);
      const db = await readDb();
      res.status(201).json(describeFine(db, created.row));
    }),
  );

  router.post(
    "/fines/:id/decide",
    permit(canFineDirect),
    route(async (req, res) => {
      const tenant = req.session!.companyId!;
      const { approve, note } = z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() }).parse(req.body);
      const result = await updateDb((db) => {
        const row = db.payrollAdjustments.find((a) => a.id === req.params.id && a.companyId === tenant && a.type === "FINE");
        if (!row) throw httpError("Jarima topilmadi.", 404);
        if (row.status !== "PENDING") throw httpError("Bu jarima allaqachon ko‘rib chiqilgan.", 409);
        if (approve && closedPeriod(db, tenant, row.month)) throw httpError(`${monthLabel(row.month)} yopilgan.`, 409);
        const employee = db.employees.find((e) => e.id === row.employeeId);
        const now = new Date().toISOString();
        row.status = approve ? "APPROVED" : "REJECTED";
        row.decidedBy = req.session!.name;
        row.decidedAt = now;
        row.decidedNote = note || undefined;
        for (const n of db.notifications) if (n.companyId === tenant && !n.employeeId && n.go === `/fines?id=${row.id}`) n.read = true;
        if (approve && employee)
          db.notifications.unshift({
            id: randomUUID(),
            companyId: tenant,
            employeeId: employee.id,
            title: `Jarima: ${som(row.amount)}`,
            body: `Sabab: ${row.note}. ${monthLabel(row.month)} oyligingizdan ushlanadi.`,
            type: "PAYROLL",
            read: false,
            createdAt: now,
            go: "salary",
          });
        db.auditLogs.unshift(audit(tenant, req.session!.name, `Jarima taklifi ${approve ? "tasdiqlandi" : "rad etildi"}: ${nameOf(employee)}, ${som(row.amount)}`, "employee", row.employeeId));
        return { row: { ...row } };
      });
      if (approve) void announceFine(result.row.employeeId, result.row.id);
      const db = await readDb();
      res.json(describeFine(db, result.row));
    }),
  );

  router.delete(
    "/fines/:id",
    permit(canFineDirect),
    route(async (req, res) => {
      const tenant = req.session!.companyId!;
      const removed = await updateDb((db) => {
        const row = db.payrollAdjustments.find((a) => a.id === req.params.id && a.companyId === tenant && a.type === "FINE");
        if (!row) throw httpError("Jarima topilmadi.", 404);
        if (closedPeriod(db, tenant, row.month)) throw httpError(`${monthLabel(row.month)} yopilgan — jarimani bekor qilib bo‘lmaydi.`, 409);
        db.payrollAdjustments = db.payrollAdjustments.filter((a) => a.id !== row.id);
        const employee = db.employees.find((e) => e.id === row.employeeId);
        if ((row.status || "APPROVED") === "APPROVED" && employee)
          db.notifications.unshift({
            id: randomUUID(),
            companyId: tenant,
            employeeId: employee.id,
            title: "Jarima bekor qilindi",
            body: `${som(row.amount)} (${row.note || ""}) — oylikdan ushlanmaydi.`,
            type: "PAYROLL",
            read: false,
            createdAt: new Date().toISOString(),
            go: "salary",
          });
        db.auditLogs.unshift(audit(tenant, req.session!.name, `Jarima bekor qilindi: ${nameOf(employee)}, ${som(row.amount)}`, "employee", row.employeeId, row));
        return row;
      });
      res.json({ ok: true, id: removed.id });
    }),
  );

  /* ------------------------------------------------------ avans oluvchilar --- */
  router.get(
    "/advances/recipients",
    permit(canAdvances),
    route(async (req, res) => {
      const tenant = req.session!.companyId!;
      const month = req.query.month ? monthSchema.parse(String(req.query.month)) : currentMonth();
      const db = await readDb();
      res.json({ month, label: monthLabel(month), canSeeCards: canAny(req.session!.role, ["payroll.edit"]), rows: publicAdvanceRows(advanceRows(db, tenant, month)) });
    }),
  );

  /* ---------------------------------------------------------------- Excel --- */
  router.get(
    "/reports/advances.xlsx",
    permit(canAdvances),
    route(async (req, res) => {
      const tenant = req.session!.companyId!;
      const month = req.query.month ? monthSchema.parse(String(req.query.month)) : currentMonth();
      const withCards = canAny(req.session!.role, ["payroll.edit"]) && req.query.cards === "1";
      const db = await readDb();
      const rows = advanceRows(db, tenant, month);
      if (withCards)
        await updateDb((next) => void next.auditLogs.unshift(audit(tenant, req.session!.name, `Avans ro‘yxati karta raqamlari bilan yuklab olindi (${month})`, "company", tenant)));
      const company = db.companies.find((c) => c.id === tenant)?.name || "Kompaniya";
      const total = rows.reduce((s, r) => s + r.amount, 0);
      const workbook = createWorkbook();
      addTableSheet(workbook, {
        name: "Avanslar",
        title: `Avans oluvchilar — ${monthLabel(month)}`,
        subtitle: `${company}  ·  Tayyorlandi: ${new Date().toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" })}`,
        kpis: [
          { label: "Xodimlar", value: rows.length, tone: "blue" },
          { label: "Jami avans (so‘m)", value: total.toLocaleString("ru-RU"), tone: "green" },
          { label: "To‘langan", value: rows.filter((r) => r.paidAt).length, tone: "violet" },
          { label: "Kutilmoqda", value: rows.filter((r) => r.status !== "APPROVED").length, tone: "amber" },
        ],
        columns: [
          { header: "№", key: "n", width: 5, align: "center" },
          { header: "F.I.Sh", key: "name", width: 28 },
          { header: "Filial", key: "branch", width: 18 },
          { header: "Karta raqami", key: "card", width: 24 },
          { header: "Karta egasi", key: "holder", width: 20 },
          { header: "Asl oylik", key: "base", type: "money", width: 15, total: "sum" },
          { header: "Avans", key: "amount", type: "money", width: 15, total: "sum" },
          { header: "Holat", key: "status", type: "status", width: 14 },
          { header: "Imzo", key: "sign", width: 12 },
        ],
        rows: rows.map((r, i) => {
          let card = r.method === "CASH" ? "Naqd" : r.cardMask || "—";
          if (withCards && r.cardEnc)
            try {
              card = decryptSecret(r.cardEnc).replace(/(\d{4})(?=\d)/g, "$1 ");
            } catch {
              /* kalit o‘zgargan — niqob qoladi */
            }
          return {
            n: i + 1,
            name: r.employeeName,
            branch: r.branchName,
            card,
            holder: r.holder || "",
            base: r.baseSalary,
            amount: r.amount,
            status: r.paidAt
              ? { text: "To‘landi", tone: "green" as const }
              : r.status === "APPROVED"
                ? { text: "Tasdiqlangan", tone: "blue" as const }
                : { text: r.status === "HR_APPROVED" ? "Moliyada" : "Kutilmoqda", tone: "amber" as const },
            sign: "",
          };
        }),
        totalsLabel: "Jami",
        emptyText: "Bu oy avans so‘rovlari yo‘q",
      });
      await sendWorkbook(res, workbook, `avanslar-${month}.xlsx`);
    }),
  );

  router.get(
    "/reports/fines.xlsx",
    permit(canFineDirect),
    route(async (req, res) => {
      const tenant = req.session!.companyId!;
      const month = req.query.month ? monthSchema.parse(String(req.query.month)) : currentMonth();
      const db = await readDb();
      const rows = db.payrollAdjustments
        .filter((a) => a.companyId === tenant && a.type === "FINE" && a.month === month && a.status !== "REJECTED")
        .map((a) => describeFine(db, a))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const company = db.companies.find((c) => c.id === tenant)?.name || "Kompaniya";
      const approved = rows.filter((r) => r.status === "APPROVED");
      const workbook = createWorkbook();
      addTableSheet(workbook, {
        name: "Jarimalar",
        title: `Jarimalar — ${monthLabel(month)}`,
        subtitle: `${company}  ·  Tayyorlandi: ${new Date().toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" })}`,
        kpis: [
          { label: "Jarimalar soni", value: approved.length, tone: "red" },
          { label: "Jami summa (so‘m)", value: approved.reduce((s, r) => s + r.amount, 0).toLocaleString("ru-RU"), tone: "amber" },
          { label: "Xodimlar", value: new Set(approved.map((r) => r.employeeId)).size, tone: "blue" },
          { label: "Kutilmoqda", value: rows.length - approved.length, tone: "gray" },
        ],
        columns: [
          { header: "№", key: "n", width: 5, align: "center" },
          { header: "Sana", key: "date", width: 12, align: "center" },
          { header: "F.I.Sh", key: "name", width: 28 },
          { header: "Filial", key: "branch", width: 18 },
          { header: "Summa", key: "amount", type: "money", width: 15, total: "sum" },
          { header: "Sabab", key: "reason", width: 40 },
          { header: "Kim yozdi", key: "by", width: 20 },
          { header: "Holat", key: "status", type: "status", width: 14 },
        ],
        rows: rows.map((r, i) => ({
          n: i + 1,
          date: r.createdAt.slice(0, 10).split("-").reverse().join("."),
          name: r.employeeName,
          branch: r.branchName,
          amount: r.status === "APPROVED" ? r.amount : null,
          reason: r.reason,
          by: r.proposedBy ? `${r.proposedBy} (taklif)` : r.createdBy,
          status: r.status === "APPROVED" ? { text: "Qo‘llangan", tone: "red" as const } : { text: "Kutilmoqda", tone: "amber" as const },
        })),
        totalsLabel: "Jami",
        emptyText: "Bu oy jarima yo‘q",
      });
      await sendWorkbook(res, workbook, `jarimalar-${month}.xlsx`);
    }),
  );
  return router;
}

/** Oy bo‘yicha avans oluvchilar (so‘rovlar + qo‘lda kiritilgan avanslar). */
function advanceRows(db: Database, tenant: string, month: string) {
  const branchName = (e?: Employee) => db.branches.find((b) => b.id === e?.branchId)?.name || "—";
  const fromRequests = db.advanceRequests
    .filter((a) => a.companyId === tenant && a.month === month && ["PENDING", "HR_APPROVED", "APPROVED"].includes(a.status))
    .map((a) => {
      const employee = db.employees.find((e) => e.id === a.employeeId);
      return {
        id: a.id,
        source: "REQUEST" as const,
        employeeId: a.employeeId,
        employeeName: nameOf(employee),
        employeeNo: employee?.employeeNo,
        photoDataUrl: employee?.photoDataUrl,
        branchName: branchName(employee),
        baseSalary: employee?.baseSalary || 0,
        amount: a.amount,
        status: a.status,
        method: a.payout?.method,
        cardMask: a.payout?.cardMask,
        cardBrand: a.payout?.cardBrand,
        holder: a.payout?.holder,
        cardEnc: a.payout?.cardEnc,
        reason: a.reason,
        paidAt: a.paidAt,
        createdAt: a.createdAt,
        adjustmentId: a.adjustmentId,
      };
    });
  const linked = new Set(fromRequests.map((r) => r.adjustmentId).filter(Boolean));
  const manual = db.payrollAdjustments
    .filter((a) => a.companyId === tenant && a.month === month && a.type === "ADVANCE" && !linked.has(a.id))
    .map((a) => {
      const employee = db.employees.find((e) => e.id === a.employeeId);
      const card = db.payoutCards.find((c) => c.employeeId === a.employeeId);
      return {
        id: a.id,
        source: "MANUAL" as const,
        employeeId: a.employeeId,
        employeeName: nameOf(employee),
        employeeNo: employee?.employeeNo,
        photoDataUrl: employee?.photoDataUrl,
        branchName: branchName(employee),
        baseSalary: employee?.baseSalary || 0,
        amount: a.amount,
        status: "APPROVED" as const,
        method: card ? ("CARD" as const) : undefined,
        cardMask: card?.cardMask,
        cardBrand: card?.cardBrand,
        holder: card?.holder,
        cardEnc: card?.cardEnc,
        reason: a.note,
        paidAt: a.createdAt,
        createdAt: a.createdAt,
        adjustmentId: a.id,
      };
    });
  return [...fromRequests, ...manual].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/** API javobi uchun: shifrlangan karta maydoni chiqmaydi. */
export const publicAdvanceRows = (rows: ReturnType<typeof advanceRows>) => rows.map(({ cardEnc: _c, ...rest }) => rest);
