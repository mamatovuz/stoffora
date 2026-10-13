import { describe, expect, it } from "vitest";
import { createSeed } from "../lib/seed";
import type { Database, User } from "../lib/types";
import { digestPeriod, digestRecipients } from "../server/report-digest";

describe("avtomatik hisobot", () => {
  it("haftalik — o‘tgan dushanba–yakshanba, oylik — o‘tgan oy", () => {
    // 2026-10-12 — dushanba
    expect(digestPeriod("weekly", "2026-10-12")).toMatchObject({ from: "2026-10-05", to: "2026-10-11" });
    // Hafta o‘rtasida chaqirilsa ham — oxirgi to‘liq hafta
    expect(digestPeriod("weekly", "2026-10-15")).toMatchObject({ from: "2026-10-05", to: "2026-10-11" });
    expect(digestPeriod("monthly", "2026-10-01")).toMatchObject({ from: "2026-09-01", to: "2026-09-30", month: "2026-09" });
    expect(digestPeriod("monthly", "2026-01-01")).toMatchObject({ from: "2025-12-01", to: "2025-12-31", month: "2025-12" });
  });

  it("egasi va HR — butun kompaniya; filial rahbari — faqat o‘z filiallari; Telegram’siz — yo‘q", async () => {
    const db = (await createSeed()) as Database;
    db.companies.push({ id: "c1", name: "A", slug: "a", ownerName: "O", plan: "B", status: "ACTIVE", timezone: "Asia/Tashkent", createdAt: "" });
    const user = (id: string, role: User["role"], extra: Partial<User> = {}): User => ({ id, companyId: "c1", name: id, email: `${id}@t.uz`, passwordHash: "", role, telegramId: `10${id.length}`, ...extra });
    db.users.push(user("owner", "COMPANY_OWNER"), user("hr", "HR_ADMIN"), user("mgr", "BRANCH_MANAGER", { branchIds: ["b1"] }), user("nolink", "HR_ADMIN", { telegramId: undefined }));
    const list = digestRecipients(db, "c1");
    expect(list.map((r) => r.user.id).sort()).toEqual(["hr", "mgr", "owner"]);
    expect(list.find((r) => r.user.id === "mgr")?.branches).toEqual(new Set(["b1"]));
    expect(list.find((r) => r.user.id === "owner")).toMatchObject({ branches: null, payroll: true });
    expect(list.find((r) => r.user.id === "mgr")?.payroll).toBe(false);
    db.companies[0].reportDigest = { branchManagers: false };
    expect(digestRecipients(db, "c1").map((r) => r.user.id)).not.toContain("mgr");
  });
});
