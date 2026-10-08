/* Sana/vaqt — Toshkent vaqti bo‘yicha (Mini App bilan bir xil). */

const TZ = "Asia/Tashkent";
const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
const MONTHS_SHORT = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];
export const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
export const WEEKDAYS_SHORT = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];

function parts(date: Date) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(date);
  const get = (type: string) => p.find((x) => x.type === type)?.value || "";
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour") === "24" ? "00" : get("hour"), mm: get("minute") };
}
export const tashkentClock = (date = new Date()) => {
  const p = parts(date);
  return `${p.hh}:${p.mm}`;
};
export const tashkentIsoDate = (date = new Date()) => {
  const p = parts(date);
  return `${p.y}-${p.m}-${p.d}`;
};
const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
export const dateLongUz = (date = new Date()) => {
  const iso = tashkentIsoDate(date);
  return `${Number(iso.slice(8))}-${MONTHS[Number(iso.slice(5, 7)) - 1]}, ${WEEKDAYS[weekdayOf(iso)].toLowerCase()}`;
};
/** «2-oktyabr, juma» — ISO sanadan. */
export const dayTitle = (iso: string) => `${Number(iso.slice(8, 10))}-${MONTHS[Number(iso.slice(5, 7)) - 1]}, ${WEEKDAYS[weekdayOf(iso)].toLowerCase()}`;
export const dateUz = (iso: string) => `${Number(iso.slice(8, 10))}-${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;
export const monthUz = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const weekday = (iso: string) => WEEKDAYS[weekdayOf(iso)];
export const weekdayShort = (iso: string) => WEEKDAYS_SHORT[weekdayOf(iso)];
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const clockDuration = (minutes: number) => `${Math.floor(minutes / 60)}:${String(Math.max(0, minutes) % 60).padStart(2, "0")}`;
export const duration = (minutes?: number) => {
  const total = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} soat${m ? ` ${m} daq` : ""}` : `${m} daq`;
};
/** `from` dan `to` gacha oldinga (yarim tundan o‘tsa ham: 23:30 → 00:30 = 60). */
export const forwardMinutes = (from: string, to: string) => (toMinutes(to) - toMinutes(from) + 1440) % 1440;
/** Kelgandan beri — kechki smenada (14:00 → 00:00) yarim tundan keyin ham to‘g‘ri. */
export const minutesSince = (hhmm: string, now = new Date()) => forwardMinutes(hhmm, tashkentClock(now));
export const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
export const timeAgo = (iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "hozirgina";
  if (minutes < 60) return `${minutes} daq oldin`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} soat oldin`;
  return dateUz(tashkentIsoDate(new Date(iso)));
};
