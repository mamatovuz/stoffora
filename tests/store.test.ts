import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attendance, Database } from "../lib/types";

let dir: string;
type Store = typeof import("../lib/store");

async function freshStore(): Promise<Store> {
  // Modulni qayta yuklash = server qayta ishga tushishi (xotira bo‘sh, diskdan o‘qiladi).
  vi.resetModules();
  return import("../lib/store");
}

function attendance(id: string, employeeId: string, date: string): Attendance {
  return {
    id,
    companyId: "c1",
    employeeId,
    branchId: "b1",
    date,
    scheduledStart: "09:00",
    scheduledEnd: "18:00",
    checkIn: "09:00",
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    workedMinutes: 0,
    overtimeMinutes: 0,
    status: "WORKING",
    verification: ["MANUAL"],
    updatedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-store-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  delete process.env.BOOTSTRAP_COMPANY_NAME;
  delete process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL;
});
afterEach(() => {
  delete process.env.SQLITE_PATH;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows fayl qulfi — muhim emas */
  }
});

describe("saqlash qatlami", () => {
  it("yozuvlar qayta ishga tushgandan keyin ham saqlanadi", async () => {
    let store = await freshStore();
    await store.updateDb((db) => {
      db.companies.push({ id: "c1", name: "A", slug: "a", ownerName: "O", plan: "B", status: "ACTIVE", timezone: "Asia/Tashkent", createdAt: "" });
      db.attendance.push(attendance("a1", "e1", "2026-09-01"));
      db.auditLogs.unshift(store.audit("c1", "t", "amal", "employee", "e1"));
    });
    await store.flushDb();
    store = await freshStore();
    const db = await store.readDb();
    expect(db.companies.map((c) => c.id)).toEqual(["c1"]);
    expect(db.attendance.map((a) => a.id)).toEqual(["a1"]);
    expect((await store.queryAuditLogs("c1", { entityId: "e1" })).length).toBe(1);
  });

  it("xato bergan amal xotirani buzmaydi, shu partiyadagi boshqalar saqlanadi", async () => {
    const store = await freshStore();
    await store.readDb();
    const ok1 = store.updateDb((db) => db.departments.push({ id: "d1", companyId: "c1", name: "Birinchi" }));
    const bad = store.updateDb((db) => {
      db.departments.push({ id: "bad", companyId: "c1", name: "Yarim" });
      db.attendance.push(attendance("bad-a", "e1", "2026-09-02"));
      throw new Error("tekshiruv xatosi");
    });
    const ok2 = store.updateDb((db) => db.departments.push({ id: "d2", companyId: "c1", name: "Ikkinchi" }));
    await ok1;
    await expect(bad).rejects.toThrow("tekshiruv xatosi");
    await ok2;
    const db = await store.readDb();
    expect(db.departments.map((d) => d.id).sort()).toEqual(["d1", "d2"]);
    expect(db.attendance.find((a) => a.id === "bad-a")).toBeUndefined();
    const reloaded = await (await freshStore()).readDb();
    expect(reloaded.departments.map((d) => d.id).sort()).toEqual(["d1", "d2"]);
  });

  it("davomat: o‘zgartirish va o‘chirish diskka tushadi", async () => {
    let store = await freshStore();
    await store.updateDb((db) => {
      db.attendance.push(attendance("a1", "e1", "2026-09-01"), attendance("a2", "e2", "2026-09-01"));
    });
    await store.updateDb((db) => {
      const row = db.attendance.find((a) => a.id === "a1")!;
      row.checkOut = "18:00";
      row.updatedAt = new Date(Date.now() + 1000).toISOString();
      db.attendance = db.attendance.filter((a) => a.id !== "a2");
    });
    store = await freshStore();
    const db = await store.readDb();
    expect(db.attendance.map((a) => a.id)).toEqual(["a1"]);
    expect(db.attendance[0].checkOut).toBe("18:00");
  });

  it("rasmlar asosiy JSON’da emas, alohida jadvalda saqlanadi", async () => {
    let store = await freshStore();
    const photo = `data:image/jpeg;base64,${"A".repeat(5000)}`;
    await store.updateDb((db) => {
      db.users.push({ id: "u1", companyId: "c1", name: "U", email: "u@t.uz", passwordHash: "x", role: "COMPANY_OWNER", photoDataUrl: photo });
    });
    await store.flushDb();
    const raw = new BetterSqlite3(process.env.SQLITE_PATH!, { readonly: true });
    const core = (raw.prepare("SELECT payload FROM app_state").get() as { payload: string }).payload;
    const media = raw.prepare("SELECT key FROM media").all() as { key: string }[];
    raw.close();
    expect(core.includes("base64")).toBe(false);
    expect(media.map((m) => m.key)).toEqual(["user:u1"]);
    store = await freshStore();
    expect((await store.readDb()).users[0].photoDataUrl).toBe(photo);
  });

  it("eski formatdagi (hammasi bitta JSON) bazani avtomatik ko‘chiradi", async () => {
    const raw = new BetterSqlite3(process.env.SQLITE_PATH!);
    raw.exec("CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL)");
    const legacy: Partial<Database> = {
      companies: [{ id: "c1", name: "A", slug: "a", ownerName: "O", plan: "B", status: "ACTIVE", timezone: "Asia/Tashkent", createdAt: "" }],
      users: [{ id: "u1", companyId: "c1", name: "U", email: "u@t.uz", passwordHash: "x", role: "COMPANY_OWNER" }],
      employees: [],
      attendance: [attendance("a1", "e1", "2026-09-01"), attendance("a2", "e1", "2026-09-02")],
      auditLogs: [{ id: "l1", companyId: "c1", actor: "t", action: "x", entity: "e", entityId: "e1", createdAt: "2026-09-01T00:00:00Z" }],
    };
    raw.prepare("INSERT INTO app_state VALUES (1, ?, ?)").run(JSON.stringify(legacy), "now");
    raw.close();
    const store = await freshStore();
    const db = await store.readDb();
    expect(db.attendance.length).toBe(2);
    expect((await store.queryAuditLogs("c1")).map((l) => l.id)).toEqual(["l1"]);
    const check = new BetterSqlite3(process.env.SQLITE_PATH!, { readonly: true });
    const core = JSON.parse((check.prepare("SELECT payload FROM app_state").get() as { payload: string }).payload);
    check.close();
    expect(core.attendance).toEqual([]);
  });

  it("indekslar ma’lumot o‘zgarganda yangilanadi", async () => {
    const store = await freshStore();
    await store.updateDb((db) => db.attendance.push(attendance("a1", "e1", "2026-09-01")));
    const db = await store.readDb();
    expect(store.dataIndexes(db).attendanceByKey.has("e1|2026-09-01")).toBe(true);
    await store.updateDb((next) => next.attendance.push(attendance("a2", "e2", "2026-09-01")));
    expect(store.dataIndexes(db).attendanceByKey.has("e2|2026-09-01")).toBe(true);
  });
});
