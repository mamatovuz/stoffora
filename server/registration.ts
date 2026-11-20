import { randomUUID } from "node:crypto";
import { audit } from "../lib/store";
import { phoneKey, tashkentIsoDate } from "../lib/format";
import type {
  BuiltinField,
  Company,
  Database,
  Employee,
  QuestionType,
  RegistrationData,
  RegistrationForm,
  RegistrationQuestion,
  RegistrationRequest,
  Schedule,
} from "../lib/types";
import { parseSalary } from "./integrations/transform";
import { assertEmployeeCapacity } from "../lib/limits";
import { applyPanelReference } from "./face-reference";
import { LOGIN_SUFFIX, checkLoginInput } from "../lib/staff-login";
import { credentialOfEmployee, isLoginTaken, normalizeLogin, setEmployeeCredential, splitName, suggestFreeLogin } from "../lib/staff-credentials";

/*
 * Botdagi xodim anketasi — sozlanadigan dvigatel.
 *
 * Har bir kompaniya savollarni panelda o‘zi boshqaradi: qo‘shadi, o‘chiradi,
 * matnini va variantlarini o‘zgartiradi, tartibini almashtiradi. Tizim
 * maydonlari (ism, telefon, lavozim, filial…) xodim profiliga yoziladi,
 * qo‘shimcha savollar javobi profildagi «Qo‘shimcha ma’lumotlar»ga tushadi.
 * Bu modul holatsiz — Telegram bilan ishlash company-bots.ts da.
 */

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

export const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
/** Tugmalarda Dushanbadan boshlanadi. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const SHIFTS = {
  DAY: { label: "☀️ Kunduzgi smena", short: "Kunduzgi" },
  NIGHT: { label: "🌙 Kechki smena", short: "Kechki" },
  BOTH: { label: "🔄 Qo‘sh smena", short: "Qo‘sh smena" },
} as const;

/** Tizim maydonlari: turi, standart matni va o‘chirib bo‘lmaydiganlari. */
export const BUILTINS: Record<
  BuiltinField,
  { type: QuestionType; title: string; hint?: string; locked: boolean; enabled: boolean; options?: string[]; label: string; optional?: boolean }
> = {
  fullName: { type: "name", label: "Ism-familiya", title: "👤 Ism va familiyangizni yozing.", hint: "Misol: Ali Valiyev", locked: true, enabled: true },
  gender: { type: "gender", label: "Jinsi", title: "🚻 Jinsingiz?", hint: "Pastdan tanlang", locked: false, enabled: true },
  birthDate: { type: "birthdate", label: "Tug‘ilgan sana", title: "📅 Tug‘ilgan sanangiz.", hint: "Faqat kun.oy.yil — misol: 29.08.1995", locked: false, enabled: true },
  pinfl: {
    type: "pinfl",
    label: "JShShIR",
    title: "🪪 JShShIR (shaxsiy raqam) ni yozing.",
    hint: "Pasport yoki ID kartadagi 14 xonali raqam. Misol: 31508951234567",
    locked: false,
    enabled: true,
  },
  phone: { type: "phone", label: "Telefon", title: "📱 Telefon raqamingizni yozing.", hint: "+998 bilan, bo‘sh joysiz. Misol: +998932303410", locked: true, enabled: true },
  parentPhone: { type: "phone", label: "Ota-ona telefoni", title: "👪 Ota yoki onangizning telefon raqami.", hint: "Misol: +998901234567", locked: false, enabled: true },
  email: { type: "email", label: "Email", title: "📧 Email manzilingiz.", hint: "Misol: ali.valiyev@gmail.com", locked: false, enabled: false, optional: true },
  positionId: { type: "position", label: "Lavozim", title: "💼 Qaysi lavozimda ishlaysiz?", hint: "Pastdan tanlang", locked: true, enabled: true },
  address: { type: "text", label: "Manzil", title: "🏠 Yashash manzilingiz.", hint: "Misol: Chilonzor tumani, 12-kvartal", locked: false, enabled: true },
  branchId: { type: "branch", label: "Filial", title: "🏢 Qaysi filialda ishlaysiz?", hint: "Pastdan tanlang", locked: true, enabled: true },
  shift: { type: "shift", label: "Smena", title: "🔀 Qaysi smenada ishlaysiz?", locked: false, enabled: true },
  workHours: {
    type: "workHours",
    label: "Ish vaqti",
    title: "🕒 Ish vaqtingiz nechidan nechigacha?",
    hint: "Tayyor variantni tanlang yoki «Boshqa vaqt» ni bosing",
    locked: false,
    enabled: true,
    options: ["09:00 - 18:00", "08:00 - 17:00", "14:00 - 00:00"],
  },
  salary: { type: "money", label: "Oylik", title: "💰 Oyligingiz qancha?", hint: "Misol: 4 000 000", locked: false, enabled: true },
  restDay: { type: "weekday", label: "Dam olish kuni", title: "🛌 Haftaning qaysi kuni dam olasiz?", locked: false, enabled: true },
  education: {
    type: "choice",
    label: "Ma’lumoti",
    title: "🎓 Ma’lumotingiz qanday?",
    locked: false,
    enabled: true,
    options: ["Oliy", "Tugallanmagan oliy", "O‘rta maxsus", "Tugallanmagan o‘rta maxsus", "Umumiy o‘rta (diplom yo‘q)"],
  },
  idDocument: {
    type: "photo",
    label: "Pasport / ID karta",
    title: "📷 Pasport yoki ID kartangiz rasmini yuboring.",
    hint: "Rasm aniq, yorug‘ joyda va to‘liq ko‘rinsin (ma’lumotlar sahifasi yoki ID kartaning old tomoni).",
    locked: false,
    enabled: true,
  },
  selfie: {
    type: "photo",
    label: "Yuz rasmi",
    title: "🤳 Yuzingiz rasmini yuboring.",
    hint: "Oxirgi 10 kun ichida tushgan, kameraga to‘g‘ri qarab turgan, yorug‘ joyda (ko‘zoynak va bosh kiyimsiz). Bu rasm profilingizga qo‘yiladi va Face ID uchun namuna bo‘ladi.",
    locked: false,
    enabled: true,
  },
  // Har doim oxirgi savol: login (tugma bilan taklif) → parol. Yoqilgan bo‘lsa — majburiy.
  appLogin: {
    type: "login",
    label: "Ilova uchun login va parol",
    title: "🔐 Staffora ilovasi uchun login tanlang.",
    hint: "Pastdagi tugmani bosing yoki o‘zingiz yozing (faqat lotin harflari). Oxiriga @staffora.uz avtomatik qo‘shiladi.",
    locked: false,
    enabled: true,
  },
};
/** Keyinroq qo‘shilgan tizim maydonlari: saqlangan anketada yo‘q bo‘lsa — yoqilgan holda shu savoldan keyin qo‘shiladi. */
const ADDED_FIELDS: Partial<Record<BuiltinField, BuiltinField | "end">> = {
  gender: "fullName",
  pinfl: "birthDate",
  idDocument: "end",
  selfie: "end",
  // Email — o‘chiq holda qo‘shiladi (kompaniya xohlasa yoqadi); ilova logini — yoqilgan, oxirida.
  email: "parentPhone",
  appLogin: "end",
};

