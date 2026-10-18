import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/*
 * Mobil ilova uchun server qismlari: internetsiz belgi kadrlar bilan (yuzni server tekshiradi),
 * kelmaganlarga bir bosishda eslatma, shubhali belgi bo‘yicha rahbarga xabar (kuniga bir marta).
 */

const BASE = Array.from({ length: 128 }, (_, i) => Math.sin(i + 1) * 0.1);
// Server yuz dvigateli o‘rniga: kadr matnining birinchi harfiga qarab deskriptor (yoki yuz yo‘q).
vi.mock("../server/face-server", () => ({
  describeFace: async (photo: string) => {
    if (photo.startsWith("N")) return null;
    if (photo.startsWith("S")) return { descriptor: BASE.map((v) => v + 0.004), yaw: 0 };
    const shift = photo.startsWith("A") ? 0.004 : photo.startsWith("B") ? -0.004 : 0.006;
    return { descriptor: BASE.map((v, i) => v + (i % 2 ? shift : -shift)), yaw: 0 };
  },
}));

let dir: string;
let base: string;
let close: () => void;
let store: typeof import("../lib/store");
let actions: typeof import("../server/request-actions");
let who = "e1";

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
const photo = (letter: string) => letter.repeat(150);

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-mob-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  actions = await import("../server/request-actions");
  const offline = await import("../server/offline");
  const extra = await import("../server/mini-extra");
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE" } as Database["companies"][number]);
    db.schedules.push({ id: "s1", companyId: "c1", name: "Har kuni", type: "FIXED", graceMinutes: 0, overtimeEnabled: false, days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, enabled: true, start: "00:01", end: "23:58" })) } as Database["schedules"][number]);
    db.branches.push({ id: "b1", companyId: "c1", name: "B1", address: "", latitude: 41, longitude: 69, radiusMeters: 200, manager: "", status: "ACTIVE", scheduleId: "s1" } as Database["branches"][number]);
    const emp = (id: string) => ({ id, companyId: "c1", firstName: id.toUpperCase(), lastName: "Test", status: "ACTIVE", branchId: "b1", scheduleId: "s1", startDate: "2026-01-01", employeeNo: id }) as unknown as Database["employees"][number];
    db.employees.push(emp("e1"), emp("e2"));
    const now = new Date().toISOString();
    db.faceProfiles.push({ companyId: "c1", employeeId: "e1", descriptor: BASE, samples: [BASE], enrolledAt: now, updatedAt: now } as unknown as Database["faceProfiles"][number]);
  });
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).employeeSession = { employeeId: who, companyId: "c1" };
    (req as any).session = { userId: "hr", companyId: "c1", name: "HR", email: "hr@t", role: "HR_ADMIN" };
    next();
  });
  app.use("/api", offline.createMiniOfflineRouter());
  app.use("/api", extra.createManagerExtraRouter());
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => res.status(error.name === "ZodError" ? 400 : error.status || 500).json({ message: error.message }));
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

const item = (clientId: string, photos: string[], extra: Record<string, unknown> = {}) => ({ clientId, action: "CHECK_IN", photos, latitude: 41.0001, longitude: 69.0001, accuracy: 10, ageMs: 60_000, ...extra });

describe("internetsiz belgi — mobil ilova kadrlari", () => {
  it("yuz topilmasa yoki kadrlar bir xil bo‘lsa — rad etiladi", async () => {
    const none = await call("POST", "/api/mini/attendance/offline", { items: [item("cid-noface-1", [photo("N"), photo("A")])] });
    expect(none.body.results[0]).toMatchObject({ ok: false });
    expect(none.body.results[0].message).toMatch(/yuz aniq ko‘rinmadi/);
    const same = await call("POST", "/api/mini/attendance/offline", { items: [item("cid-same-01", [photo("S"), photo("S")])] });
    expect(same.body.results[0].message).toMatch(/Jonli yuz/);
  });
  it("kadrlar profilga mos — kelish qayd etiladi, «Internetsiz» belgisi bilan; takror yuborish — ikki marta yozilmaydi", async () => {
    const ok = await call("POST", "/api/mini/attendance/offline", { items: [item("cid-good-001", [photo("A"), photo("B"), photo("C")])] });
    expect(ok.body.results[0]).toMatchObject({ ok: true });
    const db = await store.readDb();
    const record = db.attendance.find((a) => a.employeeId === "e1")!;
    expect(record.checkIn).toBeTruthy();
    expect(record.flags).toContain("OFFLINE");
    expect(record.verification).toContain("FACE");
    const again = await call("POST", "/api/mini/attendance/offline", { items: [item("cid-good-001", [photo("A"), photo("B")])] });
    expect(again.body.results[0]).toMatchObject({ ok: true, duplicate: true });
  });
  it("yuz ham, kadr ham bo‘lmasa — 400", async () => {
    expect((await call("POST", "/api/mini/attendance/offline", { items: [{ clientId: "cid-empty-01", action: "CHECK_IN", latitude: 41, longitude: 69, ageMs: 1000 }] })).status).toBe(400);
  });
});

describe("kelmaganlarga eslatma", () => {
  it("kelmagan xodimga yuboriladi (ilovada «Kechikaman» havolasi bilan); soat ichida takrorlanmaydi; kelgan xodimga — yo‘q", async () => {
    const first = await call("POST", "/api/attendance/nudge", { employeeIds: ["e2", "e1"] });
    // e1 internetsiz testida allaqachon keldi qilgan — o‘tkazib yuboriladi.
    expect(first.body).toMatchObject({ sent: 1, skipped: 1 });
    const db = await store.readDb();
    const note = db.notifications.find((n) => n.employeeId === "e2" && n.title.includes("Hali kelmadingiz"));
    expect(note?.go).toBe("late");
    const second = await call("POST", "/api/attendance/nudge", { employeeIds: ["e2"] });
    expect(second.body).toMatchObject({ sent: 0, skipped: 1 });
  });
});

describe("shubhali belgi — rahbarga darhol", () => {
  it("kuniga bir marta; faqat «internetsiz» bo‘lsa — yuborilmaydi", async () => {
    const employee = { id: "e1", companyId: "c1", firstName: "E1", lastName: "Test" };
    const input = { branchId: "b1", branchName: "B1", date: "2026-10-18", time: "09:00", action: "CHECK_IN" as const };
    expect(await actions.alertSuspiciousMark(employee, { ...input, flags: ["OFFLINE"] })).toBe(false);
    expect(await actions.alertSuspiciousMark(employee, { ...input, flags: ["GPS_TELEPORT", "OFFLINE"] })).toBe(true);
    expect(await actions.alertSuspiciousMark(employee, { ...input, flags: ["MOCK_LOCATION"] })).toBe(false);
  });
});
