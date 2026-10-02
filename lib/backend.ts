import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import pg, { type Pool, type PoolClient } from "pg";
import type { Attendance, AuditLog, PhotoJob } from "./types";

/*
 * Saqlash qatlami (backend). Holat xotirada (lib/store.ts), bu yerda faqat diskka/bazaga yozish:
 *   app_state, meta, attendance, audit_logs, media, photo_queue, document_files
 *
 * SQLite — standart (lokal va eski serverlar).
 * PostgreSQL — DATABASE_URL berilganda. Birinchi ishga tushishda eski SQLite fayli bo‘lsa, undagi
 * BARCHA ma’lumot bitta tranzaksiyada Postgres’ga ko‘chiriladi va har bir jadval soni tekshiriladi.
 * SQLite fayli o‘chirilmaydi — zaxira nusxa bo‘lib qoladi.
 */

export type Delta = {
  now: string;
  core?: string;
  attendanceUpserts: Attendance[];
  attendanceDeletes: string[];
  auditInserts: AuditLog[];
  mediaUpserts: [string, string][];
  mediaDeletes: string[];
  queueUpserts: PhotoJob[];
  queueDeletes: string[];
};
export type Snapshot = {
  core: string | null;
  schema: number;
  attendance: string[];
  audit: string[];
  media: [string, string][];
  queue: string[];
};
export type StoredFile = { mime: string; data: Buffer };

export interface Backend {
  kind: "sqlite" | "postgres";
  label: string;
  init(): Promise<void>;
  load(auditLimit: number): Promise<Snapshot>;
  insertInitial(core: string, schema: number): Promise<void>;
  write(delta: Delta): Promise<void>;
  readAttendance(id: string): Promise<string | null>;
  readQueue(id: string): Promise<string | null>;
  queryAudit(companyId: string, entityId: string | undefined, limit: number): Promise<string[]>;
  rewriteAudit(companyId: string, entityIds: string[], transform: (payload: string) => string): Promise<number>;
  health(): Promise<boolean>;
  putFile(id: string, companyId: string, mime: string, data: Buffer, createdAt: string): Promise<void>;
  getFile(id: string): Promise<StoredFile | undefined>;
  deleteFile(id: string): Promise<void>;
  fileIds(): Promise<string[]>;
  /** Umumiy SQL (SQLite sintaksisida yoziladi; PostgreSQL uchun avtomatik moslanadi). */
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<number>;
  close(): Promise<void>;
}

/* Integratsiya jadvallari (server/integrations/sqlstore.ts) — ikkala bazada ham. */
export const OPS_TABLES = ["integration_logs", "integration_events", "integration_outbox", "notification_deliveries"] as const;
const OPS_DDL = `
  CREATE TABLE IF NOT EXISTS integration_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, integration_id TEXT NOT NULL, company_id TEXT NOT NULL, level TEXT NOT NULL,
    action TEXT NOT NULL, message TEXT NOT NULL, details TEXT, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS integration_logs_by_integration ON integration_logs(integration_id, id DESC);
  CREATE TABLE IF NOT EXISTS integration_events (
    integration_id TEXT NOT NULL, event_id TEXT NOT NULL, event_type TEXT NOT NULL, via TEXT NOT NULL, status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, error TEXT, payload TEXT NOT NULL, received_at TEXT NOT NULL, processed_at TEXT,
    next_attempt_at TEXT, PRIMARY KEY (integration_id, event_id));
  CREATE INDEX IF NOT EXISTS integration_events_status ON integration_events(status, next_attempt_at);
  CREATE TABLE IF NOT EXISTS integration_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT, integration_id TEXT NOT NULL, company_id TEXT NOT NULL, kind TEXT NOT NULL,
    payload TEXT NOT NULL, idempotency_key TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL, last_error TEXT, result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE (integration_id, idempotency_key));
  CREATE INDEX IF NOT EXISTS integration_outbox_due ON integration_outbox(status, next_attempt_at);
  CREATE TABLE IF NOT EXISTS notification_deliveries (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, integration_id TEXT, kind TEXT NOT NULL, ref_id TEXT NOT NULL,
    employee_id TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, external_id TEXT, error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS deliveries_by_ref ON notification_deliveries(company_id, kind, ref_id);
  CREATE INDEX IF NOT EXISTS deliveries_by_employee ON notification_deliveries(company_id, employee_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS deliveries_pending ON notification_deliveries(status, channel);
`;
const PG_OPS_DDL = OPS_DDL.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, "BIGSERIAL PRIMARY KEY");
/** SQLite so‘rovini PostgreSQL’ga: ? → $n, INSERT OR IGNORE → ON CONFLICT DO NOTHING. */
export function toPg(sql: string) {
  let n = 0;
  let out = sql.replace(/\?/g, () => `$${++n}`);
  if (/INSERT\s+OR\s+IGNORE/i.test(out)) out = `${out.replace(/INSERT\s+OR\s+IGNORE/i, "INSERT")} ON CONFLICT DO NOTHING`;
  return out;
}

