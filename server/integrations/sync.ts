import { audit, readDb, updateDb } from "../../lib/store";
import { phoneKey, tashkentIsoDate } from "../../lib/format";
import type {
  Attendance,
  Branch,
  Database,
  Department,
  Employee,
  EntityMapping,
  Integration,
  IntegrationConflict,
  Position,
  Schedule,
  SyncEntity,
  SyncJob,
  SyncJobCounter,
} from "../../lib/types";
import { BotApiError, type BotClient } from "./client";
import {
  PROVIDER,
  SOURCE_KEY,
  clientFor,
  mappingByExternal,
  mappingByLocal,
  newId,
  upsertMapping,
} from "./model";
import { enqueueOutbox, logIntegration } from "./sqlstore";
import * as T from "./transform";

/*
 * Sinxronlash dvigateli.
 *
 * Moslashtirish tartibi (dublikat yaratmaslik uchun):
 *   1) mapping (integratsiya + entity + bot ID)
 *   2) bot'dagi external_ids.staffora (oldin Staffora'dan yuborilgan bo‘lsa)
 *   3) tabiiy kalit: xodim — telegram_id, keyin telefon; filial/bo‘lim/lavozim — nomi
 *   4) topilmasa — yaratiladi
 *
 * Ikki tomonlama o‘zgarishlar uchun har bir mapping'da "oxirgi kelishilgan"
 * maydonlar (snapshot.fields) saqlanadi. Kelgan o‘zgarish shu asos bilan
 * solishtiriladi (3 tomonlama birlashtirish): faqat bot o‘zgartirgan maydonlar
 * qo‘llanadi; ikkala tomon ham o‘zgartirgan maydon — konflikt (strategiya bo‘yicha).
 */

export type LocalEntity = "branch" | "department" | "position" | "employee";
export const ENTITY_ORDER: LocalEntity[] = ["branch", "department", "position", "employee"];
const KEYS: Record<LocalEntity, readonly string[]> = {
  branch: T.branchKeys,
  department: T.departmentKeys,
  position: T.positionKeys,
  employee: T.employeeKeys,
};
/** Majburiy bog‘lanishlar: bot bo‘sh yuborsa, Staffora'dagi qiymat saqlanadi. */
const REF_KEYS = new Set(["branchId", "departmentId", "positionId"]);

export type ApplyAction = "created" | "updated" | "linked" | "unchanged" | "conflict" | "skipped" | "deleted";
export interface ApplyResult {
  action: ApplyAction;
  localId?: string;
  reason?: string;
  matchedBy?: "mapping" | "external_id" | "telegram_id" | "phone" | "name";
}

const DEFAULT_DEPARTMENT = "Umumiy";
const DEFAULT_POSITION = "Xodim";

/* ------------------------------------------------------ normalizatsiya --- */

function norm(key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (key === "phone") return phoneKey(String(value)) || undefined;
  if (typeof value === "number") return Math.round(value * 1e6) / 1e6;
  if (typeof value === "string") return value.trim().replace(/\s+/g, " ");
  return value;
}
const same = (key: string, a: unknown, b: unknown) => norm(key, a) === norm(key, b);

function localCollection(db: Database, entity: LocalEntity): { id: string; companyId: string }[] {
  return entity === "branch"
    ? db.branches
    : entity === "department"
      ? db.departments
      : entity === "position"
        ? db.positions
        : db.employees;
}

export function findLocal(db: Database, companyId: string, entity: LocalEntity, id: string) {
  return localCollection(db, entity).find((row) => row.id === id && row.companyId === companyId) as
    | (Branch & Department & Position & Employee)
    | undefined;
}

const actorName = (integration: Integration) => `Integratsiya: ${integration.name}`;

/* ------------------------------------------------------ grafik / defolt --- */

const dayNames = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];

/** Ish vaqti + dam olish kunlari bo‘yicha grafik topadi yoki yaratadi. */
export function scheduleFor(
  db: Database,
  integration: Integration,
  hours: { start: string; end: string } | undefined,
  restDays: number[],
): string {
  const tenant = integration.companyId;
  if (!hours) {
    const existing = db.schedules.find((s) => s.companyId === tenant);
    if (existing) return existing.id;
    hours = { start: "09:00", end: "18:00" };
    restDays = [0];
  }
  const rest = [...new Set(restDays)].sort();
  const name = `${hours.start}–${hours.end}${rest.length ? ` · dam: ${rest.map((d) => dayNames[d]).join(", ")}` : " · har kuni"}`;
  const found = db.schedules.find((s) => s.companyId === tenant && s.name === name);
  if (found) return found.id;
  const schedule: Schedule = {
    id: newId(),
    companyId: tenant,
    name,
    type: "FIXED",
    // Bot kechikishni ish boshlanishidan hisoblaydi — bir xil natija uchun 0.
    graceMinutes: 0,
    overtimeEnabled: true,
    days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      enabled: !rest.includes(day),
      start: hours!.start,
      end: hours!.end,
      breakMinutes: 0,
    })),
  };
  db.schedules.push(schedule);
  db.auditLogs.unshift(audit(tenant, actorName(integration), "Ish grafigi yaratildi (integratsiya)", "schedule", schedule.id, undefined, schedule));
  return schedule.id;
}

function markLocalOnly(integration: Integration, id: string) {
  integration.localOnlyIds = [...new Set([...(integration.localOnlyIds || []), id])];
}

function defaultDepartment(db: Database, integration: Integration) {
  const tenant = integration.companyId;
  let department = db.departments.find((d) => d.companyId === tenant && d.name === DEFAULT_DEPARTMENT);
  if (!department) {
    department = { id: newId(), companyId: tenant, name: DEFAULT_DEPARTMENT };
    db.departments.push(department);
    markLocalOnly(integration, department.id);
    db.auditLogs.unshift(audit(tenant, actorName(integration), "Bo‘lim yaratildi (bot'da bo‘lim ko‘rsatilmagan xodimlar uchun)", "department", department.id));
  }
  return department.id;
}

function positionByName(db: Database, integration: Integration, name: string | undefined, departmentId: string) {
  const tenant = integration.companyId;
  const clean = (name || "").trim() || DEFAULT_POSITION;
  const key = clean.toLowerCase();
  const stripped = (value: string) => value.replace(/^[^\p{L}\p{N}]+/u, "").trim().toLowerCase();
  let position =
    db.positions.find((p) => p.companyId === tenant && p.name.trim().toLowerCase() === key) ||
    db.positions.find((p) => p.companyId === tenant && stripped(p.name) === stripped(clean));
  if (!position) {
    position = { id: newId(), companyId: tenant, name: clean, departmentId };
    db.positions.push(position);
    markLocalOnly(integration, position.id);
    db.auditLogs.unshift(audit(tenant, actorName(integration), "Lavozim yaratildi (xodim ma’lumotidan)", "position", position.id));
  }
  return position.id;
}

