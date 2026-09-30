import { randomUUID } from "node:crypto";
import { audit } from "../lib/store";
import { phoneKey, tashkentIsoDate } from "../lib/format";
import type { Database, Employee, RegistrationData, RegistrationRequest, RegistrationStep, Schedule } from "../lib/types";
import { parseSalary } from "./integrations/transform";

/*
 * Botda anketa orqali ro‘yxatdan o‘tish — holatsiz (sof) mantiq:
 * savollar, tekshiruvlar, tugmalar va xulosa matni. Telegram bilan ishlash
 * company-bots.ts da; bu yerdagini testlash oson.
 */

export const QUESTION_ORDER: Exclude<RegistrationStep, "salaryConfirm" | "summary" | "editPick">[] = [
  "fullName",
  "birthDate",
  "phone",
  "parentPhone",
  "positionId",
  "address",
  "branchId",
  "shift",
  "workHours",
  "salary",
  "restDay",
  "education",
];

export const EDUCATION_OPTIONS = [
  "O‘rta maxsus — farmatsevt",
  "O‘rta maxsus — boshqa soha",
  "Tugallanmagan o‘rta maxsus — farmatsevt",
  "Tugallanmagan o‘rta maxsus — boshqa soha",
  "Oliy — farmatsevt",
  "Tugallanmagan oliy — farmatsevt",
  "Oliy — boshqa soha",
  "Tugallanmagan oliy — boshqa soha",
  "Umumiy o‘rta ta’lim (diplom yo‘q)",
];

export const SHIFTS = {
  DAY: { label: "☀️ Kunduzgi smena", short: "Kunduzgi", hours: ["09:00 - 18:00"] },
  NIGHT: { label: "🌙 Kechki smena", short: "Kechki", hours: ["14:00 - 00:00"] },
  BOTH: { label: "🔄 Qo‘sh smena", short: "Qo‘sh smena", hours: ["09:00 - 18:00", "14:00 - 00:00"] },
} as const;

export const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
/** Tugmalarda Dushanbadan boshlanadi. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const FIELD_LABELS: Record<keyof RegistrationData, string> = {
  fullName: "👤 Ism-familiya",
  birthDate: "📅 Tug‘ilgan sana",
  phone: "📱 Telefon",
  parentPhone: "👪 Ota-ona telefoni",
  positionId: "💼 Lavozim",
  address: "🏠 Manzil",
  branchId: "🏢 Filial",
  shift: "🔀 Smena",
  workHours: "🕒 Ish vaqti",
  salary: "💰 Oylik",
  restDay: "🛌 Dam olish kuni",
  education: "🎓 Ma’lumoti",
};

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

/* ------------------------------------------------------- tekshiruvlar --- */

