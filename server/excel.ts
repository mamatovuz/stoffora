import ExcelJS from "exceljs";
import type { Response } from "express";

/* Staffora Excel uslubi — barcha hisobotlar bir xil, toza va chop etishga tayyor ko‘rinishda. */
export const palette = {
  brand: "FF2563EB",
  navy: "FF1E3A8A",
  ink: "FF0F172A",
  ink2: "FF334155",
  muted: "FF64748B",
  faint: "FFA3AEBD",
  line: "FFE2E8F0",
  lineStrong: "FFCBD5E1",
  zebra: "FFF8FAFC",
  soft: "FFF1F5F9",
  totalBg: "FFEFF4FF",
  white: "FFFFFFFF",
} as const;
const FONT = "Calibri";

export const tones = {
  green: { fill: "FFE3F4EC", font: "FF0F7A50", edge: "FF22A06B" },
  amber: { fill: "FFFDF1DC", font: "FF9A5800", edge: "FFE5962B" },
  red: { fill: "FFFCE7E7", font: "FFB42E30", edge: "FFE5484D" },
  blue: { fill: "FFE6EEFD", font: "FF1D4ED8", edge: "FF2563EB" },
  violet: { fill: "FFEFEAFD", font: "FF5B3FC4", edge: "FF8B5CF6" },
  gray: { fill: "FFF1F5F9", font: "FF475569", edge: "FF94A3B8" },
} as const;
export type Tone = keyof typeof tones;

export type Column = {
  header: string;
  key: string;
  width?: number;
  type?: "text" | "number" | "money" | "minutes" | "time" | "date" | "status" | "percent";
  align?: "left" | "center" | "right";
  total?: "sum" | "avg" | "count" | string;
  /** Uzun matn (izoh) — qatorga sig‘masa keyingi qatorga o‘tadi. */
  wrap?: boolean;
};
export type Cell = string | number | Date | null | undefined | { text: string; tone: Tone };
export type Row = Record<string, Cell>;
export type Kpi = { label: string; value: string | number; tone?: Tone; type?: "number" | "money" | "percent" };

const hair = { style: "hair" as const, color: { argb: palette.lineStrong } };
const thin = { style: "thin" as const, color: { argb: palette.line } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const rowBorder = { left: thin, right: thin, bottom: hair };

export function fill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}
export const colLetter = (index: number) => {
  let n = index;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export function createWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Staffora";
  workbook.company = "Staffora";
  workbook.created = new Date();
  return workbook;
}

export function numFmt(type?: Column["type"] | Kpi["type"]) {
  switch (type) {
    case "money":
      return '#,##0" so‘m"';
    case "minutes":
      return "[h]:mm";
    case "number":
      return "#,##0";
    case "percent":
      return "0%";
    case "date":
      return "dd.mm.yyyy";
    default:
      return "General";
  }
}

/**
 * Varaq tepasi: kichik brend satri, katta sarlavha, izoh va KPI kartochkalari.
 * Keyingi bo‘sh qator raqamini qaytaradi.
 */
