import { createHash } from "node:crypto";
import { tashkentClock, tashkentIsoDate } from "../../lib/format";
import type { Attendance, Branch, Department, Employee, Position } from "../../lib/types";

/*
 * Bot (Gulnora HR API v1) ⇄ Staffora ma’lumot shakllari o‘rtasidagi sof
 * (holatsiz) o‘girishlar. Hammasi testlanadi — taxmin o‘rniga API javobidagi
 * haqiqiy maydonlar ishlatiladi (api/repo.py serializerlari).
 */

export interface RemoteRef {
  id: number;
  name?: string;
  full_name?: string;
}
export interface RemoteBranch {
  id: number;
  name: string;
  code?: string | null;
  address?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radius?: number | null;
  working_hours?: string | null;
  status?: "active" | "inactive" | string;
  managers?: { id: number; full_name?: string; telegram_id?: number; phone?: string }[];
  employee_count?: number;
  external_ids?: Record<string, string>;
  created_at?: string | null;
  updated_at?: string | null;
}
export interface RemoteDepartment {
  id: number;
  name: string;
  code?: string | null;
  description?: string | null;
  parent_id?: number | null;
  head?: RemoteRef | null;
  status?: string;
  employee_count?: number;
  external_ids?: Record<string, string>;
  created_at?: string | null;
  updated_at?: string | null;
}
export interface RemotePosition {
  id: number;
  name: string;
  code?: string | null;
  description?: string | null;
  department_id?: number | null;
  status?: string;
  employee_count?: number;
  external_ids?: Record<string, string>;
  created_at?: string | null;
  updated_at?: string | null;
}
export interface RemoteEmployee {
  id: number;
  telegram_id?: number | null;
  telegram_username?: string | null;
  external_ids?: Record<string, string>;
  full_name?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  address?: string | null;
  role?: string | null;
  role_label?: string | null;
  position?: string | null;
  position_id?: number | null;
  branch?: RemoteRef | null;
  department?: RemoteRef | null;
  manager?: RemoteRef | null;
  status?: "active" | "blocked" | string;
  employment_status?: string | null;
  hired_at?: string | null;
  schedule?: { work_hours?: string | null; rest_day?: string | null; shift?: string | null };
  /** Faqat kalitda employees:salary ruxsati bo‘lsa keladi. */
  salary?: { monthly_salary?: string | number | null; currency?: string } | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}
export interface RemoteAttendance {
  id: number;
  employee?: { id: number; full_name?: string; telegram_id?: number } | null;
  branch?: RemoteRef | null;
  date: string;
  check_in?: string | null;
  check_out?: string | null;
  worked_seconds?: number | null;
  worked_minutes?: number | null;
  late?: boolean;
  late_seconds?: number | null;
  early_leave?: boolean;
  early_leave_seconds?: number | null;
  status?: string;
  state?: string;
  verification_method?: string | null;
  check_out_verification_method?: string | null;
  location?: {
    check_in?: { latitude?: number | null; longitude?: number | null; distance_m?: number | null } | null;
    check_out?: { latitude?: number | null; longitude?: number | null; distance_m?: number | null } | null;
  } | null;
  source?: string | null;
  note?: string | null;
  external_ids?: Record<string, string>;
  created_at?: string | null;
  updated_at?: string | null;
}

/* ----------------------------------------------------------- yordamchi --- */

/** «08:00 - 17:00», «08:00 – 24:00» → {start, end} (24:00 → 23:59). */
export function parseWorkHours(text?: string | null) {
  const match = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/.exec(text || "");
  if (!match) return undefined;
  const [h1, m1, h2, m2] = match.slice(1).map(Number);
  if (h1 > 24 || h2 > 24 || m1 > 59 || m2 > 59) return undefined;
  const clock = (h: number, m: number) =>
    h >= 24 ? "23:59" : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const start = clock(h1, m1);
  const end = clock(h2, m2);
  if (start === end) return undefined;
  return { start, end };
}

const weekdayNames: Record<string, number> = {
  yakshanba: 0,
  dushanba: 1,
  seshanba: 2,
  chorshanba: 3,
  payshanba: 4,
  juma: 5,
  shanba: 6,
};

