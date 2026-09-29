import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { AuditLog, Database } from "./types";
import { createSeed } from "./seed";

const localDataDirectory = path.join(process.cwd(), "data");
const volumeDirectory =
  process.env.RAILWAY_VOLUME_MOUNT_PATH || localDataDirectory;
export const sqlitePath =
  process.env.SQLITE_PATH || path.join(volumeDirectory, "staffora.sqlite");
const legacyJsonPath = path.join(localDataDirectory, "dev-db.json");

let connection: BetterSqlite3.Database | undefined;
let initialization: Promise<BetterSqlite3.Database> | undefined;
let queue: Promise<void> = Promise.resolve();

function normalizeDatabase(database: Database): Database {
  database.telegramInvites ||= [];
  database.attendanceSessions ||= [];
  database.qrNonces ||= [];
  database.faceProfiles ||= [];
  return database;
}

async function initialDatabase(): Promise<Database> {
  if (existsSync(legacyJsonPath)) {
    try {
      return normalizeDatabase(
        JSON.parse(await readFile(legacyJsonPath, "utf8")) as Database,
      );
    } catch (error) {
      console.warn(
        "Eski JSON bazani o‘qib bo‘lmadi, yangi seed yaratiladi.",
        error,
      );
    }
  }
  return createSeed();
}

async function openDatabase() {
  if (connection) return connection;
  if (!initialization) {
    initialization = (async () => {
      await mkdir(path.dirname(sqlitePath), { recursive: true });
      const database = new BetterSqlite3(sqlitePath);
      database.pragma("journal_mode = WAL");
      database.pragma("synchronous = NORMAL");
      database.pragma("foreign_keys = ON");
      database.pragma("busy_timeout = 5000");
      database.exec(`
        CREATE TABLE IF NOT EXISTS app_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      const existing = database
        .prepare("SELECT id FROM app_state WHERE id = 1")
        .get();
      if (!existing) {
        const seed = await initialDatabase();
        database
          .prepare(
            "INSERT INTO app_state (id, payload, updated_at) VALUES (1, ?, ?)",
          )
          .run(JSON.stringify(seed), new Date().toISOString());
      }
      connection = database;
      console.log(`SQLite ma’lumotlar bazasi: ${sqlitePath}`);
      return database;
    })();
  }
  return initialization;
}

export async function readDb(): Promise<Database> {
  const database = await openDatabase();
  const row = database
    .prepare("SELECT payload FROM app_state WHERE id = 1")
    .get() as { payload: string } | undefined;
  if (!row) throw new Error("SQLite app_state yozuvi topilmadi.");
  return normalizeDatabase(JSON.parse(row.payload) as Database);
}

export async function updateDb<T>(
  operation: (database: Database) => T | Promise<T>,
): Promise<T> {
  let resolveResult!: (value: T) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  queue = queue.then(async () => {
    try {
      const database = await readDb();
      const value = await operation(database);
      const sqlite = await openDatabase();
      sqlite
        .prepare(
          "UPDATE app_state SET payload = ?, updated_at = ? WHERE id = 1",
        )
        .run(JSON.stringify(database), new Date().toISOString());
      resolveResult(value);
    } catch (error) {
      rejectResult(error);
    }
  });
  await queue;
  return result;
}

export async function checkDatabaseHealth() {
  const database = await openDatabase();
  const result = database.pragma("quick_check", { simple: true });
  return result === "ok";
}

export function audit(
  companyId: string,
  actor: string,
  action: string,
  entity: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
): AuditLog {
  return {
    id: crypto.randomUUID(),
    companyId,
    actor,
    action,
    entity,
    entityId,
    before,
    after,
    createdAt: new Date().toISOString(),
  };
}
