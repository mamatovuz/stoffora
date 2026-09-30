export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Mini App sessiyasi uchun Bearer token (cookie bloklangan muhitlar uchun). */
let bearerToken: string | null = null;
export function setBearerToken(token: string | null) {
  bearerToken = token;
  try {
    if (token) sessionStorage.setItem("staffora_mini_token", token);
    else sessionStorage.removeItem("staffora_mini_token");
  } catch {
    /* sessionStorage mavjud emas */
  }
}
export function restoreBearerToken() {
  try {
    bearerToken = sessionStorage.getItem("staffora_mini_token");
  } catch {
    bearerToken = null;
  }
  return bearerToken;
}

export async function api<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${url}`, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(
      "Server bilan aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring.",
      0,
    );
  }
  if (response.status === 423) window.dispatchEvent(new Event("staffora:locked"));
  if (!response.ok) {
    let body: { message?: string; code?: string } & Record<string, unknown> = {};
    try {
      body = await response.json();
    } catch {
      /* JSON emas */
    }
    throw new ApiError(
      body.message || `So‘rov bajarilmadi (${response.status}).`,
      response.status,
      body.code,
      body,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const post = <T>(url: string, body: unknown = {}) =>
  api<T>(url, { method: "POST", body: JSON.stringify(body) });
export const put = <T>(url: string, body: unknown) =>
  api<T>(url, { method: "PUT", body: JSON.stringify(body) });
export const patch = <T>(url: string, body: unknown = {}) =>
  api<T>(url, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T>(url: string) => api<T>(url, { method: "DELETE" });
export const errorText = (reason: unknown, fallback = "Xatolik yuz berdi.") =>
  reason instanceof Error ? reason.message : fallback;

/** Boshqa komponentlarga (masalan, yuqoridagi qo‘ng‘iroqcha) ma’lumot yangilanganini bildiradi. */
export const notifyChange = (name: "notifications" | "leave") =>
  window.dispatchEvent(new Event(`staffora:${name}`));