function nextEmployeeNo(db: Database, tenant: string) {
  const numbers = db.employees
    .filter((e) => e.companyId === tenant)
    .map((e) => Number(e.employeeNo.replace(/\D/g, "")) || 0);
  return `EMP-${String(Math.max(0, ...numbers) + 1).padStart(4, "0")}`;
}

/* ------------------------------------------- bot → Staffora maydonlari --- */

type Remote = T.RemoteBranch | T.RemoteDepartment | T.RemotePosition | T.RemoteEmployee;

/** Bot yozuvini Staffora maydonlariga (bog‘lanishlar hal qilingan holda) o‘giradi. */
export function resolveRemoteFields(db: Database, integration: Integration, entity: LocalEntity, remote: Remote) {
  if (entity === "branch") return T.branchFromRemote(remote as T.RemoteBranch) as Record<string, unknown>;
  if (entity === "department") return T.departmentFromRemote(remote as T.RemoteDepartment) as Record<string, unknown>;
  if (entity === "position") {
    const r = remote as T.RemotePosition;
    return {
      ...T.positionFromRemote(r),
      departmentId: r.department_id ? mappingByExternal(db, integration.id, "department", r.department_id)?.localId : undefined,
    };
  }
  const r = remote as T.RemoteEmployee;
  const fields: Record<string, unknown> = { ...T.employeeFromRemote(r) };
  fields.branchId = r.branch?.id ? mappingByExternal(db, integration.id, "branch", r.branch.id)?.localId : undefined;
  fields.departmentId = r.department?.id ? mappingByExternal(db, integration.id, "department", r.department.id)?.localId : undefined;
  fields.positionId = r.position_id ? mappingByExternal(db, integration.id, "position", r.position_id)?.localId : undefined;
  return fields;
}

/* ------------------------------------------------------------ moslash --- */

function findExisting(
  db: Database,
  integration: Integration,
  entity: LocalEntity,
  remote: Remote,
): { local?: Branch & Department & Position & Employee; mapping?: EntityMapping; matchedBy?: ApplyResult["matchedBy"] } {
  const tenant = integration.companyId;
  const mapping = mappingByExternal(db, integration.id, entity, remote.id);
  if (mapping) {
    const local = findLocal(db, tenant, entity, mapping.localId);
    if (local) return { local, mapping, matchedBy: "mapping" };
  }
  const free = (id: string) => {
    const m = mappingByLocal(db, integration.id, entity, id);
    return !m || m.externalId === String(remote.id);
  };
  const ownId = remote.external_ids?.[SOURCE_KEY];
  if (ownId) {
    const local = findLocal(db, tenant, entity, ownId);
    if (local && free(local.id)) return { local, matchedBy: "external_id" };
  }
  const rows = localCollection(db, entity).filter((row) => row.companyId === tenant && free(row.id)) as (Branch &
    Department &
    Position &
    Employee)[];
  if (entity === "employee") {
    const r = remote as T.RemoteEmployee;
    if (r.telegram_id) {
      const people = rows as unknown as Employee[];
      const byTelegram = people.find((e) => e.telegramId === String(r.telegram_id) && e.status !== "DISMISSED");
      if (byTelegram) return { local: byTelegram as never, matchedBy: "telegram_id" };
    }
    const key = phoneKey(r.phone || "");
    if (key.length >= 9) {
      const byPhone = (rows as unknown as Employee[]).filter((e) => phoneKey(e.phone) === key && e.status !== "DISMISSED");
      if (byPhone.length === 1) return { local: byPhone[0] as never, matchedBy: "phone" };
    }
    return {};
  }
  const name = String((remote as { name?: string }).name || "").trim().toLowerCase();
  if (name) {
    const byName = rows.filter((row) => (row.name || "").trim().toLowerCase() === name);
    if (byName.length === 1) return { local: byName[0], matchedBy: "name" };
  }
  return {};
}

function sanitizeSnapshot(remote: Remote) {
  // Maosh va maxfiy hujjatlar saqlanmaydi (kalitda ruxsat ham yo‘q, lekin ehtiyot uchun).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { monthly_salary, salary, documents, ...rest } = remote as Record<string, unknown>;
  return rest;
}

function createLocal(
  db: Database,
  integration: Integration,
  entity: LocalEntity,
  remote: Remote,
  fields: Record<string, unknown>,
) {
  const tenant = integration.companyId;
  const now = new Date().toISOString();
  if (entity === "branch") {
    const r = remote as T.RemoteBranch;
    const branch: Branch = {
      id: newId(),
      companyId: tenant,
      name: String(fields.name),
      address: String(fields.address || ""),
      latitude: typeof fields.latitude === "number" ? fields.latitude : 0,
      longitude: typeof fields.longitude === "number" ? fields.longitude : 0,
      radiusMeters: Number(fields.radiusMeters) || 150,
      manager: String(fields.manager || ""),
      status: (fields.status as Branch["status"]) || "ACTIVE",
      scheduleId: scheduleFor(db, integration, T.parseWorkHours(r.working_hours), []),
      // Bot filiallarida QR ekran yo‘q — yuz + GPS bilan belgilanadi (sozlamada o‘zgartiriladi).
      attendanceMode: "GPS_FACE",
    };
    db.branches.push(branch);
    return branch;
  }
  if (entity === "department") {
    const department: Department = {
      id: newId(),
      companyId: tenant,
      name: String(fields.name),
      manager: (fields.manager as string) || undefined,
    };
    db.departments.push(department);
    return department;
  }
  if (entity === "position") {
    const position: Position = {
      id: newId(),
      companyId: tenant,
      name: String(fields.name),
      departmentId: (fields.departmentId as string) || defaultDepartment(db, integration),
    };
    db.positions.push(position);
    return position;
  }
  const r = remote as T.RemoteEmployee;
  const branchSchedule = fields.branchId
    ? mappingByLocal(db, integration.id, "branch", String(fields.branchId))?.snapshot?.raw
    : undefined;
  const hours =
    T.parseWorkHours(r.schedule?.work_hours) ||
    T.parseWorkHours((branchSchedule as { working_hours?: string } | undefined)?.working_hours);
  const departmentId = (fields.departmentId as string) || defaultDepartment(db, integration);
  const hired = T.isoToTashkent(r.hired_at)?.date || T.isoToTashkent(r.created_at)?.date || tashkentIsoDate();
  const employee: Employee = {
    id: newId(),
    companyId: tenant,
    employeeNo: nextEmployeeNo(db, tenant),
    firstName: String(fields.firstName),
    lastName: String(fields.lastName || ""),
    middleName: fields.middleName as string | undefined,
    birthDate: fields.birthDate as string | undefined,
    phone: String(fields.phone || ""),
    email: "",
    address: fields.address as string | undefined,
    departmentId,
    positionId: (fields.positionId as string) || positionByName(db, integration, r.position || undefined, departmentId),
    branchId: (fields.branchId as string) || "",
    scheduleId: scheduleFor(db, integration, hours, T.parseRestDays(r.schedule?.rest_day)),
    manager: fields.manager as string | undefined,
    employmentType: "FULL_TIME",
    startDate: hired,
    // Maosh faqat kalitda employees:salary ruxsati bo‘lsa keladi; aks holda Staffora'da kiritiladi.
    baseSalary: typeof fields.baseSalary === "number" ? fields.baseSalary : 0,
    currency: "UZS",
    telegramUsername: fields.telegramUsername as string | undefined,
    telegramId: fields.telegramId as string | undefined,
    telegramIdSource: fields.telegramId ? "INTEGRATION" : undefined,
    telegramConnected: false,
    deviceStatus: "PENDING",
    status: (fields.status as Employee["status"]) || "ACTIVE",
    createdAt: now,
    updatedAt: now,
  };
  db.employees.push(employee);
  return employee;
}

