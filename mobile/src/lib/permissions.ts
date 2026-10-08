type Role = string;
/*
 * Saytdagi ruxsatlar — lib/permissions.ts bilan AYNAN bir xil (ilova «Boshqaruv» bo‘limlari
 * saytdagi menyu bilan bir xil ko‘rinsin). Ilova loyihasi ildizdagi lib’ni import qila olmaydi,
 * shuning uchun nusxa; o‘zgarsa — ikkalasini birga yangilang (tests/permissions.test.ts tekshiradi).
 */
const HR_PERMS = ["dashboard.view", "employees.*", "attendance.*", "branches.*", "org.view", "leave.*", "reports.*", "announcements.*", "audit.view", "settings.manage", "registrations.*"];
export const WEB_ROLE_PERMS: Record<string, string[]> = {
  SUPER_ADMIN: ["*"],
  COMPANY_OWNER: ["*"],
  HR_ADMIN: HR_PERMS,
  HR_MANAGER: HR_PERMS,
  FINANCE: ["payroll.*"],
  IT_ADMIN: ["dashboard.view", "employees.view", "org.view", "devices.*", "settings.manage", "audit.view"],
  BRANCH_MANAGER: ["dashboard.view", "employees.view", "attendance.view", "attendance.edit", "org.view", "leave.view"],
  EMPLOYEE: ["profile.view", "attendance.self", "leave.self"],
};
/** Saytdagi `can` bilan bir xil (wildcard «employees.*» ham). */
export const canWeb = (role: Role, permission: string) =>
  (WEB_ROLE_PERMS[role] || []).some((grant) => grant === "*" || grant === permission || (grant.endsWith(".*") && permission.startsWith(grant.slice(0, -1))));
export const WEB_PAGE_PERMS: Record<string, string[]> = {
  "/employees": ["employees.view"],
  "/registrations": ["registrations.view"],
  "/leave": ["leave.view"],
  "/branches": ["org.view"],
  "/schedules": ["org.view"],
  "/payroll": ["payroll.view"],
  "/timesheet": ["employees.edit", "payroll.view", "payroll.edit"],
  "/reports": ["reports.view"],
  "/announcements": ["announcements.view"],
  "/helpdesk": ["employees.edit", "leave.approve"],
  "/audit": ["audit.view"],
  "/users": ["settings.manage"],
};
export const canOpenPage = (role: Role, path: string) => {
  const need = WEB_PAGE_PERMS[path];
  return !need || !need.length || need.some((p) => canWeb(role, p));
};
