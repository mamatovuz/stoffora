import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { dataIndexes, readDb } from "../lib/store";
import { dateParts, tashkentIsoDate } from "../lib/format";
import type { Attendance, Database, Employee } from "../lib/types";
import { attendanceKpi, calculatePayroll, normalizePayrollSettings } from "../lib/payroll";
import { countedRecords, isPracticeDay } from "../lib/counting";
import { dayPlan, workingDaysInMonth } from "../lib/schedule";
import {
  addTableSheet,
  addTimesheetSheet,
  createWorkbook,
  sendWorkbook,
  type Row,
  type Tone,
} from "./excel";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);
const MAX_DAYS = 92;

export function payrollRows(db: Database, tenant: string, month: string) {
  const company = db.companies.find((c) => c.id === tenant);
  const settings = normalizePayrollSettings(company?.payroll);
  const today = tashkentIsoDate();
  const [y, m] = month.split("-").map(Number);
  const monthEnd = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const lastDay = monthEnd < today ? monthEnd : today;
  const days = `${month}-01` <= lastDay ? datesBetween(`${month}-01`, lastDay) : [];
  const index = dataIndexes(db);
  const adjustments = db.payrollAdjustments.filter((a) => a.companyId === tenant && a.month === month);
  return db.employees
    .filter((e) => e.companyId === tenant && e.status === "ACTIVE")
    .map((e) => {
      const rows = (index.attendanceByEmployee.get(e.id) || []).filter((x) =>
        x.date.startsWith(month),
      );
      const byDate = new Map(rows.map((r) => [r.date, r]));
      const statuses = days.map((d) => dayStatus(db, e, d, today, byDate.get(d)));
      const expectedDays = statuses.filter((s) => ["present", "late", "absent"].includes(s.kind)).length;
      const own = adjustments.filter((a) => a.employeeId === e.id);
      const sum = (type: string) => own.filter((a) => a.type === type).reduce((s, a) => s + a.amount, 0);
      // Hisoblash boshlanish sanasigacha bo‘lgan (mashq) kunlar oylikka ta’sir qilmaydi.
      const line = calculatePayroll(e.baseSalary, countedRecords(rows, company, e), settings, {
        absentDays: statuses.filter((s) => s.kind === "absent").length,
        workingDays: workingDaysInMonth(db, e, month),
        bonus: sum("BONUS"),
        fine: sum("FINE"),
        advance: sum("ADVANCE"),
      });
      const kpi = attendanceKpi({
        expectedDays,
        presentDays: line.days,
        lateDays: line.lateDays,
      });
      return {
        employee: e,
        ...line,
        expectedDays,
        adjustments: own,
        kpi,
      };
    });
}

export function datesBetween(from: string, to: string) {
  const out: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end && out.length <= 400) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

type DayCode = { code: string; tone: Tone; note?: string; kind: "present" | "late" | "absent" | "leave" | "off" | "open" | "none" | "practice" };

/** Bitta xodimning bitta kundagi holati (tabel uchun). */
function dayStatus(db: Database, employee: Employee, date: string, today: string, record?: Attendance): DayCode {
  if (date < employee.startDate || date > today) return { code: "", tone: "gray", kind: "none" };
  const company = db.companies.find((c) => c.id === employee.companyId);
  if (isPracticeDay(date, company, employee))
    return record?.checkIn
      ? { code: "M", tone: "gray", note: `${record.checkIn} → ${record.checkOut || "…"} (mashq — hisoblanmaydi)`, kind: "practice" }
      : { code: "", tone: "gray", note: "Mashq davri", kind: "practice" };
  if (record?.checkIn) {
    const note = `${record.checkIn} → ${record.checkOut || "…"}${record.lateMinutes ? ` · ${record.lateMinutes} daq kech` : ""}`;
    if (!record.checkOut && date < today) return { code: "•", tone: "blue", note: `${note} (ketish belgilanmagan)`, kind: record.lateMinutes ? "late" : "present" };
    return record.lateMinutes
      ? { code: "K", tone: "amber", note, kind: "late" }
      : { code: "✓", tone: "green", note, kind: "present" };
  }
  const leave = db.leaveRequests.some(
    (l) => l.employeeId === employee.id && l.status === "APPROVED" && l.startDate <= date && l.endDate >= date,
  );
  if (leave) return { code: "T", tone: "violet", kind: "leave" };
  // Smena almashish (grafik o‘zgarishi) ham hisobga olinadi.
  const day = dayPlan(db, employee, date);
  if (!day.enabled) return { code: "D", tone: "gray", kind: "off", note: day.reason };
  if (date === today) return { code: "", tone: "gray", kind: "open" };
  return { code: "X", tone: "red", kind: "absent" };
}

