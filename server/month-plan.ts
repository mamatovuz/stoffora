import { tashkentClock, tashkentIsoDate } from "../lib/format";
import type { Database, Employee } from "../lib/types";
import { historyMonth } from "./history";

/*
 * Xodimning oylik rejasi va haqiqati («Grafigim»): har kun uchun grafik (reja), keldi-ketdi (fakt),
 * kechikish / erta ketish / ishlangan vaqt va kunning yakuniy holati.
 * Kun holati davomat tarixi bilan bir xil manbadan (historyMonth) olinadi — kalendar va grafik farq qilmaydi.
 */

export type DayState =
  /** Reja (bugun yoki kelajak, hali belgi yo‘q). */
  | "PLANNED"
  | "ON_TIME"
  | "LATE"
  /** Hozir ishda (smena davom etmoqda). */
  | "IN"
  /** Keldi, lekin ketishni belgilamadi (smena tugagan). */
  | "NO_CHECKOUT"
  | "ABSENT"
  | "REST"
  /** Dam olish kunida ishladi. */
  | "REST_WORKED"
  | "LEAVE"
  /** Ishga kirishidan yoki hisob boshlanishidan oldingi kun. */
  | "BEFORE_START";

const STATE: Record<ReturnType<typeof historyMonth>["days"][number]["tone"], DayState> = {
  ontime: "ON_TIME",
  late: "LATE",
  absent: "ABSENT",
  leave: "LEAVE",
  off: "REST",
  future: "PLANNED",
  working: "IN",
  restwork: "REST_WORKED",
  none: "BEFORE_START",
};

export function monthPlan(db: Database, employee: Employee, month: string, today = tashkentIsoDate(), clock = tashkentClock()) {
  const history = historyMonth(db, employee, month, today, clock);
  const days = history.days.map(({ tone, noCheckout, ...day }) => ({
    ...day,
    state: noCheckout && tone !== "restwork" ? ("NO_CHECKOUT" as const) : STATE[tone],
  }));
  const planned = days.filter((d) => d.working);
  return {
    month,
    label: history.label,
    days,
    totals: {
      workdays: planned.length,
      // Kechki smena (14:00–00:00) ham to‘g‘ri — 10 soat.
      plannedMinutes: planned.reduce((sum, d) => sum + d.plannedMinutes, 0),
      leaveDays: days.filter((d) => d.leave).length,
    },
  };
}
