/*
 * Smena vaqtlari — kechasi tugaydigan (yarim tundan o‘tadigan) smenalar bilan.
 *
 * Grafik va davomat vaqtlari «HH:MM» ko‘rinishida saqlanadi, sana esa smena
 * BOSHLANGAN ish kuniga tegishli. Tugash vaqti boshlanishdan kichik bo‘lsa
 * (14:00 → 00:00, 22:00 → 06:00) — u keyingi kalendar kuniga tegishli.
 * Shuning uchun oddiy `end - start` ishlatilmaydi: hamma hisob shu yerdagi
 * «smena boshidan beri o‘tgan daqiqa» o‘qida qilinadi.
 */

export const DAY_MINUTES = 24 * 60;

/** «HH:MM» → kun boshidan beri daqiqa. */
export function clockMinutes(hhmm: string) {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** Smena yarim tundan o‘tadimi (tugash keyingi kunda). */
export function isOvernight(start: string, end: string) {
  return clockMinutes(end) < clockMinutes(start);
}

/** `from` dan `to` gacha oldinga qarab o‘tgan daqiqa (yarim tundan o‘tsa ham); teng bo‘lsa — 0. */
export function forwardMinutes(from: string, to: string) {
  return (clockMinutes(to) - clockMinutes(from) + DAY_MINUTES) % DAY_MINUTES;
}

/** Smena davomiyligi: 09:00→18:00 = 540, 14:00→00:00 = 600, 22:00→06:00 = 480. */
export function shiftMinutes(start: string, end: string) {
  return forwardMinutes(start, end);
}

/**
 * Ish kuni boshidan (shu sananing 00:00) hisoblangan vaqt.
 * Kechki smenada tugash vaqtigacha bo‘lgan yarim tundan keyingi vaqt keyingi kunga
 * tegishli: 22:00→06:00 smenada 01:30 = 1530 (ertasi 01:30).
 */
export function clockOnShiftDay(clock: string, start: string, end: string) {
  const value = clockMinutes(clock);
  return isOvernight(start, end) && value < clockMinutes(start) && value <= clockMinutes(end) ? value + DAY_MINUTES : value;
}

/** Smenaning ish kuni boshidan hisoblangan chegaralari: [boshlanish, tugash]. */
export function shiftWindow(start: string, end: string) {
  const from = clockMinutes(start);
  return { from, to: from + shiftMinutes(start, end) };
}

export function addDays(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** «HH:MM» ko‘rinishiga (24 soatdan oshsa ham kun ichiga qaytariladi). */
export function formatClock(minutes: number) {
  const value = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
