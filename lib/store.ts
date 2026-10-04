import path from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { PostgresBackend, SqliteBackend, type Backend, type Delta } from "./backend";
import type {
  Attendance,
  AuditLog,
  Database,
  LeaveRequest,
  PhotoJob,
} from "./types";
import { createSeed, createUser, purgeLegacyDemoData } from "./seed";

/*
 * Saqlash qatlami.
 *
 * Ma’lumotlar xotirada (bitta jarayon) ushlab turiladi va bazaga yoziladi —
 * DATABASE_URL bo‘lsa PostgreSQL, aks holda SQLite (lib/backend.ts):
 *   app_state   — kichik "yadro" (kompaniyalar, xodimlar, grafiklar…), bitta JSON
 *   attendance  — davomat qatorlari (faqat o‘zgargan qatorlar yoziladi)
 *   audit_logs  — audit jurnali (faqat yangi yozuvlar qo‘shiladi)
 *   media       — xodim/foydalanuvchi rasmlari (JSON’ni og‘irlashtirmaydi)
 *   photo_queue — kanalga yuborilishi kutilayotgan rasmlar
 *
 * O‘qish (readDb) — diskka murojaat qilmaydi. Yozishlar navbatga tushadi,
 * bir nechta amal birlashtirilib (batch) bitta tranzaksiyada saqlanadi.
 * Amal xato bersa, xotira oxirgi saqlangan holatga qaytariladi.
 */

const localDataDirectory = path.join(process.cwd(), "data");
const volumeDirectory = process.env.RAILWAY_VOLUME_MOUNT_PATH || localDataDirectory;
export const sqlitePath =
  process.env.SQLITE_PATH || path.join(volumeDirectory, "staffora.sqlite");

const SCHEMA_VERSION = 2;
const AUDIT_MEMORY_LIMIT = 2000;
const NOTIFICATIONS_PER_COMPANY = 500;
const PHOTO_QUEUE_LIMIT = 3000;
const CHANNEL_POSTS_LIMIT = 50_000;
const BATCH_SIZE = 100;

let backend: Backend | undefined;
let state: Database | undefined;
let loading: Promise<Database> | undefined;
let version = 0;

// Diskdagi holat (farqni aniqlash va xatoda orqaga qaytarish uchun)
let persistedCore = "";
const persistedAttendance = new Map<string, string>(); // id -> updatedAt
const persistedAudit = new Set<string>();
const persistedMedia = new Map<string, string>(); // key -> dataUrl
const persistedQueue = new Map<string, string>(); // id -> attempts|lastAttemptAt

function normalizeDatabase(database: Database): Database {
  database.companies ||= [];
  database.branches ||= [];
  database.departments ||= [];
  database.positions ||= [];
  database.schedules ||= [];
  database.employees ||= [];
  database.attendance ||= [];
  database.leaveRequests ||= [];
  database.auditLogs ||= [];
  database.announcements ||= [];
  database.notifications ||= [];
  database.users ||= [];
  database.telegramInvites ||= [];
  database.attendanceSessions ||= [];
  database.qrNonces ||= [];
  database.faceProfiles ||= [];
  database.panelSessions ||= [];
  database.photoQueue ||= [];
  database.channelPosts ||= [];
  database.integrations ||= [];
  database.entityMappings ||= [];
  database.syncJobs ||= [];
  database.integrationConflicts ||= [];
  database.registrations ||= [];
  database.payrollAdjustments ||= [];
  database.payrollPeriods ||= [];
  database.scheduleOverrides ||= [];
  database.shiftSwaps ||= [];
  database.advanceRequests ||= [];
  database.documents ||= [];
  database.sentGreetings ||= [];
  database.biometricDevices ||= [];
  database.lateNotices ||= [];
  database.clientLogs ||= [];
  database.tickets ||= [];
  database.certificateRequests ||= [];
  database.payoutCards ||= [];
  database.dayOffMoves ||= [];
  database.attendanceCorrections ||= [];
  database.rewardAwards ||= [];
  database.payrollWorkflows ||= [];
  database.holidays ||= [];
  database.branchTransfers ||= [];
  database.assets ||= [];
  database.delegations ||= [];
  database.shiftTemplates ||= [];
  database.mobileDevices ||= [];
  database.mobileSessions ||= [];
  database.mobileActivationCodes ||= [];
  database.deviceChangeRequests ||= [];
  database.mobilePushTokens ||= [];
  return database;
}

