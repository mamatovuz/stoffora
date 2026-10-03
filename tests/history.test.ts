import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/* Taqvim: kun ranglari, oylik statistika, kun tafsiloti (qaydnoma: rasm + koordinata), rahbar doirasi. */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let panel = { role: "HR_ADMIN", userId: "hr" };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function get(url: string) {
  const res = await fetch(base + url);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-hist-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  const history = await import("../server/history");
  const photoId = await history.saveMarkPhoto("c1", PNG);
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE" } as Database["companies"][number]);
    // Dushanba–juma 09–18, shanba-yakshanba dam.
    db.schedules.push({ id: "s1", companyId: "c1", name: "5/2", type: "FIXED", graceMinutes: 0, overtimeEnabled: false, days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, enabled: d >= 1 && d <= 5, start: "09:00", end: "18:00" })) } as Database["schedules"][number]);
    const branch = (id: string) => ({ id, companyId: "c1", name: id.toUpperCase(), address: "", latitude: 41, longitude: 69, radiusMeters: 100, manager: "", status: "ACTIVE", scheduleId: "s1" }) as Database["branches"][number];
    db.branches.push(branch("b1"), branch("b2"));
    const emp = (id: string, branchId = "b1") => ({ id, companyId: "c1", firstName: id.toUpperCase(), lastName: "T", status: "ACTIVE", branchId, scheduleId: "s1", startDate: "2026-01-01", employeeNo: id }) as unknown as Database["employees"][number];
    db.employees.push(emp("a"), emp("d", "b2"));
    db.users.push({ id: "bm1", companyId: "c1", name: "B1", role: "BRANCH_MANAGER", branchIds: ["b1"] } as unknown as Database["users"][number]);
    const now = new Date().toISOString();
    const att = (date: string, checkIn: string, checkOut: string, late: number, extra: Partial<Database["attendance"][number]> = {}) =>
      ({ id: `att-${date}`, companyId: "c1", employeeId: "a", branchId: "b1", date, scheduledStart: "09:00", scheduledEnd: "18:00", checkIn, checkOut, lateMinutes: late, earlyLeaveMinutes: 0, workedMinutes: 540 - late, overtimeMinutes: 0, status: late ? "LATE" : "PRESENT", verification: ["FACE", "GPS"], updatedAt: now, ...extra }) as Database["attendance"][number];
    db.attendance.push(
      att("2026-09-01", "09:00", "18:00", 0, {
        marks: [
          { kind: "IN", time: "09:00", branchId: "b1", branchName: "B1", latitude: 41.0001, longitude: 69.0001, accuracy: 12, distanceMeters: 14, photoId, method: "FACE" },
          { kind: "OUT", time: "18:00", branchId: "b1", branchName: "B1", latitude: 41.0002, longitude: 69.0002, method: "FACE" },
        ],
      }),
      att("2026-09-02", "09:20", "18:00", 20, { latitude: 41.1, longitude: 69.1 }),
    );
    db.leaveRequests.push({ id: "l1", companyId: "c1", employeeId: "a", type: "SICK", startDate: "2026-09-03", endDate: "2026-09-03", reason: "kasal", status: "APPROVED", createdAt: now } as Database["leaveRequests"][number]);
  });
  const app = express();
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: panel.userId, companyId: "c1", name: "X", email: "x@t", role: panel.role };
    (req as any).employeeSession = { employeeId: "a", companyId: "c1" };
    next();
  });
  app.use("/api", history.createMiniHistoryRouter());
  app.use("/api", history.createHistoryRouter());
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => res.status(error.status || 500).json({ message: error.message }));
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

describe("taqvim", () => {
  it("o‘tgan oy: ranglar va statistika", async () => {
    const { body } = await get("/api/mini/history?month=2026-09");
    const tone = (d: string) => body.days.find((x: any) => x.date === d).tone;
    expect([tone("2026-09-01"), tone("2026-09-02"), tone("2026-09-03"), tone("2026-09-04"), tone("2026-09-06")]).toEqual(["ontime", "late", "leave", "absent", "off"]);
    // Sentabr 2026: 22 ish kuni; 1 vaqtida, 1 kech, 1 ta’til, 19 kelmagan.
    expect(body.stats).toMatchObject({ ontime: 1, late: 1, leave: 1, absent: 19, remaining: 0, lateMinutes: 20 });
    expect(body.stats.plannedMinutes).toBe(21 * 540);
  });
  it("kun tafsiloti: qaydnoma rasm va koordinata bilan; eski yozuv tiklanadi", async () => {
    const day = (await get("/api/mini/history/day?date=2026-09-01")).body;
    expect(day.marks.map((m: any) => m.kind)).toEqual(["IN", "OUT"]);
    expect(day.marks[0].photo).toMatch(/^data:image\/png;base64,/);
    expect(day.marks[0]).toMatchObject({ accuracy: 12, distanceMeters: 14, branch: { radius: 100 } });
    const old = (await get("/api/mini/history/day?date=2026-09-02")).body;
    expect(old.marks).toHaveLength(2);
    expect(old.marks[1]).toMatchObject({ kind: "OUT", latitude: 41.1 });
    expect(old.attendance.lateMinutes).toBe(20);
    const sick = (await get("/api/mini/history/day?date=2026-09-03")).body;
    expect(sick.plan.leave).toBe("SICK");
    expect(sick.requests[0].kind).toBe("Ta’til / ruxsat");
  });
  it("rahbar: o‘z filiali xodimi — ha, boshqa filial — yo‘q", async () => {
    panel = { role: "BRANCH_MANAGER", userId: "bm1" };
    expect((await get("/api/employees/a/history?month=2026-09")).status).toBe(200);
    expect((await get("/api/employees/d/history?month=2026-09")).status).toBe(404);
    panel = { role: "FINANCE", userId: "f" };
    expect((await get("/api/employees/a/history/day?date=2026-09-01")).status).toBe(403);
  });
});
