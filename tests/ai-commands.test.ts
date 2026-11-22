import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/*
 * Kuchaytirilgan Staffora AI buyruqlari: chiqish vaqtini qo‘yish, ishdan bo‘shatish, filialga xabar,
 * ta’tilni tasdiqlash. Har biri avval tasdiqlash kartasi, keyin bazaga yoziladi; filial rahbari — faqat o‘z filiali.
 */

let dir = "";
let store: typeof import("../lib/store");
let routes: typeof import("../server/ai/routes");
let actions: typeof import("../server/ai/actions");
const realFetch = globalThis.fetch;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
const owner = { session: { userId: "u1", companyId: "c1", name: "Owner One", email: "one@test.local", role: "COMPANY_OWNER" as const } } as never;
const branchManager = { session: { userId: "u2", companyId: "c1", name: "Filial Rahbar", email: "bm@test.local", role: "BRANCH_MANAGER" as const } } as never;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-ai-cmd-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  process.env.INTEGRATION_SECRET = "qa-secret-32-characters-minimum-value";
  vi.resetModules();
  store = await import("../lib/store");
  routes = await import("../server/ai/routes");
  actions = await import("../server/ai/actions");
  const { encryptSecret } = await import("../server/integrations/secrets");
  const now = new Date().toISOString();
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Alfa", slug: "alfa", status: "ACTIVE", plan: "Pro", timezone: "Asia/Tashkent", createdAt: now } as Database["companies"][number]);
    db.users.push(
      { id: "u1", companyId: "c1", name: "Owner One", email: "one@test.local", role: "COMPANY_OWNER", passwordHash: "x", createdAt: now } as Database["users"][number],
      { id: "u2", companyId: "c1", name: "Filial Rahbar", email: "bm@test.local", role: "BRANCH_MANAGER", passwordHash: "x", branchIds: ["b1"], createdAt: now } as Database["users"][number],
    );
    db.schedules.push({ id: "11111111-1111-4111-8111-111111111111", companyId: "c1", name: "Asosiy", days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: true, start: "09:00", end: "18:00" })), graceMinutes: 0 } as Database["schedules"][number]);
    db.branches.push(
      { id: "b1", companyId: "c1", name: "Markaz", address: "Toshkent", latitude: 41.31, longitude: 69.28, radiusMeters: 150, manager: "", status: "ACTIVE", scheduleId: "11111111-1111-4111-8111-111111111111" } as Database["branches"][number],
      { id: "b2", companyId: "c1", name: "Chilonzor", address: "Toshkent", latitude: 41.28, longitude: 69.2, radiusMeters: 150, manager: "", status: "ACTIVE", scheduleId: "11111111-1111-4111-8111-111111111111" } as Database["branches"][number],
    );
    const base = { companyId: "c1", status: "ACTIVE", positionId: "p1", departmentId: "d1", scheduleId: "11111111-1111-4111-8111-111111111111", startDate: "2026-01-01", baseSalary: 4_000_000, telegramConnected: false };
    db.employees.push(
      { ...base, id: "e1", branchId: "b1", firstName: "Ali", lastName: "Valiyev", employeeNo: "1001" } as Database["employees"][number],
      { ...base, id: "e2", branchId: "b2", firstName: "Vali", lastName: "Karimov", employeeNo: "1002" } as Database["employees"][number],
      { ...base, id: "e3", branchId: "b2", firstName: "Sardor", lastName: "Qodirov", employeeNo: "1003" } as Database["employees"][number],
    );
    db.attendance.push({ id: "a1", companyId: "c1", employeeId: "e1", branchId: "b1", date: today, scheduledStart: "09:00", scheduledEnd: "18:00", checkIn: "08:55", lateMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 0, overtimeMinutes: 0, status: "PRESENT", verification: ["FACE"] } as Database["attendance"][number]);
    db.leaveRequests.push({ id: "l1", companyId: "c1", employeeId: "e2", type: "VACATION", startDate: "2026-12-01", endDate: "2026-12-05", reason: "Dam", status: "PENDING", createdAt: now } as Database["leaveRequests"][number]);
    db.aiConfigs.push({
      id: "cfg1", companyId: "c1", enabled: true, provider: "GROQ", model: "openai/gpt-oss-20b", responseLanguage: "uz", voiceEnabled: false, updatedAt: now, updatedBy: "qa",
      credentials: [{ id: "cr1", provider: "GROQ", model: "openai/gpt-oss-20b", keyEnc: encryptSecret("gsk_test_key_for_tools_123456"), keyHint: "gsk…", active: true, createdAt: now }],
    } as Database["aiConfigs"][number]);
  });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const ctx = async () => ({ db: await store.readDb(), companyId: "c1", userId: "u1", userName: "Owner One", role: "COMPANY_OWNER" as const });
