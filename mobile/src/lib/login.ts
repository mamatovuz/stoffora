/*
 * Ilovaga kirish logini va paroli — ildizdagi lib/staff-login.ts ning NUSXASI (mobil ilova ildiz lib/ ni
 * import qila olmaydi). Qoida o‘zgarsa — avval lib/staff-login.ts, keyin shu fayl (matnlar ham bir xil).
 *   login = <nom>@staffora.uz — odam faqat nomni yozadi, «@staffora.uz» avtomatik qo‘shiladi.
 */

export const LOGIN_DOMAIN = "staffora.uz";
export const LOGIN_SUFFIX = `@${LOGIN_DOMAIN}`;
export const LOGIN_MIN = 3;
export const LOGIN_MAX = 30;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
/** Direktor (panel) paroli — panel talabi: kamida 10 belgi. */
export const PANEL_PASSWORD_MIN = 10;

export type LoginCheck = { ok: true; local: string; login: string } | { ok: false; error: string };

/**
 * Foydalanuvchi yozgan loginni tekshiradi. Qabul qilinadi: «ozodbek», «Ozodbek», «ozodbek@staffora.uz».
 * Rad etiladi: «ozodbek@gmail.com» (boshqa domen), bo‘sh joy, kirill, juda qisqa/uzun.
 */
export function checkLoginInput(raw: string): LoginCheck {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return { ok: false, error: "Loginni yozing. Misol: ozodbek" };
  let local = text;
  const at = text.indexOf("@");
  if (at >= 0) {
    const domain = text.slice(at + 1);
    if (domain !== LOGIN_DOMAIN) return { ok: false, error: `Faqat login yozing (masalan: ozodbek) — oxiriga ${LOGIN_SUFFIX} avtomatik qo‘shiladi.` };
    local = text.slice(0, at);
  }
  if (/\s/.test(local)) return { ok: false, error: "Loginda bo‘sh joy bo‘lmasin. Misol: ozodbek.mamatov" };
  if (!/^[a-z0-9._-]+$/.test(local)) return { ok: false, error: "Faqat lotin harflari, raqam, nuqta (.) va chiziqcha (-, _) ishlating." };
  if (!/^[a-z]/.test(local)) return { ok: false, error: "Login harf bilan boshlansin. Misol: ozodbek" };
  if (/[._-]$/.test(local) || /[._-]{2}/.test(local)) return { ok: false, error: "Login oxiri yoki ketma-ket belgilar nuqta/chiziqcha bo‘lmasin." };
  if (local.length < LOGIN_MIN) return { ok: false, error: `Login kamida ${LOGIN_MIN} belgi bo‘lsin.` };
  if (local.length > LOGIN_MAX) return { ok: false, error: `Login ${LOGIN_MAX} belgidan oshmasin.` };
  return { ok: true, local, login: `${local}${LOGIN_SUFFIX}` };
}

/** Parol: 8–72 belgi, kamida bitta harf va bitta raqam. Xato bo‘lsa — matn, to‘g‘ri bo‘lsa — null. */
/** UTF-8 bayt uzunligi (TextEncoder’siz — eski Hermes’da ham ishlaydi). */
function utf8Length(text: string) {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export function passwordProblem(password: string): string | null {
  const value = String(password || "");
  if (value.length < PASSWORD_MIN) return `Parol kamida ${PASSWORD_MIN} belgi bo‘lsin.`;
  if (value.length > PASSWORD_MAX) return `Parol ${PASSWORD_MAX} belgidan oshmasin.`;
  // bcrypt faqat birinchi 72 BAYTni hisobga oladi: kirill va emoji 2–4 bayt — uzun parolning oxiri «yo‘qolmasin».
  if (utf8Length(value) > PASSWORD_MAX) return "Parol juda uzun — kirill harflari yoki belgilar bilan qisqaroq yozing.";
  if (/\s/.test(value)) return "Parolda bo‘sh joy bo‘lmasin.";
  if (!/[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ]/.test(value) || !/\d/.test(value)) return "Parolda kamida bitta harf va bitta raqam bo‘lsin.";
  return null;
}

/* ---------------------------------------------------- faqat ilovaga xos --- */

/** Direktor paroli: panel qoidasi (≥ 10 belgi) + umumiy qoidalar. */
export function panelPasswordProblem(password: string): string | null {
  if (String(password || "").length < PANEL_PASSWORD_MIN) return `Parol kamida ${PANEL_PASSWORD_MIN} belgi bo‘lsin.`;
  return passwordProblem(password);
}

/**
 * Yozish paytidagi tekshiruv: faqat begona domen («@gmail.com») darhol ko‘rsatiladi — «@staf…» kabi
 * yarim yozilgan to‘g‘ri domen xato hisoblanmaydi. Qolgan xatolar «Kirish» bosilganda.
 */
export function liveLoginProblem(raw: string): string | null {
  const text = String(raw || "").trim().toLowerCase();
  const at = text.indexOf("@");
  if (at < 0) return null;
  const domain = text.slice(at + 1);
  if (LOGIN_DOMAIN.startsWith(domain)) return null;
  const check = checkLoginInput(text);
  return check.ok ? null : check.error;
}
