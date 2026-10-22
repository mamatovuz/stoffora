import { describe, expect, it } from "vitest";
import { addDaysIso, applySubscriptionAction, capacityMessage, daysLeft, defaultPlans, dueExpiryAlerts, effectiveLimits, subscriptionStatus } from "../lib/platform/subscriptions";
import { discountFor, normalizeCode, PROMO_CODE_RE, promoError } from "../lib/platform/promo";
import { evaluateFlag, rolloutBucket } from "../lib/platform/flags";
import { healthScore } from "../lib/platform/health";
import { onboardingSteps } from "../lib/platform/onboarding";
import { canAssignPlatformRole, platformCan, platformPermissionsOf, platformRoleOf } from "../lib/platform/permissions";
import { isPrivateAddress, maskSecrets, webhookUrlError } from "../lib/platform/security";
import { dependencyIssues, effectiveDisabledModules, moduleDecision } from "../lib/modules";
import type { CompanySubscription, FeatureFlag, PromoCode } from "../lib/platform/types";

/* Super Admin Control Center — sof funksiyalar: tarif/obuna, promo, feature flag, sog‘liq bahosi, onboarding, RBAC, xavfsizlik, modullar. */

const NOW = "2026-10-22T07:00:00.000Z";
let seq = 0;
const plans = defaultPlans(NOW, () => `p${++seq}`);
const free = plans.find((p) => p.key === "free")!;
const pro = plans.find((p) => p.key === "pro")!;

describe("obuna (subscriptions)", () => {
  it("standart tariflar narxsiz — soxta narx yo‘q", () => {
    expect(plans.map((p) => p.key)).toEqual(["free", "pro", "enterprise"]);
    expect(plans.every((p) => p.price === null)).toBe(true);
  });

  it("birinchi tarif: sinov kunlari bo‘lsa TRIAL, aks holda ACTIVE", () => {
    const trial = applySubscriptionAction(undefined, plans, { action: "change_plan", planId: pro.id }, "Admin", NOW);
    expect(trial.status).toBe("TRIAL");
    expect(trial.trialEndsAt).toBe(addDaysIso(NOW, pro.trialDays));
    const active = applySubscriptionAction(undefined, plans, { action: "change_plan", planId: free.id }, "Admin", NOW);
    expect(active.status).toBe("ACTIVE");
  });

  it("muddat sanalardan hisoblanadi: TRIAL → GRACE → EXPIRED", () => {
    const sub: CompanySubscription = { planId: pro.id, status: "TRIAL", startedAt: NOW, trialEndsAt: addDaysIso(NOW, 2), graceDays: 3, updatedAt: NOW };
    expect(subscriptionStatus(sub, NOW)).toBe("TRIAL");
    expect(daysLeft(sub, NOW)).toBe(2);
    expect(subscriptionStatus(sub, addDaysIso(NOW, 3))).toBe("GRACE");
    expect(subscriptionStatus(sub, addDaysIso(NOW, 6))).toBe("EXPIRED");
  });

  it("pauza va davom: oldingi rejim tiklanadi, ma’lumot o‘chmaydi", () => {
    const sub = applySubscriptionAction(undefined, plans, { action: "change_plan", planId: pro.id }, "A", NOW);
    const paused = applySubscriptionAction(sub, plans, { action: "pause" }, "A", NOW);
    expect(subscriptionStatus(paused, NOW)).toBe("SUSPENDED");
    const resumed = applySubscriptionAction(paused, plans, { action: "resume" }, "A", NOW);
    expect(resumed.status).toBe("TRIAL");
    expect(resumed.pausedAt).toBeUndefined();
    // Asl obuna o‘zgarmagan (immutable).
    expect(sub.pausedAt).toBeUndefined();
  });

  it("bepul davr shu tarifdagi faol davr ustiga qo‘shiladi", () => {
    const first = applySubscriptionAction(undefined, plans, { action: "grant_free", planId: pro.id, days: 30 }, "A", NOW);
    expect(first.free).toBe(true);
    const second = applySubscriptionAction(first, plans, { action: "grant_free", planId: pro.id, days: 10 }, "A", NOW);
    expect(second.endsAt).toBe(addDaysIso(NOW, 40));
  });

  it("noto‘g‘ri kirish: arxivlangan tarif, limit, kunlar", () => {
    const archived = plans.map((p) => (p.id === free.id ? { ...p, status: "ARCHIVED" as const } : p));
    expect(() => applySubscriptionAction(undefined, archived, { action: "change_plan", planId: free.id }, "A", NOW)).toThrow(/arxiv/);
    const sub = applySubscriptionAction(undefined, plans, { action: "change_plan", planId: pro.id }, "A", NOW);
    expect(() => applySubscriptionAction(sub, plans, { action: "set_limits", limits: { employees: -1 } }, "A", NOW)).toThrow();
    expect(() => applySubscriptionAction(sub, plans, { action: "extend_trial", days: 0 }, "A", NOW)).toThrow();
  });

  it("limitlar: kompaniya limiti tarifdan ustun, null — cheksiz", () => {
    expect(effectiveLimits(pro, { limits: { employees: 50 } })).toEqual({ employees: 50, branches: 10, managers: 15 });
    expect(effectiveLimits(pro, { limits: { employees: null } }).employees).toBeNull();
    expect(capacityMessage("employees", 10, 10)).toMatch(/10/);
    expect(capacityMessage("employees", null, 999)).toBeNull();
  });

  it("muddat ogohlantirishlari takrorlanmaydi", () => {
    const sub: CompanySubscription = { planId: pro.id, status: "ACTIVE", startedAt: NOW, endsAt: addDaysIso(NOW, 2), graceDays: 7, updatedAt: NOW };
    const due = dueExpiryAlerts(sub, [7, 3, 1], NOW);
    expect(due).toHaveLength(1);
    expect(due[0].days).toBe(3);
    expect(dueExpiryAlerts({ ...sub, alertsSent: [due[0].key] }, [7, 3, 1], NOW)).toHaveLength(0);
  });
});

