import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, dataIndexes, readDb, updateDb } from "../lib/store";
import { canAny } from "../lib/permissions";
import { countingStartDate } from "../lib/counting";
import { tashkentIsoDate } from "../lib/format";
import { dayPlan } from "../lib/schedule";
import type { Database, Employee, RewardSettings } from "../lib/types";
import type { AuthedRequest } from "./auth";
import { notifyEmployee } from "./integrations/hooks";
import { closedPeriod, monthLabel } from "./payroll-routes";

/*
 * Rag‘batlantirish: «N ish kuni ketma-ket vaqtida kelsa — X so‘m».
 *   • Kompaniya saytda bosqichlarni sozlaydi (masalan 10 kun → 100 000, 20 kun → 250 000).
 *   • Seriya shu bosqichga yetganda bonus SHU OY oyligiga qo‘shiladi (BONUS), xodimga tabrik,
 *     boshqa xodimlarga esa motivatsiya xabari boradi (ilova / Mini App bildirishnomasi).
 *   • Har bir seriya uchun har bosqich bir marta: seriya uzilsa — yangidan boshlanadi.
 * Tekshiruv HR fon ishida (har 10 daqiqa) — kechikmay, kelgan kunning o‘zida.
 */

const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
const nameOf = (e: Pick<Employee, "firstName" | "lastName">) => `${e.firstName} ${e.lastName}`.trim();
const LOOKBACK_DAYS = 120;

export const DEFAULT_REWARDS: RewardSettings = { enabled: false, rules: [{ days: 10, amount: 100_000 }], announce: true };
export function rewardSettings(company?: { rewards?: RewardSettings }): RewardSettings {
  const raw = company?.rewards;
  if (!raw) return { ...DEFAULT_REWARDS, rules: [...DEFAULT_REWARDS.rules] };
  const rules = [...new Map((raw.rules || []).filter((r) => r.days >= 2 && r.amount > 0).map((r) => [r.days, r])).values()].sort((a, b) => a.days - b.days);
  return { enabled: Boolean(raw.enabled), rules, announce: raw.announce !== false };
}

/** Joriy seriya: necha ish kuni ketma-ket vaqtida va seriya qaysi sanadan boshlangan. */
export function currentRun(db: Database, employee: Employee, today = tashkentIsoDate()) {
  const company = db.companies.find((c) => c.id === employee.companyId);
  const index = dataIndexes(db);
  const records = new Map((index.attendanceByEmployee.get(employee.id) || []).map((a) => [a.date, a]));
  const leaves = index.approvedLeaveByEmployee.get(employee.id) || [];
  const startFrom = [employee.startDate, countingStartDate(company, employee)].filter(Boolean).sort().pop() || employee.startDate;
  let count = 0;
  let since = "";
  for (let back = 0; back <= LOOKBACK_DAYS; back += 1) {
    const date = tashkentIsoDate(new Date(Date.parse(`${today}T12:00:00+05:00`) - back * 86_400_000));
    if (startFrom && date < startFrom) break;
    const onLeave = leaves.some((l) => l.startDate <= date && l.endDate >= date);
    if (!dayPlan(db, employee, date).enabled || onLeave) continue;
    const record = records.get(date);
    if (date === today && !record?.checkIn) continue;
    if (record?.checkIn && !(record.lateMinutes || 0)) {
      count += 1;
      since = date;
    } else break;
  }
  return { count, since };
}

