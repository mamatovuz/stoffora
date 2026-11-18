import type { Database } from "../../lib/types";
import { subscriptionStatus } from "../../lib/platform/subscriptions";

/*
 * Investor va ta’sischilar uchun Staffora platformasi ko‘rsatkichlari (Corporate portal).
 * Faqat agregat raqamlar — mijoz kompaniyalar nomi, xodimlar yoki shaxsiy ma’lumot chiqmaydi.
 * Pul — so‘mda (billing yozuvlari butun so‘mda saqlanadi). Daromad faqat «To‘langan» (PAID) hisoblardan.
 */

const monthOf = (iso: string) => iso.slice(0, 7);
function lastMonths(today: string, count: number) {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(y, m - 1 - (count - 1 - index), 1));
    return date.toISOString().slice(0, 7);
  });
}
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function platformStats(db: Database, today: string, now = new Date().toISOString()) {
  const live = db.companies.filter((c) => !c.demo && !c.archive && !c.internal);
  const liveIds = new Set(live.map((c) => c.id));
  const employees = db.employees.filter((e) => liveIds.has(e.companyId));
  const active = employees.filter((e) => e.status === "ACTIVE");
  const months = lastMonths(today, 12);
  const thisMonth = monthOf(today);

  // Obuna: MRR — faol (yoki imtiyozli davrdagi) pullik obunalarning oylik qiymati.
  const plans = new Map(db.subscriptionPlans.map((p) => [p.id, p]));
  let mrr = 0;
  let paying = 0;
  const planCounts = new Map<string, number>();
  for (const c of live) {
    const plan = c.subscription ? plans.get(c.subscription.planId) : undefined;
    const label = plan?.name || c.plan || "—";
    planCounts.set(label, (planCounts.get(label) || 0) + 1);
    if (!c.subscription || !plan || c.subscription.free || plan.price === null || plan.currency !== "UZS") continue;
    const status = subscriptionStatus(c.subscription, now);
    if (status !== "ACTIVE" && status !== "GRACE") continue;
    mrr += plan.period === "YEAR" ? Math.round(plan.price / 12) : plan.price;
    paying += 1;
  }

  // Tushum: to‘langan hisoblar (chegirmadan keyin), oylar bo‘yicha.
  const paid = db.billingRecords.filter((r) => liveIds.has(r.companyId) && r.status === "PAID" && r.currency === "UZS");
  const revenueByMonth = new Map<string, number>();
  for (const r of paid) {
    const key = monthOf(r.paidAt || r.createdAt);
    revenueByMonth.set(key, (revenueByMonth.get(key) || 0) + Math.max(0, r.amount - (r.discount || 0)));
  }
  const outstanding = db.billingRecords
    .filter((r) => liveIds.has(r.companyId) && (r.status === "ISSUED" || r.status === "OVERDUE") && r.currency === "UZS")
    .reduce((s, r) => s + Math.max(0, r.amount - (r.discount || 0)), 0);

  // O‘sish: oy oxiridagi kompaniyalar va faol xodimlar soni (yaratilgan / bo‘shagan sanalaridan).
  const growth = months.map((month) => {
    const end = `${month}-31`;
    return {
      month,
      companies: live.filter((c) => c.createdAt.slice(0, 10) <= end).length,
      employees: employees.filter((e) => (e.startDate || e.createdAt || "").slice(0, 10) <= end && (!e.dismissedAt || e.dismissedAt.slice(0, 10) > end)).length,
      revenue: revenueByMonth.get(month) || 0,
    };
  });

  // Faollik: so‘nggi 30 kunda har kuni kamida bir marta belgilangan noyob xodimlar.
  const from = addDays(today, -29);
  const daily = new Map<string, Set<string>>();
  for (const a of db.attendance) {
    if (!a.checkIn || a.date < from || a.date > today || !liveIds.has(a.companyId)) continue;
    let set = daily.get(a.date);
    if (!set) daily.set(a.date, (set = new Set()));
    set.add(a.employeeId);
  }
  const activity = Array.from({ length: 30 }, (_, index) => {
    const date = addDays(from, index);
    return { date, employees: daily.get(date)?.size || 0 };
  });
  const lastMonthGrowth = growth.at(-2);
  const totalRevenue = paid.reduce((s, r) => s + Math.max(0, r.amount - (r.discount || 0)), 0);

  return {
    generatedAt: now,
    currency: "UZS" as const,
    companies: {
      total: live.length,
      active: live.filter((c) => c.status === "ACTIVE").length,
      trial: live.filter((c) => c.status === "TRIAL" || c.subscription?.status === "TRIAL").length,
      suspended: live.filter((c) => c.status === "SUSPENDED").length,
      newThisMonth: live.filter((c) => monthOf(c.createdAt) === thisMonth).length,
      paying,
    },
    employees: {
      active: active.length,
      newThisMonth: employees.filter((e) => monthOf(e.startDate || e.createdAt || "") === thisMonth).length,
      checkedInToday: daily.get(today)?.size || 0,
      branches: db.branches.filter((b) => liveIds.has(b.companyId)).length,
    },
    revenue: {
      mrr,
      arr: mrr * 12,
      arpa: paying ? Math.round(mrr / paying) : 0,
      thisMonth: revenueByMonth.get(thisMonth) || 0,
      total: totalRevenue,
      outstanding,
    },
    growth,
    companiesGrowthPct: lastMonthGrowth && lastMonthGrowth.companies ? Math.round(((live.length - lastMonthGrowth.companies) / lastMonthGrowth.companies) * 1000) / 10 : null,
    activity,
    plans: [...planCounts.entries()].map(([plan, companies]) => ({ plan, companies })).sort((a, b) => b.companies - a.companies),
  };
}
