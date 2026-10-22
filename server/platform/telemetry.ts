import { createHash } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";
import { opsStore } from "../../lib/store";
import { apiModule, miniModule } from "../../lib/modules";
import { maskSecrets } from "../../lib/platform/security";
import type { EmployeeSession } from "../auth";
import type { PlatformRequest } from "./context";

/*
 * Telemetriya — faqat haqiqiy, o‘lchangan qiymatlar (soxta CPU/RAM yo‘q):
 *   • har bir API so‘rovi: davomiylik, status → daqiqalik va soatlik agregat (platform_metrics);
 *   • kompaniya bo‘yicha agregat foydalanish: so‘rovlar, xatolar, modul bo‘yicha (platform_usage) — shaxsiy harakatlar emas;
 *   • kunlik faol panel foydalanuvchilari (DAU/MAU uchun ID, harakatlari emas);
 *   • 500 xatolar va Mini App xatolari → xatolar markazi (platform_errors), maxfiy qiymatlar yashiriladi.
 * Xotirada yig‘iladi va har daqiqada bitta partiya bilan yoziladi — har so‘rovda bazaga yozilmaydi.
 */

type Minute = { at: string; requests: number; errors: number; clientErrors: number; durations: number[] };
type MinuteSummary = { at: string; requests: number; errors: number; clientErrors: number; p95: number; avg: number };

const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

let minute: Minute = newMinute();
const history: MinuteSummary[] = [];
const usage = new Map<string, number>(); // day|company|metric → qiymat
const active = new Set<string>(); // day|company|user
const pendingErrors = new Map<string, ErrorEvent>();
let hourAgg = { bucket: hourBucket(), requests: 0, errors: 0, clientErrors: 0, durationSum: 0, p95: 0 };

function newMinute(): Minute {
  return { at: new Date().toISOString().slice(0, 16), requests: 0, errors: 0, clientErrors: 0, durations: [] };
}
function hourBucket(date = new Date()) {
  return `${date.toISOString().slice(0, 13)}:00`;
}
const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function rollMinute() {
  const at = new Date().toISOString().slice(0, 16);
  if (minute.at === at) return;
  const avg = minute.durations.length ? minute.durations.reduce((s, v) => s + v, 0) / minute.durations.length : 0;
  history.push({ at: minute.at, requests: minute.requests, errors: minute.errors, clientErrors: minute.clientErrors, p95: Math.round(percentile(minute.durations, 95)), avg: Math.round(avg) });
  if (history.length > 180) history.splice(0, history.length - 180);
  minute = newMinute();
}

const bump = (key: string, by = 1) => usage.set(key, (usage.get(key) || 0) + by);

/** API so‘rovlarini o‘lchaydi (requireAuth dan oldin ulanadi — sessiya javob tugaganda o‘qiladi). */
export function telemetryMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      try {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        rollMinute();
        minute.requests += 1;
        if (minute.durations.length < 5000) minute.durations.push(ms);
        const server = res.statusCode >= 500;
        if (server) minute.errors += 1;
        else if (res.statusCode >= 400) minute.clientErrors += 1;
        const r = req as PlatformRequest & { employeeSession?: EmployeeSession };
        const companyId = r.session?.companyId || r.employeeSession?.companyId;
        if (!companyId) return;
        const day = today();
        bump(`${day}|${companyId}|api_requests`);
        if (server) bump(`${day}|${companyId}|api_errors`);
        const path = (req.originalUrl || req.url).split("?")[0].replace(/^\/api/, "");
        const mod = apiModule(path) || miniModule(path);
        if (mod) bump(`${day}|${companyId}|module:${mod}`);
        if (r.session && r.session.role !== "SUPER_ADMIN" && !r.session.preview) active.add(`${day}|${companyId}|${r.session.userId}`);
        if (r.employeeSession) bump(`${day}|${companyId}|employee_requests`);
      } catch {
        /* telemetriya hech qachon so‘rovni buzmaydi */
      }
    });
    next();
  };
}

/* ------------------------------------------------------------ xatolar --- */
type ErrorEvent = { fingerprint: string; service: string; companyId?: string; severity: string; message: string; stack?: string; path?: string; count: number; at: string };

function normalize(message: string) {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\d+/g, "<n>")
    .slice(0, 300);
}

/** Xatoni markazga yozadi (guruhlab). Maxfiy ma’lumotlar yashiriladi. */
export function captureError(input: { service: string; error?: unknown; message?: string; stack?: string; path?: string; companyId?: string; severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" }) {
  try {
    const err = input.error instanceof Error ? input.error : undefined;
    const message = maskSecrets(input.message || err?.message || String(input.error ?? "Noma’lum xato"), 1000);
    const stack = maskSecrets(input.stack || err?.stack || "", 6000);
    const frame = (stack.split("\n").find((line) => line.trim().startsWith("at ")) || "").trim().replace(/:\d+:\d+\)?$/, "");
    const fingerprint = createHash("sha1").update(`${input.service}|${normalize(message)}|${frame}`).digest("hex").slice(0, 20);
    const existing = pendingErrors.get(fingerprint);
    const at = new Date().toISOString();
    if (existing) {
      existing.count += 1;
      existing.at = at;
    } else
      pendingErrors.set(fingerprint, {
        fingerprint,
        service: input.service,
        companyId: input.companyId,
        severity: input.severity || "HIGH",
        message,
        stack: stack || undefined,
        path: input.path?.split("?")[0].slice(0, 200),
        count: 1,
        at,
      });
    if (pendingErrors.size > 500) void flushTelemetry();
  } catch {
    /* ignore */
  }
}

