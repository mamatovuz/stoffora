/*
 * Faqat lokal dizayn sinovi uchun demo baza: SQLITE_PATH’ga alohida fayl bering.
 *   SQLITE_PATH=./data/demo.sqlite BOOTSTRAP_... npx tsx scripts/demo-seed.ts
 * Ishlab chiqarish bazasida ishga tushirmang.
 */
import { randomUUID } from "node:crypto";
import { readDb, updateDb } from "../lib/store";
import type { Attendance, Database } from "../lib/types";

if (!process.env.SQLITE_PATH || /staffora\.sqlite$/.test(process.env.SQLITE_PATH)) {
  console.error("SQLITE_PATH alohida demo fayl bo‘lishi kerak.");
  process.exit(1);
}

const id = () => randomUUID();
const pad = (n: number) => String(n).padStart(2, "0");

async function main() {
  const before = await readDb();
  const company = before.companies[0];
  if (!company) throw new Error("Avval BOOTSTRAP_* bilan kompaniya yarating.");
  if (before.employees.length) {
    console.log("Demo ma’lumot allaqachon bor.");
    return;
  }
  await updateDb((db: Database) => {
    const c = company.id;
    const scheduleId = id();
    db.schedules.push({
      id: scheduleId,
      companyId: c,
      name: "Standart 9–18",
      type: "FIXED",
      graceMinutes: 5,
      overtimeEnabled: true,
      days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: day !== 0, start: "09:00", end: "18:00", breakMinutes: 60 })),
    } as Database["schedules"][number]);
    const head = { id: id(), companyId: c, name: "Bosh ofis", address: "Toshkent, Amir Temur 1", latitude: 41.3111, longitude: 69.2797, radiusMeters: 150, manager: "", status: "ACTIVE" as const, scheduleId, attendanceMode: "GPS_FACE" as const };
    const kurgan = { id: id(), companyId: c, name: "Qo‘rg‘ontepa filiali", address: "Andijon, Qo‘rg‘ontepa", latitude: 40.7333, longitude: 72.7631, radiusMeters: 120, manager: "", status: "ACTIVE" as const, scheduleId, attendanceMode: "QR_GPS_FACE" as const };
    db.branches.push(head, kurgan);
    const dep = { id: id(), companyId: c, name: "Savdo", manager: "" };
    const hrDep = { id: id(), companyId: c, name: "Kadrlar bo‘limi", manager: "" };
    db.departments.push(dep as Database["departments"][number], hrDep as Database["departments"][number]);
    const seller = { id: id(), companyId: c, name: "Sotuvchi", departmentId: dep.id };
    const hr = { id: id(), companyId: c, name: "HR menejer", departmentId: hrDep.id, anyBranch: true };
    db.positions.push(seller, hr);
    const names = [
      ["Ali", "Valiyev"], ["Dilnoza", "Karimova"], ["Jasur", "Toshmatov"], ["Madina", "Rahimova"],
      ["Sardor", "Aliyev"], ["Nodira", "Yusupova"], ["Bekzod", "Ergashev"], ["Gulnora", "Saidova"],
    ];
    const today = new Date();
    const ym = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
    names.forEach(([firstName, lastName], i) => {
      const employeeId = id();
      const branch = i % 3 === 2 ? kurgan : head;
      db.employees.push({
        id: employeeId,
        companyId: c,
        employeeNo: `E-${100 + i}`,
        firstName,
        lastName,
        phone: `+99890${pad(i)}11223`,
        branchId: branch.id,
        departmentId: i === 1 ? hrDep.id : dep.id,
        positionId: i === 1 ? hr.id : seller.id,
        scheduleId,
        status: "ACTIVE",
        salary: 4_500_000 + i * 300_000,
        startDate: `${ym}-01`,
        telegramId: `dev-${i}`,
        telegramConnected: true,
        birthDate: i === 3 ? `1995-${pad(today.getMonth() + 1)}-${pad(Math.min(28, today.getDate() + 2))}` : `199${i}-0${(i % 9) + 1}-1${i}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as Database["employees"][number]);
      for (let d = 1; d < today.getDate(); d += 1) {
        const date = `${ym}-${pad(d)}`;
        if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) continue;
        if ((d + i) % 9 === 0) continue; // ba’zan kelmagan
        const late = (d * (i + 1)) % 7 === 0 ? 5 + ((d + i) % 25) : 0;
        const inMin = 9 * 60 + late - (late ? 0 : (d + i) % 8);
        const outMin = 18 * 60 + ((d * i) % 40);
        const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
        db.attendance.push({
          id: id(),
          companyId: c,
          employeeId,
          branchId: branch.id,
          date,
          scheduledStart: "09:00",
          scheduledEnd: "18:00",
          checkIn: hm(inMin),
          checkOut: hm(outMin),
          lateMinutes: late > 5 ? late : 0,
          earlyLeaveMinutes: 0,
          workedMinutes: outMin - inMin - 60,
          overtimeMinutes: Math.max(0, outMin - 18 * 60),
          status: late > 5 ? "LATE" : "PRESENT",
          verification: ["FACE", "GPS"],
          latitude: branch.latitude,
          longitude: branch.longitude,
          updatedAt: new Date().toISOString(),
        } as Attendance);
      }
      db.notifications.unshift({ id: id(), companyId: c, employeeId, title: "Ta’til so‘rovingiz tasdiqlandi", body: "15–20-oktabr ta’tilingiz HR tomonidan tasdiqlandi.", type: "LEAVE", read: false, createdAt: new Date().toISOString() });
    });
  });
  console.log("Demo ma’lumot yaratildi.");
}
void main();
