import type { AttendanceFlag, BiometricDevice } from "./types";

/*
 * Mini App’ning sof (I/O siz) mantiqi — server ham, frontend ham, testlar ham ishlatadi.
 */

/* ------------------------------------------------------ chuqur havolalar --- */
/**
 * Bot xabaridagi tugma Mini App’ni kerakli bo‘limda ochadi:
 *   /mini-app?go=leave            — ta’til so‘rovlari
 *   t.me/<bot>/<app>?startapp=go_payslip_2026-09
 */
export type DeepLink =
  | { tab: "home"; action?: "checkin" | "checkout" | "salary" | "notifs" | "late" }
  | { tab: "history"; view?: "calendar" | "schedule" | "stats" }
  | { tab: "leave"; view?: "leave" | "swap" | "overtime" | "dayoff" | "marks"; id?: string }
  | { tab: "profile"; section?: "docs" | "payslips" | "settings" | "directory" | "helpdesk" | "birthdays"; id?: string }
  | { tab: "manager"; view?: "desk" | "today" | "requests" | "map" | "week" | "money" | "devices" | "ops" }
  | { tab: "work"; view: "tasks" | "checklist" | "incidents"; id?: string }
  | { tab: "learn"; view: "courses" | "kb" | "badge"; id?: string };

const MONTH = /^\d{4}-\d{2}$/;
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

export function parseDeepLink(raw?: string | null): DeepLink | null {
  if (!raw) return null;
  const value = raw.trim().replace(/^go[_-]/, "");
  if (!value || value.length > 80) return null;
  const [head, ...rest] = value.split("_");
  const tail = rest.join("_");
  const id = SAFE_ID.test(tail) ? tail : undefined;
  switch (head) {
    case "home":
      return { tab: "home" };
    case "checkin":
    case "checkout":
    case "salary":
    case "notifs":
    case "late":
      return { tab: "home", action: head };
    case "history":
    case "calendar":
      return { tab: "history", view: "calendar" };
    case "schedule":
      return { tab: "history", view: "schedule" };
    case "stats":
      return { tab: "history", view: "stats" };
    case "leave":
      return { tab: "leave", view: "leave", id };
    case "swap":
    case "swaps":
      return { tab: "leave", view: "swap", id };
    case "overtime":
      return { tab: "leave", view: "overtime", id };
    case "dayoff":
      return { tab: "leave", view: "dayoff", id };
    case "marks":
    case "correction":
      return { tab: "leave", view: "marks", id };
    case "docs":
      return { tab: "profile", section: "docs", id };
    case "payslip":
    case "payslips":
      return { tab: "profile", section: "payslips", id: tail && MONTH.test(tail) ? tail : undefined };
    case "settings":
    case "profile":
      return { tab: "profile", section: head === "settings" ? "settings" : undefined };
    case "directory":
      return { tab: "profile", section: "directory" };
    case "ticket":
    case "helpdesk":
    case "certificate":
      return { tab: "profile", section: "helpdesk", id };
    case "birthdays":
      return { tab: "profile", section: "birthdays" };
    case "manager":
      return { tab: "manager", view: tail === "requests" || tail === "map" || tail === "week" || tail === "money" || tail === "devices" || tail === "today" || tail === "ops" ? tail : "desk" };
    case "tasks":
    case "task":
      return { tab: "work", view: "tasks", id };
    case "checklist":
      return { tab: "work", view: "checklist" };
    case "incident":
    case "incidents":
      return { tab: "work", view: "incidents", id };
    case "course":
    case "courses":
      return { tab: "learn", view: "courses", id };
    case "kb":
      return { tab: "learn", view: "kb", id };
    case "badge":
      return { tab: "learn", view: "badge" };
    default:
      return null;
  }
}

/** Taklif kodi (bir martalik ulanish) emas, balki bo‘lim havolasi ekanini aniqlaydi. */
export const isDeepLinkParam = (raw?: string) => Boolean(raw && /^go[_-]/.test(raw));

/* --------------------------------------------------- vaqtida kelish seriyasi --- */
export type StreakDay = {
  date: string;
  /** Shu kun ish kuni bo‘lganmi (grafik + smena almashish, ta’til emas). */
  workday: boolean;
  checkIn?: string;
  lateMinutes?: number;
};

