import { randomInt, randomUUID } from "node:crypto";
import type { Attendance, Company, Database } from "../../lib/types";
import { defaultPlans, effectiveLimits } from "../../lib/platform/subscriptions";

/*
 * Platforma route’lari uchun umumiy yordamchilar (updateDb ichida chaqiriladi).
 */

/** Standart tariflar (Free/Pro/Enterprise) — faqat ro‘yxat bo‘sh bo‘lsa, bir marta. Keyin super admin tahrirlaydi. */
export function ensurePlans(db: Database) {
  if (!db.subscriptionPlans.length) db.subscriptionPlans.push(...defaultPlans(new Date().toISOString(), () => randomUUID()));
  return db.subscriptionPlans;
}

/**
 * Obunadagi tarifni kompaniyaning eski maydonlariga sinxronlaydi:
 * company.plan (nomi) va company.employeeLimit — mavjud xodim limiti tekshiruvi (lib/limits.ts) shu bo‘yicha ishlaydi.
 */
export function syncCompanyPlan(db: Database, company: Company) {
  if (!company.subscription) return;
  const plan = db.subscriptionPlans.find((p) => p.id === company.subscription!.planId);
  if (plan) company.plan = plan.name;
  const limits = effectiveLimits(plan, company.subscription);
  company.employeeLimit = limits.employees ?? undefined;
}

export function tempPassword(length = 14) {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
}

/** Frontendga beriladigan kompaniya (maxfiy kalitlarsiz). */
export function publicCompany(company: Company) {
  const { bot, registrationForm: _form, photoChannel, ...rest } = company;
  return {
    ...rest,
    bot: bot ? { enabled: bot.enabled, username: bot.username, status: bot.status, lastError: bot.lastError, mode: bot.mode } : undefined,
    photoChannel: photoChannel ? { enabled: photoChannel.enabled } : undefined,
  };
}

/**
 * Demo kompaniya uchun sintetik ma’lumot: filiallar, grafik, xodimlar, 14 kunlik davomat.
 * Hammasi company.demo bilan belgilangan kompaniya ichida — asosiy analitikaga qo‘shilmaydi.
 */
export function seedDemoData(db: Database, company: Company) {
  const c = company.id;
  const id = () => randomUUID();
  const scheduleId = id();
  db.schedules.push({
    id: scheduleId,
    companyId: c,
    name: "Demo grafik 9–18",
    type: "FIXED",
    graceMinutes: 5,
    overtimeEnabled: true,
    days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: day !== 0, start: "09:00", end: "18:00", breakMinutes: 60 })),
  } as unknown as Database["schedules"][number]);
  const branches = [
    { name: "Demo bosh ofis", address: "Toshkent (demo)", latitude: 41.3111, longitude: 69.2797 },
    { name: "Demo filial", address: "Samarqand (demo)", latitude: 39.6542, longitude: 66.9597 },
  ].map((b) => ({ id: id(), companyId: c, ...b, radiusMeters: 150, manager: "", status: "ACTIVE" as const, scheduleId, attendanceMode: "GPS_FACE" as const }));
  db.branches.push(...(branches as unknown as Database["branches"]));
  const department = { id: id(), companyId: c, name: "Demo bo‘lim", manager: "" };
  db.departments.push(department as unknown as Database["departments"][number]);
  const position = { id: id(), companyId: c, name: "Demo xodim", departmentId: department.id };
  db.positions.push(position as unknown as Database["positions"][number]);
  const names = ["Ali", "Vali", "Gulnora", "Sardor", "Madina", "Jasur", "Nodira", "Bekzod", "Dilshod", "Kamola"];
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date().toISOString();
  names.forEach((first, i) => {
    const employeeId = id();
    const branch = branches[i % branches.length];
    db.employees.push({
      id: employeeId,
      companyId: c,
      employeeNo: `D-${100 + i}`,
      firstName: first,
      lastName: "Demo",
      phone: `+99800000${pad(i)}00`,
      email: "",
      branchId: branch.id,
      departmentId: department.id,
      positionId: position.id,
      scheduleId,
      employmentType: "FULL_TIME",
      status: "ACTIVE",
      baseSalary: 0,
      currency: "UZS",
      startDate: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
      telegramConnected: false,
      deviceStatus: "PENDING",
      createdAt: now,
      updatedAt: now,
    } as unknown as Database["employees"][number]);
    for (let d = 14; d >= 1; d -= 1) {
      const date = new Date(Date.now() + 5 * 3600_000 - d * 86_400_000).toISOString().slice(0, 10);
      if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0 || (d + i) % 9 === 0) continue;
      const late = (d * (i + 1)) % 7 === 0 ? 10 + ((d + i) % 20) : 0;
      const inMin = 9 * 60 + late - (late ? 0 : (d + i) % 6);
      const outMin = 18 * 60 + ((d * i) % 30);
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
        lateMinutes: late,
        earlyLeaveMinutes: 0,
        workedMinutes: outMin - inMin - 60,
        overtimeMinutes: Math.max(0, outMin - 18 * 60),
        status: late ? "LATE" : "PRESENT",
        verification: ["GPS"],
        note: "Demo (sintetik) ma’lumot",
        updatedAt: now,
      } as Attendance);
    }
  });
}

/**
 * Faqat DEMO kompaniyani butunlay o‘chiradi (sintetik ma’lumot tozalash siyosati).
 * Haqiqiy kompaniyalar uchun ishlatilmaydi — chaqiruvchi demo belgisini tekshiradi.
 */
export function purgeDemoCompany(db: Database, companyId: string) {
  const company = db.companies.find((c) => c.id === companyId);
  if (!company?.demo) throw Object.assign(new Error("Faqat demo kompaniya o‘chiriladi."), { status: 409 });
  const keep = <T extends { companyId?: string }>(rows: T[]) => rows.filter((row) => row.companyId !== companyId);
  const record = db as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === "companies" || key === "auditLogs" || !Array.isArray(value)) continue;
    if (value.some((row) => row && typeof row === "object" && (row as { companyId?: string }).companyId === companyId)) record[key] = keep(value as { companyId?: string }[]);
  }
  db.companies = db.companies.filter((c) => c.id !== companyId);
}
