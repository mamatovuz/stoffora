import { dataIndexes, readDb } from "../lib/store";
import { dateParts, tashkentClock, tashkentIsoDate } from "../lib/format";
import { notifyEmployee } from "./integrations/hooks";
import { dayPlan } from "../lib/schedule";
import { isPracticeDay } from "../lib/counting";
import { notifyManagers } from "./mini-extra";
import { pushToEmployee } from "./push";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { updateDb } from "../lib/store";
import type { Employee } from "../lib/types";
import type { EmployeeSession } from "./auth";

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
        sent.clear();
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
        const reachable =
          Boolean(process.env.TELEGRAM_BOT_TOKEN) &&
          ((employee.telegramConnected && employee.telegramId && !employee.telegramId.startsWith("dev")) || hasBotLink(employee.id, employee.companyId));
        // Mobil ilova: faol (ishonchli qurilmadagi) push tokeni bor xodim.
        const pushable = process.env.MOBILE_PUSH !== "false" && withPush.has(employee.id);
        if (!reachable && !pushable) continue;
        const start = toMinutes(day.start);
        let end = toMinutes(day.end);
        // Tungi smena (masalan 14:00–00:00): tugash ertasi kunga o‘tadi.
        if (end <= start) end += 24 * 60;
        const prefs = reminderPrefs(employee);
        const inKey = `${employee.id}:in`;
        const outKey = `${employee.id}:out`;
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
        const outAt = end + prefs.end.offset;
        if (prefs.end.enabled && record?.checkIn && !record.checkOut && now >= outAt && now < outAt + 300 && !sent.has(outKey)) {
          sent.add(outKey);
          const before = prefs.end.offset < 0;
          const text = before
            ? `🏁 ${employee.firstName}, ish ${day.end} da tugaydi (${Math.abs(prefs.end.offset)} daqiqadan keyin). Ketayotganda «Ishdan ketdim»ni bosishni unutmang.`
            : `🏁 ${employee.firstName}, ish vaqti ${day.end} da tugadi. Ketishni belgilashni unutmang.`;
          if (reachable) void notifyEmployee(db, employee, "attendance", text, { openButton: true, go: "checkout" }).catch(() => undefined);
          if (pushable)
            void pushToEmployee(
              employee.id,
              before
                ? { title: `🏁 Ish ${day.end} da tugaydi`, body: `${Math.abs(prefs.end.offset)} daqiqa qoldi. Ketishni belgilashni unutmang.`, data: { go: "checkout" } }
                : { title: "🏁 Ish vaqti tugadi", body: `Ish ${day.end} da tugadi. Ketishni belgilashni unutmang.`, data: { go: "checkout" } },
              db,
            ).catch(() => 0);
        }
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
    } catch (error) {
      console.error("Davomat eslatmalari xatosi", error);
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), 60_000).unref();
}
