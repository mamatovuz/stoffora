import { p256 } from "@noble/curves/nist.js";
import { KEYS, secureGet, secureSet } from "./secure";

/*
 * Qurilma kaliti (ECDSA P-256). Birinchi ishga tushishda telefonda yaratiladi; maxfiy kalit
 * faqat Keychain/Keystore’da (expo-secure-store, «faqat shu qurilma») saqlanadi va serverga
 * hech qachon yuborilmaydi — serverga faqat ochiq kalit boradi.
 *
 * Halollik uchun: kalit dastur xotirasida imzolanadi (apparat ichida «chiqarib bo‘lmaydigan»
 * Secure Enclave kaliti emas). U OS himoyasidagi xotirada turadi va zaxira nusxaga tushmaydi.
 */

type Stored = { secret: string; createdAt: string };
let cache: Uint8Array | null = null;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function toBase64(bytes: Uint8Array) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
  }
  return out;
}
function fromBase64(text: string) {
  const clean = text.replace(/=+$/, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const ch of clean) {
    buffer = (buffer << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 255;
    }
  }
  return bytes;
}

async function secretKey() {
  if (cache) return cache;
  const stored = await secureGet<Stored>(KEYS.deviceKey);
  if (stored?.secret) {
    cache = fromBase64(stored.secret);
    return cache;
  }
  const secret = p256.utils.randomSecretKey();
  await secureSet(KEYS.deviceKey, { secret: toBase64(secret), createdAt: new Date().toISOString() } satisfies Stored);
  cache = secret;
  return secret;
}

/** Ochiq kalit — siqilmagan nuqta (65 bayt, 0x04‖X‖Y), base64. */
export async function devicePublicKey() {
  return toBase64(p256.getPublicKey(await secretKey(), false));
}

/** Server bergan challenge matnini imzolaydi (SHA-256, r‖s 64 bayt, base64). */
export async function signDevice(message: string) {
  const signature = p256.sign(new TextEncoder().encode(message), await secretKey());
  return toBase64(signature);
}

/** Server bilan bir xil format: `staffora:<maqsad>:<nonce>:<kontekst>`. */
export const signedMessage = (purpose: string, nonce: string, context = "") => `staffora:${purpose}:${nonce}:${context}`;
