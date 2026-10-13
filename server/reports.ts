import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { dataIndexes, readDb } from "../lib/store";
import { duration, dateParts, tashkentIsoDate } from "../lib/format";
import type { Attendance, Database, Employee } from "../lib/types";
import { attendanceKpi, calculatePayroll, normalizePayrollSettings } from "../lib/payroll";
import { monthLabel } from "./payroll-routes";
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

/** Oy davomida ishdan bo‘shagan xodim (shu oy uchun yakuniy hisob-kitob qaydnomaga kiradi). */
export const leftDuringMonth = (e: Employee, month: string) =>
  e.status === "DISMISSED" && Boolean(e.dismissedAt) && e.dismissedAt!.slice(0, 7) === month;

/**
 * Oylik qaydnoma qatorlari: faol xodimlar va shu oyda ishdan bo‘shaganlar.
 * Bo‘shagan xodim oyligi bo‘shagan kunigacha bo‘lgan ish kunlariga proporsional; bo‘shatishda
 * qo‘lda to‘langan summa (SETTLEMENT) oy oxiridagi to‘lovdan ayriladi.
 */
export function payrollRows(db: Database, tenant: string, month: string) {
  return db.employees
    .filter((e) => e.companyId === tenant && (e.status === "ACTIVE" || leftDuringMonth(e, month)))
    .map((e) => employeePayrollRow(db, e, month));
}

