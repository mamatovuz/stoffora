import { documentFiles } from "../../lib/store";
import { redact } from "./secrets";

/*
 * Integratsiyaning ko‘p yoziladigan jadvallari (asosiy JSON holatdan tashqarida):
 *   integration_logs         — jurnal (kim, nima, qachon; maxfiy ma’lumotsiz)
 *   integration_events       — webhook / changes hodisalari (takrorlanmaslik, dead-letter)
 *   integration_outbox       — botga yuboriladigan amallar navbati (retry + backoff)
 *   notification_deliveries  — bot orqali yuborilgan xabarlar holati
 * Jadvallar lib/backend.ts’da yaratiladi — SQLite yoki PostgreSQL (DATABASE_URL).
 */

type Runner = {
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  run(sql: string, ...params: unknown[]): Promise<number>;
};
export async function sql(): Promise<Runner> {
  const db = await documentFiles();
  return {
    all: <T,>(q: string, ...params: unknown[]) => db.all<T>(q, params),
    get: async <T,>(q: string, ...params: unknown[]) => (await db.all<T>(q, params))[0],
    run: (q: string, ...params: unknown[]) => db.run(q, params),
  };
}

/** Testlar modulni qayta yuklaganda eski ulanishni unutish uchun. */
export function resetSqlForTests() {}

const now = () => new Date().toISOString();

/* ----------------------------------------------------------- jurnal --- */
export type LogLevel = "info" | "warn" | "error";
export interface IntegrationLogRow {
  id: number;
  level: LogLevel;
  action: string;
  message: string;
  details?: unknown;
  createdAt: string;
}

const MAX_LOGS_PER_INTEGRATION = 5000;
let logWrites = 0;

export async function logIntegration(
  integration: { id: string; companyId: string },
  level: LogLevel,
  action: string,
  message: string,
  details?: unknown,
) {
  const db = await sql();
  const text = details === undefined ? null : redact(JSON.stringify(details)).slice(0, 4000);
  (await db.run("INSERT INTO integration_logs (integration_id, company_id, level, action, message, details, created_at) VALUES (?,?,?,?,?,?,?)", integration.id, integration.companyId, level, action, redact(message).slice(0, 1000), text, now()));
  if (++logWrites % 200 === 0)
    (await db.run(`DELETE FROM integration_logs WHERE integration_id = ? AND id <= (
         SELECT id FROM integration_logs WHERE integration_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`, integration.id, integration.id, MAX_LOGS_PER_INTEGRATION));
}

