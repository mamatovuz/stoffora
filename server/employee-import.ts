import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { phoneKey, tashkentIsoDate } from "../lib/format";
import { alignDepartment, assertEmployeeCapacity } from "../lib/limits";
import { branchManagerNames, syncStaffRoles } from "../lib/staff-roles";
import type { Database, Employee } from "../lib/types";
import { createWorkbook, fill, palette, sendWorkbook } from "./excel";

/*
 * Excel’dan xodimlarni ommaviy qo‘shish:
 *   1) GET  /api/employees/import-template.xlsx — kompaniyaning filial, bo‘lim, lavozim va grafiklari
 *      ochiladigan ro‘yxat sifatida qo‘yilgan shablon;
 *   2) POST /api/employees/import { file, commit:false } — har bir qator tekshiriladi (hech narsa yozilmaydi);
 *   3) POST /api/employees/import { file, commit:true } — faqat xatosiz qatorlar qo‘shiladi.
 * Filial va ish grafigi oldindan bo‘lishi shart (GPS va vaqtlar kerak); bo‘lim va lavozim
 * topilmasa — xohlasa avtomatik yaratiladi.
 */

const SHEET = "Xodimlar";
const MAX_ROWS = 2000;
type Col = { key: keyof ImportRow; header: string; required?: boolean; width: number; note?: string; list?: "branch" | "department" | "position" | "schedule" | "gender" | "type" };
type ImportRow = {
  lastName: string;
  firstName: string;
  middleName: string;
  phone: string;
  branch: string;
  department: string;
  position: string;
  schedule: string;
  startDate: string;
  baseSalary: string;
  employeeNo: string;
  employmentType: string;
  pinfl: string;
  birthDate: string;
  gender: string;
  email: string;
  address: string;
};
const COLUMNS: Col[] = [
  { key: "lastName", header: "Familiya", required: true, width: 18 },
  { key: "firstName", header: "Ism", required: true, width: 16 },
  { key: "middleName", header: "Otasining ismi", width: 18 },
  { key: "phone", header: "Telefon", required: true, width: 18, note: "Masalan: +998 90 123 45 67 yoki 901234567" },
  { key: "branch", header: "Filial", required: true, width: 20, list: "branch" },
  { key: "department", header: "Bo‘lim", required: true, width: 18, list: "department" },
  { key: "position", header: "Lavozim", required: true, width: 18, list: "position" },
  { key: "schedule", header: "Ish grafigi", required: true, width: 18, list: "schedule" },
  { key: "startDate", header: "Ishga kirgan sana", required: true, width: 16, note: "KK.OO.YYYY, masalan 01.10.2026" },
  { key: "baseSalary", header: "Oylik (so‘m)", width: 15 },
  { key: "employeeNo", header: "Tabel raqami", width: 13, note: "Bo‘sh qolsa — avtomatik (EMP-0001…)" },
  { key: "employmentType", header: "Bandlik turi", width: 15, list: "type" },
  { key: "pinfl", header: "JShShIR", width: 17, note: "14 ta raqam" },
  { key: "birthDate", header: "Tug‘ilgan sana", width: 14 },
  { key: "gender", header: "Jinsi", width: 9, list: "gender" },
  { key: "email", header: "Email", width: 22 },
  { key: "address", header: "Manzil", width: 28 },
];
const TYPES: Record<string, Employee["employmentType"]> = { "to‘liq stavka": "FULL_TIME", "yarim stavka": "PART_TIME", shartnoma: "CONTRACT" };
const TYPE_LABELS = ["To‘liq stavka", "Yarim stavka", "Shartnoma"];

