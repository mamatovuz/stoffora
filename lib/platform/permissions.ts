import type { PlatformRole } from "./types";

/*
 * Platforma (Super Admin) rollari va ruxsatlar matritsasi — server va panel uchun yagona manba.
 * Ruxsat har doim serverda tekshiriladi; panel faqat tugma/sahifani yashiradi.
 */

export const PLATFORM_PERMISSIONS = {
  "dashboard.read": "Dashboard va KPI",
  "analytics.read": "Analitika va foydalanish statistikasi",
  "companies.read": "Kompaniyalarni ko‘rish",
  "companies.manage": "Kompaniyani tahrirlash, bloklash",
  "companies.create": "Kompaniya va demo yaratish",
  "companies.archive": "Arxivlash va tiklash",
  "companies.preview": "Kompaniya panelini ko‘rish (faqat o‘qish)",
  "companies.support": "Yordam kirishi (yozish huquqi bilan)",
  "users.read": "Foydalanuvchilarni ko‘rish",
  "users.manage": "Foydalanuvchi, rahbar, rol, bloklash",
  "sessions.manage": "Sessiyalarni bekor qilish",
  "subscriptions.read": "Tarif va obunalarni ko‘rish",
  "subscriptions.manage": "Obunani o‘zgartirish, limitlar",
  "plans.manage": "Tariflarni boshqarish",
  "billing.read": "Hisob-kitoblarni ko‘rish",
  "billing.manage": "Hisob-faktura va to‘lov holati",
  "promos.manage": "Promo kodlar",
  "contracts.read": "Shartnomalarni ko‘rish",
  "contracts.manage": "Shartnoma yuklash",
  "modules.manage": "Modullar va limitlar",
  "flags.manage": "Feature flaglar",
  "integrations.read": "Integratsiyalarni ko‘rish",
  "integrations.manage": "API kalit va webhooklar",
  "monitoring.read": "Monitoring, xatolar, ishlar",
  "incidents.manage": "Incident va xatolar holati",
  "jobs.manage": "Fon ishlarini qayta ishga tushirish",
  "backups.read": "Zaxira nusxalarni ko‘rish",
  "backups.manage": "Zaxira yaratish va yuklab olish",
  "notifications.read": "Bildirishnomalarni ko‘rish",
  "notifications.send": "Bildirishnoma va ommaviy xabar yuborish",
  "support.read": "Murojaatlarni ko‘rish",
  "support.manage": "Murojaatlarga javob berish",
  "security.read": "Xavfsizlik markazi",
  "audit.read": "Audit jurnali",
  "audit.export": "Audit va hisobot eksporti",
  "admins.manage": "Platforma administratorlari va rollar",
  "settings.read": "Global sozlamalarni ko‘rish",
  "settings.manage": "Global sozlamalar, tillar",
} as const;

export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;
const ALL = Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[];

export const PLATFORM_ROLES: Record<PlatformRole, { label: string; description: string; rank: number; permissions: PlatformPermission[] }> = {
  OWNER: { label: "Platform Owner", description: "Barcha huquqlar, administratorlarni boshqaradi", rank: 5, permissions: ALL },
  ADMIN: {
    label: "Platform Admin",
    description: "Kundalik boshqaruv; Owner huquqlarini bera olmaydi",
    rank: 4,
    // Zaxira faylini yuklab olish va yaratish — faqat Owner.
    permissions: ALL.filter((p) => p !== "backups.manage"),
  },
  SUPPORT: {
    label: "Support Agent",
    description: "Murojaatlar, kompaniya panelini ko‘rish, sessiyalar",
    rank: 2,
    permissions: [
      "dashboard.read",
      "companies.read",
      "companies.preview",
      "users.read",
      "sessions.manage",
      "support.read",
      "support.manage",
      "notifications.read",
      "monitoring.read",
      "integrations.read",
    ],
  },
  FINANCE: {
    label: "Finance Manager",
    description: "Tariflar, obunalar, hisob-kitob, promo, shartnomalar",
    rank: 2,
    permissions: [
      "dashboard.read",
      "analytics.read",
      "companies.read",
      "subscriptions.read",
      "subscriptions.manage",
      "plans.manage",
      "billing.read",
      "billing.manage",
      "promos.manage",
      "contracts.read",
      "contracts.manage",
      "audit.export",
    ],
  },
  ANALYST: {
    label: "Read-only Analyst",
    description: "Faqat ko‘rish: dashboard, analitika, monitoring",
    rank: 1,
    permissions: ["dashboard.read", "analytics.read", "companies.read", "subscriptions.read", "billing.read", "monitoring.read", "integrations.read"],
  },
};

export const platformRoleOf = (role: PlatformRole | undefined): PlatformRole => role || "OWNER";

export function platformCan(role: PlatformRole | undefined, permission: PlatformPermission) {
  return PLATFORM_ROLES[platformRoleOf(role)].permissions.includes(permission);
}

export const platformPermissionsOf = (role: PlatformRole | undefined) => PLATFORM_ROLES[platformRoleOf(role)].permissions;

/**
 * Administrator boshqa administratorga rol bera oladimi:
 *  - o‘ziga o‘zi rol bera olmaydi;
 *  - faqat o‘zidan past darajadagi rolni beradi (Owner — hammasini, Owner’ni ham);
 *  - o‘zidan yuqori yoki teng darajadagi administratorni o‘zgartira olmaydi (Owner bundan mustasno).
 */
export function canAssignPlatformRole(actor: { id: string; platformRole?: PlatformRole }, target: { id: string; platformRole?: PlatformRole } | null, next: PlatformRole) {
  const actorRole = platformRoleOf(actor.platformRole);
  if (!platformCan(actorRole, "admins.manage")) return "Administratorlarni boshqarish huquqi yo‘q.";
  if (target && target.id === actor.id) return "O‘z rolingizni o‘zgartira olmaysiz.";
  const actorRank = PLATFORM_ROLES[actorRole].rank;
  if (actorRole !== "OWNER" && PLATFORM_ROLES[next].rank >= actorRank) return "Bu rolni faqat Platform Owner bera oladi.";
  if (target && actorRole !== "OWNER" && PLATFORM_ROLES[platformRoleOf(target.platformRole)].rank >= actorRank)
    return "Bu administratorni faqat Platform Owner o‘zgartira oladi.";
  return null;
}
