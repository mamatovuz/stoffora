import { ApiError, post } from "./api";
import { API_URL } from "./config";

/*
 * Rahbar rejimi: ishonchli telefon orqali panel sessiyasi olinadi va panelning o‘z API’lari
 * chaqiriladi (huquq, filial chegarasi va audit — serverda, xuddi paneldagidek).
 * Token faqat xotirada; telefon bekor qilinsa server bu sessiyani ham yopadi.
 */
export type Role = "COMPANY_OWNER" | "HR_ADMIN" | "HR_MANAGER" | "BRANCH_MANAGER" | "FINANCE" | string;
export type ManagerAuth = { token: string; user: { id: string; name: string; role: Role; branchIds: string[] }; company: { id: string; name: string } };

let current: Promise<ManagerAuth> | null = null;
export function managerAuth(fresh = false) {
  if (fresh || !current)
    current = post<ManagerAuth>("/mobile/manager/session", {}).catch((error) => {
      current = null;
      throw error;
    });
  return current;
}
export const resetManager = () => {
  current = null;
};

/** Panel API chaqiruvi (Bearer). 401 bo‘lsa — sessiya yangilanib bir marta qayta urinadi. */
export async function mcall<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", retry = true): Promise<T> {
  const auth = await managerAuth();
  let response: Response;
  try {
    response = await fetch(API_URL + path, {
      method,
      headers: { authorization: `Bearer ${auth.token}`, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError("Server bilan aloqa yo‘q.", 0, "NETWORK");
  }
  if (response.status === 401 && retry) {
    await managerAuth(true);
    return mcall<T>(path, body, method, false);
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(String(data.message || `So‘rov bajarilmadi (${response.status}).`), response.status);
  return data as T;
}

/* Rol huquqlari — lib/permissions bilan bir xil mantiq (faqat ko‘rsatish uchun; tekshiruv serverda). */
const ROLE_PERMS: Record<string, string[]> = {
  COMPANY_OWNER: ["*"],
  // HR bitta: «HR menejer» ham HR bilan bir xil.
  HR_ADMIN: ["attendance.view", "attendance.edit", "leave.approve", "employees.edit", "employees.view", "dashboard.view", "announcements.create", "ops.manage"],
  HR_MANAGER: ["attendance.view", "attendance.edit", "leave.approve", "employees.edit", "employees.view", "dashboard.view", "announcements.create", "ops.manage"],
  FINANCE: ["payroll.edit"],
  // IT: telefonlar (ulash/almashtirish/o‘chirish).
  IT_ADMIN: ["devices.manage", "employees.view", "incidents.it"],
  BRANCH_MANAGER: ["attendance.view", "attendance.edit", "dashboard.view", "ops.manage"],
};
export const can = (role: Role, permission: string) => (ROLE_PERMS[role] || []).some((p) => p === "*" || p === permission);


export { canOpenPage, canWeb } from "./permissions";