describe("promo kodlar", () => {
  const promo: PromoCode = { id: "x", code: "START20", kind: "PERCENT", value: 20, status: "ACTIVE", used: 0, perCompanyLimit: 1, createdAt: NOW, createdBy: "A" };
  it("kod normallashtiriladi va formati tekshiriladi", () => {
    expect(normalizeCode(" start 20 ")).toBe("START20");
    expect(PROMO_CODE_RE.test("A")).toBe(false);
    expect(PROMO_CODE_RE.test("SPRING-2026")).toBe(true);
  });
  it("bir kompaniya ikki marta ishlata olmaydi", () => {
    expect(promoError(promo, "c1", [], NOW)).toBeNull();
    expect(promoError(promo, "c1", [{ promoId: "x", companyId: "c1" }], NOW)).toMatch(/allaqachon/);
    expect(promoError(promo, "c2", [{ promoId: "x", companyId: "c1" }], NOW)).toBeNull();
  });
  it("muddati, limiti va kompaniya cheklovi", () => {
    expect(promoError({ ...promo, expiresAt: "2026-01-01T00:00:00Z" }, "c1", [], NOW)).toMatch(/muddati/);
    expect(promoError({ ...promo, usageLimit: 1, used: 1 }, "c1", [], NOW)).toMatch(/chegara/);
    expect(promoError({ ...promo, companyIds: ["c9"] }, "c1", [], NOW)).toMatch(/ushbu kompaniya/);
    expect(promoError(undefined, "c1", [], NOW)).toMatch(/topilmadi/);
  });
  it("chegirma summadan oshmaydi", () => {
    expect(discountFor({ kind: "PERCENT", value: 20 }, 1_000_000)).toBe(200_000);
    expect(discountFor({ kind: "FIXED", value: 5_000_000 }, 1_000_000)).toBe(1_000_000);
  });
});