/** Saqlash qatlami: DATABASE_URL bo‘lsa — PostgreSQL (eski SQLite’dan bir martalik ko‘chirish bilan). */
function connect(): Backend {
  if (backend) return backend;
  const url = process.env.DATABASE_URL?.trim();
  backend = url && /^postgres(ql)?:\/\//.test(url) ? new PostgresBackend(url, sqlitePath) : new SqliteBackend(sqlitePath);
  return backend;
}

/* ------------------------------------------------------------ yuklash --- */

const queueStamp = (job: PhotoJob) => `${job.attempts}|${job.lastAttemptAt || ""}`;

/** Bazadan to‘liq holatni o‘qiydi (xotiradagi obyektlarga tegmaydi). */
async function loadFromDisk(): Promise<Database> {
  const snap = await connect().load(AUDIT_MEMORY_LIMIT);
  if (!snap.core) throw new Error("app_state yozuvi topilmadi.");
  const core = normalizeDatabase(JSON.parse(snap.core) as Database);
  persistedCore = snap.core;

  core.attendance = [];
  persistedAttendance.clear();
  for (const payload of snap.attendance) {
    const record = JSON.parse(payload) as Attendance;
    core.attendance.push(record);
    persistedAttendance.set(record.id, record.updatedAt);
  }

  core.auditLogs = snap.audit.map((payload) => JSON.parse(payload) as AuditLog);
  persistedAudit.clear();
  for (const log of core.auditLogs) persistedAudit.add(log.id);

  persistedMedia.clear();
  const photos = new Map<string, string>();
  for (const [key, data] of snap.media) {
    photos.set(key, data);
    persistedMedia.set(key, data);
  }
  for (const employee of core.employees) {
    const photo = photos.get(`employee:${employee.id}`);
    if (photo) employee.photoDataUrl = photo;
  }
  for (const user of core.users) {
    const photo = photos.get(`user:${user.id}`);
    if (photo) user.photoDataUrl = photo;
  }

  core.photoQueue = [];
  persistedQueue.clear();
  for (const payload of snap.queue) {
    const job = JSON.parse(payload) as PhotoJob;
    core.photoQueue.push(job);
    persistedQueue.set(job.id, queueStamp(job));
  }
  return core;
}

/** 1-sxemadan (hammasi bitta JSON’da) 2-sxemaga o‘tkazish. */
function migrateLegacy(db: BetterSqlite3.Database, legacy: Database) {
  const now = new Date().toISOString();
  const insertAttendance = db.prepare(
    "INSERT OR REPLACE INTO attendance (id, company_id, employee_id, date, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertAudit = db.prepare(
    "INSERT OR IGNORE INTO audit_logs (id, company_id, entity_id, created_at, payload) VALUES (?, ?, ?, ?, ?)",
  );
  const insertMedia = db.prepare("INSERT OR REPLACE INTO media (key, data, updated_at) VALUES (?, ?, ?)");
  const insertQueue = db.prepare(
    "INSERT OR REPLACE INTO photo_queue (id, company_id, created_at, payload) VALUES (?, ?, ?, ?)",
  );
  db.transaction(() => {
    for (const a of legacy.attendance)
      insertAttendance.run(a.id, a.companyId, a.employeeId, a.date, a.updatedAt, JSON.stringify(a));
    for (const log of legacy.auditLogs)
      insertAudit.run(log.id, log.companyId, log.entityId || "", log.createdAt, JSON.stringify(log));
    for (const e of legacy.employees)
      if (e.photoDataUrl) insertMedia.run(`employee:${e.id}`, e.photoDataUrl, now);
    for (const u of legacy.users)
      if (u.photoDataUrl) insertMedia.run(`user:${u.id}`, u.photoDataUrl, now);
    for (const job of legacy.photoQueue)
      insertQueue.run(job.id, job.companyId, job.createdAt, JSON.stringify(job));
    db.prepare("UPDATE app_state SET payload = ?, updated_at = ? WHERE id = 1").run(
      JSON.stringify(coreSnapshot(legacy)),
      now,
    );
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)").run(String(SCHEMA_VERSION));
  })();
  console.log(
    `Baza yangi formatga o‘tkazildi: ${legacy.attendance.length} davomat, ${legacy.auditLogs.length} audit yozuvi.`,
  );
}

