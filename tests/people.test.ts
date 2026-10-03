import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/* HR asoslari: ta’til balansi, bayramlar (grafikka ta’siri), offboarding, filialga o‘tkazish, aktivlar. */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let people: typeof import("../server/people");
let schedule: typeof import("../lib/schedule");
const panel = { role: "HR_ADMIN", name: "HR" };

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-people-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  people = await import("../server/people");
  schedule = await import("../lib/schedule");
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE", leavePolicy: { annualDays: 24 } } as Database["companies"][number]);
    db.schedules.push({ id: "s1", companyId: "c1", name: "Har kuni", type: "FIXED", graceMinutes: 0, overtimeEnabled: false, days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, enabled: true, start: "09:00", end: "18:00" })) } as Database["schedules"][number]);
    const branch = (id: string) => ({ id, companyId: "c1", name: id.toUpperCase(), address: "", latitude: 41, longitude: 69, radiusMeters: 100, manager: "", status: "ACTIVE", scheduleId: "s1" }) as Database["branches"][number];
    db.branches.push(branch("b1"), branch("b2"));
    db.employees.push({ id: "a", companyId: "c1", firstName: "Ali", lastName: "V", status: "ACTIVE", branchId: "b1", scheduleId: "s1", baseSalary: 3_000_000, startDate: "2020-01-01", employeeNo: "1" } as unknown as Database["employees"][number]);
    db.leaveRequests.push(
      { id: "l1", companyId: "c1", employeeId: "a", type: "VACATION", startDate: "2026-03-01", endDate: "2026-03-06", reason: "x", status: "APPROVED", createdAt: "" },
      { id: "l2", companyId: "c1", employeeId: "a", type: "VACATION", startDate: "2026-11-01", endDate: "2026-11-03", reason: "x", status: "PENDING", createdAt: "" },
    );
    db.mobileDevices.push({ id: "d1", companyId: "c1", employeeId: "a", publicKey: "k", keyFingerprint: "f", platform: "ios", status: "ACTIVE", createdAt: "" } as Database["mobileDevices"][number]);
  });
  const app = express();
  app.use(express.json());
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: "hr", companyId: "c1", name: panel.name, email: "x@t", role: panel.role };
    next();
  });
  app.use("/api", people.createPeopleRouter());
  app.use("/api", people.createAssetRouter());
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

describe("HR asoslari", () => {
  it("ta’til balansi: kompaniya qoidasi 24 kun, ishlatilgan 6, kutilmoqda 3, qolgan 15", async () => {
    const db = await store.readDb();
    expect(people.leaveBalance(db, db.employees[0], 2026)).toMatchObject({ annual: 24, entitled: 24, used: 6, pending: 3, remaining: 15 });
  });

  it("bayram (dam olish) — grafikda ish kuni emas; boshqa filialga tegishli bo‘lsa — ta’sir qilmaydi", async () => {
    expect((await call("POST", "/api/holidays", { date: "2026-12-08", title: "Konstitutsiya kuni", kind: "HOLIDAY", dayOff: true })).status).toBe(201);
    await call("POST", "/api/holidays", { date: "2026-12-10", title: "Faqat B2", kind: "HOLIDAY", dayOff: true, branchIds: ["b2"] });
    const db = await store.readDb();
    const e = db.employees[0];
    expect(schedule.dayPlan(db, e, "2026-12-08")).toMatchObject({ enabled: false, reason: "Konstitutsiya kuni" });
    expect(schedule.dayPlan(db, e, "2026-12-10").enabled).toBe(true);
    expect(db.notifications.some((n) => n.employeeId === "a" && n.title.includes("Konstitutsiya"))).toBe(true);
  });

  it("vaqtinchalik o‘tkazish: bugundan B2 ga, muddat tugagach B1 ga qaytadi", async () => {
    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
    const r = await call("POST", "/api/employees/a/transfer", { toBranchId: "b2", startDate: today, endDate: today, temporary: true });
    expect(r.status).toBe(201);
    let db = await store.readDb();
    expect(db.employees[0].branchId).toBe("b2");
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    await store.updateDb((d) => people.applyTransfers(d, tomorrow));
    db = await store.readDb();
    expect(db.employees[0].branchId).toBe("b1");
    expect(db.branchTransfers[0].status).toBe("DONE");
  });

  it("aktiv beriladi; offboarding qaytarilmaganini ko‘rsatadi, telefon va so‘rovlarni bekor qiladi", async () => {
    const a = await call("POST", "/api/assets", { name: "Lenovo T14", code: "LT-1", category: "LAPTOP", employeeId: "a" });
    expect(a.body.status).toBe("ISSUED");
    expect((await call("GET", "/api/employees/a/assets")).body).toHaveLength(1);
    const preview = (await call("GET", "/api/employees/a/offboarding-preview")).body;
    expect(preview).toMatchObject({ devices: 1, pending: 1 });
    expect(preview.assets[0].name).toBe("Lenovo T14");
    const result = await store.updateDb((db) => {
      const e = db.employees[0];
      e.status = "DISMISSED";
      return people.offboard(db, e, "2026-10-03", "HR");
    });
    expect(result.unreturnedAssets).toHaveLength(1);
    const db = await store.readDb();
    expect(db.mobileDevices[0].status).toBe("REVOKED");
    expect(db.leaveRequests.find((l) => l.id === "l2")?.status).toBe("CANCELLED");
    // Qaytarish
    expect((await call("POST", `/api/assets/${a.body.id}/return`, {})).body.status).toBe("IN_STOCK");
  });
});
