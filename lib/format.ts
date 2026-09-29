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
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const localDate = new Date(
    `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T12:00:00+05:00`,
  );
  return {
    year: parts.year,
    month: parts.month - 1,
    day: parts.day,
    weekday: localDate.getDay(),
  };
}

export const money = (value: number, currency = "UZS") =>
  new Intl.NumberFormat("uz-UZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);

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