/* -------------------------------------------- smena va ish grafiklari --- */
const SHORT_DAYS = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
/** Ish kunlari qisqa: «har kuni», «Du–Ju», «Du, Se, Pa». */
export function scheduleDaysLabel(schedule: Schedule) {
  const on = [1, 2, 3, 4, 5, 6, 0].filter((d) => schedule.days.find((x) => x.day === d)?.enabled);
  if (on.length === 7) return "har kuni";
  if (!on.length) return "—";
  const order = [1, 2, 3, 4, 5, 6, 0];
  const contiguous = on.every((d, i) => i === 0 || order.indexOf(d) === order.indexOf(on[i - 1]) + 1);
  return contiguous && on.length > 2 ? `${SHORT_DAYS[on[0]]}–${SHORT_DAYS[on[on.length - 1]]}` : on.map((d) => SHORT_DAYS[d]).join(", ");
}
/** Grafikning asosiy vaqti (birinchi ish kuni bo‘yicha). */
export function scheduleHours(schedule: Schedule) {
  const day = schedule.days.find((d) => d.enabled);
  return day ? `${day.start} - ${day.end === "23:59" ? "00:00" : day.end}` : undefined;
}
/** Grafik qaysi smena: 12:00 gacha boshlansa — kunduzgi, keyin — kechki. */
export function scheduleShift(schedule: Schedule): "DAY" | "NIGHT" {
  const start = schedule.days.find((d) => d.enabled)?.start || "09:00";
  return Number(start.slice(0, 2)) < 12 ? "DAY" : "NIGHT";
}
export function companySchedules(db: Database, companyId: string, shift?: string) {
  return db.schedules
    .filter((s) => s.companyId === companyId && scheduleHours(s) && (!shift || shift === "BOTH" || scheduleShift(s) === shift))
    .sort((a, b) => (scheduleHours(a) || "").localeCompare(scheduleHours(b) || ""));
}
const BUILTIN_ORDER = Object.keys(BUILTINS) as BuiltinField[];

export const CUSTOM_TYPES: QuestionType[] = ["text", "number", "age", "phone", "email", "date", "money", "choice", "yesno"];
export const TYPE_LABELS: Record<QuestionType, string> = {
  name: "Ism-familiya",
  text: "Matn",
  number: "Raqam",
  date: "Sana",
  birthdate: "Tug‘ilgan sana",
  phone: "Telefon",
  money: "Summa (so‘m)",
  choice: "Variant tanlash",
  yesno: "Ha / Yo‘q",
  position: "Lavozim",
  branch: "Filial",
  shift: "Smena",
  workHours: "Ish vaqti",
  weekday: "Hafta kuni",
  gender: "Jins (Erkak / Ayol)",
  pinfl: "JShShIR",
  photo: "Rasm (hujjat)",
  age: "Yosh",
  email: "Email",
  login: "Ilova logini va paroli",
};

export const DEFAULT_TEXTS = {
  intro:
    "🏢 <b>{company}</b> — xodimlar ro‘yxati\n\nAssalomu alaykum! Bir necha savolga javob bering — anketangiz HR bo‘limiga boradi. Tasdiqlangach, shu yerning o‘zida profilingiz ochiladi.",
  submittedText: "✅ <b>Anketangiz HR bo‘limiga yuborildi.</b>\n\nTasdiqlanishi bilan shu yerga xabar keladi va profilingiz ochiladi.",
  approvedText:
    "🎉 <b>Tabriklaymiz, {name}!</b>\n\nAnketangiz tasdiqlandi — endi siz <b>{company}</b> xodimisiz.\n\nPastdagi tugmani bosing: keldi-ketdi, ish grafigi va ta’til — hammasi shu yerda. Birinchi kirishda Face ID sozlanadi.",
};

export function defaultForm(): RegistrationForm {
  return {
    questions: BUILTIN_ORDER.map((field) => ({
      id: field,
      field,
      type: BUILTINS[field].type,
      title: BUILTINS[field].title,
      hint: BUILTINS[field].hint,
      options: BUILTINS[field].options ? [...BUILTINS[field].options!] : undefined,
      required: !BUILTINS[field].optional,
      enabled: BUILTINS[field].enabled,
    })),
  };
}