/* ---------------------------------------------------------- konflikt --- */

function openConflict(
  db: Database,
  integration: Integration,
  entity: LocalEntity,
  localId: string,
  externalId: string,
  fields: IntegrationConflict["fields"],
  remote: Record<string, unknown>,
) {
  let conflict = db.integrationConflicts.find(
    (c) => c.integrationId === integration.id && c.entity === entity && c.localId === localId && c.status === "OPEN",
  );
  if (!conflict) {
    conflict = {
      id: newId(),
      companyId: integration.companyId,
      integrationId: integration.id,
      entity,
      localId,
      externalId,
      fields,
      remote,
      status: "OPEN",
      createdAt: new Date().toISOString(),
    };
    db.integrationConflicts.unshift(conflict);
  } else {
    conflict.fields = fields;
    conflict.remote = remote;
  }
  return conflict;
}

export function hasOpenConflict(db: Database, integrationId: string, entity: SyncEntity, localId: string) {
  return db.integrationConflicts.some(
    (c) => c.integrationId === integrationId && c.entity === entity && c.localId === localId && c.status === "OPEN",
  );
}

function assignField(local: Record<string, unknown>, key: string, value: unknown) {
  if (value === undefined && REF_KEYS.has(key)) return;
  if (key === "phone" || key === "address" || key === "firstName" || key === "lastName" || key === "name")
    local[key] = value ?? "";
  else local[key] = value;
}

/* --------------------------------------------------- asosiy: qo‘llash --- */

/**
 * Bitta bot yozuvini Staffora'ga qo‘llaydi (updateDb ichida chaqiriladi).
 * Bog‘lanishlar (filial, lavozim…) oldindan mapping'da bo‘lishi kerak.
 */
export function applyRemoteEntity(db: Database, integration: Integration, entity: LocalEntity, remote: Remote): ApplyResult {
  const mode = integration.settings.syncModes[entity];
  if (mode === "OFF") return { action: "skipped", reason: "sinxronlash o‘chirilgan" };
  const keys = KEYS[entity];
  const fields = resolveRemoteFields(db, integration, entity, remote);
  const remoteFields = T.pick(fields, keys);
  const existing = findExisting(db, integration, entity, remote);
  const snapshotRaw = sanitizeSnapshot(remote);
  const tenant = integration.companyId;

  if (!existing.local) {
    if (mode === "EXPORT") return { action: "skipped", reason: "faqat Staffora → bot rejimi" };
    const created = createLocal(db, integration, entity, remote, fields);
    upsertMapping(db, integration, entity, created.id, remote.id, {
      remoteUpdatedAt: remote.updated_at || undefined,
      snapshot: { fields: T.pick(created, keys), raw: snapshotRaw },
    });
    db.auditLogs.unshift(audit(tenant, actorName(integration), `${entityLabel[entity]} botdan import qilindi`, entity, created.id, undefined, created));
    return { action: "created", localId: created.id };
  }

  const local = existing.local as unknown as Record<string, unknown>;
  const before = { ...local };
  const localFields = T.pick(local, keys);
  const base = existing.mapping?.snapshot?.fields as Record<string, unknown> | undefined;
  const conflicts: IntegrationConflict["fields"] = [];
  const nextBase: Record<string, unknown> = { ...(base || localFields) };
  let changed = false;
  const canImport = mode === "IMPORT" || mode === "TWO_WAY";
  const strategy = mode === "IMPORT" ? "BOT_WINS" : integration.settings.conflictStrategy;
  const localTime = typeof local.updatedAt === "string" ? Date.parse(local.updatedAt) : NaN;
  const remoteTime = remote.updated_at ? Date.parse(remote.updated_at) : NaN;

  for (const key of keys) {
    const r = remoteFields[key];
    const l = localFields[key];
    if (r === undefined && REF_KEYS.has(key)) continue;
    if (!base) {
      // Birinchi bog‘lash: bo‘sh maydonlar to‘ldiriladi; farq qilganlari — konflikt.
      if (same(key, r, l)) continue;
      if (norm(key, l) === undefined) {
        if (canImport) {
          assignField(local, key, r);
          changed = true;
        }
        nextBase[key] = r;
        continue;
      }
      if (norm(key, r) === undefined) continue;
    } else {
      if (same(key, r, base[key])) continue; // bot o‘zgartirmagan
      if (same(key, l, base[key]) || same(key, l, r)) {
        if (canImport) {
          if (!same(key, l, r)) {
            assignField(local, key, r);
            changed = true;
          }
          nextBase[key] = r;
        }
        continue;
      }
    }
    if (!canImport) continue;
    // Ikkala tomon ham o‘zgartirgan — strategiya.
    const botWins =
      strategy === "BOT_WINS" ||
      (strategy === "LATEST" && (Number.isNaN(localTime) || (!Number.isNaN(remoteTime) && remoteTime >= localTime)));
    if (strategy === "MANUAL") {
      conflicts.push({ field: key, local: l, remote: r });
      nextBase[key] = l;
    } else if (botWins) {
      assignField(local, key, r);
      nextBase[key] = r;
      changed = true;
    } else {
      // Staffora ustun: asos bot qiymatiga tenglanadi — keyingi eksportda Staffora qiymati botga yuboriladi.
      nextBase[key] = r;
    }
  }

  if (changed && entity === "employee") local.updatedAt = new Date().toISOString();
  if (entity === "employee") {
    const r = remote as T.RemoteEmployee;
    // Bot bergan Telegram ID: xodim hali o‘zi ulamagan bo‘lsa yoziladi (ulanishda tekshiriladi).
    if (r.telegram_id && !local.telegramConnected && local.telegramId !== String(r.telegram_id)) {
      const taken = db.employees.some((e) => e.id !== local.id && e.companyId === tenant && e.telegramId === String(r.telegram_id) && e.telegramConnected);
      if (!taken) {
        local.telegramId = String(r.telegram_id);
        local.telegramIdSource = "INTEGRATION";
        changed = true;
      }
    }
    if (r.telegram_username && !local.telegramUsername) local.telegramUsername = r.telegram_username;
    // Maosh: Staffora'da kiritilmagan (0) bo‘lsa botdagisi olinadi; kiritilgani hech qachon ustidan yozilmaydi.
    if (typeof fields.baseSalary === "number" && !Number(local.baseSalary)) {
      local.baseSalary = fields.baseSalary;
      changed = true;
    }
  }

  upsertMapping(db, integration, entity, String(local.id), remote.id, {
    remoteUpdatedAt: remote.updated_at || undefined,
    snapshot: { fields: nextBase, raw: snapshotRaw },
  });
  if (conflicts.length) openConflict(db, integration, entity, String(local.id), String(remote.id), conflicts, snapshotRaw);
  if (changed)
    db.auditLogs.unshift(audit(tenant, actorName(integration), `${entityLabel[entity]} botdan yangilandi`, entity, String(local.id), before, { ...local }));
  if (!existing.mapping)
    return { action: "linked", localId: String(local.id), matchedBy: existing.matchedBy };
  if (conflicts.length) return { action: "conflict", localId: String(local.id) };
  return { action: changed ? "updated" : "unchanged", localId: String(local.id), matchedBy: existing.matchedBy };
}

