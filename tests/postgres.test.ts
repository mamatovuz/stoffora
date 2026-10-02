import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import pg from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Attendance, Database } from "../lib/types";

/*
 * Haqiqiy PostgreSQL bilan: SQLite → PostgreSQL ko‘chirish hech narsani yo‘qotmasligi.
 * TEST_DATABASE_URL berilganda ishlaydi (masalan postgresql://postgres@localhost:54329/postgres).
 */
const ADMIN = process.env.TEST_DATABASE_URL;
const dbName = `staffora_test_${Date.now()}`;
const dir = mkdtempSync(path.join(tmpdir(), "staffora-pg-"));
const sqliteFile = path.join(dir, "old.sqlite");
const targetUrl = ADMIN ? ADMIN.replace(/\/[^/]*$/, `/${dbName}`) : "";

async function freshStore() {
  vi.resetModules();
  return import("../lib/store");
}

describe.skipIf(!ADMIN)("SQLite → PostgreSQL ko‘chirish", () => {
  afterAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  it("barcha ma’lumot ko‘chadi, sonlar va mazmun aynan bir xil; SQLite o‘zgarmaydi", async () => {
    // 1) Eski server: SQLite’ga yozamiz.
    process.env.SQLITE_PATH = sqliteFile;
    delete process.env.DATABASE_URL;
    let store = await freshStore();
    const photo = "data:image/jpeg;base64,/9j/AAAA";
    await store.updateDb((db: Database) => {
      db.companies.push({ id: "c1", name: "Test", status: "ACTIVE" } as Database["companies"][number]);
      db.employees.push({ id: "e1", companyId: "c1", firstName: "Ali", lastName: "Valiyev", status: "ACTIVE", photoDataUrl: photo } as Database["employees"][number]);
      for (let i = 0; i < 1200; i += 1)
        db.attendance.push({ id: `a${i}`, companyId: "c1", employeeId: "e1", branchId: "b1", date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`, scheduledStart: "09:00", scheduledEnd: "18:00", checkIn: "09:0" + (i % 10), lateMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 480, overtimeMinutes: 0, status: "PRESENT", verification: ["FACE"], updatedAt: `2026-09-01T00:00:${String(i % 60).padStart(2, "0")}Z` } as Attendance);
      for (let i = 0; i < 30; i += 1) db.auditLogs.unshift(store.audit("c1", "HR", `amal ${i}`, "employee", "e1"));
      db.photoQueue.push({ id: "q1", companyId: "c1", createdAt: "2026-09-01T00:00:00Z", attempts: 1 } as Database["photoQueue"][number]);
    });
    const files = await store.documentFiles();
    await files.putFile("f1", "c1", "application/pdf", Buffer.from([1, 2, 3, 250]), "2026-09-01T00:00:00Z");
    const ops = await import("../server/integrations/sqlstore");
    await ops.logIntegration({ id: "i1", companyId: "c1" }, "info", "test", "salom", { a: 1 });
    await ops.enqueueOutbox({ id: "i1", companyId: "c1" }, "employee.create", { x: 1 }, "k1");
    const before = structuredClone(await store.readDb());
    await store.closeDb();

    // 2) Yangi baza yaratiladi, server DATABASE_URL bilan ishga tushadi → avtomatik ko‘chirish.
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    process.env.DATABASE_URL = targetUrl;
    store = await freshStore();
    const after = await store.readDb();
    expect(after.employees).toEqual(before.employees);
    expect(after.employees[0].photoDataUrl).toBe(photo);
    expect(after.attendance.length).toBe(1200);
    expect(new Map(after.attendance.map((a) => [a.id, a]))).toEqual(new Map(before.attendance.map((a) => [a.id, a])));
    expect(after.companies).toEqual(before.companies);
    expect(after.photoQueue).toEqual(before.photoQueue);
    expect((await store.queryAuditLogs("c1", { limit: 1000 })).length).toBe(30);
    expect((await (await store.documentFiles()).getFile("f1"))?.data).toEqual(Buffer.from([1, 2, 3, 250]));
    const ops2 = await import("../server/integrations/sqlstore");
    expect((await ops2.listLogs("i1", "c1"))[0]).toMatchObject({ action: "test", details: { a: 1 } });
    expect((await ops2.dueOutbox())[0]).toMatchObject({ kind: "employee.create", payload: { x: 1 } });
    // Yangi qatorlar ko‘chirilgan id’lardan keyin davom etadi.
    await ops2.logIntegration({ id: "i1", companyId: "c1" }, "info", "test2", "yana");
    expect((await ops2.listLogs("i1", "c1")).map((l) => l.action)).toEqual(["test2", "test"]);

    // 3) PostgreSQL’ga yozish va qayta ishga tushish.
    await store.updateDb((db) => {
      db.attendance.find((a) => a.id === "a5")!.checkOut = "18:30";
      db.attendance.find((a) => a.id === "a5")!.updatedAt = new Date().toISOString();
      db.attendance = db.attendance.filter((a) => a.id !== "a6");
      db.employees[0].firstName = "Vali";
    });
    await store.closeDb();
    store = await freshStore();
    const again = await store.readDb();
    expect(again.employees[0].firstName).toBe("Vali");
    expect(again.attendance.find((a) => a.id === "a5")?.checkOut).toBe("18:30");
    expect(again.attendance.some((a) => a.id === "a6")).toBe(false);
    expect(again.attendance.length).toBe(1199);
    expect(await store.checkDatabaseHealth()).toBe(true);
    await store.closeDb();

    // 4) Eski SQLite fayli o‘zgarmagan (zaxira).
    const raw = new BetterSqlite3(sqliteFile, { readonly: true });
    expect((raw.prepare("SELECT count(*) AS n FROM attendance").get() as { n: number }).n).toBe(1200);
    raw.close();
  }, 120_000);
});
