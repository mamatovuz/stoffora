import { dataIndexes, readDb } from "../lib/store";
import { dateParts, tashkentClock, tashkentIsoDate } from "../lib/format";
import { notifyEmployee } from "./integrations/hooks";
import { dayPlan, type DayPlan } from "../lib/schedule";
import { addDays, DAY_MINUTES, isOvernight, shiftWindow } from "../lib/shift-time";
import { isPracticeDay } from "../lib/counting";
import { notifyManagers } from "./mini-extra";
import { pushToEmployee } from "./push";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { updateDb } from "../lib/store";
import type { Attendance, Employee } from "../lib/types";
import type { EmployeeSession } from "./auth";
import { randomUUID } from "node:crypto";
import { InlineKeyboard } from "grammy";
import { branchManagers } from "./mini-extra";
import { miniAppUrl, sendTelegramMessage } from "./telegram";
import { pushToManager } from "./request-actions";
import { salarySnapshot } from "./advances";

/** Standart: kelmagan bo‘lsa — boshlanishdan 15 daqiqa keyin; chiqmagan bo‘lsa — tugashdan 20 daqiqa keyin. */
export const DEFAULT_REMINDERS = { start: { enabled: true, offset: 15 }, end: { enabled: true, offset: 20 } };
export const reminderPrefs = (employee: Pick<Employee, "reminders">) => ({
  start: { ...DEFAULT_REMINDERS.start, ...employee.reminders?.start },
  end: { ...DEFAULT_REMINDERS.end, ...employee.reminders?.end },
});

/** Mini App / ilova: eslatma sozlamasi. */
export function createMiniReminderRouter() {
  const router = Router();
  const sessionOf = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
  const route = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
  router.get(
    "/mini/reminders",
    route(async (req, res) => {
      const auth = sessionOf(req);
      const db = await readDb();
      const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId);
      if (!employee) return res.status(404).json({ message: "Xodim topilmadi." });
      res.json(reminderPrefs(employee));
    }),
  );
  router.put(
    "/mini/reminders",
    route(async (req, res) => {
      const auth = sessionOf(req);
      const rule = z.object({ enabled: z.boolean(), offset: z.coerce.number().int().min(-120).max(180) });
      const input = z.object({ start: rule, end: rule }).parse(req.body);
      const saved = await updateDb((db) => {
        const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId);
        if (!employee) throw Object.assign(new Error("Xodim topilmadi."), { status: 404 });
        employee.reminders = input;
        return reminderPrefs(employee);
      });
      res.json(saved);
    }),
  );
  return router;
}

const toMinutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
};

/**
 * Har daqiqada tekshiradi: ish boshlanganidan 15 daqiqa o‘tib hali kelmagan
 * yoki ish tugaganidan 20 daqiqa o‘tib ketishni belgilamagan xodimlarga
 * Telegram orqali (va mobil ilova o‘rnatilgan bo‘lsa — push bilan) bir martalik eslatma yuboradi.
 */
