/*
 * Bank kartasi raqami: tozalash, Luhn tekshiruvi, turini aniqlash va yashirish.
 * Server ham (tekshiruv), Mini App ham (jonli ko‘rsatma) ishlatadi.
 */

export type CardBrand = "UZCARD" | "HUMO" | "VISA" | "MASTERCARD" | "UNIONPAY" | "OTHER";

export const CARD_BRAND_LABELS: Record<CardBrand, string> = {
  UZCARD: "Uzcard",
  HUMO: "Humo",
  VISA: "Visa",
  MASTERCARD: "Mastercard",
  UNIONPAY: "UnionPay",
  OTHER: "Karta",
};

export const cardDigits = (value: string) => value.replace(/\D/g, "").slice(0, 19);

/** 8600 1234 5678 9012 — kiritish paytida chiroyli ko‘rinish. */
export const formatCard = (value: string) => cardDigits(value).replace(/(\d{4})(?=\d)/g, "$1 ");

export function cardBrand(value: string): CardBrand {
  const d = cardDigits(value);
  if (/^(8600|5614)/.test(d)) return "UZCARD";
  if (/^9860/.test(d)) return "HUMO";
  if (/^4/.test(d)) return "VISA";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return "MASTERCARD";
  if (/^62/.test(d)) return "UNIONPAY";
  return "OTHER";
}

/** Luhn nazorat raqami (tasodifiy xatoni ushlaydi). */
export function luhnValid(value: string) {
  const d = cardDigits(value);
  if (d.length < 12) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i += 1) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Kartani tekshiradi; xato bo‘lsa — foydalanuvchiga tushunarli matn. */
export function cardError(value: string): string | null {
  const d = cardDigits(value);
  if (d.length !== 16) return "Karta raqami 16 ta raqamdan iborat bo‘lsin.";
  if (!luhnValid(d)) return "Karta raqami noto‘g‘ri — raqamlarni tekshiring.";
  return null;
}

/** 8600 •••• •••• 9012 */
export const maskCard = (value: string) => {
  const d = cardDigits(value);
  return d.length >= 8 ? `${d.slice(0, 4)} •••• •••• ${d.slice(-4)}` : "••••";
};

/** Karta egasi: lotin/kirill harflari, bo‘sh joy, apostrof va chiziqcha; 2 so‘zdan kam emas. */
export function holderError(value: string): string | null {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 5 || name.length > 60) return "Qabul qiluvchining ism-familiyasini to‘liq yozing.";
  if (!/^[\p{L}'‘’ʼ`. -]+$/u.test(name)) return "Ism-familiyada faqat harflar bo‘lsin.";
  if (name.split(" ").length < 2) return "Ism va familiyani birga yozing.";
  return null;
}
export const normalizeHolder = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
