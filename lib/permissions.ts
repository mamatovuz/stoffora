import type { Role } from "./types";

/*
 * Rollar va ruxsatlar — server ham, panel (menyu, sahifa himoyasi) ham shu
 * yagona manbadan foydalanadi. Har bir rol faqat o‘z ishiga tegishli bo‘limlarni ko‘radi.
 */
const rolePermissions: Record<Role, string[]> = {
  SUPER_ADMIN: ["*"],
  COMPANY_OWNER: ["*"],
  HR_ADMIN: [
    "dashboard.view",
    "employees.*",
    "attendance.*",
    "branches.*",
    "org.view",
    "leave.*",
    "reports.*",
    // HR moliya bo‘limini (ish haqi, avanslar, moliyaviy eksport) ko‘rmaydi — bu moliya va direktor ishi.
    "announcements.*",
    "audit.view",
    "settings.manage",
    "registrations.*",
  ],
  // «HR menejer» va «HR administrator» — bitta HR: huquqlar bir xil (eski hisoblar ham to‘liq HR).
  HR_MANAGER: [],
  // Moliya: faqat moliya (ish haqi, avans, jarima, rag‘batlantirish, moliyaviy eksport).
  // Xodimlar ro‘yxati, davomat va shaxsiy ma’lumotlar — ko‘rinmaydi.
  FINANCE: ["payroll.*"],
  IT_ADMIN: ["dashboard.view", "employees.view", "org.view", "devices.*", "settings.manage", "audit.view"],
  BRANCH_MANAGER: [
    "dashboard.view",
    "employees.view",
    "attendance.view",
    "attendance.edit",
    "org.view",
    "leave.view",
  ],
  EMPLOYEE: ["profile.view", "attendance.self", "leave.self"],
};

rolePermissions.HR_MANAGER = rolePermissions.HR_ADMIN;

export function can(role: Role, permission: string) {
  return rolePermissions[role].some(
    (grant) =>
      grant === "*" ||
      grant === permission ||
      (grant.endsWith(".*") && permission.startsWith(grant.slice(0, -1))),
  );
}

export const canAny = (role: Role, permissions: string[]) => permissions.some((p) => can(role, p));

/** Panel sahifalari → kerakli ruxsat (bo‘sh — har qanday panel foydalanuvchisi). */
export const pagePermissions: Record<string, string[]> = {
  "/dashboard": ["dashboard.view"],
  "/attendance": ["attendance.view"],
  "/map": ["attendance.view"],
  "/calendar": ["attendance.view", "leave.view"],
  "/employees": ["employees.view"],
  "/dismissed": ["employees.view"],
  "/registrations": ["registrations.view"],
  "/leave": ["leave.view"],
  "/attendance-requests": ["attendance.edit", "leave.approve"],
  "/branches": ["org.view"],
  "/schedules": ["org.view"],
  "/departments": ["org.view"],
  "/positions": ["org.view"],
  "/payroll": ["payroll.view"],
  "/advances": ["payroll.view", "payroll.edit"],
  "/fines": ["employees.edit", "payroll.edit", "attendance.edit"],
  "/rewards": ["payroll.view", "payroll.edit"],
  "/finance": ["payroll.view", "payroll.edit"],
  "/timesheet": ["employees.edit", "payroll.view", "payroll.edit"],
  "/assets": ["devices.manage", "employees.edit"],
  "/reports": ["reports.view"],
  "/analytics": ["dashboard.view"],
  "/announcements": ["announcements.view"],
  "/helpdesk": ["employees.edit", "leave.approve"],
  "/notifications": [],
  "/audit": ["audit.view"],
  "/users": ["settings.manage"],
  "/roles": ["settings.manage"],
  "/settings": [],
};

export function canOpenPage(role: Role, path: string) {
  const key = Object.keys(pagePermissions)
    .filter((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return true;
  const need = pagePermissions[key];
  return !need.length || canAny(role, need);
}

/** Kirgandan keyingi birinchi sahifa — rolga mos. */
export function homePage(role: Role) {
  // Bosh sahifa (bugungi statistika) birinchi; uni ko‘ra olmaydigan rol (moliya) — Ish stoli.
  const order = ["/dashboard", "/workspace", "/finance", "/payroll", "/attendance", "/employees", "/reports", "/notifications"];
  return order.find((path) => canOpenPage(role, path)) || "/settings";
}
