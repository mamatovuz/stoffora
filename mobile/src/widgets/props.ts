import type { HomeData } from "@/lib/types";
import type { TodayProps } from "./types";

/*
 * Platformaga bog‘liq bo‘lmagan qism: bosh sahifa ma’lumotidan vidjet holatini tuzadi.
 * Yangilash — sync.ios.ts / sync.android.tsx / sync.ts (Metro platforma kengaytmasini tanlaydi).
 */
export function todayProps(home: HomeData): TodayProps {
  const a = home.attendance;
  const day = home.todayPlan;
  const working = Boolean(a?.checkIn && !a.checkOut);
  const finished = Boolean(a?.checkOut);
  const status = finished
    ? "Ish kuni yakunlandi"
    : working
      ? a?.lateMinutes
        ? `Ishdasiz · ${a.lateMinutes} daq kech`
        : "Ishdasiz"
      : home.todayLeave
        ? "Bugun ta’tildasiz"
        : !day?.enabled
          ? "Dam olish kuni"
          : "Hali kelmagansiz";
  return {
    date: new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10),
    status,
    checkIn: a?.checkIn || "",
    checkOut: a?.checkOut || "",
    shift: day?.enabled ? `${day.start}–${day.end}` : "Dam olish",
    action: finished || !home.branch ? "none" : working ? "out" : home.todayLeave || !day?.enabled ? "none" : "in",
  };
}
