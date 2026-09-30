import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import {
  checkBirthDate,
  checkFullName,
  checkPhone,
  checkSalary,
  checkWorkHours,
} from "../server/registration";

/*
 * Botdagi ro‘yxatdan o‘tish: tekshiruvlar va to‘liq suhbat (haqiqiy grammY bot,
 * soxta Telegram API) — /start → 12 savol → xulosa → HR tasdig‘i → xodim.
 */

describe("anketa tekshiruvlari", () => {
  it("sana faqat kun.oy.yil", () => {
    expect(checkBirthDate("29.08.1995")).toEqual({ ok: true, value: "1995-08-29" });
    expect(checkBirthDate("1995-08-29").ok).toBe(false);
    expect(checkBirthDate("31.02.1995").ok).toBe(false);
    expect(checkBirthDate("29.8.1995").ok).toBe(false);
    expect(checkBirthDate("01.01.2020").ok).toBe(false); // 14 yoshdan kichik
  });
  it("faqat telefon raqam qabul qilinadi", () => {
    expect(checkPhone("+998932303410")).toEqual({ ok: true, value: "+998932303410" });
    expect(checkPhone("+998 93 230 34 10")).toEqual({ ok: true, value: "+998932303410" });
    expect(checkPhone("932303410").ok).toBe(false);
    expect(checkPhone("salom").ok).toBe(false);
    expect(checkPhone("+99893230341").ok).toBe(false);
  });
  it("ism, ish vaqti, oylik", () => {
    expect(checkFullName("ali valiyev")).toEqual({ ok: true, value: "Ali Valiyev" });
    expect(checkFullName("Ali").ok).toBe(false);
    expect(checkFullName("Ali 123").ok).toBe(false);
    expect(checkWorkHours("9:00-18:00")).toEqual({ ok: true, value: "09:00 - 18:00" });
    expect(checkWorkHours("14.00 – 00.00")).toEqual({ ok: true, value: "14:00 - 00:00" });
    expect(checkWorkHours("kunduzi").ok).toBe(false);
    expect(checkSalary("4 000 000")).toEqual({ ok: true, value: 4_000_000 });
    expect(checkSalary("3.5 mln")).toEqual({ ok: true, value: 3_500_000 });
    expect(checkSalary("oz").ok).toBe(false);
  });
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-reg-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  process.env.APP_URL = "https://staffora.example.test";
  delete process.env.BOOTSTRAP_COMPANY_NAME;
  delete process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL;
});
afterEach(() => {
  delete process.env.SQLITE_PATH;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows */
  }
});

type Call = { method: string; payload: Record<string, unknown> };

async function setup() {
  vi.resetModules();
  const store = await import("../lib/store");
  const bots = await import("../server/company-bots");
  const { Bot } = await import("grammy");
  await store.updateDb((db) => {
    db.companies.push({
      id: "c1", name: "Gulnora Farm", slug: "g", ownerName: "O", plan: "B", status: "ACTIVE", timezone: "Asia/Tashkent", createdAt: "",
      bot: { enabled: true, registrationEnabled: true, approverTelegramIds: ["900"] },
    });
    db.departments.push({ id: "d1", companyId: "c1", name: "Dorixona" });
    db.positions.push({ id: "p1", companyId: "c1", name: "💊 Farmatsevt", departmentId: "d1" });
    db.branches.push({ id: "b1", companyId: "c1", name: "Asaka", address: "", latitude: 40.6, longitude: 72.2, radiusMeters: 150, manager: "", status: "ACTIVE", scheduleId: "" });
  });
  const calls: Call[] = [];
  let messageId = 100;
  const bot: Bot = new Bot("1:test");
  bot.botInfo = { id: 1, is_bot: true, first_name: "Test", username: "gulnora_test_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false };
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result = method === "sendMessage" ? { message_id: ++messageId, date: 0, chat: { id: 1, type: "private" } } : true;
    return { ok: true, result } as never;
  });
  bots.attachHandlers(bot, "c1");
  bots.registerRunningBotForTests("c1", bot);
  let updateId = 1;
  const user = (id: number) => ({ id, is_bot: false, first_name: id === 900 ? "HR" : "Ali", username: id === 900 ? "hr" : "ali" });
  const text = (from: number, value: string) =>
    bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: updateId,
        date: 0,
        chat: { id: from, type: "private", first_name: "x" },
        from: user(from),
        text: value,
        ...(value.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: value.split(" ")[0].length }] } : {}),
      },
    } as never);
  const press = (from: number, data: string) =>
    bot.handleUpdate({
      update_id: updateId++,
      callback_query: { id: String(updateId), from: user(from), chat_instance: "x", data, message: { message_id: 1, date: 0, chat: { id: from, type: "private", first_name: "x" } } },
    } as never);
  const lastText = () => [...calls].reverse().find((c) => c.method === "sendMessage")?.payload.text as string;
  const draft = async () => (await store.readDb()).registrations.find((r) => r.telegramId === "555");
  return { store, bots, calls, text, press, lastText, draft };
}