describe("feature flaglar", () => {
  const flag: FeatureFlag = { id: "f", key: "new.dashboard", name: "Yangi", enabled: false, rules: [], createdAt: NOW, updatedAt: NOW, updatedBy: "A", history: [] } as unknown as FeatureFlag;
  it("rollout chelagi barqaror va 0–99", () => {
    const a = rolloutBucket("k", "c1");
    expect(a).toBe(rolloutBucket("k", "c1"));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });
  it("kompaniya qoidasi tarif qoidasidan ustun; muddati o‘tgan flag o‘chiq", () => {
    const f = { ...flag, rules: [{ scope: "PLAN", ids: ["pro"], enabled: true }, { scope: "COMPANY", ids: ["c1"], enabled: false }] } as FeatureFlag;
    expect(evaluateFlag(f, { companyId: "c1", planId: "pro", now: NOW })).toBe(false);
    expect(evaluateFlag(f, { companyId: "c2", planId: "pro", now: NOW })).toBe(true);
    expect(evaluateFlag({ ...f, enabled: true, rules: [], expiresAt: "2026-01-01T00:00:00Z" } as FeatureFlag, { companyId: "c1", now: NOW })).toBe(false);
  });
  it("100% rollout — hammaga yoqiladi", () => {
    expect(evaluateFlag({ ...flag, rollout: 100 } as FeatureFlag, { companyId: "c5", now: NOW })).toBe(true);
  });
});

describe("sog‘liq bahosi va onboarding", () => {
  const base = { activeEmployees: 10, attendance7d: 60, workdays7d: 6, requests7d: 1000, errors7d: 0, bot: "RUNNING" as const, telegramLinked: 10, modulesAvailable: 10, modulesExpected: 10, onboardingPercent: 100, openIncidents: 0, failingWebhooks: 0 };
  it("to‘liq faol kompaniya — 100 va GOOD", () => {
    const h = healthScore(base);
    expect(h.score).toBe(100);
    expect(h.grade).toBe("GOOD");
  });
  it("xatolar va incidentlar bahoni pasaytiradi", () => {
    const h = healthScore({ ...base, errors7d: 100, openIncidents: 2, attendance7d: 0 });
    expect(h.components.reliability).toBe(0);
    expect(h.components.incidents).toBe(4);
    expect(h.grade).not.toBe("GOOD");
  });
  it("onboarding: haqiqiy faktlardan hisoblanadi, izoh — e’tibor talab qiladi", () => {
    const facts = { hasOwner: true, branches: 1, activeEmployees: 5, schedules: 1, employeesWithSchedule: 5, modulesEnabled: 10, modulesTotal: 16, bot: "RUNNING" as const, telegramLinked: 5, attendanceRecords: 3 };
    const done = onboardingSteps(facts);
    expect(done.steps.every((s) => s.status === "COMPLETED")).toBe(true);
    const partial = onboardingSteps({ ...facts, employeesWithSchedule: 2, notes: { branch: "Manzil xato" } });
    expect(partial.steps.find((s) => s.key === "schedules")?.status).toBe("IN_PROGRESS");
    expect(partial.steps.find((s) => s.key === "done")?.status).toBe("PENDING");
    expect(onboardingSteps({ ...facts, attendanceRecords: 0, notes: { attendance: "Telefonlar sozlanmagan" } }).steps.find((s) => s.key === "attendance")?.status).toBe("NEEDS_ATTENTION");
  });
});

