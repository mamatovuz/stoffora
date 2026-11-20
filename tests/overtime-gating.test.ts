import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/*
 * «Qo‘shimcha ish uchun to‘lash» o‘chiq bo‘lsa — kechroq qolish hech narsani o‘zgartirmaydi: tasdiqlash
 * ro‘yxati, Inbox so‘rovlari va Mini App bo‘limi bo‘sh. «Kechikishni ishlab yopish» — yopilgan daqiqalar
 * qo‘shimcha ish sifatida so‘ralmaydi.
 */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let auth: typeof import("../server/auth");
const month = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);

async function call(method: string, url: string, body?: unknown, token?: string) {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
const setPayroll = (payroll: Record<string, unknown>) =>
  store.updateDb((db) => {
    db.companies[0].payroll = payroll as never;
  });

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-ot-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  auth = await import("../server/auth");
  const ws = await import("../server/workspace");
  const payroll = await import("../server/payroll-routes");
  const extra = await import("../server/mini-extra");
  const now = new Date().toISOString();
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE" } as Database["companies"][number]);
    db.employees.push({ id: "a", companyId: "c1", firstName: "Ali", lastName: "Valiyev", status: "ACTIVE", branchId: "b1", baseSalary: 1_000_000, employeeNo: "1" } as unknown as Database["employees"][number]);
    const row = (id: string, late: number, overtime: number) =>
      ({ id, companyId: "c1", employeeId: "a", branchId: "b1", date: `${month()}-${id === "late" ? "02" : "01"}`, scheduledStart: "09:00", scheduledEnd: "18:00", checkIn: "09:30", checkOut: "18:30", lateMinutes: late, earlyLeaveMinutes: 0, workedMinutes: 480, overtimeMinutes: overtime, status: "CHECKED_OUT", verification: [], updatedAt: now }) as unknown as Database["attendance"][number];
    // «late»: 30 kech + 30 qoldi (to‘liq yopiladi); «extra»: 0 kech + 50 qo‘shimcha.
    db.attendance.push(row("late", 30, 30), row("extra", 0, 50));
  });
  const app = express();
  app.use(express.json());
  app.use("/api/mini", auth.requireEmployee);
  app.use("/api", extra.createMiniExtraRouter());
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: "hr", companyId: "c1", name: "HR", email: "hr@t", role: "HR_ADMIN" };
    next();
  });
  app.use("/api", ws.createWorkspaceRouter());
  app.use("/api", payroll.createPayrollRouter());
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => res.status(error.status || 500).json({ code: error.code, message: error.message }));
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

const overtimeItems = async () => ((await call("GET", "/api/workspace/inbox")).body as any[]).filter((i) => i.kind === "overtime");

describe("qo‘shimcha ish sozlamalari", () => {
  it("to‘lanadi + tasdiq kerak + kechikishni yopish: faqat haqiqiy qo‘shimcha ish so‘raladi", async () => {
    await setPayroll({ overtimePay: true, overtimeRequiresApproval: true, lateOffset: true });
    const list = await call("GET", `/api/overtime?month=${month()}`);
    expect(list.body.disabled).toBeUndefined();
    expect(list.body.rows.map((r: any) => [r.id, r.overtimeMinutes])).toEqual([["extra", 50]]);
    expect((await overtimeItems()).map((i) => i.id)).toEqual(["extra"]);
    const token = auth.signEmployeeSession({ employeeId: "a", companyId: "c1", telegramId: "dev-a", kind: "employee" });
    const mini = await call("GET", "/api/mini/overtime", undefined, token);
    expect(mini.body).toMatchObject({ paid: true, requiresApproval: true });
    expect(mini.body.rows.map((r: any) => r.id)).toEqual(["extra"]);
  });

  it("to‘lanmaydi: ro‘yxat bo‘sh (disabled), Inbox’da so‘rov yo‘q, tasdiqlash 409, Mini App bo‘sh", async () => {
    await setPayroll({ overtimePay: false, overtimeRequiresApproval: true });
    const list = await call("GET", `/api/overtime?month=${month()}`);
    expect(list.body).toEqual({ month: month(), closed: false, disabled: true, rows: [] });
    expect(await overtimeItems()).toEqual([]);
    const decide = await call("POST", "/api/attendance/extra/overtime", { approved: true });
    expect(decide.status).toBe(409);
    expect(decide.body.code).toBe("OVERTIME_DISABLED");
    const token = auth.signEmployeeSession({ employeeId: "a", companyId: "c1", telegramId: "dev-a", kind: "employee" });
    expect((await call("GET", "/api/mini/overtime", undefined, token)).body).toEqual({ requiresApproval: false, paid: false, rows: [] });
    expect((await call("POST", "/api/mini/overtime/extra/note", { note: "Hisobot tugatdim" }, token)).status).toBe(409);
    // Daqiqalar davomat tarixida qoladi.
    expect((await store.readDb()).attendance.find((a) => a.id === "extra")?.overtimeMinutes).toBe(50);
  });
});
