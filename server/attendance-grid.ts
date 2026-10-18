import type ExcelJS from "exceljs";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { readDb } from "../lib/store";
import { duration, tashkentClock, tashkentIsoDate } from "../lib/format";
import { holidayFor } from "../lib/schedule";
import type { Database, Employee } from "../lib/types";
import { createWorkbook, drawHeader, fill, palette, sendWorkbook, tones, type Tone } from "./excel";
import { monthPlan, type DayState } from "./month-plan";
import { monthLabel } from "./payroll-routes";

/*
 * Umumiy tabel (Verifix’dagidek): barcha xodimlar × oy kunlari bitta jadvalda.
 * Har katakda — keldi/ketdi vaqti va holati (vaqtida, kechikdi, kelmadi, ta’til, dam…),
 * o‘ngda — oy bo‘yicha jami. Kun holati xodim kalendari bilan bir manbadan (monthPlan → historyMonth).
 * Ekranda ham, Excel’da ham bir xil ma’lumot.
 */

export type GridCell = {
  date: string;
  state: DayState;
  in?: string;
  out?: string;
  late: number;
  early: number;
  worked: number;
  /** Grafik bo‘yicha reja (ish kuni bo‘lsa). */
  plan?: string;
  leave?: string;
  reason?: string;
  manual: boolean;
  recordId?: string;
};
export type GridRow = {
  employee: { id: string; name: string; employeeNo: string; photo?: string; branchId: string };
  branch: string;
  position: string;
  cells: GridCell[];
  totals: { present: number; late: number; lateMinutes: number; early: number; absent: number; leave: number; workedMinutes: number; plannedMinutes: number };
};

const MONTH = /^\d{4}-\d{2}$/;
const fullName = (e: Employee) => `${e.firstName} ${e.lastName}`.trim();

export function attendanceGrid(
  db: Database,
  tenant: string,
  month: string,
  options: { scope?: Set<string> | null; branchId?: string; today?: string; clock?: string } = {},
) {
  const today = options.today || tashkentIsoDate();
  const clock = options.clock || tashkentClock();
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthEnd = `${month}-${String(last).padStart(2, "0")}`;
  const hasRecords = new Set(db.attendance.filter((a) => a.companyId === tenant && a.date.startsWith(month)).map((a) => a.employeeId));
  const branchName = new Map(db.branches.filter((b) => b.companyId === tenant).map((b) => [b.id, b.name]));
  const positionName = new Map(db.positions.filter((p) => p.companyId === tenant).map((p) => [p.id, p.name]));
  const employees = db.employees.filter(
    (e) =>
      e.companyId === tenant &&
      (e.status === "ACTIVE" || hasRecords.has(e.id)) &&
      (!e.startDate || e.startDate <= monthEnd) &&
      (!options.scope || options.scope.has(e.branchId)) &&
      (!options.branchId || e.branchId === options.branchId),
  );
  const rows: GridRow[] = employees
    .map((employee) => {
      const plan = monthPlan(db, employee, month, today, clock);
      const cells: GridCell[] = plan.days.map((d) => ({
        date: d.date,
        state: d.state,
        in: d.checkIn,
        out: d.checkOut,
        late: d.lateMinutes,
        early: d.earlyLeaveMinutes,
        worked: d.workedMinutes,
        plan: d.working ? `${d.start}–${d.end}` : undefined,
        leave: d.leave,
        reason: d.reason,
        manual: d.manual,
        recordId: d.recordId,
      }));
      const counted = cells.filter((c) => c.date <= today);
      return {
        employee: { id: employee.id, name: fullName(employee), employeeNo: employee.employeeNo, photo: employee.photoDataUrl, branchId: employee.branchId },
        branch: branchName.get(employee.branchId) || "",
        position: positionName.get(employee.positionId) || "",
        cells,
        totals: {
          present: counted.filter((c) => c.in).length,
          late: counted.filter((c) => c.late > 0).length,
          lateMinutes: counted.reduce((s, c) => s + c.late, 0),
          early: counted.filter((c) => c.early > 0).length,
          absent: counted.filter((c) => c.state === "ABSENT").length,
          leave: cells.filter((c) => c.state === "LEAVE").length,
          workedMinutes: counted.reduce((s, c) => s + c.worked, 0),
          plannedMinutes: plan.totals.plannedMinutes,
        },
      };
    })
    .sort((a, b) => a.branch.localeCompare(b.branch) || a.employee.name.localeCompare(b.employee.name));
  const company = db.companies.find((c) => c.id === tenant);
  const dates = Array.from({ length: last }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    return { date, weekday: new Date(`${date}T12:00:00Z`).getUTCDay(), holiday: holidayFor(db, { companyId: tenant }, date)?.title };
  });
  return { month, label: monthLabel(month), today, company: company?.name || "", dates, rows };
}

