import { createHash, createPublicKey, randomBytes, randomInt, timingSafeEqual, verify } from "node:crypto";

/*
 * Native ilova qurilma kriptografiyasi (server tomoni).
 *
 * Telefon o‘rnatishda ECDSA P-256 kalit juftini yaratadi; maxfiy kalit telefonning xavfsiz
 * xotirasida (iOS Keychain / Android Keystore) qoladi, serverga faqat ochiq kalit keladi.
 * Muhim amallar (faollashtirish, sessiyani yangilash) server bergan bir martalik «challenge»ga
 * qurilma imzosi bilan tasdiqlanadi — shu bilan token boshqa telefonga ko‘chirilsa ishlamaydi.
 */

/** P-256 SPKI (DER) sarlavhasi: siqilmagan 65 baytli ochiq kalit oldiga qo‘shiladi. */
const P256_SPKI_PREFIX = Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex");

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/**
 * Mijoz yuborgan ochiq kalitni (siqilmagan nuqta 0x04‖X‖Y, base64) SPKI ga aylantiradi va
 * egri chiziqda ekanini tekshiradi. Yaroqsiz bo‘lsa — xato.
 */
export function normalizePublicKey(rawBase64: string) {
  const raw = Buffer.from(rawBase64, "base64");
  if (raw.length !== 65 || raw[0] !== 0x04) throw Object.assign(new Error("Qurilma kaliti yaroqsiz."), { status: 400 });
  const spki = Buffer.concat([P256_SPKI_PREFIX, raw]);
  // createPublicKey nuqta egri chiziqda bo‘lmasa xato beradi.
  createPublicKey({ key: spki, format: "der", type: "spki" });
  return { spki: spki.toString("base64"), fingerprint: sha256(raw) };
}

/** ECDSA P-256 / SHA-256 imzosi (r‖s, 64 bayt, base64) — @noble/curves formatida. */
export function verifyDeviceSignature(spkiBase64: string, message: string, signatureBase64: string) {
  try {
    const signature = Buffer.from(signatureBase64, "base64");
    if (signature.length !== 64) return false;
    return verify(
      "sha256",
      Buffer.from(message, "utf8"),
      { key: Buffer.from(spkiBase64, "base64"), format: "der", type: "spki", dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch {
    return false;
  }
}

/** Faollashtirish kodi: 8 belgi (chalkashtiradigan 0/O, 1/I/L yo‘q) — XXXX-XXXX. 32^8 ≈ 10^12. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newActivationCode() {
  let code = "";
  for (let i = 0; i < 8; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
/** Foydalanuvchi kiritgan kodni bir xil ko‘rinishga keltiradi (bo‘sh joy, kichik harf, tire). */
export const normalizeCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const codeHash = (code: string) => sha256(`staffora-mobile-activation:${normalizeCode(code)}`);

export const newSecret = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const safeEqualHex = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

/* --------------------------------------------- bir martalik challenge --- */
type Challenge = { deviceKey: string; purpose: string; expiresAt: number };
const challenges = new Map<string, Challenge>();
const CHALLENGE_TTL_MS = 2 * 60_000;

/** Qurilma (yoki faollashtirilayotgan kalit) uchun bir martalik tasodifiy so‘z. */
export function issueChallenge(deviceKey: string, purpose: string) {
  if (challenges.size > 5000) for (const [key, value] of challenges) if (value.expiresAt < Date.now()) challenges.delete(key);
  const nonce = newSecret(24);
  challenges.set(nonce, { deviceKey, purpose, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return { nonce, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString() };
}
/** Challenge’ni ishlatadi (bir marta): to‘g‘ri qurilma va maqsad uchun, muddati o‘tmagan bo‘lsa — true. */
export function consumeChallenge(nonce: string, deviceKey: string, purpose: string) {
  const row = challenges.get(nonce);
  challenges.delete(nonce);
  return Boolean(row && row.deviceKey === deviceKey && row.purpose === purpose && row.expiresAt > Date.now());
}
/** Imzolanadigan matn — maqsad, nonce va kontekst bitta qatorda (boshqa amalda qayta ishlatib bo‘lmaydi). */
export const signedMessage = (purpose: string, nonce: string, context = "") => `staffora:${purpose}:${nonce}:${context}`;