const entityLabel: Record<LocalEntity, string> = {
  branch: "Filial",
  department: "Bo‘lim",
  position: "Lavozim",
  employee: "Xodim",
};

/** Bot'da o‘chirilgan yozuv: ma’lumot o‘chirilmaydi — xodim ishdan bo‘shatiladi, filial nofaol qilinadi. */
export function applyRemoteDelete(db: Database, integration: Integration, entity: LocalEntity, externalId: string): ApplyResult {
  const mapping = mappingByExternal(db, integration.id, entity, externalId);
  if (!mapping) return { action: "skipped", reason: "mapping topilmadi" };
  const mode = integration.settings.syncModes[entity];
  if (!integration.settings.applyRemoteDeletes || mode === "OFF" || mode === "EXPORT")
    return { action: "skipped", reason: "o‘chirishlar qo‘llanmaydi (sozlama)" };
  const local = findLocal(db, integration.companyId, entity, mapping.localId);
  if (!local) return { action: "skipped", reason: "Staffora'da topilmadi" };
  const before = { ...local };
  const now = new Date().toISOString();
  if (entity === "employee") {
    const employee = local as unknown as Employee;
    if (employee.status === "DISMISSED") return { action: "unchanged", localId: local.id };
    employee.status = "DISMISSED";
    employee.dismissedAt = now;
    employee.dismissReason = "Xodimlar botida ishdan bo‘shatilgan";
    employee.updatedAt = now;
  } else if (entity === "branch") {
    if (local.status === "INACTIVE") return { action: "unchanged", localId: local.id };
    local.status = "INACTIVE";
  } else {
    // Bo‘lim/lavozim o‘chirilmaydi — xodimlar bog‘lanishi buzilmasin. Faqat bog‘lanish uziladi.
    db.entityMappings = db.entityMappings.filter((m) => m !== mapping);
    db.auditLogs.unshift(audit(integration.companyId, actorName(integration), `${entityLabel[entity]} bot'da o‘chirildi — Staffora'da saqlab qolindi`, entity, local.id));
    return { action: "deleted", localId: local.id };
  }
  mapping.snapshot = { ...(mapping.snapshot || {}), fields: T.pick(local, KEYS[entity]) };
  db.auditLogs.unshift(audit(integration.companyId, actorName(integration), `${entityLabel[entity]} bot'da o‘chirildi`, entity, local.id, before, { ...local }));
  return { action: "deleted", localId: local.id };
}

/* --------------------------------------------------------- davomat --- */

type AttendanceIndex = Map<string, Attendance>;
function attendanceIndex(db: Database, companyId: string): AttendanceIndex {
  const map: AttendanceIndex = new Map();
  for (const a of db.attendance) if (a.companyId === companyId) map.set(`${a.employeeId}|${a.date}`, a);
  return map;
}

