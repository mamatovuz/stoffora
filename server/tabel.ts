import ExcelJS from "exceljs";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { dataIndexes, readDb } from "../lib/store";
import { tashkentIsoDate } from "../lib/format";
import { dayPlan } from "../lib/schedule";
import type { Database, Employee, LeaveRequest } from "../lib/types";
import { closedPeriod, monthLabel } from "./payroll-routes";
import { payrollRows } from "./reports";
import { createWorkbook, sendWorkbook } from "./excel";

/*
 * Buxgalteriya uchun:
 *   1) T-13 shaklidagi ish vaqtini hisobga olish tabeli (Excel, chop etishga tayyor);
 *   2) 1C ga yuklash uchun fayllar (CSV, «;» ajratgich, UTF-8): ish haqi va tabel.
 *      1C:Зарплата и управление персоналом → «Загрузка данных из табличного документа»
 *      orqali ustunlar bir marta moslanadi, keyin har oy shu fayl yuklanadi.
 *
 * Belgilar (T-13 standarti): Я — ishda, РВ — dam olish kunida ishlagan, В — dam olish,
 * ОТ — mehnat ta’tili, Б — kasallik, ДО — ruxsat / haq to‘lanmaydigan, НН — sababsiz kelmagan.
 */

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);
const LEAVE_CODE: Record<LeaveRequest["type"], string> = { VACATION: "ОТ", SICK: "Б", PERMISSION: "ДО", UNPAID: "ДО", OTHER: "ДО" };
export const T13_LEGEND: [string, string][] = [
  ["Я", "Ishda (явка)"],
  ["РВ", "Dam olish kunida ishlagan"],
  ["В", "Dam olish kuni"],
  ["ОТ", "Mehnat ta’tili"],
  ["Б", "Kasallik"],
  ["ДО", "Ruxsat / haq to‘lanmaydigan"],
  ["НН", "Sababsiz kelmagan"],
];

export type T13Day = { code: string; hours: number };
export type T13Row = {
  employee: Employee;
  position: string;
  department: string;
  days: T13Day[];
  firstHalf: { days: number; hours: number };
  secondHalf: { days: number; hours: number };
  total: { days: number; hours: number };
  counts: Record<string, number>;
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const minutesBetween = (start: string, end: string) => {
  const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
  return Math.max(0, toMin(end) - toMin(start));
};

/** T-13 tabeli qatorlari (sof funksiya — test qilinadi). */
export function t13Rows(db: Database, tenant: string, month: string, today = tashkentIsoDate()): T13Row[] {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const index = dataIndexes(db);
  return db.employees
    .filter(
      (e) =>
        e.companyId === tenant &&
        (e.status === "ACTIVE" || (index.attendanceByEmployee.get(e.id) || []).some((a) => a.date.startsWith(month))) &&
        e.startDate <= `${month}-${String(daysInMonth).padStart(2, "0")}`,
    )
    .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo, undefined, { numeric: true }))
    .map((employee) => {
      const records = new Map((index.attendanceByEmployee.get(employee.id) || []).filter((a) => a.date.startsWith(month)).map((a) => [a.date, a]));
      const leaves = db.leaveRequests.filter((l) => l.employeeId === employee.id && l.status === "APPROVED");
      const days: T13Day[] = [];
      for (let d = 1; d <= daysInMonth; d += 1) {
        const date = `${month}-${String(d).padStart(2, "0")}`;
        if (date < employee.startDate || date > today || (employee.dismissedAt && date > employee.dismissedAt.slice(0, 10))) {
          days.push({ code: "", hours: 0 });
          continue;
        }
        const record = records.get(date);
        const plan = dayPlan(db, employee, date);
        if (record?.checkIn) {
          const minutes = record.workedMinutes || (record.checkOut ? minutesBetween(record.checkIn, record.checkOut) : plan.enabled ? minutesBetween(plan.start, plan.end) : 0);
          days.push({ code: plan.enabled ? "Я" : "РВ", hours: round1(minutes / 60) });
          continue;
        }
        const leave = leaves.find((l) => l.startDate <= date && l.endDate >= date);
        if (leave) days.push({ code: LEAVE_CODE[leave.type], hours: 0 });
        else if (!plan.enabled) days.push({ code: "В", hours: 0 });
        else if (date === today) days.push({ code: "", hours: 0 });
        else days.push({ code: "НН", hours: 0 });
      }
      const sum = (list: T13Day[]) => ({
        days: list.filter((x) => x.code === "Я" || x.code === "РВ").length,
        hours: round1(list.reduce((s, x) => s + x.hours, 0)),
      });
      const counts: Record<string, number> = {};
      for (const day of days) if (day.code) counts[day.code] = (counts[day.code] || 0) + 1;
      return {
        employee,
        position: db.positions.find((p) => p.id === employee.positionId)?.name || "",
        department: db.departments.find((x) => x.id === employee.departmentId)?.name || "",
        days,
        firstHalf: sum(days.slice(0, 15)),
        secondHalf: sum(days.slice(15)),
        total: sum(days),
        counts,
      };
    });
}