describe("platforma RBAC", () => {
  it("rol berilmagan eski super admin — Owner (orqaga moslik)", () => {
    expect(platformRoleOf(undefined)).toBe("OWNER");
    expect(platformCan(undefined, "admins.manage")).toBe(true);
  });
  it("Analyst faqat o‘qiydi; Support moliyani ko‘rmaydi; Finance kompaniyani boshqarmaydi", () => {
    expect(platformCan("ANALYST", "analytics.read")).toBe(true);
    expect(platformPermissionsOf("ANALYST").some((p) => p.endsWith(".manage") || p.endsWith(".send"))).toBe(false);
    expect(platformCan("SUPPORT", "billing.read")).toBe(false);
    expect(platformCan("FINANCE", "companies.manage")).toBe(false);
    expect(platformCan("FINANCE", "billing.manage")).toBe(true);
  });
  it("rol berish: o‘ziga yo‘q, yuqori rolni faqat Owner beradi", () => {
    expect(canAssignPlatformRole({ id: "o", platformRole: "OWNER" }, { id: "o", platformRole: "OWNER" }, "ADMIN")).toMatch(/O‘z/);
    expect(canAssignPlatformRole({ id: "a", platformRole: "ADMIN" }, { id: "s", platformRole: "SUPPORT" }, "OWNER")).toMatch(/Owner/);
    expect(canAssignPlatformRole({ id: "o", platformRole: "OWNER" }, { id: "s", platformRole: "SUPPORT" }, "ADMIN")).toBeNull();
    expect(canAssignPlatformRole({ id: "s", platformRole: "SUPPORT" }, null, "ANALYST")).toMatch(/huquqi/);
  });
});

describe("xavfsizlik yordamchilari", () => {
  it("token, parol, JWT, email va telefon yashiriladi", () => {
    const text = maskSecrets("bot123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA password=hunter2 user@mail.uz +998 90 123 45 67 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghij");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("user@mail.uz");
    expect(text).not.toContain("AAAAAAAA");
    expect(text).not.toContain("123 45 67");
    expect(text).toContain("[jwt]");
  });
  it("SSRF: xususiy, lokal va metadata manzillar taqiqlanadi", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.5", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "100.64.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(webhookUrlError("http://example.com/hook")).toMatch(/https/);
    expect(webhookUrlError("https://localhost/hook")).toMatch(/Lokal/);
    expect(webhookUrlError("https://10.0.0.1/hook")).toMatch(/Xususiy/);
    expect(webhookUrlError("https://user:pass@example.com/")).toMatch(/login/);
    expect(webhookUrlError("https://hooks.example.com/staffora")).toBeNull();
  });
});

describe("modul siyosati (global → override → kompaniya → tarif)", () => {
  it("global o‘chirish hamma narsadan ustun", () => {
    expect(moduleDecision({ payroll: true }, "payroll", { global: { payroll: { globalEnabled: false } }, overrides: { payroll: { enabled: true } } }).reason).toBe("GLOBAL_OFF");
  });
  it("vaqtinchalik override muddati tugagach kompaniya sozlamasiga qaytadi", () => {
    const policy = { overrides: { payroll: { enabled: true, expiresAt: "2026-10-01T00:00:00Z" } }, now: NOW };
    expect(moduleDecision({ payroll: false }, "payroll", policy).reason).toBe("COMPANY_OFF");
    expect(moduleDecision({ payroll: false }, "payroll", { ...policy, now: "2026-09-01T00:00:00Z" }).enabled).toBe(true);
  });
  it("tarifga kirmagan modul o‘chadi; tarifsiz kompaniya — avvalgidek", () => {
    expect(effectiveDisabledModules({ modules: {} }, { planModules: ["calendar"] })).toContain("payroll");
    expect(effectiveDisabledModules({ modules: {} }, {})).toEqual([]);
  });
  it("bog‘liqlik: avans/moliya ish haqisiz yoqilmaydi", () => {
    const issues = dependencyIssues({ payroll: false, advances: true });
    expect(issues.find((i) => i.key === "advances")?.needs).toEqual(["payroll"]);
    expect(issues.find((i) => i.key === "payroll")?.requiredBy).toContain("advances");
  });
});