/* ---------------------------------------------------------- yozish --- */
let flushing: Promise<void> | null = null;
/** Yig‘ilgan ko‘rsatkichlarni bazaga yozadi (har daqiqada va to‘xtashda). */
export function flushTelemetry() {
  if (flushing) return flushing;
  flushing = (async () => {
    rollMinute();
    const store = await opsStore();
    const counters = [...usage.entries()];
    usage.clear();
    const users = [...active];
    active.clear();
    const errors = [...pendingErrors.values()];
    pendingErrors.clear();
    for (const [key, value] of counters) {
      const [day, company, metric] = key.split("|");
      await store.run(
        "INSERT INTO platform_usage (day, company_id, metric, value) VALUES (?,?,?,?) ON CONFLICT (day, company_id, metric) DO UPDATE SET value = platform_usage.value + excluded.value",
        [day, company, metric, value],
      );
    }
    for (const key of users) {
      const [day, company, user] = key.split("|");
      await store.run("INSERT OR IGNORE INTO platform_active_users (day, company_id, user_id) VALUES (?,?,?)", [day, company, user]);
    }
    for (const e of errors)
      await store.run(
        `INSERT INTO platform_errors (fingerprint, service, company_id, severity, message, stack, path, status, first_seen, last_seen, count)
         VALUES (?,?,?,?,?,?,?, 'NEW', ?, ?, ?)
         ON CONFLICT (fingerprint) DO UPDATE SET last_seen = excluded.last_seen, count = platform_errors.count + excluded.count,
           status = CASE WHEN platform_errors.status = 'RESOLVED' THEN 'NEW' ELSE platform_errors.status END,
           company_id = COALESCE(platform_errors.company_id, excluded.company_id), path = excluded.path`,
        [e.fingerprint, e.service, e.companyId || null, e.severity, e.message, e.stack || null, e.path || null, e.at, e.at, e.count],
      );
    // Soatlik agregat (tugagan daqiqalardan).
    const bucket = hourBucket();
    if (hourAgg.bucket !== bucket) hourAgg = { bucket, requests: 0, errors: 0, clientErrors: 0, durationSum: 0, p95: 0 };
    const fresh = history.filter((m) => m.at.slice(0, 13) === bucket.slice(0, 13) && !flushedMinutes.has(m.at));
    for (const m of fresh) {
      flushedMinutes.add(m.at);
      hourAgg.requests += m.requests;
      hourAgg.errors += m.errors;
      hourAgg.clientErrors += m.clientErrors;
      hourAgg.durationSum += m.avg * m.requests;
      hourAgg.p95 = Math.max(hourAgg.p95, m.p95);
    }
    if (flushedMinutes.size > 400) for (const key of [...flushedMinutes].slice(0, 200)) flushedMinutes.delete(key);
    const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const lag = Math.round(loop.percentile(99) / 1e6);
    await store.run(
      `INSERT INTO platform_metrics (bucket, requests, errors, client_errors, p95_ms, avg_ms, rss_mb, lag_ms) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT (bucket) DO UPDATE SET requests = excluded.requests, errors = excluded.errors, client_errors = excluded.client_errors,
         p95_ms = excluded.p95_ms, avg_ms = excluded.avg_ms, rss_mb = excluded.rss_mb, lag_ms = excluded.lag_ms`,
      [bucket, hourAgg.requests, hourAgg.errors, hourAgg.clientErrors, hourAgg.p95, hourAgg.requests ? Math.round(hourAgg.durationSum / hourAgg.requests) : 0, rss, lag],
    );
    loop.reset();
  })()
    .catch((error) => console.error("Telemetriyani yozishda xato", error))
    .finally(() => {
      flushing = null;
    });
  return flushing;
}
const flushedMinutes = new Set<string>();

/** Monitoring uchun: oxirgi N daqiqa (xotiradan). */
export function recentMinutes(count = 60): MinuteSummary[] {
  rollMinute();
  const current: MinuteSummary = {
    at: minute.at,
    requests: minute.requests,
    errors: minute.errors,
    clientErrors: minute.clientErrors,
    p95: Math.round(percentile(minute.durations, 95)),
    avg: minute.durations.length ? Math.round(minute.durations.reduce((s, v) => s + v, 0) / minute.durations.length) : 0,
  };
  return [...history.slice(-(count - 1)), current];
}

/** Jarayon resurslari (haqiqiy qiymatlar: shu Node jarayoni). */
export function processStats() {
  const memory = process.memoryUsage();
  return {
    rssMb: Math.round(memory.rss / 1024 / 1024),
    heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
    eventLoopLagMs: Math.round(loop.percentile(99) / 1e6),
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
  };
}
