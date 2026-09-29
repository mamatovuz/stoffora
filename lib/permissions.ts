import type { Role } from "./types";

const rolePermissions: Record<Role, string[]> = {
  SUPER_ADMIN: ["*"],
  COMPANY_OWNER: ["*"],
  HR_ADMIN: [
    "employees.*",
    "attendance.*",
    "branches.*",
    "leave.*",
    "reports.*",
    "announcements.*",
    "audit.view",
    "settings.manage",
  ],
  HR_MANAGER: [
    "employees.view",
    "employees.create",
    "employees.edit",
    "attendance.view",
    "attendance.edit",
    "leave.view",
    "leave.approve",
    "reports.view",
  ],
  FINANCE: ["employees.view", "payroll.*", "reports.view", "reports.export"],
  IT_ADMIN: ["employees.view", "devices.*", "settings.manage", "audit.view"],
  BRANCH_MANAGER: [
    "employees.view",
    "attendance.view",
    "attendance.edit",
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