/** Bir kompaniya uchun: bosqichga yetgan xodimlarga bonus. updateDb ichida. Qaytaradi — yangi mukofotlar. */
export function awardRewards(db: Database, companyId: string, today = tashkentIsoDate()) {
  const company = db.companies.find((c) => c.id === companyId);
  const settings = rewardSettings(company);
  const month = today.slice(0, 7);
  if (!company || !settings.enabled || !settings.rules.length || closedPeriod(db, companyId, month)) return [];
  const awarded: { employee: Employee; days: number; amount: number }[] = [];
  for (const employee of db.employees.filter((e) => e.companyId === companyId && e.status === "ACTIVE")) {
    const run = currentRun(db, employee, today);
    if (!run.count) continue;
    for (const rule of settings.rules) {
      if (run.count < rule.days) continue;
      const key = `${employee.id}:${rule.days}:${run.since}`;
      if (db.rewardAwards.some((a) => a.key === key)) continue;
      const now = new Date().toISOString();
      const adjustmentId = randomUUID();
      db.payrollAdjustments.push({
        id: adjustmentId,
        companyId,
        employeeId: employee.id,
        month,
        type: "BONUS",
        amount: rule.amount,
        note: `Rag‘batlantirish: ${rule.days} ish kuni ketma-ket vaqtida`,
        createdBy: "Rag‘batlantirish",
        createdAt: now,
      });
      db.rewardAwards.push({ id: randomUUID(), key, companyId, employeeId: employee.id, days: rule.days, amount: rule.amount, month, adjustmentId, createdAt: now });
      db.notifications.unshift({
        id: randomUUID(),
        companyId,
        employeeId: employee.id,
        title: `🎉 Mukofot: ${som(rule.amount)}`,
        body: `${rule.days} ish kuni ketma-ket vaqtida keldingiz! ${som(rule.amount)} ${monthLabel(month)} oyligingizga qo‘shiladi.`,
        type: "PAYROLL",
        read: false,
        createdAt: now,
        go: "salary",
      });
      db.auditLogs.unshift(audit(companyId, "Rag‘batlantirish", `Mukofot: ${nameOf(employee)} — ${rule.days} kun vaqtida, ${som(rule.amount)}`, "employee", employee.id));
      awarded.push({ employee, days: rule.days, amount: rule.amount });
    }
  }
  // Boshqa xodimlarga bitta umumlashgan motivatsiya xabari (har mukofot uchun alohida emas).
  if (settings.announce && awarded.length) {
    const now = new Date().toISOString();
    const winners = awarded.map((a) => `${nameOf(a.employee)} (${a.days} kun — ${som(a.amount)})`).join(", ");
    const ids = new Set(awarded.map((a) => a.employee.id));
    for (const other of db.employees)
      if (other.companyId === companyId && other.status === "ACTIVE" && !ids.has(other.id))
        db.notifications.unshift({
          id: randomUUID(),
          companyId,
          employeeId: other.id,
          title: "🏆 Hamkasblaringiz mukofot oldi",
          body: `${winners}. Ketma-ket vaqtida keling va siz ham oling: ${settings.rules.map((r) => `${r.days} kun → ${som(r.amount)}`).join(", ")}.`,
          type: "ANNOUNCEMENT",
          read: false,
          createdAt: now,
          go: "stats",
        });
  }
  return awarded;
}

/** HR fon ishi: barcha kompaniyalar bo‘yicha (sozlama yoqilganlar). */
export async function runRewards(today = tashkentIsoDate()) {
  const db = await readDb();
  const companies = db.companies.filter((c) => c.status !== "SUSPENDED" && c.rewards?.enabled).map((c) => c.id);
  if (!companies.length) return 0;
  const awarded = await updateDb((next) => companies.flatMap((id) => awardRewards(next, id, today)));
  if (!awarded.length) return 0;
  const fresh = await readDb();
  for (const item of awarded) {
    const employee = fresh.employees.find((e) => e.id === item.employee.id);
    if (employee)
      await notifyEmployee(
        fresh,
        employee,
        "payroll",
        `🎉 <b>Tabriklaymiz, ${employee.firstName}!</b>\n${item.days} ish kuni ketma-ket vaqtida keldingiz.\nMukofot: <b>${som(item.amount)}</b> — shu oy oyligingizga qo‘shiladi.`,
        { title: "Mukofot", openButton: true, go: "salary" },
      ).catch(() => undefined);
  }
  return awarded.length;
}

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req as AuthedRequest, res)).catch(next);

