import type { FeatureFlagState } from "./types";

/*
 * Feature flag baholash (sof funksiya). Tartib:
 *   1) muddati o‘tgan flag — o‘chiq;
 *   2) aniq kompaniya qoidasi; 3) tarif qoidasi; 4) ichki (test) kompaniyalar qoidasi;
 *   5) rollout foizi (kompaniya ID si bo‘yicha barqaror xesh); 6) umumiy holat.
 * Flag xavfsizlik ruxsatini almashtirmaydi — u faqat funksiyani ko‘rsatish/yashirish uchun.
 */

/** 0–99 oralig‘idagi barqaror son (FNV-1a). Bir kompaniya har doim bir xil «chelak»ga tushadi. */
export function rolloutBucket(flagKey: string, companyId: string) {
  let hash = 0x811c9dc5;
  const input = `${flagKey}:${companyId}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

export type FlagContext = { companyId?: string; planId?: string; internal?: boolean; now?: string };

export function evaluateFlag(flag: FeatureFlagState, ctx: FlagContext): boolean {
  const now = ctx.now || new Date().toISOString();
  if (flag.expiresAt && flag.expiresAt < now) return false;
  const rule = (scope: "COMPANY" | "PLAN" | "INTERNAL", id?: string) =>
    flag.rules.find((r) => r.scope === scope && (scope === "INTERNAL" || Boolean(id && r.ids?.includes(id))));
  const company = rule("COMPANY", ctx.companyId);
  if (company) return company.enabled;
  const plan = rule("PLAN", ctx.planId);
  if (plan) return plan.enabled;
  if (ctx.internal) {
    const internal = rule("INTERNAL");
    if (internal) return internal.enabled;
  }
  if (ctx.companyId && flag.rollout !== undefined && flag.rollout !== null && flag.rollout > 0 && flag.rollout < 100)
    return rolloutBucket(flag.key, ctx.companyId) < flag.rollout || flag.enabled;
  if (flag.rollout === 100) return true;
  return flag.enabled;
}

export const FLAG_KEY_RE = /^[a-z][a-z0-9_.-]{2,63}$/;
