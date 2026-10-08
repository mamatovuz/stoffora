import bcrypt from "bcryptjs";
import type { Company, Database, User } from "./types";

export function emptyDatabase(): Database {
  return {
    companies: [],
    branches: [],
    departments: [],
    positions: [],
    schedules: [],
    employees: [],
    attendance: [],
    leaveRequests: [],
    auditLogs: [],
    announcements: [],
    notifications: [],
    users: [],
    telegramInvites: [],
    attendanceSessions: [],
    qrNonces: [],
    faceProfiles: [],
    panelSessions: [],
    photoQueue: [],
    channelPosts: [],
    integrations: [],
    entityMappings: [],
    syncJobs: [],
    integrationConflicts: [],
    registrations: [],
    payrollAdjustments: [],
    payrollPeriods: [],
    scheduleOverrides: [],
    shiftSwaps: [],
    advanceRequests: [],
    documents: [],
    sentGreetings: [],
    biometricDevices: [],
    lateNotices: [],
    clientLogs: [],
    tickets: [],
    certificateRequests: [],
    payoutCards: [],
    dayOffMoves: [],
    attendanceCorrections: [],
    rewardAwards: [],
    payrollWorkflows: [],
    holidays: [],
    leads: [],
    branchTransfers: [],
    assets: [],
    delegations: [],
    shiftTemplates: [],
    mobileDevices: [],
    mobileSessions: [],
    mobileActivationCodes: [],
    deviceChangeRequests: [],
    mobilePushTokens: [],
  };
}

/**
 * Yangi baza. Agar BOOTSTRAP_* qiymatlari berilgan bo‘lsa, kompaniya va egasi
 * avtomatik yaratiladi. Aks holda baza bo‘sh qoladi va birinchi kirishda
 * /setup sahifasi orqali kompaniya yaratiladi.
 */
export async function createSeed(): Promise<Database> {
  const database = emptyDatabase();
  const companyName = process.env.BOOTSTRAP_COMPANY_NAME?.trim();
  const ownerName = process.env.BOOTSTRAP_OWNER_NAME?.trim();
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (companyName && ownerName && adminEmail && adminPassword) {
    if (adminPassword.length < 10)
      throw new Error(
        "BOOTSTRAP_ADMIN_PASSWORD kamida 10 belgidan iborat bo‘lsin.",
      );
    const company = createCompany({
      name: companyName,
      ownerName,
      plan: process.env.BOOTSTRAP_PLAN?.trim() || "Business",
      status: "ACTIVE",
    });
    database.companies.push(company);
    database.users.push(
      await createUser({
        companyId: company.id,
        name: ownerName,
        email: adminEmail,
        password: adminPassword,
        role: "COMPANY_OWNER",
      }),
    );
  }

  const superAdminEmail = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim()
    .toLowerCase();
  const superAdminPassword = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
  if (superAdminEmail && superAdminPassword && superAdminPassword.length >= 10)
    database.users.push(
      await createUser({
        name: "Staffora Super Admin",
        email: superAdminEmail,
        password: superAdminPassword,
        role: "SUPER_ADMIN",
      }),
    );

  return database;
}

export function createCompany(input: {
  name: string;
  ownerName: string;
  plan?: string;
  status?: Company["status"];
}): Company {
  return {
    id: crypto.randomUUID(),
    name: input.name,
    slug: slugify(input.name),
    ownerName: input.ownerName,
    plan: input.plan || "Business",
    status: input.status || "ACTIVE",
    timezone: "Asia/Tashkent",
    createdAt: new Date().toISOString(),
  };
}

export async function createUser(input: {
  companyId?: string;
  name: string;
  email: string;
  password: string;
  role: User["role"];
}): Promise<User> {
  return {
    id: crypto.randomUUID(),
    companyId: input.companyId,
    name: input.name,
    email: input.email.trim().toLowerCase(),
    passwordHash: await bcrypt.hash(input.password, 12),
    role: input.role,
  };
}

export function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || `company-${Date.now()}`
  );
}