function drawHeader(sheet: ExcelJS.Worksheet, span: number, title: string, subtitle: string, kpis: Kpi[] = []) {
  const width = Math.max(span, 4);
  const band = (row: number, value: string, font: Partial<ExcelJS.Font>, height: number) => {
    sheet.mergeCells(row, 1, row, width);
    const cell = sheet.getCell(row, 1);
    cell.value = value;
    cell.font = { name: FONT, ...font };
    cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    sheet.getRow(row).height = height;
  };
  band(1, "STAFFORA", { size: 9, bold: true, color: { argb: palette.brand } }, 18);
  band(2, title, { size: 18, bold: true, color: { argb: palette.ink } }, 30);
  band(3, subtitle, { size: 10, color: { argb: palette.muted } }, 18);
  // Sarlavha ostidagi brend chizig‘i
  for (let c = 1; c <= width; c += 1) sheet.getCell(3, c).border = { bottom: { style: "medium", color: { argb: palette.brand } } };

  if (!kpis.length) return 5;
  // Har bir KPI — bir nechta ustunni egallagan kartochka: chap chekkasi rangli, yuqorida qiymat, pastda nom.
  const per = Math.max(1, Math.floor(width / kpis.length));
  kpis.forEach((kpi, index) => {
    const from = index * per + 1;
    const to = index === kpis.length - 1 ? Math.max(from, Math.min(width, from + per - 1)) : from + per - 1;
    const tone = tones[kpi.tone || "gray"];
    if (to > from) {
      sheet.mergeCells(5, from, 5, to);
      sheet.mergeCells(6, from, 6, to);
    }
    for (let r = 5; r <= 6; r += 1)
      for (let c = from; c <= to; c += 1) {
        const cell = sheet.getCell(r, c);
        cell.fill = fill(tone.fill);
        cell.border = {
          top: r === 5 ? { style: "thin", color: { argb: palette.white } } : undefined,
          bottom: r === 6 ? { style: "thin", color: { argb: palette.white } } : undefined,
          left: c === from ? { style: "thick", color: { argb: tone.edge } } : undefined,
          right: c === to ? { style: "medium", color: { argb: palette.white } } : undefined,
        };
      }
    const value = sheet.getCell(5, from);
    value.value = kpi.value;
    if (typeof kpi.value === "number") value.numFmt = numFmt(kpi.type || "number");
    value.font = { name: FONT, size: 17, bold: true, color: { argb: tone.font } };
    value.alignment = { horizontal: "left", vertical: "bottom", indent: 1 };
    const label = sheet.getCell(6, from);
    label.value = kpi.label.toUpperCase();
    label.font = { name: FONT, size: 8.5, bold: true, color: { argb: palette.muted } };
    label.alignment = { horizontal: "left", vertical: "top", indent: 1 };
  });
  sheet.getRow(5).height = 30;
  sheet.getRow(6).height = 18;
  return 8;
}

/** Jadval ostiga imzo joylari: «Lavozim ________ (F.I.Sh.)». Keyingi bo‘sh qator raqamini qaytaradi. */
export function drawSignatures(sheet: ExcelJS.Worksheet, row: number, span: number, labels: string[], stampNote = true) {
  let r = row;
  const lineFrom = Math.min(3, span);
  const lineTo = Math.max(lineFrom, Math.min(span - 2, lineFrom + 3));
  for (const label of labels) {
    const name = sheet.getCell(r, 1);
    if (lineFrom > 2) sheet.mergeCells(r, 1, r, lineFrom - 1);
    name.value = label;
    name.font = { name: FONT, size: 10, bold: true, color: { argb: palette.ink2 } };
    name.alignment = { vertical: "bottom", indent: 1 };
    if (lineTo > lineFrom) sheet.mergeCells(r, lineFrom, r, lineTo);
    for (let c = lineFrom; c <= lineTo; c += 1) sheet.getCell(r, c).border = { bottom: { style: "thin", color: { argb: palette.ink2 } } };
    const hint = sheet.getCell(r + 1, lineFrom);
    hint.value = "(imzo, F.I.Sh.)";
    hint.font = { name: FONT, size: 8, italic: true, color: { argb: palette.faint } };
    hint.alignment = { horizontal: "center" };
    sheet.getRow(r).height = 24;
    r += 2;
  }
  if (stampNote) {
    const stamp = sheet.getCell(r, 1);
    stamp.value = "M.O‘.";
    stamp.font = { name: FONT, size: 10, bold: true, color: { argb: palette.faint } };
    stamp.alignment = { indent: 1 };
    r += 1;
  }
  return r + 1;
}

