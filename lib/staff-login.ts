/*
 * Ilovaga kirish uchun login — barcha xodimlar, HR, moliya va direktor uchun bir xil qoida:
 *   login = <nom>@staffora.uz   (nomni odamning o‘zi yozadi yoki ism-familiyadan avtomatik chiqadi)
 * Login bir marta beriladi va o‘zgarmaydi; parolni ilova yoki Mini App’da almashtirish mumkin.
 * Domen umumiy — login barcha kompaniyalar bo‘yicha noyob bo‘lishi shart (tekshiruv serverda).
 * Bu fayl server, panel va Mini App’da ishlatiladi (mobil ilovada nusxasi bor: mobile/src/lib/login.ts).
 */

export const LOGIN_DOMAIN = "staffora.uz";
export const LOGIN_SUFFIX = `@${LOGIN_DOMAIN}`;
export const LOGIN_MIN = 3;
export const LOGIN_MAX = 30;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

export type LoginCheck = { ok: true; local: string; login: string } | { ok: false; error: string };

/** Lotin/kirill o‘zbekcha ismdan login uchun lotin harflari (o‘ → o, g‘ → g, sh/ch saqlanadi). */
const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ғ: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", қ: "q", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ў: "o", ф: "f", х: "x", ҳ: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
  ъ: "", ь: "", ы: "i", э: "e", ю: "yu", я: "ya",
};
export function latinize(text: string) {
  return text
    .toLowerCase()
    .split("")
    .map((ch) => (ch in CYRILLIC ? CYRILLIC[ch] : ch))
    .join("")
    .replace(/[‘’ʻʼ`']/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

/** «Ozodbek Mamatov» → «ozodbek.mamatov» (faqat a–z, 0–9 va nuqta). */
export function suggestLoginLocal(firstName: string, lastName = "") {
  const part = (s: string) => latinize(s).replace(/[^a-z0-9]/g, "");
  const first = part(firstName);
  const last = part(lastName);
  const base = [first, last].filter(Boolean).join(".") || "xodim";
  return base.slice(0, LOGIN_MAX).replace(/\.+$/, "");
}

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

/** To‘liq login (kichik harf). Tekshiruvdan o‘tmasa — undefined. */
export function fullLogin(raw: string) {
  const check = checkLoginInput(raw);
  return check.ok ? check.login : undefined;
}

/** Parol: 8–72 belgi, kamida bitta harf va bitta raqam. Xato bo‘lsa — matn, to‘g‘ri bo‘lsa — null. */
export function passwordProblem(password: string): string | null {
  const value = String(password || "");
  if (value.length < PASSWORD_MIN) return `Parol kamida ${PASSWORD_MIN} belgi bo‘lsin.`;
  if (value.length > PASSWORD_MAX) return `Parol ${PASSWORD_MAX} belgidan oshmasin.`;
  // bcrypt faqat birinchi 72 BAYTni hisobga oladi: kirill va emoji 2–4 bayt — uzun parolning oxiri «yo‘qolmasin».
  if (new TextEncoder().encode(value).length > PASSWORD_MAX) return "Parol juda uzun — kirill harflari yoki belgilar bilan qisqaroq yozing.";
  if (/\s/.test(value)) return "Parolda bo‘sh joy bo‘lmasin.";
  if (!/[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ]/.test(value) || !/\d/.test(value)) return "Parolda kamida bitta harf va bitta raqam bo‘lsin.";
  return null;
}
