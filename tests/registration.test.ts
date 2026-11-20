import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import bcrypt from "bcryptjs";
import {
  checkAge,
  checkBirthDate,
  checkEmail,
  checkFullName,
  checkPhone,
  checkPinfl,
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
  it("JShShIR — 14 raqam", () => {
    expect(checkPinfl("315 0895 1234567")).toEqual({ ok: true, value: "31508951234567" });
    expect(checkPinfl("12345").ok).toBe(false);
    expect(checkPinfl("3150895123456a").ok).toBe(false);
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
  it("yosh — butun son 14–80; email — oddiy tekshiruv", () => {
    expect(checkAge("25")).toEqual({ ok: true, value: "25" });
    expect(checkAge(" 14 ")).toEqual({ ok: true, value: "14" });
    expect(checkAge("80").ok).toBe(true);
    expect(checkAge("13").ok).toBe(false);
    expect(checkAge("81").ok).toBe(false);
    expect(checkAge("25.5").ok).toBe(false);
    expect(checkAge("yigirma").ok).toBe(false);
    expect(checkEmail(" Ali.Valiyev@Gmail.com ")).toEqual({ ok: true, value: "ali.valiyev@gmail.com" });
    expect(checkEmail("ali@mail.uz").ok).toBe(true);
    expect(checkEmail("ali@gmail").ok).toBe(false);
    expect(checkEmail("ali gmail.com").ok).toBe(false);
    expect(checkEmail("ali..v@gmail.com").ok).toBe(false);
    expect(checkEmail("@gmail.com").ok).toBe(false);
  });
});

describe("smena va ish vaqti — kompaniya grafiklaridan", () => {
  it("kunduzgi tanlansa — faqat kunduzgi grafiklar (vaqt va kunlari bilan)", async () => {
    const { buttonsFor, parseButton, defaultForm } = await import("../server/registration");
    const sched = (id: string, start: string, end: string, days: number[]) => ({ id, companyId: "c1", name: id, type: "FIXED", graceMinutes: 0, overtimeEnabled: false, days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, enabled: days.includes(d), start, end })) });
    const db = { positions: [], branches: [], schedules: [sched("kun", "08:00", "19:00", [1, 2, 3, 4, 5, 6]), sched("kech", "14:00", "22:00", [0, 1, 2, 3, 4, 5, 6])] } as never;
    const form = defaultForm();
    const shift = form.questions.find((q) => q.id === "shift")!;
    const hours = form.questions.find((q) => q.id === "workHours")!;
    expect(JSON.stringify(buttonsFor(shift, db, "c1", {}))).toContain("Kunduzgi smena · 08:00–19:00");
    const day = JSON.stringify(buttonsFor(hours, db, "c1", { shift: "DAY" }));
    expect(day).toContain("08:00 - 19:00 · Du–Sh");
    expect(day).not.toContain("14:00");
    expect(JSON.stringify(buttonsFor(hours, db, "c1", { shift: "NIGHT" }))).toContain("14:00 - 22:00 · har kuni");
    expect(parseButton(hours, "s:kech", db, "c1")).toEqual({ ok: true, value: "14:00 - 22:00" });
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
  // Yuz aniqlash (og‘ir model) testda soxta: rasmda yuz «topildi».
  vi.doMock("../server/face-reference", () => ({
    referenceFromPhoto: async () => Array.from({ length: 128 }, (_, i) => (i % 7) / 10),
    applyPanelReference: (_db: unknown, employee: { photoDataUrl?: string; faceEnrolledAt?: string }, photo: string) => {
      employee.photoDataUrl = photo;
      employee.faceEnrolledAt = new Date().toISOString();
    },
  }));
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
    const result =
      method === "sendMessage" || method === "sendPhoto"
        ? { message_id: ++messageId, date: 0, chat: { id: 1, type: "private" } }
        : method === "getFile"
          ? { file_id: "f1", file_unique_id: "u1", file_path: "photos/passport.jpg" }
          : true;
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
  const photo = (from: number) =>
    bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: updateId,
        date: 0,
        chat: { id: from, type: "private", first_name: "x" },
        from: user(from),
        photo: [
          { file_id: "small", file_unique_id: "s", width: 90, height: 60, file_size: 2_000 },
          { file_id: "big", file_unique_id: "b", width: 1280, height: 853, file_size: 90_000 },
        ],
      },
    } as never);
  const press = (from: number, data: string) =>
    bot.handleUpdate({
      update_id: updateId++,
      callback_query: { id: String(updateId), from: user(from), chat_instance: "x", data, message: { message_id: 1, date: 0, chat: { id: from, type: "private", first_name: "x" } } },
    } as never);
  const lastText = () => [...calls].reverse().find((c) => c.method === "sendMessage")?.payload.text as string;
  const draft = async () => (await store.readDb()).registrations.find((r) => r.telegramId === "555");
  return { store, bots, calls, text, press, photo, lastText, draft };
}

