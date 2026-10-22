import type { Company } from "./types";

/*
 * Modullar — super admin har bir kompaniya uchun funksiyalarni yoqadi/o‘chiradi.
 * O‘chirilgan modul: panel menyusida, sozlamalar tablarida, Mini App’da ko‘rinmaydi,
 * uning API yo‘llari 403 qaytaradi va fon ishlari (integratsiya, rasm kanali, hisobot) to‘xtaydi.
 *
 * Asosiy funksiyalar (bosh sahifa, xodimlar, keldi-ketdi, filiallar, grafiklar,
 * foydalanuvchilar, sozlamalar) modul emas — ular har doim ishlaydi.
 * `company.modules` da yozilmagan modul — yoqilgan (eski kompaniyalar o‘zgarishsiz qoladi).
 */

export type ModuleGroup = "attendance" | "people" | "money" | "comms" | "insight" | "channels";

export interface ModuleDef {
  key: string;
  label: string;
  description: string;
  group: ModuleGroup;
  /** Panel sahifalari (menyu va sahifa himoyasi). */
  pages?: string[];
  /** Sozlamalar sahifasidagi tablar. */
  settingsTabs?: string[];
  /** Panel API yo‘llari (/api dan keyingi qism, prefiks bo‘yicha). */
  api?: string[];
  /** Mini App / mobil ilova API yo‘llari. */
  mini?: string[];
  /** Bu modul ishlashi uchun yoqilgan bo‘lishi kerak bo‘lgan modullar (yoqish/o‘chirishda tekshiriladi). */
  dependsOn?: string[];
}

export const moduleGroups: Record<ModuleGroup, string> = {
  attendance: "Keldi-ketdi",
  people: "Xodimlar va tashkilot",
  money: "Moliya",
  comms: "Aloqa",
  insight: "Tahlil va nazorat",
  channels: "Kanallar va integratsiya",
};

export const MODULES = [
  { key: "workspace", label: "Ish stoli va tasdiqlashlar", description: "Kunlik vazifalar va yagona tasdiqlash qutisi", group: "attendance", pages: ["/workspace", "/inbox"] },
  { key: "map", label: "Xarita", description: "Xodimlar va filiallar xaritada", group: "attendance", pages: ["/map"] },
  { key: "calendar", label: "Kalendar", description: "Davomat, ta’til va bayramlar kalendari", group: "attendance", pages: ["/calendar"], api: ["/calendar"] },
  {
    key: "attendanceRequests",
    label: "Belgilash so‘rovlari",
    description: "Xodimning davomatni tuzatish va dam olish kunini almashtirish so‘rovlari",
    group: "attendance",
    pages: ["/attendance-requests"],
    api: ["/attendance-corrections", "/dayoff-moves"],
    mini: ["/mini/corrections", "/mini/dayoff-moves"],
  },
  { key: "leave", label: "Ta’til va yo‘qlik", description: "Ta’til, kasallik va javob so‘rovlari", group: "people", pages: ["/leave"], api: ["/leave", "/leave-balances"], mini: ["/mini/leave", "/mini/leave-balance"] },
  { key: "registrations", label: "Arizalar (botdagi anketa)", description: "Nomzodlar kompaniya botida anketa to‘ldiradi, HR tasdiqlaydi", group: "people", pages: ["/registrations"], api: ["/registrations", "/company/registration-form"] },
  { key: "assets", label: "Aktivlar", description: "Xodimlarga berilgan qurilma va jihozlar", group: "people", pages: ["/assets"], api: ["/assets"] },
  { key: "payroll", label: "Ish haqi va tabel", description: "Oylik hisoblash, qaydnoma, tabel, hisob varaqlari", group: "money", pages: ["/payroll", "/timesheet"], settingsTabs: ["payroll"], api: ["/payroll"], mini: ["/mini/payslips"] },
  { key: "finance", label: "Moliya xulosasi", description: "Oylik xarajatlar va moliyaviy ko‘rsatkichlar", group: "money", pages: ["/finance"], api: ["/finance"], dependsOn: ["payroll"] },
  { key: "advances", label: "Avanslar", description: "Xodim avans so‘raydi, moliya tasdiqlaydi", group: "money", pages: ["/advances"], api: ["/advances"], mini: ["/mini/advances", "/mini/payout-card"], dependsOn: ["payroll"] },
  { key: "fines", label: "Jarimalar", description: "Kechikish va qoidabuzarlik jarimalari", group: "money", pages: ["/fines"], api: ["/fines"] },
  { key: "rewards", label: "Rag‘batlantirish", description: "Vaqtida kelganlarga bonus va mukofotlar", group: "money", pages: ["/rewards"], api: ["/rewards"] },
  { key: "announcements", label: "E’lonlar", description: "Xodimlarga e’lon va tasdiqlash so‘rovi", group: "comms", pages: ["/announcements"], api: ["/announcements", "/quick-announce"] },
  { key: "helpdesk", label: "Murojaatlar", description: "Xodim murojaatlari va ma’lumotnoma so‘rovlari", group: "comms", pages: ["/helpdesk"], api: ["/tickets", "/certificates"], mini: ["/mini/tickets", "/mini/certificates"] },
  { key: "reports", label: "Hisobotlar", description: "Excel/CSV hisobotlar", group: "insight", pages: ["/reports"], api: ["/reports"] },
  { key: "analytics", label: "Tahlil", description: "Trendlar, reyting va grafiklar", group: "insight", pages: ["/analytics"], api: ["/analytics"] },
  { key: "audit", label: "Audit jurnali", description: "Kim, qachon, nimani o‘zgartirgani", group: "insight", pages: ["/audit"], api: ["/audit"] },
  { key: "reportDigest", label: "Avtomatik hisobot", description: "Rahbarlarga haftalik/oylik Telegram hisobot", group: "insight", settingsTabs: ["reports"], api: ["/company/report-digest", "/reports/digest"], dependsOn: ["reports"] },
  { key: "telegramBot", label: "Kompaniya Telegram boti", description: "Kompaniyaning o‘z boti: ro‘yxatdan o‘tish, xabarlar, Mini App", group: "channels", settingsTabs: ["regbot"], api: ["/company/bot"] },
  { key: "photoChannel", label: "Rasm kanali", description: "Keldi-ketdi rasmlari Telegram kanalga", group: "channels", settingsTabs: ["channel"], api: ["/company/photo-channel"] },
  { key: "mobileApp", label: "Mobil ilova", description: "Xodimlar uchun Android/iOS ilova", group: "channels", settingsTabs: ["apps"], api: ["/mobile-devices"], mini: ["/mini/mobile"] },
  { key: "integrations", label: "Integratsiyalar", description: "Xodimlar boti (HR bot) bilan sinxronlash", group: "channels", settingsTabs: ["integrations"], api: ["/integrations"] },
] as const satisfies readonly ModuleDef[];

