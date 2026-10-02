import { dataIndexes, readDb } from "../lib/store";
import { dateParts, tashkentClock, tashkentIsoDate } from "../lib/format";
import { notifyEmployee } from "./integrations/hooks";
import { dayPlan } from "../lib/schedule";
import { isPracticeDay } from "../lib/counting";
import { notifyManagers } from "./mini-extra";
import { pushToEmployee } from "./push";

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
        const end = toMinutes(day.end);
        const inKey = `${employee.id}:in`;
        const outKey = `${employee.id}:out`;
        if (
          !record?.checkIn &&
          now >= start + 15 &&
          now < start + 180 &&
          !sent.has(inKey)
        ) {
          sent.add(inKey);
          if (reachable)
            void notifyEmployee(
              db,
              employee,
              "attendance",
              `⏰ ${employee.firstName}, ish ${day.start} da boshlangan, lekin kelishingiz hali qayd etilmagan.\n\nFilialda bo‘lsangiz, Mini App orqali «Ishga keldim» tugmasini bosing.`,
              { openButton: true, go: "checkin" },
            ).catch(() => undefined);
          if (pushable)
            void pushToEmployee(employee.id, { title: "⏰ Kelish qayd etilmagan", body: `Ish ${day.start} da boshlangan. Filialda bo‘lsangiz, «Ishga keldim»ni bosing.`, data: { go: "checkin" } }, db).catch(() => 0);
        }
        if (
          record?.checkIn &&
          !record.checkOut &&
          now >= end + 20 &&
          now < end + 300 &&
          !sent.has(outKey)
        ) {
          sent.add(outKey);
          if (reachable)
            void notifyEmployee(
              db,
              employee,
              "attendance",
              `🏁 ${employee.firstName}, ish vaqti ${day.end} da tugadi. Ketishni belgilashni unutmang.`,
              { openButton: true, go: "checkout" },
            ).catch(() => undefined);
          if (pushable)
            void pushToEmployee(employee.id, { title: "🏁 Ish vaqti tugadi", body: `Ish ${day.end} da tugadi. Ketishni belgilashni unutmang.`, data: { go: "checkout" } }, db).catch(() => 0);
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
