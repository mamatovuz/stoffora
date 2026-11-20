import { API_URL } from "./config";
import { devicePublicKey, signDevice, signedMessage } from "./deviceKey";
import { KEYS, secureDelete, secureGet, secureSet } from "./secure";

/*
 * Staffora API mijoz. Refresh token, sessiya ID va 15 daqiqalik access token — Keychain/Keystore’da
 * (access ham saqlanadi: ilova qayta ochilganda imzo + ikki so‘rovsiz darhol ishlaydi; refresh tokendan
 * kuchsizroq, muddati qisqa). Refresh har safar qurilma kaliti imzosi bilan (challenge) va rotatsiya
 * qilinadi. Tokenlar hech qachon log qilinmaydi.
 *
 * Ikki rejim: xodim (HR, moliya, filial rahbari ham) — /mini/* yo‘llari; direktor — access token
 * panel sessiyasining o‘zi (panel API’lari uchun Bearer, lib/manager.ts).
 */

export type Employee = { id: string; firstName: string; lastName: string; companyId: string };
/** Direktor (panel foydalanuvchisi) — ilovada faqat «Rahbar» paneli. */
export type ManagerUser = { id: string; name: string; role: string; branchIds: string[]; photoDataUrl?: string };
export type Company = { id: string; name: string };
export type SessionMode = "employee" | "manager";
type SessionBase = {
  sessionId: string;
  refreshToken: string;
  deviceId: string;
  /** Kirishda yozilgan to‘liq login (ozodbek@staffora.uz) — Profilda ko‘rsatish uchun. */
  login?: string;
};
/** Xodim: keldi-ketdi + /mini/* yo‘llari. */
export type EmployeeSession = SessionBase & { mode: "employee"; employee: Employee };
/** Direktor: faqat rahbar paneli. */
export type ManagerSession = SessionBase & { mode: "manager"; user: ManagerUser; company: Company };
export type StoredSession = EmployeeSession | ManagerSession;
/** Server javobi: login / refresh / eski faollashtirish (u yerda `mode` yo‘q — xodim). */
type TokenResponse = {
  mode?: SessionMode;
  accessToken: string;
  accessExpiresIn: number;
  sessionId: string;
  refreshToken: string;
  deviceId: string;
  employee?: Employee;
  user?: ManagerUser;
  company?: Company;
};
export type DeviceInfo = { platform: "ios" | "android"; model?: string; osVersion?: string; appVersion?: string };

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
type SavedAccess = { token: string; expiresAt: number; sessionId: string };
/** Saqlangan access token ilova ochilganda bir marta o‘qiladi. */
let restored: Promise<void> | null = null;
const listeners = new Set<(reason: string) => void>();
/** Sessiya tugaganda (qurilma bekor qilindi, refresh yaroqsiz) — ilova kirish ekraniga qaytadi. */
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

/*
 * Saqlangan sessiya. `mode` yo‘q eski sessiya (kod bilan faollashtirilgan) — xodim rejimi.
 * Xotirada ham nusxa turadi: rahbar API’si har chaqiruvda Keychain’ni o‘qimasin.
 */
let current: StoredSession | null = null;
const saved = new Set<(session: StoredSession) => void>();
/** Sessiya yozilganda (kirish, refresh — rol yoki kompaniya nomi o‘zgargan bo‘lishi mumkin). */
export const onSessionSaved = (fn: (session: StoredSession) => void) => {
  saved.add(fn);
  return () => saved.delete(fn);
};

type RawSession = Partial<Omit<TokenResponse, "mode">> & { mode?: SessionMode; login?: string };
function normalize(value: RawSession | null | undefined): StoredSession | null {
  if (!value?.sessionId || !value.refreshToken || !value.deviceId) return null;
  const base = { sessionId: value.sessionId, refreshToken: value.refreshToken, deviceId: value.deviceId, login: value.login };
  if (value.mode === "manager") return value.user && value.company ? { ...base, mode: "manager", user: value.user, company: value.company } : null;
  return value.employee ? { ...base, mode: "employee", employee: value.employee } : null;
}

export async function loadSession() {
  if (current) return current;
  current = normalize(await secureGet<RawSession>(KEYS.session));
  return current;
}
/** Xotiradagi sessiya (yuklangan bo‘lsa) — sinxron. */
export const cachedSession = () => current;

async function saveTokens(tokens: TokenResponse, login?: string) {
  const next = normalize({ ...tokens, login: login || current?.login });
  if (!next) throw new ApiError("Server javobi tushunarsiz. Ilovani yangilang.", 0, "BAD_SESSION");
  access = { token: tokens.accessToken, expiresAt: Date.now() + (tokens.accessExpiresIn - 30) * 1000 };
  current = next;
  await Promise.all([secureSet(KEYS.session, next), secureSet(KEYS.access, { ...access, sessionId: next.sessionId } satisfies SavedAccess)]);
  for (const fn of saved) fn(next);
  return next;
}
/**
 * Sessiya «davri»: har chiqishda oshadi. Chiqish paytida yo‘lda qolgan refresh javobi kelsa —
 * u eski davrga tegishli, tokenlar qayta yozilmaydi (aks holda keyingi ochilishda jimgina kirib qolardi).
 */
