import { dateParts } from "./format";

/*
 * Muammoli trendlar: xodimning oxirgi 4 haftasidagi davomatdan rahbar e’tiboriga
 * arziydigan qonuniyatlarni topadi. Sof funksiya — server ham, testlar ham ishlatadi.
 */

export type TrendDay = {
  date: string;
  /** Rejadagi ish kuni (ta’til va dam olish emas). */
  workday: boolean;
  checkIn?: string;
  lateMinutes?: number;
  earlyLeaveMinutes?: number;
  flagged?: boolean;
};
export type TrendKind = "WEEKDAY_LATE" | "LATE_RISING" | "ABSENCES" | "FLAGS" | "EARLY_LEAVE";
export type TrendAlert = { kind: TrendKind; severity: 1 | 2 | 3; text: string };

const WEEKDAYS = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function detectTrends(days: TrendDay[], today: string): TrendAlert[] {
  const past = days.filter((d) => d.date < today && daysBetween(d.date, today) <= 28);
  const recent = past.filter((d) => daysBetween(d.date, today) <= 14);
  const before = past.filter((d) => daysBetween(d.date, today) > 14);
  const isLate = (d: TrendDay) => Boolean(d.checkIn && (d.lateMinutes || 0) > 0);
  const alerts: TrendAlert[] = [];

  // 1) Ma’lum hafta kunida qayta-qayta kechikish.
  const byWeekday = new Map<number, number>();
  for (const d of past.filter(isLate)) {
    const weekday = dateParts(d.date).weekday;
    byWeekday.set(weekday, (byWeekday.get(weekday) || 0) + 1);
  }
  const [weekday, count] = [...byWeekday.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (weekday !== undefined && count >= 3)
    alerts.push({ kind: "WEEKDAY_LATE", severity: count >= 4 ? 3 : 2, text: `Oxirgi 4 haftada ${WEEKDAYS[weekday]} kunlari ${count} marta kechikdi` });

  // 2) Kechikishlar ko‘paymoqda.
  const lateRecent = recent.filter(isLate).length;
  const lateBefore = before.filter(isLate).length;
  if (lateRecent >= 3 && lateRecent >= lateBefore + 3)
    alerts.push({ kind: "LATE_RISING", severity: lateRecent >= 6 ? 3 : 2, text: `Kechikishlar ko‘paydi: oldingi 2 haftada ${lateBefore}, oxirgi 2 haftada ${lateRecent}` });

  // 3) Sababsiz kelmaslik.
  const absent = recent.filter((d) => d.workday && !d.checkIn).length;
  if (absent >= 2) alerts.push({ kind: "ABSENCES", severity: absent >= 4 ? 3 : 2, text: `Oxirgi 2 haftada ${absent} kun sababsiz kelmadi` });

  // 4) Erta ketish odatga aylangan.
  const early = recent.filter((d) => (d.earlyLeaveMinutes || 0) >= 15).length;
  if (early >= 3) alerts.push({ kind: "EARLY_LEAVE", severity: 1, text: `Oxirgi 2 haftada ${early} marta ishdan erta ketdi` });

  // 5) Shubhali belgilar (GPS / qurilma).
  const flags = past.filter((d) => d.flagged).length;
  if (flags >= 2) alerts.push({ kind: "FLAGS", severity: flags >= 4 ? 3 : 2, text: `${flags} ta shubhali belgi (GPS yoki qurilma)` });

  return alerts.sort((a, b) => b.severity - a.severity);
}
