import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Role } from "../../lib/types";
import { canAny } from "../../lib/permissions";
import type { AiActionLevel } from "../../lib/ai/types";
import { audit } from "../../lib/store";
import { calculateAttendance } from "../../lib/attendance";
import { dayPlan } from "../../lib/schedule";
import { assertMonthOpen } from "../payroll-workflow";

export type ActionContext = { db: Database; companyId: string; userId: string; userName: string; role: Role };
type Definition = { level: AiActionLevel; permission: string | string[]; schema: z.ZodTypeAny; summary: (payload: any, ctx: ActionContext) => string; execute: (payload: any, ctx: ActionContext) => unknown };
export type PlannedAction = { name: string; payload: Record<string, unknown>; missing?: string[] };

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
const id = () => randomUUID();
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

function employeeByRef(ctx: ActionContext, reference: string) {
  const ref = reference.trim().toLocaleLowerCase("uz");
  const employee = ctx.db.employees.find((item) => item.companyId === ctx.companyId && (item.id.toLocaleLowerCase("uz") === ref || item.employeeNo.toLocaleLowerCase("uz") === ref));
  if (!employee) throw Object.assign(new Error(`ID yoki xodim raqami “${reference}” bo‘yicha xodim topilmadi.`), { status: 404 });
  return employee;
}

const verified = (message: string, data: Record<string, unknown>) => ({ verified: true, message, ...data });