/** Model chaqirilmasligi kerak bo‘lgan holatlar uchun. */
function noModel() {
  globalThis.fetch = (async () => {
    throw new Error("model chaqirilmasligi kerak edi");
  }) as typeof fetch;
}
async function confirm(req: never, pending: any) {
  return routes.confirmStagedAction(req, pending.id, pending.confirmationToken);
}

describe("buyruqlarni tushunish", () => {
  it("chiqish, bo‘shatish, xabar va ta’til buyruqlarini aniqlaydi", async () => {
    const c = await ctx();
    const plan = (m: string) => actions.planDeterministicAction(m, c);
    expect(plan("1001 idlik odamga chiqish qilib qo‘y bugun 12:00 da")).toMatchObject({ name: "set_checkout", payload: { employeeId: "1001", checkOut: "12:00", date: today }, missing: [] });
    expect(plan("ID 1002 bugun 09:10 da keldi 18:30 da ketdi deb qo‘y")).toMatchObject({ name: "set_checkout", payload: { checkIn: "09:10", checkOut: "18:30" } });
    expect(plan("Vali Karimovni ishdan bo‘shat")).toMatchObject({ name: "dismiss_employee", payload: { employeeId: "e2" }, missing: [] });
    expect(plan("1003 ni ishdan boshat sababi: intizom")).toMatchObject({ name: "dismiss_employee", payload: { employeeId: "e3", reason: "intizom" } });
    expect(plan("Ertaga 9:00 da yig‘ilish bor deb habar yuborib qo‘y Chilonzor filialiga")).toMatchObject({ name: "send_announcement", payload: { message: "Ertaga 9:00 da yig‘ilish bor", target: "BRANCHES", branches: ["b2"] }, missing: [] });
    expect(plan("Hammaga xabar yubor: Bugun maosh beriladi")).toMatchObject({ name: "send_announcement", payload: { message: "Bugun maosh beriladi", target: "ALL" } });
    expect(plan("Vali Karimovning ta’tilini tasdiqla")).toMatchObject({ name: "decide_leave", payload: { employeeId: "e2", status: "APPROVED" } });
    // O‘qish so‘rovlari yozish bo‘lib qolmasin.
    expect(actions.looksLikeWriteRequest("Ishdan bo‘shatilganlar ro‘yxatini ko‘rsat")).toBe(false);
    expect(actions.looksLikeWriteRequest("Yuborilgan xabarlarni ko‘rsat")).toBe(false);
    expect(actions.looksLikeWriteRequest("ID 1001 bugun 12:00 da chiqdimi?")).toBe(false);
  });
});

