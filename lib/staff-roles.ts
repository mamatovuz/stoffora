import type { Database, Employee, Role, User } from "./types";

/*
 * Lavozim va filial orqali panel huquqlari:
 *   • Lavozimda «Panel huquqi» tanlangan bo‘lsa (HR, Moliya, IT, Filial rahbari…) — shu lavozimdagi
 *     har bir xodim uchun avtomatik panel hisobi ochiladi (Mini App, mobil ilova va sayt).
 *   • Filialda «Filial rahbarlari» tanlangan xodimlar — shu filial(lar)ning rahbari bo‘ladi.
 * Avtomatik hisob xodimga bog‘langan (employeeId, autoRole): lavozim o‘zgarsa yoki xodim ishdan
 * ketsa — huquq ham o‘zgaradi / o‘chadi. Qo‘lda yaratilgan hisoblarga tegilmaydi.
 */

export const STAFF_ROLES = ["HR_ADMIN", "HR_MANAGER", "FINANCE", "IT_ADMIN", "BRANCH_MANAGER"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  HR_ADMIN: "HR administrator",
  HR_MANAGER: "HR menejer",
  FINANCE: "Moliya",
  IT_ADMIN: "IT xodimi",
  BRANCH_MANAGER: "Filial rahbari",
};

const fullName = (e: Employee) => `${e.firstName} ${e.lastName}`.trim();

/** Xodimga lavozim/filial bo‘yicha qanday huquq tegishli (yo‘q bo‘lsa — undefined). */
export function desiredStaffRole(db: Pick<Database, "positions" | "branches">, employee: Employee): { role: Role; branchIds: string[] } | undefined {
  if (employee.status !== "ACTIVE") return undefined;
  const managed = db.branches.filter((b) => b.companyId === employee.companyId && (b.managerEmployeeIds || []).includes(employee.id)).map((b) => b.id);
  const positionRole = db.positions.find((p) => p.id === employee.positionId && p.companyId === employee.companyId)?.panelRole;
  if (positionRole && positionRole !== "BRANCH_MANAGER") return { role: positionRole, branchIds: [] };
  if (positionRole === "BRANCH_MANAGER" || managed.length) return { role: "BRANCH_MANAGER", branchIds: managed.length ? managed : [employee.branchId] };
  return undefined;
}

/**
 * Kompaniyadagi avtomatik hisoblarni lavozim/filial sozlamasiga moslaydi. updateDb ichida chaqiriladi.
 * Qaytaradi: o‘zgargan hisoblar soni.
 */
export function syncStaffRoles(db: Database, companyId: string): number {
  let changes = 0;
  const now = new Date().toISOString();
  const employees = db.employees.filter((e) => e.companyId === companyId);
  // Filialdagi «rahbar» matni — tanlangan rahbarlar ismi.
  for (const branch of db.branches)
    if (branch.companyId === companyId && branch.managerEmployeeIds) {
      branch.managerEmployeeIds = branch.managerEmployeeIds.filter((id) => employees.some((e) => e.id === id && e.status === "ACTIVE"));
      const names = branch.managerEmployeeIds.map((id) => fullName(employees.find((e) => e.id === id)!)).join(", ");
      if (branch.managerEmployeeIds.length && branch.manager !== names) branch.manager = names;
    }
  for (const employee of employees) {
    const want = desiredStaffRole(db, employee);
    const auto = db.users.find((u) => u.companyId === companyId && u.autoRole && u.employeeId === employee.id);
    if (!want) {
      if (auto) {
        db.users = db.users.filter((u) => u.id !== auto.id);
        for (const s of db.panelSessions) if (s.userId === auto.id && !s.revokedAt) s.revokedAt = now;
        changes += 1;
      }
      continue;
    }
    // Qo‘lda yaratilgan hisob (shu Telegram bilan) bo‘lsa — u ustun, avtomatik ochilmaydi.
    const manual = employee.telegramId && db.users.find((u) => u.companyId === companyId && !u.autoRole && u.telegramId === employee.telegramId);
    if (manual) {
      if (auto) {
        db.users = db.users.filter((u) => u.id !== auto.id);
        changes += 1;
      }
      continue;
    }
    const telegramId = employee.telegramId && !employee.telegramId.startsWith("dev") ? employee.telegramId : undefined;
    if (!auto) {
      const user: User = {
        id: globalThis.crypto.randomUUID(),
        companyId,
        name: fullName(employee),
        email: `xodim-${employee.id.slice(0, 8)}@staffora.local`,
        passwordHash: "",
        role: want.role,
        telegramId,
        telegramUsername: employee.telegramUsername,
        photoDataUrl: undefined,
        branchIds: want.branchIds,
        employeeId: employee.id,
        autoRole: true,
      };
      db.users.push(user);
      changes += 1;
      continue;
    }
    const sameBranches = (auto.branchIds || []).join() === want.branchIds.join();
    if (auto.role !== want.role || !sameBranches || auto.telegramId !== telegramId || auto.name !== fullName(employee)) {
      const roleChanged = auto.role !== want.role || !sameBranches;
      Object.assign(auto, { role: want.role, branchIds: want.branchIds, telegramId, telegramUsername: employee.telegramUsername, name: fullName(employee) });
      // Huquq o‘zgarsa — eski sessiyalar yopiladi (yangi huquq bilan qayta kiradi).
      if (roleChanged) for (const s of db.panelSessions) if (s.userId === auto.id && !s.revokedAt) s.revokedAt = now;
      changes += 1;
    }
  }
  return changes;
}

/** Yangi xodim uchun rahbar: filial rahbarlari (xodimning o‘zi emas). */
export function branchManagerNames(db: Pick<Database, "branches" | "employees">, branchId: string, exceptEmployeeId?: string) {
  const branch = db.branches.find((b) => b.id === branchId);
  const ids = (branch?.managerEmployeeIds || []).filter((id) => id !== exceptEmployeeId);
  if (!ids.length) return branch?.manager || "";
  return ids
    .map((id) => db.employees.find((e) => e.id === id))
    .filter((e): e is Employee => Boolean(e))
    .map(fullName)
    .join(", ");
}