/* ------------------------------------------------------------- Excel --- */
const FONT = "Calibri";
const STATE_TONE: Record<DayState, Tone | null> = {
  ON_TIME: "green",
  LATE: "amber",
  IN: "green",
  NO_CHECKOUT: "blue",
  ABSENT: "red",
  LEAVE: "violet",
  REST: "gray",
  REST_WORKED: "green",
  PLANNED: null,
  BEFORE_START: null,
};
const LEAVE_SHORT: Record<string, string> = { VACATION: "Ta’til", SICK: "Kasal", PERMISSION: "Ruxsat", UNPAID: "O‘z hisob.", OTHER: "Ta’til" };

/** Bitta katak matni: «09:05\n18:00», «Kelmadi», «Ta’til», «Dam». */
export function cellText(c: GridCell) {
  if (c.in) return `${c.in}\n${c.out || (c.state === "IN" ? "…" : "—")}`;
  if (c.state === "ABSENT") return "Kelmadi";
  if (c.state === "LEAVE") return LEAVE_SHORT[c.leave || ""] || "Ta’til";
  if (c.state === "REST") return "Dam";
  return "";
}

export function buildGridWorkbook(grid: ReturnType<typeof attendanceGrid>, branch?: string) {
  const workbook = createWorkbook();
  const sheet = workbook.addWorksheet("Tabel", {
    properties: { tabColor: { argb: tones.green.edge } },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L&8&K64748BStaffora · Tabel ${grid.label}&R&8&K64748B&P / &N` },
  });
  const days = grid.dates.length;
  const sums = ["Keldi", "Kech", "Kech vaqti", "Kelmadi", "Ishladi"];
  const span = 3 + days + sums.length;
  const all = grid.rows.reduce(
    (acc, r) => ({ present: acc.present + r.totals.present, late: acc.late + r.totals.late, absent: acc.absent + r.totals.absent, worked: acc.worked + r.totals.workedMinutes }),
    { present: 0, late: 0, absent: 0, worked: 0 },
  );
  const start = drawHeader(sheet, span, `Tabel — ${grid.label}`, `${grid.company}${branch ? ` · ${branch}` : ""} · ${grid.rows.length} xodim · har katakda: keldi / ketdi`, [
    { label: "Kelgan kunlar", value: all.present, tone: "green" },
    { label: "Kechikishlar", value: all.late, tone: "amber" },
    { label: "Kelmagan kunlar", value: all.absent, tone: "red" },
    { label: "Ishlangan vaqt", value: all.worked, tone: "blue", type: "duration" },
  ]);
  sheet.getColumn(1).width = 26;
  sheet.getColumn(2).width = 9;
  sheet.getColumn(3).width = 14;
  for (let i = 0; i < days; i += 1) sheet.getColumn(4 + i).width = 6.4;
  [7, 7, 10, 8, 10].forEach((w, i) => (sheet.getColumn(4 + days + i).width = w));

  const weekdays = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
  const thin = { style: "thin" as const, color: { argb: palette.line } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const head = sheet.getRow(start);
  const head2 = sheet.getRow(start + 1);
  ["Xodim", "ID", "Filial", ...grid.dates.map((d) => String(Number(d.date.slice(8)))), ...sums].forEach((text, i) => {
    const date = grid.dates[i - 3];
    const off = date && (date.weekday === 0 || Boolean(date.holiday));
    const cell = head.getCell(i + 1);
    cell.value = text;
    cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: palette.white } };
    cell.fill = fill(off ? "FF3B4F8F" : palette.navy);
    cell.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle", indent: i === 0 ? 1 : 0, wrapText: true };
    cell.border = { left: { style: "thin", color: { argb: "FF33488F" } }, right: { style: "thin", color: { argb: "FF33488F" } } };
    const sub = head2.getCell(i + 1);
    sub.value = date ? weekdays[date.weekday] : "";
    sub.font = { name: FONT, size: 8, bold: off, color: { argb: off ? tones.red.font : palette.muted } };
    sub.fill = fill(palette.soft);
    sub.alignment = { horizontal: "center", vertical: "middle" };
    sub.border = { bottom: { style: "thin", color: { argb: palette.lineStrong } }, left: thin, right: thin };
  });
  head.height = 24;
  head2.height = 14;
  sheet.views = [{ state: "frozen", xSplit: 3, ySplit: start + 1, showGridLines: false }];
  sheet.pageSetup.printTitlesRow = `${start}:${start + 1}`;

  grid.rows.forEach((row, index) => {
    const r = sheet.getRow(start + 2 + index);
    r.height = 30;
    const zebra = index % 2 ? palette.zebra : palette.white;
    const text = (c: number, value: string, opts: Partial<ExcelJS.Font> = {}, align: "left" | "center" = "left") => {
      const cell = r.getCell(c);
      cell.value = value;
      cell.font = { name: FONT, size: 9.5, color: { argb: palette.ink }, ...opts };
      cell.alignment = { vertical: "middle", horizontal: align, indent: align === "left" ? 1 : 0, wrapText: true };
      cell.fill = fill(zebra);
      cell.border = border;
    };
    text(1, row.employee.name, { bold: true });
    text(2, row.employee.employeeNo, { size: 8.5, color: { argb: palette.muted } }, "center");
    text(3, row.branch, { size: 8.5, color: { argb: palette.ink2 } });
    row.cells.forEach((c, i) => {
      const cell = r.getCell(4 + i);
      const toneName = STATE_TONE[c.state];
      const tone = toneName ? tones[toneName] : null;
      cell.value = cellText(c) || null;
      cell.font = { name: FONT, size: 8, bold: c.state === "ABSENT", color: { argb: tone ? tone.font : palette.faint } };
      cell.fill = fill(tone ? tone.fill : zebra);
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = border;
      const notes = [
        c.plan ? `Grafik: ${c.plan}` : "",
        c.late ? `Kechikdi: ${duration(c.late)}` : "",
        c.early ? `Erta ketdi: ${duration(c.early)}` : "",
        c.worked ? `Ishladi: ${duration(c.worked)}` : "",
        c.manual ? "Qo‘lda tahrirlangan" : "",
        c.reason || "",
      ].filter(Boolean);
      if (c.in && notes.length) cell.note = notes.join("\n");
    });
    const t = row.totals;
    const totals: [string | number, Tone | null][] = [
      [t.present || "—", t.present ? "green" : null],
      [t.late || "—", t.late ? "amber" : null],
      [t.lateMinutes ? duration(t.lateMinutes) : "—", t.lateMinutes ? "amber" : null],
      [t.absent || "—", t.absent ? "red" : null],
      [t.workedMinutes ? duration(t.workedMinutes) : "—", t.workedMinutes ? "blue" : null],
    ];
    totals.forEach(([value, toneName], i) => {
      const cell = r.getCell(4 + days + i);
      const tone = toneName ? tones[toneName] : null;
      cell.value = value;
      cell.font = { name: FONT, size: 9, bold: Boolean(tone), color: { argb: tone ? tone.font : palette.faint } };
      cell.fill = fill(tone ? tone.fill : zebra);
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = border;
    });
  });

  // Belgilar
  let legendRow = start + 3 + grid.rows.length;
  const caption = sheet.getCell(legendRow, 1);
  caption.value = "Belgilar:";
  caption.font = { name: FONT, size: 9.5, bold: true, color: { argb: palette.ink2 } };
  const legend: [string, Tone][] = [
    ["Vaqtida keldi (yuqorida — keldi, pastda — ketdi)", "green"],
    ["Kechikdi", "amber"],
    ["Ketish belgilanmagan", "blue"],
    ["Kelmadi", "red"],
    ["Ta’til / kasallik / ruxsat", "violet"],
    ["Dam olish kuni", "gray"],
  ];
  for (const [label, toneName] of legend) {
    legendRow += 1;
    const swatch = sheet.getCell(legendRow, 1);
    swatch.value = label;
    swatch.font = { name: FONT, size: 9, color: { argb: tones[toneName].font } };
    swatch.fill = fill(tones[toneName].fill);
    swatch.alignment = { indent: 1 };
  }
  legendRow += 2;
  const note = sheet.getCell(legendRow, 1);
  note.value = "Katakdagi izohda (sichqonchani olib boring) — grafik, kechikish, ishlangan vaqt va qo‘lda tahrirlangani.";
  note.font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.muted } };
  return workbook;
}

/* ------------------------------------------------------------ yo‘llar --- */
export function registerAttendanceGrid(
  app: Express,
  deps: {
    requirePermission: (permission: string) => RequestHandler;
    companyId: (req: Request) => string;
    branchScope: (req: Request, db: Database) => Set<string> | null;
  },
) {
  const route = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req, res)).catch(next);
  const params = (req: Request) =>
    z
      .object({ month: z.string().regex(MONTH, "Oy YYYY-MM ko‘rinishida bo‘lsin.").default(tashkentIsoDate().slice(0, 7)), branch: z.string().max(80).optional() })
      .parse({ month: req.query.month || undefined, branch: req.query.branch || undefined });

  app.get(
    "/api/attendance/grid",
    deps.requirePermission("attendance.view"),
    route(async (req, res) => {
      const db = await readDb();
      const { month, branch } = params(req);
      res.json(attendanceGrid(db, deps.companyId(req), month, { scope: deps.branchScope(req, db), branchId: branch }));
    }),
  );
  app.get(
    "/api/attendance/grid.xlsx",
    deps.requirePermission("attendance.view"),
    route(async (req, res) => {
      const db = await readDb();
      const { month, branch } = params(req);
      const tenant = deps.companyId(req);
      const grid = attendanceGrid(db, tenant, month, { scope: deps.branchScope(req, db), branchId: branch });
      const branchName = branch ? db.branches.find((b) => b.id === branch && b.companyId === tenant)?.name : undefined;
      await sendWorkbook(res, buildGridWorkbook(grid, branchName), `tabel-${month}${branchName ? `-${branchName.replace(/[^\p{L}\p{N}]+/gu, "-")}` : ""}.xlsx`);
    }),
  );
}
