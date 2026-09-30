import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { dataIndexes, readDb } from "../lib/store";
import { canAny } from "../lib/permissions";
import { tashkentIsoDate } from "../lib/format";
import type { Database, Employee } from "../lib/types";
import type { AuthedRequest } from "./auth";
import { datesBetween, dayStatus } from "./reports";
import { sendTelegramMessage } from "./telegram";

/*
 * Rahbar uchun tahlil: filiallar reytingi, intizomlilar va ko‘p kechikuvchilar,
 * oyma-oy o‘zgarish, kunlik davomat darajasi. Har dushanba egasiga botda xulosa.
 */

type Tally = { expected: number; present: number; late: number; lateMinutes: number; absent: number; leave: number };
const empty = (): Tally => ({ expected: 0, present: 0, late: 0, lateMinutes: 0, absent: 0, leave: 0 });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
function score(t: Tally) {
  const attendance = t.expected ? Math.min(1, t.present / t.expected) : 1;
  const punctuality = t.present ? (t.present - t.late) / t.present : t.expected ? 0 : 1;
  return Math.round((attendance * 0.6 + punctuality * 0.4) * 100);
}

/** Davr bo‘yicha xodim, filial va kun kesimidagi yig‘indilar. */
export function tallyPeriod(db: Database, companyId: string, from: string, to: string, branchFilter?: Set<string> | null) {
  const today = tashkentIsoDate();
  const end = to < today ? to : today;
  const dates = from <= end ? datesBetween(from, end) : [];
  const index = dataIndexes(db);
  const byEmployee = new Map<string, Tally>();
  const byBranch = new Map<string, Tally>();
  const byDate = new Map<string, Tally>();
  const employees = db.employees.filter(
    (e) => e.companyId === companyId && (e.status === "ACTIVE" || e.status === "DISMISSED") && (!branchFilter || branchFilter.has(e.branchId)),
  );
  for (const e of employees) {
    const records = new Map((index.attendanceByEmployee.get(e.id) || []).filter((a) => a.date >= from && a.date <= end).map((a) => [a.date, a]));
    const t = empty();
    for (const date of dates) {
      if (e.status === "DISMISSED" && e.dismissedAt && date > e.dismissedAt.slice(0, 10)) continue;
      const status = dayStatus(db, e, date, today, records.get(date));
      const add = (target: Tally) => {
        if (["present", "late", "absent"].includes(status.kind)) target.expected += 1;
        if (status.kind === "present" || status.kind === "late") target.present += 1;
        if (status.kind === "late") {
          target.late += 1;
          target.lateMinutes += records.get(date)?.lateMinutes || 0;
        }
        if (status.kind === "absent") target.absent += 1;
        if (status.kind === "leave") target.leave += 1;
      };
      add(t);
      if (!byDate.has(date)) byDate.set(date, empty());
      add(byDate.get(date)!);
    }
    byEmployee.set(e.id, t);
    if (!byBranch.has(e.branchId)) byBranch.set(e.branchId, empty());
    const b = byBranch.get(e.branchId)!;
    for (const key of Object.keys(t) as (keyof Tally)[]) b[key] += t[key];
  }
  const total = empty();
  for (const t of byBranch.values()) for (const key of Object.keys(t) as (keyof Tally)[]) total[key] += t[key];
  return { employees, byEmployee, byBranch, byDate, total, dates };
}

const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
};
const previousMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
};

export function companyAnalytics(db: Database, companyId: string, month: string, scope: Set<string> | null = null) {
  const { from, to } = monthRange(month);
  const current = tallyPeriod(db, companyId, from, to, scope);
  const prevRange = monthRange(previousMonth(month));
  const previous = tallyPeriod(db, companyId, prevRange.from, prevRange.to, scope).total;
  const branches = db.branches
    .filter((b) => b.companyId === companyId && (!scope || scope.has(b.id)))
    .map((b) => {
      const t = current.byBranch.get(b.id) || empty();
      return {
        id: b.id,
        name: b.name,
        employees: current.employees.filter((e) => e.branchId === b.id && e.status === "ACTIVE").length,
        attendanceRate: pct(t.present, t.expected),
        punctuality: pct(t.present - t.late, t.present),
        lateMinutes: t.lateMinutes,
        absent: t.absent,
        score: t.expected ? score(t) : null,
      };
    })
    .filter((b) => b.employees > 0)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const people = current.employees
    .filter((e) => e.status === "ACTIVE")
    .map((e) => {
      const t = current.byEmployee.get(e.id) || empty();
      return { id: e.id, name: `${e.firstName} ${e.lastName}`.trim(), employeeNo: e.employeeNo, branch: db.branches.find((b) => b.id === e.branchId)?.name, ...t, score: score(t) };
    })
    .filter((p) => p.expected > 0);
  const punctual = [...people].filter((p) => p.late === 0 && p.present > 0).sort((a, b) => b.present - a.present || b.score - a.score).slice(0, 8);
  const latecomers = [...people].filter((p) => p.lateMinutes > 0).sort((a, b) => b.lateMinutes - a.lateMinutes).slice(0, 8);
  const absentees = [...people].filter((p) => p.absent > 0).sort((a, b) => b.absent - a.absent).slice(0, 8);
  const daily = current.dates.map((date) => {
    const t = current.byDate.get(date) || empty();
    return { date, rate: pct(t.present, t.expected), late: t.late, absent: t.absent };
  });
  const summary = (t: Tally) => ({
    attendanceRate: pct(t.present, t.expected),
    punctuality: pct(t.present - t.late, t.present),
    lateMinutes: t.lateMinutes,
    absent: t.absent,
    score: t.expected ? score(t) : null,
  });
  return { month, current: summary(current.total), previous: summary(previous), branches, punctual, latecomers, absentees, daily };
}

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(handler(req as AuthedRequest, res)).catch(next);