const statusCell = (a: Attendance, today: string) =>
  a.checkIn && !a.checkOut
    ? a.date === today
      ? { text: "Ishda", tone: "green" as Tone }
      : { text: "Ketish yo‘q", tone: "blue" as Tone }
    : a.lateMinutes
      ? { text: "Kechikdi", tone: "amber" as Tone }
      : a.checkIn
        ? { text: "Vaqtida", tone: "green" as Tone }
        : { text: "Kelmadi", tone: "red" as Tone };

const verificationText: Record<string, string> = {
  FACE: "Face ID",
  GPS: "GPS",
  QR: "QR",
  TELEGRAM: "Telegram",
  DEVICE: "Qurilma",
  MANUAL: "Qo‘lda",
};

export function penaltyText(settings: ReturnType<typeof normalizePayrollSettings>) {
  const free = settings.freeLateMinutesPerMonth
    ? `, oyiga ${settings.freeLateMinutesPerMonth} daq jarimasiz`
    : "";
  if (settings.latePenaltyMode === "NONE") return "Kechikish jarimasi o‘chirilgan";
  if (settings.latePenaltyMode === "PER_MINUTE")
    return `Kechikish: har daqiqa ${settings.latePenaltyPerMinute.toLocaleString("ru-RU")} so‘m${free}`;
  return `Kechikish: soatlik stavka (oylik / ${settings.monthlyHours})${free}`;
}

function stamp() {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
}
const ddmmyyyy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

