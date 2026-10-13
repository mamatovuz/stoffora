import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayrollPeriod } from "../lib/types";

/* Yadro qatorlari (3-sxema): faqat o‘zgargan qatorlar yoziladi, tartib va orqaga qaytish saqlanadi. */
let dir: string;
const freshStore = async () => {
  vi.resetModules();
  return import("../lib/store");
};
const rows = () => {
  const raw = new BetterSqlite3(process.env.SQLITE_PATH!, { readonly: true });
  const list = raw.prepare("SELECT collection, id, payload, updated_at FROM core_rows").all() as { collection: string; id: string; payload: string; updated_at: string }[];
  raw.close();
  return list;
};
const dept = (id: string, name = id) => ({ id, companyId: "c1", name });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-rows-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  delete process.env.BOOTSTRAP_COMPANY_NAME;
  delete process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL;
});
afterEach(async () => {
  (await import("../lib/store")).closeDb().catch(() => undefined);
  delete process.env.SQLITE_PATH;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows fayl qulfi */
  }
});

describe("yadro qatorlari", () => {
  it("har bir yozuv alohida qator; o‘zgarmagan qatorlar qayta yozilmaydi", async () => {
    const store = await freshStore();
    await store.updateDb((db) => db.departments.push(dept("d1"), dept("d2"), dept("d3")));
    await store.flushDb();
    const before = new Map(rows().filter((r) => r.collection === "departments").map((r) => [r.id, r.updated_at]));
    expect([...before.keys()].sort()).toEqual(["\u0000order", "d1", "d2", "d3"]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.updateDb((db) => {
      db.departments.find((d) => d.id === "d2")!.name = "Yangi nom";
    });
    await store.flushDb();
    const after = new Map(rows().filter((r) => r.collection === "departments").map((r) => [r.id, r.updated_at]));
    expect(after.get("d2")).not.toBe(before.get("d2"));
    expect(after.get("d1")).toBe(before.get("d1"));
    expect(after.get("d3")).toBe(before.get("d3"));
    expect(after.get("\u0000order")).toBe(before.get("\u0000order")); // tartib o‘zgarmadi
  });

  it("tartib, o‘chirish va qayta ishga tushirish", async () => {
    let store = await freshStore();
    await store.updateDb((db) => db.departments.push(dept("a"), dept("b"), dept("c")));
    await store.updateDb((db) => {
      db.departments.unshift(dept("z"));
      db.departments = db.departments.filter((d) => d.id !== "b");
    });
    await store.flushDb();
    expect(rows().some((r) => r.collection === "departments" && r.id === "b")).toBe(false);
    store = await freshStore();
    expect((await store.readDb()).departments.map((d) => d.id)).toEqual(["z", "a", "c"]);
  });

  it("xato bergan amal faqat o‘zi o‘zgartirgan qatorlarni qaytaradi", async () => {
    const store = await freshStore();
    await store.updateDb((db) => db.departments.push(dept("d1", "Asl")));
    const db = await store.readDb();
    const untouched = db.departments[0];
    await expect(
      store.updateDb((next) => {
        next.departments[0].name = "Buzilgan";
        next.departments.push(dept("d2"));
        throw new Error("validatsiya");
      }),
    ).rejects.toThrow("validatsiya");
    const after = await store.readDb();
    expect(after.departments.map((d) => [d.id, d.name])).toEqual([["d1", "Asl"]]);
    expect(untouched.name).toBe("Buzilgan"); // eski havola — tiklangan qator yangi obyekt
  });

  it("yopilgan oy qatorlari muzlatiladi; o‘zgartirishga urinish amalni bekor qiladi", async () => {
    const store = await freshStore();
    const period: PayrollPeriod = {
      id: "p1",
      companyId: "c1",
      month: "2026-09",
      closedAt: "2026-10-01T00:00:00Z",
      closedBy: "HR",
      total: 100,
      lines: [{ employeeId: "e1", employeeNo: "1", name: "Ali", base: 100, days: 22, expectedDays: 22, absentDays: 0, lateMinutes: 0, overtimeAmount: 0, bonus: 0, lateDeduction: 0, absenceDeduction: 0, fine: 0, advance: 0, net: 100, explanation: "" }],
    };
    await store.updateDb((db) => db.payrollPeriods.push(period));
    await expect(
      store.updateDb((db) => {
        db.payrollPeriods[0].lines[0].net = 999;
      }),
    ).rejects.toThrow();
    // Bosh qism (masalan, hisob varaqalari yuborilgan vaqt) o‘zgaradi
    await store.updateDb((db) => {
      db.payrollPeriods[0].payslipsSentAt = "2026-10-02T00:00:00Z";
    });
    await store.flushDb();
    const fresh = await freshStore();
    const saved = (await fresh.readDb()).payrollPeriods[0];
    expect(saved.lines[0].net).toBe(100);
    expect(saved.payslipsSentAt).toBe("2026-10-02T00:00:00Z");
  });
});
