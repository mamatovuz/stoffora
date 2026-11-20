import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/types";

/*
 * Staffora AI: xodimni ism/ID/telefon bo‘yicha topish, savolni to‘g‘ri tushunish, model vositalari
 * va Telegram ko‘rinishi (vidjet, tugmalar, tasdiqlash) — sayt va bot bir xil dvigatelda.
 */

let dir = "";
let store: typeof import("../lib/store");
let routes: typeof import("../server/ai/routes");
let actions: typeof import("../server/ai/actions");
let search: typeof import("../server/ai/search");
let telegram: typeof import("../server/ai/telegram");
const realFetch = globalThis.fetch;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
const session = { userId: "u1", companyId: "c1", name: "Owner One", email: "one@test.local", role: "COMPANY_OWNER" as const };
const req = { session } as never;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-ai-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  process.env.INTEGRATION_SECRET = "qa-secret-32-characters-minimum-value";
  vi.resetModules();
  store = await import("../lib/store");
  routes = await import("../server/ai/routes");
  actions = await import("../server/ai/actions");
  search = await import("../server/ai/search");
  telegram = await import("../server/ai/telegram");
  const { encryptSecret } = await import("../server/integrations/secrets");
  const now = new Date().toISOString();
  await store.updateDb((db: Database) => {
    db.companies.push({ id: "c1", name: "Alfa", slug: "alfa", status: "ACTIVE", plan: "Pro", timezone: "Asia/Tashkent", createdAt: now } as Database["companies"][number]);
    db.users.push({ id: "u1", companyId: "c1", name: "Owner One", email: "one@test.local", role: "COMPANY_OWNER", passwordHash: "x", createdAt: now } as Database["users"][number]);
    db.schedules.push({ id: "11111111-1111-4111-8111-111111111111", companyId: "c1", name: "Asosiy", days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: true, start: "09:00", end: "18:00" })), graceMinutes: 0 } as Database["schedules"][number]);
    db.branches.push(
      { id: "b1", companyId: "c1", name: "Markaz", address: "Toshkent", latitude: 41.31, longitude: 69.28, radiusMeters: 150, manager: "", status: "ACTIVE", scheduleId: "11111111-1111-4111-8111-111111111111" } as Database["branches"][number],
      { id: "b2", companyId: "c1", name: "Chilonzor", address: "Toshkent", latitude: 41.28, longitude: 69.2, radiusMeters: 150, manager: "", status: "ACTIVE", scheduleId: "11111111-1111-4111-8111-111111111111" } as Database["branches"][number],
    );
    db.positions.push({ id: "p1", companyId: "c1", name: "Kassir", departmentId: "d1" } as Database["positions"][number]);
    const base = { companyId: "c1", status: "ACTIVE", positionId: "p1", departmentId: "d1", scheduleId: "11111111-1111-4111-8111-111111111111", startDate: "2026-01-01", baseSalary: 4_000_000, telegramConnected: false };
    db.employees.push(
      { ...base, id: "e1", branchId: "b1", firstName: "Ali", lastName: "Valiyev", employeeNo: "001", phone: "+998 90 000 00 01" } as Database["employees"][number],
      { ...base, id: "e2", branchId: "b2", firstName: "Vali", lastName: "Karimov", employeeNo: "002", phone: "+998900000002" } as Database["employees"][number],
      { ...base, id: "e3", branchId: "b1", firstName: "Ali", lastName: "Sobirov", employeeNo: "003", phone: "+998900000003" } as Database["employees"][number],
      { ...base, id: "e4", branchId: "b2", firstName: "Shohruh", lastName: "Hasanov", employeeNo: "E-1004", phone: "+998900000004" } as Database["employees"][number],
    );
    db.attendance.push({ id: "a1", companyId: "c1", employeeId: "e1", branchId: "b1", date: today, scheduledStart: "09:00", scheduledEnd: "18:00", checkIn: "09:15", lateMinutes: 15, earlyLeaveMinutes: 0, workedMinutes: 0, overtimeMinutes: 0, status: "LATE", verification: ["FACE"] } as Database["attendance"][number]);
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
/** Telegram API chaqiruvlarini yozib boradi; `fail` dagi metodlar xato qaytaradi. */
function telegramSpy(fail: string[] = []) {
  const calls: { method: string; body: any }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://api.telegram.org/")) return realFetch(input, init);
    const method = url.split("/").pop()!;
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push({ method, body });
    if (fail.includes(method)) return new Response(JSON.stringify({ ok: false, description: "Bad Request: method not found" }), { status: 404 });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 10 } }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