export function startAttendanceReminders() {
  if (process.env.ATTENDANCE_REMINDERS === "false") return;
  if (!process.env.TELEGRAM_BOT_TOKEN && process.env.MOBILE_PUSH === "false") return;
  const sent = new Set<string>();
  let currentDate = "";
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const date = tashkentIsoDate();
      if (date !== currentDate) {
        // Kechki smenaning ketish eslatmasi yarim tundan keyin qayta yuborilmasin.
        const keep = [...sent].filter((key) => key.endsWith(`:out:${currentDate}`));
        sent.clear();
        for (const key of keep) sent.add(key);
        currentDate = date;
      }
      const now = toMinutes(tashkentClock());
      const weekday = dateParts(date).weekday;
      const db = await readDb();
      const index = dataIndexes(db);
      // Xodimlar botiga bog‘langan xodimlar (Staffora botiga hali ulanmagan bo‘lsa ham eslatma yetadi).
      const linked = new Set(
        db.entityMappings
          .filter((m) => m.entity === "employee" && db.integrations.some((i) => i.id === m.integrationId && i.status !== "DISCONNECTED"))
          .map((m) => `${m.companyId}|${m.localId}`),
      );
      const hasBotLink = (employeeId: string, companyId: string) => linked.has(`${companyId}|${employeeId}`);
      const activeDevices = new Set(db.mobileDevices.filter((d) => d.status === "ACTIVE").map((d) => d.id));
      const withPush = new Set(db.mobilePushTokens.filter((t) => t.active && activeDevices.has(t.deviceId)).map((t) => t.employeeId));
      // Rahbar xulosasi: filial bo‘yicha, ish boshlanib 20 daqiqa o‘tgach hali kelmaganlar.
      const missing = new Map<string, { companyId: string; branchId: string; start: string; names: string[]; noticed: number }>();
      for (const employee of db.employees) {
        if (employee.status !== "ACTIVE") continue;
        const onLeave = (index.approvedLeaveByEmployee.get(employee.id) || []).some(
          (item) => item.startDate <= date && item.endDate >= date,
        );
        if (onLeave) continue;
        void weekday;
        // Mashq davri va smena almashish hisobga olinadi.
        const day = dayPlan(db, employee, date);
        const reachable =
          Boolean(process.env.TELEGRAM_BOT_TOKEN) &&
          ((employee.telegramConnected && employee.telegramId && !employee.telegramId.startsWith("dev")) || hasBotLink(employee.id, employee.companyId));
        // Mobil ilova: faol (ishonchli qurilmadagi) push tokeni bor xodim.
        const pushable = process.env.MOBILE_PUSH !== "false" && withPush.has(employee.id);
        const prefs = reminderPrefs(employee);
        // Ketish eslatmasi. `nowOnShift`, `endOnShift` — smena boshlangan kunning 00:00 idan daqiqa.
        const remindCheckout = (plan: DayPlan, record: Attendance | undefined, nowOnShift: number, endOnShift: number, key: string) => {
          const outAt = endOnShift + prefs.end.offset;
          if (!prefs.end.enabled || !record?.checkIn || record.checkOut || nowOnShift < outAt || nowOnShift >= outAt + 300 || sent.has(key)) return;
          sent.add(key);
          const before = prefs.end.offset < 0;
          const text = before
            ? `🏁 ${employee.firstName}, ish ${plan.end} da tugaydi (${Math.abs(prefs.end.offset)} daqiqadan keyin). Ketayotganda «Ishdan ketdim»ni bosishni unutmang.`
            : `🏁 ${employee.firstName}, ketishni belgilamadingiz. Ish ${plan.end} da tugagan — ketayotgan bo‘lsangiz «Ishdan ketdim»ni bosing.`;
          if (reachable) void notifyEmployee(db, employee, "attendance", text, { openButton: true, go: "checkout" }).catch(() => undefined);
          if (pushable)
            void pushToEmployee(
              employee.id,
              before
                ? { title: `🏁 Ish ${plan.end} da tugaydi`, body: `${Math.abs(prefs.end.offset)} daqiqa qoldi. Ketishni belgilashni unutmang.`, data: { go: "checkout" } }
                : { title: "🏁 Ketishni belgilamadingiz", body: `Ish ${plan.end} da tugagan. Ketayotgan bo‘lsangiz «Ishdan ketdim»ni bosing.`, data: { go: "checkout" } },
              db,
            ).catch(() => 0);
        };
        // Kechagi kechki smena (14:00 → 00:00, 22:00 → 06:00) yarim tundan keyin ham davom etadi.
        const yesterday = addDays(date, -1);
        const lastNight = dayPlan(db, employee, yesterday);
        if ((reachable || pushable) && lastNight.enabled && isOvernight(lastNight.start, lastNight.end))
          remindCheckout(lastNight, index.attendanceByKey.get(`${employee.id}|${yesterday}`), now + DAY_MINUTES, shiftWindow(lastNight.start, lastNight.end).to, `${employee.id}:out:${yesterday}`);
        if (!day.enabled) continue;
        const record = index.attendanceByKey.get(`${employee.id}|${date}`);
        const company = db.companies.find((c) => c.id === employee.companyId);
        const digestKey = `digest:${employee.companyId}|${employee.branchId}|${day.start}`;
        if (
          !record?.checkIn &&
          company?.miniApp?.managerDigest !== false &&
          !isPracticeDay(date, company, employee) &&
          now >= toMinutes(day.start) + 20 &&
          now < toMinutes(day.start) + 60 &&
          !sent.has(digestKey)
        ) {
          const group = missing.get(digestKey) || { companyId: employee.companyId, branchId: employee.branchId, start: day.start, names: [], noticed: 0 };
          const notice = db.lateNotices.find((n) => n.employeeId === employee.id && n.date === date);
          group.names.push(`${employee.firstName} ${employee.lastName}`.trim() + (notice ? ` (⏳ ~${notice.minutes} daq, ogohlantirgan)` : ""));
          if (notice) group.noticed += 1;
          missing.set(digestKey, group);
        }
        if (!reachable && !pushable) continue;
        // Tungi smena (masalan 14:00–00:00): tugash ertasi kunga o‘tadi.
        const { from: start, to: end } = shiftWindow(day.start, day.end);
        const inKey = `${employee.id}:in`;
        const inAt = start + prefs.start.offset;
        if (prefs.start.enabled && !record?.checkIn && now >= inAt && now < inAt + 180 && now < end && !sent.has(inKey)) {
          sent.add(inKey);
          const before = prefs.start.offset < 0;
          const text = before
            ? `⏰ ${employee.firstName}, ish ${day.start} da boshlanadi (${Math.abs(prefs.start.offset)} daqiqadan keyin).\n\nFilialga yetib kelgach, «Ishga keldim» tugmasini bosing.`
            : `⏰ ${employee.firstName}, ish ${day.start} da boshlangan, lekin kelishingiz hali qayd etilmagan.\n\nFilialda bo‘lsangiz, «Ishga keldim» tugmasini bosing.`;
          if (reachable) void notifyEmployee(db, employee, "attendance", text, { openButton: true, go: "checkin" }).catch(() => undefined);
          if (pushable)
            void pushToEmployee(
              employee.id,
              before
                ? { title: `⏰ Ish ${day.start} da boshlanadi`, body: `${Math.abs(prefs.start.offset)} daqiqa qoldi. Kelganingizda «Ishga keldim»ni bosing.`, data: { go: "checkin" } }
                : { title: "⏰ Kelish qayd etilmagan", body: `Ish ${day.start} da boshlangan. Filialda bo‘lsangiz, «Ishga keldim»ni bosing.`, data: { go: "checkin" } },
              db,
            ).catch(() => 0);
        }
        // Ertalabki eslatma: ish boshlanishidan 10 daqiqa oldin (xodim o‘zi oldindan eslatma sozlamagan bo‘lsa).
        const preKey = `${employee.id}:pre`;
        if (prefs.start.enabled && prefs.start.offset >= 0 && !record?.checkIn && start >= PRE_REMINDER && now >= start - PRE_REMINDER && now < start && !sent.has(preKey)) {
          sent.add(preKey);
          const text = `⏰ ${employee.firstName}, ish ${day.start} da boshlanadi. Belgilashni unutmang — filialga yetib kelgach «Ishga keldim»ni bosing.`;
          if (reachable) void notifyEmployee(db, employee, "attendance", text, { openButton: true, go: "checkin" }).catch(() => undefined);
          if (pushable)
            void pushToEmployee(employee.id, { title: `⏰ Ish ${day.start} da boshlanadi`, body: "Belgilashni unutmang — kelganingizda «Ishga keldim»ni bosing.", data: { go: "checkin" } }, db).catch(() => 0);
        }
        remindCheckout(day, record, now, end, `${employee.id}:out:${date}`);
      }
      for (const [key, group] of missing) {
        sent.add(key);
        const branch = db.branches.find((b) => b.id === group.branchId);
        const list = group.names.slice(0, 15).map((name) => `• ${name}`).join("\n");
        const more = group.names.length > 15 ? `\n… yana ${group.names.length - 15} kishi` : "";
        if (process.env.TELEGRAM_BOT_TOKEN)
          void notifyManagers(
          db,
          group.companyId,
          group.branchId,
          `🕘 <b>${branch?.name || "Filial"}</b> — ish ${group.start} da boshlangan\n${group.names.length} kishi hali kelmadi${group.noticed ? ` (${group.noticed} tasi ogohlantirgan)` : ""}:\n\n${list}${more}`,
          "manager",
        ).catch(() => undefined);
      }
      await runDailyJobs(db, date, now).catch((error) => console.error("Kunlik hisobot xatosi", error));
    } catch (error) {
      console.error("Davomat eslatmalari xatosi", error);
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), 60_000).unref();
}

