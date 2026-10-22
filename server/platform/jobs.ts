import { randomUUID } from "node:crypto";
import { opsStore } from "../../lib/store";
import { maskSecrets } from "../../lib/platform/security";

/*
 * Fon ishlari — qo‘shimcha infratuzilmasiz (Redis/queue xizmati shart emas):
 *   • navbat — platform_jobs jadvali (eksport, zaxira, ommaviy ishlar); qayta urinish va kechikish bilan;
 *   • davriy vazifalar — jarayon ichidagi taymerlar (monitoring, yetkazish, tozalash), har birining holati kuzatiladi.
 * Server bitta yozuvchi nusxada ishlaydi (Postgres advisory lock), shuning uchun ish ikki marta olinmaydi.
 */

export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type JobRow = {
  id: string;
  type: string;
  status: JobStatus;
  payload: unknown;
  result: unknown;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: string | null;
  companyId: string | null;
};
type RawJob = {
  id: string;
  type: string;
  status: JobStatus;
  payload: string;
  result: string | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  run_at: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_by: string | null;
  company_id: string | null;
};
const parse = (value: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
const toJob = (r: RawJob): JobRow => ({
  id: r.id,
  type: r.type,
  status: r.status,
  payload: parse(r.payload),
  result: parse(r.result),
  error: r.error,
  attempts: Number(r.attempts),
  maxAttempts: Number(r.max_attempts),
  runAt: r.run_at,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  createdBy: r.created_by,
  companyId: r.company_id,
});

export type JobContext = { id: string; attempt: number; createdBy: string | null; companyId: string | null };
type Handler = (payload: unknown, ctx: JobContext) => Promise<unknown>;
const handlers = new Map<string, { run: Handler; timeoutMs: number }>();

export function registerJobHandler(type: string, run: Handler, timeoutMs = 10 * 60_000) {
  handlers.set(type, { run, timeoutMs });
}

export async function enqueueJob(input: { type: string; payload?: unknown; runAt?: string; maxAttempts?: number; createdBy?: string; companyId?: string; dedupeKey?: string }) {
  const store = await opsStore();
  const id = randomUUID();
  const now = new Date().toISOString();
  const inserted = await store.run(
    "INSERT OR IGNORE INTO platform_jobs (id, type, status, payload, attempts, max_attempts, run_at, created_at, created_by, company_id, dedupe_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [id, input.type, "QUEUED", JSON.stringify(input.payload ?? {}), 0, input.maxAttempts ?? 3, input.runAt || now, now, input.createdBy || null, input.companyId || null, input.dedupeKey || null],
  );
  if (!inserted && input.dedupeKey) {
    const existing = await store.all<RawJob>("SELECT * FROM platform_jobs WHERE dedupe_key = ?", [input.dedupeKey]);
    return existing[0] ? toJob(existing[0]) : null;
  }
  void kickQueue();
  return getJob(id);
}

export async function getJob(id: string) {
  const store = await opsStore();
  const rows = await store.all<RawJob>("SELECT * FROM platform_jobs WHERE id = ?", [id]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function listJobs(filters: { status?: string; type?: string; createdBy?: string }, limit = 50, offset = 0) {
  const store = await opsStore();
  const parts: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    parts.push("status = ?");
    params.push(filters.status);
  }
  if (filters.type) {
    parts.push("type = ?");
    params.push(filters.type);
  }
  if (filters.createdBy) {
    parts.push("created_by = ?");
    params.push(filters.createdBy);
  }
  const where = parts.length ? `WHERE ${parts.join(" AND ")}` : "";
  const rows = await store.all<RawJob>(`SELECT * FROM platform_jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const total = Number((await store.all<{ n: number | string }>(`SELECT COUNT(*) AS n FROM platform_jobs ${where}`, params))[0]?.n || 0);
  const counts = await store.all<{ status: string; n: number | string }>("SELECT status, COUNT(*) AS n FROM platform_jobs GROUP BY status");
  return { rows: rows.map(toJob), total, counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])) };
}

export async function retryJob(id: string) {
  const store = await opsStore();
  return store.run("UPDATE platform_jobs SET status = 'QUEUED', run_at = ?, error = NULL, attempts = 0, finished_at = NULL WHERE id = ? AND status IN ('FAILED','CANCELLED')", [new Date().toISOString(), id]);
}
export async function cancelJob(id: string) {
  const store = await opsStore();
  return store.run("UPDATE platform_jobs SET status = 'CANCELLED', finished_at = ? WHERE id = ? AND status = 'QUEUED'", [new Date().toISOString(), id]);
}

let running = false;
let queueTimer: NodeJS.Timeout | undefined;
const backoff = (attempt: number) => Math.min(30 * 60_000, 30_000 * 2 ** (attempt - 1));

async function runOne(job: RawJob) {
  const store = await opsStore();
  const now = new Date().toISOString();
  const claimed = await store.run("UPDATE platform_jobs SET status = 'RUNNING', started_at = ?, attempts = attempts + 1 WHERE id = ? AND status = 'QUEUED'", [now, job.id]);
  if (!claimed) return;
  const handler = handlers.get(job.type);
  const attempt = Number(job.attempts) + 1;
  try {
    if (!handler) throw new Error(`Noma’lum ish turi: ${job.type}`);
    const result = await Promise.race([
      handler.run(parse(job.payload), { id: job.id, attempt, createdBy: job.created_by, companyId: job.company_id }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Ish vaqt chegarasidan oshdi.")), handler.timeoutMs).unref()),
    ]);
    await store.run("UPDATE platform_jobs SET status = 'SUCCEEDED', result = ?, error = NULL, finished_at = ? WHERE id = ?", [JSON.stringify(result ?? null), new Date().toISOString(), job.id]);
  } catch (error) {
    const message = maskSecrets(error instanceof Error ? error.message : String(error), 1000);
    const final = attempt >= Number(job.max_attempts);
    await store.run(
      final
        ? "UPDATE platform_jobs SET status = 'FAILED', error = ?, finished_at = ? WHERE id = ?"
        : "UPDATE platform_jobs SET status = 'QUEUED', error = ?, run_at = ? WHERE id = ?",
      [message, final ? new Date().toISOString() : new Date(Date.now() + backoff(attempt)).toISOString(), job.id],
    );
  }
}

/** Navbatdagi muddati kelgan ishlarni bajaradi (bir vaqtda bittadan — RAM/CPU tejash uchun). */
export async function kickQueue() {
  if (running) return;
  running = true;
  try {
    const store = await opsStore();
    for (let round = 0; round < 20; round += 1) {
      const due = await store.all<RawJob>("SELECT * FROM platform_jobs WHERE status = 'QUEUED' AND run_at <= ? ORDER BY run_at LIMIT 1", [new Date().toISOString()]);
      if (!due.length) break;
      await runOne(due[0]);
    }
  } catch (error) {
    console.error("Fon ishlari navbatida xato", error);
  } finally {
    running = false;
  }
}

/* ------------------------------------------------------- davriy vazifalar --- */
export type WorkerState = { name: string; label: string; intervalMs: number; runs: number; failures: number; lastRunAt?: string; lastOkAt?: string; lastError?: string; lastDurationMs?: number; running: boolean };
const workers = new Map<string, WorkerState & { timer?: NodeJS.Timeout; fn: () => Promise<unknown> }>();

export function registerRecurring(name: string, label: string, intervalMs: number, fn: () => Promise<unknown>, initialDelayMs = 5_000) {
  const state = { name, label, intervalMs, runs: 0, failures: 0, running: false, fn } as WorkerState & { timer?: NodeJS.Timeout; fn: () => Promise<unknown> };
  workers.set(name, state);
  const tick = async () => {
    if (state.running) return;
    state.running = true;
    const started = Date.now();
    state.lastRunAt = new Date().toISOString();
    try {
      await fn();
      state.lastOkAt = new Date().toISOString();
      state.lastError = undefined;
    } catch (error) {
      state.failures += 1;
      state.lastError = maskSecrets(error instanceof Error ? error.message : String(error), 500);
    } finally {
      state.runs += 1;
      state.lastDurationMs = Date.now() - started;
      state.running = false;
    }
  };
  setTimeout(() => {
    void tick();
    state.timer = setInterval(() => void tick(), intervalMs);
    state.timer.unref();
  }, initialDelayMs).unref();
}

export function workerStates(): WorkerState[] {
  return [...workers.values()].map(({ timer: _t, fn: _f, ...rest }) => rest);
}

/** Server to‘xtab qolgan paytda «RUNNING» qolgan ishlar qayta navbatga qo‘yiladi. */
export async function recoverStuckJobs() {
  const store = await opsStore();
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  return store.run("UPDATE platform_jobs SET status = 'QUEUED', run_at = ? WHERE status = 'RUNNING' AND (started_at IS NULL OR started_at < ?)", [new Date().toISOString(), cutoff]);
}

export function startJobQueue() {
  void recoverStuckJobs().catch(() => undefined);
  queueTimer ||= setInterval(() => void kickQueue(), 3_000);
  queueTimer.unref();
}

export async function purgeJobs(beforeIso: string) {
  const store = await opsStore();
  return store.run("DELETE FROM platform_jobs WHERE status IN ('SUCCEEDED','FAILED','CANCELLED') AND created_at < ?", [beforeIso]);
}