describe("botda ro‘yxatdan o‘tish (to‘liq suhbat)", () => {
  it("anketa → HR tasdig‘i → xodim yaratiladi va profil tugmasi keladi", async () => {
    const t = await setup();
    await t.text(555, "/start");
    expect((await t.draft())?.step).toBe("fullName");
    expect(t.lastText()).toContain("Ism va familiyangizni");

    await t.text(555, "ali valiyev");
    expect((await t.draft())?.step).toBe("gender");
    await t.press(555, "rg:a:gender:MALE");
    await t.text(555, "1995-08-29"); // noto‘g‘ri format
    expect(t.lastText()).toContain("kun.oy.yil");
    await t.text(555, "29.08.1995");
    expect((await t.draft())?.step).toBe("pinfl");
    await t.text(555, "12345");
    expect(t.lastText()).toContain("14 ta raqam");
    await t.text(555, "31508951234567");
    await t.text(555, "salom"); // telefon emas
    expect(t.lastText()).toContain("Faqat telefon raqam");
    await t.text(555, "+998932303410");
    await t.text(555, "+998901234567");
    expect((await t.draft())?.step).toBe("positionId");
    await t.text(555, "Farmatsevt"); // tugma o‘rniga matn
    expect(t.lastText()).toContain("tugmalardan");
    await t.press(555, "rg:a:positionId:p1");
    await t.text(555, "Chilonzor tumani, 12-kvartal");
    await t.press(555, "rg:a:branchId:b1");
    await t.press(555, "rg:a:shift:DAY");
    await t.press(555, "rg:a:workHours:09:00 - 18:00");
    await t.text(555, "4 000 000");
    expect(await t.draft()).toMatchObject({ step: "salary", confirming: true });
    expect(t.lastText()).toContain("4 000 000 so‘m");
    await t.press(555, "rg:ok");
    await t.press(555, "rg:a:restDay:0");
    await t.press(555, "rg:a:education:0");
    expect((await t.draft())?.step).toBe("idDocument");
    await t.text(555, "pasportim bor"); // rasm o‘rniga matn
    expect(t.lastText()).toContain("rasm yuboring");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(Buffer.from("fake-jpeg-bytes"), { status: 200 }));
    await t.photo(555);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("photos/passport.jpg");
    fetchSpy.mockRestore();
    expect(t.calls.find((c) => c.method === "getFile")?.payload.file_id).toBe("big");
    expect((await t.draft())?.step).toBe("selfie");
    const selfieSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(Buffer.from("fake-selfie"), { status: 200 }));
    await t.photo(555);
    selfieSpy.mockRestore();
    let draft = await t.draft();
    expect(draft?.data.idDocument).toBeTruthy();
    expect(draft?.data.selfie).toBeTruthy();
    expect(draft?.data.selfieDescriptor).toHaveLength(128);
    // Oxirgi savol — ilova logini: tugmada ism-familiyadan taklif.
    expect(draft?.step).toBe("appLogin");
    expect(JSON.stringify(t.calls.at(-1)?.payload.reply_markup)).toContain("ali.valiyev@staffora.uz");
    await t.text(555, "ali@gmail.com"); // boshqa domen
    expect(t.lastText()).toContain("@staffora.uz avtomatik");
    await t.press(555, "rg:a:appLogin:ali.valiyev");
    expect((await t.draft())?.data.appLogin).toBe("ali.valiyev@staffora.uz");
    expect(t.lastText()).toContain("parol");
    await t.text(555, "qisqa1"); // zaif parol
    expect(t.lastText()).toContain("kamida 8");
    await t.text(555, "Valiyev2026");
    // Parol xabari chatdan o‘chiriladi; javobda — spoiler ichida; bazada — faqat bcrypt xeshi.
    expect(t.calls.filter((c) => c.method === "deleteMessage")).toHaveLength(2);
    const spoiler = t.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text)).find((x) => x.includes("tg-spoiler"));
    expect(spoiler).toContain("<code>ali.valiyev@staffora.uz</code> · Parol: <tg-spoiler>Valiyev2026</tg-spoiler>");
    draft = await t.draft();
    expect(draft?.data.appPasswordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(JSON.stringify(draft)).not.toContain("Valiyev2026");
    expect(draft?.step).toBe("summary");
    expect(t.lastText()).toContain("Ali Valiyev");
    expect(t.lastText()).toContain("ali.valiyev@staffora.uz · parol: ••••••");

    // Tahrirlash: faqat bitta maydon, keyin xulosaga qaytadi
    await t.press(555, "rg:edit");
    await t.press(555, "rg:ef:address");
    await t.text(555, "Asaka shahri, Navoiy ko‘chasi 5");
    draft = await t.draft();
    expect(draft?.step).toBe("summary");
    expect(draft?.data.address).toBe("Asaka shahri, Navoiy ko‘chasi 5");
    // Login va parolni xulosadan qayta tanlash: ikkalasi boshidan so‘raladi, keyin xulosaga qaytadi.
    await t.press(555, "rg:edit");
    await t.press(555, "rg:ef:appLogin");
    const reset = (await t.draft())?.data;
    expect(reset?.appLogin).toBeUndefined();
    expect(reset?.appPasswordHash).toBeUndefined();
    await t.text(555, "Ali.V");
    await t.text(555, "Yangi2026parol");
    draft = await t.draft();
    expect(draft).toMatchObject({ step: "summary", data: { appLogin: "ali.v@staffora.uz" } });

    await t.press(555, "rg:submit");
    draft = await t.draft();
    expect(draft?.status).toBe("PENDING");
    const hrMessage = t.calls.find((c) => c.method === "sendMessage" && c.payload.chat_id === "900");
    expect(hrMessage?.payload.text).toContain("Yangi xodim anketasi");
    expect(JSON.stringify(hrMessage?.payload.reply_markup)).toContain(`hr:a:${draft!.id}`);

    // Pasport rasmi HR’ga ham boradi
    expect(t.calls.some((c) => c.method === "sendPhoto" && c.payload.chat_id === "900")).toBe(true);
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
      gender: "MALE",
      pinfl: "31508951234567",
    });
    // Ilova logini faollashdi: xodimda faqat login, xesh — staffCredentials’da; anketada xesh qolmaydi.
    expect(employee.login).toBe("ali.v@staffora.uz");
    const credential = db.staffCredentials.find((c) => c.employeeId === employee.id)!;
    expect(credential.login).toBe("ali.v@staffora.uz");
    expect(await bcrypt.compare("Yangi2026parol", credential.passwordHash)).toBe(true);
    expect(JSON.stringify(employee)).not.toContain(credential.passwordHash);
    expect(db.registrations.find((r) => r.id === draft!.id)?.data.appPasswordHash).toBeUndefined();
    // Pasport rasmi xodim hujjatlariga tushadi (fayl saqlangan)
    const passport = db.documents.find((d) => d.employeeId === employee.id && d.type === "PASSPORT")!;
    expect(passport.id).toBe(draft!.data.idDocument);
    expect((await (await t.store.documentFiles()).getFile(passport.id))?.data.toString()).toBe("fake-jpeg-bytes");
    // Yuz rasmi profilga qo‘yildi (Face ID namunasi).
    expect(employee.faceEnrolledAt).toBeTruthy();
    expect(employee.photoDataUrl).toBeTruthy();
    const schedule = db.schedules.find((s) => s.id === employee.scheduleId)!;
    expect(schedule.days.find((d) => d.day === 1)).toMatchObject({ enabled: true, start: "09:00", end: "18:00" });
    expect(schedule.days.find((d) => d.day === 0)?.enabled).toBe(false);
    const welcome = t.calls.find((c) => c.method === "sendMessage" && c.payload.chat_id === "555" && String(c.payload.text).includes("Tabriklaymiz"));
    expect(JSON.stringify(welcome?.payload.reply_markup)).toContain("web_app");
    expect(String(welcome?.payload.text)).toContain("<code>ali.v@staffora.uz</code>");
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
        data: { fullName: "Ali Valiyev", birthDate: "1995-08-29", phone: "+998932303410", parentPhone: "+998901234567", positionId: "p1", address: "Asaka", branchId: "b1", shift: "DAY", workHours: "09:00 - 18:00", salary: 1_000_000, restDay: 0, education: "Oliy" },
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

