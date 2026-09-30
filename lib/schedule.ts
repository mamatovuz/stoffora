import type { Database, Employee } from "./types";
import { dateParts } from "./format";

/*
 * Xodimning ma’lum kundagi ish rejasi. Avval o‘sha kunga grafik o‘zgarishi
 * (smena almashish) qaraladi, bo‘lmasa odatiy haftalik grafik.
 * Kechikish, kelmaslik, ushlanma, eslatmalar — hammasi shu funksiyadan foydalanadi.
 */
export type DayPlan = { enabled: boolean; start: string; end: string; graceMinutes: number; overridden: boolean; reason?: string };

type Indexable = Pick<Database, "schedules" | "scheduleOverrides">;

const overrideIndex = new WeakMap<Database["scheduleOverrides"], Map<string, Database["scheduleOverrides"][number]>>();
function overrideFor(db: Indexable, employeeId: string, date: string) {
  let index = overrideIndex.get(db.scheduleOverrides);
  if (!index || index.size !== db.scheduleOverrides.length) {
    index = new Map(db.scheduleOverrides.map((o) => [`${o.employeeId}|${o.date}`, o]));
    overrideIndex.set(db.scheduleOverrides, index);
  }
  return index.get(`${employeeId}|${date}`);
}

export function dayPlan(db: Indexable, employee: Pick<Employee, "id" | "scheduleId">, date: string): DayPlan {
  const schedule = db.schedules.find((s) => s.id === employee.scheduleId);
  const graceMinutes = schedule?.graceMinutes || 0;
  const override = overrideFor(db, employee.id, date);
  const weekly = schedule?.days.find((d) => d.day === dateParts(date).weekday);
  if (override) {
    return {
      enabled: override.working,
      start: override.start || weekly?.start || "09:00",
      end: override.end || weekly?.end || "18:00",
      graceMinutes,
      overridden: true,
      reason: override.reason,
    };
  }
  return {
    enabled: Boolean(weekly?.enabled),
    start: weekly?.start || "09:00",
    end: weekly?.end || "18:00",
    graceMinutes,
    overridden: false,
  };
}

/** Oydagi rejalashtirilgan ish kunlari (kunlik stavka uchun). */
export function workingDaysInMonth(db: Indexable, employee: Pick<Employee, "id" | "scheduleId">, month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= last; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (dayPlan(db, employee, date).enabled) count += 1;
  }
  return count;
}
