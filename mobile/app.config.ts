import { existsSync } from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

/*
 * Asosiy sozlamalar app.json’da. Android push (FCM) uchun Firebase konsolidan olingan
 * google-services.json shu papkaga qo‘yilsa — avtomatik ulanadi (fayl bo‘lmasa build buzilmaydi).
 * EAS’da fayl maxfiy o‘zgaruvchi sifatida ham berilishi mumkin: GOOGLE_SERVICES_JSON (fayl yo‘li).
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const file = process.env.GOOGLE_SERVICES_JSON || path.join(__dirname, "google-services.json");
  return {
    ...(config as ExpoConfig),
    android: {
      ...config.android,
      ...(existsSync(file) ? { googleServicesFile: file } : {}),
    },
  };
};
