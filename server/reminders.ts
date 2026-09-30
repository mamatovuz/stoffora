import { dataIndexes, readDb } from "../lib/store";
import { dateParts, tashkentClock, tashkentIsoDate } from "../lib/format";
import { notifyEmployee } from "./integrations/hooks";

const toMinutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
};

/**
 * Har daqiqada tekshiradi: ish boshlanganidan 15 daqiqa o‘tib hali kelmagan
 * yoki ish tugaganidan 20 daqiqa o‘tib ketishni belgilamagan xodimlarga
 * Telegram orqali bir martalik eslatma yuboradi.
 */
export function startAttendanceReminders() {
  if (process.env.ATTENDANCE_REMINDERS === "false") return;
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
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
      for (const employee of db.employees) {
        if (employee.status !== "ACTIVE") continue;
        const reachable =
          (employee.telegramConnected && employee.telegramId && !employee.telegramId.startsWith("dev")) ||
          hasBotLink(employee.id, employee.companyId);
        if (!reachable) continue;
        const onLeave = (index.approvedLeaveByEmployee.get(employee.id) || []).some(
          (item) => item.startDate <= date && item.endDate >= date,
        );
        if (onLeave) continue;
        const day = db.schedules
          .find((item) => item.id === employee.scheduleId)
          ?.days.find((item) => item.day === weekday);
        if (!day?.enabled) continue;
        const record = index.attendanceByKey.get(`${employee.id}|${date}`);
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
          void notifyEmployee(
            db,
            employee,
            "attendance",
            `⏰ ${employee.firstName}, ish ${day.start} da boshlangan, lekin kelishingiz hali qayd etilmagan.\n\nFilialda bo‘lsangiz, Mini App orqali «Ishga keldim» tugmasini bosing.`,
            { openButton: true },
          ).catch(() => undefined);
        }
        if (
          record?.checkIn &&
          !record.checkOut &&
          now >= end + 20 &&
          now < end + 300 &&
          !sent.has(outKey)
        ) {
          sent.add(outKey);
          void notifyEmployee(
            db,
            employee,
            "attendance",
            `🏁 ${employee.firstName}, ish vaqti ${day.end} da tugadi. Ketishni belgilashni unutmang.`,
            { openButton: true },
          ).catch(() => undefined);
        }
      }
    } catch (error) {
      console.error("Davomat eslatmalari xatosi", error);
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), 60_000).unref();
}