describe("buyruqlarni bajarish (tasdiq bilan)", () => {
  it("chiqish vaqtini qo‘yadi", async () => {
    noModel();
    const r = await routes.processChat(owner, "1001 idlik odamga chiqish qilib qo‘y bugun 12:00 da", undefined, "WEB");
    expect(r.pendingAction).toBeTruthy();
    expect(r.message.text).toContain("12:00");
    expect((await store.readDb()).attendance.find((a) => a.id === "a1")?.checkOut).toBeUndefined();
    const done = await confirm(owner, r.pendingAction);
    expect(done.status).toBe("SUCCEEDED");
    expect((await store.readDb()).attendance.find((a) => a.id === "a1")?.checkOut).toBe("12:00");
  });

  it("kelish qayd etilmagan bo‘lsa to‘qimaydi — aniq aytadi", async () => {
    noModel();
    const r = await routes.processChat(owner, "ID 1003 bugun 17:00 da chiqish qilib qo‘y", undefined, "WEB");
    expect(r.pendingAction).toBeTruthy();
    await expect(confirm(owner, r.pendingAction)).rejects.toThrow(/kelish qayd etilmagan/);
  });

  it("filialga xabar yuboradi (faqat o‘sha filial xodimlariga)", async () => {
    noModel();
    const r = await routes.processChat(owner, "Ertaga 9:00 da yig‘ilish bor deb xabar yubor Chilonzor filialiga", undefined, "WEB");
    expect(r.message.text).toContain("2 xodim");
    await confirm(owner, r.pendingAction);
    const db = await store.readDb();
    const sent = db.notifications.filter((n) => n.body === "Ertaga 9:00 da yig‘ilish bor").map((n) => n.employeeId).sort();
    expect(sent).toEqual(["e2", "e3"]);
    expect(db.announcements[0]).toMatchObject({ audience: expect.stringContaining("Chilonzor") });
  });

  it("ta’tilni tasdiqlaydi va xodimga xabar beradi", async () => {
    noModel();
    const r = await routes.processChat(owner, "ID 1002 ta’til so‘rovini tasdiqla", undefined, "WEB");
    await confirm(owner, r.pendingAction);
    const db = await store.readDb();
    expect(db.leaveRequests.find((l) => l.id === "l1")?.status).toBe("APPROVED");
    expect(db.notifications.some((n) => n.employeeId === "e2" && n.type === "LEAVE")).toBe(true);
  });

  it("filial rahbari boshqa filial xodimini o‘zgartira olmaydi", async () => {
    noModel();
    const r = await routes.processChat(branchManager, "ID 1002 bugun 18:00 da chiqish qilib qo‘y", undefined, "WEB");
    expect(r.pendingAction).toBeNull();
    expect(r.message.text).toContain("filialingizda emas");
  });

  it("ishdan bo‘shatadi — faqat tasdiqdan keyin", async () => {
    noModel();
    const r = await routes.processChat(owner, "1003 ni ishdan bo‘shat", undefined, "WEB");
    expect(r.message.text).toContain("ishdan bo‘shatiladi");
    expect((await store.readDb()).employees.find((e) => e.id === "e3")?.status).toBe("ACTIVE");
    await confirm(owner, r.pendingAction);
    const e3 = (await store.readDb()).employees.find((e) => e.id === "e3");
    expect(e3?.status).toBe("DISMISSED");
    expect(e3?.dismissedAt).toBe(today);
  });

  it("tushunilmagan buyruqni model orqali amalga aylantiradi («bunday buyruq yo‘q» demaydi)", async () => {
    let step = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("api.groq.com")) return realFetch(input, init);
      step += 1;
      const content =
        step === 1
          ? 'TOOL {"name":"find_employees","args":{"query":"Valiyev"}}'
          : 'TOOL {"name":"set_employee_salary","args":{"employeeId":"e1","baseSalary":6500000}}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    }) as typeof fetch;
    const r = await routes.processChat(owner, "Valiyevga maoshni olti yarim million qilib ber", undefined, "WEB");
    expect(step).toBe(2);
    expect(r.pendingAction).toMatchObject({ name: "set_employee_salary" });
    expect(r.message.text).toContain("6");
    expect((await store.readDb()).employees.find((e) => e.id === "e1")?.baseSalary).toBe(4_000_000);
  });
});