const csvCell = (value: unknown) => {
  const text = value === undefined || value === null ? "" : String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
export const toCsv = (rows: unknown[][]) => "﻿" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
const fio = (e: Employee) => `${e.lastName} ${e.firstName}`.trim();

/** 1C uchun ish haqi qatorlari (yopilgan oy bo‘lsa — muzlatilgan raqamlar). */
export function payrollCsvRows(db: Database, tenant: string, month: string) {
  const closed = closedPeriod(db, tenant, month);
  const live = payrollRows(db, tenant, month);
  const header = [
    "Tabel raqami", "F.I.Sh.", "Lavozim", "Bo‘lim", "Oklad",
    "Reja ish kunlari", "Ishlagan kunlar", "Ishlagan soat", "Kechikish (daq)", "Sababsiz kelmagan (kun)",
    "Qo‘shimcha ish", "Bonus", "Kechikish ushlanmasi", "Kelmaganlik ushlanmasi", "Jarima", "Avans", "Hisoblangan", "Qo‘lga",
  ];
  const ids = closed ? closed.lines.map((l) => l.employeeId) : live.map((r) => r.employee.id);
  const rows = ids.map((id) => {
    const employee = db.employees.find((e) => e.id === id);
    const line = closed?.lines.find((l) => l.employeeId === id);
    const row = live.find((r) => r.employee.id === id);
    const worked = (dataIndexes(db).attendanceByEmployee.get(id) || []).filter((a) => a.date.startsWith(month)).reduce((s, a) => s + a.workedMinutes, 0);
    const base = line?.base ?? row?.base ?? employee?.baseSalary ?? 0;
    const overtime = line?.overtimeAmount ?? row?.overtimeAmount ?? 0;
    const bonus = line?.bonus ?? row?.bonus ?? 0;
    const late = line?.lateDeduction ?? row?.deduction ?? 0;
    const absence = line?.absenceDeduction ?? row?.absenceDeduction ?? 0;
    const fine = line?.fine ?? row?.fine ?? 0;
    const advance = line?.advance ?? row?.advance ?? 0;
    const net = line?.net ?? row?.net ?? 0;
    return [
      line?.employeeNo ?? employee?.employeeNo ?? "",
      line?.name ?? (employee ? fio(employee) : ""),
      line?.position ?? db.positions.find((p) => p.id === employee?.positionId)?.name ?? "",
      db.departments.find((d) => d.id === employee?.departmentId)?.name ?? "",
      base,
      line?.expectedDays ?? row?.expectedDays ?? 0,
      line?.days ?? row?.days ?? 0,
      round1(worked / 60),
      line?.lateMinutes ?? row?.lateMinutes ?? 0,
      line?.absentDays ?? row?.absentDays ?? 0,
      overtime, bonus, late, absence, fine, advance,
      net + advance,
      net,
    ];
  });
  return [header, ...rows];
}

export function registerAccountingReports(
  app: Express,
  deps: { requirePermission: (permission: string) => RequestHandler; companyId: (req: Request) => string },
) {
  const route = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req, res)).catch(next);
  const monthOf = (req: Request) => monthSchema.parse(String(req.query.month || tashkentIsoDate().slice(0, 7)));

  app.get(
    "/api/reports/t13.xlsx",
    deps.requirePermission("reports.export"),
    route(async (req, res) => {
      const db = await readDb();
      const tenant = deps.companyId(req);
      const month = monthOf(req);
      const company = db.companies.find((c) => c.id === tenant)?.name || "Kompaniya";
      const rows = t13Rows(db, tenant, month);
      const workbook = createWorkbook();
      await buildT13Sheet(workbook, company, month, rows);
      await sendWorkbook(res, workbook, `tabel-T13-${month}.xlsx`);
    }),
  );
  app.get(
    "/api/reports/1c-payroll.csv",
    deps.requirePermission("reports.export"),
    route(async (req, res) => {
      const db = await readDb();
      const month = monthOf(req);
      res.type("text/csv; charset=utf-8").attachment(`1C-ish-haqi-${month}.csv`).send(toCsv(payrollCsvRows(db, deps.companyId(req), month)));
    }),
  );
  app.get(
    "/api/reports/1c-timesheet.csv",
    deps.requirePermission("reports.export"),
    route(async (req, res) => {
      const db = await readDb();
      const month = monthOf(req);
      const rows = t13Rows(db, deps.companyId(req), month);
      const count = rows[0]?.days.length || 31;
      const header = ["Tabel raqami", "F.I.Sh.", "Lavozim", ...Array.from({ length: count }, (_, i) => `${i + 1}`), "Kunlar", "Soatlar", "НН", "ОТ", "Б", "ДО"];
      const body = rows.map((r) => [
        r.employee.employeeNo,
        fio(r.employee),
        r.position,
        ...r.days.map((d) => (d.hours ? `${d.code} ${d.hours}` : d.code)),
        r.total.days,
        r.total.hours,
        r.counts["НН"] || 0,
        r.counts["ОТ"] || 0,
        r.counts["Б"] || 0,
        r.counts["ДО"] || 0,
      ]);
      res.type("text/csv; charset=utf-8").attachment(`1C-tabel-${month}.csv`).send(toCsv([header, ...body]));
    }),
  );
}