/** «Yakshanba», «Shanba, Yakshanba» → [6, 0]. Noma’lum bo‘lsa — []. */
export function parseRestDays(text?: string | null) {
  const days = new Set<number>();
  for (const part of (text || "").toLowerCase().replace(/[‘’'`ʻ]/g, "").split(/[,;/]|\s+va\s+/)) {
    const word = part.trim();
    for (const [name, day] of Object.entries(weekdayNames))
      if (word.startsWith(name)) days.add(day);
  }
  return [...days];
}

/** Bot tartibi «Familiya Ism [Otasining ismi]» → Staffora maydonlari. */
export function splitFullName(fullName?: string | null) {
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "Nomsiz", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const [lastName, firstName, ...rest] = parts;
  return { firstName, lastName, middleName: rest.length ? rest.join(" ") : undefined };
}

/**
 * Bot'dagi maosh erkin matn: «5000000», «5 000 000», «3.5 mln», «4,2 mln so‘m», «800 ming».
 * Tushunib bo‘lmasa — undefined (taxmin qilinmaydi).
 */
export function parseSalary(value?: string | number | null) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
  const text = value.toLowerCase().replace(/[’'`ʻ]/g, "").trim();
  if (!text) return undefined;
  const unit = /mln|million|миллион|млн/.test(text) ? 1_000_000 : /ming|минг|тыс|k\b/.test(text) ? 1_000 : 1;
  const match = /(\d[\d\s.,]*)/.exec(text);
  if (!match) return undefined;
  let digits = match[1].trim().replace(/\s+/g, "");
  if (unit > 1) digits = digits.replace(",", ".");
  else digits = digits.replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", ".");
  const amount = Number(digits) * unit;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000_000) return undefined;
  return Math.round(amount);
}

export function joinFullName(employee: Pick<Employee, "firstName" | "lastName" | "middleName">) {
  return [employee.lastName, employee.firstName, employee.middleName].filter((x) => x && x.trim()).join(" ").trim();
}

/** «30.04.1995» yoki «1995-04-30» → «1995-04-30». */
export function parseBirthDate(value?: string | null) {
  if (!value) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return value;
  const dmy = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
  if (!dmy) return undefined;
  return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
}

/** ISO vaqt (+05:00) → Toshkent sanasi va HH:MM. */
export function isoToTashkent(value?: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return { date: tashkentIsoDate(date), clock: tashkentClock(date) };
}

/** Staffora sanasi + vaqti → bot kutgan ISO (+05:00). */
export function tashkentToIso(date: string, clock: string) {
  return `${date}T${clock.length === 5 ? `${clock}:00` : clock}+05:00`;
}

export const stableHash = (value: unknown) =>
  createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 20);

const text = (value?: string | null) => (value || "").trim();

/* ------------------------------------------------- bot → Staffora --- */

export function branchFromRemote(remote: RemoteBranch): Partial<Branch> {
  const out: Partial<Branch> = {
    name: text(remote.name) || `Filial #${remote.id}`,
    address: text(remote.address),
    radiusMeters: Math.max(10, Math.round(Number(remote.radius) || 150)),
    status: remote.status === "inactive" ? "INACTIVE" : "ACTIVE",
    manager: remote.managers?.map((m) => m.full_name).filter(Boolean).join(", ") || "",
  };
  if (typeof remote.latitude === "number" && typeof remote.longitude === "number") {
    out.latitude = remote.latitude;
    out.longitude = remote.longitude;
  }
  return out;
}

export function departmentFromRemote(remote: RemoteDepartment): Partial<Department> {
  return { name: text(remote.name) || `Bo‘lim #${remote.id}`, manager: remote.head?.full_name || undefined };
}

export function positionFromRemote(remote: RemotePosition): Partial<Position> {
  return { name: text(remote.name) || `Lavozim #${remote.id}` };
}

export function employeeFromRemote(remote: RemoteEmployee): Partial<Employee> {
  const name = splitFullName(remote.full_name);
  const telegramId = remote.telegram_id ? String(remote.telegram_id) : undefined;
  return {
    firstName: name.firstName,
    lastName: name.lastName,
    middleName: name.middleName,
    phone: text(remote.phone),
    birthDate: parseBirthDate(remote.birth_date),
    address: text(remote.address) || undefined,
    manager: remote.manager?.full_name || undefined,
    telegramUsername: remote.telegram_username || undefined,
    telegramId,
    status: remote.status === "blocked" ? "INACTIVE" : "ACTIVE",
    baseSalary: parseSalary(remote.salary?.monthly_salary),
  };
}

const verificationMap: Record<string, Attendance["verification"][number]> = {
  gps: "GPS",
  face: "FACE",
  qr: "QR",
  manual: "MANUAL",
  card: "DEVICE",
  fingerprint: "DEVICE",
  pin: "DEVICE",
  telegram: "TELEGRAM",
};

/** Bot davomat yozuvi → Staffora maydonlari (xodim/filial allaqachon aniqlangan). */
export function attendanceFromRemote(
  remote: RemoteAttendance,
  schedule: { start: string; end: string } | undefined,
): Omit<Attendance, "id" | "companyId" | "employeeId" | "branchId"> | undefined {
  const checkIn = isoToTashkent(remote.check_in);
  if (!checkIn) return undefined;
  const checkOut = isoToTashkent(remote.check_out);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(remote.date) ? remote.date : checkIn.date;
  const lateMinutes = Math.round(Math.max(0, Number(remote.late_seconds) || 0) / 60);
  const earlyLeaveMinutes = Math.round(Math.max(0, Number(remote.early_leave_seconds) || 0) / 60);
  const workedMinutes = Math.max(0, Math.round(Number(remote.worked_seconds ?? (remote.worked_minutes || 0) * 60) / 60));
  const scheduledStart = schedule?.start || checkIn.clock;
  const scheduledEnd = schedule?.end || checkOut?.clock || checkIn.clock;
  const toMin = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
  const overtimeMinutes =
    checkOut && schedule && checkOut.date === date ? Math.max(0, toMin(checkOut.clock) - toMin(schedule.end)) : 0;
  const methods = [remote.verification_method, remote.check_out_verification_method]
    .map((m) => (m ? verificationMap[m] : undefined))
    .filter((m): m is Attendance["verification"][number] => Boolean(m));
  const location = remote.location?.check_in;
  return {
    date,
    scheduledStart,
    scheduledEnd,
    checkIn: checkIn.clock,
    checkOut: checkOut?.clock,
    lateMinutes,
    earlyLeaveMinutes,
    workedMinutes,
    overtimeMinutes,
    status: checkOut ? (lateMinutes ? "LATE" : "CHECKED_OUT") : lateMinutes ? "LATE" : "WORKING",
    verification: methods.length ? [...new Set(methods)] : ["TELEGRAM"],
    latitude: typeof location?.latitude === "number" ? location.latitude : undefined,
    longitude: typeof location?.longitude === "number" ? location.longitude : undefined,
    distanceMeters: typeof location?.distance_m === "number" ? location.distance_m : undefined,
    note: [`Xodimlar botidan (#${remote.id})`, remote.note].filter(Boolean).join(" · "),
    updatedAt: new Date().toISOString(),
  };
}

/* ------------------------------ solishtirish izlari (conflict detection) --- */

export const branchKeys = ["name", "address", "latitude", "longitude", "radiusMeters", "status"] as const;
export const departmentKeys = ["name"] as const;
export const positionKeys = ["name", "departmentId"] as const;
export const employeeKeys = [
  "firstName",
  "lastName",
  "middleName",
  "phone",
  "birthDate",
  "address",
  "branchId",
  "departmentId",
  "positionId",
  "status",
] as const;

export function pick<T extends object>(value: T, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const v = (value as Record<string, unknown>)[key];
    out[key] = v === "" || v === null ? undefined : v;
  }
  return out;
}

