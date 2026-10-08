import type { Database, Employee } from "./types";
import { dateParts } from "./format";
import { NEXT_DAY_MAX_MINUTES } from "./attendance";
import { addDays, clockMinutes, clockOnShiftDay, DAY_MINUTES, isOvernight, shiftMinutes } from "./shift-time";

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

type Indexable = Pick<Database, "schedules" | "scheduleOverrides"> & { holidays?: Database["holidays"] };

const overrideIndex = new WeakMap<Database["scheduleOverrides"], Map<string, Database["scheduleOverrides"][number]>>();
function overrideFor(db: Indexable, employeeId: string, date: string) {
  let index = overrideIndex.get(db.scheduleOverrides);
  if (!index || index.size !== db.scheduleOverrides.length) {
    index = new Map(db.scheduleOverrides.map((o) => [`${o.employeeId}|${o.date}`, o]));
    overrideIndex.set(db.scheduleOverrides, index);
  }
  return index.get(`${employeeId}|${date}`);
}

type PlanEmployee = Pick<Employee, "id" | "scheduleId"> & { restDays?: number[]; companyId?: string; branchId?: string };

/** Kompaniya bayrami (dam olish kuni) — shu xodimning filialiga tegishlimi. */
export function holidayFor(db: { holidays?: Database["holidays"] }, employee: { companyId?: string; branchId?: string }, date: string) {
  if (!db.holidays?.length || !employee.companyId) return undefined;
  return db.holidays.find(
    (h) => h.date === date && h.dayOff && h.companyId === employee.companyId && (!h.branchIds?.length || Boolean(employee.branchId && h.branchIds.includes(employee.branchId))),
  );
}

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
  // Bayram (kompaniya kalendari) — ish kuni emas (alohida «ishlaydi» o‘zgarishi bo‘lsa, yuqorida ustun).
  const holiday = holidayFor(db, employee, date);
  if (holiday) return { enabled: false, start: hours.start, end: hours.end, graceMinutes, overridden: false, reason: holiday.title };
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

/* ---------------------------------------------- kechasi tugaydigan smena --- */

type Attendances = Pick<Database, "attendance">;
const attendanceIndex = new WeakMap<Database["attendance"], Map<string, Database["attendance"][number]>>();
function attendanceOn(db: Attendances, employeeId: string, date: string) {
  let index = attendanceIndex.get(db.attendance);
  if (!index || index.size !== db.attendance.length) {
    index = new Map(db.attendance.map((a) => [`${a.employeeId}|${a.date}`, a]));
    attendanceIndex.set(db.attendance, index);
  }
  return index.get(`${employeeId}|${date}`);
}

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T12:00:00Z`) / 86_400_000);

/**
 * Kelishdan beri o‘tgan daqiqa: `date` kuni `clock` paytida, davomat qaydi esa
 * o‘z ish kuniga (smena boshlangan kunga) tegishli. Kechki smenada ham to‘g‘ri:
 * Dushanba 14:00 kelgan, Seshanba 00:05 da — 605.
 */
export function minutesSinceCheckIn(record: Pick<Database["attendance"][number], "date" | "checkIn" | "scheduledStart" | "scheduledEnd">, date: string, clock: string) {
  if (!record.checkIn) return 0;
  const arrived = clockOnShiftDay(record.checkIn, record.scheduledStart, record.scheduledEnd);
  return (dayNumber(date) - dayNumber(record.date)) * DAY_MINUTES + clockMinutes(clock) - arrived;
}

/**
 * Hozirgi payt (kalendar sanasi + soat) qaysi ish kunining smenasiga tegishli.
 * Smena — boshlangan kuniga: Dushanba 14:00 → Seshanba 00:00 smenasidagi
 * Seshanba 00:05 dagi ketish Dushanba qaydiga yoziladi.
 *  - kechagi qayd ochiq (kelgan, ketmagan) va smena hali «tirik» bo‘lsa — kecha;
 *  - kechagi smena yarim tundan o‘tadi, xodim hali kelmagan va tugash vaqti
 *    o‘tmagan bo‘lsa (22:00 → 06:00, 01:00 da keldi) — kecha (kechikish bilan);
 *  - aks holda — bugun.
 */
export function shiftDateAt(db: Indexable & Attendances, employee: PlanEmployee, date: string, clock: string) {
  if (attendanceOn(db, employee.id, date)?.checkIn) return date;
  const previous = addDays(date, -1);
  const open = attendanceOn(db, employee.id, previous);
  if (open?.checkIn) {
    if (open.checkOut) return date;
    const since = minutesSinceCheckIn(open, date, clock);
    const alive = Math.min(NEXT_DAY_MAX_MINUTES, Math.max(shiftMinutes(open.scheduledStart, open.scheduledEnd), 8 * 60) + 6 * 60);
    return since > 0 && since <= alive ? previous : date;
  }
  const plan = dayPlan(db, employee, previous);
  if (plan.enabled && isOvernight(plan.start, plan.end) && clockMinutes(clock) < clockMinutes(plan.end)) return previous;
  return date;
}
