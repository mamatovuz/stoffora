import { mkdir } from "node:fs/promises";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { AuditLog, Database } from "./types";
import { createSeed, purgeLegacyDemoData } from "./seed";

const localDataDirectory = path.join(process.cwd(), "data");
const volumeDirectory =
  process.env.RAILWAY_VOLUME_MOUNT_PATH || localDataDirectory;
export const sqlitePath =
  process.env.SQLITE_PATH || path.join(volumeDirectory, "staffora.sqlite");

let connection: BetterSqlite3.Database | undefined;
let initialization: Promise<BetterSqlite3.Database> | undefined;
let queue: Promise<void> = Promise.resolve();

function normalizeDatabase(database: Database): Database {
  database.telegramInvites ||= [];
  database.attendanceSessions ||= [];
  database.qrNonces ||= [];
  database.faceProfiles ||= [];
  database.panelSessions ||= [];
  return database;
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
        .prepare("SELECT payload FROM app_state WHERE id = 1")
        .get() as { payload: string } | undefined;
      if (!existing) {
        const seed = await createSeed();
        database
          .prepare(
            "INSERT INTO app_state (id, payload, updated_at) VALUES (1, ?, ?)",
          )
          .run(JSON.stringify(seed), new Date().toISOString());
      } else {
        const current = normalizeDatabase(
          JSON.parse(existing.payload) as Database,
        );
        const removed = purgeLegacyDemoData(current);
        let bootstrapped = false;
        if (!current.users.some((user) => user.role !== "SUPER_ADMIN")) {
          const seed = await createSeed();
          if (seed.users.length) {
            // Egasiz qolgan mavjud kompaniya bo‘lsa, yangi egani o‘shanga biriktiramiz.
            const orphan = current.companies[0];
            if (orphan && seed.companies[0]) {
              for (const user of seed.users)
                if (user.companyId === seed.companies[0].id)
                  user.companyId = orphan.id;
              orphan.name = seed.companies[0].name;
              orphan.ownerName = seed.companies[0].ownerName;
            } else current.companies.push(...seed.companies);
            current.users.push(
              ...seed.users.filter(
                (user) =>
                  !current.users.some(
                    (existingUser) => existingUser.email === user.email,
                  ),
              ),
            );
            bootstrapped = true;
          }
        }
        if (removed > 0 || bootstrapped) {
          database
            .prepare(
              "UPDATE app_state SET payload = ?, updated_at = ? WHERE id = 1",
            )
            .run(JSON.stringify(current), new Date().toISOString());
          console.log(`Eski demo ma’lumotlar olib tashlandi: ${removed} ta yozuv.`);
        }
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
