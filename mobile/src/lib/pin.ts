import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytes } from "expo-crypto";
import { post } from "./api";
import { toBase64 } from "./deviceKey";
import { secureDelete, secureGet, secureSet } from "./secure";

/*
 * Ilovaga kirish PIN-kodi (4 xona). Faqat telefonda: Keychain/Keystore’da tuz bilan xeshlangan,
 * serverga yuborilmaydi. 5 marta noto‘g‘ri kiritilsa — PIN bloklanadi va faqat «Unutdingizmi?»
 * (Telegram/Mini App’ga keladigan 5 xonali kod) orqali yangilanadi.
 */
const KEY = "staffora.pin.v1";
export const MAX_PIN_ATTEMPTS = 5;
type Stored = { salt: string; hash: string; failed: number };

const hash = (salt: string, pin: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, `staffora-pin:${salt}:${pin}`);

export async function hasPin() {
  return Boolean(await secureGet<Stored>(KEY));
}
export async function setPin(pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new Error("PIN 4 ta raqamdan iborat bo‘lsin.");
  const salt = toBase64(getRandomBytes(16));
  await secureSet(KEY, { salt, hash: await hash(salt, pin), failed: 0 } satisfies Stored);
}
export async function removePin() {
  await secureDelete(KEY);
}
/** Natija: to‘g‘ri / noto‘g‘ri (qolgan urinishlar) / bloklangan. */
export async function checkPin(pin: string): Promise<{ ok: true } | { ok: false; left: number }> {
  const stored = await secureGet<Stored>(KEY);
  if (!stored) return { ok: true };
  if (stored.failed >= MAX_PIN_ATTEMPTS) return { ok: false, left: 0 };
  if ((await hash(stored.salt, pin)) === stored.hash) {
    if (stored.failed) await secureSet(KEY, { ...stored, failed: 0 });
    return { ok: true };
  }
  const failed = stored.failed + 1;
  await secureSet(KEY, { ...stored, failed });
  return { ok: false, left: Math.max(0, MAX_PIN_ATTEMPTS - failed) };
}
export async function pinBlocked() {
  const stored = await secureGet<Stored>(KEY);
  return Boolean(stored && stored.failed >= MAX_PIN_ATTEMPTS);
}

/** «Unutdingizmi?»: kod Telegram’ga va Mini App bildirishnomalariga yuboriladi. */
export const requestPinReset = () => post<{ ok: true; sentToTelegram: boolean }>("/mobile/pin/reset-code", {});
export const verifyPinReset = (code: string) => post<{ ok: true }>("/mobile/pin/reset-verify", { code });