export function addTableSheet(
  workbook: ExcelJS.Workbook,
  options: {
    name: string;
    title: string;
    subtitle: string;
    columns: Column[];
    rows: Row[];
    kpis?: Kpi[];
    totalsLabel?: string;
    emptyText?: string;
    /** Jadval ostidagi imzo joylari (masalan qaydnomada). */
    signatures?: string[];
    /** Jadval ostidagi qisqa izohlar. */
    notes?: string[];
    tabColor?: string;
  },
) {
  const landscape = options.columns.length > 7;
  const sheet = workbook.addWorksheet(options.name.slice(0, 31), {
    properties: { tabColor: { argb: options.tabColor || palette.brand } },
    views: [{ state: "frozen", ySplit: 0, showGridLines: false }],
    pageSetup: {
      orientation: landscape ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.25 },
    },
    headerFooter: {
      oddFooter: `&L&8&K64748BStaffora · ${options.title.replace(/&/g, "&&")}&R&8&K64748B&P / &N`,
    },
  });
  const span = options.columns.length;
  const start = drawHeader(sheet, span, options.title, options.subtitle, options.kpis);
  options.columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width || 16;
  });

  const headerRow = sheet.getRow(start);
  options.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.white } };
    cell.fill = fill(palette.navy);
    cell.border = {
      top: { style: "thin", color: { argb: palette.navy } },
      bottom: { style: "thin", color: { argb: palette.navy } },
      left: { style: "thin", color: { argb: "FF33488F" } },
      right: { style: "thin", color: { argb: "FF33488F" } },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: column.align || (column.type && column.type !== "text" ? "center" : "left"),
      wrapText: true,
      indent: column.align === "left" || !column.type || column.type === "text" ? 1 : 0,
    };
  });
  headerRow.height = 32;
  sheet.views = [{ state: "frozen", ySplit: start, xSplit: 0, showGridLines: false }];
  // Chop etishda sarlavha qatori har sahifada takrorlanadi.
  sheet.pageSetup.printTitlesRow = `${start}:${start}`;

  if (!options.rows.length) {
    sheet.mergeCells(start + 1, 1, start + 1, span);
    const cell = sheet.getCell(start + 1, 1);
    cell.value = options.emptyText || "Tanlangan davr uchun ma’lumot yo‘q";
    cell.font = { name: FONT, size: 11, italic: true, color: { argb: palette.muted } };
    cell.fill = fill(palette.zebra);
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = border;
    sheet.getRow(start + 1).height = 36;
    return sheet;
  }

  options.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(start + 1 + rowIndex);
    excelRow.height = options.columns.some((c) => c.wrap) ? 30 : 21;
    options.columns.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1);
      writeCell(cell, row[column.key], column);
      cell.border = rowBorder;
      if (rowIndex % 2 === 1 && !cell.fill) cell.fill = fill(palette.zebra);
    });
  });

  const lastDataRow = start + options.rows.length;
  sheet.autoFilter = {
    from: { row: start, column: 1 },
    to: { row: lastDataRow, column: span },
  };
  let next = lastDataRow + 1;

  if (options.columns.some((c) => c.total)) {
    const totalRow = sheet.getRow(lastDataRow + 1);
    totalRow.height = 26;
    options.columns.forEach((column, index) => {
      const cell = totalRow.getCell(index + 1);
      const letter = colLetter(index + 1);
      const range = `${letter}${start + 1}:${letter}${lastDataRow}`;
      if (index === 0) cell.value = options.totalsLabel || "JAMI";
      else if (column.total === "sum") cell.value = { formula: `SUM(${range})` };
      else if (column.total === "avg") cell.value = { formula: `IFERROR(AVERAGE(${range}),0)` };
      else if (column.total === "count") cell.value = { formula: `COUNTA(${range})` };
      else if (column.total) cell.value = column.total;
      cell.numFmt = numFmt(column.type);
      cell.font = { name: FONT, size: 10.5, bold: true, color: { argb: palette.navy } };
      cell.fill = fill(palette.totalBg);
      cell.border = {
        top: { style: "medium", color: { argb: palette.brand } },
        bottom: { style: "double", color: { argb: palette.brand } },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: index === 0 ? "left" : column.align || (column.type && column.type !== "text" ? "center" : "left"),
        indent: index === 0 ? 1 : 0,
      };
    });
    next = lastDataRow + 2;
  }

  if (options.notes?.length) {
    next += 1;
    for (const note of options.notes) {
      sheet.mergeCells(next, 1, next, span);
      const cell = sheet.getCell(next, 1);
      cell.value = note;
      cell.font = { name: FONT, size: 9, italic: true, color: { argb: palette.muted } };
      cell.alignment = { wrapText: true, vertical: "top", indent: 1 };
      next += 1;
    }
  }
  if (options.signatures?.length) drawSignatures(sheet, next + 2, span, options.signatures);
  return sheet;
}