const demoCompanyIds = new Set(["cmp_gulnora", "cmp_ziyoda"]);
const demoUserIds = new Set(["usr_admin", "usr_super"]);
const demoEmails = new Set(["admin@staffora.uz", "super@staffora.uz"]);
const demoBranchIds = new Set(["br_andijon", "br_asaka", "br_shahrixon"]);
const demoScheduleIds = new Set(["sch_standard", "sch_flexible"]);
const isDemoId = (value: string, prefix: string) =>
  new RegExp(`^${prefix}_\\d{3}$`).test(value);

/**
 * Eski versiyadagi demo yozuvlarni faqat ularning ma’lum ID’lari bo‘yicha
 * olib tashlaydi. Foydalanuvchi o‘zi kiritgan (UUID ID’li) ma’lumotlar saqlanadi.
 * Qaytaradi: o‘chirilgan yozuvlar soni.
 */
export function purgeLegacyDemoData(db: Database) {
  const before = countRows(db);
  const demoEmployee = (item: { id: string; email?: string }) =>
    isDemoId(item.id, "emp") &&
    (!item.email || /@gulnorafarm\.uz$/i.test(item.email));
  const demoEmployeeIds = new Set(
    db.employees.filter(demoEmployee).map((item) => item.id),
  );
  db.employees = db.employees.filter((item) => !demoEmployeeIds.has(item.id));
  const keepEmployees = db.employees;

  db.attendance = db.attendance.filter(
    (item) =>
      !isDemoId(item.id, "att") && !demoEmployeeIds.has(item.employeeId),
  );
  db.leaveRequests = db.leaveRequests.filter(
    (item) =>
      !isDemoId(item.id, "leave") && !demoEmployeeIds.has(item.employeeId),
  );
  db.auditLogs = db.auditLogs.filter(
    (item) => !isDemoId(item.id, "audit") && !demoEmployeeIds.has(item.entityId),
  );
  db.announcements = db.announcements.filter(
    (item) => !isDemoId(item.id, "ann"),
  );
  db.notifications = db.notifications.filter(
    (item) => !isDemoId(item.id, "not"),
  );
  db.faceProfiles = db.faceProfiles.filter(
    (item) => !demoEmployeeIds.has(item.employeeId),
  );
  db.telegramInvites = db.telegramInvites.filter(
    (item) => !demoEmployeeIds.has(item.employeeId),
  );
  db.attendanceSessions = db.attendanceSessions.filter(
    (item) => !demoEmployeeIds.has(item.employeeId),
  );

  // Demo filial/grafik/bo‘lim/lavozimlarni faqat real xodim ishlatmasa o‘chiramiz.
  db.branches = db.branches.filter(
    (item) =>
      !demoBranchIds.has(item.id) ||
      keepEmployees.some((employee) => employee.branchId === item.id),
  );
  db.schedules = db.schedules.filter(
    (item) =>
      !demoScheduleIds.has(item.id) ||
      keepEmployees.some((employee) => employee.scheduleId === item.id) ||
      db.branches.some((branch) => branch.scheduleId === item.id),
  );
  db.positions = db.positions.filter(
    (item) =>
      !isDemoId(item.id, "pos") ||
      keepEmployees.some((employee) => employee.positionId === item.id),
  );
  db.departments = db.departments.filter(
    (item) =>
      !isDemoId(item.id, "dep") ||
      keepEmployees.some((employee) => employee.departmentId === item.id) ||
      db.positions.some((position) => position.departmentId === item.id),
  );

  db.users = db.users.filter(
    (item) =>
      !demoUserIds.has(item.id) && !demoEmails.has(item.email.toLowerCase()),
  );
  db.companies = db.companies.filter(
    (company) =>
      !demoCompanyIds.has(company.id) ||
      db.employees.some((item) => item.companyId === company.id) ||
      db.branches.some((item) => item.companyId === company.id) ||
      db.users.some((item) => item.companyId === company.id),
  );
  return before - countRows(db);
}

function countRows(db: Database) {
  return Object.values(db).reduce(
    (sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0),
    0,
  );
}
