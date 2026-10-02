import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/* Ish stoli: yagona Inbox (rol/filial chegarasi), Action Center, Control Center, smena markazi, IT, xodim tarixi. */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let panel = { role: "HR_ADMIN", userId: "hr" };
const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

async function get(url: string) {
  const res = await fetch(base + url);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-ws-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  const ws = await import("../server/workspace");
  const now = new Date().toISOString();
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE", payroll: { advanceHrApproval: true } } as Database["companies"][number]);
    db.schedules.push({ id: "s1", companyId: "c1", name: "Har kuni", type: "FIXED", graceMinutes: 0, overtimeEnabled: false, days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, enabled: true, start: "00:01", end: "23:58" })) } as Database["schedules"][number]);
    const branch = (id: string, requiredStaff?: number) => ({ id, companyId: "c1", name: id.toUpperCase(), address: "", latitude: 41, longitude: 69, radiusMeters: 100, manager: "", status: "ACTIVE", scheduleId: "s1", requiredStaff }) as Database["branches"][number];
    db.branches.push(branch("b1", 5), branch("b2"));
    const emp = (id: string, branchId = "b1") => ({ id, companyId: "c1", firstName: id.toUpperCase(), lastName: "Test", status: "ACTIVE", branchId, scheduleId: "s1", baseSalary: 1_000_000, startDate: "2026-01-01", employeeNo: id, phone: "+998900000000" }) as unknown as Database["employees"][number];
    db.employees.push(emp("a"), emp("b"), emp("c", "b2"));
    db.users.push({ id: "bm1", companyId: "c1", name: "B1", role: "BRANCH_MANAGER", branchIds: ["b1"] } as unknown as Database["users"][number]);
    db.attendanceCorrections.push(
      { id: "corr1", companyId: "c1", employeeId: "a", date: today(), time: "09:00", kind: "IN", branchId: "b1", comment: "unutdim", status: "PENDING", createdAt: now, updatedAt: now },
      { id: "corr2", companyId: "c1", employeeId: "c", date: today(), time: "09:00", kind: "IN", branchId: "b2", comment: "unutdim", status: "PENDING", createdAt: now, updatedAt: now },
    );
    db.advanceRequests.push(
      { id: "adv1", companyId: "c1", employeeId: "a", month: today().slice(0, 7), amount: 300_000, status: "PENDING", createdAt: now, updatedAt: now } as Database["advanceRequests"][number],
      { id: "adv2", companyId: "c1", employeeId: "b", month: today().slice(0, 7), amount: 400_000, status: "HR_APPROVED", createdAt: now, updatedAt: now } as Database["advanceRequests"][number],
    );
    db.deviceChangeRequests.push({ id: "dev1", companyId: "c1", employeeId: "b", publicKey: "x", keyFingerprint: "y", platform: "ios", model: "iPhone", status: "PENDING", createdAt: now } as Database["deviceChangeRequests"][number]);
    db.attendance.push({ id: "att1", companyId: "c1", employeeId: "a", branchId: "b1", date: today(), scheduledStart: "00:01", scheduledEnd: "23:58", checkIn: "00:30", lateMinutes: 29, earlyLeaveMinutes: 0, workedMinutes: 0, overtimeMinutes: 0, status: "LATE", verification: [], updatedAt: now } as unknown as Database["attendance"][number]);
  });
  const app = express();
  app.use(express.json());
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: panel.userId, companyId: "c1", name: "X", email: "x@t", role: panel.role };
    next();
  });
  app.use("/api", ws.createWorkspaceRouter());
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

const kinds = (items: any[]) => items.map((i) => `${i.kind}:${i.id}`).sort();

describe("yagona Inbox — rolga qarab", () => {
  it("HR: belgilashlar, avansning HR bosqichi, telefon almashtirish (moliya bosqichi — yo‘q)", async () => {
    panel = { role: "HR_ADMIN", userId: "hr" };
    const { body } = await get("/api/workspace/inbox");
    expect(kinds(body)).toEqual(["advance:adv1", "correction:corr1", "correction:corr2", "device:dev1"]);
    expect(body.find((i: any) => i.kind === "device").urgent).toBe(true);
    expect(body.find((i: any) => i.kind === "correction").decide.path).toContain("/attendance-corrections/");
  });
  it("Moliya: faqat moliya bosqichidagi avans", async () => {
    panel = { role: "FINANCE", userId: "f" };
    expect(kinds((await get("/api/workspace/inbox")).body)).toEqual(["advance:adv2"]);
  });
  it("IT: faqat telefon almashtirish", async () => {
    panel = { role: "IT_ADMIN", userId: "it" };
    expect(kinds((await get("/api/workspace/inbox")).body)).toEqual(["device:dev1"]);
  });
  it("Filial rahbari: faqat o‘z filiali belgilashlari", async () => {
    panel = { role: "BRANCH_MANAGER", userId: "bm1" };
    expect(kinds((await get("/api/workspace/inbox")).body)).toEqual(["correction:corr1"]);
  });
});

describe("Action Center va markazlar", () => {
  it("Direktor: bugun, filiallar, oy pullari; harakatlar ro‘yxati", async () => {
    panel = { role: "COMPANY_OWNER", userId: "o" };
    const o = (await get("/api/workspace/overview")).body;
    expect(o.today).toMatchObject({ employees: 3, planned: 3, came: 1, late: 1 });
    expect(o.money).toBeTruthy();
    expect(o.branches.map((b: any) => b.id).sort()).toEqual(["b1", "b2"]);
    const a = (await get("/api/workspace/actions")).body;
    expect(a.inbox.total).toBeGreaterThan(0);
    expect(a.actions.some((x: any) => x.text.includes("telefon almashtirish"))).toBe(true);
  });
  it("HR: moliyaviy summalar yo‘q (money: null)", async () => {
    panel = { role: "HR_ADMIN", userId: "hr" };
    expect((await get("/api/workspace/overview")).body.money).toBeNull();
  });
  it("Filial rahbari: smena markazi — bugun va ertaga (kerak 5, rejada 2 → 3 yetishmaydi)", async () => {
    panel = { role: "BRANCH_MANAGER", userId: "bm1" };
    const s = (await get("/api/workspace/branch-shift")).body;
    expect(s).toHaveLength(1);
    expect(s[0].today).toMatchObject({ planned: 2, came: 1, late: 1 });
    expect(s[0].issues.some((i: any) => i.text.includes("kechikdi"))).toBe(true);
    expect(s[0].tomorrow).toMatchObject({ planned: 2, required: 5, shortage: 3 });
  });
  it("IT: qurilmalar markazi bor, moliya uchun — yo‘q", async () => {
    panel = { role: "IT_ADMIN", userId: "it" };
    expect((await get("/api/workspace/devices")).body.stats.replacement).toBe(1);
    panel = { role: "FINANCE", userId: "f" };
    expect((await get("/api/workspace/devices")).status).toBe(403);
  });
  it("HR: xodim tarixi va onboarding; filial rahbari boshqa filial xodimini ko‘rmaydi", async () => {
    panel = { role: "HR_ADMIN", userId: "hr" };
    const l = (await get("/api/workspace/employees/a/lifecycle")).body;
    expect(l.onboarding.total).toBeGreaterThan(5);
    expect(l.onboarding.steps.find((s: any) => s.key === "first").done).toBe(true);
    expect(l.timeline.some((e: any) => e.text === "Ishga qabul qilindi")).toBe(true);
    panel = { role: "BRANCH_MANAGER", userId: "bm1" };
    expect((await get("/api/workspace/employees/c/lifecycle")).status).toBe(404);
  });
});
