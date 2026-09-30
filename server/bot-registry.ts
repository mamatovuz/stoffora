import type { Api } from "grammy";

/*
 * Ishlab turgan kompaniya botlari ro‘yxati (companyId → Bot API).
 * telegram.ts (xabar yuborish) va company-bots.ts (hayot sikli) shu yerdan
 * foydalanadi — modullar bir-birini aylanma import qilmasligi uchun alohida.
 */
const apis = new Map<string, Api>();

export function registerCompanyBotApi(companyId: string, api: Api | undefined) {
  if (api) apis.set(companyId, api);
  else apis.delete(companyId);
}

export function companyBotApi(companyId: string) {
  return apis.get(companyId);
}