describe("botda ro‘yxatdan o‘tish (to‘liq suhbat)", () => {
  it("anketa → HR tasdig‘i → xodim yaratiladi va profil tugmasi keladi", async () => {
    const t = await setup();
    await t.text(555, "/start");
    expect((await t.draft())?.step).toBe("fullName");
    expect(t.lastText()).toContain("Ism va familiyangizni");

    await t.text(555, "ali valiyev");
    await t.text(555, "1995-08-29"); // noto‘g‘ri format
    expect(t.lastText()).toContain("kun.oy.yil");
    await t.text(555, "29.08.1995");
    await t.text(555, "salom"); // telefon emas
    expect(t.lastText()).toContain("Faqat telefon raqam");
    await t.text(555, "+998932303410");
    await t.text(555, "+998901234567");
    expect((await t.draft())?.step).toBe("positionId");
    await t.text(555, "Farmatsevt"); // tugma o‘rniga matn
    expect(t.lastText()).toContain("tugmalardan");
    await t.press(555, "rg:pos:p1");
    await t.text(555, "Chilonzor tumani, 12-kvartal");
    await t.press(555, "rg:br:b1");
    await t.press(555, "rg:sh:DAY");
    await t.press(555, "rg:wh:0");
    await t.text(555, "4 000 000");
    expect((await t.draft())?.step).toBe("salaryConfirm");
    expect(t.lastText()).toContain("4 000 000 so‘m");
    await t.press(555, "rg:sc:yes");
    await t.press(555, "rg:rd:0");
    await t.press(555, "rg:ed:0");
    let draft = await t.draft();
    expect(draft?.step).toBe("summary");
    expect(t.lastText()).toContain("Ali Valiyev");

    // Tahrirlash: faqat bitta maydon, keyin xulosaga qaytadi
    await t.press(555, "rg:edit");
    await t.press(555, "rg:ef:address");
    await t.text(555, "Asaka shahri, Navoiy ko‘chasi 5");
    draft = await t.draft();
    expect(draft?.step).toBe("summary");
    expect(draft?.data.address).toBe("Asaka shahri, Navoiy ko‘chasi 5");

    await t.press(555, "rg:submit");
    draft = await t.draft();
    expect(draft?.status).toBe("PENDING");
    const hrMessage = t.calls.find((c) => c.method === "sendMessage" && c.payload.chat_id === "900");
    expect(hrMessage?.payload.text).toContain("Yangi xodim anketasi");
    expect(JSON.stringify(hrMessage?.payload.reply_markup)).toContain(`hr:a:${draft!.id}`);

    // Begona odam tasdiqlay olmaydi
    await t.press(777, `hr:a:${draft!.id}`);
    expect((await t.draft())?.status).toBe("PENDING");

    // HR tasdiqlaydi
    await t.press(900, `hr:a:${draft!.id}`);
    const db = await t.store.readDb();
    const employee = db.employees.find((e) => e.telegramId === "555")!;
    expect(employee).toMatchObject({
      firstName: "Ali",
      lastName: "Valiyev",
      phone: "+998932303410",
      parentPhone: "+998901234567",
      birthDate: "1995-08-29",
      positionId: "p1",
      departmentId: "d1",
      branchId: "b1",
      baseSalary: 4_000_000,
      telegramConnected: true,
      telegramChannel: "COMPANY_BOT",
      status: "ACTIVE",
      shift: "DAY",
    });
    const schedule = db.schedules.find((s) => s.id === employee.scheduleId)!;
    expect(schedule.days.find((d) => d.day === 1)).toMatchObject({ enabled: true, start: "09:00", end: "18:00" });
    expect(schedule.days.find((d) => d.day === 0)?.enabled).toBe(false);
    const welcome = t.calls.find((c) => c.method === "sendMessage" && c.payload.chat_id === "555" && String(c.payload.text).includes("Tabriklaymiz"));
    expect(JSON.stringify(welcome?.payload.reply_markup)).toContain("web_app");
    // HR xabari yangilanadi
    expect(t.calls.some((c) => c.method === "editMessageText" && String(c.payload.text).includes("Tasdiqlandi"))).toBe(true);
    // Qayta /start — endi xodim, anketa emas
    await t.text(555, "/start");
    expect(t.lastText()).toContain("Assalomu alaykum, <b>Ali</b>");
    // Ikkinchi marta tasdiqlab bo‘lmaydi
    await expect(t.bots.decideRegistration("c1", draft!.id, "APPROVE", "x")).rejects.toThrow("allaqachon");
  });

  it("rad etish: arizachiga sabab bilan javob; ro‘yxatdan o‘tish yopiq bo‘lsa anketa boshlanmaydi", async () => {
    const t = await setup();
    await t.store.updateDb((db) => {
      db.registrations.push({
        id: "r1", companyId: "c1", telegramId: "555", status: "PENDING", step: "summary",
        data: { fullName: "Ali Valiyev", birthDate: "1995-08-29", phone: "+998932303410", parentPhone: "+998901234567", positionId: "p1", address: "Asaka", branchId: "b1", shift: "DAY", workHours: "09:00 - 18:00", salary: 1_000_000, restDay: 0, education: "Oliy — farmatsevt" },
        createdAt: "", updatedAt: "",
      });
    });
    await t.bots.decideRegistration("c1", "r1", "REJECT", "HR", { reason: "Bo‘sh o‘rin yo‘q" });
    expect(t.lastText()).toContain("Bo‘sh o‘rin yo‘q");
    expect((await t.store.readDb()).employees).toHaveLength(0);
    await t.store.updateDb((db) => void (db.companies[0].bot!.registrationEnabled = false));
    await t.text(556, "/start");
    expect(t.lastText()).toContain("yopiq");
    expect((await t.store.readDb()).registrations.some((r) => r.telegramId === "556")).toBe(false);
  });
});