export const ACTIONS: Record<string, Definition> = {
  get_attendance_summary: { level: "READ", permission: "attendance.view", schema: z.object({ date: z.string().date().optional() }), summary: (p) => `${p.date || today()} davomat xulosasi`, execute: (p, c) => { const date = p.date || today(); const employees = c.db.employees.filter((e) => e.companyId === c.companyId && e.status === "ACTIVE"); const rows = c.db.attendance.filter((a) => a.companyId === c.companyId && a.date === date); const present = new Set(rows.filter((a) => a.checkIn).map((a) => a.employeeId)); const late = rows.filter((a) => a.status === "LATE").length; return { date, total: employees.length, present: present.size, absent: Math.max(0, employees.length - present.size), late }; } },
  get_absent_employees: { level: "READ", permission: "attendance.view", schema: z.object({ date: z.string().date().optional(), branchId: z.string().uuid().optional() }), summary: (p) => `${p.date || today()} kelmagan xodimlar`, execute: (p, c) => { const date = p.date || today(); const checked = new Set(c.db.attendance.filter((a) => a.companyId === c.companyId && a.date === date && a.checkIn).map((a) => a.employeeId)); return c.db.employees.filter((e) => e.companyId === c.companyId && e.status === "ACTIVE" && (!p.branchId || e.branchId === p.branchId) && !checked.has(e.id)).map((e) => ({ id: e.id, name: fullName(e), branchId: e.branchId })); } },
  get_late_employees: { level: "READ", permission: "attendance.view", schema: z.object({ date: z.string().date().optional(), branchId: z.string().uuid().optional() }), summary: (p) => `${p.date || today()} kechikkan xodimlar`, execute: (p, c) => { const date = p.date || today(); return c.db.attendance.filter((a) => a.companyId === c.companyId && a.date === date && a.status === "LATE").filter((a) => !p.branchId || c.db.employees.find((e) => e.id === a.employeeId)?.branchId === p.branchId).map((a) => ({ ...a, employee: c.db.employees.find((e) => e.id === a.employeeId) ? fullName(c.db.employees.find((e) => e.id === a.employeeId)!) : a.employeeId })); } },
  get_branch_statistics: { level: "READ", permission: "attendance.view", schema: z.object({ date: z.string().date().optional() }), summary: (p) => `${p.date || today()} filial statistikasi`, execute: (p, c) => { const date = p.date || today(); return c.db.branches.filter((b) => b.companyId === c.companyId).map((b) => { const employees = c.db.employees.filter((e) => e.companyId === c.companyId && e.branchId === b.id && e.status === "ACTIVE"); const attended = new Set(c.db.attendance.filter((a) => a.companyId === c.companyId && a.date === date && a.checkIn && employees.some((e) => e.id === a.employeeId)).map((a) => a.employeeId)); return { id: b.id, name: b.name, employees: employees.length, present: attended.size, rate: employees.length ? Math.round(attended.size / employees.length * 1000) / 10 : 0 }; }); } },
  get_work_schedule: { level: "READ", permission: "org.view", schema: z.object({ branchId: z.string().uuid().optional(), employeeId: z.string().uuid().optional() }), summary: () => "Ish grafigi", execute: (p, c) => { const branch = p.branchId ? c.db.branches.find((b) => b.id === p.branchId && b.companyId === c.companyId) : p.employeeId ? c.db.branches.find((b) => b.id === c.db.employees.find((e) => e.id === p.employeeId && e.companyId === c.companyId)?.branchId) : undefined; return branch ? { branch, schedule: c.db.schedules.find((s) => s.id === branch.scheduleId) } : c.db.schedules.filter((s) => s.companyId === c.companyId); } },
  set_employee_salary: {
    level: "SENSITIVE",
    permission: ["employees.edit", "payroll.edit"],
    schema: z.object({ employeeId: z.string().trim().min(1).max(100), baseSalary: z.coerce.number().int().min(0).max(100_000_000_000) }),
    summary: (p, c) => { const employee = employeeByRef(c, p.employeeId); return `${fullName(employee)} (${employee.employeeNo}) oyligi ${Number(p.baseSalary).toLocaleString("uz-UZ")} so‘m etib belgilanadi`; },
    execute: (p, c) => {
      const employee = employeeByRef(c, p.employeeId), before = { baseSalary: employee.baseSalary };
      employee.baseSalary = p.baseSalary; employee.updatedAt = new Date().toISOString();
      c.db.auditLogs.unshift(audit(c.companyId, c.userName, `AI: ${fullName(employee)} oyligi o‘zgartirildi`, "employee", employee.id, before, { baseSalary: employee.baseSalary }));
      const saved = employeeByRef(c, employee.id);
      return verified(`Bajarildi va tekshirildi: ${fullName(saved)} oyligi ${saved.baseSalary.toLocaleString("uz-UZ")} so‘m.`, { employeeId: saved.id, employeeNo: saved.employeeNo, baseSalary: saved.baseSalary });
    },
  },
  set_attendance: {
    level: "WRITE",
    permission: "attendance.edit",
    schema: z.object({ employeeId: z.string().trim().min(1).max(100), date: z.string().date().default(today), checkIn: clock, checkOut: clock.optional(), note: z.string().trim().max(500).optional() }),
    summary: (p, c) => { const employee = employeeByRef(c, p.employeeId); return `${fullName(employee)} (${employee.employeeNo}) ${p.date} kuni ${p.checkIn} da kelgan deb belgilanadi`; },
    execute: (p, c) => {
      if (p.date > today()) throw Object.assign(new Error("Kelajak sanasi uchun davomat kiritib bo‘lmaydi."), { status: 422 });
      assertMonthOpen(c.db, c.companyId, p.date);
      const employee = employeeByRef(c, p.employeeId);
      if (!c.db.branches.some((item) => item.id === employee.branchId && item.companyId === c.companyId)) throw Object.assign(new Error("Xodim filiali topilmadi."), { status: 404 });
      const plan = dayPlan(c.db, employee, p.date);
      const calculated = calculateAttendance({ scheduledStart: plan.start, scheduledEnd: plan.end, checkIn: p.checkIn, checkOut: p.checkOut, graceMinutes: plan.graceMinutes });
      let row = c.db.attendance.find((item) => item.companyId === c.companyId && item.employeeId === employee.id && item.date === p.date);
      if (row) {
        const before = { ...row }, nextCheckOut = p.checkOut ?? row.checkOut;
        const nextCalculated = calculateAttendance({ scheduledStart: plan.start, scheduledEnd: plan.end, checkIn: p.checkIn, checkOut: nextCheckOut, graceMinutes: plan.graceMinutes });
        Object.assign(row, nextCalculated, { branchId: employee.branchId, scheduledStart: plan.start, scheduledEnd: plan.end, checkIn: p.checkIn, checkOut: nextCheckOut, note: p.note ?? row.note, verification: [...new Set([...row.verification, "MANUAL" as const])], source: "STAFFORA" as const, updatedAt: new Date().toISOString() });
        c.db.auditLogs.unshift(audit(c.companyId, c.userName, `AI: ${fullName(employee)} davomati yangilandi`, "attendance", row.id, before, row));
      } else {
        row = { id: id(), companyId: c.companyId, employeeId: employee.id, branchId: employee.branchId, date: p.date, scheduledStart: plan.start, scheduledEnd: plan.end, checkIn: p.checkIn, checkOut: p.checkOut, ...calculated, verification: ["MANUAL"], note: p.note, source: "STAFFORA", updatedAt: new Date().toISOString() };
        c.db.attendance.push(row);
        c.db.auditLogs.unshift(audit(c.companyId, c.userName, `AI: ${fullName(employee)} davomati kiritildi`, "attendance", row.id, undefined, row));
      }
      const saved = c.db.attendance.find((item) => item.id === row!.id)!;
      return verified(`Bajarildi va tekshirildi: ${fullName(employee)} ${saved.date} kuni ${saved.checkIn} da kelgan deb qayd etildi.`, { attendanceId: saved.id, employeeId: employee.id, date: saved.date, checkIn: saved.checkIn, status: saved.status });
    },
  },
  create_schedule: {
    level: "WRITE",
    permission: "employees.edit",
    schema: z.object({ name: z.string().trim().min(2).max(100), type: z.enum(["FIXED", "FLEXIBLE", "SHIFT"]).default("FIXED"), start: clock, end: clock, workDays: z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5]), graceMinutes: z.coerce.number().int().min(0).max(180).default(5), breakMinutes: z.coerce.number().int().min(0).max(480).default(60), overtimeEnabled: z.boolean().default(true) }),
    summary: (p) => `“${p.name}” ish grafigi yaratiladi: ${p.start}–${p.end}, ${p.workDays.length} ish kuni`,
    execute: (p, c) => {
      const row: Database["schedules"][number] = { id: id(), companyId: c.companyId, name: p.name, type: p.type, graceMinutes: p.graceMinutes, overtimeEnabled: p.overtimeEnabled, days: Array.from({ length: 7 }, (_, day) => ({ day, enabled: p.workDays.includes(day), start: p.start, end: p.end, breakMinutes: p.breakMinutes })) };
      c.db.schedules.push(row); c.db.auditLogs.unshift(audit(c.companyId, c.userName, `AI: ish grafigi yaratildi — ${row.name}`, "schedule", row.id, undefined, row));
      return verified(`Bajarildi va tekshirildi: “${row.name}” grafigi ${p.start}–${p.end} vaqt bilan yaratildi.`, { scheduleId: row.id, name: row.name, start: p.start, end: p.end });
    },
  },
  assign_employee_schedule: {
    level: "WRITE",
    permission: "employees.edit",
    schema: z.object({ employeeId: z.string().trim().min(1).max(100), scheduleId: z.string().uuid() }),
    summary: (p, c) => { const employee = employeeByRef(c, p.employeeId), schedule = c.db.schedules.find((item) => item.id === p.scheduleId && item.companyId === c.companyId); if (!schedule) throw Object.assign(new Error("Ish grafigi topilmadi."), { status: 404 }); return `${fullName(employee)} xodimiga “${schedule.name}” grafigi biriktiriladi`; },
    execute: (p, c) => { const employee = employeeByRef(c, p.employeeId), schedule = c.db.schedules.find((item) => item.id === p.scheduleId && item.companyId === c.companyId); if (!schedule) throw Object.assign(new Error("Ish grafigi topilmadi."), { status: 404 }); const before = { scheduleId: employee.scheduleId }; employee.scheduleId = schedule.id; employee.updatedAt = new Date().toISOString(); c.db.auditLogs.unshift(audit(c.companyId, c.userName, `AI: ${fullName(employee)} grafigi yangilandi`, "employee", employee.id, before, { scheduleId: schedule.id })); return verified(`Bajarildi va tekshirildi: ${fullName(employee)} xodimiga “${schedule.name}” grafigi biriktirildi.`, { employeeId: employee.id, scheduleId: schedule.id }); },
  },
  create_branch: { level: "WRITE", permission: "branches.edit", schema: z.object({ name: z.string().trim().min(2).max(100), address: z.string().trim().min(3).max(250), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), radiusMeters: z.number().int().min(30).max(5000).default(150), scheduleId: z.string().uuid(), manager: z.string().trim().max(100).default("") }), summary: (p) => `${p.name} filiali yaratiladi (${p.address})`, execute: (p, c) => { if (!c.db.schedules.some((s) => s.id === p.scheduleId && s.companyId === c.companyId)) throw Object.assign(new Error("Ish grafigi topilmadi."), { status: 422 }); const row = { id: id(), companyId: c.companyId, name: p.name, address: p.address, latitude: p.latitude, longitude: p.longitude, radiusMeters: p.radiusMeters, manager: p.manager, status: "ACTIVE" as const, scheduleId: p.scheduleId }; c.db.branches.push(row); c.db.auditLogs.unshift(audit(c.companyId, c.userName, `AI: filial yaratildi — ${row.name}`, "branch", row.id)); return row; } },
  update_branch: { level: "WRITE", permission: "branches.edit", schema: z.object({ branchId: z.string().uuid(), name: z.string().trim().min(2).max(100).optional(), address: z.string().trim().min(3).max(250).optional(), status: z.enum(["ACTIVE", "INACTIVE"]).optional(), manager: z.string().trim().max(100).optional() }), summary: (p, c) => `${c.db.branches.find((b) => b.id === p.branchId)?.name || "Filial"} ma’lumotlari yangilanadi`, execute: (p, c) => { const row = c.db.branches.find((b) => b.id === p.branchId && b.companyId === c.companyId); if (!row) throw Object.assign(new Error("Filial topilmadi."), { status: 404 }); Object.assign(row, p); c.db.auditLogs.unshift(audit(c.companyId, c.userName, `AI: filial yangilandi — ${row.name}`, "branch", row.id)); return row; } },
  update_work_schedule: { level: "WRITE", permission: "branches.edit", schema: z.object({ scheduleId: z.string().uuid(), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), effectiveDate: z.string().date(), dayNumbers: z.array(z.number().int().min(0).max(6)).min(1) }), summary: (p) => `Ish vaqti ${p.start}–${p.end}, ${p.effectiveDate} dan`, execute: (p, c) => { if (p.effectiveDate < today()) throw Object.assign(new Error("Grafik o‘tgan sanadan kuchga kiritilmaydi."), { status: 422 }); const source = c.db.schedules.find((s) => s.id === p.scheduleId && s.companyId === c.companyId); if (!source) throw Object.assign(new Error("Grafik topilmadi."), { status: 404 }); const clone = { ...source, id: id(), name: `${source.name} · ${p.effectiveDate}`, days: source.days.map((d) => p.dayNumbers.includes(d.day) ? { ...d, start: p.start, end: p.end } : { ...d }) }; c.db.schedules.push(clone); for (const branch of c.db.branches.filter((b) => b.companyId === c.companyId && b.scheduleId === source.id)) branch.scheduleId = clone.id; c.db.auditLogs.unshift(audit(c.companyId, c.userName, `AI: yangi grafik ${clone.name}`, "schedule", clone.id)); return clone; } },
};

