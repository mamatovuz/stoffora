import { randomUUID } from "node:crypto";
import { readDb, updateDb } from "../lib/store";
import { tashkentClock, tashkentIsoDate } from "../lib/format";
import type { Database, Employee } from "../lib/types";
import { notifyEmployee } from "./integrations/hooks";
import { cleanupDocumentFiles, DOCUMENT_TYPES } from "./documents";

/*
 * Kundalik HR ishlari (har 10 daqiqada tekshiradi, har biri kuniga bir marta):
 *   09:00 — tug‘ilgan kun va ish yubileyi tabriklari (xodimga va HR ga)
 *   09:05 — hujjat muddati eslatmalari (30, 7, 1 kun qolganda va o‘tganda)
 *   03:00 — o‘chirilgan hujjatlarning fayllarini tozalash
 * Takror yubormaslik uchun sentGreetings jadvali ishlatiladi.
 */

export type Celebration = {
  employeeId: string;
  name: string;
  kind: "BIRTHDAY" | "ANNIVERSARY";
  date: string;
  daysLeft: number;
  years: number;
};

/** Yaqin kunlardagi tug‘ilgan kun va ish yubileylari (bosh sahifa uchun). */
export function upcomingCelebrations(db: Pick<Database, "employees">, companyId: string, days = 14, today = tashkentIsoDate()): Celebration[] {
  const out: Celebration[] = [];
  const base = Date.parse(`${today}T00:00:00Z`);
  const year = Number(today.slice(0, 4));
  for (const e of db.employees) {
    if (e.companyId !== companyId || e.status !== "ACTIVE") continue;
    const push = (kind: Celebration["kind"], iso: string | undefined) => {
      if (!iso) return;
      const [y, m, d] = iso.split("-").map(Number);
      for (const candidateYear of [year, year + 1]) {
        const date = `${candidateYear}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - base) / 86_400_000);
        const years = candidateYear - y;
        if (diff >= 0 && diff <= days && (kind === "BIRTHDAY" || years >= 1)) {
          out.push({ employeeId: e.id, name: `${e.firstName} ${e.lastName}`.trim(), kind, date, daysLeft: diff, years });
          return;
        }
      }
    };
    push("BIRTHDAY", e.birthDate);
    push("ANNIVERSARY", e.startDate);
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

const yearsWord = (n: number) => `${n} yil`;

async function markSent(keys: string[]) {
  if (!keys.length) return;
  await updateDb((db) => {
    const at = new Date().toISOString();
    for (const key of keys) db.sentGreetings.push({ key, at });
  });
}

export async function runGreetings(today = tashkentIsoDate()) {
  const db = await readDb();
  const sent = new Set(db.sentGreetings.map((g) => g.key));
  const keys: string[] = [];
  const notes: { companyId: string; title: string; body: string }[] = [];
  for (const company of db.companies) {
    for (const c of upcomingCelebrations(db, company.id, 0, today)) {
      const key = `${c.kind}:${c.employeeId}:${today}`;
      if (sent.has(key)) continue;
      const employee = db.employees.find((e) => e.id === c.employeeId) as Employee;
      const text =
        c.kind === "BIRTHDAY"
          ? `🎂 <b>Tug‘ilgan kuningiz bilan, ${employee.firstName}!</b>\n\n${company.name} jamoasi sizga sog‘lik, baxt va omad tilaydi. 🎉`
          : `🏆 <b>${employee.firstName}, bugun ${company.name}dagi ishingizga ${yearsWord(c.years)} to‘ldi!</b>\n\nSadoqatingiz va mehnatingiz uchun rahmat. Oldinda yanada katta yutuqlar! 👏`;
      await notifyEmployee(db, employee, "hr", text).catch(() => undefined);
      notes.push({
        companyId: company.id,
        title: c.kind === "BIRTHDAY" ? "🎂 Tug‘ilgan kun" : "🏆 Ish yubileyi",
        body: c.kind === "BIRTHDAY" ? `Bugun ${c.name}ning tug‘ilgan kuni.` : `${c.name} bugun ${yearsWord(c.years)}lik ish yubileyini nishonlamoqda.`,
      });
      keys.push(key);
    }
  }
  if (notes.length)
    await updateDb((next) => {
      const at = new Date().toISOString();
      for (const n of notes) next.notifications.unshift({ id: randomUUID(), companyId: n.companyId, title: n.title, body: n.body, type: "HR", read: false, createdAt: at });
    });
  await markSent(keys);
  return keys.length;
}

const THRESHOLDS = [30, 7, 1, 0];

export async function runDocumentReminders(today = tashkentIsoDate()) {
  const db = await readDb();
  const sent = new Set(db.sentGreetings.map((g) => g.key));
  const keys: string[] = [];
  const notes: { companyId: string; title: string; body: string }[] = [];
  for (const doc of db.documents) {
    if (!doc.expiresAt) continue;
    const days = Math.round((Date.parse(`${doc.expiresAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    const threshold = THRESHOLDS.find((t) => (t === 0 ? days <= 0 : days === t));
    if (threshold === undefined || days < -1) continue;
    const key = `DOC:${doc.id}:${threshold}`;
    if (sent.has(key)) continue;
    const employee = db.employees.find((e) => e.id === doc.employeeId && e.status === "ACTIVE");
    if (!employee) continue;
    const label = doc.title || DOCUMENT_TYPES[doc.type];
    const when = days <= 0 ? "muddati tugadi" : `muddati ${days} kundan keyin tugaydi (${doc.expiresAt.split("-").reverse().join(".")})`;
    await notifyEmployee(db, employee, "hr", `📄 <b>${label}</b> — ${when}.\n\nIltimos, yangilangan hujjatni HR bo‘limiga topshiring yoki Staffora ilovasida yuklang.`).catch(() => undefined);
    notes.push({ companyId: doc.companyId, title: days <= 0 ? "Hujjat muddati tugadi" : "Hujjat muddati yaqin", body: `${employee.firstName} ${employee.lastName}: ${label} ${when}.` });
    keys.push(key);
  }
  if (notes.length)
    await updateDb((next) => {
      const at = new Date().toISOString();
      for (const n of notes) next.notifications.unshift({ id: randomUUID(), companyId: n.companyId, title: n.title, body: n.body, type: "DOCUMENT", read: false, createdAt: at });
    });
  await markSent(keys);
  return keys.length;
}

let timer: NodeJS.Timeout | undefined;
export function startHrWorker() {
  if (timer || process.env.HR_WORKER === "false") return;
  const done = new Set<string>();
  const tick = async () => {
    const today = tashkentIsoDate();
    const clock = tashkentClock();
    const once = async (name: string, at: string, job: () => Promise<unknown>) => {
      const key = `${name}:${today}`;
      if (clock < at || done.has(key)) return;
      done.add(key);
      await job().catch((error) => console.error(`HR ishi xatosi (${name})`, error));
    };
    await once("greetings", "09:00", () => runGreetings(today));
    await once("documents", "09:05", () => runDocumentReminders(today));
    await once("cleanup", "03:00", cleanupDocumentFiles);
    await once("digest", "08:30", async () => {
      const { sendWeeklyDigests } = await import("./analytics");
      await sendWeeklyDigests(today);
    });
  };
  timer = setInterval(() => void tick(), 10 * 60_000);
  timer.unref();
  setTimeout(() => void tick(), 30_000).unref();
}
