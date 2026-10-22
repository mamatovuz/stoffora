import type { CompanySubscription, PlanLimits, SubscriptionPlan, SubscriptionStatus } from "./types";

/*
 * Tarif va obuna mantig‘i (sof funksiyalar — testlanadi).
 *
 * Holat sanalardan hisoblanadi:
 *   TRIAL   — trialEndsAt gacha;
 *   ACTIVE  — endsAt gacha (yoki muddatsiz);
 *   GRACE   — endsAt dan keyin graceDays davomida (ma’lumotlar va ish to‘xtamaydi);
 *   EXPIRED — imtiyozli davr ham tugagan (ma’lumotlar o‘chmaydi);
 *   SUSPENDED — administrator to‘xtatgan (pausedAt).
 */

const DAY = 86_400_000;
export const addDaysIso = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY).toISOString();

/** Standart tariflar — faqat birinchi marta yaratiladi, keyin super admin tahrirlaydi (narx belgilanmagan). */
export function defaultPlans(now: string, makeId: () => string): SubscriptionPlan[] {
  const base = { currency: "UZS", period: "MONTH" as const, status: "ACTIVE" as const, version: 1, createdAt: now, updatedAt: now, price: null };
  return [
    { ...base, id: makeId(), key: "free", name: "Free", description: "Kichik jamoalar uchun boshlang‘ich tarif", limits: { employees: 10, branches: 1, managers: 2 }, modules: ["calendar", "reports"], trialDays: 0 },
    { ...base, id: makeId(), key: "pro", name: "Pro", description: "O‘sib borayotgan kompaniyalar uchun", limits: { employees: 200, branches: 10, managers: 15 }, modules: "all", trialDays: 14 },
    { ...base, id: makeId(), key: "enterprise", name: "Enterprise", description: "Katta tarmoqlar, cheklovsiz", limits: { employees: null, branches: null, managers: null }, modules: "all", trialDays: 30 },
  ];
}

/** Kompaniya uchun amaldagi limitlar: kompaniyaga xos qiymat tarifdagidan ustun. */
export function effectiveLimits(plan: Pick<SubscriptionPlan, "limits"> | undefined, sub: Pick<CompanySubscription, "limits"> | undefined): Required<PlanLimits> {
  const pick = (key: keyof PlanLimits) => {
    const own = sub?.limits?.[key];
    if (own !== undefined) return own ?? null;
    const fromPlan = plan?.limits?.[key];
    return fromPlan ?? null;
  };
  return { employees: pick("employees"), branches: pick("branches"), managers: pick("managers") };
}

/** Joriy davr tugash sanasi: sinovda — trialEndsAt, aks holda endsAt (bo‘sh — muddatsiz). */
export const periodEnd = (sub: CompanySubscription) => (sub.status === "TRIAL" ? sub.trialEndsAt : sub.endsAt);

/**
 * Sanalarga qarab joriy holat. Saqlangan `status` — rejim (TRIAL / ACTIVE / SUSPENDED);
 * GRACE va EXPIRED shu yerda sanadan hisoblanadi.
 */
export function subscriptionStatus(sub: CompanySubscription, now = new Date().toISOString()): SubscriptionStatus {
  if (sub.pausedAt || sub.status === "SUSPENDED") return "SUSPENDED";
  const end = periodEnd(sub);
  const mode = sub.status === "TRIAL" ? "TRIAL" : "ACTIVE";
  if (!end || now < end) return mode;
  if (now < addDaysIso(end, Math.max(0, sub.graceDays || 0))) return "GRACE";
  return "EXPIRED";
}

/** Joriy davr tugashiga necha kun qoldi (manfiy — o‘tib ketgan). Muddatsiz — null. */
export function daysLeft(sub: CompanySubscription, now = new Date().toISOString()) {
  const end = periodEnd(sub);
  if (!end) return null;
  return Math.ceil((Date.parse(end) - Date.parse(now)) / DAY);
}

/** Tugash muddatigacha qolgan kunlarga mos, hali yuborilmagan ogohlantirishlar (masalan, [7, 3, 1]). */
export function dueExpiryAlerts(sub: CompanySubscription, days: number[], now = new Date().toISOString()) {
  const left = daysLeft(sub, now);
  if (left === null || left < 0 || sub.pausedAt) return [];
  const end = periodEnd(sub)!.slice(0, 10);
  const sent = new Set(sub.alertsSent || []);
  // Faqat eng kichik mos interval: 2 kun qolganda «3 kun» ogohlantirishi. U yuborilgan bo‘lsa —
  // kattaroq (eskirgan «7 kun») ogohlantirish qayta yuborilmaydi.
  const nearest = [...days].sort((a, b) => a - b).find((d) => left <= d);
  if (nearest === undefined || sent.has(`${end}:${nearest}`)) return [];
  return [{ key: `${end}:${nearest}`, days: nearest, left }];
}

export type SubscriptionAction =
  | { action: "change_plan"; planId: string; keepDates?: boolean }
  | { action: "extend_trial"; days: number }
  | { action: "grant_free"; planId: string; days: number }
  | { action: "set_period"; endsAt: string | null }
  | { action: "set_limits"; limits: PlanLimits }
  | { action: "pause" }
  | { action: "resume" };

