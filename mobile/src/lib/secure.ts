import * as SecureStore from "expo-secure-store";

/*
 * Maxfiy ma’lumotlar faqat iOS Keychain / Android Keystore orqali (expo-secure-store).
 * AsyncStorage ishlatilmaydi. «Faqat shu qurilmada» — iCloud zaxirasi/boshqa telefonga ko‘chmaydi.
 */
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const KEYS = {
  deviceKey: "staffora.deviceKey.v1",
  session: "staffora.session.v1",
  prefs: "staffora.prefs.v1",
} as const;

export async function secureGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key, options);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
export async function secureSet(key: string, value: unknown) {
  await SecureStore.setItemAsync(key, JSON.stringify(value), options);
}
export async function secureDelete(key: string) {
  await SecureStore.deleteItemAsync(key, options).catch(() => undefined);
}