function writeCell(cell: ExcelJS.Cell, value: Cell, column: Column) {
  const align = column.align || (column.type && column.type !== "text" ? "center" : "left");
  cell.font = { name: FONT, size: 10.5, color: { argb: palette.ink } };
  cell.alignment = { vertical: "middle", horizontal: align, indent: align === "left" ? 1 : 0, wrapText: column.wrap };
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const tone = tones[value.tone];
    cell.value = value.text;
    cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: tone.font } };
    cell.fill = fill(tone.fill);
    cell.alignment = { vertical: "middle", horizontal: "center" };
    return;
  }
  if (value === null || value === undefined || value === "") {
    cell.value = column.type && column.type !== "text" ? "—" : "";
    cell.font = { name: FONT, size: 10.5, color: { argb: palette.faint } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    return;
  }
  if (column.type === "minutes" && typeof value === "number") {
    cell.value = value / 1440; // Excel vaqt birligi — kun
    cell.numFmt = "[h]:mm";
    return;
  }
  if (column.type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    cell.value = new Date(Date.UTC(y, m - 1, d));
    cell.numFmt = "dd.mm.yyyy";
    return;
  }
  cell.value = value;
  cell.numFmt = numFmt(column.type);
  if (column.type === "money" && typeof value === "number" && value < 0) cell.font = { ...cell.font, color: { argb: tones.red.font } };
}

