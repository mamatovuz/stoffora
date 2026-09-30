import type { Company, Database, Employee } from "./types";

/*
 * Tarif cheklovi: kompaniyaga super admin belgilagan maksimal faol xodim soni.
 * Ishdan bo‘shaganlar hisobga kirmaydi. Chegaraga yetganda — aloqa uchun Telegram.
 */

export const DEFAULT_LIMIT_CONTACT = "@mamatov_ads";

export function activeEmployeeCount(db: Pick<Database, "employees">, companyId: string) {
  return db.employees.filter((e) => e.companyId === companyId && e.status === "ACTIVE").length;
}

/** Xodim qo‘shib bo‘lmasa — foydalanuvchiga ko‘rsatiladigan xabar; aks holda undefined. */
export function employeeLimitError(db: Pick<Database, "employees" | "companies">, companyId: string, adding = 1) {
  const company = db.companies.find((c) => c.id === companyId);
  const limit = company?.employeeLimit;
  if (!limit || limit <= 0) return undefined;
  const count = activeEmployeeCount(db, companyId);
  if (count + adding <= limit) return undefined;
  const contact = company?.limitContact || DEFAULT_LIMIT_CONTACT;
  return `Tarifingiz bo‘yicha ko‘pi bilan ${limit} ta faol xodim qo‘shish mumkin (hozir ${count} ta). Ko‘proq xodim uchun Telegram: ${contact}`;
}

export function assertEmployeeCapacity(db: Pick<Database, "employees" | "companies">, companyId: string, adding = 1) {
  const error = employeeLimitError(db, companyId, adding);
  if (error) throw Object.assign(new Error(error), { status: 402 });
}

/** Lavozim bo‘limga biriktirilgan bo‘lsa, xodimning bo‘limi ham shu bo‘ladi. */
export function alignDepartment(db: Pick<Database, "positions" | "departments">, employee: Employee) {
  const position = db.positions.find((p) => p.id === employee.positionId && p.companyId === employee.companyId);
  if (!position?.departmentId) return false;
  if (!db.departments.some((d) => d.id === position.departmentId && d.companyId === employee.companyId)) return false;
  if (employee.departmentId === position.departmentId) return false;
  employee.departmentId = position.departmentId;
  return true;
}

export type LimitInfo = { limit?: number; contact: string; used: number };
export function limitInfo(db: Pick<Database, "employees" | "companies">, company: Company): LimitInfo {
  return {
    limit: company.employeeLimit || undefined,
    contact: company.limitContact || DEFAULT_LIMIT_CONTACT,
    used: activeEmployeeCount(db, company.id),
  };
}

/**
 * Xodimlarni butunlay o‘chiradi: profil, davomat, ta’til, Face ID, taklif
 * havolalari, shaxsiy bildirishnomalar va integratsiya bog‘lanishlari.
 * Audit jurnali saqlanadi. updateDb ichida chaqiriladi.
 */
export function purgeEmployees(db: Database, companyId: string, ids: Set<string>) {
  const mine = (row: { companyId: string; employeeId?: string }) => row.companyId === companyId && Boolean(row.employeeId && ids.has(row.employeeId));
  const before = db.employees.length;
  db.employees = db.employees.filter((e) => !(e.companyId === companyId && ids.has(e.id)));
  db.attendance = db.attendance.filter((a) => !mine(a));
  db.leaveRequests = db.leaveRequests.filter((l) => !mine(l));
  // Yuz ma’lumoti (Face ID vektorlari, oxirgi skan) va navbatdagi keldi-ketdi rasmlari ham o‘chadi.
  db.faceProfiles = db.faceProfiles.filter((f) => !mine(f));
  db.photoQueue = db.photoQueue.filter((job) => !mine(job));
  db.telegramInvites = db.telegramInvites.filter((i) => !mine(i));
  db.attendanceSessions = db.attendanceSessions.filter((s) => !mine(s));
  db.notifications = db.notifications.filter((n) => !mine(n));
  db.entityMappings = db.entityMappings.filter((m) => !(m.companyId === companyId && m.entity === "employee" && ids.has(m.localId)));
  db.integrationConflicts = db.integrationConflicts.filter((c) => !(c.companyId === companyId && c.entity === "employee" && ids.has(c.localId)));
  for (const request of db.registrations)
    if (request.companyId === companyId && request.employeeId && ids.has(request.employeeId)) request.employeeId = undefined;
  return before - db.employees.length;
}
