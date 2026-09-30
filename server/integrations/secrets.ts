import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/*
 * Integratsiya maxfiy kalitlarini (API key, webhook secret) shifrlash.
 *
 * AES-256-GCM, kalit server sirlaridan HKDF orqali olinadi:
 *   INTEGRATION_ENCRYPTION_KEY (tavsiya etiladi) yoki SESSION_SECRET.
 * Integratsiya sozlamalari .env orqali berilmaydi — faqat shifrlash uchun
 * server siri kerak, qolgan hammasi Staffora UI orqali kiritiladi.
 * Format: v1:<iv b64url>:<tag b64url>:<ciphertext b64url>
 */

const VERSION = "v1";

function masterKey() {
  const source =
    process.env.INTEGRATION_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    "staffora-local-session-secret-change-me";
  return Buffer.from(
    hkdfSync("sha256", source, "staffora-integrations", "credential-encryption-v1", 32),
  );
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(":");
}

export function decryptSecret(value: string) {
  const [version, iv, tag, data] = value.split(":");
  if (version !== VERSION || !iv || !tag || !data)
    throw new Error("Shifrlangan kalit formati noto‘g‘ri.");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** UI uchun kalitning xavfsiz ko‘rinishi: gfk_ab12… (sirning o‘zi ko‘rinmaydi). */
export function keyHint(apiKey: string) {
  const parts = apiKey.split("_");
  if (parts.length >= 3 && parts[0] === "gfk") return `gfk_${parts[1].slice(0, 6)}…`;
  return `${apiKey.slice(0, 4)}…`;
}

export function safeEqual(a: string, b: string) {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

/** Matndagi kalitlarni yashiradi (loglarga tushmasligi uchun). */
export function redact(text: string, ...secrets: (string | undefined)[]) {
  let out = text;
  for (const secret of secrets) if (secret && secret.length > 6) out = out.split(secret).join("***");
  return out.replace(/gfk_[A-Za-z0-9]+_[A-Za-z0-9_-]+/g, "gfk_***").replace(/whsec_[A-Za-z0-9_-]+/g, "whsec_***");
}
