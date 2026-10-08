import type { Role } from "@/lib/types";

/*
 * Rahbar sessiyasi (Mini App ichida). Alohida modulda — asosiy Mini App
 * rahbar panelining kodini yuklamasdan, faqat «rahbarmi?» ni bilib oladi.
 */

export type ManagerAuth = {
  token: string;
  user: { id: string; name: string; role: Role; branchIds: string[]; photoDataUrl?: string };
  company: { id: string; name: string };
};
export type ManagerView = "desk" | "today" | "requests" | "map" | "week" | "money" | "devices" | "admin";

/** Rahbar sessiyasini so‘raydi. Rahbar bo‘lmasa null (jim). */
export async function requestManagerAuth(initData: string): Promise<ManagerAuth | null> {
  try {
    const response = await fetch("/api/telegram/manager-auth", {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    if (response.status !== 200) return null;
    return (await response.json()) as ManagerAuth;
  } catch {
    return null;
  }
}
