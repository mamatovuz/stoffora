import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";
import { calculateTypedPay, effectiveRate } from "../lib/pay-types";
import { calculatePayroll } from "../lib/payroll";

/* Ish haqi turlari (kunlik, soatbay, oylik, ishbay), stavka tarixi va to‘lovlar. Misollar — texnik topshiriq 1.11. */

const rec = (date: string, checkIn?: string, checkOut?: string, worked = 0, late = 0, overtime = 0) => ({ date, checkIn, checkOut, workedMinutes: worked, lateMinutes: late, overtimeMinutes: overtime });
const noPenalty = { latePenaltyMode: "NONE" as const, overtimePay: false };

describe("hisoblash qoidalari", () => {
  it("A — kunlik: 22 tasdiqlangan kun × 150 000 = 3 300 000", () => {
    const records = Array.from({ length: 22 }, (_, i) => rec(`2026-09-${String(i + 1).padStart(2, "0")}`, "09:00", "18:00", 480));
    const line = calculateTypedPay({ payType: "DAILY", rate: 150_000, records, today: "2026-10-01", workingDays: 22 }, noPenalty);
    expect(line.units).toBe(22);
    expect(line.base).toBe(3_300_000);
    expect(line.net).toBe(3_300_000);
  });
  it("B — soatbay: 8 soat × 10 000 = 80 000; kechikish uchun alohida jarima yo‘q", () => {
    const line = calculateTypedPay({ payType: "HOURLY", rate: 10_000, records: [rec("2026-09-01", "09:30", "18:30", 480, 30)], today: "2026-10-01", workingDays: 22 }, { latePenaltyMode: "HOURLY" });
    expect(line.base).toBe(80_000);
    expect(line.deduction).toBe(0);
    expect(line.net).toBe(80_000);
  });
  it("C — oylik: to‘liq oy 4 000 000 (bonus va ushlanmadan oldin)", () => {
    const line = calculatePayroll(4_000_000, [{ checkIn: "09:00", lateMinutes: 0, workedMinutes: 480, overtimeMinutes: 0 }], noPenalty);
    expect(line.gross).toBe(4_000_000);
  });
  it("D — ishbay: tasdiqlangan 100 dona × 5 000 = 500 000", () => {
    const line = calculateTypedPay({ payType: "PIECE", rate: 0, records: [], today: "2026-10-01", workingDays: 22, pieceAmount: 500_000, pieceQuantity: 100 }, noPenalty);
    expect(line.base).toBe(500_000);
    expect(line.units).toBe(100);
  });
  it("chiqish belgilanmagan kun to‘lanmaydi va istisno sifatida chiqadi; bugungi ochiq kirish — istisno emas", () => {
    const line = calculateTypedPay(
      { payType: "HOURLY", rate: 10_000, records: [rec("2026-09-29", "09:00", "17:00", 480), rec("2026-09-30", "09:00"), rec("2026-10-01", "09:00")], today: "2026-10-01", workingDays: 22 },
      noPenalty,
    );
    expect(line.base).toBe(80_000);
    expect(line.openDays).toEqual(["2026-09-30"]);
  });
  it("bir necha kirish-chiqish va yarim tundan o‘tgan smena — yozuvdagi ishlangan vaqt yig‘iladi", () => {
    // Davomat yozuvi intervallarni allaqachon yig‘ib workedMinutes ga yozadi (tungi smena ham — overnight testlari).
    const line = calculateTypedPay({ payType: "HOURLY", rate: 12_000, records: [rec("2026-09-05", "22:00", "06:00", 450), rec("2026-09-06", "09:00", "13:00", 225)], today: "2026-10-01", workingDays: 22 }, noPenalty);
    expect(line.workedMinutes).toBe(675);
    expect(line.base).toBe(135_000);
  });
  it("bonus, jarima, avans va qo‘shimcha ish (oshirilgan stavka farqi)", () => {
    const line = calculateTypedPay(
      { payType: "HOURLY", rate: 10_000, records: [rec("2026-09-01", "09:00", "20:00", 600, 0, 120)], today: "2026-10-01", workingDays: 22, bonus: 50_000, fine: 20_000, advance: 30_000 },
      { overtimePay: true, overtimeRatePercent: 150, latePenaltyMode: "NONE" },
    );
    expect(line.base).toBe(100_000);
    expect(line.overtimeAmount).toBe(10_000); // 2 soat × 10 000 × 0,5
    expect(line.gross).toBe(140_000);
    expect(line.net).toBe(110_000);
  });
  it("stavka tarixi: har bir sana o‘sha paytdagi stavkada", () => {
    const rates = [
      { employeeId: "e", payType: "MONTHLY" as const, rate: 4_000_000, effectiveFrom: "2026-01-01", createdAt: "1" },
      { employeeId: "e", payType: "DAILY" as const, rate: 200_000, effectiveFrom: "2026-10-01", createdAt: "2" },
    ];
    expect(effectiveRate(rates, { id: "e", baseSalary: 0 }, "2026-09-30")).toMatchObject({ payType: "MONTHLY", rate: 4_000_000 });
    expect(effectiveRate(rates, { id: "e", baseSalary: 0 }, "2026-10-31")).toMatchObject({ payType: "DAILY", rate: 200_000 });
    expect(effectiveRate([], { id: "e", baseSalary: 3_000_000 }, "2026-10-31")).toMatchObject({ payType: "MONTHLY", rate: 3_000_000 });
  });
});

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let panel = { role: "COMPANY_OWNER" };
const MONTH = "2026-09";

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-pay-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  const pay = await import("../server/payroll-pay");
  const wf = await import("../server/payroll-workflow");
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE", payroll: { latePenaltyMode: "NONE", overtimePay: false } } as Database["companies"][number]);
    db.schedules.push({ id: "s1", companyId: "c1", name: "Har kuni", type: "FIXED", graceMinutes: 0, overtimeEnabled: false, days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, enabled: true, start: "09:00", end: "18:00" })) } as Database["schedules"][number]);
    for (const id of ["daily", "piece"])
      db.employees.push({ id, companyId: "c1", firstName: id, lastName: "Test", status: "ACTIVE", branchId: "b1", scheduleId: "s1", baseSalary: 0, startDate: "2026-01-01", employeeNo: id } as unknown as Database["employees"][number]);
    for (const day of ["10", "11"])
      db.attendance.push({ id: `a${day}`, companyId: "c1", employeeId: "daily", branchId: "b1", date: `${MONTH}-${day}`, scheduledStart: "09:00", scheduledEnd: "18:00", checkIn: "09:00", checkOut: "18:00", lateMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 480, overtimeMinutes: 0, status: "CHECKED_OUT", verification: [], updatedAt: "" } as unknown as Database["attendance"][number]);
  });
  const app = express();
  app.use(express.json());
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: "u", companyId: "c1", name: "Direktor", email: "x@t", role: panel.role };
    next();
  });
  app.use("/api", pay.createPayRouter());
  app.use("/api", wf.createPayrollWorkflowRouter());
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => res.status(error.status || (error.name === "ZodError" ? 400 : 500)).json({ message: error.message }));
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