const norm = (value: string) =>
  value
    .toLowerCase()
    .replace(/[‘’ʻʼ`']/g, "'")
    .replace(/\s+/g, " ")
    .trim();

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text.trim(); // giperhavola
    if ("result" in v) return String(v.result ?? "").trim(); // formula
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
  }
  return String(v).trim();
}

/** «01.10.2026», «1/10/2026», «2026-10-01» yoki Excel sanasi → YYYY-MM-DD. */
export function parseDate(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let iso: string | undefined;
  if (m) iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  else if ((m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/))) iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  else if (/^\d{5}$/.test(t)) iso = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86_400_000).toISOString().slice(0, 10);
  if (!iso) return undefined;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? undefined : iso;
}

/** Telefon → «+998 90 123 45 67» (9 yoki 12 raqam). */
export function normalizePhone(text: string): string | undefined {
  let digits = text.replace(/\D/g, "");
  if (digits.length === 9) digits = `998${digits}`;
  if (digits.length !== 12 || !digits.startsWith("998")) return undefined;
  return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10)}`;
}

type Checked = {
  row: number;
  name: string;
  errors: string[];
  warnings: string[];
  employee?: Omit<Employee, "id" | "companyId" | "createdAt" | "updatedAt" | "telegramConnected" | "deviceStatus" | "status" | "currency"> & { newDepartment?: string; newPosition?: string };
};

/** Fayldagi qatorlarni o‘qiydi va tekshiradi (bazaga yozmaydi). */
export async function checkImport(db: Database, tenant: string, file: Buffer, createMissing: boolean) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file as unknown as ArrayBuffer);
  } catch {
    throw Object.assign(new Error("Fayl o‘qilmadi. Shablondagi .xlsx faylni yuklang."), { status: 422 });
  }
  const sheet = workbook.getWorksheet(SHEET) || workbook.worksheets[0];
  if (!sheet) throw Object.assign(new Error("Faylda varaq yo‘q."), { status: 422 });

  // Sarlavha qatori: ustunlar nomi bo‘yicha topiladi (tartibi o‘zgargan bo‘lsa ham).
  let headerRow = 0;
  const positions = new Map<keyof ImportRow, number>();
  for (let r = 1; r <= Math.min(10, sheet.rowCount) && !headerRow; r += 1) {
    const row = sheet.getRow(r);
    const found = new Map<keyof ImportRow, number>();
    row.eachCell((cell, c) => {
      const text = norm(cellText(cell).replace(/\*/g, ""));
      const col = COLUMNS.find((x) => norm(x.header) === text);
      if (col) found.set(col.key, c);
    });
    if (found.has("lastName") && found.has("firstName")) {
      headerRow = r;
      for (const [k, v] of found) positions.set(k, v);
    }
  }
  if (!headerRow) throw Object.assign(new Error("Sarlavha topilmadi: «Familiya» va «Ism» ustunlari bo‘lishi kerak. Shablonni yuklab oling."), { status: 422 });

  const company = (list: { id: string; companyId: string; name: string }[]) => {
    const map = new Map<string, string>();
    for (const x of list) if (x.companyId === tenant) map.set(norm(x.name), x.id);
    return map;
  };
  const branches = company(db.branches.filter((b) => b.status !== "INACTIVE"));
  const departments = company(db.departments);
  const positionsByName = company(db.positions);
  const schedules = company(db.schedules);
  const existingPhones = new Set(db.employees.filter((e) => e.companyId === tenant && e.status !== "ARCHIVED").map((e) => phoneKey(e.phone)));
  const existingNos = new Set(db.employees.filter((e) => e.companyId === tenant).map((e) => e.employeeNo.toLowerCase()));
  const existingPinfl = new Set(db.employees.filter((e) => e.companyId === tenant && e.pinfl).map((e) => e.pinfl!));
  const seenPhones = new Map<string, number>();
  const seenNos = new Map<string, number>();
  const today = tashkentIsoDate();

  const rows: Checked[] = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r += 1) {
    const raw = sheet.getRow(r);
    const get = (key: keyof ImportRow) => (positions.has(key) ? cellText(raw.getCell(positions.get(key)!)) : "");
    const values = Object.fromEntries(COLUMNS.map((c) => [c.key, get(c.key)])) as ImportRow;
    if (!Object.values(values).some(Boolean)) continue; // bo‘sh qator
    if (rows.length >= MAX_ROWS) throw Object.assign(new Error(`Bir martada ko‘pi bilan ${MAX_ROWS} ta xodim.`), { status: 422 });
    const errors: string[] = [];
    const warnings: string[] = [];
    const need = (key: keyof ImportRow, label: string) => {
      if (!values[key]) errors.push(`${label} kiritilmagan`);
      return values[key];
    };
    const lastName = need("lastName", "Familiya");
    const firstName = need("firstName", "Ism");
    if (firstName && firstName.length < 2) errors.push("Ism kamida 2 harf");
    if (lastName && lastName.length < 2) errors.push("Familiya kamida 2 harf");

    const phone = values.phone ? normalizePhone(values.phone) : undefined;
    if (!values.phone) errors.push("Telefon kiritilmagan");
    else if (!phone) errors.push(`Telefon noto‘g‘ri: «${values.phone}»`);
    else {
      const key = phoneKey(phone);
      if (existingPhones.has(key)) errors.push("Bu telefon bilan xodim allaqachon bor");
      else if (seenPhones.has(key)) errors.push(`Telefon ${seenPhones.get(key)}-qatorda ham bor`);
      else seenPhones.set(key, r);
    }

    const ref = (key: "branch" | "department" | "position" | "schedule", map: Map<string, string>, label: string, creatable: boolean) => {
      const name = values[key];
      if (!name) {
        errors.push(`${label} kiritilmagan`);
        return { id: "" };
      }
      const found = map.get(norm(name));
      if (found) return { id: found };
      if (creatable && createMissing) {
        warnings.push(`Yangi ${label.toLowerCase()} yaratiladi: «${name}»`);
        return { id: "", create: name };
      }
      errors.push(`${label} topilmadi: «${name}»${creatable ? "" : " — avval panelda yarating"}`);
      return { id: "" };
    };
    const branch = ref("branch", branches, "Filial", false);
    const department = ref("department", departments, "Bo‘lim", true);
    const position = ref("position", positionsByName, "Lavozim", true);
    const schedule = ref("schedule", schedules, "Ish grafigi", false);

    const startDate = values.startDate ? parseDate(values.startDate) : undefined;
    if (!values.startDate) errors.push("Ishga kirgan sana kiritilmagan");
    else if (!startDate) errors.push(`Sana noto‘g‘ri: «${values.startDate}» (KK.OO.YYYY)`);
    else if (startDate > today) warnings.push("Ishga kirish sanasi kelajakda");

    const salaryText = values.baseSalary.replace(/[\s,]/g, "").replace(/so.?m/i, "");
    const baseSalary = salaryText ? Number(salaryText) : 0;
    if (salaryText && (!Number.isFinite(baseSalary) || baseSalary < 0)) errors.push(`Oylik noto‘g‘ri: «${values.baseSalary}»`);
    if (!salaryText) warnings.push("Oylik kiritilmagan (0)");

    const employeeNo = values.employeeNo.trim();
    if (employeeNo) {
      const key = employeeNo.toLowerCase();
      if (existingNos.has(key)) errors.push(`Tabel raqami band: ${employeeNo}`);
      else if (seenNos.has(key)) errors.push(`Tabel raqami ${seenNos.get(key)}-qatorda ham bor`);
      else seenNos.set(key, r);
    }
    const pinfl = values.pinfl.replace(/\s/g, "");
    if (pinfl && !/^\d{14}$/.test(pinfl)) errors.push("JShShIR 14 ta raqam bo‘lishi kerak");
    else if (pinfl && existingPinfl.has(pinfl)) errors.push("Bu JShShIR bilan xodim allaqachon bor");
    const birthDate = values.birthDate ? parseDate(values.birthDate) : undefined;
    if (values.birthDate && !birthDate) errors.push(`Tug‘ilgan sana noto‘g‘ri: «${values.birthDate}»`);
    const gender = /^(e|erkak|m|male)/i.test(values.gender) ? "MALE" : /^(a|ayol|f|female)/i.test(values.gender) ? "FEMALE" : undefined;
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.push(`Email noto‘g‘ri: «${values.email}»`);
    const employmentType = values.employmentType ? TYPES[norm(values.employmentType).replace(/'/g, "‘")] : "FULL_TIME";
    if (!employmentType) errors.push(`Bandlik turi noto‘g‘ri: «${values.employmentType}»`);

    rows.push({
      row: r,
      name: `${lastName} ${firstName}`.trim() || `${r}-qator`,
      errors,
      warnings,
      employee: errors.length
        ? undefined
        : {
            employeeNo,
            firstName,
            lastName,
            middleName: values.middleName || undefined,
            phone: phone!,
            email: values.email,
            branchId: branch.id,
            departmentId: department.id,
            positionId: position.id,
            scheduleId: schedule.id,
            startDate: startDate!,
            baseSalary: Math.round(baseSalary),
            employmentType: employmentType!,
            pinfl: pinfl || undefined,
            birthDate,
            gender,
            address: values.address || undefined,
            newDepartment: "create" in department ? department.create : undefined,
            newPosition: "create" in position ? position.create : undefined,
          },
    });
  }
  return rows;
}

export function registerEmployeeImport(
  app: Express,
  deps: { requirePermission: (permission: string) => RequestHandler; companyId: (req: Request) => string },
) {
  const route = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req, res)).catch(next);

  app.get(
    "/api/employees/import-template.xlsx",
    deps.requirePermission("employees.create"),
    route(async (req, res) => {
      const db = await readDb();
      const tenant = deps.companyId(req);
      const names = (list: { companyId: string; name: string }[]) => list.filter((x) => x.companyId === tenant).map((x) => x.name).sort((a, b) => a.localeCompare(b));
      const lists = {
        branch: names(db.branches.filter((b) => b.status !== "INACTIVE")),
        department: names(db.departments),
        position: names(db.positions),
        schedule: names(db.schedules),
        gender: ["Erkak", "Ayol"],
        type: TYPE_LABELS,
      };
      const workbook = createWorkbook();
      const sheet = workbook.addWorksheet(SHEET, { properties: { tabColor: { argb: palette.brand } }, views: [{ state: "frozen", ySplit: 1, showGridLines: true }] });
      COLUMNS.forEach((col, i) => {
        const column = sheet.getColumn(i + 1);
        column.width = col.width;
        const cell = sheet.getCell(1, i + 1);
        cell.value = col.required ? `${col.header}*` : col.header;
        cell.font = { name: "Calibri", size: 10.5, bold: true, color: { argb: palette.white } };
        cell.fill = fill(col.required ? palette.navy : "FF475569");
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        if (col.note) cell.note = col.note;
        if (["startDate", "birthDate"].includes(col.key)) column.numFmt = "dd.mm.yyyy";
        if (col.key === "baseSalary") column.numFmt = "#,##0";
        if (["phone", "employeeNo", "pinfl"].includes(col.key)) column.numFmt = "@";
      });
      sheet.getRow(1).height = 30;
      // Ochiladigan ro‘yxatlar — alohida (yashirin) varaqda
      const ref = workbook.addWorksheet("Ro‘yxatlar", { state: "hidden" });
      const listCols = Object.entries(lists);
      listCols.forEach(([key, values], i) => {
        ref.getCell(1, i + 1).value = key;
        values.forEach((v, j) => (ref.getCell(j + 2, i + 1).value = v));
      });
      const letter = (n: number) => String.fromCharCode(64 + n);
      COLUMNS.forEach((col, i) => {
        if (!col.list) return;
        const index = listCols.findIndex(([key]) => key === col.list);
        const count = lists[col.list].length;
        if (!count) return;
        for (let r = 2; r <= 501; r += 1)
          sheet.getCell(r, i + 1).dataValidation = {
            type: "list",
            allowBlank: true,
            showErrorMessage: col.list === "gender" || col.list === "type" || col.list === "branch" || col.list === "schedule",
            errorTitle: col.header,
            error: "Ro‘yxatdan tanlang",
            formulae: [`'Ro‘yxatlar'!$${letter(index + 1)}$2:$${letter(index + 1)}$${count + 1}`],
          };
      });

      // Yo‘riqnoma varag‘i (namuna bilan) — import qilinmaydi
      const help = workbook.addWorksheet("Yo‘riqnoma", { views: [{ showGridLines: false }] });
      help.getColumn(1).width = 4;
      help.getColumn(2).width = 100;
      const lines: [string, Partial<ExcelJS.Font>?][] = [
        ["Xodimlarni Excel’dan qo‘shish", { size: 16, bold: true }],
        [""],
        ["1. «Xodimlar» varag‘ida har bir qator — bitta xodim. * belgili ustunlar majburiy."],
        ["2. Filial, Bo‘lim, Lavozim va Ish grafigi — katakni bosing va ochiladigan ro‘yxatdan tanlang."],
        ["   Filial va Ish grafigi panelda oldindan bo‘lishi shart. Yangi bo‘lim/lavozim yuklashda avtomatik yaratilishi mumkin."],
        ["3. Telefon: +998 90 123 45 67 yoki 901234567. Sana: 01.10.2026."],
        ["4. Tabel raqami bo‘sh qolsa — avtomatik beriladi (EMP-0001, EMP-0002 …)."],
        ["5. Faylni saqlab, Staffora → Xodimlar → «Excel’dan yuklash» orqali yuklang. Avval tekshiruv natijasi ko‘rsatiladi —"],
        ["   xatosiz qatorlar qo‘shiladi, xatolilarini tuzatib qayta yuklash mumkin."],
        [""],
        ["Namuna:", { bold: true }],
        [`Karimov | Jasur | Akmalovich | +998 90 123 45 67 | ${lists.branch[0] || "Bosh ofis"} | ${lists.department[0] || "Savdo"} | ${lists.position[0] || "Sotuvchi"} | ${lists.schedule[0] || "5/2"} | 01.10.2026 | 5 000 000`, { color: { argb: palette.muted } }],
      ];
      lines.forEach(([text, font], i) => {
        const cell = help.getCell(i + 2, 2);
        cell.value = text;
        cell.font = { name: "Calibri", size: 11, ...(font || {}) };
      });
      await sendWorkbook(res, workbook, "staffora-xodimlar-shablon.xlsx");
    }),
  );

  app.post(
    "/api/employees/import",
    deps.requirePermission("employees.create"),
    route(async (req, res) => {
      const input = z
        .object({
          file: z.string().min(10).max(4_000_000),
          commit: z.boolean().default(false),
          createMissing: z.boolean().default(true),
        })
        .parse(req.body);
      const tenant = deps.companyId(req);
      const buffer = Buffer.from(input.file.replace(/^data:[^,]*,/, ""), "base64");
      const checked = await checkImport(await readDb(), tenant, buffer, input.createMissing);
      const valid = checked.filter((r) => r.employee);
      const summary = { total: checked.length, valid: valid.length, invalid: checked.length - valid.length };
      if (!input.commit) return res.json({ summary, rows: checked.map(({ employee: _e, ...rest }) => rest) });
      if (!valid.length) throw Object.assign(new Error("Qo‘shiladigan xatosiz qator yo‘q."), { status: 422 });

      const actor = (req as Request & { session?: { name: string } }).session!.name;
      const created = await updateDb(async (db) => {
        // Yozish paytida qayta tekshiramiz (boshqa foydalanuvchi shu orada qo‘shgan bo‘lishi mumkin).
        const fresh = (await checkImport(db, tenant, buffer, input.createMissing)).filter((r) => r.employee);
        assertEmployeeCapacity(db, tenant, fresh.length);
        const now = new Date().toISOString();
        const ensure = (list: "departments" | "positions", name: string, extra: Record<string, unknown> = {}) => {
          const rows = db[list] as { id: string; companyId: string; name: string }[];
          const found = rows.find((x) => x.companyId === tenant && norm(x.name) === norm(name));
          if (found) return found.id;
          const row = { id: randomUUID(), companyId: tenant, name: name.trim(), ...extra };
          rows.push(row);
          db.auditLogs.unshift(audit(tenant, actor, `${list === "departments" ? "Bo‘lim" : "Lavozim"} yaratildi (Excel import): ${row.name}`, "company", tenant));
          return row.id;
        };
        let next = Math.max(0, ...db.employees.filter((e) => e.companyId === tenant).map((e) => Number(e.employeeNo.replace(/\D/g, "")) || 0));
        const ids: string[] = [];
        for (const item of fresh) {
          const { newDepartment, newPosition, ...data } = item.employee!;
          if (newDepartment) data.departmentId = ensure("departments", newDepartment);
          if (newPosition) data.positionId = ensure("positions", newPosition, { departmentId: data.departmentId });
          const row: Employee = {
            ...data,
            id: randomUUID(),
            companyId: tenant,
            employeeNo: data.employeeNo || `EMP-${String((next += 1)).padStart(4, "0")}`,
            currency: "UZS",
            telegramConnected: false,
            deviceStatus: "PENDING",
            status: "ACTIVE",
            createdAt: now,
            updatedAt: now,
          };
          alignDepartment(db, row);
          row.manager = branchManagerNames(db, row.branchId) || undefined;
          db.employees.push(row);
          ids.push(row.id);
        }
        syncStaffRoles(db, tenant);
        db.auditLogs.unshift(audit(tenant, actor, `Excel’dan ${ids.length} ta xodim qo‘shildi`, "company", tenant));
        return ids.length;
      });
      res.json({ summary: { ...summary, created }, rows: checked.map(({ employee: _e, ...rest }) => rest) });
    }),
  );
}