export function checkFullName(text: string): Check<string> {
  const value = text.trim().replace(/\s+/g, " ");
  const words = value.split(" ");
  if (value.length < 5 || value.length > 80 || words.length < 2)
    return { ok: false, error: "Ism va familiyani to‘liq yozing. Misol: Ali Valiyev" };
  if (!/^[\p{L}\s'‘’`ʻ-]+$/u.test(value)) return { ok: false, error: "Faqat harflardan foydalaning. Misol: Ali Valiyev" };
  return { ok: true, value: words.map((w) => w.charAt(0).toLocaleUpperCase("uz") + w.slice(1)).join(" ") };
}

/** Faqat kun.oy.yil — 29.08.1995. */
export function checkBirthDate(text: string, today = new Date()): Check<string> {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text.trim());
  if (!match) return { ok: false, error: "Sanani faqat kun.oy.yil ko‘rinishida yozing. Misol: 29.08.1995" };
  const [, dd, mm, yyyy] = match;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (date.getUTCDate() !== Number(dd) || date.getUTCMonth() !== Number(mm) - 1)
    return { ok: false, error: "Bunday sana yo‘q. Misol: 29.08.1995" };
  const age = (today.getTime() - date.getTime()) / (365.25 * 86_400_000);
  if (age < 14 || age > 80) return { ok: false, error: "Tug‘ilgan yilni tekshiring." };
  return { ok: true, value: `${yyyy}-${mm}-${dd}` };
}

/** Faqat O‘zbekiston raqami: +998XXXXXXXXX (bo‘sh joy va chiziqchalar olib tashlanadi). */
export function checkPhone(text: string): Check<string> {
  const value = text.trim().replace(/[\s()-]/g, "");
  if (!/^\+998\d{9}$/.test(value))
    return { ok: false, error: "Faqat telefon raqam qabul qilinadi: +998 bilan, 9 ta raqam. Misol: +998932303410" };
  return { ok: true, value };
}

export function checkAddress(text: string): Check<string> {
  const value = text.trim().replace(/\s+/g, " ");
  if (value.length < 5 || value.length > 200) return { ok: false, error: "Manzilni to‘liqroq yozing. Misol: Chilonzor tumani, 12-kvartal" };
  return { ok: true, value };
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

export function checkSalary(text: string): Check<number> {
  const value = parseSalary(text);
  if (!value || value < 100_000 || value > 1_000_000_000)
    return { ok: false, error: "Oylikni so‘mda raqam bilan yozing. Misol: 4 000 000" };
  return { ok: true, value };
}

/* ---------------------------------------------------------- ko‘rinish --- */

export const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function progressBar(step: RegistrationStep) {
  const index = QUESTION_ORDER.indexOf(step as (typeof QUESTION_ORDER)[number]);
  const current = index < 0 ? QUESTION_ORDER.length : index + 1;
  const total = QUESTION_ORDER.length;
  const filled = Math.round((current / total) * 10);
  return `${"▰".repeat(filled)}${"▱".repeat(10 - filled)}  ${current}/${total}`;
}

export function questionText(step: RegistrationStep, data: RegistrationData, company: string) {
  const head = `🏢 <b>${escape(company)}</b> · xodim anketasi\n${progressBar(step)}\n\n`;
  switch (step) {
    case "fullName":
      return `${head}👤 <b>Ism va familiyangizni yozing.</b>\nMisol: <i>Ali Valiyev</i>`;
    case "birthDate":
      return `${head}📅 <b>Tug‘ilgan sanangiz.</b>\nFaqat <b>kun.oy.yil</b> ko‘rinishida.\nMisol: <i>29.08.1995</i>`;
    case "phone":
      return `${head}📱 <b>Telefon raqamingizni yozing.</b>\n+998 bilan, bo‘sh joysiz, bitta raqam.\nMisol: <i>+998932303410</i>`;
    case "parentPhone":
      return `${head}👪 <b>Ota yoki onangizning telefon raqami.</b>\n+998 bilan, bo‘sh joysiz.\nMisol: <i>+998901234567</i>`;
    case "positionId":
      return `${head}💼 <b>Qaysi lavozimda ishlaysiz?</b>\nPastdan tanlang:`;
    case "address":
      return `${head}🏠 <b>Yashash manzilingiz.</b>\nMisol: <i>Chilonzor tumani, 12-kvartal</i>`;
    case "branchId":
      return `${head}🏢 <b>Qaysi filialda ishlaysiz?</b>\nPastdan tanlang:`;
    case "shift":
      return `${head}🔀 <b>Qaysi smenada ishlaysiz?</b>\n\n☀️ Kunduzgi — odatda 09:00 - 18:00\n🌙 Kechki — odatda 14:00 - 00:00\n🔄 Qo‘sh smena — ikkalasi`;
    case "workHours":
      return `${head}🕒 <b>Ish vaqtingiz nechidan nechigacha?</b>\nTayyor variantni tanlang yoki «Boshqa» ni bosib o‘zingiz yozing.`;
    case "salary":
      return `${head}💰 <b>Oyligingiz qancha?</b>\nMisol: <i>4 000 000</i>`;
    case "salaryConfirm":
      return `${head}💰 Oyligingiz: <b>${money(data.salary || 0)}</b>\nTo‘g‘rimi?`;
    case "restDay":
      return `${head}🛌 <b>Haftaning qaysi kuni dam olasiz?</b>`;
    case "education":
      return `${head}🎓 <b>Ma’lumotingiz qanday?</b>`;
    default:
      return head;
  }
}

export function describeField(key: keyof RegistrationData, data: RegistrationData, lookup: { position?: string; branch?: string }) {
  const value = data[key];
  if (value === undefined || value === "") return "—";
  switch (key) {
    case "birthDate":
      return String(value).split("-").reverse().join(".");
    case "positionId":
      return lookup.position || "—";
    case "branchId":
      return lookup.branch || "—";
    case "shift":
      return SHIFTS[value as keyof typeof SHIFTS]?.short || "—";
    case "salary":
      return money(Number(value));
    case "restDay":
      return Number(value) < 0 ? "Dam olishsiz" : WEEKDAYS[Number(value)];
    default:
      return String(value);
  }
}

export function summaryText(request: RegistrationRequest, company: string, lookup: { position?: string; branch?: string }, footer?: string) {
  const rows = (Object.keys(FIELD_LABELS) as (keyof RegistrationData)[])
    .map((key) => `${FIELD_LABELS[key]}: <b>${escape(describeField(key, request.data, lookup))}</b>`)
    .join("\n");
  return `🏢 <b>${escape(company)}</b> · xodim anketasi\n\n${rows}${footer ? `\n\n${footer}` : ""}`;
}

/* -------------------------------------------------- holatni boshqarish --- */

/** Keyingi savol (tahrirlashda — xulosa). */
export function nextStep(request: RegistrationRequest, answered: RegistrationStep): RegistrationStep {
  if (answered === "salary") return "salaryConfirm";
  if (request.editing && answered !== "shift") return "summary";
  if (answered === "salaryConfirm") return request.editing ? "summary" : "restDay";
  const index = QUESTION_ORDER.indexOf(answered as (typeof QUESTION_ORDER)[number]);
  // Smena o‘zgarsa ish vaqti ham qayta so‘raladi.
  if (answered === "shift") return "workHours";
  return QUESTION_ORDER[index + 1] || "summary";
}

export function previousStep(step: RegistrationStep): RegistrationStep | undefined {
  if (step === "salaryConfirm") return "salary";
  const index = QUESTION_ORDER.indexOf(step as (typeof QUESTION_ORDER)[number]);
  return index > 0 ? QUESTION_ORDER[index - 1] : undefined;
}

export function isComplete(data: RegistrationData) {
  return QUESTION_ORDER.every((key) => data[key] !== undefined && data[key] !== "");
}

/* ------------------------------------------------ tasdiqlash (xodim) --- */

function nextEmployeeNo(db: Database, tenant: string) {
  const numbers = db.employees.filter((e) => e.companyId === tenant).map((e) => Number(e.employeeNo.replace(/\D/g, "")) || 0);
  return `EMP-${String(Math.max(0, ...numbers) + 1).padStart(4, "0")}`;
}

/** Ish vaqti + dam olish kuni bo‘yicha grafikni topadi yoki yaratadi. */
function scheduleFor(db: Database, companyId: string, workHours: string, restDay: number, actor: string) {
  const [start, end] = workHours.split(" - ");
  const rest = restDay >= 0 ? [restDay] : [];
  const name = `${start}–${end}${rest.length ? ` · dam: ${WEEKDAYS[restDay].slice(0, 2)}` : " · har kuni"}`;
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

/**
 * Arizani tasdiqlaydi: xodim yaratiladi (yoki telefon/Telegram bo‘yicha mavjudi
 * yangilanadi — dublikat bo‘lmaydi). updateDb ichida chaqiriladi.
 */
export function approveRegistration(db: Database, request: RegistrationRequest, actor: string): Employee {
  if (request.status !== "PENDING") throw Object.assign(new Error("Ariza allaqachon ko‘rib chiqilgan."), { status: 409 });
  const data = request.data;
  if (!isComplete(data)) throw Object.assign(new Error("Anketa to‘liq emas."), { status: 422 });
  const tenant = request.companyId;
  const position = db.positions.find((p) => p.id === data.positionId && p.companyId === tenant);
  const branch = db.branches.find((b) => b.id === data.branchId && b.companyId === tenant);
  if (!position) throw Object.assign(new Error("Anketadagi lavozim o‘chirilgan — boshqasini tanlang."), { status: 422 });
  if (!branch) throw Object.assign(new Error("Anketadagi filial o‘chirilgan — boshqasini tanlang."), { status: 422 });
  const [firstName, ...rest] = (data.fullName || "").split(" ");
  const now = new Date().toISOString();
  const fields = {
    firstName,
    lastName: rest.join(" "),
    birthDate: data.birthDate,
    phone: data.phone!,
    parentPhone: data.parentPhone,
    address: data.address,
    positionId: position.id,
    departmentId: position.departmentId,
    branchId: branch.id,
    scheduleId: scheduleFor(db, tenant, data.workHours!, data.restDay ?? -1, actor),
    baseSalary: data.salary || 0,
    shift: data.shift,
    education: data.education,
    telegramId: request.telegramId,
    telegramUsername: request.telegramUsername,
    telegramConnected: true,
    telegramChannel: "COMPANY_BOT" as const,
    telegramIdSource: "LINK" as const,
    deviceStatus: "CONNECTED" as const,
    registrationId: request.id,
    updatedAt: now,
  };
  // Bitta Telegram hisob — bitta xodim.
  for (const other of db.employees)
    if (other.companyId === tenant && other.telegramId === request.telegramId && other.status !== "ACTIVE") {
      other.telegramId = undefined;
      other.telegramConnected = false;
    }
  const existing = db.employees.find(
    (e) =>
      e.companyId === tenant &&
      e.status === "ACTIVE" &&
      (e.telegramId === request.telegramId || (phoneKey(e.phone).length >= 9 && phoneKey(e.phone) === phoneKey(data.phone))),
  );
  let employee: Employee;
  if (existing) {
    const before = { ...existing };
    Object.assign(existing, fields, { baseSalary: existing.baseSalary || fields.baseSalary });
    employee = existing;
    db.auditLogs.unshift(audit(tenant, actor, "Ariza tasdiqlandi — mavjud xodim yangilandi", "employee", existing.id, before, { ...existing }));
  } else {
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
      ...fields,
    };
    db.employees.push(employee);
    db.auditLogs.unshift(audit(tenant, actor, "Botdagi anketa tasdiqlandi — xodim qo‘shildi", "employee", employee.id, undefined, employee));
  }
  request.status = "APPROVED";
  request.employeeId = employee.id;
  request.decidedBy = actor;
  request.decidedAt = now;
  request.updatedAt = now;
  return employee;
}

export function rejectRegistration(db: Database, request: RegistrationRequest, actor: string, reason?: string) {
  if (request.status !== "PENDING") throw Object.assign(new Error("Ariza allaqachon ko‘rib chiqilgan."), { status: 409 });
  const now = new Date().toISOString();
  request.status = "REJECTED";
  request.rejectReason = reason?.trim().slice(0, 300) || undefined;
  request.decidedBy = actor;
  request.decidedAt = now;
  request.updatedAt = now;
  db.auditLogs.unshift(audit(request.companyId, actor, "Botdagi anketa rad etildi", "registration", request.id, undefined, { reason: request.rejectReason }));
}