describe("xodim qidiruvi", () => {
  it("ism, familiya, qo‘shimcha, kirill va telefon bo‘yicha topadi", async () => {
    const db = await store.readDb();
    const ids = (q: string) =>
      search
        .searchEmployees(db, "c1", q)
        .filter((h) => h.exact)
        .map((h) => h.employee.id)
        .sort();
    expect(ids("Ali Valiyev")).toEqual(["e1"]);
    expect(ids("Valiyevni")).toEqual(["e1"]);
    expect(ids("Ali")).toEqual(["e1", "e3"]);
    expect(ids("Шохрух")).toEqual(["e4"]);
    expect(ids("Xasanov")).toEqual(["e4"]);
    expect(ids("90 000 00 02")).toEqual(["e2"]);
    expect(ids("E-1004")).toEqual(["e4"]);
  });

  it("savolni to‘g‘ri tushunadi: ID, ism, topilmagan, ro‘yxat, sana va filial", async () => {
    const c = await ctx();
    const plan = (m: string) => actions.planReadAction(m, c);
    expect(plan("Ali Valiyev bormi?")).toMatchObject({ name: "get_employee_profile", payload: { employeeId: "e1" } });
    expect(plan("ID 001 kim?")).toMatchObject({ name: "get_employee_profile", payload: { employeeId: "e1" } });
    expect(plan("002 raqamli xodim haqida ma’lumot ber")).toMatchObject({ name: "get_employee_profile", payload: { employeeId: "e2" } });
    expect(plan("Valiyev familiyali xodim bormi?")).toMatchObject({ name: "get_employee_profile", payload: { employeeId: "e1" } });
    expect(plan("Ali ismli xodimlar")).toMatchObject({ name: "find_employees" });
    expect(plan("Ali kechikdimi?")).toMatchObject({ name: "find_employees" });
    expect(plan("Valiyev bugun kechikdimi?")).toMatchObject({ name: "get_employee_profile", payload: { employeeId: "e1" } });
    expect(plan("Toshmatov ismli xodim bormi?")).toMatchObject({ name: "find_employees", payload: { query: "Toshmatov" } });
    expect(plan("Kechikkanlarni ko‘rsatib ber")).toMatchObject({ name: "get_late_employees" });
    expect(plan("Bugungi davomatni chiqarib ber")).toMatchObject({ name: "get_attendance_summary" });
    expect(plan("Chilonzor filialida kelmaganlar")).toMatchObject({ name: "get_absent_employees", payload: { branchId: "b2" } });
    expect(plan("kecha kechikkanlar")?.payload).toHaveProperty("date");
    expect(plan("Bu oy eng ko‘p kechikkanlar")).toMatchObject({ name: "get_month_late_ranking" });
    expect(plan("ID 001 oyligini 5 000 000 so‘m qilib qo‘y")).toBeUndefined();
    expect(actions.looksLikeWriteRequest("Kechikkanlarni ko‘rsatib ber")).toBe(false);
    expect(actions.looksLikeWriteRequest("Ma’lumot ber")).toBe(false);
    expect(actions.looksLikeWriteRequest("ID 001 bugun 08:30 da keldi qilib qo‘y")).toBe(true);
  });
});

describe("chat javoblari", () => {
  it("xodimni topib karta va tugmalar bilan javob beradi (providerga chiqmasdan)", async () => {
    const result = await routes.processChat(req, "Ali Valiyev bormi?", undefined, "WEB");
    expect(result.action?.name).toBe("get_employee_profile");
    expect(result.message.card).toMatchObject({ kind: "profile", title: "Ali Valiyev", link: "/employees/e1" });
    expect(result.message.text).toContain("+15 daq");
    expect(result.message.suggestions?.length).toBeGreaterThan(0);
    const many = await routes.processChat(req, "Ali ismli xodimlar", result.conversationId, "WEB");
    expect(many.message.card).toMatchObject({ kind: "table", title: "Topilgan xodimlar" });
    expect(many.message.suggestions?.map((s) => s.key).sort()).toEqual(["e:e1", "e:e3"]);
    const none = await routes.processChat(req, "Toshmatov ismli xodim bormi?", result.conversationId, "WEB");
    expect(none.message.text).toContain("topilmadi");
  });

  it("model kerak bo‘lsa vosita chaqiradi, natijani maxfiy maydonsiz oladi", async () => {
    const seen: string[] = [];
    let step = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("api.groq.com")) return realFetch(input, init);
      seen.push(String(init?.body));
      step += 1;
      const content = step === 1 ? 'TOOL {"name":"find_employees","args":{"query":"Karimov"}}' : "**Vali Karimov** Chilonzor filialida ishlaydi.";
      return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    }) as typeof fetch;
    const result = await routes.processChat(req, "Jamoamizda intizom qanday, umumiy tavsiya bera olasizmi va nimaga e’tibor berish kerak?", undefined, "WEB");
    expect(result.message.text).toContain("Vali Karimov");
    expect(step).toBe(2);
    expect(seen[1]).toContain("VOSITA NATIJASI find_employees");
    expect(seen[1]).not.toContain("+998900000002");
    expect(result.message.suggestions?.[0]?.key).toBe("e:e2");
    expect(routes.parseToolCall('```json\n{"tool":"get_attendance_summary","args":{}}\n```')).toEqual({ name: "get_attendance_summary", args: {} });
  });
});

