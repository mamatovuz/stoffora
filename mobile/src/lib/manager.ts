import { Linking } from "react-native";
import { ApiError, accessToken, cachedSession, loadSession, onSignedOut, post } from "./api";
import { API_URL, SERVER_ORIGIN } from "./config";

/*
 * Rahbar rejimi: panelning o‘z API’lari chaqiriladi (huquq, filial chegarasi va audit — serverda,
 * xuddi paneldagidek). Panel tokeni ikki yo‘l bilan olinadi:
 *   • direktor (login rejimi «manager») — ilovaga kirish tokenining o‘zi panel sessiyasi; u
 *     /mobile/auth/refresh bilan yangilanadi (lib/api.ts, accessToken);
 *   • rahbar-xodim (HR, moliya, filial rahbari) — xodim sessiyasi bilan /mobile/manager/session.
 * Token faqat xotirada; telefon bekor qilinsa server bu sessiyani ham yopadi.
 */
export type Role = "COMPANY_OWNER" | "HR_ADMIN" | "HR_MANAGER" | "BRANCH_MANAGER" | "FINANCE" | string;
export type ManagerAuth = { token: string; user: { id: string; name: string; role: Role; branchIds: string[]; photoDataUrl?: string }; company: { id: string; name: string } };

let current: Promise<ManagerAuth> | null = null;
// Chiqishda rahbar sessiyasi ham unutiladi — keyingi hisob eski panel tokenini ishlatmasin.
onSignedOut(() => {
  current = null;
});

export async function managerAuth(fresh = false): Promise<ManagerAuth> {
  const session = cachedSession() || (await loadSession());
  if (session?.mode === "manager") {
    const token = await accessToken(fresh);
    // Refresh rol yoki kompaniya nomini yangilagan bo‘lishi mumkin — eng so‘nggi nusxa.
    const latest = cachedSession();
    const s = latest?.mode === "manager" ? latest : session;
    return { token, user: s.user, company: s.company };
  }
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
export async function mcall<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", retry = true, timeoutMs = 20_000): Promise<T> {
  const auth = await managerAuth();
  let response: Response;
  try {
    response = await fetch(API_URL + path, {
      method,
      headers: { authorization: `Bearer ${auth.token}`, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError("Server bilan aloqa yo‘q.", 0, "NETWORK");
  }
  if (response.status === 401 && retry) {
    await managerAuth(true);
    return mcall<T>(path, body, method, false, timeoutMs);
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(String(data.message || `So‘rov bajarilmadi (${response.status}).`), response.status, data.code as string | undefined, data);
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

/** Rol nomi (Profil va rahbar paneli sarlavhasi). */
export const ROLE_LABEL: Record<string, string> = {
  COMPANY_OWNER: "Direktor",
  HR_ADMIN: "HR",
  HR_MANAGER: "HR",
  FINANCE: "Moliya",
  IT_ADMIN: "IT administrator",
  BRANCH_MANAGER: "Filial rahbari",
};

export { canOpenPage, canWeb } from "./permissions";

/**
 * Panel faylini (Excel/CSV hisobot) ochish: server 5 daqiqalik bir martalik imzolangan havola beradi —
 * doimiy token URL’ga qo‘yilmaydi. Fayl tizim brauzerida ochiladi (u yerdan saqlash / ulashish).
 */
export async function openPanelFile(path: string) {
  const { path: link } = await mcall<{ path: string }>("/file-link", { path });
  await Linking.openURL(SERVER_ORIGIN + link);
}
