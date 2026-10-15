import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";
import { parseDeepLink } from "../lib/mini";

/* «Avans oluvchilar ro‘yxati» xabari: kimga boradi, matn, chuqur havola, takror yubormaslik, avtomatik yuborish. */

let dir: string;
let store: typeof import("../lib/store");
let mod: typeof import("../server/advance-announce");

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-advann-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  vi.resetModules();
  store = await import("../lib/store");
  mod = await import("../server/advance-announce");
  await store.updateDb((db: Database) => {
    db.companies.push({
      id: "c1",
      name: "Test",
      status: "ACTIVE",
      payroll: { latePenaltyMode: "NONE", latePenaltyPerMinute: 0, freeLateMinutesPerMonth: 0, monthlyHours: 176, overtimePay: false, advanceWindowFrom: 20, advanceWindowTo: 25 },
    } as Database["companies"][number]);
    const emp = (id: string, baseSalary: number, status = "ACTIVE") =>
      ({ id, companyId: "c1", firstName: id.toUpperCase(), lastName: "T", status, branchId: "b1", scheduleId: "s1", startDate: "2026-01-01", employeeNo: id, baseSalary }) as unknown as Database["employees"][number];
    // a, b — oladi; c — oyligi yo‘q; d — ishdan ketgan; e — allaqachon so‘ragan.
    db.employees.push(emp("a", 4_000_000), emp("b", 6_000_000), emp("c", 0), emp("d", 5_000_000, "DISMISSED"), emp("e", 5_000_000));
    db.advanceRequests.push({ id: "r1", companyId: "c1", employeeId: "e", month: "2026-10", amount: 500_000, status: "PENDING", createdAt: "", updatedAt: "" });
  });
});
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("avans e’loni", () => {
  it("faqat oyligi bor, faol va hali so‘ramaganlarga", async () => {
    const db = await store.readDb();
    const { recipients, requested } = mod.advanceAudience(db, "c1", "2026-10");
    expect(recipients.map((e) => e.id).sort()).toEqual(["a", "b"]);
    expect(requested).toBe(1);
  });
  it("matn: oy nomi va oyna kunlari", async () => {
    const db = await store.readDb();
    const draft = mod.advanceDraft(db, "c1", "2026-10", "2026-10-16");
    expect(draft.title).toBe("Oktabr oyi uchun avans");
    expect(draft.message).toContain("Biz oktabr oyi uchun avans oluvchilar ro‘yxatini shakllantiryapmiz. Siz ham avans oluvchilar ro‘yxatida bormisiz?");
    expect(draft.message).toContain("So‘rovlar 20–25-oktabr kunlari qabul qilinadi.");
  });
  it("chuqur havola: «advance» — oylik oynasi avans formasi bilan", () => {
    expect(parseDeepLink("advance")).toEqual({ tab: "home", action: "advance" });
    expect(parseDeepLink("go_advance")).toEqual({ tab: "home", action: "advance" });
  });
  it("yuborish: e’lon + har xodimga bildirishnoma (o‘z chegarasi bilan), takror bosish to‘xtatiladi", async () => {
    const result = await mod.sendAdvanceAnnouncement({ companyId: "c1", month: "2026-10", title: "Oktabr oyi uchun avans", message: "Ro‘yxatdamisiz?", actor: "HR", today: "2026-10-16" });
    expect(result.recipients).toBe(2);
    const db = await store.readDb();
    const announcement = db.announcements.find((a) => a.id === result.id)!;
    expect(announcement).toMatchObject({ kind: "ADVANCE", month: "2026-10", status: "SENT", report: { staffora: { recipients: 2 } } });
    const notes = db.notifications.filter((n) => n.announcementId === result.id);
    expect(notes.map((n) => n.employeeId).sort()).toEqual(["a", "b"]);
    expect(notes.every((n) => n.go === "advance" && n.type === "ANNOUNCEMENT")).toBe(true);
    // Chegara: oylikning 50% i.
    expect(notes.find((n) => n.employeeId === "a")!.body).toContain("Sizning chegarangiz: 2 000 000 so‘m.");
    await expect(mod.sendAdvanceAnnouncement({ companyId: "c1", month: "2026-10", title: "Takror", message: "Takror xabar", actor: "HR" })).rejects.toThrow(/hozirgina yuborildi/);
  });
  it("avtomatik: oyna ochilmagan kuni — yo‘q; ochilganda bir marta; avans o‘chirilsa — yo‘q", async () => {
    // 2 daqiqalik himoyadan o‘tish uchun avvalgi e’lonni eskiroq qilamiz (oyna ochilishidan oldin yuborilgan).
    await store.updateDb((db) => {
      for (const a of db.announcements) a.scheduledAt = "2026-10-01T05:00:00.000Z";
    });
    expect(await mod.runAdvanceAnnouncements("2026-10-19")).toBe(0);
    expect(await mod.runAdvanceAnnouncements("2026-10-20")).toBe(1);
    let db = await store.readDb();
    expect(db.announcements.filter((a) => a.kind === "ADVANCE" && a.auto)).toHaveLength(1);
    await store.updateDb((next) => {
      for (const a of next.announcements) a.scheduledAt = "2026-10-20T04:00:00.000Z";
    });
    expect(await mod.runAdvanceAnnouncements("2026-10-21")).toBe(0);
    await store.updateDb((next) => {
      next.companies[0].payroll!.advanceRequestsEnabled = false;
    });
    db = await store.readDb();
    expect(mod.advanceBlocker(db, "c1", "2026-11")).toMatch(/o‘chirilgan/);
    expect(await mod.runAdvanceAnnouncements("2026-11-20")).toBe(0);
  });
});
