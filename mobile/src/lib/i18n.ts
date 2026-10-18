import { useSyncExternalStore } from "react";
import { Alert } from "react-native";
import { translate, type Lang } from "./i18n-dict";
import { secureGet, secureSet } from "./secure";

/*
 * Rus tili (mobil ilova). Interfeys o‘zbekcha yozilgan; ruscha tanlanganda ko‘rsatilgan matn lug‘at va
 * andozalar bo‘yicha almashtiriladi (lug‘at — i18n-dict.ts, Mini App bilan bir xil).
 * Tarjima components/T.tsx dagi Text / TextInput orqali bo‘ladi; Alert oynalari va ekran sarlavhalari ham.
 */

export { translate, type Lang };

const KEY = "staffora.lang";
let current: Lang = "uz";
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getLang = () => current;
/** Hozirgi tilda tarjima (komponentdan tashqarida ham). */
export const t = (text: string) => translate(text, current);

export async function setLang(lang: Lang) {
  current = lang;
  listeners.forEach((fn) => fn());
  await secureSet(KEY, lang).catch(() => undefined);
}
/** Tanlangan til (o‘zgarsa — komponent qayta chiziladi). */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}
/** Komponent ichida: const tr = useT(); tr("Saqlash"). */
export function useT() {
  const lang = useLang();
  return (text: string) => translate(text, lang);
}

// Saqlangan til — ilova ishga tushganda.
void secureGet<Lang>(KEY)
  .then((value) => {
    if (value === "ru" || value === "uz") {
      current = value;
      listeners.forEach((fn) => fn());
    }
  })
  .catch(() => undefined);

// Alert oynalari (sarlavha, matn, tugmalar) — tanlangan tilda.
const originalAlert = Alert.alert.bind(Alert);
Alert.alert = (title, message, buttons, options) =>
  originalAlert(t(title), message ? t(message) : message, buttons?.map((b) => ({ ...b, text: b.text ? t(b.text) : b.text })), options);