/**
 * Joriy seriya: oxirgi ish kunlaridan orqaga qarab — kelgan va kechikmagan kunlar.
 * Bugun hali kelinmagan bo‘lsa, bugun seriyani uzmaydi.
 * `days` — sanasi bo‘yicha o‘sish tartibida, oxirgisi bugun.
 */
export function attendanceStreak(days: StreakDay[], today: string) {
  let current = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const day = days[i];
    if (!day.workday) continue;
    if (day.date === today && !day.checkIn) continue;
    if (day.checkIn && !(day.lateMinutes || 0)) current += 1;
    else break;
  }
  let best = 0;
  let run = 0;
  for (const day of days) {
    if (!day.workday) continue;
    if (day.date === today && !day.checkIn) continue;
    if (day.checkIn && !(day.lateMinutes || 0)) {
      run += 1;
      best = Math.max(best, run);
    } else run = 0;
  }
  return { current, best };
}

/** Seriya uchun nishon (motivatsiya). */
export function streakBadge(streak: number) {
  if (streak >= 60) return { emoji: "🏆", label: "Afsona" };
  if (streak >= 30) return { emoji: "💎", label: "Bir oy vaqtida" };
  if (streak >= 20) return { emoji: "🔥", label: "Olovli seriya" };
  if (streak >= 10) return { emoji: "⭐", label: "Barqaror" };
  if (streak >= 5) return { emoji: "👍", label: "Yaxshi boshlanish" };
  return null;
}

/* ------------------------------------------------- qurilma (anti-spoof) --- */
export type MotionSample = {
  /** Olingan o‘lchovlar soni. */
  samples: number;
  /** Tezlanish o‘zgarishining maksimal farqi (m/s²). */
  spread: number;
  source?: "telegram" | "browser" | "native";
};

const DESKTOP_PLATFORMS = new Set(["tdesktop", "macos", "weba", "webk", "web", "unigram"]);

/**
 * Qurilma belgilari. Haqiqiy telefon qo‘lda (hatto stolda) ham sensor shovqini beradi;
 * emulyator yoki GPS soxtalashtiruvchi muhitda o‘lchovlar aynan bir xil bo‘ladi.
 * Belgi davomatni bloklamaydi — faqat HR ko‘rib chiqishi uchun.
 */
export function deviceFlags(input: { motion?: MotionSample; platform?: string; mocked?: boolean }): AttendanceFlag[] {
  const flags: AttendanceFlag[] = [];
  // Native ilova: Android «mock location» belgisi (OS beradi). Mijoz ma’lumoti — faqat belgi, qaror HR’da.
  if (input.mocked) flags.push("MOCK_LOCATION");
  const motion = input.motion;
  if (motion && motion.samples >= 10 && motion.spread === 0) flags.push("DEVICE_STILL");
  if (input.platform && DESKTOP_PLATFORMS.has(input.platform)) flags.push("DESKTOP");
  return flags;
}

/* --------------------------------------------------------- biometriya --- */
export const DEFAULT_FACE_EVERY = 5;
const FACE_MAX_AGE_MS = 7 * 86_400_000;

/**
 * Telefon biometriyasi bilan tasdiqlashga ruxsat bormi yoki bu safar yuz kerakmi.
 * `uses` — oxirgi yuz tekshiruvidan beri biometriya bilan qilingan belgilar soni.
 * Har N-belgida va oxirgi yuz tekshiruvidan 7 kun o‘tgan bo‘lsa — yuz majburiy.
 */
export function biometricNeedsFace(device: Pick<BiometricDevice, "uses" | "lastFaceAt">, faceEvery = DEFAULT_FACE_EVERY, now = Date.now()) {
  const every = Math.max(2, Math.min(50, Math.round(faceEvery) || DEFAULT_FACE_EVERY));
  if (now - new Date(device.lastFaceAt).getTime() > FACE_MAX_AGE_MS) return true;
  return device.uses >= every - 1;
}

/* --------------------------------------------------------- tanaffuslar --- */
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Tanaffuslarning jami davomiyligi (daqiqa); tugamagani `now` gacha hisoblanadi. */
export function breakMinutes(breaks: { start: string; end?: string }[] | undefined, now: string) {
  return (breaks || []).reduce((sum, b) => sum + Math.max(0, toMin(b.end || now) - toMin(b.start)), 0);
}