export function registerExcelReports(
  app: Express,
  deps: {
    requirePermission: (permission: string) => RequestHandler;
    companyId: (req: Request) => string;
  },
) {
  const route =
    (handler: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) =>
      Promise.resolve(handler(req, res)).catch(next);
  const period = (req: Request) => {
    const today = tashkentIsoDate();
    const from = req.query.from ? dateSchema.parse(String(req.query.from)) : `${today.slice(0, 7)}-01`;
    let to = req.query.to ? dateSchema.parse(String(req.query.to)) : today;
    if (to < from) to = from;
    const days = datesBetween(from, to);
    if (days.length > MAX_DAYS)
      throw Object.assign(new Error(`Davr ${MAX_DAYS} kundan oshmasin.`), { status: 400 });
    return { from, to, today, days };
  };

  app.get(
    "/api/reports/attendance.xlsx",
    deps.requirePermission("reports.export"),
    route(async (req, res) => {
      const db = await readDb();
      const tenant = deps.companyId(req);
      const { from, to, today, days } = period(req);
      const lateOnly = req.query.type === "late";
      const company = db.companies.find((c) => c.id === tenant)?.name || "Kompaniya";
      const branchFilter = req.query.branch ? String(req.query.branch) : "";
      const employees = db.employees
        .filter(
          (e) =>
            e.companyId === tenant &&
            (e.status === "ACTIVE" ||
              (dataIndexes(db).attendanceByEmployee.get(e.id) || []).some((a) => a.date >= from && a.date <= to)) &&
            (!branchFilter || e.branchId === branchFilter),
        )
        .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
      const ids = new Set(employees.map((e) => e.id));
      const records = db.attendance
        .filter((a) => a.companyId === tenant && ids.has(a.employeeId) && a.date >= from && a.date <= to)
        .filter((a) => !lateOnly || a.lateMinutes > 0)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.checkIn || "").localeCompare(b.checkIn || ""));
      const byKey = new Map(records.map((a) => [`${a.employeeId}:${a.date}`, a]));
      const name = (e?: Employee) => (e ? `${e.firstName} ${e.lastName}` : "—");
      const lookup = <T extends { id: string; name: string }>(rows: T[], id?: string) =>
        rows.find((r) => r.id === id)?.name || "";
      const subtitle = `${company}  ·  ${ddmmyyyy(from)} — ${ddmmyyyy(to)}  ·  Tayyorlandi: ${stamp()}`;

      // Xulosa (har bir xodim bo‘yicha)
      const summary = employees.map((e) => {
        const statuses = days.map((d) => dayStatus(db, e, d, today, byKey.get(`${e.id}:${d}`)));
        const own = countedRecords(
          records.filter((a) => a.employeeId === e.id),
          db.companies.find((c) => c.id === e.companyId),
          e,
        );
        const expected = statuses.filter((s) => ["present", "late", "absent"].includes(s.kind)).length;
        const came = statuses.filter((s) => s.kind === "present" || s.kind === "late").length;
        return {
          e,
          statuses,
          row: {
            name: name(e),
            no: e.employeeNo,
            branch: lookup(db.branches, e.branchId),
            position: lookup(db.positions, e.positionId),
            came,
            late: statuses.filter((s) => s.kind === "late").length,
            lateMinutes: own.reduce((s, a) => s + a.lateMinutes, 0),
            absent: statuses.filter((s) => s.kind === "absent").length,
            leave: statuses.filter((s) => s.kind === "leave").length,
            worked: own.reduce((s, a) => s + a.workedMinutes, 0),
            overtime: own.reduce((s, a) => s + a.overtimeMinutes, 0),
            rate: expected ? came / expected : null,
          } as Row,
        };
      });
      const totalLate = summary.reduce((s, x) => s + Number(x.row.late || 0), 0);
      const totalAbsent = summary.reduce((s, x) => s + Number(x.row.absent || 0), 0);
      const totalCame = summary.reduce((s, x) => s + Number(x.row.came || 0), 0);
      const totalWorked = summary.reduce((s, x) => s + Number(x.row.worked || 0), 0);

      const workbook = createWorkbook();
      if (!lateOnly)
        addTableSheet(workbook, {
          name: "Xulosa",
          title: "Davomat xulosasi",
          subtitle,
          kpis: [
            { label: "Xodimlar", value: employees.length, tone: "blue" },
            { label: "Kelgan kunlar", value: totalCame, tone: "green" },
            { label: "Kechikishlar", value: totalLate, tone: "amber" },
            { label: "Kelmagan kunlar", value: totalAbsent, tone: "red" },
            { label: "Ishlangan soat", value: Math.round(totalWorked / 60), tone: "violet" },
          ],
          columns: [
            { header: "Xodim", key: "name", width: 26 },
            { header: "ID", key: "no", width: 11, align: "center" },
            { header: "Filial", key: "branch", width: 16 },
            { header: "Lavozim", key: "position", width: 18 },
            { header: "Keldi (kun)", key: "came", type: "number", width: 11, total: "sum" },
            { header: "Kechikdi (kun)", key: "late", type: "number", width: 12, total: "sum" },
            { header: "Kechikish (daq)", key: "lateMinutes", type: "number", width: 13, total: "sum" },
            { header: "Kelmadi (kun)", key: "absent", type: "number", width: 12, total: "sum" },
            { header: "Ta’til (kun)", key: "leave", type: "number", width: 11, total: "sum" },
            { header: "Ishlagan (soat)", key: "worked", type: "minutes", width: 13, total: "sum" },
            { header: "Qo‘shimcha", key: "overtime", type: "minutes", width: 12, total: "sum" },
            { header: "Davomat %", key: "rate", type: "percent", width: 11, total: "avg" },
          ],
          rows: summary.map((x) => x.row),
          emptyText: "Xodimlar yo‘q",
        });

      addTableSheet(workbook, {
        name: lateOnly ? "Kechikishlar" : "Batafsil",
        title: lateOnly ? "Kechikishlar hisoboti" : "Keldi-ketdi (batafsil)",
        subtitle,
        kpis: lateOnly
          ? [
              { label: "Kechikishlar soni", value: records.length, tone: "amber" },
              { label: "Jami daqiqa", value: records.reduce((s, a) => s + a.lateMinutes, 0), tone: "red" },
              { label: "Xodimlar", value: new Set(records.map((a) => a.employeeId)).size, tone: "blue" },
            ]
          : undefined,
        columns: [
          { header: "Sana", key: "date", type: "date", width: 12 },
          { header: "Xodim", key: "name", width: 26 },
          { header: "ID", key: "no", width: 11, align: "center" },
          { header: "Filial", key: "branch", width: 16 },
          { header: "Grafik", key: "plan", width: 13, align: "center" },
          { header: "Keldi", key: "in", width: 9, align: "center" },
          { header: "Ketdi", key: "out", width: 9, align: "center" },
          { header: "Holat", key: "status", width: 13, type: "status" },
          { header: "Kechikish (daq)", key: "late", type: "number", width: 13, total: "sum" },
          { header: "Erta ketish (daq)", key: "early", type: "number", width: 13, total: "sum" },
          { header: "Ishladi", key: "worked", type: "minutes", width: 11, total: "sum" },
          { header: "Masofa (m)", key: "distance", type: "number", width: 11 },
          { header: "Tasdiq", key: "verify", width: 24 },
          { header: "Izoh", key: "note", width: 28 },
        ],
        rows: records.map((a) => {
          const e = db.employees.find((x) => x.id === a.employeeId);
          return {
            date: a.date,
            name: name(e),
            no: e?.employeeNo,
            branch: lookup(db.branches, a.branchId),
            plan: `${a.scheduledStart}–${a.scheduledEnd}`,
            in: a.checkIn,
            out: a.checkOut,
            status: statusCell(a, today),
            late: a.lateMinutes || null,
            early: a.earlyLeaveMinutes || null,
            worked: a.workedMinutes || null,
            distance: a.distanceMeters ?? null,
            verify: a.verification.map((v) => verificationText[v] || v).join(", "),
            note: a.note,
          };
        }),
        emptyText: lateOnly ? "Bu davrda kechikish bo‘lmagan 🎉" : "Bu davrda davomat qaydlari yo‘q",
      });

      if (!lateOnly && employees.length)
        addTimesheetSheet(workbook, {
          title: "Tabel (xodim × kun)",
          subtitle,
          dates: days,
          rows: summary.map((x) => ({
            name: name(x.e),
            employeeNo: x.e.employeeNo,
            cells: x.statuses.map(({ code, tone, note }) => ({ code, tone, note })),
          })),
        });

      await sendWorkbook(
        res,
        workbook,
        `staffora-${lateOnly ? "kechikishlar" : "davomat"}-${from}_${to}.xlsx`,
      );
    }),
  );

  app.get(
    "/api/reports/payroll.xlsx",
    deps.requirePermission("reports.export"),
    route(async (req, res) => {
      const db = await readDb();
      const tenant = deps.companyId(req);
      const month = monthSchema.parse(String(req.query.month || tashkentIsoDate().slice(0, 7)));
      const company = db.companies.find((c) => c.id === tenant)?.name || "Kompaniya";
      const rows = payrollRows(db, tenant, month);
      const total = rows.reduce((s, r) => s + r.net, 0);
      const workbook = createWorkbook();
      addTableSheet(workbook, {
        name: "Ish haqi",
        title: `Ish haqi vedomosti — ${month.slice(5)}.${month.slice(0, 4)}`,
        subtitle: `${company}  ·  ${penaltyText(normalizePayrollSettings(db.companies.find((c) => c.id === tenant)?.payroll))}  ·  Tayyorlandi: ${stamp()}`,
        kpis: [
          { label: "Xodimlar", value: rows.length, tone: "blue" },
          { label: "Jami to‘lov (so‘m)", value: total.toLocaleString("ru-RU"), tone: "green" },
          { label: "Kechikish ushlanmasi (so‘m)", value: rows.reduce((s, r) => s + r.deduction, 0).toLocaleString("ru-RU"), tone: "amber" },
          { label: "O‘rtacha KPI", value: rows.length ? Math.round(rows.reduce((s, r) => s + r.kpi.score, 0) / rows.length) : 0, tone: "violet" },
        ],
        columns: [
          { header: "Xodim", key: "name", width: 24 },
          { header: "ID", key: "no", width: 10, align: "center" },
          { header: "Ish kuni", key: "days", type: "number", width: 9, total: "sum" },
          { header: "Kelmadi", key: "absent", type: "number", width: 9, total: "sum" },
          { header: "Kechikish (daq)", key: "late", type: "number", width: 12, total: "sum" },
          { header: "KPI", key: "kpi", type: "status", width: 9 },
          { header: "Bazaviy oylik", key: "base", type: "money", width: 16, total: "sum" },
          { header: "Qo‘shimcha ish", key: "overtime", type: "money", width: 15, total: "sum" },
          { header: "Ushlanma", key: "deduction", type: "money", width: 14, total: "sum" },
          { header: "To‘lanadi", key: "net", type: "money", width: 17, total: "sum" },
          { header: "Izoh", key: "why", width: 60 },
          { header: "Imzo", key: "sign", width: 12 },
        ],
        rows: rows.map((r) => ({
          name: `${r.employee.firstName} ${r.employee.lastName}`,
          no: r.employee.employeeNo,
          days: r.days,
          absent: r.absentDays || null,
          late: r.lateMinutes || null,
          kpi: {
            text: `${r.kpi.score} · ${r.kpi.grade}`,
            tone: r.kpi.score >= 90 ? "green" : r.kpi.score >= 75 ? "blue" : r.kpi.score >= 60 ? "amber" : "red",
          },
          base: r.base,
          overtime: r.overtimeAmount || null,
          deduction: r.deduction || null,
          net: r.net,
          why: r.explanation,
          sign: "",
        })),
      });
      await sendWorkbook(res, workbook, `staffora-ish-haqi-${month}.xlsx`);
    }),
  );

  app.get(
    "/api/reports/employees.xlsx",
    deps.requirePermission("reports.export"),
    route(async (req, res) => {
      const db = await readDb();
      const tenant = deps.companyId(req);
      const company = db.companies.find((c) => c.id === tenant)?.name || "Kompaniya";
      const employees = db.employees
        .filter((e) => e.companyId === tenant && e.status !== "ARCHIVED")
        .sort((a, b) => `${a.firstName}`.localeCompare(`${b.firstName}`));
      const workbook = createWorkbook();
      addTableSheet(workbook, {
        name: "Xodimlar",
        title: "Xodimlar ro‘yxati",
        subtitle: `${company}  ·  Tayyorlandi: ${stamp()}`,
        kpis: [
          { label: "Jami", value: employees.length, tone: "blue" },
          { label: "Telegram ulangan", value: employees.filter((e) => e.telegramConnected).length, tone: "green" },
          { label: "Face ID faol", value: employees.filter((e) => e.faceEnrolledAt).length, tone: "violet" },
        ],
        columns: [
          { header: "F.I.Sh.", key: "name", width: 26 },
          { header: "ID", key: "no", width: 11, align: "center" },
          { header: "Telefon", key: "phone", width: 17 },
          { header: "Filial", key: "branch", width: 16 },
          { header: "Bo‘lim", key: "department", width: 16 },
          { header: "Lavozim", key: "position", width: 18 },
          { header: "Grafik", key: "schedule", width: 16 },
          { header: "Ish boshlagan", key: "start", type: "date", width: 13 },
          { header: "Oylik", key: "salary", type: "money", width: 16, total: "sum" },
          { header: "Telegram", key: "telegram", type: "status", width: 12 },
          { header: "Face ID", key: "face", type: "status", width: 11 },
          { header: "Holat", key: "status", type: "status", width: 11 },
        ],
        rows: employees.map((e) => ({
          name: `${e.firstName} ${e.lastName}`,
          no: e.employeeNo,
          phone: e.phone,
          branch: db.branches.find((b) => b.id === e.branchId)?.name,
          department: db.departments.find((d) => d.id === e.departmentId)?.name,
          position: db.positions.find((p) => p.id === e.positionId)?.name,
          schedule: db.schedules.find((s) => s.id === e.scheduleId)?.name,
          start: e.startDate,
          salary: e.baseSalary,
          telegram: e.telegramConnected ? { text: "Ulangan", tone: "green" } : { text: "Yo‘q", tone: "gray" },
          face: e.faceEnrolledAt ? { text: "Faol", tone: "green" } : { text: "Yo‘q", tone: "gray" },
          status: e.status === "ACTIVE" ? { text: "Faol", tone: "green" } : { text: "Nofaol", tone: "amber" },
        })),
      });
      await sendWorkbook(res, workbook, "staffora-xodimlar.xlsx");
    }),
  );
}
