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

/** So‘rov 20 soniyadan oshsa to‘xtatiladi — ekran cheksiz «yuklanmoqda»da qolmasin. */
const REQUEST_TIMEOUT_MS = 20_000;
/** Mobil tarmoqdagi qisqa uzilishlarda qayta urinish oraliqlari (ms). */
const RETRY_DELAYS = [600, 1500];

export async function api<T>(
  url: string,
  options: RequestInit & { retry?: boolean } = {},
): Promise<T> {
  const { retry, ...init } = options;
  // O‘qish so‘rovlari va aniq ruxsat berilganlar (masalan, kirish) qayta uriniladi;
  // ma’lumot o‘zgartiradigan so‘rovlar ikki marta bajarilib qolmasligi uchun — yo‘q.
  const retriable = retry ?? (!init.method || init.method === "GET");
  let response: Response | undefined;
  for (let attempt = 0; ; attempt += 1) {
    const controller = init.signal ? undefined : new AbortController();
    const timer = controller ? window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : undefined;
    try {
      response = await fetch(`/api${url}`, {
        credentials: "include",
        ...init,
        signal: init.signal || controller?.signal,
        headers: {
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
          ...init.headers,
        },
      });
      // Server qayta ishga tushayotgan (502/503/504) bo‘lsa — o‘qish so‘rovi qayta uriniladi.
      if (retriable && [502, 503, 504].includes(response.status) && attempt < RETRY_DELAYS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
        continue;
      }
      break;
    } catch (reason) {
      if (init.signal?.aborted) throw reason;
      if (retriable && attempt < RETRY_DELAYS.length && navigator.onLine !== false) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
        continue;
      }
      throw new ApiError(
        controller?.signal.aborted
          ? "Server javob bermadi. Birozdan keyin qayta urinib ko‘ring."
          : "Server bilan aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring.",
        0,
      );
    } finally {
      if (timer) window.clearTimeout(timer);
    }
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
