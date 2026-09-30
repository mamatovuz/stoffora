import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Bot → Staffora webhook imzosi (bot api/webhooks.py bilan bir xil):
 *   X-Webhook-Signature: t=<unix>,v1=hex(HMAC_SHA256(secret, "<t>.<raw body>"))
 * 5 daqiqadan eski (yoki kelajakdagi) imzo rad etiladi — replay himoyasi.
 * Takroriy hodisa ID lari integration_events jadvalida ushlanadi.
 */

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, timestamp: number, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function signatureHeader(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${signPayload(secret, timestamp, body)}`;
}

export type SignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch" };

export function verifySignature(
  secret: string,
  header: string | undefined,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  tolerance = SIGNATURE_TOLERANCE_SECONDS,
): SignatureCheck {
  if (!header) return { ok: false, reason: "missing" };
  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const index = piece.indexOf("=");
    if (index > 0) parts.set(piece.slice(0, index).trim(), piece.slice(index + 1).trim());
  }
  const timestamp = Number(parts.get("t"));
  const signature = parts.get("v1") || "";
  if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/i.test(signature)) return { ok: false, reason: "malformed" };
  if (Math.abs(nowSeconds - timestamp) > tolerance) return { ok: false, reason: "expired" };
  const expected = Buffer.from(signPayload(secret, timestamp, body), "hex");
  const received = Buffer.from(signature, "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { ok: false, reason: "mismatch" };
  return { ok: true, timestamp };
}
