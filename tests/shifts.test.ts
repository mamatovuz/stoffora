import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/* Smena rejasi (katak, namuna, filial chegarasi), smena marketplace, qo‘shimcha ish ikki bosqichli tasdiq. */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let panel = { role: "HR_ADMIN", userId: "hr", name: "HR" };
let worker = "a";
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const day = addDays(today(), 3);

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-shifts-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  vi.doMock("../server/integrations/hooks", () => ({ notifyEmployee: async () => undefined }));
  store = await import("../lib/store");
  const shifts = await import("../server/shifts");
  const swaps = await import("../server/swaps");
  const payroll = await import("../server/payroll-routes");
  const now = new Date().toISOString();
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE", payroll: { overtimeTwoStep: true } } as Database["companies"][number]);
    db.schedules.push({ id: "s1", companyId: "c1", name: "Har kuni", type: "FIXED", graceMinutes: 0, overtimeEnabled: true, days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, enabled: true, start: "09:00", end: "18:00" })) } as Database["schedules"][number]);
    const branch = (id: string) => ({ id, companyId: "c1", name: id.toUpperCase(), address: "", latitude: 41, longitude: 69, radiusMeters: 100, manager: "", status: "ACTIVE", scheduleId: "s1" }) as Database["branches"][number];
    db.branches.push(branch("b1"), branch("b2"));
    const emp = (id: string, branchId = "b1") => ({ id, companyId: "c1", firstName: id.toUpperCase(), lastName: "Test", status: "ACTIVE", branchId, scheduleId: "s1", baseSalary: 1_000_000, startDate: "2026-01-01", employeeNo: id, phone: "+998900000000" }) as unknown as Database["employees"][number];
    db.employees.push(emp("a"), emp("b"), emp("c"), emp("d", "b2"));
    db.users.push(
      { id: "bm1", companyId: "c1", name: "B1", role: "BRANCH_MANAGER", branchIds: ["b1"] } as unknown as Database["users"][number],
      { id: "fin", companyId: "c1", name: "Moliya", role: "FINANCE" } as unknown as Database["users"][number],
    );
    db.attendance.push({ id: "ot1", companyId: "c1", employeeId: "a", branchId: "b1", date: today(), scheduledStart: "09:00", scheduledEnd: "18:00", checkIn: "09:00", checkOut: "20:00", lateMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 660, overtimeMinutes: 120, status: "PRESENT", verification: [], updatedAt: now } as unknown as Database["attendance"][number]);
  });
  const app = express();
  app.use(express.json());
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: panel.userId, companyId: "c1", name: panel.name, email: "x@t", role: panel.role };
    (req as any).employeeSession = { employeeId: worker, companyId: "c1" };
    next();
  });
  app.use("/api", shifts.createShiftRouter());
  app.use("/api", swaps.createMiniSwapRouter());
  app.use("/api", payroll.createPayrollRouter());
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => res.status(error.status || (error.name === "ZodError" ? 400 : 500)).json({ message: error.message }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => {
  close?.();
  vi.doUnmock("../server/integrations/hooks");
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("smena rejasi", () => {
  it("katakka smena / dam / odatiy", async () => {
    panel = { role: "HR_ADMIN", userId: "hr", name: "HR" };
    expect((await call("PUT", "/api/shift-planner/cell", { employeeId: "a", dates: [day], mode: "shift", templateId: "default-2" })).status).toBe(200);
    let plan = (await call("GET", `/api/shift-planner?from=${day}&days=1`)).body;
    const cell = (id: string) => plan.rows.find((r: any) => r.employeeId === id).cells[0];
    expect(cell("a")).toMatchObject({ working: true, start: "14:00", end: "22:00", overridden: true });
    await call("PUT", "/api/shift-planner/cell", { employeeId: "a", dates: [day], mode: "off" });
    plan = (await call("GET", `/api/shift-planner?from=${day}&days=1`)).body;
    expect(cell("a").working).toBe(false);
    expect(plan.coverage[0].planned).toBe(3);
    await call("PUT", "/api/shift-planner/cell", { employeeId: "a", dates: [day], mode: "reset" });
    plan = (await call("GET", `/api/shift-planner?from=${day}&days=1`)).body;
    expect(cell("a")).toMatchObject({ working: true, start: "09:00", overridden: false });
    const db = await store.readDb();
    expect(db.notifications.some((n) => n.employeeId === "a" && n.title === "Ish grafigingiz yangilandi")).toBe(true);
  });
  it("2/2 namunasi", async () => {
    const from = addDays(today(), 10);
    const r = await call("POST", "/api/shift-planner/pattern", { employeeIds: ["c"], from, to: addDays(from, 7), pattern: "2/2", templateId: "default-0" });
    expect(r.body.cells).toBe(8);
    const plan = (await call("GET", `/api/shift-planner?from=${from}&days=8`)).body;
    expect(plan.rows.find((x: any) => x.employeeId === "c").cells.map((c: any) => c.working)).toEqual([true, true, false, false, true, true, false, false]);
  });
  it("filial rahbari faqat o‘z filiali; davomat huquqisiz — 403", async () => {
    panel = { role: "BRANCH_MANAGER", userId: "bm1", name: "B1" };
    const plan = (await call("GET", `/api/shift-planner?from=${day}&days=1`)).body;
    expect(plan.rows.map((r: any) => r.employeeId).sort()).toEqual(["a", "b", "c"]);
    expect((await call("PUT", "/api/shift-planner/cell", { employeeId: "d", dates: [day], mode: "off" })).status).toBe(404);
    panel = { role: "FINANCE", userId: "fin", name: "Moliya" };
    expect((await call("GET", `/api/shift-planner?from=${day}&days=1`)).status).toBe(403);
  });
});

describe("smena marketplace", () => {
  it("ochiq taklif → faqat shu kuni bo‘sh hamkasbga ko‘rinadi → olinadi → rahbar tasdig‘i", async () => {
    panel = { role: "HR_ADMIN", userId: "hr", name: "HR" };
    await call("PUT", "/api/shift-planner/cell", { employeeId: "b", dates: [day], mode: "off" });
    worker = "a";
    const created = await call("POST", "/api/mini/swaps", { giveDate: day, reason: "to‘y" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "OPEN", offeredTo: 1 });
    expect((await call("POST", "/api/mini/swaps", { giveDate: day })).status).toBe(409);
    worker = "c";
    expect((await call("GET", "/api/mini/swaps")).body.offers).toHaveLength(0);
    expect((await call("POST", `/api/mini/swaps/${created.body.id}/claim`, {})).status).toBe(422);
    worker = "b";
    expect((await call("GET", "/api/mini/swaps")).body.offers.map((o: any) => o.id)).toEqual([created.body.id]);
    const claimed = await call("POST", `/api/mini/swaps/${created.body.id}/claim`, {});
    expect(claimed.body).toMatchObject({ status: "PENDING_MANAGER", colleagueId: "b" });
    expect((await call("POST", `/api/mini/swaps/${created.body.id}/claim`, {})).status).toBe(409);
    worker = "a";
    expect((await call("GET", "/api/mini/swaps")).body.swaps[0].status).toBe("PENDING_MANAGER");
  });
});

describe("qo‘shimcha ish — ikki bosqich", () => {
  it("filial rahbari → moliya kutilmoqda; moliya → tasdiqlandi", async () => {
    panel = { role: "BRANCH_MANAGER", userId: "bm1", name: "B1" };
    let r = await call("POST", "/api/attendance/ot1/overtime", { approved: true });
    expect(r.body.overtimeApproved).toBeUndefined();
    expect(r.body.overtimeManagerBy).toBe("B1");
    expect((await call("POST", "/api/attendance/ot1/overtime", { approved: true })).status).toBe(409);
    panel = { role: "FINANCE", userId: "fin", name: "Moliya" };
    r = await call("POST", "/api/attendance/ot1/overtime", { approved: true });
    expect(r.body).toMatchObject({ overtimeApproved: true, overtimeDecidedBy: "Moliya" });
  });
});
