/*
 * Kompaniya onboardingi — 9 qadam, holat faqat haqiqiy ma’lumotdan hisoblanadi.
 * Progress = bajarilgan qadamlar / 9 (oxirgi qadam — qolgan 8 tasi bajarilganda).
 */

export type StepStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "NEEDS_ATTENTION";
export type OnboardingFacts = {
  hasOwner: boolean;
  branches: number;
  activeEmployees: number;
  schedules: number;
  /** Grafik biriktirilgan faol xodimlar. */
  employeesWithSchedule: number;
  /** Yoqilgan modullar soni / jami. */
  modulesEnabled: number;
  modulesTotal: number;
  /** Kompaniya boti: yo‘q | ishlayapti | xato. */
  bot: "NONE" | "RUNNING" | "ERROR" | "STOPPED";
  telegramLinked: number;
  attendanceRecords: number;
  /** Administrator izohlari (qadam → «e’tibor talab qiladi» sababi). */
  notes?: Record<string, string>;
};

export const ONBOARDING_STEPS = [
  { key: "created", label: "Kompaniya yaratildi" },
  { key: "owner", label: "Rahbar tayinlandi" },
  { key: "branch", label: "Filial qo‘shildi" },
  { key: "employees", label: "Xodimlar qo‘shildi" },
  { key: "schedules", label: "Ish grafiklari sozlandi" },
  { key: "modules", label: "Modullar yoqildi" },
  { key: "telegram", label: "Telegram integratsiyasi tekshirildi" },
  { key: "attendance", label: "Birinchi davomat qayd etildi" },
  { key: "done", label: "Onboarding yakunlandi" },
] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"];

export function onboardingSteps(f: OnboardingFacts) {
  const status: Record<OnboardingStepKey, { status: StepStatus; detail: string }> = {
    created: { status: "COMPLETED", detail: "" },
    owner: f.hasOwner ? { status: "COMPLETED", detail: "" } : { status: "NEEDS_ATTENTION", detail: "Kompaniya egasi (login) yo‘q" },
    branch: f.branches > 0 ? { status: "COMPLETED", detail: `${f.branches} ta filial` } : { status: "PENDING", detail: "Filial qo‘shilmagan" },
    employees: f.activeEmployees > 0 ? { status: "COMPLETED", detail: `${f.activeEmployees} ta faol xodim` } : { status: "PENDING", detail: "Xodim yo‘q" },
    schedules:
      f.schedules === 0
        ? { status: "PENDING", detail: "Ish grafigi yo‘q" }
        : f.activeEmployees > 0 && f.employeesWithSchedule < f.activeEmployees
          ? { status: "IN_PROGRESS", detail: `${f.employeesWithSchedule}/${f.activeEmployees} xodimga grafik biriktirilgan` }
          : { status: "COMPLETED", detail: `${f.schedules} ta grafik` },
    modules: f.modulesEnabled > 0 ? { status: "COMPLETED", detail: `${f.modulesEnabled}/${f.modulesTotal} modul yoqilgan` } : { status: "NEEDS_ATTENTION", detail: "Barcha modullar o‘chiq" },
    telegram:
      f.bot === "ERROR"
        ? { status: "NEEDS_ATTENTION", detail: "Kompaniya botida xato" }
        : f.telegramLinked > 0
          ? f.activeEmployees > 0 && f.telegramLinked < f.activeEmployees
            ? { status: "IN_PROGRESS", detail: `${f.telegramLinked}/${f.activeEmployees} xodim Telegram’ga ulangan` }
            : { status: "COMPLETED", detail: `${f.telegramLinked} xodim ulangan` }
          : { status: "PENDING", detail: "Hech kim Telegram’ga ulanmagan" },
    attendance: f.attendanceRecords > 0 ? { status: "COMPLETED", detail: `${f.attendanceRecords} ta qayd` } : { status: "PENDING", detail: "Hali davomat yo‘q" },
    done: { status: "PENDING", detail: "" },
  };
  for (const [key, note] of Object.entries(f.notes || {}))
    if (note && key in status && status[key as OnboardingStepKey].status !== "COMPLETED")
      status[key as OnboardingStepKey] = { status: "NEEDS_ATTENTION", detail: note };
  const before = ONBOARDING_STEPS.slice(0, -1).every((s) => status[s.key].status === "COMPLETED");
  status.done = before ? { status: "COMPLETED", detail: "" } : { status: "PENDING", detail: "" };
  const steps = ONBOARDING_STEPS.map((s) => ({ key: s.key, label: s.label, ...status[s.key] }));
  const completed = steps.filter((s) => s.status === "COMPLETED").length;
  return {
    steps,
    completed,
    total: steps.length,
    percent: Math.round((completed / steps.length) * 100),
    attention: steps.filter((s) => s.status === "NEEDS_ATTENTION").length,
  };
}
