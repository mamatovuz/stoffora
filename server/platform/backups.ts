import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { createGunzip, createGzip } from "node:zlib";
import { createInterface } from "node:readline";
import BetterSqlite3 from "better-sqlite3";
import { flushDb, opsStore, readDb, updateDb } from "../../lib/store";
import { SqliteBackend } from "../../lib/backend";
import type { BackupRecord } from "../../lib/platform/types";

/*
 * Zaxira nusxalar (Backup Control Center).
 *   SQLite   — onlayn backup API (ishlayotgan bazani to‘xtatmasdan, izchil nusxa) → .sqlite fayl;
 *   Postgres — mantiqiy eksport: jadvallar qatorlari siqilgan JSONL (.jsonl.gz) ga yoziladi.
 *              (Supabase’da qo‘shimcha ravishda boshqariladigan PITR zaxiralari bor — dashboard orqali.)
 * Fayllar serverning yopiq papkasida (RAILWAY_VOLUME_MOUNT_PATH/backups) — statik xizmat orqali ochilmaydi,
 * yuklab olish faqat Platform Owner + qayta autentifikatsiya + audit bilan.
 * Tiklash (restore) avtomatik bajarilmaydi — «Restore test» faqat faylni tekshiradi (yaxlitlik, qatorlar soni, checksum).
 */

export const backupDir = () => path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), "data"), "backups");
const ensureDir = () => {
  const dir = backupDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};

