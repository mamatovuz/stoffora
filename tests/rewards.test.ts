import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/* Rag‘batlantirish: N ish kuni ketma-ket vaqtida → bonus shu oy oyligiga, bir marta; boshqalarga motivatsiya. */

let dir: string;
let store: typeof import("../lib/store");
let rewards: typeof import("../server/rewards");
let reports: typeof import("../server/reports");
const TODAY = "2026-10-20";
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-rew-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  rewards = await import("../server/rewards");
  reports = await import("../server/reports");
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE", rewards: { enabled: true, announce: true, rules: [{ days: 10, amount: 100_000 }, { days: 20, amount: 250_000 }] } } as Database["companies"][number]);
    db.schedules.push({ id: "s1", companyId: "c1", name: "Har kuni", type: "FIXED", graceMinutes: 0, overtimeEnabled: false, days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, enabled: true, start: "09:00", end: "18:00" })) } as Database["schedules"][number]);
    const emp = (id: string) => ({ id, companyId: "c1", firstName: id.toUpperCase(), lastName: "Test", status: "ACTIVE", branchId: "b1", scheduleId: "s1", baseSalary: 3_000_000, startDate: "2026-01-01", employeeNo: id }) as unknown as Database["employees"][number];
    db.employees.push(emp("ali"), emp("vali"));
    // Ali: 12 kun ketma-ket vaqtida (9–20), undan oldin 8-oktabr kechikkan.
    for (let n = 8; n <= 20; n += 1)
      db.attendance.push({ id: `a${n}`, companyId: "c1", employeeId: "ali", branchId: "b1", date: day(n), scheduledStart: "09:00", scheduledEnd: "18:00", checkIn: n === 8 ? "09:30" : "08:55", lateMinutes: n === 8 ? 30 : 0, earlyLeaveMinutes: 0, workedMinutes: 0, overtimeMinutes: 0, status: "PRESENT", verification: [], updatedAt: "" } as unknown as Database["attendance"][number]);
  });
});
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("rag‘batlantirish", () => {
  it("seriya hisoblanadi: kechikkan kun uzadi", async () => {
    const db = await store.readDb();
    expect(rewards.currentRun(db, db.employees.find((e) => e.id === "ali")!, TODAY)).toEqual({ count: 12, since: day(9) });
  });

  it("10 kun bosqichi — bonus bir marta, oylikka qo‘shiladi, boshqalarga xabar", async () => {
    const first = await store.updateDb((db) => rewards.awardRewards(db, "c1", TODAY));
    expect(first.map((a) => [a.employee.id, a.days, a.amount])).toEqual([["ali", 10, 100_000]]);
    const again = await store.updateDb((db) => rewards.awardRewards(db, "c1", TODAY));
    expect(again).toHaveLength(0);
    const db = await store.readDb();
    expect(reports.payrollRows(db, "c1", "2026-10").find((r) => r.employee.id === "ali")!.bonus).toBe(100_000);
    expect(db.notifications.some((n) => n.employeeId === "ali" && n.title.includes("Mukofot"))).toBe(true);
    expect(db.notifications.some((n) => n.employeeId === "vali" && n.body.includes("ALI Test"))).toBe(true);
  });
});