/* ------------------------------------------------- Staffora → bot --- */

export function branchToRemote(branch: Branch) {
  return {
    name: branch.name.slice(0, 120),
    address: branch.address ? branch.address.slice(0, 300) : undefined,
    latitude: Number.isFinite(branch.latitude) ? branch.latitude : undefined,
    longitude: Number.isFinite(branch.longitude) ? branch.longitude : undefined,
    radius: Math.min(100_000, Math.max(10, Math.round(branch.radiusMeters || 150))),
    status: branch.status === "INACTIVE" ? "inactive" : "active",
  };
}

export function departmentToRemote(department: Department) {
  return { name: department.name.slice(0, 120) };
}

export function positionToRemote(position: Position, remoteDepartmentId?: number) {
  return { name: position.name.slice(0, 120), ...(remoteDepartmentId ? { department_id: remoteDepartmentId } : {}) };
}

export function employeeToRemote(
  employee: Employee,
  refs: { branchId?: number; departmentId?: number; positionId?: number },
) {
  const fullName = joinFullName(employee);
  return {
    full_name: fullName.length >= 2 ? fullName.slice(0, 120) : undefined,
    phone: employee.phone ? employee.phone.slice(0, 20) : undefined,
    birth_date: employee.birthDate || undefined,
    address: employee.address ? employee.address.slice(0, 300) : undefined,
    ...(refs.branchId ? { branch_id: refs.branchId } : {}),
    ...(refs.departmentId ? { department_id: refs.departmentId } : {}),
    ...(refs.positionId ? { position_id: refs.positionId } : {}),
    status: employee.status === "ACTIVE" ? "active" : "blocked",
  };
}