const PRE_REMINDER = 10;
/** Rahbarga kunlik hisobot vaqti (Toshkent): 10:00. */
const REPORT_AT = 10 * 60;
/** Oy yakuni xati: oyning oxirgi kuni 19:00 da. */
const MONTH_SUMMARY_AT = 19 * 60;
const nameOf = (e: Pick<Employee, "firstName" | "lastName">) => `${e.firstName} ${e.lastName}`.trim();
const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
type Db = Awaited<ReturnType<typeof readDb>>;

/** Kuniga bir martalik ishlar; takror yubormaslik uchun sentGreetings (server qayta ishga tushsa ham). */
async function runDailyJobs(db: Db, date: string, now: number) {
  const done = new Set(db.sentGreetings.map((g) => g.key));
  const keys: string[] = [];
  if (now >= REPORT_AT && now < REPORT_AT + 60) keys.push(...(await managerReports(db, date, now, done)));
  if (addDays(date, 1).slice(0, 7) !== date.slice(0, 7) && now >= MONTH_SUMMARY_AT) keys.push(...(await monthSummaries(db, date, done)));
  if (!keys.length) return;
  await updateDb((next) => {
    const at = new Date().toISOString();
    for (const key of keys) next.sentGreetings.push({ key, at });
  });
}

/**
 * 10:00 — rahbarga (egasi, HR, filial rahbari) kim kelmadi va kim kechikdi ro‘yxati.
 * Ro‘yxatdagi xodimga Telegram’da bir bosishda yozish tugmalari bilan; ilovaga push.
 */