describe("kompaniya o‘zi sozlagan anketa", () => {
  it("qo‘shimcha savollar, o‘chirilgan savol va ixtiyoriy savol; javoblar profilga tushadi", async () => {
    const t = await setup();
    const { normalizeForm, defaultForm } = await import("../server/registration");
    const base = defaultForm().questions.filter((q) => ["fullName", "phone", "positionId", "branchId"].includes(q.id));
    await t.store.updateDb((db) => {
      db.companies[0].name = "Qurilish Servis";
      db.companies[0].registrationForm = normalizeForm({
        questions: [
          ...base,
          { id: "exp1", type: "choice", title: "Ish tajribangiz qancha?", options: ["1 yilgacha", "1–3 yil", "3 yildan ko‘p"], required: true, enabled: true },
          { id: "lic1", type: "yesno", title: "Haydovchilik guvohnomangiz bormi?", required: true, enabled: true },
          { id: "note1", type: "text", title: "Qo‘shimcha izoh", required: false, enabled: true },
          { id: "parentPhone", field: "parentPhone", type: "phone", title: "x", required: true, enabled: false },
          { id: "gender", field: "gender", type: "gender", title: "x", required: true, enabled: false },
          { id: "pinfl", field: "pinfl", type: "pinfl", title: "x", required: true, enabled: false },
          { id: "idDocument", field: "idDocument", type: "photo", title: "x", required: true, enabled: false },
          { id: "selfie", field: "selfie", type: "photo", title: "x", required: true, enabled: false },
          // Ilova logini o‘chirilgan — anketa avvalgidek tugaydi.
          { id: "appLogin", field: "appLogin", type: "login", title: "x", required: true, enabled: false },
        ],
        intro: "Salom! {company} jamoasiga xush kelibsiz <script>",
      });
    });
    await t.text(555, "/start");
    const intro = t.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
    expect(intro.some((x) => x.includes("Qurilish Servis jamoasiga xush kelibsiz &lt;script&gt;"))).toBe(true);
    expect(intro.some((x) => x.toLowerCase().includes("gulnora"))).toBe(false);
    await t.text(555, "Vali Aliyev");
    await t.text(555, "+998901112233");
    await t.press(555, "rg:a:positionId:p1");
    await t.press(555, "rg:a:branchId:b1");
    expect((await t.draft())?.step).toBe("exp1");
    expect(JSON.stringify(t.calls.at(-1)?.payload.reply_markup)).toContain("3 yildan ko‘p");
    await t.press(555, "rg:a:exp1:2");
    await t.press(555, "rg:a:lic1:Ha");
    // Ixtiyoriy savol — o‘tkazib yuboriladi
    expect(JSON.stringify(t.calls.at(-1)?.payload.reply_markup)).toContain("rg:skip");
    await t.press(555, "rg:skip");
    const draft = await t.draft();
    expect(draft?.step).toBe("summary");
    await t.press(555, "rg:submit");
    await t.press(900, `hr:a:${draft!.id}`);
    const employee = (await t.store.readDb()).employees.find((e) => e.telegramId === "555")!;
    expect(employee.customFields).toEqual({ "Ish tajribangiz qancha": "3 yildan ko‘p", "Haydovchilik guvohnomangiz bormi": "Ha" });
    expect(employee.parentPhone).toBeUndefined();
    expect(employee.login).toBeUndefined();
    expect((await t.store.readDb()).staffCredentials).toHaveLength(0);
    // Grafik ko‘rsatilmagan — standart 09:00–18:00 yaratiladi
    expect((await t.store.readDb()).schedules.find((s) => s.id === employee.scheduleId)?.days[1].start).toBe("09:00");
  });

  it("majburiy tizim maydonlarini o‘chirib bo‘lmaydi, variantsiz tanlov to‘ldiriladi", async () => {
    const { normalizeForm } = await import("../server/registration");
    const form = normalizeForm({ questions: [{ id: "fullName", field: "fullName", type: "name", title: "Ism", required: false, enabled: false }] });
    const byId = Object.fromEntries(form.questions.map((q) => [q.id, q]));
    expect(byId.fullName).toMatchObject({ enabled: true, required: true });
    expect(byId.phone.enabled).toBe(true);
    expect(byId.positionId.enabled).toBe(true);
    expect(byId.branchId.enabled).toBe(true);
    // Eski (saqlangan) anketa: yangi maydonlar yoqilgan holda kerakli joyga qo‘shiladi.
    const ids = form.questions.filter((q) => q.enabled).map((q) => q.id);
    expect(ids.indexOf("gender")).toBe(ids.indexOf("fullName") + 1);
    expect(ids).toContain("pinfl");
    expect(ids.slice(-3)).toEqual(["idDocument", "selfie", "appLogin"]);
    // Email — yangi tizim maydoni: ota-ona telefonidan keyin, o‘chiq va ixtiyoriy.
    const all = form.questions.map((q) => q.id);
    expect(all.indexOf("email")).toBe(all.indexOf("parentPhone") + 1);
    expect(byId.email).toMatchObject({ enabled: false, required: false, type: "email" });
    expect(byId.appLogin).toMatchObject({ enabled: true, required: true, type: "login" });
    const custom = normalizeForm({ questions: [{ id: "abcd1", type: "choice", title: "Tanlang", options: [], required: true, enabled: true }] });
    expect(custom.questions.find((q) => q.id === "abcd1")?.options).toEqual(["Ha", "Yo‘q"]);
  });

  it("ilova logini har doim oxirida; yangi savol turlari (yosh, email) saqlanadi", async () => {
    const { normalizeForm, defaultForm, CUSTOM_TYPES, validateText } = await import("../server/registration");
    expect(CUSTOM_TYPES).toEqual(["text", "number", "age", "phone", "email", "date", "money", "choice", "yesno"]);
    const base = defaultForm().questions;
    expect(base.at(-1)?.id).toBe("appLogin");
    const login = base.find((q) => q.id === "appLogin")!;
    const form = normalizeForm({
      questions: [
        { ...login, required: false },
        ...base.filter((q) => q.id !== "appLogin"),
        { id: "age1", type: "age", title: "Yoshingiz?", required: true, enabled: true },
        { id: "mail1", type: "email", title: "Ish emailingiz?", required: false, enabled: true },
        { id: "bad1", type: "login" as never, title: "Begona tur", required: true, enabled: true },
      ],
    });
    expect(form.questions.at(-1)).toMatchObject({ id: "appLogin", required: true });
    const byId = Object.fromEntries(form.questions.map((q) => [q.id, q]));
    expect(byId.age1.type).toBe("age");
    expect(byId.mail1.type).toBe("email");
    // «login» — faqat tizim maydoni uchun; qo‘shimcha savolda matnga aylanadi.
    expect(byId.bad1.type).toBe("text");
    expect(validateText(byId.age1, "13")?.ok).toBe(false);
    expect(validateText(byId.age1, "30")).toEqual({ ok: true, value: "30" });
    expect(validateText(byId.mail1, "ali@mail.uz")).toEqual({ ok: true, value: "ali@mail.uz" });
  });

  it("anketa mavjud xodimning kirish ma’lumotini almashtira olmaydi; HR ogohlantiriladi", async () => {
    const t = await setup();
    const { normalizeForm, defaultForm, existingEmployeeMatch } = await import("../server/registration");
    await t.store.updateDb((db) => {
      db.companies[0].registrationForm = normalizeForm({
        questions: defaultForm().questions.map((q) => ({ ...q, enabled: ["fullName", "phone", "positionId", "branchId", "appLogin"].includes(q.id) })),
      });
      db.employees.push({ id: "victim", companyId: "c1", employeeNo: "EMP-0001", firstName: "Vali", lastName: "Karimov", phone: "+998932303410", status: "ACTIVE", telegramId: "111", login: "vali@staffora.uz", branchId: "b1", positionId: "p1", baseSalary: 0, startDate: "2026-01-01" } as never);
      db.staffCredentials.push({ id: "cv", companyId: "c1", employeeId: "victim", login: "vali@staffora.uz", passwordHash: "$2a$12$victimhash", createdAt: "", updatedAt: "" });
      // Boshqa Telegram hisobidan hamkasbining telefoni va o‘z paroli bilan anketa.
      db.registrations.push({
        id: "r9", companyId: "c1", telegramId: "555", status: "DRAFT", step: "summary",
        data: { fullName: "Vali Karimov", phone: "+998932303410", positionId: "p1", branchId: "b1", appLogin: "hujumchi@staffora.uz", appPasswordHash: "$2a$12$attacker" },
        createdAt: "", updatedAt: new Date().toISOString(),
      });
    });
    await t.press(555, "rg:submit");
    expect((await t.store.readDb()).registrations.find((r) => r.id === "r9")?.status).toBe("PENDING");
    const hr = t.calls.find((c) => c.method === "sendMessage" && c.payload.chat_id === "900");
    expect(String(hr?.payload.text)).toContain("mavjud xodimniki — <b>Vali Karimov</b>");
    const before = await t.store.readDb();
    expect(existingEmployeeMatch(before, before.registrations.find((r) => r.id === "r9")!)).toMatchObject({ by: "phone", name: "Vali Karimov" });
    await t.press(900, "hr:a:r9");
    const db = await t.store.readDb();
    expect(db.registrations.find((r) => r.id === "r9")?.status).toBe("APPROVED");
    expect(db.staffCredentials.find((c) => c.employeeId === "victim")).toMatchObject({ login: "vali@staffora.uz", passwordHash: "$2a$12$victimhash" });
    expect(db.staffCredentials.some((c) => c.login === "hujumchi@staffora.uz")).toBe(false);
    expect(db.registrations.find((r) => r.id === "r9")?.data.appPasswordHash).toBeUndefined();
    expect(t.lastText()).toContain("kirish ma’lumotlari o‘zgarmadi");
  });

  it("band login rad etiladi; taklif bo‘sh loginni beradi; tasdiqlashda band bo‘lsa — loginsiz tasdiqlanadi", async () => {
    const t = await setup();
    await t.store.updateDb((db) => {
      db.staffCredentials.push({ id: "s1", companyId: "c9", employeeId: "x9", login: "ali.valiyev@staffora.uz", passwordHash: "$2a$12$x", createdAt: "", updatedAt: "" });
      db.users.push({ id: "u9", name: "Direktor", email: "boss@firma.uz", passwordHash: "", role: "COMPANY_OWNER", companyId: "c9", mobileLogin: "direktor@staffora.uz" } as never);
      db.registrations.push({
        id: "r7", companyId: "c1", telegramId: "555", status: "DRAFT", step: "appLogin",
        data: { fullName: "Ali Valiyev", phone: "+998932303410", positionId: "p1", branchId: "b1" },
        createdAt: "", updatedAt: new Date().toISOString(),
      });
    });
    const { buttonsFor, companyForm } = await import("../server/registration");
    const db = await t.store.readDb();
    const question = companyForm(db.companies[0]).questions.find((q) => q.id === "appLogin")!;
    expect(JSON.stringify(buttonsFor(question, db, "c1", { fullName: "Ali Valiyev" }))).toContain("ali.valiyev2@staffora.uz");
    await t.text(555, "ali.valiyev");
    expect(t.lastText()).toContain("band");
    await t.text(555, "direktor@staffora.uz");
    expect(t.lastText()).toContain("band");
    expect((await t.draft())?.data.appLogin).toBeUndefined();

    // PENDING anketa: login tanlangan, lekin tasdiqlashdan oldin boshqa xodim olib qo‘ygan.
    await t.store.updateDb((next) => {
      const row = next.registrations.find((r) => r.id === "r7")!;
      Object.assign(row, { status: "PENDING", step: "summary" });
      Object.assign(row.data, { appLogin: "ali.free@staffora.uz", appPasswordHash: "$2a$12$hash" });
      next.staffCredentials.push({ id: "s2", companyId: "c9", employeeId: "x8", login: "ali.free@staffora.uz", passwordHash: "$2a$12$y", createdAt: "", updatedAt: "" });
    });
    const result = await t.bots.decideRegistration("c1", "r7", "APPROVE", "HR");
    expect(result.employee?.id).toBeTruthy();
    const after = await t.store.readDb();
    expect(after.staffCredentials.some((c) => c.employeeId === result.employee!.id)).toBe(false);
    expect(after.registrations.find((r) => r.id === "r7")?.data.appPasswordHash).toBeUndefined();
    expect(t.lastText()).toContain("Mini App → Profil");
  });
});