async function initialize(): Promise<Database> {
  const store = connect();
  await store.init();
  const snap = await store.load(1);
  if (!snap.core) {
    const seed = normalizeDatabase(await createSeed());
    await store.insertInitial(JSON.stringify(coreSnapshot(seed)), SCHEMA_VERSION);
  } else if (snap.schema < SCHEMA_VERSION && store instanceof SqliteBackend) {
    const legacy = normalizeDatabase(JSON.parse(snap.core) as Database);
    migrateLegacy(store.db, legacy);
  }

  const loaded = await loadFromDisk();
  // Bir martalik tozalash va bootstrap (demo yozuvlar, egasi yo‘q kompaniya, super admin).
  if (await bootstrap(loaded)) await persist(loaded);
  state = loaded;
  console.log(`Ma’lumotlar bazasi: ${store.label}`);
  return loaded;
}

async function bootstrap(current: Database) {
  const removed = purgeLegacyDemoData(current);
  let changed = removed > 0;
  if (!current.users.some((user) => user.role !== "SUPER_ADMIN")) {
    const seed = await createSeed();
    if (seed.users.length) {
      const orphan = current.companies[0];
      if (orphan && seed.companies[0]) {
        for (const user of seed.users)
          if (user.companyId === seed.companies[0].id) user.companyId = orphan.id;
        orphan.name = seed.companies[0].name;
        orphan.ownerName = seed.companies[0].ownerName;
      } else current.companies.push(...seed.companies);
      current.users.push(
        ...seed.users.filter((user) => !current.users.some((existing) => existing.email === user.email)),
      );
      changed = true;
    }
  }
  const superEmail = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const superPassword = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
  if (
    superEmail &&
    superPassword &&
    superPassword.length >= 10 &&
    !current.users.some((user) => user.role === "SUPER_ADMIN") &&
    !current.users.some((user) => user.email === superEmail)
  ) {
    current.users.push(
      await createUser({
        name: "Staffora Super Admin",
        email: superEmail,
        password: superPassword,
        role: "SUPER_ADMIN",
      }),
    );
    console.log(`Super admin yaratildi: ${superEmail}`);
    changed = true;
  }
  if (removed > 0) console.log(`Eski demo ma’lumotlar olib tashlandi: ${removed} ta yozuv.`);
  return changed;
}