async function managerReports(db: Db, date: string, now: number, done: Set<string>) {
  const keys: string[] = [];
  if (!process.env.TELEGRAM_BOT_TOKEN && process.env.MOBILE_PUSH === "false") return keys;
  const index = dataIndexes(db);
  type Row = { employee: Employee; late: number };
  for (const company of db.companies) {
    if (company.status === "SUSPENDED" || company.miniApp?.managerDigest === false) continue;
    const key = `MREPORT:${company.id}:${date}`;
    if (done.has(key)) continue;
    keys.push(key);
    const absent: Row[] = [];
    const late: Row[] = [];
    let planned = 0;
    for (const employee of db.employees) {
      if (employee.companyId !== company.id || employee.status !== "ACTIVE") continue;
      const onLeave = (index.approvedLeaveByEmployee.get(employee.id) || []).some((l) => l.startDate <= date && l.endDate >= date);
      if (onLeave) continue;
      const plan = dayPlan(db, employee, date);
      if (!plan.enabled || toMinutes(plan.start) > now) continue;
      planned += 1;
      const record = index.attendanceByKey.get(`${employee.id}|${date}`);
      if (!record?.checkIn) absent.push({ employee, late: 0 });
      else if (record.lateMinutes > 0 && !isPracticeDay(date, company, employee)) late.push({ employee, late: record.lateMinutes });
    }
    if (!planned) continue;
    for (const manager of branchManagers(db, company.id)) {
      const scope = manager.role === "BRANCH_MANAGER" ? new Set(manager.branchIds || []) : null;
      const inScope = (r: Row) => !scope || scope.has(r.employee.branchId);
      const a = absent.filter(inScope);
      const l = late.filter(inScope).sort((x, y) => y.late - x.late);
      if (scope && !a.length && !l.length && !db.employees.some((e) => e.companyId === company.id && scope.has(e.branchId))) continue;
      const list = (rows: Row[], suffix: (r: Row) => string) =>
        rows
          .slice(0, 12)
          .map((r) => `• ${nameOf(r.employee)}${suffix(r)}`)
          .join("\n") + (rows.length > 12 ? `\n… yana ${rows.length - 12} kishi` : "");
      const text = [
        `📋 <b>Bugungi davomat · ${tashkentClock().slice(0, 5)}</b>`,
        !a.length && !l.length ? "✅ Hamma o‘z vaqtida keldi." : "",
        a.length ? `\n❌ <b>Kelmadi — ${a.length}</b>\n${list(a, (r) => (r.employee.phone ? ` · ${r.employee.phone}` : ""))}` : "",
        l.length ? `\n⏰ <b>Kechikdi — ${l.length}</b>\n${list(l, (r) => ` · ${r.late} daq`)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      // «Xodimga yozish»: Telegram’i ulangan xodimlar (ko‘pi bilan 8 ta tugma).
      const writable = [...a, ...l].filter((r) => r.employee.telegramConnected && /^\d+$/.test(r.employee.telegramId || "")).slice(0, 8);
      const keyboard = new InlineKeyboard();
      writable.forEach((r, i) => {
        keyboard.url(`✉️ ${r.employee.firstName}`, `tg://user?id=${r.employee.telegramId}`);
        if (i % 2 === 1) keyboard.row();
      });
      const panel = miniAppUrl("manager");
      if (panel) keyboard.row().webApp("📊 Rahbar paneli", panel);
      if (process.env.TELEGRAM_BOT_TOKEN && manager.telegramId) {
        const ok = await sendTelegramMessage(manager.telegramId, text, { keyboard }).catch(() => false);
        // Xodimning maxfiylik sozlamasi tugmani taqiqlasa — xabar tugmalarsiz qayta yuboriladi.
        if (!ok && writable.length) await sendTelegramMessage(manager.telegramId, text, { go: "manager" }).catch(() => false);
      }
      await pushToManager(db, manager, "📋 Bugungi davomat", !a.length && !l.length ? "Hamma o‘z vaqtida keldi." : `Kelmadi: ${a.length} · Kechikdi: ${l.length}`, "manager").catch(() => 0);
    }
  }
  return keys;
}

