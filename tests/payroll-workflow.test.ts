import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/* Ish haqi jarayoni: HR → Moliya → Direktor (muzlatish) → To‘landi; yopilgan oy davomati o‘zgarmaydi. */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let wf: typeof import("../server/payroll-workflow");
let panel = { role: "HR_ADMIN", name: "HR" };
const MONTH = "2026-09";

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-pwf-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  wf = await import("../server/payroll-workflow");
  const payroll = await import("../server/payroll-routes");
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE" } as Database["companies"][number]);
    db.users.push({ id: "hr", companyId: "c1", name: "HR", role: "HR_ADMIN" } as unknown as Database["users"][number]);
    db.schedules.push({ id: "s1", companyId: "c1", name: "Har kuni", type: "FIXED", graceMinutes: 0, overtimeEnabled: false, days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, enabled: true, start: "09:00", end: "18:00" })) } as Database["schedules"][number]);
    db.employees.push({ id: "a", companyId: "c1", firstName: "Ali", lastName: "V", status: "ACTIVE", branchId: "b1", scheduleId: "s1", baseSalary: 3_000_000, startDate: "2026-01-01", employeeNo: "1" } as unknown as Database["employees"][number]);
    db.attendance.push({ id: "att1", companyId: "c1", employeeId: "a", branchId: "b1", date: `${MONTH}-10`, scheduledStart: "09:00", scheduledEnd: "18:00", checkIn: "09:00", checkOut: "18:00", lateMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 540, overtimeMinutes: 0, status: "CHECKED_OUT", verification: [], updatedAt: "" } as unknown as Database["attendance"][number]);
  });
  const app = express();
  app.use(express.json());
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: "u", companyId: "c1", name: panel.name, email: "x@t", role: panel.role };
    next();
  });
  app.use("/api", wf.createPayrollWorkflowRouter());
  app.use("/api", payroll.createPayrollRouter());
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

describe("ish haqi jarayoni", () => {
  it("tartib buzilmaydi: moliya HR’dan oldin, direktor moliyadan oldin tasdiqlay olmaydi", async () => {
    panel = { role: "FINANCE", name: "Moliya" };
    expect((await call("POST", `/api/payroll/${MONTH}/workflow`, { action: "finance_check" })).status).toBe(409);
    panel = { role: "COMPANY_OWNER", name: "Direktor" };
    expect((await call("POST", `/api/payroll/${MONTH}/workflow`, { action: "approve" })).status).toBe(409);
    panel = { role: "FINANCE", name: "Moliya" };
    expect((await call("POST", `/api/payroll/${MONTH}/workflow`, { action: "hr_check" })).status).toBe(403);
  });

  it("HR → Moliya → Direktor (oy muzlatiladi) → To‘landi; har bosqich tarixda", async () => {
    panel = { role: "HR_ADMIN", name: "HR" };
    expect((await call("GET", `/api/payroll/${MONTH}/workflow`)).body.can.hrCheck).toBe(true);
    expect((await call("POST", `/api/payroll/${MONTH}/workflow`, { action: "hr_check" })).body.stage).toBe("HR_CHECKED");
    panel = { role: "FINANCE", name: "Moliya" };
    expect((await call("POST", `/api/payroll/${MONTH}/workflow`, { action: "finance_check" })).body.stage).toBe("FINANCE_CHECKED");
    panel = { role: "COMPANY_OWNER", name: "Direktor" };
    expect((await call("POST", `/api/payroll/${MONTH}/workflow`, { action: "approve" })).body.stage).toBe("APPROVED");
    const db = await store.readDb();
    expect(db.payrollPeriods.some((p) => p.month === MONTH)).toBe(true);
    panel = { role: "FINANCE", name: "Moliya" };
    const paid = (await call("POST", `/api/payroll/${MONTH}/workflow`, { action: "mark_paid" })).body;
    expect(paid.stage).toBe("PAID");
    expect(paid.history.map((h: any) => h.stage)).toEqual(["HR_CHECKED", "FINANCE_CHECKED", "APPROVED", "PAID"]);
  });

  it("yopilgan oy davomatini to‘g‘ridan-to‘g‘ri o‘zgartirib bo‘lmaydi", async () => {
    const db = await store.readDb();
    expect(() => wf.assertMonthOpen(db, "c1", `${MONTH}-10`)).toThrow(/yopilgan/);
    expect(() => wf.assertMonthOpen(db, "c1", "2026-10-01")).not.toThrow();
  });

  it("to‘langan oyni moliya qayta ocholmaydi; direktor — faqat sabab bilan", async () => {
    panel = { role: "FINANCE", name: "Moliya" };
    expect((await call("POST", `/api/payroll/${MONTH}/reopen`, {})).status).toBe(403);
    panel = { role: "COMPANY_OWNER", name: "Direktor" };
    expect((await call("POST", `/api/payroll/${MONTH}/workflow`, { action: "reopen" })).status).toBe(422);
    const r = await call("POST", `/api/payroll/${MONTH}/workflow`, { action: "reopen", note: "Davomatda xato" });
    expect(r.body.stage).toBe("CALCULATING");
    expect((await store.readDb()).payrollPeriods.some((p) => p.month === MONTH)).toBe(false);
  });

  it("timesheet va oldingi oy bilan farq", async () => {
    panel = { role: "COMPANY_OWNER", name: "Direktor" };
    const t = (await call("GET", `/api/payroll/${MONTH}/timesheet`)).body;
    expect(t.rows[0]).toMatchObject({ name: "Ali V", workedMinutes: 540, days: 1 });
    const c = (await call("GET", `/api/payroll/${MONTH}/compare`)).body;
    expect(c.prev).toBe("2026-08");
    expect(c.rows[0].employeeId).toBe("a");
    panel = { role: "HR_ADMIN", name: "HR" };
    expect((await call("GET", `/api/payroll/${MONTH}/compare`)).status).toBe(403);
  });
});