async function ensureLoaded() {
  if (state) return state;
  loading ||= initialize().catch((error) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

/* ----------------------------------------------------------- saqlash --- */

/** Yadro: katta/o‘sib boruvchi to‘plamlar va rasmlarsiz. */
function coreSnapshot(db: Database) {
  return {
    ...db,
    attendance: [],
    auditLogs: [],
    photoQueue: [],
    employees: db.employees.map((e) => (e.photoDataUrl ? { ...e, photoDataUrl: undefined } : e)),
    users: db.users.map((u) => (u.photoDataUrl ? { ...u, photoDataUrl: undefined } : u)),
  };
}

function trimCollections(db: Database) {
  if (db.auditLogs.length > AUDIT_MEMORY_LIMIT) db.auditLogs.length = AUDIT_MEMORY_LIMIT;
  if (db.notifications.length > NOTIFICATIONS_PER_COMPANY * 2) {
    // Kompaniya bildirishnomalari: oxirgi 500 tasi; xodimning shaxsiy xabarlari: oxirgi 50 tasi.
    const perCompany = new Map<string, number>();
    const perEmployee = new Map<string, number>();
    db.notifications = db.notifications.filter((item) => {
      const map = item.employeeId ? perEmployee : perCompany;
      const key = item.employeeId || item.companyId;
      const n = (map.get(key) || 0) + 1;
      map.set(key, n);
      return n <= (item.employeeId ? 50 : NOTIFICATIONS_PER_COMPANY);
    });
  }
  if (db.photoQueue.length > PHOTO_QUEUE_LIMIT)
    db.photoQueue = db.photoQueue.slice(db.photoQueue.length - PHOTO_QUEUE_LIMIT);
  if (db.syncJobs.length > 300) db.syncJobs = db.syncJobs.slice(0, 300);
  if (db.clientLogs.length > 500) db.clientLogs = db.clientLogs.slice(0, 500);
  // Mobil: muddati 30 kundan oshgan (yoki bekor qilingan) sessiya va kodlar tozalanadi.
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  if (db.mobileSessions.length > 200)
    db.mobileSessions = db.mobileSessions.filter((s) => s.expiresAt > cutoff && !(s.revokedAt && s.revokedAt < cutoff));
  if (db.mobileActivationCodes.length > 200)
    db.mobileActivationCodes = db.mobileActivationCodes.filter((c) => c.expiresAt > cutoff);
  if (db.lateNotices.length > 5000) db.lateNotices = db.lateNotices.slice(0, 5000);
  if (db.attendanceCorrections.length > 20000) db.attendanceCorrections = db.attendanceCorrections.slice(0, 20000);
  if (db.sentGreetings.length > 5000) db.sentGreetings = db.sentGreetings.slice(-3000);
  // Tugallanmagan anketalar 14 kundan keyin o‘chadi; ko‘rib chiqilganlar tarixda qoladi.
  if (db.registrations.length > 200) {
    const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
    db.registrations = db.registrations.filter((r) => r.status !== "DRAFT" || r.updatedAt > cutoff);
  }
  if (db.integrationConflicts.length > 1000)
    db.integrationConflicts = db.integrationConflicts.filter(
      (c, index) => c.status === "OPEN" || index < 500,
    );
  if (db.channelPosts.length > CHANNEL_POSTS_LIMIT)
    db.channelPosts = db.channelPosts.slice(db.channelPosts.length - CHANNEL_POSTS_LIMIT);
}

/** Xotiradagi holatni bazaga yozadi — faqat o‘zgargan qismlar, bitta tranzaksiyada. */
async function persist(db: Database) {
  trimCollections(db);
  const now = new Date().toISOString();
  const core = JSON.stringify(coreSnapshot(db));

  // Davomat: yangi yoki o‘zgargan (updatedAt) qatorlar va o‘chirilganlar
  const attendanceUpserts: Attendance[] = [];
  const currentAttendance = new Set<string>();
  for (const record of db.attendance) {
    currentAttendance.add(record.id);
    if (persistedAttendance.get(record.id) !== record.updatedAt) attendanceUpserts.push(record);
  }
  const attendanceDeletes: string[] = [];
  for (const id of persistedAttendance.keys()) if (!currentAttendance.has(id)) attendanceDeletes.push(id);

  const auditInserts = db.auditLogs.filter((log) => !persistedAudit.has(log.id));

  const mediaUpserts: [string, string][] = [];
  const currentMedia = new Set<string>();
  const checkMedia = (key: string, photo?: string) => {
    if (!photo) return;
    currentMedia.add(key);
    if (persistedMedia.get(key) !== photo) mediaUpserts.push([key, photo]);
  };
  for (const e of db.employees) checkMedia(`employee:${e.id}`, e.photoDataUrl);
  for (const u of db.users) checkMedia(`user:${u.id}`, u.photoDataUrl);
  const mediaDeletes = [...persistedMedia.keys()].filter((key) => !currentMedia.has(key));

  const queueUpserts = db.photoQueue.filter((job) => persistedQueue.get(job.id) !== queueStamp(job));
  const currentQueue = new Set(db.photoQueue.map((job) => job.id));
  const queueDeletes = [...persistedQueue.keys()].filter((id) => !currentQueue.has(id));

  const coreChanged = core !== persistedCore;
  if (
    !coreChanged &&
    !attendanceUpserts.length &&
    !attendanceDeletes.length &&
    !auditInserts.length &&
    !mediaUpserts.length &&
    !mediaDeletes.length &&
    !queueUpserts.length &&
    !queueDeletes.length
  )
    return;

  const delta: Delta = {
    now,
    core: coreChanged ? core : undefined,
    attendanceUpserts,
    attendanceDeletes,
    auditInserts,
    mediaUpserts,
    mediaDeletes,
    queueUpserts,
    queueDeletes,
  };
  await connect().write(delta);

  // Tranzaksiya muvaffaqiyatli — "diskdagi holat"ni yangilaymiz.
  persistedCore = core;
  for (const a of attendanceUpserts) persistedAttendance.set(a.id, a.updatedAt);
  for (const id of attendanceDeletes) persistedAttendance.delete(id);
  for (const log of auditInserts) persistedAudit.add(log.id);
  if (persistedAudit.size > AUDIT_MEMORY_LIMIT * 4) {
    persistedAudit.clear();
    for (const log of db.auditLogs) persistedAudit.add(log.id);
  }
  for (const [key, data] of mediaUpserts) persistedMedia.set(key, data);
  for (const key of mediaDeletes) persistedMedia.delete(key);
  for (const job of queueUpserts) persistedQueue.set(job.id, queueStamp(job));
  for (const id of queueDeletes) persistedQueue.delete(id);
}

/* --------------------------------------------------------- API qatlami --- */

/** Xotiradagi joriy holat. Qaytgan obyektlarni o‘zgartirmang — faqat updateDb ichida. */
export async function readDb(): Promise<Database> {
  return ensureLoaded();
}

/** Ma’lumot o‘zgarganda oshadi — hisoblangan indekslar keshini bekor qilish uchun. */
export function dataVersion() {
  return version;
}

type Job = {
  operation: (database: Database) => unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};
const pending: Job[] = [];
let draining: Promise<void> | undefined;

export function updateDb<T>(operation: (database: Database) => T | Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.push({ operation, resolve: resolve as (value: unknown) => void, reject });
    kick();
  });
}