const clip = (value: string | undefined, max: number) => (value || "").trim().slice(0, max);

/**
 * Formani to‘g‘rilaydi: har bir tizim maydoni bor, majburiylari yoqilgan,
 * ID lar noyob, variantlar tozalangan. Paneldan kelgan ma’lumot shu yerdan o‘tadi.
 */
export function normalizeForm(form?: RegistrationForm): RegistrationForm {
  const source = form?.questions?.length ? form.questions : defaultForm().questions;
  const seen = new Set<string>();
  const questions: RegistrationQuestion[] = [];
  for (const raw of source.slice(0, 40)) {
    const field = raw.field && raw.field in BUILTINS ? raw.field : undefined;
    const id = field || (/^[a-z0-9]{4,16}$/i.test(raw.id) ? raw.id : randomUUID().slice(0, 8));
    if (seen.has(id)) continue;
    seen.add(id);
    const builtin = field ? BUILTINS[field] : undefined;
    const type = builtin ? builtin.type : CUSTOM_TYPES.includes(raw.type) ? raw.type : "text";
    const options =
      type === "choice" || type === "workHours"
        ? [...new Set((raw.options || []).map((o) => clip(o, 60)).filter(Boolean))].slice(0, 20)
        : undefined;
    questions.push({
      id,
      field,
      type,
      title: clip(raw.title, 300) || builtin?.title || "Savol",
      hint: clip(raw.hint, 200) || undefined,
      options: type === "choice" && !options?.length ? ["Ha", "Yo‘q"] : options,
      // Ilova logini yoqilgan bo‘lsa — majburiy (o‘tkazib yuborilmaydi).
      required: builtin?.locked || field === "appLogin" ? true : raw.required !== false,
      enabled: builtin?.locked ? true : raw.enabled !== false,
    });
  }
  // Yo‘qolgan tizim maydonlari qo‘shiladi: majburiylari va yangi qo‘shilganlari (jins, JShShIR, hujjat, ilova logini) —
  // standart holatida (email — o‘chiq).
  for (const field of BUILTIN_ORDER)
    if (!seen.has(field)) {
      const base = defaultForm().questions.find((q) => q.field === field)!;
      const after = ADDED_FIELDS[field];
      const row = { ...base, enabled: BUILTINS[field].locked || (Boolean(after) && BUILTINS[field].enabled) };
      const index = after && after !== "end" ? questions.findIndex((q) => q.field === after) : -1;
      if (index >= 0) questions.splice(index + 1, 0, row);
      else questions.push(row);
    }
  // Ilova logini har doim oxirgi savol (anketa tugagach login va parol beriladi).
  const login = questions.findIndex((q) => q.field === "appLogin");
  if (login >= 0 && login !== questions.length - 1) questions.push(...questions.splice(login, 1));
  return {
    questions,
    intro: clip(form?.intro, 1500) || undefined,
    submittedText: clip(form?.submittedText, 1000) || undefined,
    approvedText: clip(form?.approvedText, 1000) || undefined,
    updatedAt: form?.updatedAt,
    updatedBy: form?.updatedBy,
  };
}

export const companyForm = (company?: Pick<Company, "registrationForm">) => normalizeForm(company?.registrationForm);
export const activeQuestions = (form: RegistrationForm) => form.questions.filter((q) => q.enabled);
export const findQuestion = (form: RegistrationForm, id: string) => form.questions.find((q) => q.id === id);

export function fillTemplate(text: string, vars: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? escape(vars[key]) : match));
}

/* ------------------------------------------------------- tekshiruvlar --- */

export function checkFullName(text: string): Check<string> {
  const value = text.trim().replace(/\s+/g, " ");
  const words = value.split(" ");
  if (value.length < 5 || value.length > 80 || words.length < 2)
    return { ok: false, error: "Ism va familiyani to‘liq yozing. Misol: Ali Valiyev" };
  if (!/^[\p{L}\s'‘’`ʻ-]+$/u.test(value)) return { ok: false, error: "Faqat harflardan foydalaning. Misol: Ali Valiyev" };
  return { ok: true, value: words.map((w) => w.charAt(0).toLocaleUpperCase("uz") + w.slice(1)).join(" ") };
}

function parseDmy(text: string): Check<Date> {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text.trim());
  if (!match) return { ok: false, error: "Sanani faqat kun.oy.yil ko‘rinishida yozing. Misol: 29.08.1995" };
  const [, dd, mm, yyyy] = match;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (date.getUTCDate() !== Number(dd) || date.getUTCMonth() !== Number(mm) - 1)
    return { ok: false, error: "Bunday sana yo‘q. Misol: 29.08.1995" };
  return { ok: true, value: date };
}
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Faqat kun.oy.yil — 29.08.1995. */
export function checkBirthDate(text: string, today = new Date()): Check<string> {
  const parsed = parseDmy(text);
  if (!parsed.ok) return parsed;
  const age = (today.getTime() - parsed.value.getTime()) / (365.25 * 86_400_000);
  if (age < 14 || age > 80) return { ok: false, error: "Tug‘ilgan yilni tekshiring." };
  return { ok: true, value: iso(parsed.value) };
}

export function checkDate(text: string): Check<string> {
  const parsed = parseDmy(text);
  return parsed.ok ? { ok: true, value: iso(parsed.value) } : parsed;
}

/** Faqat O‘zbekiston raqami: +998XXXXXXXXX (bo‘sh joy va chiziqchalar olib tashlanadi). */
export function checkPhone(text: string): Check<string> {
  const value = text.trim().replace(/[\s()-]/g, "");
  if (!/^\+998\d{9}$/.test(value))
    return { ok: false, error: "Faqat telefon raqam qabul qilinadi: +998 bilan, 9 ta raqam. Misol: +998932303410" };
  return { ok: true, value };
}

export function checkText(text: string, min = 2, max = 300): Check<string> {
  const value = text.trim().replace(/\s+/g, " ");
  if (value.length < min) return { ok: false, error: "Javobni to‘liqroq yozing." };
  if (value.length > max) return { ok: false, error: `Juda uzun — ${max} belgigacha yozing.` };
  return { ok: true, value };
}

export function checkAddress(text: string): Check<string> {
  const result = checkText(text, 5, 200);
  return result.ok ? result : { ok: false, error: "Manzilni to‘liqroq yozing. Misol: Chilonzor tumani, 12-kvartal" };
}

export function checkNumber(text: string): Check<string> {
  const value = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(value)) return { ok: false, error: "Faqat raqam yozing. Misol: 5" };
  return { ok: true, value };
}

