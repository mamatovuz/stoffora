const months = [
  "yanvar",
  "fevral",
  "mart",
  "aprel",
  "may",
  "iyun",
  "iyul",
  "avgust",
  "sentabr",
  "oktabr",
  "noyabr",
  "dekabr",
];
const shortMonths = [
  "yan",
  "fev",
  "mar",
  "apr",
  "may",
  "iyn",
  "iyl",
  "avg",
  "sen",
  "okt",
  "noy",
  "dek",
];
const weekdays = [
  "yakshanba",
  "dushanba",
  "seshanba",
  "chorshanba",
  "payshanba",
  "juma",
  "shanba",
];

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

export function dateParts(value: string | Date) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return {
      year,
      month: month - 1,
      day,
      weekday: new Date(`${value}T12:00:00+05:00`).getDay(),
    };
  }
  // Toshkent doimiy UTC+5 (yozgi vaqt yo‘q) — Intl formatlagichdan ~50 barobar tez.
  const shifted = new Date(new Date(value).getTime() + TASHKENT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

export const money = (value: number, currency = "UZS") => {
  const amount = Math.round(value || 0)
    .toLocaleString("ru-RU")
    .replace(/[  ]/g, " ");
  return currency === "UZS" ? `${amount} so‘m` : `${amount} ${currency}`;
};

export const dateUz = (value: string | Date) => {
  const part = dateParts(value);
  return `${String(part.day).padStart(2, "0")}-${shortMonths[part.month]} ${part.year}`;
};

export const dateLongUz = (value: string | Date, withWeekday = false) => {
  const part = dateParts(value);
  const date = `${part.day}-${months[part.month]} ${part.year}`;
  return withWeekday ? `${weekdays[part.weekday]}, ${date}` : date;
};

export const monthYearUz = (value: string | Date) => {
  const part = dateParts(value);
  return `${months[part.month][0].toUpperCase()}${months[part.month].slice(1)} ${part.year}`;
};

export const monthShortUz = (value: string | Date) =>
  shortMonths[dateParts(value).month];
export const weekdayShortUz = (value: string | Date) =>
  ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"][dateParts(value).weekday];
export const tashkentIsoDate = (value: string | Date = new Date()) => {
  const part = dateParts(value);
  return `${part.year}-${String(part.month + 1).padStart(2, "0")}-${String(part.day).padStart(2, "0")}`;
};
export const tashkentWeekday = (value: string | Date = new Date()) =>
  dateParts(value).weekday;
export const timeUz = (value?: string) => (value ? value.slice(0, 5) : "—");
export const duration = (minutes: number) =>
  `${Math.floor(minutes / 60)}s ${minutes % 60}d`;
export const initials = (first: string, last = "") =>
  `${first[0] || ""}${last[0] || ""}`.toUpperCase();
/** Telefon raqamini solishtirish uchun oxirgi 9 raqam (O‘zbekiston formati). */
export const phoneKey = (value?: string) =>
  (value || "").replace(/\D/g, "").slice(-9);
export const tashkentClock = (value: Date = new Date()) => {
  const shifted = new Date(value.getTime() + TASHKENT_OFFSET_MS);
  return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
};
