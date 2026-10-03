import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";
import { categoryOfRouting, categoryOfType, wantsPush } from "../lib/notify-prefs";

/* E’lonlar 2.0 (kim o‘qidi/tasdiqladi/javob, eslatma), bildirishnoma sozlamalari. */

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
  dir = mkdtempSync(path.join(tmpdir(), "staffora-engage-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  vi.doMock("../server/telegram", () => ({ sendTelegramMessage: async () => true }));
  store = await import("../lib/store");
  const engage = await import("../server/engage");
  const now = new Date().toISOString();
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Test", status: "ACTIVE" } as Database["companies"][number]);
    const branch = (id: string) => ({ id, companyId: "c1", name: id.toUpperCase(), status: "ACTIVE" }) as Database["branches"][number];
    db.branches.push(branch("b1"), branch("b2"));
    const emp = (id: string, branchId: string) => ({ id, companyId: "c1", firstName: id.toUpperCase(), lastName: "T", status: "ACTIVE", branchId }) as unknown as Database["employees"][number];
    db.employees.push(emp("a", "b1"), emp("b", "b1"), emp("c", "b2"));
    db.users.push({ id: "bm1", companyId: "c1", name: "B1", role: "BRANCH_MANAGER", branchIds: ["b2"] } as unknown as Database["users"][number]);
    db.announcements.push({ id: "an1", companyId: "c1", title: "Yig‘ilish", message: "Ertaga 9:00", audience: "Barcha", channel: ["STAFFORA"], scheduledAt: now, status: "SENT", ackRequired: true, options: ["Boraman", "Bormayman"], report: {} } as Database["announcements"][number]);
    const note = (id: string, employeeId: string, extra: Partial<Database["notifications"][number]> = {}) =>
      ({ id, companyId: "c1", employeeId, title: "📢 Yig‘ilish", body: "Ertaga 9:00", type: "ANNOUNCEMENT", read: false, createdAt: now, announcementId: "an1", ackRequired: true, options: ["Boraman", "Bormayman"], pushedAt: now, ...extra }) as Database["notifications"][number];
    db.notifications.push(note("n1", "a", { read: true, readAt: now, ackAt: now, answer: "Boraman" }), note("n2", "b", { read: true, readAt: now }), note("n3", "c"));
  });
  const app = express();
  app.use(express.json());
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: panel.userId, companyId: "c1", name: "HR", email: "x@t", role: panel.role };
    (req as any).employeeSession = { employeeId: "a", companyId: "c1" };
    next();
  });
  app.use("/api", engage.createEngageRouter());
  app.use("/api", engage.createMiniEngageRouter());
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => res.status(error.status || (error.name === "ZodError" ? 400 : 500)).json({ message: error.message }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => {
  close?.();
  vi.doUnmock("../server/telegram");
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("e’lon statistikasi va eslatma", () => {
  it("kim o‘qidi / tanishdi / javob berdi; filial rahbari — faqat o‘z filiali", async () => {
    const s = (await call("GET", "/api/announcements/an1/stats")).body;
    expect(s.totals).toEqual({ recipients: 3, read: 2, acked: 1, answered: 1 });
    expect(s.answers).toEqual({ Boraman: 1, Bormayman: 0 });
    expect(s.rows[0].name).toBe("C T"); // o‘qimaganlar tepada
    panel = { role: "BRANCH_MANAGER", userId: "bm1" };
    expect((await call("GET", "/api/announcements/an1/stats")).body.totals.recipients).toBe(1);
    panel = { role: "HR_ADMIN", userId: "hr" };
  });
  it("tasdiqlamaganlarga eslatma — bildirishnoma qayta «yangi», push qayta ketadi; soatiga bir marta", async () => {
    const r = await call("POST", "/api/announcements/an1/remind", { who: "unacked" });
    expect(r.body.reminded).toBe(2);
    const db = await store.readDb();
    const n2 = db.notifications.find((n) => n.id === "n2")!;
    expect(n2.read).toBe(false);
    expect(n2.pushedAt).toBeUndefined();
    expect(n2.reminded).toBe(1);
    expect(db.notifications.find((n) => n.id === "n1")!.read).toBe(true);
    expect((await call("POST", "/api/announcements/an1/remind", { who: "unread" })).status).toBe(429);
  });
});

describe("bildirishnoma sozlamalari", () => {
  it("xodim toifani o‘chiradi — push / Telegram filtri", async () => {
    const before = (await call("GET", "/api/mini/notify-prefs")).body;
    expect(before.categories.every((c: any) => c.enabled)).toBe(true);
    await call("PUT", "/api/mini/notify-prefs", { money: false, celebrations: false });
    const after = (await call("GET", "/api/mini/notify-prefs")).body;
    expect(after.categories.find((c: any) => c.key === "money").enabled).toBe(false);
    const db = await store.readDb();
    const prefs = db.employees.find((e) => e.id === "a")!.notifyPrefs;
    expect(wantsPush(prefs, categoryOfType("PAYROLL"))).toBe(false);
    expect(wantsPush(prefs, categoryOfType("ATTENDANCE"))).toBe(true);
    expect(wantsPush(prefs, categoryOfType("SECURITY"))).toBe(true);
    expect(wantsPush(prefs, categoryOfRouting("payroll"))).toBe(false);
    // Majburiy tasdiqli e’lon — o‘chirilgan bo‘lsa ham keladi.
    expect(wantsPush({ announcements: false }, categoryOfType("ANNOUNCEMENT"), true)).toBe(true);
    expect((await call("PUT", "/api/mini/notify-prefs", { hack: false })).status).toBe(400);
  });
});
