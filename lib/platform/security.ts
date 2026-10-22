/*
 * Xavfsizlik yordamchilari (sof funksiyalar):
 *   maskSecrets — xato matni/stack ichidagi token, parol, kalitlarni yashiradi;
 *   isPrivateAddress — webhook SSRF himoyasi (lokal, xususiy, link-local, metadata manzillar);
 *   describeUserAgent — sessiya ro‘yxati uchun qisqa qurilma tavsifi (fingerprint emas).
 */

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(bot)?\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, "[telegram-token]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, "[jwt]"],
  [/\b(stf|gfk|sk|pk)_[A-Za-z0-9_]{12,}\b/g, "[api-key]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, "$1$2[redacted]"],
  [/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[redacted]@"],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[email]"],
  [/\+?998[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g, "[phone]"],
];

export function maskSecrets(text: string | undefined, max = 8000) {
  if (!text) return "";
  let out = String(text);
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/** IPv4 / IPv6 manzil xususiy, lokal yoki xizmat tarmog‘idami (SSRF uchun taqiqlangan). */
export function isPrivateAddress(address: string) {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (ip.includes(":")) {
    return ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80") || ip.startsWith("ff") || ip.startsWith("64:ff9b");
  }
  return true; // noma’lum format — xavfsiz tomonga
}

/** Webhook URL’ini tekshiradi (DNS bundan keyin, yuborishda ham tekshiriladi). */
export function webhookUrlError(raw: string, allowPrivate = false) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "URL noto‘g‘ri.";
  }
  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:")) return "Faqat https:// manzil qabul qilinadi.";
  if (url.username || url.password) return "URL ichida login/parol bo‘lmasin.";
  const host = url.hostname.toLowerCase();
  if (!allowPrivate) {
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return "Lokal manzillarga webhook yuborilmaydi.";
    if (/^[\d.]+$/.test(host) || host.includes(":")) if (isPrivateAddress(host)) return "Xususiy tarmoq manziliga webhook yuborilmaydi.";
  }
  if (raw.length > 500) return "URL juda uzun.";
  return null;
}

export function describeUserAgent(ua: string | undefined) {
  const text = ua || "";
  const mobile = /Mobile|Android|iPhone|iPad/i.test(text);
  const os = /Windows/i.test(text)
    ? "Windows"
    : /Android/i.test(text)
      ? "Android"
      : /iPhone|iPad|iOS/i.test(text)
        ? "iOS"
        : /Mac OS X|Macintosh/i.test(text)
          ? "macOS"
          : /Linux/i.test(text)
            ? "Linux"
            : "Noma’lum";
  const browser = /Edg\//.test(text)
    ? "Edge"
    : /OPR\//.test(text)
      ? "Opera"
      : /YaBrowser/.test(text)
        ? "Yandex"
        : /Chrome\//.test(text)
          ? "Chrome"
          : /Firefox\//.test(text)
            ? "Firefox"
            : /Safari\//.test(text)
              ? "Safari"
              : /Telegram/i.test(text)
                ? "Telegram"
                : "Brauzer";
  return { device: mobile ? "Mobil" : "Kompyuter", os, browser, label: `${browser} · ${os}` };
}

/** Email’ni qisman yashirish: a***@domain.uz */
export function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  return `${name.slice(0, 1)}***@${domain}`;
}