/** Tabel: xodim × kun matritsasi, har bir katak rangli belgi bilan. */
export function addTimesheetSheet(
  workbook: ExcelJS.Workbook,
  options: {
    title: string;
    subtitle: string;
    dates: string[];
    rows: { name: string; employeeNo: string; cells: { code: string; tone: Tone; note?: string }[] }[];
  },
) {
  const sheet = workbook.addWorksheet("Tabel", {
    properties: { tabColor: { argb: tones.green.edge } },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L&8&K64748BStaffora · ${options.title.replace(/&/g, "&&")}&R&8&K64748B&P / &N` },
  });
  const span = options.dates.length + 5;
  const start = drawHeader(sheet, span, options.title, options.subtitle);
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 10;
  options.dates.forEach((_, i) => (sheet.getColumn(i + 3).width = 4.6));
  const sumCols = ["Keldi", "Kech", "Kelmadi"];
  sumCols.forEach((_, i) => (sheet.getColumn(options.dates.length + 3 + i).width = 8.5));

  const weekdays = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
  const weekdayOf = (date?: string) => (date ? new Date(`${date}T12:00:00Z`).getUTCDay() : -1);
  const head = sheet.getRow(start);
  const head2 = sheet.getRow(start + 1);
  const headers = ["Xodim", "ID", ...options.dates.map((d) => String(Number(d.slice(8)))), ...sumCols];
  headers.forEach((text, i) => {
    const date = options.dates[i - 2];
    const weekend = [0, 6].includes(weekdayOf(date));
    const cell = head.getCell(i + 1);
    cell.value = text;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.white } };
    cell.fill = fill(weekend ? "FF3B4F8F" : palette.navy);
    cell.border = { left: { style: "thin", color: { argb: "FF33488F" } }, right: { style: "thin", color: { argb: "FF33488F" } } };
    cell.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle", indent: i === 0 ? 1 : 0 };
    const sub = head2.getCell(i + 1);
    sub.value = date ? weekdays[weekdayOf(date)] : "";
    sub.font = { name: FONT, size: 8.5, bold: weekend, color: { argb: weekend ? tones.red.font : palette.muted } };
    sub.fill = fill(palette.soft);
    sub.border = { bottom: { style: "thin", color: { argb: palette.lineStrong } }, left: thin, right: thin };
    sub.alignment = { horizontal: "center", vertical: "middle" };
  });
  head.height = 26;
  head2.height = 16;
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: start + 1, showGridLines: false }];
  sheet.pageSetup.printTitlesRow = `${start}:${start + 1}`;

  options.rows.forEach((row, index) => {
    const r = sheet.getRow(start + 2 + index);
    r.height = 21;
    const zebra = index % 2 ? palette.zebra : palette.white;
    const name = r.getCell(1);
    name.value = row.name;
    name.font = { name: FONT, size: 10.5, bold: true, color: { argb: palette.ink } };
    name.alignment = { vertical: "middle", indent: 1 };
    const no = r.getCell(2);
    no.value = row.employeeNo;
    no.font = { name: FONT, size: 9.5, color: { argb: palette.muted } };
    no.alignment = { vertical: "middle", horizontal: "center" };
    [name, no].forEach((c) => {
      c.border = border;
      c.fill = fill(zebra);
    });
    row.cells.forEach((item, i) => {
      const cell = r.getCell(i + 3);
      const tone = tones[item.tone];
      const weekend = [0, 6].includes(weekdayOf(options.dates[i]));
      cell.value = item.code;
      cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: tone.font } };
      cell.fill = fill(item.code ? tone.fill : weekend ? palette.soft : zebra);
      cell.border = border;
      cell.alignment = { horizontal: "center", vertical: "middle" };
      if (item.note) cell.note = item.note;
    });
    const count = (codes: string[]) => row.cells.filter((c) => codes.includes(c.code)).length;
    [count(["✓", "K", "•"]), count(["K"]), count(["X"])].forEach((value, i) => {
      const cell = r.getCell(options.dates.length + 3 + i);
      cell.value = value || "—";
      const tone = tones[(["green", "amber", "red"] as Tone[])[i]];
      cell.font = { name: FONT, bold: true, color: { argb: value ? tone.font : palette.faint } };
      cell.fill = fill(value ? tone.fill : zebra);
      cell.border = border;
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
  });

  // Izoh (legend) — bir qatorda rangli belgilar
  const legendRow = start + 3 + options.rows.length;
  const caption = sheet.getCell(legendRow, 1);
  caption.value = "Belgilar:";
  caption.font = { name: FONT, size: 9.5, bold: true, color: { argb: palette.ink2 } };
  caption.alignment = { indent: 1 };
  const legend: [string, string, Tone][] = [
    ["✓", "Vaqtida keldi", "green"],
    ["K", "Kechikdi", "amber"],
    ["X", "Kelmadi", "red"],
    ["T", "Ta’til", "violet"],
    ["D", "Dam olish", "gray"],
    ["•", "Ketish belgilanmagan", "blue"],
    ["M", "Mashq davri (hisoblanmaydi)", "gray"],
  ];
  legend.forEach(([code, text, toneName], i) => {
    const tone = tones[toneName];
    const r = legendRow + 1 + i;
    const codeCell = sheet.getCell(r, 1);
    codeCell.value = code;
    codeCell.font = { name: FONT, size: 10, bold: true, color: { argb: tone.font } };
    codeCell.fill = fill(tone.fill);
    codeCell.alignment = { horizontal: "center" };
    codeCell.border = border;
    const textCell = sheet.getCell(r, 2);
    textCell.value = text;
    textCell.font = { name: FONT, size: 9.5, color: { argb: palette.ink2 } };
    textCell.alignment = { indent: 1 };
  });
  return sheet;
}

/** Bitta xodimning hisob varaqasi: chiroyli kartochka ko‘rinishida. */
export function addPayslipSheet(
  workbook: ExcelJS.Workbook,
  options: {
    company: string;
    period: string;
    employee: { name: string; no: string; position?: string };
    accruals: [string, number][];
    deductions: [string, number][];
    net: number;
    notes?: string[];
  },
) {
  const sheet = workbook.addWorksheet("Hisob varaqasi", {
    properties: { tabColor: { argb: palette.brand } },
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.6, right: 0.6, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
  });
  sheet.columns = [{ width: 3 }, { width: 38 }, { width: 22 }, { width: 3 }];
  const span = (r: number) => sheet.mergeCells(r, 2, r, 3);
  const put = (r: number, value: string, font: Partial<ExcelJS.Font>, height = 20) => {
    span(r);
    const cell = sheet.getCell(r, 2);
    cell.value = value;
    cell.font = { name: FONT, ...font };
    cell.alignment = { vertical: "middle" };
    sheet.getRow(r).height = height;
  };
  put(1, "STAFFORA", { size: 9, bold: true, color: { argb: palette.brand } }, 16);
  put(2, "Ish haqi hisob varaqasi", { size: 18, bold: true, color: { argb: palette.ink } }, 30);
  put(3, `${options.company}  ·  ${options.period}`, { size: 10.5, color: { argb: palette.muted } });
  for (const c of [2, 3]) sheet.getCell(3, c).border = { bottom: { style: "medium", color: { argb: palette.brand } } };

  let r = 5;
  const info: [string, string][] = [
    ["Xodim", options.employee.name],
    ["Tabel raqami", options.employee.no],
    ["Lavozim", options.employee.position || "—"],
  ];
  for (const [label, value] of info) {
    const a = sheet.getCell(r, 2);
    const b = sheet.getCell(r, 3);
    a.value = label;
    a.font = { name: FONT, size: 10, color: { argb: palette.muted } };
    b.value = value;
    b.font = { name: FONT, size: 10.5, bold: true, color: { argb: palette.ink } };
    b.alignment = { horizontal: "right" };
    sheet.getRow(r).height = 19;
    r += 1;
  }

  const section = (title: string, lines: [string, number][], tone: Tone, sign: 1 | -1) => {
    r += 1;
    span(r);
    const head = sheet.getCell(r, 2);
    head.value = title.toUpperCase();
    head.font = { name: FONT, size: 9, bold: true, color: { argb: tones[tone].font } };
    head.fill = fill(tones[tone].fill);
    head.alignment = { vertical: "middle", indent: 1 };
    sheet.getRow(r).height = 20;
    r += 1;
    for (const [label, value] of lines) {
      const a = sheet.getCell(r, 2);
      const b = sheet.getCell(r, 3);
      a.value = label;
      a.font = { name: FONT, size: 10.5, color: { argb: palette.ink2 } };
      a.alignment = { vertical: "middle", indent: 1 };
      b.value = value ? sign * value : 0;
      b.numFmt = '#,##0" so‘m";-#,##0" so‘m";"—"';
      b.font = { name: FONT, size: 10.5, color: { argb: value ? (sign < 0 ? tones.red.font : palette.ink) : palette.faint } };
      b.alignment = { horizontal: "right", vertical: "middle" };
      for (const c of [a, b]) c.border = { bottom: hair };
      sheet.getRow(r).height = 20;
      r += 1;
    }
  };
  section("Hisoblandi", options.accruals, "green", 1);
  section("Ushlab qolindi", options.deductions, "red", -1);

  r += 1;
  const a = sheet.getCell(r, 2);
  const b = sheet.getCell(r, 3);
  a.value = "QO‘LGA BERILADI";
  b.value = options.net;
  b.numFmt = '#,##0" so‘m"';
  for (const c of [a, b]) {
    c.fill = fill(palette.navy);
    c.font = { name: FONT, size: 13, bold: true, color: { argb: palette.white } };
    c.alignment = { vertical: "middle", horizontal: c === a ? "left" : "right", indent: 1 };
  }
  sheet.getRow(r).height = 32;
  r += 2;
  for (const note of options.notes || []) {
    span(r);
    const cell = sheet.getCell(r, 2);
    cell.value = note;
    cell.font = { name: FONT, size: 9, italic: true, color: { argb: palette.muted } };
    cell.alignment = { wrapText: true, vertical: "top" };
    sheet.getRow(r).height = Math.min(60, 15 * Math.ceil(note.length / 70));
    r += 1;
  }
  return sheet;
}

export async function sendWorkbook(res: Response, workbook: ExcelJS.Workbook, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  res
    .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .attachment(filename)
    .send(Buffer.from(buffer as ArrayBuffer));
}