/* ================================================================ SQLite === */
const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS attendance (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, employee_id TEXT NOT NULL, date TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS attendance_company_date ON attendance(company_id, date);
  CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS audit_company_created ON audit_logs(company_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS audit_company_entity ON audit_logs(company_id, entity_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS media (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS photo_queue (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS document_files (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL);
`;

export function openSqlite(file: string, readonly = false) {
  if (!readonly) mkdirSync(path.dirname(file), { recursive: true });
  const db = new BetterSqlite3(file, readonly ? { readonly: true, fileMustExist: true } : {});
  if (!readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("busy_timeout = 5000");
    db.pragma("temp_store = MEMORY");
    db.exec(SQLITE_SCHEMA);
    db.exec(OPS_DDL);
  }
  return db;
}

export class SqliteBackend implements Backend {
  kind = "sqlite" as const;
  label: string;
  db!: BetterSqlite3.Database;
  constructor(private file: string) {
    this.label = `SQLite ${file}`;
  }
  async init() {
    this.db ||= openSqlite(this.file);
  }
  async load(auditLimit: number): Promise<Snapshot> {
    const db = this.db;
    const core = (db.prepare("SELECT payload FROM app_state WHERE id = 1").get() as { payload: string } | undefined)?.payload ?? null;
    const schema = Number((db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string } | undefined)?.value || 1);
    return {
      core,
      schema,
      attendance: (db.prepare("SELECT payload FROM attendance").all() as { payload: string }[]).map((r) => r.payload),
      audit: (db.prepare("SELECT payload FROM audit_logs ORDER BY created_at DESC LIMIT ?").all(auditLimit) as { payload: string }[]).map((r) => r.payload),
      media: (db.prepare("SELECT key, data FROM media").all() as { key: string; data: string }[]).map((r) => [r.key, r.data]),
      queue: (db.prepare("SELECT payload FROM photo_queue ORDER BY created_at").all() as { payload: string }[]).map((r) => r.payload),
    };
  }
  async insertInitial(core: string, schema: number) {
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO app_state (id, payload, updated_at) VALUES (1, ?, ?)").run(core, new Date().toISOString());
      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)").run(String(schema));
    })();
  }
  async write(d: Delta) {
    const db = this.db;
    db.transaction(() => {
      if (d.core !== undefined) db.prepare("UPDATE app_state SET payload = ?, updated_at = ? WHERE id = 1").run(d.core, d.now);
      if (d.attendanceUpserts.length) {
        const stmt = db.prepare("INSERT OR REPLACE INTO attendance (id, company_id, employee_id, date, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)");
        for (const a of d.attendanceUpserts) stmt.run(a.id, a.companyId, a.employeeId, a.date, a.updatedAt, JSON.stringify(a));
      }
      if (d.attendanceDeletes.length) {
        const stmt = db.prepare("DELETE FROM attendance WHERE id = ?");
        for (const id of d.attendanceDeletes) stmt.run(id);
      }
      if (d.auditInserts.length) {
        const stmt = db.prepare("INSERT OR IGNORE INTO audit_logs (id, company_id, entity_id, created_at, payload) VALUES (?, ?, ?, ?, ?)");
        for (const log of d.auditInserts) stmt.run(log.id, log.companyId, log.entityId || "", log.createdAt, JSON.stringify(log));
      }
      if (d.mediaUpserts.length) {
        const stmt = db.prepare("INSERT OR REPLACE INTO media (key, data, updated_at) VALUES (?, ?, ?)");
        for (const [key, data] of d.mediaUpserts) stmt.run(key, data, d.now);
      }
      if (d.mediaDeletes.length) {
        const stmt = db.prepare("DELETE FROM media WHERE key = ?");
        for (const key of d.mediaDeletes) stmt.run(key);
      }
      if (d.queueUpserts.length) {
        const stmt = db.prepare("INSERT OR REPLACE INTO photo_queue (id, company_id, created_at, payload) VALUES (?, ?, ?, ?)");
        for (const job of d.queueUpserts) stmt.run(job.id, job.companyId, job.createdAt, JSON.stringify(job));
      }
      if (d.queueDeletes.length) {
        const stmt = db.prepare("DELETE FROM photo_queue WHERE id = ?");
        for (const id of d.queueDeletes) stmt.run(id);
      }
    })();
  }
  async readAttendance(id: string) {
    return (this.db.prepare("SELECT payload FROM attendance WHERE id = ?").get(id) as { payload: string } | undefined)?.payload ?? null;
  }
  async readQueue(id: string) {
    return (this.db.prepare("SELECT payload FROM photo_queue WHERE id = ?").get(id) as { payload: string } | undefined)?.payload ?? null;
  }
  async queryAudit(companyId: string, entityId: string | undefined, limit: number) {
    const rows = (
      entityId
        ? this.db.prepare("SELECT payload FROM audit_logs WHERE company_id = ? AND entity_id = ? ORDER BY created_at DESC LIMIT ?").all(companyId, entityId, limit)
        : this.db.prepare("SELECT payload FROM audit_logs WHERE company_id = ? ORDER BY created_at DESC LIMIT ?").all(companyId, limit)
    ) as { payload: string }[];
    return rows.map((r) => r.payload);
  }
  async rewriteAudit(companyId: string, entityIds: string[], transform: (payload: string) => string) {
    const select = this.db.prepare("SELECT id, payload FROM audit_logs WHERE company_id = ? AND entity_id = ?");
    const update = this.db.prepare("UPDATE audit_logs SET payload = ? WHERE id = ?");
    let changed = 0;
    this.db.transaction(() => {
      for (const entityId of entityIds)
        for (const row of select.all(companyId, entityId) as { id: string; payload: string }[]) {
          const next = transform(row.payload);
          if (next !== row.payload) {
            update.run(next, row.id);
            changed += 1;
          }
        }
    })();
    return changed;
  }
  async health() {
    return this.db.pragma("quick_check", { simple: true }) === "ok";
  }
  async putFile(id: string, companyId: string, mime: string, data: Buffer, createdAt: string) {
    this.db.prepare("INSERT INTO document_files (id, company_id, mime, data, created_at) VALUES (?,?,?,?,?)").run(id, companyId, mime, data, createdAt);
  }
  async getFile(id: string) {
    return this.db.prepare("SELECT mime, data FROM document_files WHERE id = ?").get(id) as StoredFile | undefined;
  }
  async deleteFile(id: string) {
    this.db.prepare("DELETE FROM document_files WHERE id = ?").run(id);
  }
  async fileIds() {
    return (this.db.prepare("SELECT id FROM document_files").all() as { id: string }[]).map((r) => r.id);
  }
  async all<T>(sql: string, params: unknown[] = []) {
    return this.db.prepare(sql).all(...params) as T[];
  }
  async run(sql: string, params: unknown[] = []) {
    return this.db.prepare(sql).run(...params).changes;
  }
  async close() {
    this.db?.close();
  }
}

/* ============================================================ PostgreSQL === */
const PG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS attendance (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, employee_id TEXT NOT NULL, date TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS attendance_company_date ON attendance(company_id, date);
  CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS audit_company_created ON audit_logs(company_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS audit_company_entity ON audit_logs(company_id, entity_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS media (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS photo_queue (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS document_files (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, mime TEXT NOT NULL, data BYTEA NOT NULL, created_at TEXT NOT NULL);
`;
/** Bitta yozuvchi: ikki server nusxasi bir vaqtda yozmasin (deploy paytidagi qoplanish). */
const WRITER_LOCK = 7_310_042_001;
const CHUNK = 500;
const chunks = <T>(rows: T[]) => Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

export class PostgresBackend implements Backend {
  kind = "postgres" as const;
  label: string;
  private pool!: Pool;
  private lockClient?: PoolClient;
  /** Boshqa nusxa ishlayapti — biz yozuvchi qulfini kutyapmiz (deploy qoplanishi). */
  static waitingForLock = false;
  constructor(
    private url: string,
    private sqliteFallback: string | null,
  ) {
    this.label = `PostgreSQL ${url.replace(/\/\/[^@]*@/, "//***@")}`;
  }

  async init() {
    const ssl = /sslmode=require|ssl=true/i.test(this.url) ? { rejectUnauthorized: false } : undefined;
    this.pool = new pg.Pool({ connectionString: this.url, max: 8, ssl, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 });
    this.pool.on("error", (error) => console.error("PostgreSQL ulanish xatosi", error.message));
    await this.pool.query(PG_SCHEMA);
    await this.pool.query(PG_OPS_DDL);
    // Yozuvchi qulfi: boshqa nusxa ishlayotgan bo‘lsa (deploy qoplanishi) — u to‘xtaguncha kutamiz.
    this.lockClient = await this.pool.connect();
    this.lockClient.on("error", (error) => {
      // Qulf yo‘qoldi — ikki nusxa yozib qo‘ymasligi uchun jarayon to‘xtatiladi (Railway qayta ishga tushiradi).
      console.error("PostgreSQL yozuvchi qulfi uzildi — server qayta ishga tushiriladi.", error.message);
      process.exit(1);
    });
    const got = await this.lockClient.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [WRITER_LOCK]);
    if (!got.rows[0].ok) {
      console.log("Boshqa server nusxasi bazani band qilgan — u to‘xtashini kutyapmiz…");
      PostgresBackend.waitingForLock = true;
      try {
        await this.lockClient.query("SELECT pg_advisory_lock($1)", [WRITER_LOCK]);
      } finally {
        PostgresBackend.waitingForLock = false;
      }
    }
    await this.migrateFromSqlite();
  }

  /** Bir martalik ko‘chirish: Postgres bo‘sh va SQLite fayli bo‘lsa — hammasi, tekshiruv bilan. */
  private async migrateFromSqlite() {
    const existing = await this.pool.query("SELECT 1 FROM app_state WHERE id = 1");
    if (existing.rowCount) return;
    const file = this.sqliteFallback;
    if (!file || !existsSync(file)) {
      console.log("PostgreSQL bo‘sh va eski SQLite fayli yo‘q — yangi baza boshlanadi.");
      return;
    }
    const src = openSqlite(file, true);
    try {
      const core = src.prepare("SELECT payload, updated_at FROM app_state WHERE id = 1").get() as { payload: string; updated_at: string } | undefined;
      if (!core) {
        console.log("SQLite faylida ma’lumot yo‘q — ko‘chirish shart emas.");
        return;
      }
      const schema = (src.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string } | undefined)?.value || "1";
      if (Number(schema) < 2) throw new Error("SQLite bazasi eski formatda (schema 1). Avval DATABASE_URL’siz bir marta ishga tushiring.");
      const has = (table: string) => Boolean(src.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table));
      const all = <T>(sql: string) => src.prepare(sql).all() as T[];
      const attendance = all<{ id: string; company_id: string; employee_id: string; date: string; updated_at: string; payload: string }>("SELECT * FROM attendance");
      const audit = all<{ id: string; company_id: string; entity_id: string; created_at: string; payload: string }>("SELECT * FROM audit_logs");
      const media = all<{ key: string; data: string; updated_at: string }>("SELECT * FROM media");
      const queue = all<{ id: string; company_id: string; created_at: string; payload: string }>("SELECT * FROM photo_queue");
      const files = has("document_files") ? all<{ id: string; company_id: string; mime: string; data: Buffer; created_at: string }>("SELECT * FROM document_files") : [];
      const metaRows = all<{ key: string; value: string }>("SELECT * FROM meta");
      console.log(
        `SQLite → PostgreSQL ko‘chirish: ${attendance.length} davomat, ${audit.length} audit, ${media.length} rasm, ${queue.length} navbat, ${files.length} hujjat fayli…`,
      );
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("INSERT INTO app_state (id, payload, updated_at) VALUES (1, $1, $2)", [core.payload, core.updated_at]);
        for (const m of metaRows) await client.query("INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [m.key, m.value]);
        for (const part of chunks(attendance))
          await client.query(
            "INSERT INTO attendance (id, company_id, employee_id, date, updated_at, payload) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])",
            [part.map((r) => r.id), part.map((r) => r.company_id), part.map((r) => r.employee_id), part.map((r) => r.date), part.map((r) => r.updated_at), part.map((r) => r.payload)],
          );
        for (const part of chunks(audit))
          await client.query("INSERT INTO audit_logs (id, company_id, entity_id, created_at, payload) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])", [
            part.map((r) => r.id),
            part.map((r) => r.company_id),
            part.map((r) => r.entity_id),
            part.map((r) => r.created_at),
            part.map((r) => r.payload),
          ]);
        for (const part of chunks(media))
          await client.query("INSERT INTO media (key, data, updated_at) SELECT * FROM unnest($1::text[], $2::text[], $3::text[])", [part.map((r) => r.key), part.map((r) => r.data), part.map((r) => r.updated_at)]);
        for (const part of chunks(queue))
          await client.query("INSERT INTO photo_queue (id, company_id, created_at, payload) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])", [
            part.map((r) => r.id),
            part.map((r) => r.company_id),
            part.map((r) => r.created_at),
            part.map((r) => r.payload),
          ]);
        for (const f of files) await client.query("INSERT INTO document_files (id, company_id, mime, data, created_at) VALUES ($1, $2, $3, $4, $5)", [f.id, f.company_id, f.mime, f.data, f.created_at]);
        // Integratsiya jadvallari: ustunlar nomi bilan, aynan nusxa (id’lar ham).
        const opsCounts: [string, number][] = [];
        for (const table of OPS_TABLES) {
          if (!has(table)) continue;
          const rows = all<Record<string, unknown>>(`SELECT * FROM ${table}`);
          opsCounts.push([table, rows.length]);
          if (!rows.length) continue;
          const cols = Object.keys(rows[0]);
          for (const part of chunks(rows)) {
            const values: unknown[] = [];
            const tuples = part.map((row, r) => `(${cols.map((col, c) => (values.push(row[col]), `$${r * cols.length + c + 1}`)).join(", ")})`);
            await client.query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES ${tuples.join(", ")}`, values);
          }
          if (table === "integration_logs" || table === "integration_outbox")
            await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1))`);
        }
        // Tekshiruv: har bir jadval soni aynan bir xil bo‘lishi shart, aks holda hech narsa yozilmaydi.
        const count = async (table: string) => Number((await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
        const expected: [string, number][] = [
          ["attendance", attendance.length],
          ["audit_logs", audit.length],
          ["media", media.length],
          ["photo_queue", queue.length],
          ["document_files", files.length],
          ...opsCounts,
        ];
        for (const [table, n] of expected) {
          const got = await count(table);
          if (got !== n) throw new Error(`Ko‘chirish tekshiruvi o‘tmadi: ${table} — SQLite’da ${n}, PostgreSQL’da ${got}.`);
        }
        const coreBack = await client.query<{ payload: string }>("SELECT payload FROM app_state WHERE id = 1");
        if (coreBack.rows[0]?.payload !== core.payload) throw new Error("Ko‘chirish tekshiruvi o‘tmadi: asosiy holat (app_state) mos emas.");
        await client.query("INSERT INTO meta (key, value) VALUES ('migrated_from_sqlite', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [
          JSON.stringify({ at: new Date().toISOString(), file, counts: Object.fromEntries(expected) }),
        ]);
        await client.query("COMMIT");
        console.log("SQLite → PostgreSQL ko‘chirish muvaffaqiyatli, barcha sonlar mos. SQLite fayli zaxira sifatida qoldi.");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } finally {
      src.close();
    }
  }

  async load(auditLimit: number): Promise<Snapshot> {
    const q = <T extends object>(sql: string, params: unknown[] = []) => this.pool.query<T>(sql, params).then((r) => r.rows);
    const [core, meta, attendance, audit, media, queue] = await Promise.all([
      q<{ payload: string }>("SELECT payload FROM app_state WHERE id = 1"),
      q<{ value: string }>("SELECT value FROM meta WHERE key = 'schema'"),
      q<{ payload: string }>("SELECT payload FROM attendance"),
      q<{ payload: string }>("SELECT payload FROM audit_logs ORDER BY created_at DESC LIMIT $1", [auditLimit]),
      q<{ key: string; data: string }>("SELECT key, data FROM media"),
      q<{ payload: string }>("SELECT payload FROM photo_queue ORDER BY created_at"),
    ]);
    return {
      core: core[0]?.payload ?? null,
      schema: Number(meta[0]?.value || 2),
      attendance: attendance.map((r) => r.payload),
      audit: audit.map((r) => r.payload),
      media: media.map((r) => [r.key, r.data]),
      queue: queue.map((r) => r.payload),
    };
  }
  async insertInitial(core: string, schema: number) {
    await this.tx(async (c) => {
      await c.query("INSERT INTO app_state (id, payload, updated_at) VALUES (1, $1, $2)", [core, new Date().toISOString()]);
      await c.query("INSERT INTO meta (key, value) VALUES ('schema', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [String(schema)]);
    });
  }
  private async tx(run: (client: PoolClient) => Promise<void>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await run(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async write(d: Delta) {
    await this.tx(async (c) => {
      if (d.core !== undefined) await c.query("UPDATE app_state SET payload = $1, updated_at = $2 WHERE id = 1", [d.core, d.now]);
      for (const part of chunks(d.attendanceUpserts))
        await c.query(
          `INSERT INTO attendance (id, company_id, employee_id, date, updated_at, payload)
           SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
           ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, employee_id = EXCLUDED.employee_id, date = EXCLUDED.date, updated_at = EXCLUDED.updated_at, payload = EXCLUDED.payload`,
          [part.map((a) => a.id), part.map((a) => a.companyId), part.map((a) => a.employeeId), part.map((a) => a.date), part.map((a) => a.updatedAt), part.map((a) => JSON.stringify(a))],
        );
      if (d.attendanceDeletes.length) await c.query("DELETE FROM attendance WHERE id = ANY($1::text[])", [d.attendanceDeletes]);
      for (const part of chunks(d.auditInserts))
        await c.query(
          `INSERT INTO audit_logs (id, company_id, entity_id, created_at, payload)
           SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]) ON CONFLICT (id) DO NOTHING`,
          [part.map((l) => l.id), part.map((l) => l.companyId), part.map((l) => l.entityId || ""), part.map((l) => l.createdAt), part.map((l) => JSON.stringify(l))],
        );
      for (const part of chunks(d.mediaUpserts))
        await c.query(
          `INSERT INTO media (key, data, updated_at) SELECT k, v, $3 FROM unnest($1::text[], $2::text[]) AS t(k, v)
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
          [part.map((m) => m[0]), part.map((m) => m[1]), d.now],
        );
      if (d.mediaDeletes.length) await c.query("DELETE FROM media WHERE key = ANY($1::text[])", [d.mediaDeletes]);
      for (const part of chunks(d.queueUpserts))
        await c.query(
          `INSERT INTO photo_queue (id, company_id, created_at, payload) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
           ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, created_at = EXCLUDED.created_at, payload = EXCLUDED.payload`,
          [part.map((j) => j.id), part.map((j) => j.companyId), part.map((j) => j.createdAt), part.map((j) => JSON.stringify(j))],
        );
      if (d.queueDeletes.length) await c.query("DELETE FROM photo_queue WHERE id = ANY($1::text[])", [d.queueDeletes]);
    });
  }
  async readAttendance(id: string) {
    return (await this.pool.query<{ payload: string }>("SELECT payload FROM attendance WHERE id = $1", [id])).rows[0]?.payload ?? null;
  }
  async readQueue(id: string) {
    return (await this.pool.query<{ payload: string }>("SELECT payload FROM photo_queue WHERE id = $1", [id])).rows[0]?.payload ?? null;
  }
  async queryAudit(companyId: string, entityId: string | undefined, limit: number) {
    const rows = entityId
      ? await this.pool.query<{ payload: string }>("SELECT payload FROM audit_logs WHERE company_id = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT $3", [companyId, entityId, limit])
      : await this.pool.query<{ payload: string }>("SELECT payload FROM audit_logs WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2", [companyId, limit]);
    return rows.rows.map((r) => r.payload);
  }
  async rewriteAudit(companyId: string, entityIds: string[], transform: (payload: string) => string) {
    let changed = 0;
    await this.tx(async (c) => {
      const rows = await c.query<{ id: string; payload: string }>("SELECT id, payload FROM audit_logs WHERE company_id = $1 AND entity_id = ANY($2::text[])", [companyId, entityIds]);
      for (const row of rows.rows) {
        const next = transform(row.payload);
        if (next !== row.payload) {
          await c.query("UPDATE audit_logs SET payload = $1 WHERE id = $2", [next, row.id]);
          changed += 1;
        }
      }
    });
    return changed;
  }
  async health() {
    const r = await this.pool.query<{ ok: number }>("SELECT 1 AS ok");
    return r.rows[0]?.ok === 1;
  }
  async putFile(id: string, companyId: string, mime: string, data: Buffer, createdAt: string) {
    await this.pool.query("INSERT INTO document_files (id, company_id, mime, data, created_at) VALUES ($1, $2, $3, $4, $5)", [id, companyId, mime, data, createdAt]);
  }
  async getFile(id: string) {
    return (await this.pool.query<StoredFile>("SELECT mime, data FROM document_files WHERE id = $1", [id])).rows[0];
  }
  async deleteFile(id: string) {
    await this.pool.query("DELETE FROM document_files WHERE id = $1", [id]);
  }
  async fileIds() {
    return (await this.pool.query<{ id: string }>("SELECT id FROM document_files")).rows.map((r) => r.id);
  }
  async all<T>(sql: string, params: unknown[] = []) {
    return (await this.pool.query(toPg(sql), params)).rows as T[];
  }
  async run(sql: string, params: unknown[] = []) {
    return (await this.pool.query(toPg(sql), params)).rowCount ?? 0;
  }
  async close() {
    this.lockClient?.release();
    await this.pool?.end();
  }
}
