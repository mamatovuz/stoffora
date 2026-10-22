import { companyModuleEnabled } from "./modules";
import type { Database, User } from "../lib/types";
import { readDb, updateDb } from "../lib/store";
import { can } from "../lib/permissions";
import { duration, tashkentIsoDate } from "../lib/format";
import { tallyPeriod } from "./analytics";
import { buildAttendanceWorkbook, buildPayrollWorkbook } from "./reports";
import { monthLabel } from "./payroll-routes";
import { sendTelegramDocument, sendTelegramMessage } from "./telegram";

/*
 * Rahbarlarga avtomatik hisobot (Telegram):
 *   • haftalik — har dushanba 08:30: o‘tgan hafta (dushanba–yakshanba) xulosasi + davomat Excel;
 *   • oylik — oyning 1-kuni 08:30: o‘tgan oy xulosasi + davomat Excel + ish haqi qaydnomasi
 *     (faqat ish haqini ko‘rish huquqi borlarga).
 * Kimga: kompaniya egasi va HR — butun kompaniya; filial rahbari — faqat o‘z filiallari.
 * Telegram’i ulangan panel foydalanuvchilariga. Takror yuborilmaydi (sentGreetings belgisi).
 */

export type DigestKind = "weekly" | "monthly";
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dm = (d: string) => d.split("-").reverse().slice(0, 2).join(".");

export function digestPeriod(kind: DigestKind, today = tashkentIsoDate()) {
  const t = Date.parse(`${today}T00:00:00Z`);
  if (kind === "weekly") {
    // O‘tgan to‘liq hafta: dushanba – yakshanba
    const weekday = (new Date(t).getUTCDay() + 6) % 7; // 0 — dushanba
    const from = iso(t - (weekday + 7) * DAY);
    const to = iso(t - (weekday + 1) * DAY);
    return { from, to, label: `${dm(from)} – ${dm(to)}` };
  }
  const d = new Date(t);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
  const month = first.toISOString().slice(0, 7);
  return { from: iso(first.getTime()), to: iso(last.getTime()), month, label: monthLabel(month) };
}

type Recipient = { user: User; branches: Set<string> | null; payroll: boolean };

export function digestRecipients(db: Database, companyId: string): Recipient[] {
  const settings = db.companies.find((c) => c.id === companyId)?.reportDigest || {};
  const out: Recipient[] = [];
  for (const user of db.users) {
    if (user.companyId !== companyId || !user.telegramId) continue;
    const payroll = settings.payroll !== false && (user.role === "COMPANY_OWNER" || can(user.role, "payroll.view"));
    if (user.role === "COMPANY_OWNER" || user.role === "HR_ADMIN") out.push({ user, branches: null, payroll });
    else if (user.role === "BRANCH_MANAGER" && settings.branchManagers !== false && user.branchIds?.length)
      out.push({ user, branches: new Set(user.branchIds), payroll: false });
  }
  return out;
}