export function applyRemoteAttendance(
  db: Database,
  integration: Integration,
  remote: T.RemoteAttendance,
  index: AttendanceIndex = attendanceIndex(db, integration.companyId),
): ApplyResult {
  const mode = integration.settings.syncModes.attendance;
  const tenant = integration.companyId;
  const ownId = remote.external_ids?.[SOURCE_KEY];
  if (remote.source === SOURCE_KEY || ownId) {
    // Staffora'ning o‘zi yuborgan yozuv — qaytib kelgan aks-sado. Faqat bot ID sini eslab qolamiz.
    const own = ownId ? db.attendance.find((a) => a.id === ownId && a.companyId === tenant) : undefined;
    if (own && own.externalIds?.[PROVIDER] !== String(remote.id)) {
      own.externalIds = { ...(own.externalIds || {}), [PROVIDER]: String(remote.id) };
      own.updatedAt = new Date().toISOString();
    }
    return { action: "skipped", reason: "Staffora yozuvi", localId: own?.id };
  }
  if (mode === "OFF" || mode === "EXPORT") return { action: "skipped", reason: "import o‘chirilgan" };
  if (!remote.employee?.id) return { action: "skipped", reason: "xodim ko‘rsatilmagan" };
  const employeeMap = mappingByExternal(db, integration.id, "employee", remote.employee.id);
  const employee = employeeMap ? db.employees.find((e) => e.id === employeeMap.localId && e.companyId === tenant) : undefined;
  if (!employee) return { action: "skipped", reason: `xodim #${remote.employee.id} Staffora'ga bog‘lanmagan` };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(remote.date) ? remote.date : T.isoToTashkent(remote.check_in)?.date;
  if (!date) return { action: "skipped", reason: "sana yo‘q" };
  const weekday = new Date(`${date}T12:00:00+05:00`).getDay();
  const day = db.schedules.find((s) => s.id === employee.scheduleId)?.days.find((d) => d.day === weekday);
  const fields = T.attendanceFromRemote(remote, day?.enabled ? { start: day.start, end: day.end } : undefined);
  if (!fields) return { action: "skipped", reason: "kelish vaqti yo‘q" };
  const branchId =
    (remote.branch?.id ? mappingByExternal(db, integration.id, "branch", remote.branch.id)?.localId : undefined) ||
    employee.branchId;
  const key = `${employee.id}|${date}`;
  const existing = index.get(key);
  if (!existing) {
    const record: Attendance = {
      id: newId(),
      companyId: tenant,
      employeeId: employee.id,
      branchId,
      ...fields,
      source: "BOT",
      externalIds: { [PROVIDER]: String(remote.id) },
    };
    db.attendance.push(record);
    index.set(key, record);
    // Import qilingan xodimning ish boshlash sanasi birinchi yozuvdan keyin bo‘lmasin.
    if (employee.telegramIdSource === "INTEGRATION" && date < employee.startDate) employee.startDate = date;
    return { action: "created", localId: record.id };
  }
  const fromBot = existing.source === "BOT" || existing.externalIds?.[PROVIDER] === String(remote.id);
  if (!fromBot || existing.source === "STAFFORA") {
    // Staffora'da (yuz + GPS bilan) qayd etilgan yozuv ustun — faqat bog‘lab qo‘yamiz.
    if (existing.externalIds?.[PROVIDER] !== String(remote.id)) {
      existing.externalIds = { ...(existing.externalIds || {}), [PROVIDER]: String(remote.id) };
      existing.updatedAt = new Date().toISOString();
      return { action: "linked", localId: existing.id };
    }
    return { action: "unchanged", localId: existing.id };
  }
  const comparable = (a: Partial<Attendance>) =>
    T.stableHash([a.checkIn, a.checkOut, a.lateMinutes, a.earlyLeaveMinutes, a.workedMinutes, a.branchId]);
  if (comparable(existing) === comparable({ ...fields, branchId })) return { action: "unchanged", localId: existing.id };
  Object.assign(existing, fields, { branchId, source: "BOT", externalIds: { ...(existing.externalIds || {}), [PROVIDER]: String(remote.id) } });
  return { action: "updated", localId: existing.id };
}

/* --------------------------------------------------- botdan yuklash --- */

export interface RemoteSnapshot {
  branches: T.RemoteBranch[];
  departments: T.RemoteDepartment[];
  positions: T.RemotePosition[];
  employees: T.RemoteEmployee[];
  attendance: T.RemoteAttendance[];
  company?: { name?: string };
}

export const collectionPath: Record<LocalEntity | "attendance", string> = {
  branch: "/branches",
  department: "/departments",
  position: "/positions",
  employee: "/employees",
  attendance: "/attendance",
};

export async function fetchRemote(
  client: BotClient,
  entities: Set<string>,
  onProgress?: (phase: string) => void,
): Promise<RemoteSnapshot> {
  const result: RemoteSnapshot = { branches: [], departments: [], positions: [], employees: [], attendance: [] };
  const want = (e: string) => entities.has(e);
  // Bog‘lanishlar to‘g‘ri hal bo‘lishi uchun filial/bo‘lim/lavozim xodimdan oldin olinadi.
  if (want("branch") || want("employee")) {
    onProgress?.("Filiallar olinmoqda");
    result.branches = (await client.all<T.RemoteBranch>("/branches")).items;
  }
  if (want("department") || want("employee") || want("position")) {
    onProgress?.("Bo‘limlar olinmoqda");
    result.departments = (await client.all<T.RemoteDepartment>("/departments")).items;
  }
  if (want("position") || want("employee")) {
    onProgress?.("Lavozimlar olinmoqda");
    result.positions = (await client.all<T.RemotePosition>("/positions")).items;
  }
  if (want("employee") || want("attendance")) {
    onProgress?.("Xodimlar olinmoqda");
    result.employees = (await client.all<T.RemoteEmployee>("/employees")).items;
  }
  if (want("attendance")) {
    onProgress?.("Davomat tarixi olinmoqda");
    result.attendance = (await client.all<T.RemoteAttendance>("/attendance", { sort: "date" })).items;
  }
  return result;
}

/* -------------------------------------------------------- oldindan ko‘rish --- */

export interface PreviewRow {
  entity: string;
  total: number;
  create: number;
  link: number;
  update: number;
  skip: number;
  samples: { externalId: string; name: string; action: string; matchedBy?: string; reason?: string }[];
}

/**
 * Importdan oldin nima bo‘lishini ko‘rsatadi. Bazaga hech narsa yozilmaydi —
 * nusxa ustida sinab ko‘riladi.
 */
export async function buildPreview(integration: Integration, remote: RemoteSnapshot) {
  const db = structuredClone(await readDb()) as Database;
  const copy: Integration = structuredClone(integration);
  const rows: PreviewRow[] = [];
  const warnings: string[] = [];
  const run = (entity: LocalEntity, items: Remote[], name: (item: Remote) => string) => {
    const row: PreviewRow = { entity, total: items.length, create: 0, link: 0, update: 0, skip: 0, samples: [] };
    for (const item of items) {
      const result = applyRemoteEntity(db, copy, entity, item);
      if (result.action === "created") row.create += 1;
      else if (result.action === "linked") row.link += 1;
      else if (result.action === "skipped") row.skip += 1;
      else row.update += 1;
      if (row.samples.length < 50)
        row.samples.push({ externalId: String(item.id), name: name(item), action: result.action, matchedBy: result.matchedBy, reason: result.reason });
    }
    rows.push(row);
  };
  run("branch", remote.branches, (b) => (b as T.RemoteBranch).name);
  run("department", remote.departments, (d) => (d as T.RemoteDepartment).name);
  run("position", remote.positions, (p) => (p as T.RemotePosition).name);
  run("employee", remote.employees, (e) => (e as T.RemoteEmployee).full_name || `#${e.id}`);
  const index = attendanceIndex(db, integration.companyId);
  const att: PreviewRow = { entity: "attendance", total: remote.attendance.length, create: 0, link: 0, update: 0, skip: 0, samples: [] };
  for (const item of remote.attendance) {
    const result = applyRemoteAttendance(db, copy, item, index);
    if (result.action === "created") att.create += 1;
    else if (result.action === "linked") att.link += 1;
    else if (result.action === "skipped") att.skip += 1;
    else att.update += 1;
    if (att.samples.length < 30)
      att.samples.push({ externalId: String(item.id), name: `${item.employee?.full_name || "—"} · ${item.date}`, action: result.action, reason: result.reason });
  }
  rows.push(att);
  const noBranch = remote.employees.filter((e) => !e.branch?.id).length;
  if (noBranch) warnings.push(`${noBranch} ta xodimga bot'da filial biriktirilmagan — import qilingach Staffora'da filial tanlang (aks holda Mini App'da keldi-ketdi qila olmaydi).`);
  const noTelegram = remote.employees.filter((e) => !e.telegram_id || e.telegram_id < 0).length;
  if (noTelegram) warnings.push(`${noTelegram} ta xodimning Telegram ID si yo‘q yoki test qiymat — ularga bot orqali havola yuborib bo‘lmaydi.`);
  if (!remote.departments.length) warnings.push(`Bot'da bo‘limlar yo‘q — xodimlar «${DEFAULT_DEPARTMENT}» bo‘limiga biriktiriladi.`);
  const noCoords = remote.branches.filter((b) => typeof b.latitude !== "number" || typeof b.longitude !== "number").length;
  if (noCoords) warnings.push(`${noCoords} ta filialda koordinata yo‘q — GPS tekshiruvi uchun Staffora'da kiriting.`);
  const counting = db.companies.find((c) => c.id === integration.companyId)?.attendanceCounting?.startDate;
  if (!counting)
    warnings.push("Hisoblash boshlanish sanasi belgilanmagan — import qilingan xodimlarning kechikish va ushlanmalari darhol hisoblanadi. Sanani belgilash tavsiya etiladi.");
  return { rows, warnings, company: remote.company };
}