export type ModuleKey = (typeof MODULES)[number]["key"];
export type ModuleState = Partial<Record<ModuleKey, boolean>>;

const byKey = new Map<string, ModuleDef>(MODULES.map((m) => [m.key, m]));
export const moduleByKey = (key: string) => byKey.get(key);
export const isModuleKey = (key: string): key is ModuleKey => byKey.has(key);

/** Tayyor to‘plamlar — super admin bir bosishda qo‘llaydi. */
export const MODULE_PRESETS: { key: string; label: string; description: string; enabled: ModuleKey[] | "all" }[] = [
  { key: "all", label: "To‘liq", description: "Barcha modullar", enabled: "all" },
  {
    key: "standard",
    label: "Standart",
    description: "Davomat, ta’til, ish haqi, e’lonlar, hisobotlar",
    enabled: ["workspace", "calendar", "attendanceRequests", "leave", "registrations", "payroll", "advances", "fines", "announcements", "reports", "analytics", "audit", "reportDigest", "telegramBot", "mobileApp"],
  },
  { key: "basic", label: "Asosiy", description: "Faqat keldi-ketdi va xodimlar", enabled: ["calendar", "reports"] },
];

export function presetState(preset: (typeof MODULE_PRESETS)[number]): Record<ModuleKey, boolean> {
  return Object.fromEntries(MODULES.map((m) => [m.key, preset.enabled === "all" || preset.enabled.includes(m.key)])) as Record<ModuleKey, boolean>;
}

/** Modul yoqilganmi (yozilmagan — yoqilgan). */
export function moduleEnabled(modules: ModuleState | undefined, key: ModuleKey) {
  return modules?.[key] !== false;
}

/*
 * Amaldagi holat (Super Admin Control Center):
 *   1) global o‘chirilgan modul — hamma kompaniyada o‘chiq;
 *   2) muddati o‘tmagan kompaniya override’i (trial / vaqtinchalik kirish) — ustun;
 *   3) kompaniyaning o‘z holati (company.modules, false — o‘chiq);
 *   4) obunadagi tarif modullari (faqat obunasi bor kompaniyalarda; eski kompaniyalar o‘zgarmaydi).
 * Modul o‘chirilganda ma’lumot o‘chmaydi — qayta yoqilsa hammasi joyida.
 */