/** Oyning oxirgi kuni kechqurun — xodimga oy xulosasi: kunlar, kechikishlar, qo‘lga tegadigan summa. */
async function monthSummaries(db: Db, date: string, done: Set<string>) {
  const keys: string[] = [];
  const month = date.slice(0, 7);
  const index = dataIndexes(db);
  const rows: { companyId: string; employeeId: string; title: string; body: string }[] = [];
  for (const employee of db.employees) {
    if (employee.status !== "ACTIVE") continue;
    const key = `MONTH:${employee.id}:${month}`;
    if (done.has(key)) continue;
    keys.push(key);
    const snap = salarySnapshot(db, employee, month);
    if (!snap.days && !snap.base) continue;
    const late = (index.attendanceByEmployee.get(employee.id) || []).filter((r) => r.date.startsWith(month) && r.lateMinutes > 0).length;
    const text = [
      `📊 <b>${snap.label} xulosasi</b>`,
      `Ishlagan kunlar: ${snap.days}${snap.expectedDays ? ` / ${snap.expectedDays}` : ""}`,
      `Kechikishlar: ${late}`,
      snap.base ? `Qo‘lga tegadigan (taxminiy): <b>${som(snap.net)}</b>` : "",
      snap.advance ? `Avans olingan: ${som(snap.advance)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    await notifyEmployee(db, employee, "payroll", text, { openButton: true, go: "salary" }).catch(() => undefined);
    rows.push({
      companyId: employee.companyId,
      employeeId: employee.id,
      title: `📊 ${snap.label} xulosasi`,
      body: `${snap.days} kun · ${late} kechikish${snap.base ? ` · ${som(snap.net)}` : ""}`,
    });
  }
  // Ilovadagi bildirishnoma (push dispetcheri telefonga ham yuboradi).
  if (rows.length)
    await updateDb((next) => {
      const at = new Date().toISOString();
      for (const r of rows)
        next.notifications.unshift({ id: randomUUID(), companyId: r.companyId, employeeId: r.employeeId, title: r.title, body: r.body, type: "PAYROLL", read: false, createdAt: at, go: "salary" });
    });
  return keys;
}