function kick() {
  if (draining) return;
  draining = drain().finally(() => {
    draining = undefined;
    // Partiya tugayotgan paytda kelgan yozuvlar navbatda qolib ketmasin.
    if (pending.length) kick();
  });
}

async function drain() {
  let db: Database;
  try {
    db = await ensureLoaded();
  } catch (error) {
    for (const job of pending.splice(0)) job.reject(error);
    return;
  }
  while (pending.length) {
    const batch = pending.splice(0, BATCH_SIZE);
    let done: { job: Job; value: unknown }[] = [];
    for (const job of batch) {
      try {
        const value = await job.operation(db);
        done.push({ job, value });
        version += 1;
      } catch (error) {
        // Xato bergan amal xotirani qisman o‘zgartirgan bo‘lishi mumkin —
        // oxirgi saqlangan holatga qaytamiz va shu partiyadagi muvaffaqiyatli
        // amallarni qayta bajaramiz.
        db = await rollback();
        version += 1;
        const replayed: typeof done = [];
        for (const item of done) {
          try {
            item.value = await item.job.operation(db);
            replayed.push(item);
          } catch (replayError) {
            db = await rollback();
            item.job.reject(replayError);
          }
        }
        done = replayed;
        job.reject(error);
      }
    }
    try {
      await persist(db);
      for (const item of done) item.job.resolve(item.value);
    } catch (error) {
      console.error("Bazaga yozishda xato", error);
      db = await rollback();
      version += 1;
      for (const item of done) item.job.reject(error);
    }
  }
}

/**
 * Xotirani diskdagi oxirgi holatga qaytaradi. Arzon: yadro oxirgi saqlangan
 * JSON’dan tiklanadi, katta to‘plamlardan faqat o‘zgargan qatorlar qayta o‘qiladi.
 */
async function rollback(): Promise<Database> {
  if (!state) return (state = await loadFromDisk());
  const store = connect();
  const core = normalizeDatabase(JSON.parse(persistedCore) as Database);
  for (const employee of core.employees) {
    const photo = persistedMedia.get(`employee:${employee.id}`);
    if (photo) employee.photoDataUrl = photo;
  }
  for (const user of core.users) {
    const photo = persistedMedia.get(`user:${user.id}`);
    if (photo) user.photoDataUrl = photo;
  }

  const attendance: Attendance[] = [];
  const seen = new Set<string>();
  for (const record of state.attendance) {
    const saved = persistedAttendance.get(record.id);
    if (saved === undefined) continue; // saqlanmagan yangi qator
    seen.add(record.id);
    if (saved === record.updatedAt) attendance.push(record);
    else {
      const payload = await store.readAttendance(record.id);
      if (payload) attendance.push(JSON.parse(payload) as Attendance);
    }
  }
  // Xotiradan o‘chirilgan, lekin diskda bor qatorlar
  for (const id of persistedAttendance.keys())
    if (!seen.has(id)) {
      const payload = await store.readAttendance(id);
      if (payload) attendance.push(JSON.parse(payload) as Attendance);
    }

  const photoQueue: PhotoJob[] = [];
  const queueById = new Map(state.photoQueue.map((job) => [job.id, job]));
  for (const id of persistedQueue.keys()) {
    const current = queueById.get(id);
    if (current && queueStamp(current) === persistedQueue.get(id)) photoQueue.push(current);
    else {
      const payload = await store.readQueue(id);
      if (payload) photoQueue.push(JSON.parse(payload) as PhotoJob);
    }
  }

  const auditLogs = state.auditLogs.filter((log) => persistedAudit.has(log.id));
  // Mavjud havolani saqlaymiz (readDb chaqirganlar ham yangi holatni ko‘radi).
  Object.assign(state, core, { attendance, photoQueue, auditLogs });
  return state;
}

