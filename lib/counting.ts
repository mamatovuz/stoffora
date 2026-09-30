import type { Company, Employee } from "./types";

/*
 * Davomat hisoblash boshlanish sanasi.
 *
 * Yangi ulangan (masalan, botdan import qilingan) xodimlar keldi-ketdini hali
 * o‘rganayotgan bo‘ladi. Shu sanagacha bo‘lgan kunlar "mashq" hisoblanadi:
 * yozuvlar saqlanadi va ko‘rinadi, lekin kechikish, kelmaslik, KPI va oylikdan
 * ushlanmalarga ta’sir qilmaydi. Sana kelganda hammasi odatdagidek hisoblanadi.
 */

type CompanyLike = Pick<Company, "attendanceCounting"> | undefined;
type EmployeeLike = Pick<Employee, "countingStartDate"> | undefined;

const isDate = (value?: string) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

/** Xodim uchun amaldagi boshlanish sanasi (kompaniya va xodim sanasining kechrog‘i). */
export function countingStartDate(company: CompanyLike, employee?: EmployeeLike) {
  const values = [company?.attendanceCounting?.startDate, employee?.countingStartDate].filter(
    (value): value is string => isDate(value),
  );
  if (!values.length) return undefined;
  return values.sort().at(-1);
}

/** Shu kun mashq kunimi (hisobga olinmaydi)? */
export function isPracticeDay(date: string, company: CompanyLike, employee?: EmployeeLike) {
  const start = countingStartDate(company, employee);
  return Boolean(start && date < start);
}

/** Faqat hisoblanadigan kunlardagi yozuvlarni qoldiradi. */
export function countedRecords<T extends { date: string }>(
  rows: T[],
  company: CompanyLike,
  employee?: EmployeeLike,
) {
  const start = countingStartDate(company, employee);
  return start ? rows.filter((row) => row.date >= start) : rows;
}