export const actionCatalog = () => Object.entries(ACTIONS).map(([name, d]) => ({ name, level: d.level, permission: d.permission }));

export function validateAction(name: string, payload: unknown, ctx: ActionContext) {
  const definition = ACTIONS[name]; if (!definition) throw Object.assign(new Error("AI action topilmadi yoki taqiqlangan."), { status: 404 }); const permissions = Array.isArray(definition.permission) ? definition.permission : [definition.permission]; if (!canAny(ctx.role, permissions)) throw Object.assign(new Error("Bu amal uchun ruxsat yetarli emas."), { status: 403 }); const parsed = definition.schema.parse(payload); return { definition, payload: parsed, summary: definition.summary(parsed, ctx) };
}

export function executeAction(name: string, payload: unknown, ctx: ActionContext) { const checked = validateAction(name, payload, ctx); return checked.definition.execute(checked.payload, ctx); }

export function detectReadAction(message: string) {
  const text = message.toLocaleLowerCase("uz");
  if (looksLikeWriteRequest(text)) return undefined;
  if (/kelmagan|yo['‘’]?q xodim/.test(text)) return "get_absent_employees";
  if (/kechik/.test(text)) return "get_late_employees";
  if (/filial.*stat|stat.*filial/.test(text)) return "get_branch_statistics";
  if (/grafik|ish vaqti/.test(text) && !/o['‘’]?zgartir|qil/.test(text)) return "get_work_schedule";
  if (/davomat|ishga keldi|bugun nechta/.test(text)) return "get_attendance_summary";
  return undefined;
}
export function looksLikeWriteRequest(message: string) {
  return /(kirit|qo['‘’]?sh|yarat|o['‘’]?zgartir|yangila|belgila|biriktir|tayinla|qilib qo['‘’]?y|qil\b|ber\b|yoz\b)/i.test(message);
}

function employeeReference(text: string) {
  return text.match(/(?:xodim|hodim)?\s*(?:id|ID|raqam)(?:si|li|lik|i)?\s*[:#-]?\s*([a-zA-Z0-9_-]{1,100})/u)?.[1] || text.match(/#([a-zA-Z0-9_-]{1,100})/)?.[1];
}

function timesIn(text: string) {
  return Array.from(text.matchAll(/(?:^|\D)([01]?\d|2[0-3])[:.\s]([0-5]\d)(?=\D|$)/g), (match) => `${match[1].padStart(2, "0")}:${match[2]}`);
}

export function planDeterministicAction(message: string): PlannedAction | undefined {
  const text = message.toLocaleLowerCase("uz"), employeeId = employeeReference(message);
  if (/oyli[kg]|maosh/.test(text) && looksLikeWriteRequest(text)) {
    const candidates = Array.from(message.matchAll(/\d[\d\s.,]*/g)).map((match) => Number(match[0].replace(/\D/g, ""))).filter(Number.isFinite).sort((a, b) => b - a);
    const baseSalary = candidates[0];
    return { name: "set_employee_salary", payload: { employeeId, baseSalary }, missing: [...(!employeeId ? ["xodim ID yoki xodim raqami"] : []), ...(baseSalary === undefined ? ["oylik summasi"] : [])] };
  }
  if (/(ishga keldi|davomat|kelgan deb|kelish vaqt)/.test(text) && looksLikeWriteRequest(text)) {
    const checkIn = timesIn(message)[0], date = message.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || today();
    return { name: "set_attendance", payload: { employeeId, date, checkIn }, missing: [...(!employeeId ? ["xodim ID yoki xodim raqami"] : []), ...(!checkIn ? ["kelish vaqti (masalan, 08:00)"] : [])] };
  }
  if (/grafik/.test(text) && /(qo['‘’]?sh|yarat)/.test(text)) {
    const times = timesIn(message), quoted = message.match(/[“\"']([^”\"']{2,100})[”\"']/)?.[1], named = message.match(/(?:nomi|nomli)\s+([\p{L}\d _-]{2,100})/iu)?.[1], name = quoted || named?.trim();
    return { name: "create_schedule", payload: { name, start: times[0], end: times[1] }, missing: [...(!name ? ["grafik nomi"] : []), ...(!times[0] ? ["boshlanish vaqti"] : []), ...(!times[1] ? ["tugash vaqti"] : [])] };
  }
  return undefined;
}