/** Navbatdagi barcha yozuvlar diskka tushguncha kutadi (to‘xtatishdan oldin). */
export async function flushDb() {
  while (draining || pending.length) {
    if (draining) await draining;
    else await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Baza holati: health-check uchun (qulf kutilayotganda «starting»). */
export function databaseStatus() {
  return { kind: backend?.kind || (process.env.DATABASE_URL ? "postgres" : "sqlite"), waiting: PostgresBackend.waitingForLock, ready: Boolean(state) };
}

/** Bazani yopadi (testlar va to‘xtatish uchun): navbatni yozib bo‘lib, ulanishni bo‘shatadi. */
export async function closeDb() {
  await flushDb();
  await backend?.close();
  backend = undefined;
  state = undefined;
  loading = undefined;
}

/** Hujjat fayllari (document_files) — joriy bazada (SQLite yoki PostgreSQL). */
export async function documentFiles() {
  await ensureLoaded();
  return connect();
}

export async function checkDatabaseHealth() {
  await ensureLoaded();
  return connect().health();
}

/** Audit jurnalining to‘liq tarixi (xotirada faqat oxirgilari saqlanadi). */
export async function queryAuditLogs(
  companyId: string,
  options: { entityId?: string; limit?: number } = {},
): Promise<AuditLog[]> {
  await ensureLoaded();
  await flushDb();
  const limit = Math.min(1000, Math.max(1, options.limit || 300));
  const rows = await connect().queryAudit(companyId, options.entityId, limit);
  return rows.map((payload) => JSON.parse(payload) as AuditLog);
}

/* ------------------------------------------------ o‘qish uchun indekslar --- */

export type DataIndexes = {
  attendanceByKey: Map<string, Attendance>;
  attendanceByEmployee: Map<string, Attendance[]>;
  approvedLeaveByEmployee: Map<string, LeaveRequest[]>;
};
let cachedIndexes: { version: number; value: DataIndexes } | undefined;

/**
 * Tez qidirish uchun indekslar (xodim+sana → davomat va h.k.). Ma’lumot
 * o‘zgarganda qayta quriladi. Faqat o‘qish (GET) yo‘llarida ishlating.
 */
export function dataIndexes(db: Database): DataIndexes {
  if (cachedIndexes && cachedIndexes.version === version) return cachedIndexes.value;
  const attendanceByKey = new Map<string, Attendance>();
  const attendanceByEmployee = new Map<string, Attendance[]>();
  for (const record of db.attendance) {
    attendanceByKey.set(`${record.employeeId}|${record.date}`, record);
    const list = attendanceByEmployee.get(record.employeeId);
    if (list) list.push(record);
    else attendanceByEmployee.set(record.employeeId, [record]);
  }
  const approvedLeaveByEmployee = new Map<string, LeaveRequest[]>();
  for (const leave of db.leaveRequests) {
    if (leave.status !== "APPROVED") continue;
    const list = approvedLeaveByEmployee.get(leave.employeeId);
    if (list) list.push(leave);
    else approvedLeaveByEmployee.set(leave.employeeId, [leave]);
  }
  const value = { attendanceByKey, attendanceByEmployee, approvedLeaveByEmployee };
  cachedIndexes = { version, value };
  return value;
}

/** Audit yozuvida biometrik ma’lumot va rasm saqlanmaydi (yuz vektori, Face ID namunalari, foto). */
const SENSITIVE_KEYS = new Set(["photoDataUrl", "descriptor", "samples", "lastDescriptor", "passwordHash"]);
export function scrubSensitive(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value)) return value.map((item) => scrubSensitive(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>))
    if (!SENSITIVE_KEYS.has(key)) out[key] = scrubSensitive(item, depth + 1);
  return out;
}

/**
 * Xodim butunlay o‘chirilganda uning eski audit yozuvlaridan ham rasm va yuz
 * ma’lumotlari tozalanadi (voqealar tarixi qoladi, biometrika qolmaydi).
 */
export async function scrubAuditForEntities(companyId: string, entityIds: string[]) {
  if (!entityIds.length) return 0;
  await ensureLoaded();
  await flushDb();
  return connect().rewriteAudit(companyId, entityIds, (payload) => JSON.stringify(scrubSensitive(JSON.parse(payload))));
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
    before: scrubSensitive(before),
    after: scrubSensitive(after),
    createdAt: new Date().toISOString(),
  };
}