let epoch = 0;
/** Sessiyani faqat telefondan o‘chiradi (logout). Qurilma kaliti va bog‘lanish saqlanadi. */
export async function clearSession(reason = "logout") {
  epoch += 1;
  access = null;
  current = null;
  refreshing = null;
  await Promise.all([secureDelete(KEYS.session), secureDelete(KEYS.access)]);
  for (const fn of listeners) fn(reason);
}

/** Hisob bloklangan, xodim bo‘shatilgan, kompaniya to‘xtatilgan — sessiyani saqlashdan foyda yo‘q. */
const FATAL_403 = new Set(["ACCOUNT_BLOCKED", "EMPLOYEE_INACTIVE", "COMPANY_SUSPENDED", "NOT_MANAGER"]);
/** Server sessiyani butunlay rad etdimi (tarmoq xatosi emas) — telefondan chiqish kerak. */
export const isFatalSessionError = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || (error.status === 403 && FATAL_403.has(error.code || "")));

async function refresh(): Promise<string> {
  const session = await loadSession();
  if (!session) throw new ApiError("Sessiya yo‘q.", 401, "NO_SESSION");
  const started = epoch;
  try {
    const { nonce } = await publicPost<{ nonce: string }>("/mobile/auth/challenge", { deviceId: session.deviceId });
    const signature = await signDevice(signedMessage("refresh", nonce, session.sessionId));
    const tokens = await publicPost<TokenResponse>("/mobile/auth/refresh", { sessionId: session.sessionId, refreshToken: session.refreshToken, nonce, signature });
    if (started !== epoch) throw new ApiError("Sessiya yopildi.", 401, "NO_SESSION");
    // Eski server `mode` yubormasa — saqlangan rejim va ma’lumotlar qoladi.
    const keep = session.mode === "manager" ? { user: session.user, company: session.company } : { employee: session.employee };
    await saveTokens({ ...keep, ...tokens, mode: tokens.mode || session.mode });
    return tokens.accessToken;
  } catch (error) {
    // Tarmoq xatosida sessiya saqlanadi; server rad etsa — chiqamiz.
    if (started === epoch && isFatalSessionError(error)) await clearSession((error as ApiError).code || "SESSION_INVALID");
    throw error;
  }
}
/** Telefonda saqlangan, shu sessiyaga tegishli va muddati o‘tmagan access token’ni xotiraga qaytaradi. */
function restoreAccess() {
  restored ||= (async () => {
    const started = epoch;
    const [saved, session] = await Promise.all([secureGet<SavedAccess>(KEYS.access), loadSession()]);
    if (started === epoch && !access && saved && session && saved.sessionId === session.sessionId && saved.expiresAt > Date.now())
      access = { token: saved.token, expiresAt: saved.expiresAt };
  })();
  return restored;
}
/** Amaldagi access token. `fresh` — server tokenni rad etgan bo‘lsa, yangisini majburan olish. */
export async function accessToken(fresh = false) {
  await restoreAccess();
  if (fresh && !refreshing) access = null;
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
    return raw<T>(path, { ...init, token: await accessToken(true) });
  }
}
export const post = <T>(path: string, body: unknown = {}, timeoutMs?: number) => api<T>(path, { method: "POST", body: JSON.stringify(body), timeoutMs });
export const put = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

/* ------------------------------------------------------------- kirish --- */
export type LoginResult = { kind: "session"; session: StoredSession } | { kind: "2fa"; message: string };

/**
 * Login + parol bilan kirish. Telefon kaliti shu yerda serverga bog‘lanadi (challenge imzosi):
 * parolning o‘zi yetmaydi — sessiya keyin faqat shu qurilma kaliti bilan yangilanadi.
 * Direktorda Telegram 2FA bo‘lsa — server kod yuboradi, ilova kod bilan qayta chaqiradi (yangi nonce).
 * `fullLogin` — tekshirilgan to‘liq login (ozodbek@staffora.uz).
 */
export async function login(fullLogin: string, password: string, device: DeviceInfo, code?: string): Promise<LoginResult> {
  const publicKey = await devicePublicKey();
  const { nonce } = await publicPost<{ nonce: string }>("/mobile/activation/challenge", { publicKey });
  const normalized = fullLogin.trim().toLowerCase();
  const signature = await signDevice(signedMessage("login", nonce, normalized));
  const result = await publicPost<TokenResponse | { requires2fa: true; message?: string }>("/mobile/auth/login", {
    login: normalized,
    password,
    publicKey,
    nonce,
    signature,
    ...device,
    ...(code ? { code } : {}),
  });
  if ("requires2fa" in result && result.requires2fa) return { kind: "2fa", message: result.message || "Telegram’ga tasdiqlash kodi yuborildi." };
  return { kind: "session", session: await saveTokens(result as TokenResponse, normalized) };
}

/* ------------------------------------- eski faollashtirish (havola orqali) --- */
export type ActivateResult = { kind: "session"; session: StoredSession } | { kind: "pending"; requestId: string; message: string };

/** Faqat eski staffora://activate?code=… havolalari uchun (asosiy kirish — login va parol). */
export async function activate(code: string, device: DeviceInfo): Promise<ActivateResult> {
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
  return { kind: "session", session: await saveTokens(result) };
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