/* ------------------------------------------------- T-13 Excel varag‘i --- */
async function buildT13Sheet(workbook: ExcelJS.Workbook, company: string, month: string, rows: T13Row[]) {
  const sheet = workbook.addWorksheet("T-13 tabel", {
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    views: [{ state: "frozen", xSplit: 4, ySplit: 9 }],
  });
  const font = "Calibri";
  const thin = { style: "thin" as const, color: { argb: "FF94A3B8" } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const daysCount = rows[0]?.days.length || new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  // Ustunlar: № | F.I.Sh. | Tabel № | Lavozim | 1..15 | I yarim (kun/soat) | 16..N | Oy (kun/soat) | НН ОТ Б ДО
  const firstHalf = 15;
  const secondHalf = daysCount - 15;
  const col = {
    no: 1, name: 2, tab: 3, pos: 4,
    day: (d: number) => (d <= firstHalf ? 4 + d : 4 + firstHalf + 1 + (d - firstHalf)),
    half: 4 + firstHalf + 1,
    month: 4 + firstHalf + 1 + secondHalf + 1,
    codes: 4 + firstHalf + 1 + secondHalf + 2,
  };
  const codeCols = ["НН", "ОТ", "Б", "ДО"];
  const last = col.codes + codeCols.length - 1;
  sheet.columns = Array.from({ length: last }, (_, i) => {
    const c = i + 1;
    if (c === col.no) return { width: 4 };
    if (c === col.name) return { width: 26 };
    if (c === col.tab) return { width: 8 };
    if (c === col.pos) return { width: 16 };
    if (c === col.half || c === col.month) return { width: 8 };
    if (c >= col.codes) return { width: 5 };
    return { width: 4.6 };
  });

  const title = (r: number, text: string, size = 11, bold = false) => {
    sheet.mergeCells(r, 1, r, last);
    const cell = sheet.getCell(r, 1);
    cell.value = text;
    cell.font = { name: font, size, bold };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  };
  title(1, company, 12, true);
  title(2, "ISH VAQTINI HISOBGA OLISH TABELI (T-13 shakli)", 14, true);
  title(3, `Hisobot davri: ${monthLabel(month)}  ·  01.${month.slice(5, 7)}.${month.slice(0, 4)} — ${String(daysCount).padStart(2, "0")}.${month.slice(5, 7)}.${month.slice(0, 4)}`, 10);
  sheet.mergeCells(5, 1, 5, last);
  sheet.getCell(5, 1).value = `Belgilar: ${T13_LEGEND.map(([k, v]) => `${k} — ${v}`).join(";  ")}. Har kun uchun yuqorida belgi, pastda ishlangan soat.`;
  sheet.getCell(5, 1).font = { name: font, size: 8, italic: true, color: { argb: "FF475569" } };
  sheet.getCell(5, 1).alignment = { wrapText: true, vertical: "middle" };
  sheet.getRow(5).height = 26;

  // Sarlavha (7–9 qatorlar)
  const head = (r1: number, c1: number, r2: number, c2: number, text: string) => {
    if (r1 !== r2 || c1 !== c2) sheet.mergeCells(r1, c1, r2, c2);
    const cell = sheet.getCell(r1, c1);
    cell.value = text;
    cell.font = { name: font, size: 8, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    for (let r = r1; r <= r2; r += 1) for (let c = c1; c <= c2; c += 1) sheet.getCell(r, c).border = border;
  };
  head(7, col.no, 9, col.no, "№");
  head(7, col.name, 9, col.name, "Familiya, ism");
  head(7, col.tab, 9, col.tab, "Tabel raqami");
  head(7, col.pos, 9, col.pos, "Lavozim");
  head(7, col.day(1), 7, col.day(firstHalf), "Oyning kunlari bo‘yicha belgilar va soatlar");
  head(7, col.half, 8, col.half, "I yarim oy");
  head(7, col.day(firstHalf + 1), 7, col.day(daysCount), "");
  head(7, col.month, 8, col.month, "Oy bo‘yicha jami");
  head(7, col.codes, 8, col.codes + codeCols.length - 1, "Ishlamagan kunlar");
  for (let d = 1; d <= daysCount; d += 1) head(8, col.day(d), 9, col.day(d), String(d));
  head(9, col.half, 9, col.half, "kun / soat");
  head(9, col.month, 9, col.month, "kun / soat");
  codeCols.forEach((code, i) => head(9, col.codes + i, 9, col.codes + i, code));
  sheet.getRow(7).height = 22;

  const tone: Record<string, string> = { НН: "FFFEE2E2", В: "FFF1F5F9", ОТ: "FFEDE9FE", Б: "FFFFEDD5", ДО: "FFE0F2FE", РВ: "FFDCFCE7" };
  let r = 10;
  rows.forEach((row, i) => {
    const top = r;
    const bottom = r + 1;
    const put = (rr: number, c: number, value: string | number, opts: { bold?: boolean; fillColor?: string; align?: "center" | "left" } = {}) => {
      const cell = sheet.getCell(rr, c);
      cell.value = value === "" ? null : value;
      cell.font = { name: font, size: 8, bold: opts.bold };
      cell.alignment = { horizontal: opts.align || "center", vertical: "middle" };
      cell.border = border;
      if (opts.fillColor) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fillColor } };
    };
    const merged = (c: number, value: string | number, align: "center" | "left" = "center") => {
      sheet.mergeCells(top, c, bottom, c);
      put(top, c, value, { align });
      sheet.getCell(bottom, c).border = border;
    };
    merged(col.no, i + 1);
    merged(col.name, fio(row.employee), "left");
    merged(col.tab, row.employee.employeeNo);
    merged(col.pos, row.position, "left");
    row.days.forEach((day, d) => {
      const c = col.day(d + 1);
      put(top, c, day.code, { fillColor: tone[day.code] });
      put(bottom, c, day.hours || "", { fillColor: tone[day.code] });
    });
    put(top, col.half, row.firstHalf.days, { bold: true });
    put(bottom, col.half, row.firstHalf.hours, { bold: true });
    put(top, col.month, row.total.days, { bold: true, fillColor: "FFEFF6FF" });
    put(bottom, col.month, row.total.hours, { bold: true, fillColor: "FFEFF6FF" });
    codeCols.forEach((code, k) => merged(col.codes + k, row.counts[code] || ""));
    r += 2;
  });
  // Jami
  sheet.mergeCells(r, 1, r, col.pos);
  const totalCell = sheet.getCell(r, 1);
  totalCell.value = `Jami: ${rows.length} xodim`;
  totalCell.font = { name: font, size: 9, bold: true };
  const sumBy = (fn: (row: T13Row) => number) => round1(rows.reduce((s, x) => s + fn(x), 0));
  sheet.getCell(r, col.month).value = `${sumBy((x) => x.total.days)} / ${sumBy((x) => x.total.hours)}`;
  sheet.getCell(r, col.month).font = { name: font, size: 8, bold: true };
  r += 3;
  for (const label of ["Mas’ul shaxs (tabelchi)", "Bo‘lim rahbari", "Kadrlar bo‘limi xodimi"]) {
    sheet.getCell(r, col.name).value = label;
    sheet.getCell(r, col.name).font = { name: font, size: 9 };
    sheet.mergeCells(r, col.day(3), r, col.day(10));
    sheet.getCell(r, col.day(3)).border = { bottom: thin };
    sheet.getCell(r, col.day(11)).value = "(imzo)";
    sheet.getCell(r, col.day(11)).font = { name: font, size: 7, color: { argb: "FF94A3B8" } };
    r += 2;
  }
  sheet.getCell(r + 1, col.name).value = `Staffora · ${new Date().toISOString().slice(0, 10)}`;
  sheet.getCell(r + 1, col.name).font = { name: font, size: 7, color: { argb: "FF94A3B8" } };
}