describe("ish haqi moduli API", () => {
  it("stavka va ishbay: kunlik 2 kun × 150 000, ishbay faqat tasdiqlangandan keyin", async () => {
    panel = { role: "BRANCH_MANAGER" };
    expect((await call("POST", "/api/payroll/rates", { employeeId: "daily", payType: "DAILY", rate: 150_000, effectiveFrom: "2026-09-01" })).status).toBe(403);
    panel = { role: "COMPANY_OWNER" };
    expect((await call("POST", "/api/payroll/rates", { employeeId: "daily", payType: "DAILY", rate: 150_000, effectiveFrom: "2026-09-01" })).status).toBe(201);
    expect((await call("POST", "/api/payroll/rates", { employeeId: "piece", payType: "PIECE", rate: 0, effectiveFrom: "2026-09-01" })).status).toBe(201);
    const entry = await call("POST", "/api/payroll/piece", { employeeId: "piece", date: `${MONTH}-12`, workType: "Qadoqlash", unit: "dona", quantity: 100, unitPrice: 5_000 });
    expect(entry.body).toMatchObject({ amount: 500_000, status: "PENDING" });
    let overview = await call("GET", `/api/payroll/overview?month=${MONTH}`);
    expect(overview.body.totals.net).toBe(300_000);
    expect(overview.body.totals.pendingPiece).toBe(1);
    expect((await call("POST", `/api/payroll/piece/${entry.body.id}/decide`, { approve: true })).body.status).toBe("APPROVED");
    overview = await call("GET", `/api/payroll/overview?month=${MONTH}`);
    expect(overview.body.totals.net).toBe(800_000);
    expect(overview.body.byPayType.find((t: any) => t.payType === "PIECE").net).toBe(500_000);
  });
  it("to‘lov faqat yopilgan oy uchun: qisman, to‘liq, qoldiqdan oshmaydi va takror yozilmaydi", async () => {
    const pay = { employeeId: "daily", month: MONTH, amount: 100_000, method: "CASH", paidAt: "2026-10-05", idempotencyKey: "pay-daily-0001" };
    expect((await call("POST", "/api/payroll/payments", pay)).status).toBe(409);
    for (const [role, action] of [
      ["HR_ADMIN", "hr_check"],
      ["FINANCE", "finance_check"],
      ["COMPANY_OWNER", "approve"],
    ]) {
      panel = { role };
      expect((await call("POST", `/api/payroll/${MONTH}/workflow`, { action })).status).toBe(200);
    }
    panel = { role: "COMPANY_OWNER" };
    expect((await call("POST", "/api/payroll/payments", pay)).status).toBe(201);
    expect((await call("POST", "/api/payroll/payments", pay)).status).toBe(200);
    expect((await call("POST", "/api/payroll/payments", { ...pay, amount: 250_000, idempotencyKey: "pay-daily-0002" })).status).toBe(422);
    let overview = await call("GET", `/api/payroll/overview?month=${MONTH}`);
    expect(overview.body.totals).toMatchObject({ paid: 100_000, partial: 100_000, partialPeople: 1 });
    expect((await call("POST", "/api/payroll/payments", { ...pay, amount: 200_000, idempotencyKey: "pay-daily-0003" })).status).toBe(201);
    overview = await call("GET", `/api/payroll/overview?month=${MONTH}`);
    expect(overview.body.totals).toMatchObject({ paid: 300_000, paidPeople: 1, partialPeople: 0 });
    // Yopilgan oyga orqaga qarab stavka kiritilmaydi.
    expect((await call("POST", "/api/payroll/rates", { employeeId: "daily", payType: "DAILY", rate: 999_000, effectiveFrom: `${MONTH}-15` })).status).toBe(409);
    const db = await store.readDb();
    expect(db.payrollPayments).toHaveLength(2);
    expect(db.payrollPeriods.find((p) => p.month === MONTH)?.lines.find((l) => l.employeeId === "daily")).toMatchObject({ payType: "DAILY", rate: 150_000, net: 300_000 });
  });
});