/** Panel: sozlama va berilgan mukofotlar. */
export function createRewardsRouter() {
  const router = Router();
  const canView = (req: Request, res: Response, next: NextFunction) =>
    canAny((req as AuthedRequest).session!.role, ["payroll.view", "payroll.edit"]) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  const canEdit = (req: Request, res: Response, next: NextFunction) =>
    canAny((req as AuthedRequest).session!.role, ["payroll.edit"]) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });

  router.get(
    "/rewards",
    canView,
    route(async (req, res) => {
      const tenant = req.session!.companyId!;
      const db = await readDb();
      const month = String(req.query.month || tashkentIsoDate().slice(0, 7));
      const company = db.companies.find((c) => c.id === tenant);
      // Yetakchilar: hozirgi seriya bo‘yicha (motivatsiya uchun).
      const leaders = db.employees
        .filter((e) => e.companyId === tenant && e.status === "ACTIVE")
        .map((e) => ({ id: e.id, name: nameOf(e), photoDataUrl: e.photoDataUrl, branch: db.branches.find((b) => b.id === e.branchId)?.name || "", streak: currentRun(db, e).count }))
        .filter((e) => e.streak > 0)
        .sort((a, b) => b.streak - a.streak)
        .slice(0, 10);
      res.json({
        settings: rewardSettings(company),
        awards: db.rewardAwards
          .filter((a) => a.companyId === tenant && a.month === month && !a.skipped)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((a) => {
            const e = db.employees.find((x) => x.id === a.employeeId);
            return { ...a, employeeName: e ? nameOf(e) : "—", photoDataUrl: e?.photoDataUrl, branch: db.branches.find((b) => b.id === e?.branchId)?.name || "" };
          }),
        leaders,
      });
    }),
  );

  router.put(
    "/company/rewards",
    canEdit,
    route(async (req, res) => {
      const tenant = req.session!.companyId!;
      const input = z
        .object({
          enabled: z.boolean(),
          announce: z.boolean().default(true),
          rules: z
            .array(z.object({ days: z.coerce.number().int().min(2, "Kamida 2 kun.").max(120, "Ko‘pi bilan 120 kun."), amount: z.coerce.number().int().min(1_000, "Summa kamida 1 000 so‘m.").max(100_000_000) }))
            .max(6),
        })
        .parse(req.body);
      if (input.enabled && !input.rules.length) throw Object.assign(new Error("Kamida bitta bosqich qo‘shing."), { status: 422 });
      const settings = rewardSettings({ rewards: input });
      await updateDb((db) => {
        const company = db.companies.find((c) => c.id === tenant);
        if (!company) throw Object.assign(new Error("Kompaniya topilmadi."), { status: 404 });
        const wasEnabled = Boolean(company.rewards?.enabled);
        company.rewards = settings;
        // Yangi yoqilganda — hozirgi seriyalar «hisobga olingan» (orqaga qarab pul berilmaydi, keyingi bosqichdan boshlab).
        if (settings.enabled && !wasEnabled) {
          const now = new Date().toISOString();
          for (const employee of db.employees.filter((e) => e.companyId === tenant && e.status === "ACTIVE")) {
            const run = currentRun(db, employee);
            for (const rule of settings.rules)
              if (run.count >= rule.days) {
                const key = `${employee.id}:${rule.days}:${run.since}`;
                if (!db.rewardAwards.some((a) => a.key === key))
                  db.rewardAwards.push({ id: randomUUID(), key, companyId: tenant, employeeId: employee.id, days: rule.days, amount: 0, month: tashkentIsoDate().slice(0, 7), createdAt: now, skipped: true });
              }
          }
        }
        db.auditLogs.unshift(audit(tenant, req.session!.name, `Rag‘batlantirish ${settings.enabled ? "yoqildi" : "o‘chirildi"}: ${settings.rules.map((r) => `${r.days} kun → ${som(r.amount)}`).join(", ")}`, "company", tenant));
      });
      // Darhol tekshiramiz — bosqichga yetganlar kutib qolmasin.
      if (settings.enabled) void runRewards().catch(() => undefined);
      res.json(settings);
    }),
  );
  return router;
}
