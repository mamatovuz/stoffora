import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/* Operatsiya: vazifalar (rasm majburiy), checklist (filial, hafta kuni, rasm), hodisalar (holatlar, IT doirasi), filial chegarasi. */

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let panel = { role: "HR_ADMIN", userId: "hr", name: "HR" };
let worker = "a";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-ops-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  vi.doMock("../server/integrations/hooks", () => ({ notifyEmployee: async () => undefined }));
  store = await import("../lib/store");
  const ops = await import("../server/ops");
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE" } as Database["companies"][number]);
    const branch = (id: string) => ({ id, companyId: "c1", name: id.toUpperCase(), address: "", latitude: 41, longitude: 69, radiusMeters: 100, manager: "", status: "ACTIVE" }) as Database["branches"][number];
    db.branches.push(branch("b1"), branch("b2"));
    const emp = (id: string, branchId = "b1") => ({ id, companyId: "c1", firstName: id.toUpperCase(), lastName: "Test", status: "ACTIVE", branchId, startDate: "2026-01-01", employeeNo: id }) as unknown as Database["employees"][number];
    db.employees.push(emp("a"), emp("b"), emp("d", "b2"));
    db.users.push({ id: "bm1", companyId: "c1", name: "B1", role: "BRANCH_MANAGER", branchIds: ["b1"] } as unknown as Database["users"][number]);
  });
  const app = express();
  app.use(express.json({ limit: "3mb" }));
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: panel.userId, companyId: "c1", name: panel.name, email: "x@t", role: panel.role };
    (req as any).employeeSession = { employeeId: worker, companyId: "c1" };
    next();
  });
  app.use("/api", ops.createOpsRouter());
  app.use("/api", ops.createMiniOpsRouter());
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

