import * as Updates from "expo-updates";
import { AppState } from "react-native";

/*
 * Build’siz yangilanish (EAS Update): JS o‘zgarishlari do‘konga chiqmasdan telefonlarga yetadi.
 * Ilova ochilganda Expo o‘zi tekshiradi (app.json → updates.checkAutomatically = ON_LOAD) — yangi versiya
 * keyingi ochilishda ishga tushadi. Bu yerda qo‘shimcha: ilova fondan qaytganda (30 daqiqada bir marta)
 * tekshirib, yuklab qo‘yamiz; foydalanuvchi bannerdagi «Yangilash» bilan darhol qo‘llaydi.
 * Dev-build va Expo Go’da yangilanish API’si ishlamaydi — jim o‘tkazib yuboriladi.
 */

const EVERY_MS = 30 * 60_000;
let lastCheck = 0;
let running = false;

/** Yangi versiya bor bo‘lsa — yuklab oladi. true — yangi versiya tayyor (qo‘llashni kutyapti). */
export async function checkForAppUpdate(force = false) {
  if (__DEV__ || !Updates.isEnabled || running) return false;
  if (!force && Date.now() - lastCheck < EVERY_MS) return false;
  running = true;
  lastCheck = Date.now();
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return false;
    const fetched = await Updates.fetchUpdateAsync();
    return fetched.isNew;
  } catch {
    // Internet yo‘q yoki server javob bermadi — keyingi safar qayta.
    return false;
  } finally {
    running = false;
  }
}

/** Ilova faol bo‘lganda (fondan qaytganda) tekshirib turadi. */
export function watchAppUpdates() {
  const sub = AppState.addEventListener("change", (state) => {
    if (state === "active") void checkForAppUpdate();
  });
  return () => sub.remove();
}

/** Yuklangan yangi versiyani hozir qo‘llash (ilova qayta ochiladi). */
export const applyAppUpdate = () => Updates.reloadAsync();

/** Sozlamalarda ko‘rsatish uchun: qaysi yangilanish ishlayapti. */
export function updateInfo() {
  if (!Updates.isEnabled) return "dev";
  if (Updates.isEmbeddedLaunch) return "o‘rnatilgan versiya";
  const id = Updates.updateId ? Updates.updateId.slice(0, 8) : "—";
  const at = Updates.createdAt ? new Date(Updates.createdAt.getTime() + 5 * 3_600_000).toISOString().slice(0, 16).replace("T", " ") : "";
  return `${id}${at ? ` · ${at}` : ""}`;
}

export { Updates };