/* ---------------------------------------------------------- ish (job) --- */

const running = new Set<string>();
export const isSyncRunning = (integrationId: string) => running.has(integrationId);

const emptyCounter = (): SyncJobCounter => ({ total: 0, created: 0, updated: 0, linked: 0, skipped: 0, failed: 0 });

function count(counter: SyncJobCounter, action: ApplyAction) {
  if (action === "created") counter.created += 1;
  else if (action === "linked") counter.linked += 1;
  else if (action === "skipped") counter.skipped += 1;
  else if (action === "updated" || action === "conflict" || action === "deleted") counter.updated += 1;
}

async function patchJob(jobId: string, change: (job: SyncJob) => void) {
  await updateDb((db) => {
    const job = db.syncJobs.find((j) => j.id === jobId);
    if (job) change(job);
  });
}

export async function createSyncJob(
  integration: Integration,
  type: SyncJob["type"],
  entities: string[],
  by: string,
) {
  if (running.has(integration.id)) throw Object.assign(new Error("Sinxronlash allaqachon ishlayapti."), { status: 409 });
  const job: SyncJob = {
    id: newId(),
    companyId: integration.companyId,
    integrationId: integration.id,
    type,
    status: "QUEUED",
    entities,
    progress: 0,
    counters: {},
    errors: [],
    createdBy: by,
    createdAt: new Date().toISOString(),
  };
  await updateDb((db) => {
    db.syncJobs.unshift(job);
    db.auditLogs.unshift(audit(integration.companyId, by, `Sinxronlash boshlandi (${entities.join(", ")})`, "integration", integration.id));
  });
  return job;
}

/** Tanlangan ma’lumotlarni botdan olib, Staffora'ga qo‘llaydi (fon ishi). */
export async function runSyncJob(jobId: string) {
  const db0 = await readDb();
  const job = db0.syncJobs.find((j) => j.id === jobId);
  if (!job) return;
  const integration0 = db0.integrations.find((i) => i.id === job.integrationId && i.companyId === job.companyId);
  if (!integration0) return;
  if (running.has(integration0.id)) return;
  running.add(integration0.id);
  const entities = new Set(job.entities);
  try {
    await patchJob(jobId, (j) => {
      j.status = "RUNNING";
      j.startedAt = new Date().toISOString();
      j.phase = "Bot bilan bog‘lanish";
    });
    const client = clientFor(integration0);
    const remote = await fetchRemote(client, entities, (phase) => void patchJob(jobId, (j) => (j.phase = phase)));
    await logIntegration(integration0, "info", "sync.fetch", "Bot ma’lumotlari olindi", {
      branches: remote.branches.length,
      departments: remote.departments.length,
      positions: remote.positions.length,
      employees: remote.employees.length,
      attendance: remote.attendance.length,
    });
    const steps: { entity: LocalEntity | "attendance"; items: Remote[] | T.RemoteAttendance[] }[] = [];
    // Bog‘lanishlar uchun filial/bo‘lim/lavozim xodimdan oldin (tanlanmagan bo‘lsa ham) mapping qilinadi.
    const needRefs = entities.has("employee");
    if (entities.has("branch") || needRefs) steps.push({ entity: "branch", items: remote.branches });
    if (entities.has("department") || needRefs || entities.has("position")) steps.push({ entity: "department", items: remote.departments });
    if (entities.has("position") || needRefs) steps.push({ entity: "position", items: remote.positions });
    if (entities.has("employee")) steps.push({ entity: "employee", items: remote.employees });
    if (entities.has("attendance")) steps.push({ entity: "attendance", items: remote.attendance });
    const totalItems = steps.reduce((s, x) => s + x.items.length, 0) || 1;
    let done = 0;
    const counters: Record<string, SyncJobCounter> = {};
    const errors: SyncJob["errors"] = [];
    for (const step of steps) {
      const counter = (counters[step.entity] = emptyCounter());
      counter.total = step.items.length;
      await patchJob(jobId, (j) => (j.phase = `${phaseLabel[step.entity]} qo‘llanmoqda`));
      for (let offset = 0; offset < step.items.length; offset += 100) {
        const batch = step.items.slice(offset, offset + 100);
        await updateDb((db) => {
          const integration = db.integrations.find((i) => i.id === integration0.id)!;
          const index = step.entity === "attendance" ? attendanceIndex(db, integration.companyId) : undefined;
          for (const item of batch) {
            try {
              const result =
                step.entity === "attendance"
                  ? applyRemoteAttendance(db, integration, item as T.RemoteAttendance, index)
                  : applyRemoteEntity(db, integration, step.entity, item as Remote);
              count(counter, result.action);
              if (result.action === "skipped" && result.reason && errors.length < 200 && step.entity !== "attendance")
                errors.push({ entity: step.entity, externalId: String(item.id), message: result.reason });
            } catch (error) {
              counter.failed += 1;
              if (errors.length < 200)
                errors.push({ entity: step.entity, externalId: String(item.id), message: (error as Error).message });
            }
          }
          const j = db.syncJobs.find((x) => x.id === jobId);
          done += batch.length;
          if (j) {
            j.counters = structuredClone(counters);
            j.progress = Math.min(99, Math.round((done / totalItems) * 100));
          }
        });
      }
    }
    const failed = Object.values(counters).reduce((s, c) => s + c.failed, 0);
    await updateDb((db) => {
      const j = db.syncJobs.find((x) => x.id === jobId);
      if (j) {
        j.status = failed ? "PARTIAL" : "DONE";
        j.progress = 100;
        j.phase = "Tugadi";
        j.counters = counters;
        j.errors = errors;
        j.finishedAt = new Date().toISOString();
      }
      const integration = db.integrations.find((i) => i.id === integration0.id);
      if (integration) {
        integration.lastSyncAt = new Date().toISOString();
        if (job.type === "INITIAL") integration.initialSyncDoneAt ||= integration.lastSyncAt;
        integration.status = "CONNECTED";
        integration.lastError = undefined;
      }
      db.auditLogs.unshift(audit(integration0.companyId, job.createdBy, `Sinxronlash tugadi${failed ? ` (${failed} ta xato)` : ""}`, "integration", integration0.id, undefined, counters));
    });
    await logIntegration(integration0, failed ? "warn" : "info", "sync.done", `Sinxronlash tugadi${failed ? ` — ${failed} ta xato` : ""}`, counters);
    // Bot tomonida ham Staffora ID larini bog‘lab qo‘yamiz (dublikatga qarshi qo‘shimcha himoya).
    void linkExternalIds(integration0.id).catch(() => undefined);
  } catch (error) {
    const message = error instanceof BotApiError ? error.message : (error as Error).message || "Noma’lum xato";
    await updateDb((db) => {
      const j = db.syncJobs.find((x) => x.id === jobId);
      if (j) {
        j.status = "FAILED";
        j.phase = "Xato";
        j.errors = [...j.errors, { entity: "*", message }];
        j.finishedAt = new Date().toISOString();
      }
      const integration = db.integrations.find((i) => i.id === integration0.id);
      if (integration) {
        integration.lastError = message;
        integration.lastErrorAt = new Date().toISOString();
      }
    });
    await logIntegration(integration0, "error", "sync.failed", message);
  } finally {
    running.delete(integration0.id);
  }
}

