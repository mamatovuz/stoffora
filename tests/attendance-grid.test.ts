import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/* Umumiy tabel (xodim × kun) va avans ro‘yxati Excel’i: holatlar, jami, filial doirasi, karta raqami huquqi. */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let grid: typeof import("../server/attendance-grid");
let panel = { role: "FINANCE", userId: "f1", name: "Moliya" };

async function download(url: string) {
  const res = await fetch(base + url);
  const workbook = new ExcelJS.Workbook();
  if (res.ok) await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
  return { status: res.status, workbook };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-grid-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  grid = await import("../server/attendance-grid");
  const advances = await import("../server/advances");
  const { encryptSecret } = await import("../server/integrations/secrets");
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE" } as Database["companies"][number]);
    db.schedules.push({ id: "s1", companyId: "c1", name: "5/2", type: "FIXED", graceMinutes: 0, overtimeEnabled: false, days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, enabled: d >= 1 && d <= 5, start: "09:00", end: "18:00" })) } as Database["schedules"][number]);
    const branch = (id: string) => ({ id, companyId: "c1", name: id.toUpperCase(), address: "", latitude: 41, longitude: 69, radiusMeters: 100, manager: "", status: "ACTIVE", scheduleId: "s1" }) as Database["branches"][number];
    db.branches.push(branch("b1"), branch("b2"));
    const emp = (id: string, branchId: string) =>
      ({ id, companyId: "c1", firstName: id.toUpperCase(), lastName: "Test", status: "ACTIVE", branchId, scheduleId: "s1", startDate: "2026-01-01", employeeNo: id, baseSalary: 4_000_000 }) as unknown as Database["employees"][number];
    db.employees.push(emp("a", "b1"), emp("b", "b2"));
    const now = new Date().toISOString();
    const att = (employeeId: string, date: string, checkIn: string, checkOut: string | undefined, late: number, manual = false) =>
      ({ id: `att-${employeeId}-${date}`, companyId: "c1", employeeId, branchId: "b1", date, scheduledStart: "09:00", scheduledEnd: "18:00", checkIn, checkOut, lateMinutes: late, earlyLeaveMinutes: 0, workedMinutes: checkOut ? 480 : 0, overtimeMinutes: 0, status: late ? "LATE" : "PRESENT", verification: manual ? ["MANUAL"] : ["FACE"], updatedAt: now }) as Database["attendance"][number];
    db.attendance.push(att("a", "2026-09-01", "09:00", "18:00", 0), att("a", "2026-09-02", "09:20", "18:00", 20, true), att("a", "2026-09-03", "09:00", undefined, 0));
    db.leaveRequests.push({ id: "l1", companyId: "c1", employeeId: "a", type: "SICK", startDate: "2026-09-04", endDate: "2026-09-04", reason: "", status: "APPROVED", createdAt: now } as Database["leaveRequests"][number]);
    db.users.push({ id: "bm1", companyId: "c1", name: "B2 rahbar", role: "BRANCH_MANAGER", branchIds: ["b2"] } as unknown as Database["users"][number]);
    // Avanslar: karta (to‘liq raqam shifrlangan), naqd va rad etilgan.
    db.advanceRequests.push(
      { id: "adv1", companyId: "c1", employeeId: "a", month: "2026-09", amount: 1_000_000, status: "APPROVED", payout: { method: "CARD", cardEnc: encryptSecret("8600123412341234"), cardMask: "8600 •••• •••• 1234", cardBrand: "Uzcard", holder: "A TEST" }, createdAt: "2026-09-10T05:00:00.000Z", updatedAt: now },
      { id: "adv2", companyId: "c1", employeeId: "b", month: "2026-09", amount: 500_000, status: "APPROVED", payout: { method: "CASH" }, paidAt: "2026-09-12T05:00:00.000Z", createdAt: "2026-09-11T05:00:00.000Z", updatedAt: now },
      { id: "adv3", companyId: "c1", employeeId: "b", month: "2026-09", amount: 300_000, status: "REJECTED", createdAt: "2026-09-09T05:00:00.000Z", updatedAt: now },
    );
  });
  const app = express();
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: panel.userId, companyId: "c1", name: panel.name, email: "x@t", role: panel.role };
    next();
  });
  app.use("/api", advances.createAdvanceRouter());
  grid.registerAttendanceGrid(app, {
    requirePermission: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    companyId: () => "c1",
    branchScope: (req: Request, db: Database) => {
      const session = (req as any).session;
      if (session.role !== "BRANCH_MANAGER") return null;
      return new Set(db.users.find((u) => u.id === session.userId)?.branchIds || []);
    },
  });
  // Haqiqiy serverdagidek: noto‘g‘ri kiritma (ZodError) — 400.
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => res.status(error.name === "ZodError" ? 400 : error.status || 500).json({ message: error.message }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => {
  close?.();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("umumiy tabel", () => {
  it("har katakda holat va vaqt; o‘ngda oy jami", async () => {
    const db = await store.readDb();
    const g = grid.attendanceGrid(db, "c1", "2026-09", { today: "2026-10-15", clock: "12:00" });
    expect(g.dates).toHaveLength(30);
    expect(g.rows.map((r) => r.employee.id)).toEqual(["a", "b"]);
    const a = g.rows[0];
    const cell = (date: string) => a.cells.find((c) => c.date === date)!;
    expect(cell("2026-09-01")).toMatchObject({ state: "ON_TIME", in: "09:00", out: "18:00", plan: "09:00–18:00", manual: false });
    expect(cell("2026-09-02")).toMatchObject({ state: "LATE", late: 20, manual: true, recordId: "att-a-2026-09-02" });
    expect(cell("2026-09-03").state).toBe("NO_CHECKOUT");
    expect(cell("2026-09-04")).toMatchObject({ state: "LEAVE", leave: "SICK" });
    expect(cell("2026-09-06").state).toBe("REST");
    expect(cell("2026-09-07").state).toBe("ABSENT");
    // Sentabr 2026: 22 ish kuni; 3 kelgan, 1 ta’til, 18 kelmagan.
    expect(a.totals).toMatchObject({ present: 3, late: 1, lateMinutes: 20, absent: 18, leave: 1, workedMinutes: 960 });
    expect(grid.cellText(cell("2026-09-01"))).toBe("09:00\n18:00");
    expect(grid.cellText(cell("2026-09-07"))).toBe("Kelmadi");
  });
  it("filial rahbari faqat o‘z filiali xodimlarini ko‘radi; filial filtri", async () => {
    const db = await store.readDb();
    expect(grid.attendanceGrid(db, "c1", "2026-09", { scope: new Set(["b2"]) }).rows.map((r) => r.employee.id)).toEqual(["b"]);
    expect(grid.attendanceGrid(db, "c1", "2026-09", { branchId: "b1" }).rows.map((r) => r.employee.id)).toEqual(["a"]);
    panel = { role: "BRANCH_MANAGER", userId: "bm1", name: "B2 rahbar" };
    const res = await fetch(`${base}/api/attendance/grid?month=2026-09`);
    expect(((await res.json()) as { rows: { employee: { id: string } }[] }).rows.map((r) => r.employee.id)).toEqual(["b"]);
    panel = { role: "FINANCE", userId: "f1", name: "Moliya" };
  });
  it("Excel: sarlavha, kunlar va katakdagi vaqt", async () => {
    const { status, workbook } = await download("/api/attendance/grid.xlsx?month=2026-09");
    expect(status).toBe(200);
    const sheet = workbook.getWorksheet("Tabel")!;
    const values: string[] = [];
    sheet.eachRow((row) => row.eachCell((cell) => values.push(String(cell.value ?? ""))));
    expect(values).toContain("09:00\n18:00");
    expect(values).toContain("Kelmadi");
    expect(values.some((v) => v.includes("A Test"))).toBe(true);
  });
});

describe("avans ro‘yxati (Excel)", () => {
  const cellsOf = (sheet: ExcelJS.Worksheet) => {
    const out: string[] = [];
    sheet.eachRow((row) => row.eachCell((cell) => out.push(String(typeof cell.value === "object" && cell.value && "formula" in cell.value ? "=" : (cell.value ?? "")))));
    return out;
  };
  it("moliya: to‘liq karta raqami, naqd qaydnoma, barcha so‘rovlar; audit yoziladi", async () => {
    panel = { role: "FINANCE", userId: "f1", name: "Moliya" };
    const { status, workbook } = await download("/api/payroll/advances.xlsx?month=2026-09");
    expect(status).toBe(200);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(["Kartaga o‘tkazish", "Naqd (kassa)", "Barcha so‘rovlar"]);
    const card = cellsOf(workbook.getWorksheet("Kartaga o‘tkazish")!);
    expect(card).toContain("8600 1234 1234 1234");
    expect(card).toContain("A TEST");
    const cash = cellsOf(workbook.getWorksheet("Naqd (kassa)")!);
    expect(cash.some((v) => v.includes("Test B"))).toBe(true);
    const all = cellsOf(workbook.getWorksheet("Barcha so‘rovlar")!);
    expect(all).toContain("Rad etilgan");
    const db = await store.readDb();
    expect(db.auditLogs.some((l) => l.action.includes("Avans ro‘yxati yuklab olindi"))).toBe(true);
  });
  it("HR: karta raqami yashirin", async () => {
    panel = { role: "HR_MANAGER", userId: "hr", name: "HR" };
    const { status, workbook } = await download("/api/payroll/advances.xlsx?month=2026-09");
    expect(status).toBe(200);
    const card = cellsOf(workbook.getWorksheet("Kartaga o‘tkazish")!);
    expect(card).toContain("8600 •••• •••• 1234");
    expect(card).not.toContain("8600 1234 1234 1234");
  });
  it("noto‘g‘ri oy — 400", async () => {
    panel = { role: "FINANCE", userId: "f1", name: "Moliya" };
    expect((await fetch(`${base}/api/payroll/advances.xlsx?month=2026-9`)).status).toBe(400);
  });
});