describe("Telegram ko‘rinishi", () => {
  const target = () => ({ token: "123:abc", companyId: "c1", chatId: "777", user: { id: "u1", companyId: "c1", name: "Owner One", email: "one@test.local", role: "COMPANY_OWNER" as const } });

  it("kartani vidjet qilib, tugmalar bilan yuboradi; vidjet limitlariga sig‘adi", async () => {
    const calls = telegramSpy();
    await telegram.handleTelegramAiText(target(), "Ali Valiyev bormi?");
    expect(calls[0].method).toBe("sendMessageDraft");
    const widget = calls.find((c) => c.method === "sendWidget");
    expect(widget?.body.html).toContain("Ali Valiyev");
    expect(Buffer.byteLength(widget!.body.html)).toBeLessThanOrEqual(32768);
    expect(deflateSync(widget!.body.html, { level: 9 }).length).toBeLessThanOrEqual(4096);
    const buttons = widget!.body.reply_markup.inline_keyboard.flat();
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) if (b.callback_data) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });

  it("vidjet qo‘llanmasa oddiy HTML xabarga o‘tadi; Markdown xavfsiz o‘giriladi", async () => {
    const calls = telegramSpy(["sendWidget"]);
    await telegram.handleTelegramAiText(target(), "Bugungi davomatni ko‘rsat");
    const message = calls.find((c) => c.method === "sendMessage");
    expect(message?.body.parse_mode).toBe("HTML");
    expect(message?.body.text).toContain("<b>Davomat xulosasi</b>");
    expect(telegram.markdownToTelegramHtml("**A** <b> & `x`\n- band")).toBe("<b>A</b> &lt;b&gt; &amp; <code>x</code>\n• band");
  });

  it("o‘zgarishni tugma bilan tasdiqlaydi va bazaga yozadi", async () => {
    let calls = telegramSpy();
    await telegram.handleTelegramAiText(target(), "ID 001 oyligini 7 000 000 so‘m qilib qo‘y");
    const sent = calls.find((c) => c.method === "sendMessage");
    const ok = sent!.body.reply_markup.inline_keyboard.flat().find((b: any) => b.callback_data?.startsWith("ai:ok:"));
    expect(ok?.style).toBe("success");
    expect((await store.readDb()).employees.find((e) => e.id === "e1")?.baseSalary).toBe(4_000_000);
    calls = telegramSpy();
    expect(await telegram.handleTelegramAiCallback(target(), { id: "cb1", data: ok.callback_data, messageId: 10 })).toBe(true);
    expect((await store.readDb()).employees.find((e) => e.id === "e1")?.baseSalary).toBe(7_000_000);
    expect(calls.map((c) => c.method)).toEqual(expect.arrayContaining(["answerCallbackQuery", "editMessageReplyMarkup", "sendMessage"]));
    // Ikkinchi bosish qayta bajarmaydi.
    telegramSpy();
    await telegram.handleTelegramAiCallback(target(), { id: "cb2", data: ok.callback_data, messageId: 10 });
    expect((await store.readDb()).aiActions.filter((a) => a.status === "SUCCEEDED" && a.name === "set_employee_salary")).toHaveLength(1);
  });

  it("xodim tugmasi uning kartasini ochadi", async () => {
    const calls = telegramSpy();
    await telegram.handleTelegramAiCallback(target(), { id: "cb3", data: "ai:e:e2" });
    expect(calls.find((c) => c.method === "sendWidget")?.body.html).toContain("Vali Karimov");
  });
});
