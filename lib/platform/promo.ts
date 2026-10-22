import type { PromoCode, PromoRedemption } from "./types";

/*
 * Promo kodlar: tekshiruv sof funksiya (testlanadi). Ishlatish serverda updateDb ichida —
 * yozuvlar navbat bilan (bitta tranzaksiya), shu sabab bir kod ikki marta «poyga»da ishlatilmaydi;
 * (promoId, companyId) bo‘yicha takror tekshiruv — noyoblik cheklovi vazifasini bajaradi.
 */

export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");
export const PROMO_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export function promoError(
  promo: PromoCode | undefined,
  companyId: string,
  redemptions: Pick<PromoRedemption, "promoId" | "companyId">[],
  now = new Date().toISOString(),
  planId?: string,
): string | null {
  if (!promo) return "Promo kod topilmadi.";
  if (promo.status !== "ACTIVE") return "Promo kod faol emas.";
  if (promo.expiresAt && promo.expiresAt < now) return "Promo kod muddati tugagan.";
  if (promo.usageLimit !== undefined && promo.usageLimit !== null && promo.used >= promo.usageLimit) return "Promo kod ishlatish chegarasiga yetgan.";
  if (promo.companyIds?.length && !promo.companyIds.includes(companyId)) return "Bu promo kod ushbu kompaniya uchun emas.";
  const mine = redemptions.filter((r) => r.promoId === promo.id && r.companyId === companyId).length;
  if (mine >= Math.max(1, promo.perCompanyLimit || 1)) return "Kompaniya bu promo koddan allaqachon foydalangan.";
  if (promo.kind !== "FREE_PLAN" && promo.planId && planId && promo.planId !== planId) return "Promo kod boshqa tarif uchun.";
  if (promo.kind === "PERCENT" && (promo.value <= 0 || promo.value > 100)) return "Promo foizi noto‘g‘ri.";
  if (promo.value <= 0) return "Promo qiymati noto‘g‘ri.";
  return null;
}

/** Hisob-faktura summasiga chegirma (PERCENT/FIXED). Natija manfiy bo‘lmaydi. */
export function discountFor(promo: Pick<PromoCode, "kind" | "value">, amount: number) {
  if (promo.kind === "PERCENT") return Math.min(amount, Math.round((amount * promo.value) / 100));
  if (promo.kind === "FIXED") return Math.min(amount, Math.round(promo.value));
  return 0;
}

export function describePromo(promo: Pick<PromoCode, "kind" | "value" | "currency">, planName?: string) {
  switch (promo.kind) {
    case "PERCENT":
      return `${promo.value}% chegirma`;
    case "FIXED":
      return `${promo.value.toLocaleString("ru-RU")} ${promo.currency || "UZS"} chegirma`;
    case "TRIAL_EXTENSION":
      return `Sinov muddati +${promo.value} kun`;
    case "FREE_PLAN":
      return `${planName || "Tarif"} — ${promo.value} kun bepul`;
  }
}
