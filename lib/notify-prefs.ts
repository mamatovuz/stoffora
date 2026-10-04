/*
 * Bildirishnoma toifalari va xodim sozlamasi (push / Telegram). Ilova ichidagi ro‘yxatda
 * hammasi qoladi — o‘chirilgan toifa faqat telefonga «jiringlab» kelmaydi.
 * Xavfsizlik va majburiy tasdiqli e’lonlar o‘chirilmaydi.
 */
export const NOTIFY_CATEGORIES = {
  attendance: "Davomat va eslatmalar",
  requests: "So‘rovlar (ta’til, smena, belgilash)",
  money: "Ish haqi, avans, jarima, bonus",
  announcements: "E’lonlar va so‘rovnomalar",
  docs: "Hujjatlar muddati",
  celebrations: "Tug‘ilgan kunlar va tabriklar",
} as const;
export type NotifyCategory = keyof typeof NOTIFY_CATEGORIES;
export type NotifyPrefs = Partial<Record<NotifyCategory, boolean>>;

const BY_TYPE: Record<string, NotifyCategory> = {
  ATTENDANCE: "attendance",
  ATTENDANCE_REQUEST: "requests",
  LEAVE: "requests",
  SWAP: "requests",
  PAYROLL: "money",
  FINE: "money",
  BONUS: "money",
  ANNOUNCEMENT: "announcements",
  DOCUMENT: "docs",
  BIRTHDAY: "celebrations",
};
/** Bildirishnoma turi → toifa (noma’lum yoki xavfsizlik — null: har doim yuboriladi). */
export const categoryOfType = (type?: string): NotifyCategory | null => (type ? BY_TYPE[type] || null : null);

/** Integratsiya yo‘nalishi (notifyEmployee) → toifa. */
export const categoryOfRouting = (routing: string): NotifyCategory | null =>
  routing === "attendance" ? "attendance" : routing === "leave" ? "requests" : routing === "payroll" ? "money" : routing === "announcements" ? "announcements" : null;

/** Shu toifadagi xabar telefonga yuborilsinmi. Majburiy tasdiqli e’lon — doim. */
export function wantsPush(prefs: NotifyPrefs | undefined, category: NotifyCategory | null, important = false) {
  if (!category || important) return true;
  return prefs?.[category] !== false;
}
