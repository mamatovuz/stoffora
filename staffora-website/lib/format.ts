import type { Lang } from "./content";

// Intl brauzerlarda uz-UZ ma’lumotisiz bo‘lishi mumkin — server va client bir xil chiqishi uchun qo‘lda guruhlaymiz
export function groupNumber(value: number, lang: Lang) {
  const digits = Math.round(Math.abs(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, lang === "en" ? "," : " ");
  return value < 0 ? `−${digits}` : digits;
}
