import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/*
 * Moliya: jarimalar (HR/direktor/moliya — darhol; filial rahbari — taklif → HR), oylikdan ushlanish,
 * avans oluvchilar ro‘yxati; lavozim va filial orqali avtomatik panel huquqi.
 */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let roles: typeof import("../lib/staff-roles");
let reports: typeof import("../server/reports");
let panel = { role: "HR_MANAGER", userId: "hr", name: "HR Ali" };
const month = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-fin-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  roles = await import("../lib/staff-roles");
  reports = await import("../server/reports");
  const finance = await import("../server/finance");
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE" } as Database["companies"][number]);
    const branch = (id: string) => ({ id, companyId: "c1", name: id.toUpperCase(), address: "", latitude: 41, longitude: 69, radiusMeters: 100, manager: "", status: "ACTIVE", scheduleId: "" }) as Database["branches"][number];
    db.branches.push(branch("b1"), branch("b2"));
    db.positions.push(
      { id: "p-cash", companyId: "c1", name: "Kassir", departmentId: "d" },
      { id: "p-fin", companyId: "c1", name: "Moliyachi", departmentId: "d", panelRole: "FINANCE" },
    );
    const emp = (id: string, extra = {}) =>
      ({ id, companyId: "c1", firstName: id.toUpperCase(), lastName: "Test", status: "ACTIVE", branchId: "b1", positionId: "p-cash", baseSalary: 5_000_000, telegramId: `tg-${id}`, employeeNo: id, ...extra }) as unknown as Database["employees"][number];
    db.employees.push(emp("ozod"), emp("other", { branchId: "b2" }), emp("fin", { positionId: "p-fin" }), emp("boss"));
    db.users.push({ id: "bm1", companyId: "c1", name: "B1 rahbar", role: "BRANCH_MANAGER", branchIds: ["b1"] } as unknown as Database["users"][number]);
  });
  const app = express();
  app.use(express.json());
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: panel.userId, companyId: "c1", name: panel.name, email: "p@t", role: panel.role };
    next();
  });
  app.use("/api", finance.createFinanceRouter());
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

describe("jarimalar", () => {
  it("HR jarima yozadi → darhol qo‘llanadi, xodimga xabar, oylikdan ushlanadi", async () => {
    panel = { role: "HR_MANAGER", userId: "hr", name: "HR Ali" };
    const res = await call("POST", "/api/fines", { employeeId: "ozod", amount: 300_000, reason: "Kassa kamomadi" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("APPROVED");
    const db = await store.readDb();
    expect(db.notifications.some((n) => n.employeeId === "ozod" && n.title.includes("300 000"))).toBe(true);
    const row = reports.payrollRows(db, "c1", month()).find((r) => r.employee.id === "ozod")!;
    expect(row.fine).toBe(300_000);
  });

  it("filial rahbari faqat taklif qiladi (o‘z filiali), HR tasdiqlagach ushlanadi", async () => {
    panel = { role: "BRANCH_MANAGER", userId: "bm1", name: "B1 rahbar" };
    expect((await call("POST", "/api/fines", { employeeId: "other", amount: 50_000, reason: "Kechikish" })).status).toBe(404);
    const res = await call("POST", "/api/fines", { employeeId: "ozod", amount: 100_000, reason: "Forma kiyilmagan" });
    expect(res.body.status).toBe("PENDING");
    // Filial rahbari o‘zi tasdiqlay olmaydi.
    expect((await call("POST", `/api/fines/${res.body.id}/decide`, { approve: true })).status).toBe(403);
    let db = await store.readDb();
    expect(reports.payrollRows(db, "c1", month()).find((r) => r.employee.id === "ozod")!.fine).toBe(300_000);
    expect(db.notifications.some((n) => !n.employeeId && n.go === `/fines?id=${res.body.id}`)).toBe(true);

    panel = { role: "COMPANY_OWNER", userId: "owner", name: "Direktor" };
    const decided = await call("POST", `/api/fines/${res.body.id}/decide`, { approve: true });
    expect(decided.body.status).toBe("APPROVED");
    db = await store.readDb();
    expect(reports.payrollRows(db, "c1", month()).find((r) => r.employee.id === "ozod")!.fine).toBe(400_000);
  });

  it("filial rahbari faqat o‘z filiali jarimalarini ko‘radi; moliya ham to‘g‘ridan-to‘g‘ri yozadi", async () => {
    panel = { role: "FINANCE", userId: "f", name: "Moliya" };
    expect((await call("POST", "/api/fines", { employeeId: "other", amount: 20_000, reason: "Hisobot kechikdi" })).body.status).toBe("APPROVED");
    panel = { role: "BRANCH_MANAGER", userId: "bm1", name: "B1 rahbar" };
    const list = await call("GET", "/api/fines");
    expect(list.body.every((f: any) => f.branchId === "b1")).toBe(true);
    panel = { role: "IT_ADMIN", userId: "it", name: "IT" };
    expect((await call("POST", "/api/fines", { employeeId: "ozod", amount: 20_000, reason: "x y z" })).status).toBe(403);
  });

  it("avans oluvchilar ro‘yxati karta shifrini chiqarmaydi", async () => {
    await store.updateDb((db) => {
      db.advanceRequests.push({ id: "a1", companyId: "c1", employeeId: "ozod", month: month(), amount: 1_000_000, status: "PENDING", payout: { method: "CARD", cardMask: "8600 •••• •••• 1234", cardBrand: "UZCARD", holder: "OZOD TEST", cardEnc: "secret" }, createdAt: "", updatedAt: "" } as Database["advanceRequests"][number]);
    });
    panel = { role: "FINANCE", userId: "f", name: "Moliya" };
    const res = await call("GET", "/api/advances/recipients");
    expect(res.body.rows[0]).toMatchObject({ employeeName: "OZOD Test", branchName: "B1", baseSalary: 5_000_000, amount: 1_000_000, cardMask: "8600 •••• •••• 1234" });
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });
});

describe("lavozim va filial orqali huquq", () => {
  it("lavozimi «Moliya» — avtomatik hisob; filial rahbari tayinlansa — o‘sha filial; lavozim olinsa — o‘chadi", async () => {
    await store.updateDb((db) => {
      db.branches.find((b) => b.id === "b2")!.managerEmployeeIds = ["boss"];
      roles.syncStaffRoles(db, "c1");
    });
    let db = await store.readDb();
    expect(db.users.find((u) => u.employeeId === "fin")).toMatchObject({ role: "FINANCE", autoRole: true, telegramId: "tg-fin", passwordHash: "" });
    expect(db.users.find((u) => u.employeeId === "boss")).toMatchObject({ role: "BRANCH_MANAGER", branchIds: ["b2"] });
    expect(db.branches.find((b) => b.id === "b2")!.manager).toBe("BOSS Test");
    expect(roles.branchManagerNames(db, "b2")).toBe("BOSS Test");

    await store.updateDb((db) => {
      db.positions.find((p) => p.id === "p-fin")!.panelRole = undefined;
      db.employees.find((e) => e.id === "boss")!.status = "DISMISSED";
      roles.syncStaffRoles(db, "c1");
    });
    db = await store.readDb();
    expect(db.users.some((u) => u.employeeId === "fin" || u.employeeId === "boss")).toBe(false);
    expect(db.users.some((u) => u.id === "bm1")).toBe(true); // qo‘lda yaratilgan hisobga tegilmaydi
  });
});