/** Yosh — butun son, 14 dan 80 gacha. */
export function checkAge(text: string): Check<string> {
  const value = text.trim().replace(/\s/g, "");
  const age = /^\d{1,3}$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(age) || age < 14 || age > 80) return { ok: false, error: "Yoshingizni butun son bilan yozing (14 dan 80 gacha). Misol: 25" };
  return { ok: true, value: String(age) };
}

/** Email — oddiy tekshiruv: nom@domen.zona (bo‘sh joysiz, kichik harfga keltiriladi). */
export function checkEmail(text: string): Check<string> {
  const value = text.trim().toLowerCase();
  const ok =
    value.length <= 120 &&
    /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9_%+-])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/.test(value) &&
    !value.includes("..");
  return ok ? { ok: true, value } : { ok: false, error: "Email manzilni to‘g‘ri yozing. Misol: ali.valiyev@gmail.com" };
}

/** «09:00 - 18:00», «9:00-18:00», «14.00 – 00.00». */
export function checkWorkHours(text: string): Check<string> {
  const match = /^(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})$/.exec(text.trim());
  if (!match) return { ok: false, error: "Vaqtni «09:00 - 18:00» ko‘rinishida yozing." };
  const [h1, m1, h2, m2] = match.slice(1).map(Number);
  if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59) return { ok: false, error: "Soat 00:00 dan 23:59 gacha bo‘lsin." };
  const clock = (h: number, m: number) => `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const start = clock(h1, m1);
  const end = clock(h2, m2);
  if (start === end) return { ok: false, error: "Boshlanish va tugash vaqti bir xil bo‘lmasin." };
  return { ok: true, value: `${start} - ${end}` };
}

/** JShShIR (PINFL) — 14 raqam (bo‘sh joylar olib tashlanadi). */
export function checkPinfl(text: string): Check<string> {
  const value = text.replace(/[\s-]/g, "");
  if (!/^\d{14}$/.test(value)) return { ok: false, error: "JShShIR 14 ta raqamdan iborat bo‘lishi kerak. Misol: 31508951234567" };
  return { ok: true, value };
}

export function checkSalary(text: string): Check<number> {
  const value = parseSalary(text);
  if (!value || value < 1_000 || value > 10_000_000_000) return { ok: false, error: "Summani so‘mda raqam bilan yozing. Misol: 4 000 000" };
  return { ok: true, value };
}

/** Matn bilan javob beriladigan savol uchun tekshiruv. Tugmali savolda — undefined. */
export function validateText(question: RegistrationQuestion, text: string): Check<string | number> | undefined {
  switch (question.type) {
    case "name":
      return checkFullName(text);
    case "birthdate":
      return checkBirthDate(text);
    case "date":
      return checkDate(text);
    case "phone":
      return checkPhone(text);
    case "money":
      return checkSalary(text);
    case "number":
      return checkNumber(text);
    case "workHours":
      return checkWorkHours(text);
    case "pinfl":
      return checkPinfl(text);
    case "age":
      return checkAge(text);
    case "email":
      return checkEmail(text);
    case "photo":
      return { ok: false, error: "Bu savolga javob sifatida rasm yuboring (📎 → Rasm)." };
    case "text":
      return question.field === "address" ? checkAddress(text) : checkText(text);
    default:
      return undefined;
  }
}

/* ------------------------------------------------------ qiymatlar --- */

export function getValue(question: RegistrationQuestion, data: RegistrationData): string | number | undefined {
  if (question.field) return data[question.field] as string | number | undefined;
  return data.custom?.[question.id];
}

export function setValue(question: RegistrationQuestion, data: RegistrationData, value: string | number | undefined) {
  // Login o‘zgarsa (yoki tozalansa) — avvalgi parol ham bekor (parol aynan shu login uchun yozilgan).
  if (question.field === "appLogin") delete data.appPasswordHash;
  if (question.field) (data as Record<string, unknown>)[question.field] = value;
  else {
    data.custom ||= {};
    if (value === undefined) delete data.custom[question.id];
    else data.custom[question.id] = String(value);
  }
}

export const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
export const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type Lookups = { positions: Map<string, string>; branches: Map<string, string> };
export function lookupsFor(db: Database, companyId: string): Lookups {
  return {
    positions: new Map(db.positions.filter((p) => p.companyId === companyId).map((p) => [p.id, p.name])),
    branches: new Map(db.branches.filter((b) => b.companyId === companyId).map((b) => [b.id, b.name])),
  };
}

export function describe(question: RegistrationQuestion, data: RegistrationData, lookups: Lookups) {
  const value = getValue(question, data);
  if (value === undefined || value === "") return "—";
  switch (question.type) {
    case "birthdate":
    case "date":
      return String(value).split("-").reverse().join(".");
    case "position":
      return lookups.positions.get(String(value)) || "—";
    case "branch":
      return lookups.branches.get(String(value)) || "—";
    case "shift":
      return SHIFTS[value as keyof typeof SHIFTS]?.short || "—";
    case "money":
      return money(Number(value));
    case "weekday":
      return Number(value) < 0 ? "Dam olishsiz" : WEEKDAYS[Number(value)];
    case "gender":
      return value === "MALE" ? "Erkak" : value === "FEMALE" ? "Ayol" : String(value);
    case "photo":
      return "✅ Rasm yuklandi";
    case "login":
      return `${value} · parol: ••••••`;
    default:
      return String(value);
  }
}

/** Qisqa nom (xulosa va panel uchun): tizim maydonida — label, qo‘shimchada — savol matni. */
export function shortLabel(question: RegistrationQuestion) {
  if (question.field) return BUILTINS[question.field].label;
  return question.title.replace(/[?.:!]+$/, "").slice(0, 60);
}

/* ---------------------------------------------------------- tugmalar --- */

export type Button = { label: string; value: string };

/** Tugmali savol uchun variantlar (qatorlarga bo‘lingan). Matnli savol — null. */
export function buttonsFor(question: RegistrationQuestion, db: Database, companyId: string, data: RegistrationData): Button[][] | null {
  const rows = (items: Button[], perRow: number) => {
    const out: Button[][] = [];
    items.forEach((item, i) => {
      if (i % perRow === 0) out.push([]);
      out[out.length - 1].push(item);
    });
    return out;
  };
  switch (question.type) {
    case "position":
      return rows(
        db.positions
          .filter((p) => p.companyId === companyId)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => ({ label: p.name.slice(0, 40), value: p.id })),
        2,
      );
    case "branch":
      return rows(
        db.branches
          .filter((b) => b.companyId === companyId && b.status === "ACTIVE")
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((b) => ({ label: b.name.slice(0, 40), value: b.id })),
        2,
      );
    case "shift": {
      // Kompaniyadagi grafiklar soatlari bilan: «☀️ Kunduzgi · 08:00–19:00, 09:00–18:00».
      const hoursOf = (shift: "DAY" | "NIGHT") =>
        [...new Set(companySchedules(db, companyId, shift).map((s) => scheduleHours(s)!.replace(" - ", "–")))].slice(0, 2).join(", ");
      return (Object.keys(SHIFTS) as (keyof typeof SHIFTS)[]).map((key) => {
        const hours = key === "BOTH" ? "" : hoursOf(key);
        return [{ label: `${SHIFTS[key].label}${hours ? ` · ${hours}` : ""}`.slice(0, 60), value: key }];
      });
    }
    case "workHours": {
      // Tanlangan smenadagi mavjud ish grafiklari (vaqt va kunlari bilan); bo‘lmasa — tayyor variantlar.
      const schedules = companySchedules(db, companyId, data.shift);
      if (schedules.length)
        return [
          ...schedules.slice(0, 8).map((s) => [{ label: `🕒 ${scheduleHours(s)} · ${scheduleDaysLabel(s)}`.slice(0, 60), value: `s:${s.id}` }]),
          [{ label: "✍️ Boshqa vaqt", value: "__other" }],
        ];
      const presets = (question.options || []).filter((option) => {
        const hour = Number(option.slice(0, 2));
        if (data.shift === "DAY") return hour < 12;
        if (data.shift === "NIGHT") return hour >= 12;
        return true;
      });
      return [...rows(presets.map((p) => ({ label: `🕒 ${p}`, value: p })), 2), [{ label: "✍️ Boshqa vaqt", value: "__other" }]];
    }
    case "weekday":
      return [...rows(WEEK_ORDER.map((day) => ({ label: WEEKDAYS[day], value: String(day) })), 3), [{ label: "♾ Dam olishsiz", value: "-1" }]];
    case "choice":
      return (question.options || []).map((option, i) => [{ label: option.slice(0, 60), value: String(i) }]);
    case "yesno":
      return [[{ label: "✅ Ha", value: "Ha" }, { label: "❌ Yo‘q", value: "Yo‘q" }]];
    case "gender":
      return [[{ label: "👨 Erkak", value: "MALE" }, { label: "👩 Ayol", value: "FEMALE" }]];
    case "login": {
      // Login tanlangan — endi parol yoziladi; xohlasa boshqa login tanlaydi.
      if (data.appLogin) return [[{ label: "✏️ Boshqa login", value: "__relogin" }]];
      const [first, last] = splitName(data.fullName || "");
      const suggested = suggestFreeLogin(db, first, last);
      return [[{ label: `✅ ${suggested}`, value: suggested.slice(0, -LOGIN_SUFFIX.length) }]];
    }
    default:
      return null;
  }
}

/** Tugma bosilganda qiymatni tekshiradi va saqlanadigan ko‘rinishga keltiradi. */
export function parseButton(question: RegistrationQuestion, value: string, db: Database, companyId: string): Check<string | number> {
  const bad: Check<never> = { ok: false, error: "Variant topilmadi" };
  switch (question.type) {
    case "position":
      return db.positions.some((p) => p.id === value && p.companyId === companyId) ? { ok: true, value } : bad;
    case "branch":
      return db.branches.some((b) => b.id === value && b.companyId === companyId) ? { ok: true, value } : bad;
    case "shift":
      return value in SHIFTS ? { ok: true, value } : bad;
    case "workHours": {
      if (value.startsWith("s:")) {
        const schedule = db.schedules.find((s) => s.id === value.slice(2) && s.companyId === companyId);
        const hours = schedule && scheduleHours(schedule);
        return hours ? { ok: true, value: hours } : bad;
      }
      return (question.options || []).includes(value) ? { ok: true, value } : bad;
    }
    case "weekday": {
      const day = Number(value);
      return day === -1 || (day >= 0 && day <= 6) ? { ok: true, value: day } : bad;
    }
    case "choice": {
      const option = question.options?.[Number(value)];
      return option ? { ok: true, value: option } : bad;
    }
    case "yesno":
      return value === "Ha" || value === "Yo‘q" ? { ok: true, value } : bad;
    case "gender":
      return value === "MALE" || value === "FEMALE" ? { ok: true, value } : bad;
    case "login": {
      const check = checkLoginInput(value);
      return check.ok ? { ok: true, value: check.login } : { ok: false, error: check.error };
    }
    default:
      return bad;
  }
}

/* -------------------------------------------------- holatni boshqarish --- */

export const firstStep = (form: RegistrationForm) => activeQuestions(form)[0]?.id || "summary";

/** Savolga javob berilganmi. Ilova logini — login VA parol yozilgandagina. */
function answered(question: RegistrationQuestion, data: RegistrationData) {
  const value = getValue(question, data);
  if (value === undefined || value === "") return false;
  return question.field !== "appLogin" || Boolean(data.appPasswordHash);
}

export function isComplete(form: RegistrationForm, data: RegistrationData) {
  return activeQuestions(form).every((q) => !q.required || answered(q, data));
}

/** Javobdan keyingi qadam. Tahrirlashda — xulosa (smena o‘zgarsa ish vaqti qayta so‘raladi). */
export function nextStep(form: RegistrationForm, request: RegistrationRequest, answered: string): string {
  const questions = activeQuestions(form);
  const question = findQuestion(form, answered);
  const hours = questions.find((q) => q.type === "workHours");
  if (question?.type === "shift" && hours) return hours.id;
  if (request.editing) return isComplete(form, request.data) ? "summary" : firstUnanswered(form, request.data);
  const index = questions.findIndex((q) => q.id === answered);
  return questions[index + 1]?.id || "summary";
}

export function firstUnanswered(form: RegistrationForm, data: RegistrationData) {
  return activeQuestions(form).find((q) => q.required && !answered(q, data))?.id || "summary";
}

export function previousStep(form: RegistrationForm, step: string): string | undefined {
  const questions = activeQuestions(form);
  const index = questions.findIndex((q) => q.id === step);
  return index > 0 ? questions[index - 1].id : undefined;
}

export function progressBar(form: RegistrationForm, step: string) {
  const questions = activeQuestions(form);
  const index = questions.findIndex((q) => q.id === step);
  const current = index < 0 ? questions.length : index + 1;
  const total = Math.max(1, questions.length);
  const filled = Math.round((current / total) * 10);
  return `${"▰".repeat(filled)}${"▱".repeat(10 - filled)}  ${current}/${total}`;
}

/* ---------------------------------------------------------- matnlar --- */

export function questionText(form: RegistrationForm, question: RegistrationQuestion, companyName: string, data: RegistrationData, confirming = false) {
  // Sarlavhasiz, progress chizig‘isiz — faqat savolning o‘zi.
  void companyName;
  const head = "";
  if (confirming) return `${head}${escape(question.title)}\n\nSiz yozdingiz: <b>${escape(describe(question, data, { positions: new Map(), branches: new Map() }))}</b>\nTo‘g‘rimi?`;
  // Ilova logini tanlangan — ikkinchi qadam: parol.
  if (question.type === "login" && data.appLogin)
    return `🔑 <b>Endi parol o‘ylab toping va yozing.</b>\nLogin: <code>${escape(data.appLogin)}</code>\nKamida 8 belgi, harf va raqam bo‘lsin. Xabaringiz chatdan darhol o‘chiriladi.`;
  const optional = question.required ? "" : "\n<i>Ixtiyoriy — o‘tkazib yuborish mumkin.</i>";
  return `${head}<b>${escape(question.title)}</b>${question.hint ? `\n${escape(question.hint)}` : ""}${optional}`;
}

export function summaryText(form: RegistrationForm, request: RegistrationRequest, companyName: string, lookups: Lookups, footer?: string) {
  const questions = (request.questions?.length ? request.questions : activeQuestions(form)).filter((q) => q.enabled);
  const rows = questions.map((q) => `• ${escape(shortLabel(q))}: <b>${escape(describe(q, request.data, lookups))}</b>`).join("\n");
  void companyName;
  return `📋 <b>Anketangiz</b>