async function sha256File(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

const CORE_TABLES = ["app_state", "meta", "core_rows", "attendance", "audit_logs", "photo_queue"];
const OPTIONAL_TABLES = { media: ["media"], files: ["document_files"] } as const;

async function countTables(tables: string[]) {
  const store = await opsStore();
  const out: Record<string, number> = {};
  for (const table of tables) out[table] = Number((await store.all<{ n: number | string }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n || 0);
  return out;
}

/** Zaxira yaratadi (fon ishi ichida chaqiriladi). */
export async function runBackup(input: { kind: BackupRecord["kind"]; createdBy: string; includeMedia?: boolean; includeFiles?: boolean }) {
  const db = await readDb();
  const settings = db.platformSettings?.backups || {};
  const includes = { media: input.includeMedia ?? settings.includeMedia ?? true, files: input.includeFiles ?? settings.includeFiles ?? false };
  const store = await opsStore();
  const record: BackupRecord = {
    id: randomUUID(),
    kind: input.kind,
    status: "RUNNING",
    format: store.kind === "sqlite" ? "sqlite" : "jsonl.gz",
    startedAt: new Date().toISOString(),
    includes,
    createdBy: input.createdBy,
  };
  await updateDb((next) => {
    next.backupRecords.unshift(record);
  });
  const stamp = record.startedAt.replace(/[:.]/g, "-");
  const file = `staffora-${stamp}.${record.format === "sqlite" ? "sqlite" : "jsonl.gz"}`;
  const target = path.join(ensureDir(), file);
  try {
    await flushDb();
    const tables = [...CORE_TABLES, ...(includes.media ? OPTIONAL_TABLES.media : []), ...(includes.files ? OPTIONAL_TABLES.files : [])];
    const counts = await countTables(tables);
    if (store instanceof SqliteBackend) {
      await store.backupTo(target);
      // SQLite nusxasi to‘liq bazani o‘z ichiga oladi; tanlanmagan katta jadvallar nusxadan tozalanadi.
      if (!includes.media || !includes.files) {
        const copy = new BetterSqlite3(target);
        try {
          if (!includes.media) copy.exec("DELETE FROM media");
          if (!includes.files) copy.exec("DELETE FROM document_files");
          copy.exec("VACUUM");
        } finally {
          copy.close();
        }
      }
    } else {
      const gzip = createGzip({ level: 6 });
      const out = createWriteStream(target);
      gzip.pipe(out);
      const write = async (line: string) => {
        if (!gzip.write(`${line}\n`)) await once(gzip, "drain");
      };
      await write(JSON.stringify({ type: "header", version: 1, createdAt: record.startedAt, tables: counts }));
      for (const table of tables) {
        const batch = 1000;
        for (let offset = 0; ; offset += batch) {
          const rows = await store.all<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY 1 LIMIT ? OFFSET ?`, [batch, offset]);
          for (const row of rows) {
            const clean: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(row)) clean[key] = Buffer.isBuffer(value) ? { $b64: value.toString("base64") } : value;
            await write(JSON.stringify({ t: table, r: clean }));
          }
          if (rows.length < batch) break;
        }
      }
      gzip.end();
      await once(out, "finish");
    }
    const sizeBytes = statSync(target).size;
    const checksum = await sha256File(target);
    await updateDb((next) => {
      const row = next.backupRecords.find((b) => b.id === record.id);
      if (row) Object.assign(row, { status: "SUCCESS", finishedAt: new Date().toISOString(), sizeBytes, checksum, file, tables: counts });
    });
    await rotateBackups();
    return { id: record.id, file, sizeBytes };
  } catch (error) {
    try {
      if (existsSync(target)) unlinkSync(target);
    } catch {
      /* ignore */
    }
    await updateDb((next) => {
      const row = next.backupRecords.find((b) => b.id === record.id);
      if (row) Object.assign(row, { status: "FAILED", finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message.slice(0, 500) : String(error) });
    });
    throw error;
  }
}

/** Faylni tekshiradi: checksum, o‘qiladi, qatorlar soni yozilganiga mos. Production bazasiga tegmaydi. */
export async function verifyBackup(id: string) {
  const db = await readDb();
  const record = db.backupRecords.find((b) => b.id === id);
  if (!record || record.status !== "SUCCESS" || !record.file) throw Object.assign(new Error("Tekshiriladigan zaxira topilmadi."), { status: 404 });
  const file = path.join(backupDir(), record.file);
  let error: string | undefined;
  try {
    if (!existsSync(file)) throw new Error("Zaxira fayli diskda topilmadi.");
    const checksum = await sha256File(file);
    if (record.checksum && checksum !== record.checksum) throw new Error("Checksum mos emas — fayl o‘zgargan yoki buzilgan.");
    const counts: Record<string, number> = {};
    if (record.format === "sqlite") {
      const copy = new BetterSqlite3(file, { readonly: true, fileMustExist: true });
      try {
        const integrity = copy.pragma("integrity_check", { simple: true });
        if (integrity !== "ok") throw new Error(`integrity_check: ${integrity}`);
        for (const table of Object.keys(record.tables || {}))
          counts[table] = Number((copy.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
      } finally {
        copy.close();
      }
    } else {
      const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
      let header = false;
      for await (const line of lines) {
        if (!line) continue;
        const item = JSON.parse(line) as { type?: string; t?: string };
        if (item.type === "header") header = true;
        else if (item.t) counts[item.t] = (counts[item.t] || 0) + 1;
      }
      if (!header) throw new Error("Fayl sarlavhasi yo‘q.");
    }
    for (const [table, expected] of Object.entries(record.tables || {})) {
      const got = counts[table] ?? 0;
      // SQLite nusxasidan tanlanmagan jadvallar ataylab tozalanadi.
      const skipped = (table === "media" && !record.includes.media) || (table === "document_files" && !record.includes.files);
      if (!skipped && got !== expected) throw new Error(`${table}: ${got} qator (kutilgan ${expected}).`);
    }
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
  }
  await updateDb((next) => {
    const row = next.backupRecords.find((b) => b.id === id);
    if (row) Object.assign(row, { verifyStatus: error ? "FAILED" : "PASSED", verifiedAt: new Date().toISOString(), verifyError: error });
  });
  return { ok: !error, error };
}

/** Eng yangi N ta muvaffaqiyatli zaxira qoladi, eskilarining fayllari o‘chiriladi (yozuv tarixda qoladi). */
export async function rotateBackups() {
  const db = await readDb();
  const keep = Math.max(1, Math.min(30, db.platformSettings?.backups?.keep || 5));
  const old = db.backupRecords.filter((b) => b.status === "SUCCESS" && !b.deletedAt).slice(keep);
  if (!old.length) return 0;
  for (const record of old)
    try {
      if (record.file && existsSync(path.join(backupDir(), record.file))) unlinkSync(path.join(backupDir(), record.file));
    } catch {
      /* ignore */
    }
  await updateDb((next) => {
    for (const record of old) {
      const row = next.backupRecords.find((b) => b.id === record.id);
      if (row) row.deletedAt = new Date().toISOString();
    }
  });
  return old.length;
}

export function backupFilePath(record: BackupRecord) {
  if (!record.file || record.deletedAt) return null;
  const file = path.join(backupDir(), path.basename(record.file));
  return existsSync(file) ? file : null;
}

/** Zaxira joyi haqida ma’lumot (Supabase/Postgres yoki SQLite). */
export async function backupEnvironment() {
  const store = await opsStore();
  const url = process.env.DATABASE_URL || "";
  return {
    database: store.kind,
    managed: /supabase\.(co|com)/i.test(url) ? "Supabase (boshqariladigan zaxiralar: Supabase dashboard → Database → Backups)" : null,
    destination: backupDir(),
    volume: Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH),
  };
}
