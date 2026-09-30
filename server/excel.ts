import ExcelJS from "exceljs";
import type { Response } from "express";

/* Staffora Excel uslubi — barcha hisobotlar bir xil ko‘rinishda. */
const BRAND = "FF0B7A64";
const INK = "FF12231E";
const MUTED = "FF6A7873";
const LINE = "FFDDE4E1";
const ZEBRA = "FFF6F9F8";
const TOTAL_BG = "FFE6F4EE";
const FONT = "Calibri";

export const tones = {
  green: { fill: "FFE3F4EC", font: "FF12805C" },
  amber: { fill: "FFFDEFD9", font: "FFA35D06" },
  red: { fill: "FFFCE4E4", font: "FFB42E30" },
  blue: { fill: "FFE5EEFC", font: "FF2459B3" },
  violet: { fill: "FFEDE8FC", font: "FF5B3FC4" },
  gray: { fill: "FFEEF1F0", font: "FF5E6B67" },
} as const;
export type Tone = keyof typeof tones;

export type Column = {
  header: string;
  key: string;
  width?: number;
  type?: "text" | "number" | "money" | "minutes" | "time" | "date" | "status" | "percent";
  align?: "left" | "center" | "right";
  total?: "sum" | "avg" | "count" | string;
};
export type Cell = string | number | Date | null | undefined | { text: string; tone: Tone };
export type Row = Record<string, Cell>;

const thin = { style: "thin" as const, color: { argb: LINE } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

function fill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}
const colLetter = (index: number) => {
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

/** Varaq tepasiga brend sarlavha, izoh va KPI kartochkalarini chizadi. Keyingi bo‘sh qator raqamini qaytaradi. */
function drawHeader(
  sheet: ExcelJS.Worksheet,
  span: number,
  title: string,
  subtitle: string,
  kpis: { label: string; value: string | number; tone?: Tone }[] = [],
) {
  const last = colLetter(Math.max(span, 4));
  sheet.mergeCells(`A1:${last}1`);
  const titleCell = sheet.getCell("A1");
  titleCell.value = `STAFFORA  ·  ${title}`;
  titleCell.font = { name: FONT, size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = fill(BRAND);
  titleCell.alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(1).height = 34;

  sheet.mergeCells(`A2:${last}2`);
  const sub = sheet.getCell("A2");
  sub.value = subtitle;
  sub.font = { name: FONT, size: 10, italic: true, color: { argb: MUTED } };
  sub.alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(2).height = 20;

  let next = 4;
  if (kpis.length) {
    // Har bir KPI 2 ustunli kartochka: yuqorida qiymat, pastda nom.
    const per = Math.max(1, Math.floor(Math.max(span, kpis.length * 2) / kpis.length));
    kpis.forEach((kpi, index) => {
      const from = index * per + 1;
      const to = Math.min(from + per - 1, Math.max(span, kpis.length * per));
      const tone = tones[kpi.tone || "gray"];
      if (to > from) {
        sheet.mergeCells(4, from, 4, to);
        sheet.mergeCells(5, from, 5, to);
      }
      const value = sheet.getCell(4, from);
      value.value = kpi.value;
      value.font = { name: FONT, size: 18, bold: true, color: { argb: tone.font } };
      value.fill = fill(tone.fill);
      value.alignment = { horizontal: "center", vertical: "middle" };
      const label = sheet.getCell(5, from);
      label.value = kpi.label;
      label.font = { name: FONT, size: 9, color: { argb: MUTED } };
      label.fill = fill(tone.fill);
      label.alignment = { horizontal: "center", vertical: "top" };
    });
    sheet.getRow(4).height = 30;
    sheet.getRow(5).height = 18;
    next = 7;
  }
  return next;
}

export function addTableSheet(
  workbook: ExcelJS.Workbook,
  options: {
    name: string;
    title: string;
    subtitle: string;
    columns: Column[];
    rows: Row[];
    kpis?: { label: string; value: string | number; tone?: Tone }[];
    totalsLabel?: string;
    emptyText?: string;
  },
) {
  const sheet = workbook.addWorksheet(options.name.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 0, showGridLines: false }],
    pageSetup: {
      orientation: options.columns.length > 7 ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    headerFooter: {
      oddFooter: `&L&8Staffora · ${options.title}&R&8&P / &N`,
    },
  });
  const start = drawHeader(sheet, options.columns.length, options.title, options.subtitle, options.kpis);
  options.columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width || 16;
  });

  const headerRow = sheet.getRow(start);
  options.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = fill(INK);
    cell.border = border;
    cell.alignment = {
      vertical: "middle",
      horizontal: column.align || (column.type && column.type !== "text" ? "center" : "left"),
      wrapText: true,
      indent: column.align === "left" || !column.type || column.type === "text" ? 1 : 0,
    };
  });
  headerRow.height = 30;
  sheet.views = [{ state: "frozen", ySplit: start, xSplit: 0, showGridLines: false }];

  if (!options.rows.length) {
    sheet.mergeCells(start + 1, 1, start + 1, options.columns.length);
    const cell = sheet.getCell(start + 1, 1);
    cell.value = options.emptyText || "Tanlangan davr uchun ma’lumot yo‘q";
    cell.font = { name: FONT, italic: true, color: { argb: MUTED } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(start + 1).height = 28;
    return sheet;
  }

  options.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(start + 1 + rowIndex);
    excelRow.height = 20;
    options.columns.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1);
      writeCell(cell, row[column.key], column);
      cell.border = border;
      if (rowIndex % 2 === 1 && !cell.fill) cell.fill = fill(ZEBRA);
    });
  });

  const lastDataRow = start + options.rows.length;
  sheet.autoFilter = {
    from: { row: start, column: 1 },
    to: { row: lastDataRow, column: options.columns.length },
  };

  if (options.columns.some((c) => c.total)) {
    const totalRow = sheet.getRow(lastDataRow + 1);
    totalRow.height = 24;
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
      cell.font = { name: FONT, bold: true, color: { argb: INK } };
      cell.fill = fill(TOTAL_BG);
      cell.border = { ...border, top: { style: "medium", color: { argb: BRAND } } };
      cell.alignment = {
        vertical: "middle",
        horizontal: index === 0 ? "left" : column.align || (column.type && column.type !== "text" ? "center" : "left"),
        indent: index === 0 ? 1 : 0,
      };
    });
  }
  return sheet;
}