const phaseLabel: Record<string, string> = {
  branch: "Filiallar",
  department: "Bo‘limlar",
  position: "Lavozimlar",
  employee: "Xodimlar",
  attendance: "Davomat",
};

/** Mapping'lar bo‘yicha bot'dagi external_ids.staffora ni to‘ldirish (navbat orqali). */
export async function linkExternalIds(integrationId: string) {
  const db = await readDb();
  const integration = db.integrations.find((i) => i.id === integrationId);
  if (!integration || integration.status === "DISCONNECTED") return 0;
  let queued = 0;
  for (const m of db.entityMappings) {
    if (m.integrationId !== integrationId) continue;
    const raw = m.snapshot?.raw as { external_ids?: Record<string, string> } | undefined;
    if (raw?.external_ids?.[SOURCE_KEY] === m.localId) continue;
    const ok = await enqueueOutbox(
      integration,
      "external_id.link",
      { entity_type: m.entity, entity_id: Number(m.externalId), source: SOURCE_KEY, external_id: m.localId },
      `extid:${m.entity}:${m.externalId}:${m.localId}`,
    );
    if (ok) queued += 1;
  }
  return queued;
}

/* ------------------------------------------------ hodisalar (webhook/poll) --- */

export interface BotEventEnvelope {
  id: string;
  event: string;
  timestamp?: string;
  source?: string;
  data?: Record<string, unknown>;
}

const EVENT_ENTITY: Record<string, LocalEntity | "attendance"> = {
  employee: "employee",
  branch: "branch",
  department: "department",
  position: "position",
  attendance: "attendance",
};

/**
 * Bitta hodisani qayta ishlaydi. Bog‘lanish yetishmasa (masalan, yangi filial),
 * kerakli yozuv botdan so‘rab olinadi. Qaytaradi: processed | ignored.
 */
export async function handleBotEvent(integrationId: string, envelope: BotEventEnvelope): Promise<{ status: "processed" | "ignored"; detail?: string }> {
  const db0 = await readDb();
  const integration0 = db0.integrations.find((i) => i.id === integrationId);
  if (!integration0 || integration0.status === "DISCONNECTED") return { status: "ignored", detail: "integratsiya uzilgan" };
  const [kind, action] = String(envelope.event || "").split(".");
  const entity = EVENT_ENTITY[kind];
  if (!entity || !["created", "updated", "deleted"].includes(action)) return { status: "ignored", detail: "qo‘llab-quvvatlanmaydigan hodisa" };
  const data = (envelope.data || {}) as Record<string, unknown>;
  const externalId = data.id;
  if (externalId === undefined || externalId === null) return { status: "ignored", detail: "data.id yo‘q" };
  if (action === "deleted") {
    if (entity === "attendance") return { status: "ignored", detail: "davomat o‘chirilmaydi" };
    const result = await updateDb((db) => {
      const integration = db.integrations.find((i) => i.id === integrationId)!;
      return applyRemoteDelete(db, integration, entity, String(externalId));
    });
    return { status: result.action === "skipped" ? "ignored" : "processed", detail: result.reason || result.action };
  }
  if (entity !== "attendance" && !integration0.initialSyncDoneAt)
    return { status: "ignored", detail: "birinchi import hali bajarilmagan" };
  const client = clientFor(integration0);
  await ensureRefs(integration0, client, entity, data);
  const result = await updateDb((db) => {
    const integration = db.integrations.find((i) => i.id === integrationId)!;
    return entity === "attendance"
      ? applyRemoteAttendance(db, integration, data as unknown as T.RemoteAttendance)
      : applyRemoteEntity(db, integration, entity, data as unknown as Remote);
  });
  return { status: result.action === "skipped" ? "ignored" : "processed", detail: result.reason || result.action };
}