export async function listLogs(integrationId: string, companyId: string, options: { level?: string; limit?: number; before?: number } = {}) {
  const db = await sql();
  const limit = Math.min(500, Math.max(1, options.limit || 100));
  const rows = (await db.all(`SELECT id, level, action, message, details, created_at FROM integration_logs
        WHERE integration_id = ? AND company_id = ? ${options.level ? "AND level = ?" : ""} ${options.before ? "AND id < ?" : ""}
        ORDER BY id DESC LIMIT ?`, ...([integrationId, companyId, options.level, options.before, limit].filter((v) => v !== undefined) as (string | number)[]))) as { id: number; level: LogLevel; action: string; message: string; details: string | null; created_at: string }[];
  return rows.map<IntegrationLogRow>((row) => ({
    id: Number(row.id),
    level: row.level,
    action: row.action,
    message: row.message,
    details: row.details ? safeJson(row.details) : undefined,
    createdAt: row.created_at,
  }));
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/* ---------------------------------------------------------- hodisalar --- */
export type EventStatus = "received" | "processed" | "ignored" | "failed" | "dead";

/** Hodisani qayd etadi. Oldin kelgan bo‘lsa — false (takror). */
export async function recordEvent(integrationId: string, eventId: string, eventType: string, via: "webhook" | "poll", payload: string) {
  const db = await sql();
  const result = (await db.run("INSERT OR IGNORE INTO integration_events (integration_id, event_id, event_type, via, status, payload, received_at) VALUES (?,?,?,?, 'received', ?, ?)", integrationId, eventId, eventType, via, payload.slice(0, 200_000), now()));
  return result > 0;
}

export async function eventStatus(integrationId: string, eventId: string) {
  const db = await sql();
  return (await db.get("SELECT status, attempts FROM integration_events WHERE integration_id = ? AND event_id = ?", integrationId, eventId)) as { status: EventStatus; attempts: number } | undefined;
}

const EVENT_MAX_ATTEMPTS = 6;
export async function finishEvent(integrationId: string, eventId: string, status: "processed" | "ignored" | "failed", error?: string) {
  const db = await sql();
  const row = (await db.get("SELECT attempts FROM integration_events WHERE integration_id = ? AND event_id = ?", integrationId, eventId)) as { attempts: number } | undefined;
  const attempts = (row?.attempts || 0) + 1;
  const dead = status === "failed" && attempts >= EVENT_MAX_ATTEMPTS;
  const next = status === "failed" && !dead ? new Date(Date.now() + Math.min(3600_000, 30_000 * 2 ** (attempts - 1))).toISOString() : null;
  (await db.run("UPDATE integration_events SET status = ?, attempts = ?, error = ?, processed_at = ?, next_attempt_at = ? WHERE integration_id = ? AND event_id = ?", dead ? "dead" : status, attempts, error ? redact(error).slice(0, 1000) : null, now(), next, integrationId, eventId));
}

export async function dueFailedEvents(limit = 50) {
  const db = await sql();
  return (await db.all("SELECT integration_id, event_id, payload FROM integration_events WHERE status = 'failed' AND next_attempt_at <= ? ORDER BY received_at LIMIT ?", now(), limit)) as { integration_id: string; event_id: string; payload: string }[];
}

export async function retryDeadEvent(integrationId: string, eventId: string) {
  const db = await sql();
  return (
    (await db.run("UPDATE integration_events SET status = 'failed', attempts = 0, next_attempt_at = ? WHERE integration_id = ? AND event_id = ? AND status IN ('dead','failed')", now(), integrationId, eventId)) > 0
  );
}

export async function listEvents(integrationId: string, options: { status?: string; limit?: number } = {}) {
  const db = await sql();
  const limit = Math.min(300, Math.max(1, options.limit || 100));
  return (
    (await db.all(`SELECT event_id, event_type, via, status, attempts, error, received_at, processed_at FROM integration_events
          WHERE integration_id = ? ${options.status ? "AND status = ?" : ""} ORDER BY received_at DESC LIMIT ?`, ...([integrationId, options.status, limit].filter((v) => v !== undefined) as (string | number)[]))) as {
      event_id: string;
      event_type: string;
      via: string;
      status: EventStatus;
      attempts: number;
      error: string | null;
      received_at: string;
      processed_at: string | null;
    }[]
  ).map((row) => ({
    eventId: row.event_id,
    event: row.event_type,
    via: row.via,
    status: row.status,
    attempts: row.attempts,
    error: row.error || undefined,
    receivedAt: row.received_at,
    processedAt: row.processed_at || undefined,
  }));
}

/* ------------------------------------------------------------ navbat --- */
export type OutboxKind =
  | "attendance.check_in"
  | "attendance.check_out"
  | "employee.create"
  | "employee.update"
  | "branch.create"
  | "branch.update"
  | "department.create"
  | "department.update"
  | "position.create"
  | "position.update"
  | "notification.send"
  | "external_id.link";

export interface OutboxJob {
  id: number;
  integrationId: string;
  companyId: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  attempts: number;
}

/** Navbatga qo‘yadi; shu kalit bilan oldin qo‘yilgan bo‘lsa — takrorlanmaydi. */
export async function enqueueOutbox(
  integration: { id: string; companyId: string },
  kind: OutboxKind,
  payload: Record<string, unknown>,
  idempotencyKey: string,
) {
  const db = await sql();
  const stamp = now();
  const result = (await db.run(`INSERT OR IGNORE INTO integration_outbox (integration_id, company_id, kind, payload, idempotency_key, status, next_attempt_at, created_at, updated_at)
       VALUES (?,?,?,?,?, 'pending', ?, ?, ?)`, integration.id, integration.companyId, kind, JSON.stringify(payload), idempotencyKey, stamp, stamp, stamp));
  return result > 0;
}

export async function dueOutbox(limit = 25) {
  const db = await sql();
  const rows = (await db.all(`SELECT id, integration_id, company_id, kind, payload, idempotency_key, attempts FROM integration_outbox
        WHERE status IN ('pending','failed') AND next_attempt_at <= ? ORDER BY id LIMIT ?`, now(), limit)) as { id: number; integration_id: string; company_id: string; kind: OutboxKind; payload: string; idempotency_key: string; attempts: number }[];
  return rows.map<OutboxJob>((row) => ({
    id: Number(row.id),
    integrationId: row.integration_id,
    companyId: row.company_id,
    kind: row.kind,
    payload: JSON.parse(row.payload),
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
  }));
}

const OUTBOX_MAX_ATTEMPTS = 8;
export async function completeOutbox(id: number, result?: unknown) {
  const db = await sql();
  (await db.run("UPDATE integration_outbox SET status = 'done', attempts = attempts + 1, last_error = NULL, result = ?, updated_at = ? WHERE id = ?", result === undefined ? null : JSON.stringify(result).slice(0, 4000),
    now(),
    id));
}

/** Xato: vaqtinchalik bo‘lsa backoff bilan qayta, doimiy bo‘lsa yoki urinishlar tugasa — dead. */
export async function failOutbox(job: OutboxJob, error: string, options: { permanent?: boolean; retryAfterMs?: number } = {}) {
  const db = await sql();
  const attempts = job.attempts + 1;
  const dead = options.permanent || attempts >= OUTBOX_MAX_ATTEMPTS;
  const delay = options.retryAfterMs ?? Math.min(6 * 3600_000, 15_000 * 2 ** (attempts - 1));
  (await db.run("UPDATE integration_outbox SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?", dead ? "dead" : "failed",
    attempts,
    redact(error).slice(0, 1000),
    new Date(Date.now() + delay).toISOString(),
    now(),
    job.id));
  return dead;
}

/** Limit (429) bo‘lsa — urinish sanalmaydi, faqat kechiktiriladi. */
export async function postponeOutbox(id: number, ms: number) {
  const db = await sql();
  (await db.run("UPDATE integration_outbox SET next_attempt_at = ?, updated_at = ? WHERE id = ?", new Date(Date.now() + ms).toISOString(), now(), id));
}

export async function outboxStats(integrationId: string) {
  const db = await sql();
  const rows = (await db.all("SELECT status, COUNT(*) AS n FROM integration_outbox WHERE integration_id = ? GROUP BY status", integrationId)) as { status: string; n: number }[];
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.n)])) as Record<string, number>;
}