function numFmt(type?: Column["type"]) {
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

function writeCell(cell: ExcelJS.Cell, value: Cell, column: Column) {
  const align = column.align || (column.type && column.type !== "text" ? "center" : "left");
  cell.font = { name: FONT, size: 10.5, color: { argb: INK } };
  cell.alignment = { vertical: "middle", horizontal: align, indent: align === "left" ? 1 : 0 };
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const tone = tones[value.tone];
    cell.value = value.text;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: tone.font } };
    cell.fill = fill(tone.fill);
    cell.alignment = { vertical: "middle", horizontal: "center" };
    return;
  }
  if (value === null || value === undefined || value === "") {
    cell.value = column.type && column.type !== "text" ? "—" : "";
    cell.font = { name: FONT, size: 10.5, color: { argb: "FFB3BDB9" } };
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
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  const span = options.dates.length + 5;
  const start = drawHeader(sheet, span, options.title, options.subtitle);
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 11;
  options.dates.forEach((_, i) => (sheet.getColumn(i + 3).width = 4.6));
  const sumCols = ["Keldi", "Kech", "Kelmadi"];
  sumCols.forEach((_, i) => (sheet.getColumn(options.dates.length + 3 + i).width = 8.5));

  const weekdays = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
  const head = sheet.getRow(start);
  const head2 = sheet.getRow(start + 1);
  const headers = ["Xodim", "ID", ...options.dates.map((d) => String(Number(d.slice(8)))), ...sumCols];
  headers.forEach((text, i) => {
    const cell = head.getCell(i + 1);
    cell.value = text;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = fill(INK);
    cell.border = border;
    cell.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle", indent: i === 0 ? 1 : 0 };
    const sub = head2.getCell(i + 1);
    const date = options.dates[i - 2];
    const weekday = date ? new Date(`${date}T12:00:00Z`).getUTCDay() : -1;
    sub.value = date ? weekdays[weekday] : "";
    sub.font = { name: FONT, size: 8.5, color: { argb: weekday === 0 || weekday === 6 ? "FFB42E30" : MUTED } };
    sub.fill = fill("FFEEF3F1");
    sub.border = border;
    sub.alignment = { horizontal: "center" };
  });
  head.height = 24;
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: start + 1, showGridLines: false }];

  options.rows.forEach((row, index) => {
    const r = sheet.getRow(start + 2 + index);
    r.height = 21;
    const name = r.getCell(1);
    name.value = row.name;
    name.font = { name: FONT, size: 10.5, bold: true, color: { argb: INK } };
    name.alignment = { vertical: "middle", indent: 1 };
    const no = r.getCell(2);
    no.value = row.employeeNo;
    no.font = { name: FONT, size: 9.5, color: { argb: MUTED } };
    no.alignment = { vertical: "middle", horizontal: "center" };
    [name, no].forEach((c) => {
      c.border = border;
      if (index % 2) c.fill = fill(ZEBRA);
    });
    row.cells.forEach((item, i) => {
      const cell = r.getCell(i + 3);
      const tone = tones[item.tone];
      cell.value = item.code;
      cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: tone.font } };
      cell.fill = fill(item.code ? tone.fill : index % 2 ? ZEBRA : "FFFFFFFF");
      cell.border = border;
      cell.alignment = { horizontal: "center", vertical: "middle" };
      if (item.note) cell.note = item.note;
    });
    const count = (codes: string[]) => row.cells.filter((c) => codes.includes(c.code)).length;
    [count(["✓", "K"]), count(["K"]), count(["X"])].forEach((value, i) => {
      const cell = r.getCell(options.dates.length + 3 + i);
      cell.value = value;
      const tone = tones[(["green", "amber", "red"] as Tone[])[i]];
      cell.font = { name: FONT, bold: true, color: { argb: tone.font } };
      cell.fill = fill(tone.fill);
      cell.border = border;
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
  });

  // Izoh (legend)
  const legendRow = start + 3 + options.rows.length;
  const legend: [string, string, Tone][] = [
    ["✓", "Vaqtida keldi", "green"],
    ["K", "Kechikdi", "amber"],
    ["X", "Kelmadi", "red"],
    ["T", "Ta’til", "violet"],
    ["D", "Dam olish", "gray"],
    ["•", "Hali ishda / chiqish yo‘q", "blue"],
  ];
  legend.forEach(([code, text, toneName], i) => {
    const tone = tones[toneName];
    const codeCell = sheet.getCell(legendRow + i, 1);
    codeCell.value = `${code}   ${text}`;
    codeCell.font = { name: FONT, size: 9.5, color: { argb: tone.font }, bold: true };
    codeCell.fill = fill(tone.fill);
  });
  return sheet;
}

export async function sendWorkbook(res: Response, workbook: ExcelJS.Workbook, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  res
    .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .attachment(filename)
    .send(Buffer.from(buffer as ArrayBuffer));
}
