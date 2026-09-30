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
    "payroll.view",
    "announcements.*",
    "audit.view",
    "settings.manage",
    "registrations.*",
  ],
  HR_MANAGER: [
    "dashboard.view",
    "employees.view",
    "employees.create",
    "employees.edit",
    "attendance.view",
    "attendance.edit",
    "org.view",
    "leave.view",
    "leave.approve",
    "reports.view",
    "announcements.view",
    "registrations.*",
  ],
  // Moliya: faqat ish haqi, hisobotlar va jarima sozlamalari.
  FINANCE: ["payroll.*", "reports.view", "reports.export"],
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
  "/calendar": ["attendance.view", "leave.view"],
  "/employees": ["employees.view"],
  "/dismissed": ["employees.view"],
  "/registrations": ["registrations.view"],
  "/leave": ["leave.view"],
  "/branches": ["org.view"],
  "/schedules": ["org.view"],
  "/departments": ["org.view"],
  "/positions": ["org.view"],
  "/payroll": ["payroll.view"],
  "/reports": ["reports.view"],
  "/announcements": ["announcements.view"],
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
  const order = ["/dashboard", "/payroll", "/attendance", "/employees", "/reports", "/notifications"];
  return order.find((path) => canOpenPage(role, path)) || "/settings";
}