/** Xulosa matni (Telegram HTML). Ma’lumot bo‘lmasa — undefined. */
export function digestText(db: Database, companyId: string, kind: DigestKind, period: { from: string; to: string; label: string }, branches: Set<string> | null) {
  const tally = tallyPeriod(db, companyId, period.from, period.to, branches);
  const t = tally.total;
  if (!t.expected) return undefined;
  const company = db.companies.find((c) => c.id === companyId);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const branchRows = [...tally.byBranch.entries()]
    .map(([id, b]) => ({ name: db.branches.find((x) => x.id === id)?.name || "—", rate: pct(b.present, b.expected), late: b.late, expected: b.expected }))
    .filter((b) => b.expected > 0)
    .sort((a, b) => b.rate - a.rate);
  const late = tally.employees
    .map((e) => ({ e, t: tally.byEmployee.get(e.id)! }))
    .filter((x) => x.t && x.t.lateMinutes > 0)
    .sort((a, b) => b.t.lateMinutes - a.t.lateMinutes)
    .slice(0, 5);
  const absent = tally.employees
    .map((e) => ({ e, t: tally.byEmployee.get(e.id)! }))
    .filter((x) => x.t && x.t.absent > 0)
    .sort((a, b) => b.t.absent - a.t.absent)
    .slice(0, 5);
  const scope = branches ? ` · ${[...branches].map((id) => db.branches.find((b) => b.id === id)?.name).filter(Boolean).join(", ")}` : "";
  return [
    `📊 <b>${company?.name || "Staffora"} — ${kind === "weekly" ? "haftalik" : "oylik"} hisobot</b>`,
    `${period.label}${scope}`,
    "",
    `✅ Davomat: <b>${pct(t.present, t.expected)}%</b> (${t.present} / ${t.expected} ish kuni)`,
    `⏰ Vaqtida kelish: <b>${pct(t.present - t.late, t.present)}%</b> · kechikish ${t.late} marta${t.lateMinutes ? ` (${duration(t.lateMinutes)})` : ""}`,
    `❌ Kelmagan: ${t.absent} kun`,
    branchRows.length > 1 ? `\n🏢 Filiallar:\n${branchRows.map((b) => `• ${b.name} — ${b.rate}%${b.late ? `, kech ${b.late}` : ""}`).join("\n")}` : "",
    late.length ? `\n🐢 Ko‘p kechikkanlar:\n${late.map((x, i) => `${i + 1}. ${x.e.firstName} ${x.e.lastName} — ${duration(x.t.lateMinutes)} (${x.t.late} marta)`).join("\n")}` : "",
    absent.length ? `\n🚫 Ko‘p kelmaganlar:\n${absent.map((x, i) => `${i + 1}. ${x.e.firstName} ${x.e.lastName} — ${x.t.absent} kun`).join("\n")}` : "",
    "\n📎 Batafsil — ilova qilingan Excel faylda.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Hisobotlarni jo‘natadi. today — sana (jadval bo‘yicha); onlyUserId — faqat shu foydalanuvchiga
 * (sinov); force — «yuborilgan» belgisiga qaramay. Natija — yuborilgan xabarlar soni.
 */
export async function sendDigests(kind: DigestKind, options: { today?: string; companyId?: string; onlyUserId?: string; force?: boolean } = {}) {
  const today = options.today || tashkentIsoDate();
  const period = digestPeriod(kind, today);
  const db = await readDb();
  const sent = new Set(db.sentGreetings.map((g) => g.key));
  const marks: string[] = [];
  let count = 0;
  for (const company of db.companies) {
    if (options.companyId && company.id !== options.companyId) continue;
    if (company.status === "SUSPENDED") continue;
    if (!companyModuleEnabled(db, company.id, "reportDigest")) continue;
    const settings = company.reportDigest || {};
    if (!options.onlyUserId && settings[kind] === false) continue;
    for (const r of digestRecipients(db, company.id)) {
      if (options.onlyUserId && r.user.id !== options.onlyUserId) continue;
      const key = `digest:${kind}:${period.from}:${r.user.id}`;
      if (!options.force && sent.has(key)) continue;
      const text = digestText(db, company.id, kind, period, r.branches);
      if (!text) continue;
      const ok = await sendTelegramMessage(r.user.telegramId!, text).catch(() => false);
      if (!ok) continue;
      count += 1;
      marks.push(key);
      const attendance = buildAttendanceWorkbook(db, company.id, { from: period.from, to: period.to, today, branches: r.branches });
      const name = kind === "weekly" ? `davomat-${period.from}_${period.to}.xlsx` : `davomat-${period.month}.xlsx`;
      await sendTelegramDocument(r.user.telegramId!, Buffer.from(await attendance.xlsx.writeBuffer()), name, `Davomat · ${period.label}`).catch(() => false);
      if (kind === "monthly" && r.payroll && period.month) {
        const payroll = buildPayrollWorkbook(db, company.id, period.month);
        await sendTelegramDocument(r.user.telegramId!, Buffer.from(await payroll.xlsx.writeBuffer()), `ish-haqi-qaydnomasi-${period.month}.xlsx`, `Ish haqi qaydnomasi · ${period.label}`).catch(() => false);
      }
    }
  }
  if (marks.length)
    await updateDb((next) => {
      const at = new Date().toISOString();
      for (const key of marks) next.sentGreetings.push({ key, at });
    });
  return count;
}

/** Jadval: dushanba — haftalik, oyning 1-kuni — oylik (HR fon ishidan chaqiriladi). */
export async function runScheduledDigests(today = tashkentIsoDate()) {
  const day = new Date(`${today}T12:00:00Z`);
  let sent = 0;
  if (day.getUTCDay() === 1) sent += await sendDigests("weekly", { today });
  if (day.getUTCDate() === 1) sent += await sendDigests("monthly", { today });
  return sent;
}