/** Hodisadagi bog‘lanishlar (filial, lavozim, xodim) Staffora'da bo‘lmasa — botdan olib import qiladi. */
async function ensureRefs(integration: Integration, client: BotClient, entity: LocalEntity | "attendance", data: Record<string, unknown>) {
  const refs: { entity: LocalEntity; id: number }[] = [];
  const push = (e: LocalEntity, id: unknown) => {
    if (typeof id === "number" && id > 0) refs.push({ entity: e, id });
  };
  if (entity === "employee") {
    push("branch", (data.branch as T.RemoteRef | null)?.id);
    push("department", (data.department as T.RemoteRef | null)?.id);
    push("position", data.position_id);
  } else if (entity === "position") push("department", data.department_id);
  else if (entity === "attendance") {
    push("branch", (data.branch as T.RemoteRef | null)?.id);
    push("employee", (data.employee as T.RemoteRef | null)?.id);
  }
  for (const ref of refs) {
    const db = await readDb();
    if (mappingByExternal(db, integration.id, ref.entity, ref.id)) continue;
    const mode = integration.settings.syncModes[ref.entity];
    if (mode === "OFF" || mode === "EXPORT") continue;
    try {
      const { data: remote } = await client.get<Remote>(`${collectionPath[ref.entity]}/${ref.id}`);
      if (ref.entity === "employee") await ensureRefs(integration, client, "employee", remote as unknown as Record<string, unknown>);
      await updateDb((next) => {
        const current = next.integrations.find((i) => i.id === integration.id)!;
        applyRemoteEntity(next, current, ref.entity, remote);
      });
    } catch (error) {
      await logIntegration(integration, "warn", "event.ref", `Bog‘lanishni olib bo‘lmadi: ${ref.entity} #${ref.id}`, { error: (error as Error).message });
    }
  }
}

/* ----------------------------------------------- Staffora → bot (eksport) --- */

/**
 * Staffora'da o‘zgargan (asosdan farq qiladigan) yozuvlarni topib, botga
 * yuborish navbatiga qo‘yadi. Mavjud endpoint'larga aralashmaydi: holatni
 * solishtirish orqali ishlaydi, shuning uchun har qanday tahrir qamrab olinadi.
 */
export async function queueOutboundChanges(integrationId: string) {
  const db = await readDb();
  const integration = db.integrations.find((i) => i.id === integrationId);
  if (!integration || integration.status === "DISCONNECTED" || !integration.initialSyncDoneAt) return 0;
  let queued = 0;
  const exportable = (entity: LocalEntity) => ["EXPORT", "TWO_WAY"].includes(integration.settings.syncModes[entity]);
  for (const entity of ENTITY_ORDER) {
    if (!exportable(entity)) continue;
    for (const local of localCollection(db, entity)) {
      if (local.companyId !== integration.companyId) continue;
      const mapping = mappingByLocal(db, integration.id, entity, local.id);
      const record = local as Branch & Department & Position & Employee;
      if (!mapping) {
        // Staffora'da yangi yaratilgan yozuv — botda yaratish.
        if (entity === "employee" && (!integration.settings.createInBot || !record.telegramId || record.status !== "ACTIVE")) continue;
        if (integration.localOnlyIds?.includes(local.id)) continue;
        const payload = outboundPayload(db, integration, entity, record);
        if (!payload) continue;
        const ok = await enqueueOutbox(
          integration,
          `${entity}.create` as never,
          { localId: local.id, body: { ...payload, ...(entity === "employee" ? { telegram_id: Number(record.telegramId), notify: false } : {}), external_ids: { [SOURCE_KEY]: local.id } }, fields: T.pick(record, KEYS[entity]) },
          `create:${entity}:${local.id}`,
        );
        if (ok) queued += 1;
        continue;
      }
      if (hasOpenConflict(db, integration.id, entity, local.id)) continue;
      const base = (mapping.snapshot?.fields || {}) as Record<string, unknown>;
      const current = T.pick(record, KEYS[entity]);
      const differs = KEYS[entity].some((key) => !same(key, current[key], base[key]) && !(REF_KEYS.has(key) && current[key] === undefined));
      if (!differs) continue;
      const payload = outboundPayload(db, integration, entity, record);
      if (!payload) continue;
      const ok = await enqueueOutbox(
        integration,
        `${entity}.update` as never,
        { localId: local.id, externalId: mapping.externalId, body: payload, fields: current },
        `update:${entity}:${local.id}:${T.stableHash(current)}`,
      );
      if (ok) queued += 1;
    }
  }
  return queued;
}

export function outboundPayload(db: Database, integration: Integration, entity: LocalEntity, record: Branch & Department & Position & Employee) {
  const ext = (e: LocalEntity, id?: string) => {
    if (!id) return undefined;
    const m = mappingByLocal(db, integration.id, e, id);
    return m ? Number(m.externalId) : undefined;
  };
  if (entity === "branch") return T.branchToRemote(record);
  if (entity === "department") return T.departmentToRemote(record);
  if (entity === "position") return T.positionToRemote(record, ext("department", record.departmentId));
  return T.employeeToRemote(record, {
    branchId: ext("branch", record.branchId),
    departmentId: ext("department", record.departmentId),
    positionId: ext("position", record.positionId),
  });
}

/** Konfliktni hal qilish: STAFFORA — Staffora qiymati botga yuboriladi; BOT — bot qiymati qo‘llanadi. */
export function resolveConflict(db: Database, conflict: IntegrationConflict, use: "STAFFORA" | "BOT", by: string) {
  const integration = db.integrations.find((i) => i.id === conflict.integrationId && i.companyId === conflict.companyId);
  if (!integration) throw Object.assign(new Error("Integratsiya topilmadi."), { status: 404 });
  const entity = conflict.entity as LocalEntity;
  const local = findLocal(db, conflict.companyId, entity, conflict.localId) as unknown as Record<string, unknown> | undefined;
  const mapping = mappingByLocal(db, integration.id, entity, conflict.localId);
  if (!local || !mapping) throw Object.assign(new Error("Yozuv topilmadi."), { status: 404 });
  const before = { ...local };
  const base = { ...((mapping.snapshot?.fields || {}) as Record<string, unknown>) };
  for (const field of conflict.fields) {
    if (use === "BOT") {
      assignField(local, field.field, field.remote);
      base[field.field] = field.remote;
    } else {
      // Asos bot qiymati bo‘ladi — eksport Staffora qiymatini botga yuboradi.
      base[field.field] = field.remote;
    }
  }
  if (entity === "employee" && use === "BOT") local.updatedAt = new Date().toISOString();
  mapping.snapshot = { ...(mapping.snapshot || {}), fields: base };
  conflict.status = "RESOLVED";
  conflict.resolution = use;
  conflict.resolvedBy = by;
  conflict.resolvedAt = new Date().toISOString();
  db.auditLogs.unshift(
    audit(conflict.companyId, by, `Konflikt hal qilindi: ${use === "BOT" ? "bot qiymati" : "Staffora qiymati"}`, entity, conflict.localId, before, { ...local }),
  );
}