export function createAnalyticsRouter() {
  const router = Router();
  router.get(
    "/analytics",
    (req, res, next) =>
      canAny((req as AuthedRequest).session!.role, ["dashboard.view"])
        ? next()
        : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." }),
    route(async (req, res) => {
      const tenant = req.session!.companyId!;
      const month = z.string().regex(/^\d{4}-\d{2}$/).parse(String(req.query.month || tashkentIsoDate().slice(0, 7)));
      const db = await readDb();
      const user = db.users.find((u) => u.id === req.session!.userId);
      const scope = req.session!.role === "BRANCH_MANAGER" ? new Set(user?.branchIds || []) : null;
      res.json(companyAnalytics(db, tenant, month, scope));
    }),
  );
  return router;
}

/* --------------------------------------------- haftalik xulosa (botda) --- */

export function weeklyDigestText(db: Database, companyId: string, today = tashkentIsoDate()) {
  const end = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const period = tallyPeriod(db, companyId, start, end);
  const company = db.companies.find((c) => c.id === companyId);
  const t = period.total;
  if (!t.expected) return undefined;
  const branches = [...period.byBranch.entries()]
    .map(([id, b]) => ({ name: db.branches.find((x) => x.id === id)?.name || "—", score: score(b), expected: b.expected }))
    .filter((b) => b.expected > 0)
    .sort((a, b) => b.score - a.score);
  const late = period.employees
    .map((e: Employee) => ({ e, t: period.byEmployee.get(e.id)! }))
    .filter((x) => x.t && x.t.lateMinutes > 0)
    .sort((a, b) => b.t.lateMinutes - a.t.lateMinutes)
    .slice(0, 3);
  const fmt = (iso: string) => iso.split("-").reverse().slice(0, 2).join(".");
  return [
    `📊 <b>${company?.name} — haftalik xulosa</b>`,
    `${fmt(start)} – ${fmt(end)}`,
    "",
    `✅ Davomat: <b>${pct(t.present, t.expected)}%</b>`,
    `⏰ Vaqtida kelish: <b>${pct(t.present - t.late, t.present) ?? 0}%</b> · kechikish ${t.late} marta (${t.lateMinutes} daq)`,
    `❌ Kelmagan: ${t.absent} kun`,
    branches.length ? `\n🏆 Eng yaxshi filial: ${branches[0].name} (${branches[0].score})` : "",
    branches.length > 1 ? `⚠️ Eng past: ${branches[branches.length - 1].name} (${branches[branches.length - 1].score})` : "",
    late.length ? `\n🐢 Ko‘p kechikkanlar:\n${late.map((x, i) => `${i + 1}. ${x.e.firstName} ${x.e.lastName} — ${x.t.lateMinutes} daq`).join("\n")}` : "",
    "\nBatafsil: Staffora → Tahlil",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Dushanba kunlari egasi va HR administratorlarga (Telegram ulangan bo‘lsa) haftalik xulosa. */
export async function sendWeeklyDigests(today = tashkentIsoDate()) {
  if (new Date(`${today}T12:00:00+05:00`).getDay() !== 1) return 0;
  const db = await readDb();
  let sent = 0;
  for (const company of db.companies) {
    const text = weeklyDigestText(db, company.id, today);
    if (!text) continue;
    for (const user of db.users.filter((u) => u.companyId === company.id && ["COMPANY_OWNER", "HR_ADMIN"].includes(u.role) && u.telegramId)) {
      const ok = await sendTelegramMessage(user.telegramId!, text).catch(() => false);
      if (ok) sent += 1;
    }
  }
  return sent;
}