/** Bitta xodimning oylik hisobi. asIfLeftOn — «shu sanada bo‘shasa» (yakuniy hisobni oldindan ko‘rish). */
export function employeePayrollRow(db: Database, e: Employee, month: string, asIfLeftOn?: string) {
  const tenant = e.companyId;
  const company = db.companies.find((c) => c.id === tenant);
  const settings = normalizePayrollSettings(company?.payroll);
  const today = tashkentIsoDate();
  const [y, m] = month.split("-").map(Number);
  const monthEnd = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const leftOn = asIfLeftOn || (leftDuringMonth(e, month) ? e.dismissedAt!.slice(0, 10) : undefined);
  let lastDay = monthEnd < today ? monthEnd : today;
  if (leftOn && leftOn < lastDay) lastDay = leftOn;
  const days = `${month}-01` <= lastDay ? datesBetween(`${month}-01`, lastDay) : [];
  const index = dataIndexes(db);
  // Kutilayotgan yoki rad etilgan jarimalar oylikka ta’sir qilmaydi.
  const own = db.payrollAdjustments.filter(
    (a) => a.companyId === tenant && a.month === month && a.employeeId === e.id && (!a.status || a.status === "APPROVED"),
  );
  const rows = (index.attendanceByEmployee.get(e.id) || []).filter((x) => x.date.startsWith(month) && x.date <= lastDay);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const statuses = days.map((d) => dayStatus(db, e, d, today, byDate.get(d)));
  const expectedDays = statuses.filter((s) => ["present", "late", "absent"].includes(s.kind)).length;
  const sum = (type: string) => own.filter((a) => a.type === type).reduce((s, a) => s + a.amount, 0);
  const absent = statuses.filter((s) => s.kind === "absent").length;
  // Kompensatsiya: sababsiz kelmagan kun shu oydagi dam olish kunida ishlab qoplanadi.
  // Qoplash uchun ishlatilgan dam kunidagi ish qo‘shimcha ish sifatida to‘lanmaydi.
  const restWorked = settings.absenceCompensation
    ? rows.filter((r) => r.checkIn && r.date <= lastDay && !isPracticeDay(r.date, company, e) && !dayPlan(db, e, r.date).enabled).sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const compensatedDays = Math.min(absent, restWorked.length);
  const used = new Set(restWorked.slice(0, compensatedDays).map((r) => r.id));
  const payable = used.size ? rows.map((r) => (used.has(r.id) ? { ...r, overtimeMinutes: 0 } : r)) : rows;

  // Oy o‘rtasida bo‘shagan: oylik — oy boshidan (yoki ishga kirgan kundan) bo‘shagan kungacha
  // rejadagi ish kunlariga proporsional. Kunlik stavka to‘liq oydagidek qoladi.
  const monthWorkingDays = workingDaysInMonth(db, e, month);
  let base = e.baseSalary;
  let workingDays = monthWorkingDays;
  let leaver: { leftOn: string; plannedDays: number; monthWorkingDays: number; paidAtDismissal: number } | undefined;
  if (leftOn) {
    const from = e.startDate > `${month}-01` ? e.startDate : `${month}-01`;
    const plannedDays = from <= leftOn ? datesBetween(from, leftOn).filter((d) => dayPlan(db, e, d).enabled).length : 0;
    base = monthWorkingDays ? Math.round((e.baseSalary * Math.min(plannedDays, monthWorkingDays)) / monthWorkingDays) : 0;
    workingDays = plannedDays;
    leaver = { leftOn, plannedDays, monthWorkingDays, paidAtDismissal: sum("SETTLEMENT") };
  }
  // Hisoblash boshlanish sanasigacha bo‘lgan (mashq) kunlar oylikka ta’sir qilmaydi.
  const line = calculatePayroll(base, countedRecords(payable, company, e), settings, {
    absentDays: absent - compensatedDays,
    workingDays,
    bonus: sum("BONUS"),
    fine: sum("FINE"),
    // Bo‘shatishda qo‘lda to‘langan yakuniy hisob — avans kabi oy oxiridagi to‘lovdan ayriladi.
    advance: sum("ADVANCE") + sum("SETTLEMENT"),
  });
  const kpi = attendanceKpi({ expectedDays, presentDays: line.days, lateDays: line.lateDays });
  const notes = [line.explanation];
  if (compensatedDays) notes.push(`${compensatedDays} kun kelmaslik dam olish kunida ishlab qoplandi.`);
  if (leaver) {
    notes.unshift(
      `Ishdan bo‘shagan: ${leaver.leftOn.split("-").reverse().join(".")} — oylik ${leaver.plannedDays} / ${leaver.monthWorkingDays} ish kuniga proporsional.`,
    );
    if (leaver.paidAtDismissal) notes.push(`Bo‘shatishda ${leaver.paidAtDismissal.toLocaleString("ru-RU")} so‘m qo‘lda to‘langan.`);
  }
  return {
    employee: e,
    ...line,
    // absentDays — ushlanadigan (qoplanmagan) kunlar; absentTotal — haqiqiy kelmagan kunlar.
    explanation: notes.join(" "),
    absentTotal: absent,
    compensatedDays,
    compensatedDates: restWorked.slice(0, compensatedDays).map((r) => r.date),
    expectedDays,
    adjustments: own,
    kpi,
    leaver,
  };
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

/** Bitta xodimning bitta kundagi holati (tabel va tahlil uchun). */
export function dayStatus(db: Database, employee: Employee, date: string, today: string, record?: Attendance): DayCode {
  if (date < employee.startDate || date > today) return { code: "", tone: "gray", kind: "none" };
  const company = db.companies.find((c) => c.id === employee.companyId);
  if (isPracticeDay(date, company, employee))
    return record?.checkIn
      ? { code: "M", tone: "gray", note: `${record.checkIn} → ${record.checkOut || "…"} (mashq — hisoblanmaydi)`, kind: "practice" }
      : { code: "", tone: "gray", note: "Mashq davri", kind: "practice" };
  if (record?.checkIn) {
    const note = `${record.checkIn} → ${record.checkOut || "…"}${record.lateMinutes ? ` · ${duration(record.lateMinutes)} kech` : ""}`;
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

/** Davomat hisoboti (Xulosa, Batafsil, Tabel). Saytdan yuklash va avtomatik jo‘natish uchun bir xil. */
export function buildAttendanceWorkbook(
  db: Database,
  tenant: string,
  options: { from: string; to: string; today?: string; lateOnly?: boolean; branches?: Set<string> | null },
) {
  const { from, to, lateOnly = false, branches = null } = options;
  const today = options.today || tashkentIsoDate();
  const days = datesBetween(from, to);
  const company = db.companies.find((c) => c.id === tenant)?.name || "Kompaniya";
  const employees = db.employees
    .filter(
      (e) =>
        e.companyId === tenant &&
        (e.status === "ACTIVE" ||
          (dataIndexes(db).attendanceByEmployee.get(e.id) || []).some((a) => a.date >= from && a.date <= to)) &&
        (!branches || branches.has(e.branchId)),
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
        { header: "Kechikish (vaqt)", key: "lateMinutes", type: "duration", width: 15, total: "sum" },
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
          { label: "Jami kechikish", value: records.reduce((s, a) => s + a.lateMinutes, 0), tone: "red", type: "duration" },
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
      { header: "Kechikish", key: "late", type: "duration", width: 15, total: "sum" },
      { header: "Erta ketish", key: "early", type: "duration", width: 15, total: "sum" },
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
  return workbook;
}

/** Ish haqi qaydnomasi (Excel). branches — faqat shu filiallar (filial rahbariga jo‘natish uchun). */
export function buildPayrollWorkbook(db: Database, tenant: string, month: string, branches: Set<string> | null = null) {
  const company = db.companies.find((c) => c.id === tenant)?.name || "Kompaniya";
  const rows = payrollRows(db, tenant, month).filter((r) => !branches || branches.has(r.employee.branchId));
  const total = rows.reduce((s, r) => s + r.net, 0);
  const settings = normalizePayrollSettings(db.companies.find((c) => c.id === tenant)?.payroll);
  const sumOf = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const lookup = <T extends { id: string; name: string }>(list: T[], id?: string) => list.find((x) => x.id === id)?.name || "";
  const workbook = createWorkbook();
  addTableSheet(workbook, {
    name: "Ish haqi qaydnomasi",
    title: `Ish haqi qaydnomasi — ${monthLabel(month)}`,
    subtitle: `${company}  ·  ${penaltyText(settings)}  ·  Tayyorlandi: ${stamp()}`,
    kpis: [
      { label: "Xodimlar", value: rows.length, tone: "blue" },
      { label: "Hisoblangan", value: sumOf((r) => r.gross), tone: "violet", type: "money" },
      { label: "Ushlanmalar", value: sumOf((r) => r.deduction + r.absenceDeduction + r.fine), tone: "amber", type: "money" },
      { label: "Qo‘lga beriladi", value: total, tone: "green", type: "money" },
    ],
    columns: [
      { header: "№", key: "n", width: 5, align: "center" },
      { header: "F.I.Sh.", key: "name", width: 26 },
      { header: "Tabel №", key: "no", width: 9, align: "center" },
      { header: "Filial", key: "branch", width: 15 },
      { header: "Lavozim", key: "position", width: 16 },
      { header: "Ish kuni", key: "days", type: "number", width: 8, total: "sum" },
      { header: "Kelmadi", key: "absent", type: "number", width: 8, total: "sum" },
      { header: "Kechikish", key: "late", type: "duration", width: 14, total: "sum" },
      { header: "Oklad", key: "base", type: "money", width: 15, total: "sum" },
      { header: "Qo‘shimcha ish", key: "overtime", type: "money", width: 14, total: "sum" },
      { header: "Mukofot", key: "bonus", type: "money", width: 13, total: "sum" },
      { header: "Kechikish ushlanmasi", key: "deduction", type: "money", width: 14, total: "sum" },
      { header: "Kelmaganlik ushlanmasi", key: "absence", type: "money", width: 14, total: "sum" },
      { header: "Jarima", key: "fine", type: "money", width: 13, total: "sum" },
      { header: "Hisoblangan", key: "gross", type: "money", width: 15, total: "sum" },
      { header: "Avans", key: "advance", type: "money", width: 13, total: "sum" },
      { header: "Bo‘shatishda to‘langan", key: "settled", type: "money", width: 15, total: "sum" },
      { header: "Qo‘lga beriladi", key: "net", type: "money", width: 16, total: "sum" },
      { header: "KPI", key: "kpi", type: "status", width: 9 },
      { header: "Imzo", key: "sign", width: 13 },
      { header: "Izoh", key: "why", width: 54, wrap: true },
    ],
    rows: rows.map((r, i) => ({
      n: i + 1,
      name: `${r.employee.lastName} ${r.employee.firstName}`.trim() + (r.leaver ? " (bo‘shagan)" : ""),
      no: r.employee.employeeNo,
      branch: lookup(db.branches, r.employee.branchId),
      position: lookup(db.positions, r.employee.positionId),
      days: r.days,
      absent: r.absentDays || null,
      late: r.lateMinutes || null,
      base: r.base,
      overtime: r.overtimeAmount || null,
      bonus: r.bonus || null,
      deduction: r.deduction || null,
      absence: r.absenceDeduction || null,
      fine: r.fine || null,
      gross: r.gross,
      advance: r.advance - (r.leaver?.paidAtDismissal || 0) || null,
      settled: r.leaver?.paidAtDismissal || null,
      net: r.net,
      kpi: {
        text: `${r.kpi.score} · ${r.kpi.grade}`,
        tone: r.kpi.score >= 90 ? "green" : r.kpi.score >= 75 ? "blue" : r.kpi.score >= 60 ? "amber" : "red",
      },
      sign: "",
      why: r.explanation,
    })),
    totalsLabel: "JAMI",
    emptyText: "Faol xodimlar yo‘q",
    notes: [
      "Hisoblangan = oklad + qo‘shimcha ish + mukofot − kechikish va kelmaganlik ushlanmalari − jarima. Qo‘lga beriladi = hisoblangan − avans.",
      "Rad etilgan yoki tasdiq kutayotgan jarimalar hisobga kirmaydi.",
    ],
    signatures: ["Tuzdi (hisobchi)", "Bosh hisobchi", "Rahbar"],
  });
  return workbook;
}

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
      const { from, to, today } = period(req);
      const lateOnly = req.query.type === "late";
      const branch = req.query.branch ? String(req.query.branch) : "";
      const workbook = buildAttendanceWorkbook(db, tenant, { from, to, today, lateOnly, branches: branch ? new Set([branch]) : null });
      await sendWorkbook(
        res,
        workbook,
        `staffora-${lateOnly ? "kechikishlar" : "davomat"}-${from}_${to}.xlsx`,
      );
    }),
  );

  app.get(
    "/api/reports/payroll.xlsx",
    deps.requirePermission("payroll.view"),
    route(async (req, res) => {
      const db = await readDb();
      const tenant = deps.companyId(req);
      const month = monthSchema.parse(String(req.query.month || tashkentIsoDate().slice(0, 7)));
      const workbook = buildPayrollWorkbook(db, tenant, month);
      await sendWorkbook(res, workbook, `staffora-ish-haqi-qaydnomasi-${month}.xlsx`);
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