/**
 * Obunaga amal qo‘llaydi va yangi obunani qaytaradi (eski obuna o‘zgarmaydi).
 * Hech bir amal ma’lumotni o‘chirmaydi va «to‘langan» holatni soxtalashtirmaydi.
 */
export function applySubscriptionAction(
  current: CompanySubscription | undefined,
  plans: SubscriptionPlan[],
  input: SubscriptionAction,
  actor: string,
  now = new Date().toISOString(),
): CompanySubscription {
  const plan = (id: string) => {
    const found = plans.find((p) => p.id === id);
    if (!found) throw Object.assign(new Error("Tarif topilmadi."), { status: 404 });
    if (found.status !== "ACTIVE") throw Object.assign(new Error("Bu tarif arxivlangan."), { status: 409 });
    return found;
  };
  const base: CompanySubscription = current
    ? { ...current, limits: current.limits ? { ...current.limits } : undefined, alertsSent: current.alertsSent ? [...current.alertsSent] : undefined }
    : { planId: "", status: "ACTIVE", startedAt: now, graceDays: 7, updatedAt: now };
  base.updatedAt = now;
  base.updatedBy = actor;
  switch (input.action) {
    case "change_plan": {
      const next = plan(input.planId);
      base.planId = next.id;
      if (!current) {
        base.startedAt = now;
        if (next.trialDays > 0) {
          base.status = "TRIAL";
          base.trialEndsAt = addDaysIso(now, next.trialDays);
        } else base.status = "ACTIVE";
      }
      base.free = false;
      return base;
    }
    case "extend_trial": {
      if (input.days < 1 || input.days > 365) throw Object.assign(new Error("Kunlar 1–365 oralig‘ida bo‘lsin."), { status: 400 });
      if (!base.planId) throw Object.assign(new Error("Avval tarif tanlang."), { status: 409 });
      const from = base.trialEndsAt && base.trialEndsAt > now ? base.trialEndsAt : now;
      base.trialEndsAt = addDaysIso(from, input.days);
      base.status = "TRIAL";
      base.endsAt = undefined;
      base.alertsSent = [];
      return base;
    }
    case "grant_free": {
      if (input.days < 1 || input.days > 3650) throw Object.assign(new Error("Kunlar 1–3650 oralig‘ida bo‘lsin."), { status: 400 });
      const next = plan(input.planId);
      // Shu tarifda faol davr bo‘lsa — ustiga qo‘shiladi, aks holda bugundan.
      const samePlan = base.planId === next.id && base.status === "ACTIVE";
      const from = samePlan && base.endsAt && base.endsAt > now ? base.endsAt : now;
      base.planId = next.id;
      base.status = "ACTIVE";
      base.manual = true;
      base.free = true;
      base.endsAt = addDaysIso(from, input.days);
      base.trialEndsAt = undefined;
      base.alertsSent = [];
      return base;
    }
    case "set_period": {
      if (!base.planId) throw Object.assign(new Error("Avval tarif tanlang."), { status: 409 });
      if (input.endsAt && Number.isNaN(Date.parse(input.endsAt))) throw Object.assign(new Error("Sana noto‘g‘ri."), { status: 400 });
      base.endsAt = input.endsAt ? new Date(input.endsAt).toISOString() : undefined;
      base.status = "ACTIVE";
      base.trialEndsAt = undefined;
      base.alertsSent = [];
      return base;
    }
    case "set_limits": {
      for (const value of Object.values(input.limits))
        if (value !== null && value !== undefined && (!Number.isInteger(value) || value < 0 || value > 1_000_000))
          throw Object.assign(new Error("Limit 0–1 000 000 oralig‘idagi butun son bo‘lsin."), { status: 400 });
      base.limits = { ...(base.limits || {}), ...input.limits };
      return base;
    }
    case "pause": {
      if (base.pausedAt) return base;
      base.pausedStatus = base.status;
      base.pausedAt = now;
      base.status = "SUSPENDED";
      return base;
    }
    case "resume": {
      if (!base.pausedAt) return base;
      base.status = base.pausedStatus && base.pausedStatus !== "SUSPENDED" ? base.pausedStatus : "ACTIVE";
      base.pausedAt = undefined;
      base.pausedStatus = undefined;
      return base;
    }
  }
}

/** Limit buzilishi xabari (null — limit yo‘q yoki yetarli). */
export function capacityMessage(kind: "employees" | "branches" | "managers", limit: number | null, used: number, adding = 1) {
  if (limit === null || limit === undefined) return null;
  if (used + adding <= limit) return null;
  const label = { employees: "faol xodim", branches: "filial", managers: "panel foydalanuvchisi (rahbar)" }[kind];
  return `Tarifingiz bo‘yicha ko‘pi bilan ${limit} ta ${label} qo‘shish mumkin (hozir ${used} ta). Tarifni kengaytirish uchun platforma administratoriga murojaat qiling.`;
}
