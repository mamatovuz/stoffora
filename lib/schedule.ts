import type { Database, Employee } from "./types";
import { dateParts } from "./format";

/*
 * Xodimning ma’lum kundagi ish rejasi. Avval o‘sha kunga grafik o‘zgarishi
 * (smena almashish, dam kunini ko‘chirish) qaraladi, keyin xodimning shaxsiy dam
 * olish kunlari, bo‘lmasa odatiy haftalik grafik.
 * Kechikish, kelmaslik, ushlanma, eslatmalar — hammasi shu funksiyadan foydalanadi.
 */
export type DayPlan = {
  enabled: boolean;
  start: string;
  end: string;
  graceMinutes: number;
  overridden: boolean;
  reason?: string;
  /** Xodimning shaxsiy dam olish kuni (grafik bo‘yicha ish kuni bo‘lsa ham). */
  personalRest?: boolean;
};

const DEFAULT_START = "09:00";
const DEFAULT_END = "18:00";

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

type PlanEmployee = Pick<Employee, "id" | "scheduleId"> & { restDays?: number[] };

/** Grafikning shu hafta kunidagi vaqti; o‘sha kun yopiq bo‘lsa — boshqa ish kunining vaqti. */
export function weeklyHours(schedule: Database["schedules"][number] | undefined, weekday: number) {
  const own = schedule?.days.find((d) => d.day === weekday);
  const any = schedule?.days.find((d) => d.enabled);
  return { start: own?.start || any?.start || DEFAULT_START, end: own?.end || any?.end || DEFAULT_END };
}

export function dayPlan(db: Indexable, employee: PlanEmployee, date: string): DayPlan {
  const schedule = db.schedules.find((s) => s.id === employee.scheduleId);
  const graceMinutes = schedule?.graceMinutes || 0;
  const weekday = dateParts(date).weekday;
  const override = overrideFor(db, employee.id, date);
  const weekly = schedule?.days.find((d) => d.day === weekday);
  const hours = weeklyHours(schedule, weekday);
  if (override) {
    return {
      enabled: override.working,
      start: override.start || hours.start,
      end: override.end || hours.end,
      graceMinutes,
      overridden: true,
      reason: override.reason,
    };
  }
  if (employee.restDays?.includes(weekday))
    return { enabled: false, start: hours.start, end: hours.end, graceMinutes, overridden: false, reason: "Shaxsiy dam olish kuni", personalRest: true };
  return {
    enabled: Boolean(weekly?.enabled),
    start: weekly?.start || DEFAULT_START,
    end: weekly?.end || DEFAULT_END,
    graceMinutes,
    overridden: false,
  };
}

/** Oydagi rejalashtirilgan ish kunlari (kunlik stavka uchun). */
export function workingDaysInMonth(db: Indexable, employee: PlanEmployee, month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= last; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (dayPlan(db, employee, date).enabled) count += 1;
  }
  return count;
}