describe("vazifalar", () => {
  it("filialga vazifa → barcha xodimlarga; rasm majburiy bo‘lsa rasmsiz yopilmaydi", async () => {
    panel = { role: "HR_ADMIN", userId: "hr", name: "HR" };
    const created = await call("POST", "/api/tasks", { title: "Vitrina", branchId: "b1", requirePhoto: true });
    expect(created.status).toBe(201);
    expect(created.body.assigneeIds.sort()).toEqual(["a", "b"]);
    worker = "d";
    expect((await call("GET", "/api/mini/work")).body.tasks).toHaveLength(0);
    expect((await call("POST", `/api/mini/tasks/${created.body.id}/status`, { status: "DONE" })).status).toBe(404);
    worker = "a";
    expect((await call("POST", `/api/mini/tasks/${created.body.id}/status`, { status: "DONE" })).status).toBe(422);
    const done = await call("POST", `/api/mini/tasks/${created.body.id}/status`, { status: "DONE", photo: PNG });
    expect(done.body).toMatchObject({ status: "DONE", doneBy: "A Test" });
    expect(done.body.photoIds).toHaveLength(1);
    expect((await call("POST", `/api/mini/tasks/${created.body.id}/status`, { status: "IN_PROGRESS" })).status).toBe(409);
    const db = await store.readDb();
    expect(db.notifications.some((n) => !n.employeeId && n.title === "Vazifa bajarildi")).toBe(true);
    const photo = await fetch(`${base}/api/ops/photos/${done.body.photoIds[0]}`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/png");
  });
  it("filial rahbari boshqa filial xodimiga vazifa bera olmaydi va uni ko‘rmaydi", async () => {
    panel = { role: "HR_ADMIN", userId: "hr", name: "HR" };
    await call("POST", "/api/tasks", { title: "B2 ishi", assigneeIds: ["d"] });
    panel = { role: "BRANCH_MANAGER", userId: "bm1", name: "B1" };
    expect((await call("POST", "/api/tasks", { title: "Begona", assigneeIds: ["d"] })).status).toBe(422);
    const list = (await call("GET", "/api/tasks")).body;
    expect(list.tasks.map((t: any) => t.title)).toEqual(["Vitrina"]);
    expect(list.employees.map((e: any) => e.id).sort()).toEqual(["a", "b"]);
    panel = { role: "FINANCE", userId: "f", name: "F" };
    expect((await call("GET", "/api/tasks")).status).toBe(403);
  });
});

describe("checklist", () => {
  it("filial bo‘yicha band-band; rasm talab; hammasi bo‘lsa tugaydi", async () => {
    panel = { role: "HR_ADMIN", userId: "hr", name: "HR" };
    const t = await call("POST", "/api/checklists", { title: "Ochilish", branchIds: ["b1"], items: [{ text: "Chiroqlar" }, { text: "Vitrina rasmi", requirePhoto: true }] });
    expect(t.status).toBe(201);
    worker = "d";
    expect((await call("GET", "/api/mini/work")).body.checklists).toHaveLength(0);
    worker = "a";
    const run = (await call("GET", "/api/mini/work")).body.checklists[0];
    expect(run).toMatchObject({ done: 0, total: 2 });
    const [i1, i2] = t.body.items;
    expect((await call("POST", `/api/mini/checklists/${t.body.id}/items/${i2.id}`, { done: true })).status).toBe(422);
    await call("POST", `/api/mini/checklists/${t.body.id}/items/${i1.id}`, { done: true });
    worker = "b";
    const last = await call("POST", `/api/mini/checklists/${t.body.id}/items/${i2.id}`, { done: true, photo: PNG });
    expect(last.body).toMatchObject({ done: 2, total: 2 });
    expect(last.body.completedAt).toBeTruthy();
    const report = (await call("GET", "/api/checklists")).body;
    expect(report.runs.find((r: any) => r.branchId === "b1")).toMatchObject({ done: 2, total: 2 });
  });
});

describe("hodisalar", () => {
  it("xodim yuboradi → Jarayonda → Hal qilindi (izoh majburiy); IT faqat IT/jihoz", async () => {
    worker = "a";
    const hr = await call("POST", "/api/mini/incidents", { title: "Kassa printeri", category: "IT", severity: "HIGH", photo: PNG });
    expect(hr.status).toBe(201);
    await call("POST", "/api/mini/incidents", { title: "Mijoz janjali", category: "CUSTOMER" });
    panel = { role: "IT_ADMIN", userId: "it", name: "IT" };
    const list = (await call("GET", "/api/incidents")).body.incidents;
    expect(list.map((i: any) => i.title)).toEqual(["Kassa printeri"]);
    expect((await call("GET", "/api/tasks")).status).toBe(403);
    expect((await call("POST", `/api/incidents/${hr.body.id}/status`, { status: "IN_PROGRESS" })).body).toMatchObject({ status: "IN_PROGRESS", assignee: "IT" });
    expect((await call("POST", `/api/incidents/${hr.body.id}/status`, { status: "RESOLVED" })).status).toBe(422);
    const resolved = await call("POST", `/api/incidents/${hr.body.id}/status`, { status: "RESOLVED", note: "Kartrij almashtirildi" });
    expect(resolved.body.status).toBe("RESOLVED");
    expect(resolved.body.history.map((h: any) => h.status)).toEqual(["OPEN", "IN_PROGRESS", "RESOLVED"]);
    const mine = (await call("GET", "/api/mini/work")).body.incidents;
    expect(mine.find((i: any) => i.id === hr.body.id).status).toBe("RESOLVED");
    const db = await store.readDb();
    expect(db.notifications.some((n) => n.employeeId === "a" && n.title === "Hodisa: Hal qilindi")).toBe(true);
  });
  it("ops photos: begona rol / filial ko‘rmaydi; tozalashda saqlanadi", async () => {
    const db = await store.readDb();
    const { opsPhotoIds } = await import("../server/ops");
    expect(opsPhotoIds(db).length).toBeGreaterThanOrEqual(3);
    panel = { role: "FINANCE", userId: "f", name: "F" };
    expect((await fetch(`${base}/api/ops/photos/${opsPhotoIds(db)[0]}`)).status).toBe(403);
  });
});
