import { redact } from "./secrets";

/*
 * Gulnora Farm HR bot REST API (v1) mijozi.
 *
 *  - Javob konverti: {success, data, meta} yoki {success:false, error{code,message,details}}
 *  - Auth: Authorization: Bearer gfk_...
 *  - 429 → Retry-After bo‘yicha kutib qayta urinadi; 5xx/tarmoq → eksponensial backoff
 *  - Yozish so‘rovlarida Idempotency-Key (bot 24 soat eslab qoladi)
 *  - Xato matnlarida kalit hech qachon chiqmaydi
 */

export class BotApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: unknown,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
  /** Qayta urinish mantiqiymi (vaqtinchalik xato). */
  get transient() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export type BotPage<T> = { items: T[]; total: number; pages: number };

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** Testlar uchun: kutishni almashtirish. */
  sleep?: (ms: number) => Promise<void>;
}

/** Foydalanuvchi kiritgan manzilni /api/v1 bazasiga keltiradi. */
export function normalizeBaseUrl(input: string) {
  let url = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const parsed = new URL(url);
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (!/\/api\/v1$/.test(pathname)) pathname = `${pathname.replace(/\/api$/, "")}/api/v1`;
  parsed.pathname = pathname;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Testlar uchun: tarmoq va kutishni almashtirish (hamma mijozlarga ta’sir qiladi). */
const testOverrides: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {};
export function configureBotClientForTests(overrides: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }) {
  testOverrides.fetchImpl = overrides.fetchImpl;
  testOverrides.sleep = overrides.sleep;
}

export class BotClient {
  private baseUrl: string;
  private apiKey: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;
  private maxRetries: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(options: ClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl || testOverrides.fetchImpl || fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.sleep = options.sleep || testOverrides.sleep || defaultSleep;
  }

  async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options: {
      query?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      idempotencyKey?: string;
    } = {},
  ): Promise<{ data: T; meta?: Record<string, unknown> }> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query || {}))
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    let attempt = 0;
    for (;;) {
      try {
        return await this.once<T>(method, url, options.body, options.idempotencyKey);
      } catch (error) {
        const err = error instanceof BotApiError ? error : new BotApiError(String(error), 0, "network_error");
        attempt += 1;
        if (!err.transient || attempt > this.maxRetries) throw err;
        const backoff = err.retryAfterMs ?? Math.min(30_000, 500 * 2 ** (attempt - 1));
        await this.sleep(backoff);
      }
    }
  }

  private async once<T>(method: string, url: URL, body: unknown, idempotencyKey?: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: "application/json",
          "user-agent": "Staffora-Integration/1.0",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = (error as Error)?.name === "AbortError";
      throw new BotApiError(
        aborted ? "Bot API javob bermadi (vaqt tugadi)." : `Bot API bilan aloqa yo‘q: ${redact(String((error as Error)?.message || error), this.apiKey)}`,
        0,
        aborted ? "timeout" : "network_error",
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let json: { success?: boolean; data?: T; meta?: Record<string, unknown>; error?: { code?: string; message?: string; details?: unknown } } | undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (response.ok && json && json.success !== false) return { data: json.data as T, meta: json.meta };
    const retryHeader = response.headers.get("retry-after");
    const retryAfterMs = retryHeader ? Math.min(120_000, Math.max(0, Number(retryHeader) * 1000 || 0)) : undefined;
    const message =
      json?.error?.message ||
      (response.status === 401
        ? "API kalit noto‘g‘ri yoki bekor qilingan."
        : response.status === 403
          ? "API kalitda bu amal uchun ruxsat yo‘q."
          : response.status === 429
            ? "Bot API so‘rovlar limiti oshdi."
            : response.status >= 500
              ? `Bot API vaqtincha ishlamayapti (HTTP ${response.status}).`
              : `Bot API xatosi (HTTP ${response.status}).`);
    throw new BotApiError(
      redact(message, this.apiKey),
      response.status,
      json?.error?.code || `http_${response.status}`,
      json?.error?.details,
      response.status === 429 ? (retryAfterMs ?? 5_000) : retryAfterMs,
    );
  }

  get<T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined>) {
    return this.request<T>("GET", path, { query });
  }

  /** Sahifalab hammasini oladi (limit ≤ 200). */
  async all<T = unknown>(path: string, query: Record<string, string | number | undefined> = {}, onPage?: (page: number, pages: number) => void) {
    const items: T[] = [];
    let page = 1;
    let pages = 1;
    let total = 0;
    do {
      const result = await this.get<T[]>(path, { ...query, page, limit: 200 });
      items.push(...(result.data || []));
      pages = Number(result.meta?.pages || 1);
      total = Number(result.meta?.total ?? items.length);
      onPage?.(page, pages);
      page += 1;
    } while (page <= pages && page <= 500);
    return { items, total, pages } satisfies BotPage<T>;
  }
}
