import { API_URL } from "./config";
import { devicePublicKey, signDevice, signedMessage } from "./deviceKey";
import { KEYS, secureDelete, secureGet, secureSet } from "./secure";

/*
 * Staffora API mijoz. Access token (15 daqiqa) faqat xotirada; refresh token va sessiya ID —
 * Keychain/Keystore’da. Refresh har safar qurilma kaliti imzosi bilan (challenge) va rotatsiya
 * qilinadi. Tokenlar hech qachon log qilinmaydi.
 */

export type Employee = { id: string; firstName: string; lastName: string; companyId: string };
export type StoredSession = { sessionId: string; refreshToken: string; deviceId: string; employee: Employee };
type TokenResponse = StoredSession & { accessToken: string; accessExpiresIn: number };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export const errorText = (error: unknown, fallback = "Xatolik yuz berdi") =>
  error instanceof ApiError ? error.message || fallback : error instanceof Error && error.message ? error.message : fallback;

let access: { token: string; expiresAt: number } | null = null;
let refreshing: Promise<string> | null = null;
const listeners = new Set<(reason: string) => void>();
/** Sessiya tugaganda (qurilma bekor qilindi, refresh yaroqsiz) — ilova faollashtirish ekraniga qaytadi. */
export const onSignedOut = (fn: (reason: string) => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

async function raw<T>(path: string, init: RequestInit & { token?: string; timeoutMs?: number } = {}): Promise<T> {
  if (!API_URL) throw new ApiError("Server manzili sozlanmagan (EXPO_PUBLIC_API_URL).", 0, "NO_API_URL");
  let response: Response;
  try {
    response = await fetch(API_URL + path, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
    });
  } catch {
    throw new ApiError("Internet aloqasi yo‘q yoki server javob bermadi.", 0, "NETWORK");
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(String(body.message || `Xatolik (${response.status})`), response.status, body.code as string | undefined, body);
  return body as T;
}

export const publicPost = <T>(path: string, body: unknown) => raw<T>(path, { method: "POST", body: JSON.stringify(body) });

export async function loadSession() {
  return secureGet<StoredSession>(KEYS.session);
}
export async function saveTokens(tokens: TokenResponse) {
  const { accessToken, accessExpiresIn, sessionId, refreshToken, deviceId, employee } = tokens;
  access = { token: accessToken, expiresAt: Date.now() + (accessExpiresIn - 30) * 1000 };
  await secureSet(KEYS.session, { sessionId, refreshToken, deviceId, employee } satisfies StoredSession);
}
/** Sessiyani faqat telefondan o‘chiradi (logout). Qurilma kaliti va bog‘lanish saqlanadi. */
export async function clearSession(reason = "logout") {
  access = null;
  await secureDelete(KEYS.session);
  for (const fn of listeners) fn(reason);
}

async function refresh(): Promise<string> {
  const session = await loadSession();
  if (!session) throw new ApiError("Sessiya yo‘q.", 401, "NO_SESSION");
  try {
    const { nonce } = await publicPost<{ nonce: string }>("/mobile/auth/challenge", { deviceId: session.deviceId });
    const signature = await signDevice(signedMessage("refresh", nonce, session.sessionId));
    const tokens = await publicPost<TokenResponse>("/mobile/auth/refresh", { sessionId: session.sessionId, refreshToken: session.refreshToken, nonce, signature });
    await saveTokens(tokens);
    return tokens.accessToken;
  } catch (error) {
    // Tarmoq xatosida sessiya saqlanadi; server rad etsa — chiqamiz.
    if (error instanceof ApiError && error.status === 401) await clearSession(error.code || "SESSION_INVALID");
    throw error;
  }
}
export async function accessToken() {
  if (access && access.expiresAt > Date.now()) return access.token;
  refreshing ||= refresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Xodim API (o‘sha /mini/* va /mobile/* yo‘llari). 401 bo‘lsa bir marta yangilab qayta urinadi. */
export async function api<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const token = await accessToken();
  try {
    return await raw<T>(path, { ...init, token });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    if (error.code === "DEVICE_REVOKED") {
      await clearSession("DEVICE_REVOKED");
      throw error;
    }
    access = null;
    return raw<T>(path, { ...init, token: await accessToken() });
  }
}
export const post = <T>(path: string, body: unknown = {}, timeoutMs?: number) => api<T>(path, { method: "POST", body: JSON.stringify(body), timeoutMs });
export const put = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

/* ------------------------------------------------------- faollashtirish --- */
export type ActivateResult = { kind: "session"; employee: Employee } | { kind: "pending"; requestId: string; message: string };

export async function activate(code: string, device: { platform: "ios" | "android"; model?: string; osVersion?: string; appVersion?: string }): Promise<ActivateResult> {
  const publicKey = await devicePublicKey();
  const { nonce } = await publicPost<{ nonce: string }>("/mobile/activation/challenge", { publicKey });
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const signature = await signDevice(signedMessage("activate", nonce, normalized));
  const result = await publicPost<TokenResponse | { requestId: string; status: "PENDING"; message: string }>("/mobile/activate", {
    code: normalized,
    publicKey,
    nonce,
    signature,
    ...device,
  });
  if ("requestId" in result) return { kind: "pending", requestId: result.requestId, message: result.message };
  await saveTokens(result);
  return { kind: "session", employee: result.employee };
}

/** Yangi telefon so‘rovi holati (HR tasdiqlasa — shu yerda sessiya beriladi). */
export async function replacementStatus(requestId: string): Promise<"PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"> {
  const publicKey = await devicePublicKey();
  const { nonce } = await publicPost<{ nonce: string }>("/mobile/activation/challenge", { publicKey });
  const signature = await signDevice(signedMessage("status", nonce, requestId));
  const result = await publicPost<{ status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" } & Partial<TokenResponse>>("/mobile/activation/status", { requestId, publicKey, nonce, signature });
  if (result.status === "APPROVED" && result.accessToken) await saveTokens(result as TokenResponse);
  return result.status;
}

/** Chiqish: serverda sessiya yopiladi, telefondagi tokenlar o‘chiriladi. Qurilma bog‘lanishi qoladi. */
export async function logout() {
  const session = await loadSession();
  if (session) await publicPost("/mobile/auth/logout", { sessionId: session.sessionId, refreshToken: session.refreshToken }).catch(() => undefined);
  await clearSession("logout");
}