${rows}${footer ? `\n\n${footer}` : ""}`;
}

/* ------------------------------------------------ tasdiqlash (xodim) --- */

function nextEmployeeNo(db: Database, tenant: string) {
  const numbers = db.employees.filter((e) => e.companyId === tenant).map((e) => Number(e.employeeNo.replace(/\D/g, "")) || 0);
  return `EMP-${String(Math.max(0, ...numbers) + 1).padStart(4, "0")}`;
}

/** Ish vaqti + dam olish kuni bo‘yicha grafikni topadi yoki yaratadi. */
function scheduleFor(db: Database, companyId: string, workHours: string | undefined, restDay: number | undefined, actor: string) {
  if (!workHours) {
    const existing = db.schedules.find((s) => s.companyId === companyId);
    if (existing) return existing.id;
    workHours = "09:00 - 18:00";
  }
  const [start, end] = workHours.split(" - ");
  const rest = restDay !== undefined && restDay >= 0 ? [restDay] : [];
  const name = `${start}–${end}${rest.length ? ` · dam: ${WEEKDAYS[rest[0]].slice(0, 2)}` : " · har kuni"}`;
  const found = db.schedules.find((s) => s.companyId === companyId && s.name === name);
  if (found) return found.id;
  const schedule: Schedule = {
    id: randomUUID(),
    companyId,
    name,
    type: "FIXED",
    graceMinutes: 5,
    overtimeEnabled: true,
    days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: !rest.includes(day), start, end: end === "00:00" ? "23:59" : end, breakMinutes: 0 })),
  };
  db.schedules.push(schedule);
  db.auditLogs.unshift(audit(companyId, actor, "Ish grafigi yaratildi (anketa)", "schedule", schedule.id));
  return schedule.id;
}

/** Anketa mavjud (faol) xodimga mos keladimi: o‘sha Telegram yoki o‘sha telefon raqami — tasdiqlansa, o‘sha profil yangilanadi. */
export function findExistingEmployee(db: Database, request: RegistrationRequest) {
  const key = phoneKey(request.data.phone);
  return db.employees.find(
    (e) =>
      e.companyId === request.companyId &&
      e.status === "ACTIVE" &&
      (e.telegramId === request.telegramId || (key.length >= 9 && phoneKey(e.phone) === key)),
  );
}

/**
 * HR uchun ogohlantirish: anketa mavjud xodimga mos keladi. `phone` — telefon bir xil, lekin Telegram boshqa
 * (boshqa odam hamkasbining raqamini yozgan bo‘lishi mumkin: tasdiqlansa o‘sha profil shu Telegram’ga o‘tadi).
 */
export function existingEmployeeMatch(db: Database, request: RegistrationRequest) {
  const employee = findExistingEmployee(db, request);
  if (!employee) return undefined;
  const by: "telegram" | "phone" = employee.telegramId === request.telegramId ? "telegram" : "phone";
  const name = `${employee.firstName} ${employee.lastName}`.trim();
  const warning =
    by === "phone"
      ? `⚠️ <b>Diqqat:</b> bu telefon raqami mavjud xodimniki — <b>${escape(name)}</b> (Telegram hisobi boshqa). Tasdiqlansa, o‘sha xodim profili shu Telegram hisobiga o‘tadi. Tasdiqlashdan oldin shaxsini tekshiring.`
      : `ℹ️ Mavjud xodim profili yangilanadi: <b>${escape(name)}</b>.`;
  return { employee, by, name, warning };
}

/**
 * Arizani tasdiqlaydi: xodim yaratiladi (yoki telefon/Telegram bo‘yicha mavjudi
 * yangilanadi — dublikat bo‘lmaydi). updateDb ichida chaqiriladi.
 */
export function approveRegistration(db: Database, request: RegistrationRequest, actor: string, extra: { selfieDataUrl?: string } = {}): Employee {
  if (request.status !== "PENDING") throw Object.assign(new Error("Ariza allaqachon ko‘rib chiqilgan."), { status: 409 });
  const data = request.data;
  const tenant = request.companyId;
  const position = db.positions.find((p) => p.id === data.positionId && p.companyId === tenant);
  const branch = db.branches.find((b) => b.id === data.branchId && b.companyId === tenant);
  if (!data.fullName || !data.phone) throw Object.assign(new Error("Anketada ism yoki telefon yo‘q."), { status: 422 });
  if (!position) throw Object.assign(new Error("Anketadagi lavozim topilmadi — boshqasini tanlang."), { status: 422 });
  if (!branch) throw Object.assign(new Error("Anketadagi filial topilmadi — boshqasini tanlang."), { status: 422 });
  const [firstName, ...rest] = data.fullName.split(" ");
  const now = new Date().toISOString();
  // Qo‘shimcha savollar — profilga «savol → javob» ko‘rinishida.
  const questions = request.questions || [];
  const customFields: Record<string, string> = {};
  for (const [id, value] of Object.entries(data.custom || {})) {
    const question = questions.find((q) => q.id === id);
    if (value) customFields[question ? shortLabel(question) : id] = question ? describe(question, data, { positions: new Map(), branches: new Map() }) : value;
  }
  const fields = {
    firstName,
    lastName: rest.join(" "),
    birthDate: data.birthDate,
    gender: data.gender,
    pinfl: data.pinfl,
    phone: data.phone,
    parentPhone: data.parentPhone,
    ...(data.email ? { email: data.email } : {}),
    address: data.address,
    positionId: position.id,
    departmentId: position.departmentId,
    branchId: branch.id,
    // Mavjud grafik tanlangan bo‘lsa — o‘sha; dam olish kuni grafikda ish kuni bo‘lsa — shaxsiy dam kuni.
    scheduleId: data.scheduleId && db.schedules.some((s) => s.id === data.scheduleId && s.companyId === tenant) ? data.scheduleId : scheduleFor(db, tenant, data.workHours, data.restDay, actor),
    restDays:
      data.scheduleId && data.restDay !== undefined && data.restDay >= 0 && db.schedules.find((s) => s.id === data.scheduleId)?.days.find((d) => d.day === data.restDay)?.enabled
        ? [data.restDay]
        : undefined,
    shift: data.shift,
    education: data.education,
    customFields: Object.keys(customFields).length ? customFields : undefined,
    telegramId: request.telegramId,
    telegramUsername: request.telegramUsername,
    telegramConnected: true,
    telegramChannel: "COMPANY_BOT" as const,
    telegramIdSource: "LINK" as const,
    deviceStatus: "CONNECTED" as const,
    registrationId: request.id,
    updatedAt: now,
  };
  if (!fields.restDays) delete (fields as Partial<typeof fields>).restDays;
  // Bitta Telegram hisob — bitta xodim.
  for (const other of db.employees)
    if (other.companyId === tenant && other.telegramId === request.telegramId && other.status !== "ACTIVE") {
      other.telegramId = undefined;
      other.telegramConnected = false;
    }
  const existing = findExistingEmployee(db, request);
  let employee: Employee;
  if (existing) {
    const before = { ...existing };
    Object.assign(existing, fields, { baseSalary: existing.baseSalary || data.salary || 0 });
    employee = existing;
    db.auditLogs.unshift(audit(tenant, actor, "Ariza tasdiqlandi — mavjud xodim yangilandi", "employee", existing.id, before, { ...existing }));
  } else {
    assertEmployeeCapacity(db, tenant);
    employee = {
      id: randomUUID(),
      companyId: tenant,
      employeeNo: nextEmployeeNo(db, tenant),
      email: "",
      employmentType: "FULL_TIME",
      startDate: tashkentIsoDate(),
      currency: "UZS",
      status: "ACTIVE",
      createdAt: now,
      baseSalary: data.salary || 0,
      ...fields,
    };
    db.employees.push(employee);
    db.auditLogs.unshift(audit(tenant, actor, "Botdagi anketa tasdiqlandi — xodim qo‘shildi", "employee", employee.id, undefined, employee));
  }
  // Anketadagi yuz rasmi — profil rasmi va Face ID namunasi (boshqa xodimning yuziga o‘xshasa — faqat rasm).
  if (extra.selfieDataUrl) {
    if (data.selfieDescriptor?.length)
      try {
        applyPanelReference(db, employee, extra.selfieDataUrl, data.selfieDescriptor, actor);
      } catch (error) {
        employee.photoDataUrl = extra.selfieDataUrl;
        db.auditLogs.unshift(audit(tenant, actor, `Anketa rasmi Face ID namunasi qilinmadi: ${(error as Error).message}`, "employee", employee.id));
      }
    else employee.photoDataUrl = extra.selfieDataUrl;
  }
  // Anketadagi pasport / ID karta rasmi — xodim hujjatlariga (fayl o‘sha, nusxa olinmaydi).
  if (data.idDocument && !db.documents.some((d) => d.id === data.idDocument))
    db.documents.push({
      id: data.idDocument,
      companyId: tenant,
      employeeId: employee.id,
      type: "PASSPORT",
      title: "Pasport / ID karta (anketa)",
      mime: data.idDocumentMime || "image/jpeg",
      size: data.idDocumentSize || 0,
      uploadedBy: "Bot anketasi",
      createdAt: now,
    });
  request.status = "APPROVED";
  request.employeeId = employee.id;
  request.decidedBy = actor;
  request.decidedAt = now;
  request.updatedAt = now;
  return employee;
}

/**
 * Tasdiqlangan anketadagi ilova logini va parolini faollashtiradi (updateDb ichida, approveRegistration dan keyin).
 * Parol xeshi anketadan o‘chiriladi (staffCredentials ga o‘tadi). Login shu orada band bo‘lib qolgan bo‘lsa —
 * ariza baribir tasdiqlanadi, xodim loginni keyin Mini App → Profil → «Ilovaga kirish» da o‘rnatadi.
 *
 * Xavfsizlik: ochiq botdagi anketa MAVJUD xodimning kirish ma’lumotini hech qachon yaratmaydi va almashtirmaydi
 * (aks holda hamkasbining telefonini yozib, o‘z parolini qo‘yib uning hisobini egallash mumkin bo‘lardi).
 * Mavjud xodimga mos kelgan anketada (`matchedExisting`) yoki xodimda allaqachon login bo‘lsa — login berilmaydi.
 */
export function applyRegistrationLogin(
  db: Database,
  request: RegistrationRequest,
  employee: Employee,
  actor: string,
  options: { matchedExisting?: boolean } = {},
): { login?: string; taken?: boolean; existing?: boolean } {
  const { appLogin, appPasswordHash } = request.data;
  delete request.data.appPasswordHash;
  if (!appLogin || !appPasswordHash) return {};
  if (options.matchedExisting || credentialOfEmployee(db, employee.id) || employee.login) {
    delete request.data.appLogin;
    db.auditLogs.unshift(audit(request.companyId, actor, "Anketa mavjud xodimga mos keldi — ilova logini va paroli o‘zgartirilmadi", "employee", employee.id));
    return { existing: true };
  }
  const login = normalizeLogin(appLogin);
  if (isLoginTaken(db, login, { employeeId: employee.id, requestId: request.id })) {
    delete request.data.appLogin;
    db.auditLogs.unshift(audit(request.companyId, actor, "Anketadagi ilova logini band bo‘lib qoldi — login berilmadi", "employee", employee.id, undefined, { login }));
    return { taken: true };
  }
  setEmployeeCredential(db, employee, login, appPasswordHash);
  request.data.appLogin = login;
  db.auditLogs.unshift(audit(request.companyId, actor, "Ilovaga kirish logini berildi (anketa)", "employee", employee.id, undefined, { login }));
  return { login };
}

export function rejectRegistration(db: Database, request: RegistrationRequest, actor: string, reason?: string) {
  if (request.status !== "PENDING") throw Object.assign(new Error("Ariza allaqachon ko‘rib chiqilgan."), { status: 409 });
  // Rad etilgan anketada parol xeshi saqlanmaydi.
  delete request.data.appPasswordHash;
  const now = new Date().toISOString();
  request.status = "REJECTED";
  request.rejectReason = reason?.trim().slice(0, 300) || undefined;
  request.decidedBy = actor;
  request.decidedAt = now;
  request.updatedAt = now;
  db.auditLogs.unshift(audit(request.companyId, actor, "Botdagi anketa rad etildi", "registration", request.id, undefined, { reason: request.rejectReason }));
}