export type ModulePolicy = {
  global?: Record<string, { globalEnabled?: boolean } | undefined>;
  planModules?: readonly string[] | "all";
  overrides?: Record<string, { enabled: boolean; expiresAt?: string } | undefined>;
  now?: string;
};
export type ModuleReason = "ON" | "GLOBAL_OFF" | "OVERRIDE_ON" | "OVERRIDE_OFF" | "COMPANY_OFF" | "PLAN_EXCLUDED";

export function moduleDecision(modules: Partial<Record<string, boolean>> | undefined, key: string, policy: ModulePolicy = {}) {
  const now = policy.now || new Date().toISOString();
  if (policy.global?.[key]?.globalEnabled === false) return { enabled: false, reason: "GLOBAL_OFF" as ModuleReason };
  const override = policy.overrides?.[key];
  if (override && (!override.expiresAt || override.expiresAt > now))
    return { enabled: override.enabled, reason: (override.enabled ? "OVERRIDE_ON" : "OVERRIDE_OFF") as ModuleReason, expiresAt: override.expiresAt };
  if (modules?.[key] === false) return { enabled: false, reason: "COMPANY_OFF" as ModuleReason };
  if (policy.planModules && policy.planModules !== "all" && !policy.planModules.includes(key)) return { enabled: false, reason: "PLAN_EXCLUDED" as ModuleReason };
  return { enabled: true, reason: "ON" as ModuleReason };
}

/** Amaldagi o‘chirilgan modullar (panel, Mini App va API himoyasi shu ro‘yxat bo‘yicha). */
export function effectiveDisabledModules(company: Pick<Company, "modules"> | null | undefined, policy: ModulePolicy = {}): ModuleKey[] {
  if (!company) return [];
  return MODULES.filter((m) => !moduleDecision(company.modules, m.key, policy).enabled).map((m) => m.key);
}

/**
 * Bog‘liqliklar: yoqilayotgan modulning talablari va o‘chirilayotgan modulga bog‘liqlar.
 * Natija — qo‘shimcha yoqilishi/o‘chirilishi kerak bo‘lgan modullar (xabar uchun).
 */
export function dependencyIssues(next: Partial<Record<string, boolean>>) {
  const issues: { key: string; needs: string[]; requiredBy: string[] }[] = [];
  for (const m of MODULES as readonly ModuleDef[]) {
    const on = next[m.key] !== false;
    const needs = on ? (m.dependsOn || []).filter((d) => next[d] === false) : [];
    const requiredBy = !on ? (MODULES as readonly ModuleDef[]).filter((x) => x.dependsOn?.includes(m.key) && next[x.key] !== false).map((x) => x.key) : [];
    if (needs.length || requiredBy.length) issues.push({ key: m.key, needs, requiredBy });
  }
  return issues;
}

/** O‘chirilgan modullar ro‘yxati (frontendga shu ko‘rinishda beriladi). */
export function disabledModules(company?: Pick<Company, "modules"> | null): ModuleKey[] {
  if (!company?.modules) return [];
  return MODULES.filter((m) => company.modules![m.key] === false).map((m) => m.key);
}

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

function ownerOf(path: string, field: "pages" | "api" | "mini" | "settingsTabs") {
  // Eng uzun mos prefiks (masalan, /reports/digest → reportDigest, /reports → reports).
  let best: { key: ModuleKey; length: number } | undefined;
  for (const m of MODULES as readonly ModuleDef[]) {
    for (const prefix of m[field] || []) {
      const hit = field === "settingsTabs" ? path === prefix : matches(path, prefix);
      if (hit && (!best || prefix.length > best.length)) best = { key: m.key as ModuleKey, length: prefix.length };
    }
  }
  return best?.key;
}

export const pageModule = (path: string) => ownerOf(path, "pages");
export const apiModule = (path: string) => ownerOf(path, "api");
export const miniModule = (path: string) => ownerOf(path, "mini");
export const settingsTabModule = (tab: string) => ownerOf(tab, "settingsTabs");

/** Sahifa shu kompaniyada ochiladimi (modul bo‘yicha; rol tekshiruvi alohida). */
export function pageEnabled(disabled: readonly string[] | undefined, path: string) {
  const key = pageModule(path);
  return !key || !disabled?.includes(key);
}
