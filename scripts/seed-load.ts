/**
 * Yuklama sinovi uchun katta namunaviy baza yaratadi (faqat lokal test uchun).
 *   SQLITE_PATH=./data/load.sqlite npx tsx scripts/seed-load.ts [xodimlar=300] [kunlar=60]
 */
import bcrypt from "bcryptjs";
import { flushDb, updateDb } from "../lib/store";
import { tashkentIsoDate } from "../lib/format";

const employeesCount = Number(process.argv[2] || 300);
const daysCount = Number(process.argv[3] || 60);
if (!process.env.SQLITE_PATH) throw new Error("SQLITE_PATH ko‘rsating (test bazasi).");

// ~40 KB lik "rasm" (haqiqiy 512px JPEG hajmiga yaqin)
const photo = `data:image/jpeg;base64,${Buffer.alloc(30_000, 7).toString("base64")}`;
const id = () => crypto.randomUUID();

async function main() {
await updateDb(async (db) => {
  if (db.users.length) throw new Error("Baza bo‘sh emas.");
  const companyId = id();
  const now = new Date().toISOString();
  db.companies.push({ id: companyId, name: "Load Test MChJ", slug: "load", ownerName: "Owner", plan: "Business", status: "ACTIVE", timezone: "Asia/Tashkent", createdAt: now });
  db.users.push({ id: id(), companyId, name: "Load Owner", email: "load@test.uz", passwordHash: await bcrypt.hash("Parol12345!", 10), role: "COMPANY_OWNER" });
  const scheduleId = id();
  db.schedules.push({ id: scheduleId, companyId, name: "5/2", type: "FIXED", graceMinutes: 5, overtimeEnabled: true, days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: day >= 1 && day <= 5, start: "09:00", end: "18:00", breakMinutes: 60 })) });
  const branchIds = Array.from({ length: 5 }, (_, i) => {
    const branchId = id();
    db.branches.push({ id: branchId, companyId, name: `Filial ${i + 1}`, address: "Toshkent", latitude: 41.31, longitude: 69.24, radiusMeters: 150, manager: "", status: "ACTIVE", scheduleId });
    return branchId;
  });
  const departmentId = id();
  db.departments.push({ id: departmentId, companyId, name: "Savdo" });
  const positionId = id();
  db.positions.push({ id: positionId, companyId, name: "Sotuvchi", departmentId });
  const start = new Date(Date.now() - daysCount * 86_400_000);
  for (let i = 0; i < employeesCount; i += 1) {
    const employeeId = id();
    db.employees.push({
      id: employeeId, companyId, employeeNo: `EMP-${String(i + 1).padStart(4, "0")}`, firstName: `Xodim${i}`, lastName: "Testov",
      phone: `+998 90 ${String(1000000 + i).slice(0, 3)} ${String(i % 100).padStart(2, "0")} 00`, email: "", departmentId, positionId,
      branchId: branchIds[i % 5], scheduleId, employmentType: "FULL_TIME", startDate: tashkentIsoDate(start), baseSalary: 5_000_000, currency: "UZS",
      telegramConnected: false, deviceStatus: "PENDING", photoDataUrl: photo, status: "ACTIVE", createdAt: now, updatedAt: now,
    });
    for (let d = 0; d < daysCount; d += 1) {
      const date = tashkentIsoDate(new Date(start.getTime() + d * 86_400_000));
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (weekday === 0 || weekday === 6 || (i + d) % 9 === 0) continue;
      const late = (i + d) % 5 === 0 ? 12 : 0;
      db.attendance.push({
        id: id(), companyId, employeeId, branchId: branchIds[i % 5], date, scheduledStart: "09:00", scheduledEnd: "18:00",
        checkIn: late ? "09:12" : "08:55", checkOut: "18:05", lateMinutes: late, earlyLeaveMinutes: 0, workedMinutes: late ? 533 : 550,
        overtimeMinutes: 5, status: late ? "LATE" : "CHECKED_OUT", verification: ["FACE", "GPS", "QR", "TELEGRAM"], distanceMeters: 20, updatedAt: now,
      });
    }
  }
  for (let i = 0; i < 3000; i += 1)
    db.auditLogs.push({ id: id(), companyId, actor: "Load Owner", action: "Test amal", entity: "employee", entityId: db.employees[i % employeesCount].id, createdAt: now });
});
await flushDb();
console.log(`Tayyor: ${employeesCount} xodim, ${daysCount} kun.`);
process.exit(0);
}
void main();
