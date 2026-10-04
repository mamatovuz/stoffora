import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/* Qidiruv (rol/filial chegarasi), tuzilma (halqa yo‘q). */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let panel = { role: "HR_ADMIN", userId: "hr" };

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-insight-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  const insight = await import("../server/insight");
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Gulnora Farm", status: "ACTIVE" } as Database["companies"][number]);
    db.schedules.push({ id: "s1", companyId: "c1", name: "Har kuni", type: "FIXED", graceMinutes: 0, overtimeEnabled: false, days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, enabled: true, start: "00:01", end: "23:59" })) } as Database["schedules"][number]);
    const branch = (id: string, managers: string[] = []) => ({ id, companyId: "c1", name: `Filial ${id}`, status: "ACTIVE", scheduleId: "s1", managerEmployeeIds: managers }) as Database["branches"][number];
    db.branches.push(branch("b1", ["m"]), branch("b2"));
    db.departments.push({ id: "d1", companyId: "c1", name: "Savdo" }, { id: "d2", companyId: "c1", name: "Dorixona" });
    db.positions.push({ id: "p1", companyId: "c1", name: "Farmatsevt", departmentId: "d2" } as Database["positions"][number]);
    const emp = (id: string, first: string, branchId: string, extra: Partial<Database["employees"][number]> = {}) =>
      ({ id, companyId: "c1", firstName: first, lastName: "Karimov", status: "ACTIVE", branchId, departmentId: "d2", positionId: "p1", scheduleId: "s1", startDate: "2026-01-01", employeeNo: `EMP-${id}`, phone: `+99890111${id.padStart(4, "0")}`, ...extra }) as unknown as Database["employees"][number];
    db.employees.push(emp("1", "Ozodbek", "b1"), emp("2", "Dilnoza", "b2"), emp("m", "Rahbar", "b1"));
    db.users.push({ id: "bm1", companyId: "c1", name: "BM", role: "BRANCH_MANAGER", branchIds: ["b1"] } as unknown as Database["users"][number]);
  });
  const app = express();
  app.use(express.json());
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: panel.userId, companyId: "c1", name: "HR", email: "x@t", role: panel.role };
    next();
  });
  app.use("/api", insight.createInsightRouter());
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

describe("umumiy qidiruv", () => {
  it("ism, telefon raqami, filial; filial rahbari — faqat o‘z filiali; moliya — xodimlarsiz", async () => {
    expect((await call("GET", "/api/search?q=ozod")).body.map((h: any) => h.title)).toContain("Ozodbek Karimov");
    expect((await call("GET", "/api/search?q=1110002")).body[0].title).toBe("Dilnoza Karimov");
    expect((await call("GET", "/api/search?q=filial b2")).body.some((h: any) => h.kind === "branch")).toBe(true);
    panel = { role: "BRANCH_MANAGER", userId: "bm1" };
    const bm = (await call("GET", "/api/search?q=karimov")).body.filter((h: any) => h.kind === "employee").map((h: any) => h.title);
    expect(bm).not.toContain("Dilnoza Karimov");
    panel = { role: "FINANCE", userId: "f" };
    expect((await call("GET", "/api/search?q=karimov")).body.filter((h: any) => h.kind === "employee")).toHaveLength(0);
    panel = { role: "HR_ADMIN", userId: "hr" };
  });
});

describe("tuzilma", () => {
  it("ota bo‘lim va rahbar; halqa bo‘lmaydi", async () => {
    expect((await call("PUT", "/api/org/departments/d2", { parentId: "d1", headEmployeeId: "1" })).status).toBe(200);
    expect((await call("PUT", "/api/org/departments/d1", { parentId: "d2" })).status).toBe(422);
    const tree = (await call("GET", "/api/org/tree")).body;
    const d2 = tree.departments.find((d: any) => d.id === "d2");
    expect(d2).toMatchObject({ parentId: "d1", count: 3 });
    expect(d2.head.name).toBe("Ozodbek Karimov");
    expect(tree.branches.find((b: any) => b.id === "b1").managers[0].name).toBe("Rahbar Karimov");
  });
});
