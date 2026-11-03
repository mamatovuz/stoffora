import { LIVE } from "./timeline";
import { C } from "./theme";

// Demo company data. Every number on every card is derived from these few
// facts so the panel, phone and charts always agree with each other:
// 128 staff, 6 on leave → 122 expected today; 9 late; 5 absent.
export const TODAY = "28-oktabr, chorshanba";
export const COMPANY = "Navro‘z Savdo";
export const BRANCH = "Bosh ofis";

export type Status = "ok" | "late" | "leave" | "wait" | "absent";

export const STATUS: Record<Status, { label: string; dot: string; text: string; bg: string }> = {
  ok: { label: "Vaqtida", dot: C.ok, text: C.okText, bg: C.okBg },
  late: { label: "Kechikdi", dot: C.late, text: C.lateText, bg: C.lateBg },
  leave: { label: "Ta’tilda", dot: C.leave, text: C.leaveText, bg: C.leaveBg },
  wait: { label: "Kutilmoqda", dot: C.wait, text: C.waitText, bg: C.waitBg },
  absent: { label: "Kelmadi", dot: C.bad, text: C.badText, bg: C.badBg },
};

export const kpis = (f: number) => {
  const came = 115 + (f >= LIVE.bekzodKpi ? 1 : 0) + (f >= LIVE.kamolaIn ? 1 : 0);
  const total = 128;
  const leave = 6;
  const late = 9;
  const absent = 5;
  const expected = total - leave;
  return {
    total,
    came,
    late,
    leave,
    absent,
    onTime: came - late,
    waiting: expected - came - absent,
    expected,
    rate: Math.round((came / expected) * 100),
  };
};

const TINTS = [
  [C.brandSoft, C.brand],
  ["#EAF7F0", C.okText],
  [C.leaveBg, C.leaveText],
  [C.lateBg, C.lateText],
  ["#EEF2F6", C.ink2],
  ["#E8F4FB", "#0B6A99"],
] as const;

export type Employee = {
  name: string;
  role: string;
  initials: string;
  tint: readonly [string, string];
  time: (f: number) => string;
  status: (f: number) => Status;
};

const fixed = (t: string, s: Status) => ({ time: () => t, status: () => s });

export const EMPLOYEES: Employee[] = [
  { name: "Dilnoza Karimova", role: "HR menejer", initials: "DK", tint: TINTS[0], ...fixed("08:52", "ok") },
  { name: "Jasur Aliyev", role: "Sotuv menejeri", initials: "JA", tint: TINTS[3], ...fixed("08:21", "late") },
  { name: "Madina Yusupova", role: "Buxgalter", initials: "MY", tint: TINTS[2], ...fixed("08:47", "ok") },
  { name: "Sardor Rahimov", role: "Omborchi", initials: "SR", tint: TINTS[4], ...fixed("—", "leave") },
  {
    name: "Bekzod Tursunov",
    role: "Haydovchi",
    initials: "BT",
    tint: TINTS[5],
    time: (f) => (f >= LIVE.bekzodIn ? "08:57" : "—"),
    status: (f) => (f >= LIVE.bekzodIn ? "ok" : "wait"),
  },
  { name: "Nodira Saidova", role: "Dizayner", initials: "NS", tint: TINTS[1], ...fixed("08:55", "ok") },
];
export const BEKZOD_ROW = 4;

export type Activity = {
  time: string;
  name: string;
  initials: string;
  tint: readonly [string, string];
  what: string;
  via: string;
  kind: Status;
  at?: number; // frame it arrives (live events)
};

const BASE_ACTIVITY: Activity[] = [
  { time: "08:55", name: "Nodira Saidova", initials: "NS", tint: TINTS[1], what: "Ishga keldi", via: "Yuz orqali", kind: "ok" },
  { time: "08:52", name: "Dilnoza Karimova", initials: "DK", tint: TINTS[0], what: "Ishga keldi", via: "Yuz orqali", kind: "ok" },
  { time: "08:47", name: "Madina Yusupova", initials: "MY", tint: TINTS[2], what: "Ishga keldi", via: "QR-kod", kind: "ok" },
  { time: "08:21", name: "Jasur Aliyev", initials: "JA", tint: TINTS[3], what: "Kechikdi · 21 daq", via: "QR-kod", kind: "late" },
];

const LIVE_ACTIVITY: Activity[] = [
  { time: "08:57", name: "Bekzod Tursunov", initials: "BT", tint: TINTS[5], what: "Ishga keldi", via: "QR-kod", kind: "ok", at: LIVE.bekzodIn },
  { time: "08:58", name: "Kamola Ergasheva", initials: "KE", tint: TINTS[0], what: "Ishga keldi", via: "Yuz orqali", kind: "ok", at: LIVE.kamolaIn },
];

/** Newest first; live events are included once their frame has passed. */
export const activityAt = (f: number) => [
  ...LIVE_ACTIVITY.filter((a) => f >= (a.at ?? 0)).reverse(),
  ...BASE_ACTIVITY,
];

// Last 12 working days (Sundays off). Attendance = came / expected, late as a
// share of expected. Today's bar is live.
export const CHART_DAYS = ["15", "16", "17", "19", "20", "21", "22", "23", "24", "26", "27", "28"];
const RATE = [93, 95, 90, 96, 94, 97, 95, 93, 91, 96, 95];
const LATE = [5, 4, 7, 3, 5, 2, 4, 6, 7, 4, 5];
export const chartAt = (f: number) => {
  const k = kpis(f);
  return CHART_DAYS.map((d, i) => ({
    day: d,
    rate: i < RATE.length ? RATE[i] : k.rate,
    late: i < LATE.length ? LATE[i] : Math.round((k.late / k.expected) * 100),
    today: i === CHART_DAYS.length - 1,
  }));
};

export const PHONE_USER = {
  first: "Kamola",
  name: "Kamola Ergasheva",
  initials: "KE",
  role: "Kassir",
  shift: "09:00 – 18:00",
  checkIn: "08:58",
  distance: "24 m",
};
