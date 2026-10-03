import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { canAny } from "../lib/permissions";
import { tashkentIsoDate } from "../lib/format";
import { workingDaysInMonth } from "../lib/schedule";
import type { AdvanceRequest, Database, Employee, Role } from "../lib/types";
import { sendTelegramMessage } from "./telegram";
import type { AuthedRequest, EmployeeSession } from "./auth";
import { notifyEmployee } from "./integrations/hooks";
import { closedPeriod, monthLabel } from "./payroll-routes";
import { payrollRows } from "./reports";
import { decryptSecret, encryptSecret } from "./integrations/secrets";
import { cardBrand, cardDigits, cardError, holderError, maskCard, normalizeHolder, CARD_BRAND_LABELS } from "../lib/card";

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

/** Tashqariga beriladigan ko‘rinish: shifrlangan karta raqami hech qachon chiqmaydi. */
export function publicAdvance<T extends AdvanceRequest>(row: T) {
  if (!row.payout) return row;
  const { cardEnc: _hidden, ...payout } = row.payout;
  return { ...row, payout };
}
const publicCard = (card?: Database["payoutCards"][number]) => (card ? { mask: card.cardMask, brand: card.cardBrand, holder: card.holder } : null);

const payoutSchema = z
  .discriminatedUnion("method", [
    z.object({ method: z.literal("CASH") }),
    z.object({
      method: z.literal("CARD"),
      /** Saqlangan kartadan foydalanish (raqamni qayta kiritmasdan). */
      useSaved: z.boolean().optional(),
      cardNumber: z.string().max(30).optional(),
      holder: z.string().max(80).optional(),
      remember: z.boolean().optional(),
    }),
  ])
  .optional();

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
    .filter((a) => a.employeeId === employee.id && a.month === month && (a.status === "PENDING" || a.status === "HR_APPROVED"))
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
    // Dam olish kunida ishlab qoplangan kelmaslik kunlari (ushlanma olinmaydi).
    compensatedDays: row?.compensatedDays ?? 0,
    compensatedDates: row?.compensatedDates ?? [],
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
      // Oy tanlash: o‘tgan oylar ham (12 oygacha); kelajak — yo‘q.
      const current = tashkentIsoDate().slice(0, 7);
      const asked = String(req.query.month || current);
      const month = /^\d{4}-\d{2}$/.test(asked) && asked <= current ? asked : current;
      const snapshot = salarySnapshot(db, employee, month);
      // To‘langani: avanslar (to‘langan) + oy «To‘landi» bosqichida bo‘lsa — qolgani ham.
      const stage = db.payrollWorkflows.find((w) => w.companyId === employee.companyId && w.month === month)?.stage;
      const accrued = snapshot.base + snapshot.overtimeAmount + snapshot.bonus;
      const withheld = snapshot.lateDeduction + snapshot.absenceDeduction + snapshot.fine;
      const payable = Math.max(0, accrued - withheld);
      const paid = stage === "PAID" ? payable : snapshot.advance;
      res.json({
        ...snapshot,
        current: month === current,
        stage: stage || "CALCULATING",
        accrued,
        withheld,
        payable,
        paid,
        remaining: Math.max(0, payable - paid),
        limit: advanceLimit(db, employee, month),
        savedCard: publicCard(db.payoutCards.find((c) => c.employeeId === employee.id)),
        requests: db.advanceRequests
          .filter((a) => a.employeeId === employee.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 12)
          .map(publicAdvance),
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
          payout: payoutSchema,
        })
        .parse(req.body);
      const month = tashkentIsoDate().slice(0, 7);
      // Kartani tranzaksiyadan oldin tekshiramiz — xato bo‘lsa aniq xabar.
      const card = input.payout?.method === "CARD" && !input.payout.useSaved ? input.payout : undefined;
      if (card) {
        const problem = cardError(card.cardNumber || "") || holderError(card.holder || "");
        if (problem) throw httpError(problem, 422);
      }
      const created = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId && e.status === "ACTIVE");
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        const limit = advanceLimit(db, employee, month);
        if (!limit.enabled) throw httpError(limit.closed ? "Bu oy yopilgan — avans so‘rab bo‘lmaydi." : "Kompaniyada avans so‘rash yoqilmagan.", 422);
        if (db.advanceRequests.some((a) => a.employeeId === employee.id && (a.status === "PENDING" || a.status === "HR_APPROVED")))
          throw httpError("Avvalgi so‘rovingiz hali ko‘rib chiqilmoqda.", 409);
        if (input.amount > limit.available) throw httpError(`Bu oy ko‘pi bilan ${som(limit.available)} so‘rash mumkin.`, 422);
        const now = new Date().toISOString();
        let payout: AdvanceRequest["payout"];
        if (input.payout?.method === "CASH") payout = { method: "CASH" };
        else if (input.payout?.method === "CARD") {
          if (input.payout.useSaved) {
            const saved = db.payoutCards.find((c) => c.employeeId === employee.id);
            if (!saved) throw httpError("Saqlangan karta topilmadi — raqamni kiriting.", 422);
            payout = { method: "CARD", cardEnc: saved.cardEnc, cardMask: saved.cardMask, cardBrand: saved.cardBrand, holder: saved.holder };
          } else if (card) {
            const digits = cardDigits(card.cardNumber || "");
            payout = {
              method: "CARD",
              cardEnc: encryptSecret(digits),
              cardMask: maskCard(digits),
              cardBrand: CARD_BRAND_LABELS[cardBrand(digits)],
              holder: normalizeHolder(card.holder || ""),
            };
            db.payoutCards = db.payoutCards.filter((c) => c.employeeId !== employee.id);
            if (card.remember)
              db.payoutCards.push({
                companyId: employee.companyId,
                employeeId: employee.id,
                cardEnc: payout.cardEnc!,
                cardMask: payout.cardMask!,
                cardBrand: payout.cardBrand!,
                holder: payout.holder!,
                updatedAt: now,
              });
          }
        }
        const row: AdvanceRequest = {
          id: randomUUID(),
          companyId: employee.companyId,
          employeeId: employee.id,
          month,
          amount: input.amount,
          reason: input.reason || undefined,
          payout,
          status: "PENDING",
          createdAt: now,
          updatedAt: now,
        };
        db.advanceRequests.unshift(row);
        db.notifications.unshift({
          id: randomUUID(),
          companyId: employee.companyId,
          title: "Avans so‘rovi",
          body: `${nameOf(employee)} ${som(input.amount)} avans so‘radi${input.reason ? ` («${input.reason}»)` : ""}${payout?.method === "CARD" ? ` · kartaga: ${payout.cardMask} (${payout.holder})` : payout?.method === "CASH" ? " · naqd" : ""}. Ish haqi sahifasida ko‘rib chiqing.`,
          type: "PAYROLL",
          read: false,
          createdAt: now,
        });
        db.auditLogs.unshift(audit(employee.companyId, nameOf(employee), `Avans so‘rovi: ${som(input.amount)}`, "employee", employee.id));
        return row;
      });
      res.status(201).json(publicAdvance(created));
    }),
  );
  /** Saqlangan kartani o‘chirish. */
  router.delete(
    "/mini/payout-card",
    route(async (req, res) => {
      const auth = employeeSession(req);
      await updateDb((db) => {
        db.payoutCards = db.payoutCards.filter((c) => !(c.employeeId === auth.employeeId && c.companyId === auth.companyId));
      });
      res.json({ ok: true });
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
/** 1-bosqich (HR) va 2-bosqich (moliya) ruxsatlari. Egasi ikkalasini ham bajara oladi. */
export const isAdvanceHr = (role: Role) => canAny(role, ["leave.approve", "employees.edit"]);
export const isAdvanceFinance = (role: Role) => canAny(role, ["payroll.edit"]);
const twoStep = (db: Database, companyId: string) => db.companies.find((c) => c.id === companyId)?.payroll?.advanceHrApproval !== false;

/** Moliyaga yangi avans keldi (HR tasdiqlagandan keyin). */
async function alertFinance(companyId: string, text: string) {
  const db = await readDb();
  const finance = db.users.filter((u) => u.companyId === companyId && u.telegramId && isAdvanceFinance(u.role));
  await Promise.allSettled(finance.map((u) => sendTelegramMessage(u.telegramId!, text, { go: "manager_requests", buttonText: "💳 So‘rovni ochish" })));
}

export function createAdvanceRouter() {
  const router = Router();
  const permit = (req: Request, res: Response, next: NextFunction) =>
    isAdvanceFinance((req as AuthedRequest).session!.role) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  const permitAny = (req: Request, res: Response, next: NextFunction) => {
    const role = (req as AuthedRequest).session!.role;
    return isAdvanceFinance(role) || isAdvanceHr(role) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  };

  router.get(
    "/payroll/advances",
    permitAny,
    route(async (req, res) => {
      const tenant = (req as AuthedRequest).session!.companyId!;
      const db = await readDb();
      const statuses = String(req.query.status || "").split(",").filter(Boolean);
      res.json(
        db.advanceRequests
          .filter((a) => a.companyId === tenant && (!statuses.length || statuses.includes(a.status)))
          .slice(0, 300)
          .map((a) => {
            const employee = db.employees.find((e) => e.id === a.employeeId);
            return {
              ...publicAdvance(a),
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
    permitAny,
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
      const role = auth.session!.role;
      const result = await updateDb((db) => {
        const row = db.advanceRequests.find((a) => a.id === req.params.id && a.companyId === tenant);
        if (!row) throw httpError("So‘rov topilmadi.", 404);
        const employee = db.employees.find((e) => e.id === row.employeeId);
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        const now = new Date().toISOString();
        // Qaysi bosqich: HR (1) yoki moliya (2).
        const hrStage = row.status === "PENDING" && twoStep(db, tenant);
        if (row.status !== "PENDING" && row.status !== "HR_APPROVED") throw httpError("So‘rov allaqachon ko‘rib chiqilgan.", 409);
        if (hrStage && !isAdvanceHr(role)) throw httpError("Bu so‘rovni avval HR tasdiqlashi kerak.", 403);
        if (!hrStage && !isAdvanceFinance(role)) throw httpError("HR tasdiqladi — endi moliya bo‘limi ko‘rib chiqadi.", 403);
        if (hrStage) {
          // HR summani kamaytirishi mumkin; pul hali ushlanmaydi — moliyaga o‘tadi.
          if (input.approve) row.amount = Math.min(row.amount, input.amount || row.amount);
          row.status = input.approve ? "HR_APPROVED" : "REJECTED";
          row.hrDecidedBy = auth.session!.name;
          row.hrDecidedAt = now;
          row.hrNote = input.note || undefined;
          if (!input.approve) {
            row.decidedBy = auth.session!.name;
            row.decidedNote = input.note || undefined;
          }
          row.updatedAt = now;
          if (input.approve)
            db.notifications.unshift({
              id: randomUUID(),
              companyId: tenant,
              title: "Avans moliyaga yuborildi",
              body: `${nameOf(employee)}: ${som(row.amount)} — HR tasdiqladi (${auth.session!.name}). Ish haqi → Avans so‘rovlarida ko‘rib chiqing.`,
              type: "PAYROLL",
              read: false,
              createdAt: now,
            });
          db.auditLogs.unshift(audit(tenant, auth.session!.name, `Avans (HR bosqichi) ${input.approve ? "tasdiqlandi → moliyaga" : "rad etildi"}: ${nameOf(employee)}, ${som(row.amount)}`, "employee", employee.id));
          return { row: { ...row }, employee, stage: "HR" as const };
        }
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
          audit(tenant, auth.session!.name, `Avans so‘rovi (moliya) ${input.approve ? "tasdiqlandi" : "rad etildi"}: ${nameOf(employee)}, ${som(row.amount)}`, "employee", employee.id),
        );
        return { row: { ...row }, employee, stage: "FINANCE" as const };
      });
      const db = await readDb();
      const { row, employee } = result;
      if (result.stage === "HR" && input.approve) {
        const payout = row.payout?.method === "CARD" ? `💳 ${row.payout.cardMask} · ${row.payout.holder || ""}` : row.payout?.method === "CASH" ? "💵 Naqd" : "";
        void alertFinance(tenant, `💰 <b>Avans — moliya tasdig‘i kerak</b>\n${nameOf(employee)} · ${som(row.amount)}\nHR: ${auth.session!.name}${payout ? `\n${payout}` : ""}`).catch(() => undefined);
        const info = `🟡 <b>HR avansingizni tasdiqladi</b>\n${som(row.amount)} — endi moliya bo‘limi ko‘rib chiqadi.`;
        await updateDb(
          (next) =>
            void next.notifications.unshift({ id: randomUUID(), companyId: tenant, employeeId: employee.id, title: "Avans moliyaga yuborildi", body: info.replace(/<[^>]+>/g, ""), type: "PAYROLL", read: false, createdAt: new Date().toISOString(), go: "salary" }),
        );
        const fresh = db.employees.find((e) => e.id === employee.id);
        if (fresh) void notifyEmployee(db, fresh, "payroll", info, { title: "Avans", go: "salary" }).catch(() => undefined);
        return res.json(publicAdvance(row));
      }
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
            go: "salary",
          }),
      );
      const fresh = db.employees.find((e) => e.id === employee.id);
      if (fresh) await notifyEmployee(db, fresh, "payroll", text, { title: "Avans", openButton: true, go: "salary" }).catch(() => undefined);
      res.json(publicAdvance(row));
    }),
  );

  /** To‘liq karta raqamini ko‘rish (o‘tkazma uchun) — har safar auditga yoziladi. */
  router.post(
    "/payroll/advances/:id/card",
    permit,
    rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }),
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = auth.session!.companyId!;
      const result = await updateDb((db) => {
        const row = db.advanceRequests.find((a) => a.id === req.params.id && a.companyId === tenant);
        if (!row?.payout?.cardEnc) throw httpError("Bu so‘rovda karta yo‘q.", 404);
        const employee = db.employees.find((e) => e.id === row.employeeId);
        db.auditLogs.unshift(audit(tenant, auth.session!.name, `Avans kartasi raqami ko‘rildi: ${nameOf(employee)} (${row.payout.cardMask})`, "employee", row.employeeId));
        return { enc: row.payout.cardEnc, holder: row.payout.holder, brand: row.payout.cardBrand };
      });
      let number: string;
      try {
        number = decryptSecret(result.enc);
      } catch {
        throw httpError("Karta raqamini ochib bo‘lmadi (server kaliti o‘zgargan).", 500);
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({ number: number.replace(/(\d{4})(?=\d)/g, "$1 "), holder: result.holder, brand: result.brand });
    }),
  );

  /** Pul o‘tkazildi / naqd berildi — xodimga xabar boradi. */
  router.post(
    "/payroll/advances/:id/paid",
    permit,
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = auth.session!.companyId!;
      const row = await updateDb((db) => {
        const item = db.advanceRequests.find((a) => a.id === req.params.id && a.companyId === tenant);
        if (!item) throw httpError("So‘rov topilmadi.", 404);
        if (item.status !== "APPROVED") throw httpError("Avval so‘rovni tasdiqlang.", 409);
        if (item.paidAt) throw httpError("Allaqachon to‘langan deb belgilangan.", 409);
        item.paidAt = new Date().toISOString();
        item.paidBy = auth.session!.name;
        item.updatedAt = item.paidAt;
        db.auditLogs.unshift(audit(tenant, auth.session!.name, `Avans to‘landi: ${som(item.amount)}`, "employee", item.employeeId));
        db.notifications.unshift({
          id: randomUUID(),
          companyId: tenant,
          employeeId: item.employeeId,
          title: item.payout?.method === "CARD" ? "Avans kartangizga o‘tkazildi" : "Avans tayyor",
          body: `${som(item.amount)}${item.payout?.method === "CARD" ? ` → ${item.payout.cardMask}` : " — kassadan olishingiz mumkin"}`,
          type: "PAYROLL",
          read: false,
          createdAt: item.paidAt,
          go: "salary",
        });
        return { ...item };
      });
      const db = await readDb();
      const employee = db.employees.find((e) => e.id === row.employeeId);
      if (employee)
        void notifyEmployee(
          db,
          employee,
          "payroll",
          row.payout?.method === "CARD"
            ? `💸 <b>Avans o‘tkazildi</b>\n${som(row.amount)} → ${row.payout.cardMask}\n${row.payout.holder || ""}`
            : `💵 <b>Avansingiz tayyor</b>\n${som(row.amount)} — kassadan olishingiz mumkin.`,
          { go: "salary" },
        ).catch(() => undefined);
      res.json(publicAdvance(row));
    }),
  );
  return router;
}
