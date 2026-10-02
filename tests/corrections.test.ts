import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/*
 * Belgilash so‘rovi: xodim unutgan kirish/chiqishni so‘raydi → HR / filial rahbari tasdiqlaydi →
 * davomatga yoziladi. Haqiqiy routerlar + vaqtinchalik SQLite.
 */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let auth: typeof import("../server/auth");
let format: typeof import("../lib/format");
let panel = { role: "HR_MANAGER", userId: "hr" };

async function call(method: string, url: string, body?: unknown, token?: string) {
  const res = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
const tokenOf = (employeeId: string) => auth.signEmployeeSession({ employeeId, companyId: "c1", telegramId: `dev-${employeeId}`, kind: "employee" });
const yesterday = () => {
  const d = new Date(`${format.tashkentIsoDate()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-corr-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  auth = await import("../server/auth");
  format = await import("../lib/format");
  const corrections = await import("../server/corrections");
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE" } as Database["companies"][number]);
    const branch = (id: string) => ({ id, companyId: "c1", name: id.toUpperCase(), address: "", latitude: 41, longitude: 69, radiusMeters: 100, manager: "", status: "ACTIVE", scheduleId: "" }) as Database["branches"][number];
    db.branches.push(branch("b1"), branch("b2"));
    db.positions.push({ id: "p-any", companyId: "c1", name: "HR", departmentId: "d", anyBranch: true } as Database["positions"][number]);
    const emp = (id: string, extra = {}) => ({ id, companyId: "c1", firstName: id.toUpperCase(), lastName: "Test", status: "ACTIVE", branchId: "b1", telegramId: `dev-${id}`, ...extra }) as unknown as Database["employees"][number];
    db.employees.push(emp("a"), emp("hr", { positionId: "p-any" }));
    db.users.push({ id: "bm2", companyId: "c1", name: "B2 rahbar", role: "BRANCH_MANAGER", branchIds: ["b2"] } as unknown as Database["users"][number]);
  });
  const app = express();
  app.use(express.json());
  app.use("/api/mini", auth.requireEmployee);
  app.use("/api", corrections.createMiniCorrectionRouter());
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: panel.userId, companyId: "c1", name: "Panel", email: "p@t", role: panel.role };
    next();
  });
  app.use("/api", corrections.createCorrectionRouter());
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

describe("belgilash so‘rovi", () => {
  it("oddiy xodim — faqat o‘z filiali; boshqa filialni tanlay olmaydi", async () => {
    const info = await call("GET", "/api/mini/corrections", undefined, tokenOf("a"));
    expect(info.body.canChooseBranch).toBe(false);
    expect(info.body.branches.map((b: any) => b.id)).toEqual(["b1"]);
    const res = await call("POST", "/api/mini/corrections", { date: yesterday(), time: "09:00", kind: "IN", branchId: "b2", comment: "Unutib qoldim" }, tokenOf("a"));
    expect(res.status).toBe(422);
  });

  it("«istalgan filial» lavozimidagi xodim filial tanlaydi", async () => {
    const info = await call("GET", "/api/mini/corrections", undefined, tokenOf("hr"));
    expect(info.body.canChooseBranch).toBe(true);
    const res = await call("POST", "/api/mini/corrections", { date: yesterday(), time: "10:00", kind: "IN", branchId: "b2", comment: "B2 filialida edim" }, tokenOf("hr"));
    expect(res.status).toBe(201);
    expect(res.body.branchName).toBe("B2");
  });

  it("kirishsiz chiqish so‘rovi va kelajak vaqti rad etiladi", async () => {
    const d = yesterday();
    expect((await call("POST", "/api/mini/corrections", { date: d, time: "18:00", kind: "OUT", comment: "Chiqishni unutdim" }, tokenOf("a"))).status).toBe(422);
    expect((await call("POST", "/api/mini/corrections", { date: "2999-01-01", time: "09:00", kind: "IN", comment: "Kelajak" }, tokenOf("a"))).status).toBe(422);
  });

  it("kirish + chiqish so‘rovi → HR tasdiqlaydi → davomat yoziladi, panelda bildirishnoma bor", async () => {
    const d = yesterday();
    const inReq = await call("POST", "/api/mini/corrections", { date: d, time: "09:05", kind: "IN", comment: "Telefon o‘chib qolgan" }, tokenOf("a"));
    expect(inReq.status).toBe(201);
    const outReq = await call("POST", "/api/mini/corrections", { date: d, time: "18:10", kind: "OUT", comment: "Chiqishni unutdim" }, tokenOf("a"));
    expect(outReq.status).toBe(201);
    // Takror yuborilmaydi.
    expect((await call("POST", "/api/mini/corrections", { date: d, time: "18:20", kind: "OUT", comment: "Yana" }, tokenOf("a"))).status).toBe(409);

    const db0 = await store.readDb();
    expect(db0.notifications.some((n) => !n.employeeId && n.go === `/attendance-requests?id=${inReq.body.id}`)).toBe(true);

    panel = { role: "HR_MANAGER", userId: "hr" };
    const list = await call("GET", "/api/attendance-corrections?status=PENDING");
    expect(list.body.map((r: any) => r.id)).toEqual(expect.arrayContaining([inReq.body.id, outReq.body.id]));
    // Chiqishni kirishdan oldin tasdiqlab bo‘lmaydi.
    expect((await call("POST", `/api/attendance-corrections/${outReq.body.id}/decide`, { approve: true })).status).toBe(409);
    expect((await call("POST", `/api/attendance-corrections/${inReq.body.id}/decide`, { approve: true })).status).toBe(200);
    expect((await call("POST", `/api/attendance-corrections/${outReq.body.id}/decide`, { approve: true })).status).toBe(200);
    // Qayta qaror — yo‘q.
    expect((await call("POST", `/api/attendance-corrections/${outReq.body.id}/decide`, { approve: false })).status).toBe(409);

    const db = await store.readDb();
    const record = db.attendance.find((a) => a.employeeId === "a" && a.date === d)!;
    expect(record.checkIn).toBe("09:05");
    expect(record.checkOut).toBe("18:10");
    expect(record.verification).toContain("MANUAL");
    expect(db.notifications.some((n) => n.employeeId === "a" && n.title === "Belgilash so‘rovi tasdiqlandi")).toBe(true);
  });

  it("filial rahbari faqat o‘z filiali so‘rovlarini ko‘radi va hal qiladi", async () => {
    panel = { role: "BRANCH_MANAGER", userId: "bm2" };
    const list = await call("GET", "/api/attendance-corrections?status=PENDING");
    expect(list.body.length).toBe(1);
    expect(list.body[0].branchId).toBe("b2");
    const res = await call("POST", `/api/attendance-corrections/${list.body[0].id}/decide`, { approve: false, note: "Tasdiqlanmadi" });
    expect(res.body.status).toBe("REJECTED");
    expect(res.body.decidedNote).toBe("Tasdiqlanmadi");
    // B1 filialidagi tarix ko‘rinmaydi.
    const all = await call("GET", "/api/attendance-corrections");
    expect(all.body.every((r: any) => r.branchId === "b2")).toBe(true);
  });

  it("panel ruxsati yo‘q rol (moliya) — 403", async () => {
    panel = { role: "FINANCE", userId: "f" };
    expect((await call("GET", "/api/attendance-corrections")).status).toBe(403);
  });
});