export async function listOutbox(integrationId: string, status?: string, limit = 100) {
  const db = await sql();
  return (
    (await db.all(`SELECT id, kind, status, attempts, last_error, created_at, updated_at, next_attempt_at FROM integration_outbox
          WHERE integration_id = ? ${status ? "AND status = ?" : ""} ORDER BY id DESC LIMIT ?`, ...([integrationId, status, Math.min(300, limit)].filter((v) => v !== undefined) as (string | number)[]))) as {
      id: number;
      kind: string;
      status: string;
      attempts: number;
      last_error: string | null;
      created_at: string;
      updated_at: string;
      next_attempt_at: string;
    }[]
  ).map((row) => ({
    id: Number(row.id),
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    error: row.last_error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextAttemptAt: row.next_attempt_at,
  }));
}

export async function retryOutbox(integrationId: string, id: number) {
  const db = await sql();
  return (
    (await db.run("UPDATE integration_outbox SET status = 'pending', attempts = 0, next_attempt_at = ?, updated_at = ? WHERE id = ? AND integration_id = ? AND status IN ('dead','failed')", now(), now(), id, integrationId)) > 0
  );
}

/* ------------------------------------------------------ yetkazishlar --- */
export type DeliveryStatus = "QUEUED" | "SENT" | "FAILED" | "SKIPPED";
export interface DeliveryRow {
  id: string;
  companyId: string;
  integrationId?: string;
  kind: "ACCESS" | "ANNOUNCEMENT" | "NOTIFY";
  refId: string;
  employeeId: string;
  channel: string;
  status: DeliveryStatus;
  externalId?: string;
  error?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export async function upsertDelivery(row: Omit<DeliveryRow, "createdAt" | "updatedAt" | "attempts"> & { attempts?: number }) {
  const db = await sql();
  const stamp = now();
  (await db.run(`INSERT INTO notification_deliveries (id, company_id, integration_id, kind, ref_id, employee_id, channel, status, external_id, error, attempts, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, external_id = COALESCE(excluded.external_id, external_id),
       error = excluded.error, attempts = attempts + 1, updated_at = excluded.updated_at`, row.id,
    row.companyId,
    row.integrationId || null,
    row.kind,
    row.refId,
    row.employeeId,
    row.channel,
    row.status,
    row.externalId || null,
    row.error ? redact(row.error).slice(0, 500) : null,
    row.attempts ?? 1,
    stamp,
    stamp));
}

export async function setDeliveryStatus(id: string, status: DeliveryStatus, error?: string) {
  const db = await sql();
  (await db.run("UPDATE notification_deliveries SET status = ?, error = ?, updated_at = ? WHERE id = ?", status, error ? redact(error).slice(0, 500) : null, now(), id));
}

function mapDelivery(row: Record<string, unknown>): DeliveryRow {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    integrationId: (row.integration_id as string) || undefined,
    kind: row.kind as DeliveryRow["kind"],
    refId: String(row.ref_id),
    employeeId: String(row.employee_id),
    channel: String(row.channel),
    status: row.status as DeliveryStatus,
    externalId: (row.external_id as string) || undefined,
    error: (row.error as string) || undefined,
    attempts: Number(row.attempts),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function deliveriesByRef(companyId: string, kind: DeliveryRow["kind"], refId: string) {
  const db = await sql();
  return ((await db.all("SELECT * FROM notification_deliveries WHERE company_id = ? AND kind = ? AND ref_id = ? ORDER BY created_at", companyId, kind, refId)) as Record<string, unknown>[]).map(mapDelivery);
}

export async function latestAccessDeliveries(companyId: string) {
  const db = await sql();
  const rows = (await db.all(`SELECT d.* FROM notification_deliveries d
        JOIN (SELECT employee_id, MAX(created_at) AS m FROM notification_deliveries WHERE company_id = ? AND kind = 'ACCESS' GROUP BY employee_id) x
          ON x.employee_id = d.employee_id AND x.m = d.created_at
        WHERE d.company_id = ? AND d.kind = 'ACCESS'`, companyId, companyId)) as Record<string, unknown>[];
  return new Map(rows.map((row) => [String(row.employee_id), mapDelivery(row)]));
}

/** Bot navbatiga qo‘yilgan (QUEUED) xabarlar — holatini botdan tekshirish uchun. */
export async function queuedBotDeliveries(limit = 50) {
  const db = await sql();
  return (
    (await db.all("SELECT * FROM notification_deliveries WHERE channel = 'bot' AND status = 'QUEUED' AND external_id IS NOT NULL ORDER BY updated_at LIMIT ?", limit)) as Record<string, unknown>[]
  ).map(mapDelivery);
}

export async function touchDelivery(id: string) {
  const db = await sql();
  (await db.run("UPDATE notification_deliveries SET updated_at = ? WHERE id = ?", now(), id));
}
