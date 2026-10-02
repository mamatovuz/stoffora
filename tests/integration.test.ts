import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../lib/types";
import { createFakeBot, GOOD_KEY, REVOKED_KEY } from "./helpers/fake-bot";

/*
 * Xodimlar boti integratsiyasi testlari (spetsifikatsiyadagi 27 holat).
 * Bot API xotiradagi soxta server (tests/helpers/fake-bot.ts), Staffora
 * bazasi — vaqtinchalik SQLite fayl. Tarmoqqa chiqilmaydi.
 */

let dir: string;
const BOT_URL = "https://bot.example.test";

async function boot(fakeOptions: Parameters<typeof createFakeBot>[0] = {}) {
  vi.resetModules();
  const fake = createFakeBot(fakeOptions);
  const client = await import("../server/integrations/client");
  client.configureBotClientForTests({ fetchImpl: fake.fetchImpl, sleep: async () => undefined });
  const store = await import("../lib/store");
  const routes = await import("../server/integrations/routes");
  const sync = await import("../server/integrations/sync");
  const worker = await import("../server/integrations/worker");
  const model = await import("../server/integrations/model");
  const sql = await import("../server/integrations/sqlstore");
  const access = await import("../server/integrations/access");
  const telegram = await import("../server/telegram");
  const hooks = await import("../server/integrations/hooks");
  const secrets = await import("../server/integrations/secrets");
  const webhook = await import("../server/integrations/webhook");
  const announce = await import("../server/integrations/announce");

  await store.updateDb((db) => {
    for (const id of ["c1", "c2"])
      db.companies.push({ id, name: id === "c1" ? "Gulnora" : "Boshqa MChJ", slug: id, ownerName: "O", plan: "B", status: "ACTIVE", timezone: "Asia/Tashkent", createdAt: "" });
  });

  // Haqiqiy server tartibida: raw body → webhook router → (soxta) auth → integratsiya router.
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    }),
  );
  app.use("/api", routes.createIntegrationWebhookRouter());
  app.use("/api", (req, _res, next) => {
    const [companyId, role] = String(req.header("x-test-user") || "c1:COMPANY_OWNER").split(":");
    (req as Request & { session: unknown }).session = { sid: "s", userId: "u", companyId, name: `Admin ${companyId}`, email: "a@t.uz", role: role as Role };
    next();
  });
  app.use("/api", routes.createIntegrationRouter());
  app.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error.status || (error.name === "ZodError" ? 400 : 500)).json({ message: error.message });
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (method: string, url: string, body?: unknown, user = "c1:COMPANY_OWNER") => {
    const res = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", "x-test-user": user },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, text, body: text ? JSON.parse(text) : undefined };
  };
  const connect = async (user = "c1:COMPANY_OWNER") => {
    const res = await call("POST", "/integrations", { baseUrl: BOT_URL, apiKey: GOOD_KEY }, user);
    expect(res.status).toBe(201);
    return res.body.integration.id as string;
  };
  const waitJob = async (integrationId: string, jobId: string, user = "c1:COMPANY_OWNER") => {
    for (let i = 0; i < 200; i += 1) {
      const job = await call("GET", `/integrations/${integrationId}/jobs/${jobId}`, undefined, user);
      if (["DONE", "FAILED", "PARTIAL"].includes(job.body.status)) return job.body;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("job tugamadi");
  };
  const initialSync = async (integrationId: string, user = "c1:COMPANY_OWNER") => {
    const job = await call("POST", `/integrations/${integrationId}/sync`, { type: "INITIAL" }, user);
    expect(job.status).toBe(202);
    return waitJob(integrationId, job.body.id, user);
  };
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { base, fake, store, routes, sync, worker, model, sql, access, telegram, hooks, secrets, webhook, announce, call, connect, initialSync, waitJob, close };
}

type Ctx = Awaited<ReturnType<typeof boot>>;
let ctx: Ctx | undefined;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "staffora-integration-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
  process.env.INTEGRATION_WORKER = "false";
  process.env.TELEGRAM_BOT_USERNAME = "StafforaTestBot";
  process.env.APP_URL = "https://staffora.example.test";
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.BOOTSTRAP_COMPANY_NAME;
  delete process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL;
});
afterEach(async () => {
  await ctx?.store.flushDb();
  await ctx?.close();
  ctx = undefined;
  delete process.env.SQLITE_PATH;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows fayl qulfi */
  }
});

describe("ulanish va autentifikatsiya", () => {
  it("1. Connection test — bot ma’lumoti, versiya va kompaniya nomi qaytadi", async () => {
    ctx = await boot();
    const res = await ctx.call("POST", "/integrations/test", { baseUrl: BOT_URL, apiKey: GOOD_KEY });
    expect(res.status).toBe(200);
    expect(res.body.remote).toMatchObject({ apiName: "Gulnora Farm HR Bot API", apiVersion: "v1", companyName: "Gulnora Farm" });
    expect(res.body.baseUrl).toBe(`${BOT_URL}/api/v1`);
    expect(res.body.missingScopes).toEqual([]);
  });

  it("2. Authentication — kalit shifrlangan saqlanadi, javobda va bazada ochiq ko‘rinmaydi", async () => {
    ctx = await boot();
    const res = await ctx.call("POST", "/integrations", { baseUrl: BOT_URL, apiKey: GOOD_KEY });
    expect(res.status).toBe(201);
    expect(res.text).not.toContain(GOOD_KEY);
    expect(res.text).not.toContain("apiKeyEnc");
    expect(res.body.integration.apiKeyHint).toBe("gfk_testpr…");
    await ctx.store.flushDb();
    const raw = new BetterSqlite3(process.env.SQLITE_PATH!, { readonly: true });
    const core = (raw.prepare("SELECT payload FROM app_state").get() as { payload: string }).payload;
    raw.close();
    expect(core).not.toContain(GOOD_KEY);
    const db = await ctx.store.readDb();
    expect(ctx.secrets.decryptSecret(db.integrations[0].apiKeyEnc)).toBe(GOOD_KEY);
    // Webhook secret ham shifrlangan
    expect(db.integrations[0].webhookSecretEnc).toMatch(/^v1:/);
    expect(core).not.toContain("whsec_test");
  });

  it("3. Invalid API key — aniq xabar, hech narsa saqlanmaydi", async () => {
    ctx = await boot();
    const res = await ctx.call("POST", "/integrations", { baseUrl: BOT_URL, apiKey: "gfk_wrong_wrongwrongwrong" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("noto'g'ri");
    expect((await ctx.store.readDb()).integrations).toHaveLength(0);
  });

  it("4. Expired/revoked key — rotate rad etiladi, ishlaydigan kalit o‘zgarmaydi", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    const res = await ctx.call("POST", `/integrations/${id}/rotate-key`, { apiKey: REVOKED_KEY });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("bekor");
    const db = await ctx.store.readDb();
    expect(ctx.secrets.decryptSecret(db.integrations[0].apiKeyEnc)).toBe(GOOD_KEY);
  });
});

describe("import va mapping", () => {
  it("5–8. Filial, bo‘lim, lavozim, xodim importi — barcha maydonlar bilan", async () => {
    ctx = await boot({ branches: 16, employees: 9, attendance: 13 });
    const id = await ctx.connect();
    const preview = await ctx.call("GET", `/integrations/${id}/preview`);
    expect(preview.body.rows.map((r: { entity: string; total: number }) => [r.entity, r.total])).toEqual([
      ["branch", 16],
      ["department", 1],
      ["position", 1],
      ["employee", 9],
      ["attendance", 13],
    ]);
    // Oldindan ko‘rish bazaga yozmaydi
    expect((await ctx.store.readDb()).employees).toHaveLength(0);
    const job = await ctx.initialSync(id);
    expect(job.status).toBe("DONE");
    const db = await ctx.store.readDb();
    const branches = db.branches.filter((b) => b.companyId === "c1");
    expect(branches).toHaveLength(16);
    expect(branches[0]).toMatchObject({ name: "Filial 1", address: "Manzil 1", radiusMeters: 150, status: "ACTIVE", attendanceMode: "GPS_FACE" });
    expect(db.departments.find((d) => d.name === "Dorixona")).toBeTruthy();
    const position = db.positions.find((p) => p.name === "💊 Farmatsevt")!;
    expect(position.departmentId).toBe(db.departments.find((d) => d.name === "Dorixona")!.id);
    const employees = db.employees.filter((e) => e.companyId === "c1");
    expect(employees).toHaveLength(9);
    const first = employees.find((e) => e.firstName === "Ism1")!;
    expect(first).toMatchObject({ lastName: "Familiya1", phone: "+998900000001", birthDate: "1995-04-30", address: "Andijon", positionId: position.id, startDate: "2026-07-01", baseSalary: 0 });
    // Grafik: 08:00–17:00, yakshanba dam
    const schedule = db.schedules.find((s) => s.id === first.scheduleId)!;
    expect(schedule.days.find((d) => d.day === 1)).toMatchObject({ enabled: true, start: "08:00", end: "17:00" });
    expect(schedule.days.find((d) => d.day === 0)?.enabled).toBe(false);
    // Filial grafigi: 08:00 – 24:00 → 23:59
    expect(db.schedules.find((s) => s.id === branches[0].scheduleId)!.days[0].end).toBe("23:59");
    // Maosh (monthly_salary) saqlanmaydi
    const mapping = db.entityMappings.find((m) => m.entity === "employee" && m.localId === first.id)!;
    expect(JSON.stringify(mapping.snapshot)).not.toContain("5000000");
    expect(mapping.provider).toBe("gulnora_hr_bot");
  });

  it("9. Employee deduplication — qayta sync va mavjud xodim (telefon bo‘yicha) dublikat yaratmaydi", async () => {
    ctx = await boot();
    await ctx.store.updateDb((db) => {
      db.employees.push({
        id: "existing", companyId: "c1", employeeNo: "EMP-0001", firstName: "Ism2", lastName: "Familiya2", phone: "+998 90 000 00 02", email: "",
        departmentId: "", positionId: "", branchId: "", scheduleId: "", employmentType: "FULL_TIME", startDate: "2026-01-01", baseSalary: 7000000,
        currency: "UZS", telegramConnected: false, deviceStatus: "PENDING", status: "ACTIVE", createdAt: "", updatedAt: "",
      });
    });
    const id = await ctx.connect();
    const first = await ctx.initialSync(id);
    expect(first.counters.employee).toMatchObject({ created: 2, linked: 1 });
    const again = await ctx.call("POST", `/integrations/${id}/sync`, { entities: ["employee"] });
    const second = await ctx.waitJob(id, again.body.id);
    expect(second.counters.employee).toMatchObject({ created: 0, linked: 0 });
    const db = await ctx.store.readDb();
    expect(db.employees.filter((e) => e.companyId === "c1")).toHaveLength(3);
    // Mavjud xodimning maoshi saqlanib qoladi
    expect(db.employees.find((e) => e.id === "existing")!.baseSalary).toBe(7000000);
  });

  it("10. Telegram mapping — bot bergan Telegram ID bilan /start avtomatik ulaydi, begona ID ulanmaydi", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    await ctx.initialSync(id);
    let db = await ctx.store.readDb();
    const employee = db.employees.find((e) => e.telegramId === "1001")!;
    expect(employee).toMatchObject({ telegramIdSource: "INTEGRATION", telegramConnected: false });
    const stranger = await ctx.telegram.linkEmployeeByKnownTelegramId({ id: 999999 });
    expect(stranger.ok).toBe(false);
    const linked = await ctx.telegram.linkEmployeeByKnownTelegramId({ id: 1001, username: "user1" });
    expect(linked.ok).toBe(true);
    db = await ctx.store.readDb();
    expect(db.employees.find((e) => e.id === employee.id)).toMatchObject({ telegramConnected: true, deviceStatus: "CONNECTED" });
  });

  it("11. Attendance import — tarix to‘g‘ri o‘giriladi, Staffora'ning o‘z yozuvi qaytib kelmaydi", async () => {
    ctx = await boot({ attendance: 2 });
    const id = await ctx.connect();
    await ctx.initialSync(id);
    const db = await ctx.store.readDb();
    const rows = db.attendance.filter((a) => a.companyId === "c1").sort((a, b) => a.date.localeCompare(b.date));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2026-09-01", checkIn: "08:10", checkOut: "17:05", lateMinutes: 10, workedMinutes: 535, source: "BOT", verification: ["GPS"] });
    expect(rows[0].externalIds).toEqual({ gulnora_hr_bot: "1" });
    // Staffora yuborgan yozuv (source=staffora) import qilinmaydi
    const echo = await ctx.store.updateDb((next) =>
      ctx!.sync.applyRemoteAttendance(next, next.integrations[0], {
        id: 500, employee: { id: 1 }, date: "2026-09-10", check_in: "2026-09-10T09:00:00+05:00", source: "staffora", external_ids: { staffora: "local-1" },
      }),
    );
    expect(echo.action).toBe("skipped");
    expect((await ctx.store.readDb()).attendance.filter((a) => a.companyId === "c1")).toHaveLength(2);
  });
});

describe("webhook", () => {
  it("12. Webhook verification — to‘g‘ri imzo qabul qilinadi, noto‘g‘ri imzo 401", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    await ctx.initialSync(id);
    const envelope = ctx.fake.botPatch("employees", 1, { phone: "+998977777777" });
    const body = JSON.stringify(envelope);
    const post = (signature: string) => rawPost(ctx!, id, body, signature);
    const bad = await post(ctx.webhook.signatureHeader("whsec_wrong", body));
    expect(bad.status).toBe(401);
    const good = await post(ctx.webhook.signatureHeader("whsec_test1", body));
    expect(good.status).toBe(202);
    await waitFor(async () => (await ctx!.store.readDb()).employees.some((e) => e.phone === "+998977777777"));
  });

  it("13. Replay protection — 5 daqiqadan eski imzo rad etiladi", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    const body = JSON.stringify({ id: "evt_x", event: "employee.updated", data: { id: 1 } });
    const old = Math.floor(Date.now() / 1000) - 301;
    const res = await rawPost(ctx, id, body, ctx.webhook.signatureHeader("whsec_test1", body, old));
    expect(res.status).toBe(401);
    expect(ctx.webhook.verifySignature("s", ctx.webhook.signatureHeader("s", "b", 1000), "b", 1000 + 299).ok).toBe(true);
    expect(ctx.webhook.verifySignature("s", ctx.webhook.signatureHeader("s", "b", 1000), "b", 1000 + 301)).toEqual({ ok: false, reason: "expired" });
    expect(ctx.webhook.verifySignature("s", ctx.webhook.signatureHeader("s", "b", 1000), "b-o‘zgargan", 1000)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("14. Webhook idempotency — bir xil hodisa ikki marta qo‘llanmaydi (webhook + polling)", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    await ctx.initialSync(id);
    const envelope = ctx.fake.botPatch("employees", 2, { address: "Yangi manzil" });
    const body = JSON.stringify(envelope);
    const first = await rawPost(ctx, id, body, ctx.webhook.signatureHeader("whsec_test1", body));
    const second = await rawPost(ctx, id, body, ctx.webhook.signatureHeader("whsec_test1", body));
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect((await second.json()).duplicate).toBe(true);
    await waitFor(async () => (await ctx!.sql.listEvents(id)).some((e) => e.status === "processed"));
    // Xuddi shu hodisa changes lentasida ham bor — qayta qo‘llanmaydi
    const processed = await ctx.worker.pollChanges(id);
    expect(processed).toBe(0);
    const events = await ctx.sql.listEvents(id);
    expect(events.filter((e) => e.eventId === envelope.id)).toHaveLength(1);
  });
});

describe("xabarlar", () => {
  it("15. Announcement — bot orqali e’lon, hisobot va statistika yangilanadi", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    await ctx.initialSync(id);
    const announcementId = "a1";
    await ctx.store.updateDb((db) =>
      db.announcements.unshift({ id: announcementId, companyId: "c1", title: "Yangi tizim", message: "Staffora ishga tushdi", audience: "Barcha", channel: ["BOT"], scheduledAt: new Date().toISOString(), status: "SENT", target: { type: "ALL", ids: [] } }),
    );
    await ctx.announce.enqueueAnnouncementToBot(announcementId);
    let a = (await ctx.store.readDb()).announcements[0];
    expect(a.report?.bot).toMatchObject({ status: "QUEUED", recipients: 3, externalId: "1" });
    expect(ctx.fake.state.announcements[0]).toMatchObject({ recipients: { send_to_all: true }, source: "staffora" });
    await ctx.worker.runWorkerOnce({ force: true });
    a = (await ctx.store.readDb()).announcements[0];
    expect(a.report?.bot).toMatchObject({ status: "SENT", sent: 3 });
  });

  it("16. Bot notification — yo‘nalish (routing) bo‘yicha bot orqali xabar va yetkazish holati", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    await ctx.initialSync(id);
    let db = await ctx.store.readDb();
    const employee = db.employees.find((e) => e.telegramId === "1001")!;
    const used = await ctx.hooks.notifyEmployee(db, employee, "announcements", "Salom");
    expect(used).toEqual(["bot"]);
    await ctx.worker.processOutbox();
    const sent = ctx.fake.state.notifications.at(-1)!;
    expect(sent).toMatchObject({ employee_id: 1, message: "Salom", source: "staffora", type: "staffora_announcements" });
    // routing: system → faqat staffora — botga ketmaydi
    db = await ctx.store.readDb();
    expect(await ctx.hooks.notifyEmployee(db, employee, "system", "Tizim")).toEqual([]);
    await ctx.worker.runWorkerOnce({ force: true });
    const deliveries = await ctx.sql.deliveriesByRef("c1", "NOTIFY", "announcements");
    expect(deliveries[0].status).toBe("SENT");
  });

  it("17. Audience filtering — filial/lavozim/xodim bo‘yicha qabul qiluvchilar", async () => {
    ctx = await boot({ branches: 3, employees: 6 });
    const id = await ctx.connect();
    await ctx.initialSync(id);
    const db = await ctx.store.readDb();
    const branch1 = db.entityMappings.find((m) => m.entity === "branch" && m.externalId === "1")!.localId;
    const inBranch = ctx.announce.targetEmployees(db, "c1", { type: "BRANCHES", ids: [branch1] });
    expect(inBranch.map((e) => e.firstName).sort()).toEqual(["Ism1", "Ism4"]);
    expect(ctx.announce.botRecipients(db, id, "c1", { type: "BRANCHES", ids: [branch1] }).recipients).toEqual({ branch_ids: [1] });
    const one = db.employees.find((e) => e.firstName === "Ism3")!;
    expect(ctx.announce.botRecipients(db, id, "c1", { type: "EMPLOYEES", ids: [one.id] }).recipients).toEqual({ employee_ids: [3] });
    // Bot'ga bog‘lanmagan filial — auditoriyadagi xodimlarga to‘g‘ridan-to‘g‘ri
    const localOnly = ctx.announce.botRecipients(db, id, "c1", { type: "BRANCHES", ids: ["no-such-branch"] });
    expect(localOnly.skipped).toBe(1);
    // Boshqa kompaniya xodimlari hech qachon kirmaydi
    expect(ctx.announce.targetEmployees(db, "c2", { type: "ALL", ids: [] })).toHaveLength(0);
  });
});

describe("ishonchlilik", () => {
  it("18. Retry — 5xx dan keyin qayta urinib muvaffaqiyatga erishadi", async () => {
    ctx = await boot();
    ctx.fake.state.failNext.push({ status: 503, path: /\/integration\/info/ }, { status: 500, path: /\/integration\/info/ });
    const res = await ctx.call("POST", "/integrations/test", { baseUrl: BOT_URL, apiKey: GOOD_KEY });
    // maxRetries=1 test ulanishida — ikkinchi xato bilan 502
    expect(res.status).toBe(502);
    const client = new (await import("../server/integrations/client")).BotClient({ baseUrl: BOT_URL, apiKey: GOOD_KEY, sleep: async () => undefined });
    ctx.fake.state.failNext.push({ status: 503 }, { status: 502 });
    const { data } = await client.get<{ name: string }>("/integration/info");
    expect(data.name).toBe("Gulnora Farm HR Bot API");
  });

  it("19. Rate limit — 429 da Retry-After kutiladi, navbat urinish sanamaydi", async () => {
    ctx = await boot();
    const waits: number[] = [];
    const { BotClient } = await import("../server/integrations/client");
    const client = new BotClient({ baseUrl: BOT_URL, apiKey: GOOD_KEY, sleep: async (ms) => void waits.push(ms) });
    ctx.fake.state.failNext.push({ status: 429, retryAfter: 7 });
    await client.get("/integration/info");
    expect(waits).toEqual([7000]);
    // Navbat: 429 → faqat keyinga suriladi (attempts o‘smaydi)
    const id = await ctx.connect();
    await ctx.initialSync(id);
    const db = await ctx.store.readDb();
    await ctx.sql.enqueueOutbox(db.integrations[0], "notification.send", { body: { employee_id: 1, message: "x" } }, "rl-1");
    ctx.fake.state.failNext.push(...Array.from({ length: 4 }, () => ({ status: 429, retryAfter: 0, path: /\/notifications$/ })));
    await ctx.worker.processOutbox();
    const row = (await ctx.sql.listOutbox(id)).find((r) => r.kind === "notification.send")!;
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);
  });

  it("20. Multi-tenant isolation — boshqa kompaniya integratsiyasini ko‘rolmaydi va o‘zgartirolmaydi", async () => {
    ctx = await boot();
    const id = await ctx.connect("c1:COMPANY_OWNER");
    await ctx.initialSync(id);
    const other = await ctx.call("GET", `/integrations/${id}`, undefined, "c2:COMPANY_OWNER");
    expect(other.status).toBe(404);
    expect((await ctx.call("GET", "/integrations", undefined, "c2:COMPANY_OWNER")).body.items).toHaveLength(0);
    expect((await ctx.call("POST", `/integrations/${id}/disconnect`, {}, "c2:COMPANY_OWNER")).status).toBe(404);
    expect((await ctx.call("GET", `/integrations/${id}/access`, undefined, "c2:COMPANY_OWNER")).status).toBe(404);
    const c1Employee = (await ctx.store.readDb()).employees.find((e) => e.companyId === "c1")!;
    expect((await ctx.call("POST", `/employees/${c1Employee.id}/access/revoke`, {}, "c2:COMPANY_OWNER")).status).toBe(404);
    // c2 o‘zining alohida integratsiyasini ulay oladi — c1 mapping'lari aralashmaydi
    const id2 = await ctx.connect("c2:COMPANY_OWNER");
    expect(id2).not.toBe(id);
    await ctx.initialSync(id2, "c2:COMPANY_OWNER");
    const db = await ctx.store.readDb();
    expect(db.employees.filter((e) => e.companyId === "c2")).toHaveLength(3);
    expect(db.entityMappings.filter((m) => m.integrationId === id2).every((m) => m.companyId === "c2")).toBe(true);
  });

  it("21. RBAC — oddiy xodim va moliya roli integratsiyani boshqara olmaydi", async () => {
    ctx = await boot();
    for (const role of ["EMPLOYEE", "FINANCE", "BRANCH_MANAGER"]) {
      const res = await ctx.call("POST", "/integrations", { baseUrl: BOT_URL, apiKey: GOOD_KEY }, `c1:${role}`);
      expect(res.status, role).toBe(403);
    }
    expect((await ctx.call("GET", "/integrations", undefined, "c1:EMPLOYEE")).status).toBe(403);
    // HR admin va IT admin — ruxsat bor
    expect((await ctx.call("POST", "/integrations/test", { baseUrl: BOT_URL, apiKey: GOOD_KEY }, "c1:HR_ADMIN")).status).toBe(200);
    expect((await ctx.call("POST", "/integrations/test", { baseUrl: BOT_URL, apiKey: GOOD_KEY }, "c1:IT_ADMIN")).status).toBe(200);
  });
});

describe("kirish havolalari", () => {
  it("22. Invite token — shaxsiy, tasodifiy, muddatli, bir martalik; bot orqali yuboriladi", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    await ctx.initialSync(id);
    const res = await ctx.call("POST", `/integrations/${id}/access/send`, { all: true });
    expect(res.status).toBe(202);
    expect(res.body.planned).toBe(3);
    await ctx.waitJob(id, res.body.id);
    await ctx.worker.processOutbox();
    const messages = ctx.fake.state.notifications.filter((n) => n.type === "staffora_access");
    expect(messages).toHaveLength(3);
    const links = messages.map((m) => /https:\/\/t\.me\/StafforaTestBot\?start=([A-Za-z0-9_-]+)/.exec(String(m.message))![1]);
    expect(new Set(links).size).toBe(3);
    expect(links.every((code) => code.length >= 32 && code.length <= 64)).toBe(true);
    // Bir xil Idempotency-Key — qayta yuborilsa ham bitta xabar
    expect(new Set(ctx.fake.state.calls.filter((c) => c.path === "/notifications").map((c) => c.idempotencyKey)).size).toBe(3);
    const db = await ctx.store.readDb();
    const invite = db.telegramInvites.find((i) => i.code === links[0])!;
    expect(invite).toMatchObject({ oneTime: true, channel: "BOT" });
    expect(new Date(invite.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    // Havola bilan ulanish — bir marta ishlaydi
    const ok = await ctx.telegram.linkEmployeeByInvite(links[0], { id: 5555 });
    expect(ok.ok).toBe(true);
    const reused = await ctx.telegram.linkEmployeeByInvite(links[0], { id: 6666 });
    expect(reused.ok).toBe(false);
    const access = await ctx.call("GET", `/integrations/${id}/access`);
    expect(access.body.summary).toMatchObject({ total: 3, connected: 1, inBot: 3 });
  });

  it("23. Invite revoke — bekor qilingan va qayta yaratilgan havolaning eskisi ishlamaydi", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    await ctx.initialSync(id);
    const employee = (await ctx.store.readDb()).employees.find((e) => e.companyId === "c1")!;
    const first = await ctx.call("POST", `/integrations/${id}/access/${employee.id}/link`, {});
    const second = await ctx.call("POST", `/integrations/${id}/access/${employee.id}/link`, {});
    const code = (link: string) => new URL(link).searchParams.get("start")!;
    expect((await ctx.telegram.linkEmployeeByInvite(code(first.body.link), { id: 7001 })).ok).toBe(false);
    const revoke = await ctx.call("POST", `/employees/${employee.id}/access/revoke`, {});
    expect(revoke.body.revoked).toBe(1);
    expect((await ctx.telegram.linkEmployeeByInvite(code(second.body.link), { id: 7001 })).ok).toBe(false);
  });
});

describe("hayot sikli", () => {
  it("24–25. Disconnect ma’lumotni o‘chirmaydi; Reconnect dublikatsiz davom etadi", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    await ctx.initialSync(id);
    const dis = await ctx.call("POST", `/integrations/${id}/disconnect`, {});
    expect(dis.body.status).toBe("DISCONNECTED");
    let db = await ctx.store.readDb();
    expect(db.employees.filter((e) => e.companyId === "c1")).toHaveLength(3);
    expect(db.entityMappings.filter((m) => m.integrationId === id).length).toBeGreaterThan(0);
    // Uzilgan holatda webhook qabul qilinmaydi
    const body = JSON.stringify({ id: "evt_z", event: "employee.updated", data: { id: 1 } });
    expect((await rawPost(ctx, id, body, ctx.webhook.signatureHeader("whsec_test1", body))).status).toBe(404);
    const again = await ctx.connect();
    expect(again).toBe(id);
    const job = await ctx.initialSync(id);
    expect(job.counters.employee).toMatchObject({ created: 0 });
    db = await ctx.store.readDb();
    expect(db.employees.filter((e) => e.companyId === "c1")).toHaveLength(3);
  });

  it("26. Conflict handling — ikkala tomon o‘zgartirsa MANUAL konflikt, keyin hal qilinadi", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    await ctx.initialSync(id);
    const mapping = (await ctx.store.readDb()).entityMappings.find((m) => m.entity === "employee" && m.externalId === "1")!;
    await ctx.store.updateDb((db) => {
      const e = db.employees.find((x) => x.id === mapping.localId)!;
      e.address = "Staffora manzili";
      e.phone = "+998911111111";
    });
    const envelope = ctx.fake.botPatch("employees", 1, { address: "Bot manzili", full_name: "Familiya1 Yangi" });
    await ctx.worker.processRecordedEvent((await ctx.store.readDb()).integrations[0], envelope);
    let db = await ctx.store.readDb();
    let employee = db.employees.find((x) => x.id === mapping.localId)!;
    // Faqat bot o‘zgartirgan maydon (ism) qo‘llandi, manzil — konflikt
    expect(employee.firstName).toBe("Yangi");
    expect(employee.address).toBe("Staffora manzili");
    const conflict = db.integrationConflicts.find((c) => c.status === "OPEN")!;
    expect(conflict.fields).toEqual([{ field: "address", local: "Staffora manzili", remote: "Bot manzili" }]);
    // Ochiq konflikt bor ekan — eksport qilinmaydi
    expect(await ctx.sync.queueOutboundChanges(id)).toBe(0);
    const resolve = await ctx.call("POST", `/integrations/${id}/conflicts/${conflict.id}/resolve`, { use: "STAFFORA" });
    expect(resolve.status).toBe(200);
    // Staffora tanlandi — endi Staffora qiymatlari botga yuboriladi
    expect(await ctx.sync.queueOutboundChanges(id)).toBe(1);
    await ctx.worker.processOutbox();
    expect(ctx.fake.state.employees.find((e) => e.id === 1)).toMatchObject({ address: "Staffora manzili", phone: "+998911111111" });
    db = await ctx.store.readDb();
    employee = db.employees.find((x) => x.id === mapping.localId)!;
    expect(employee.address).toBe("Staffora manzili");
    // BOT_WINS strategiyasi — konfliktsiz bot qiymati
    await ctx.call("PUT", `/integrations/${id}/settings`, { conflictStrategy: "BOT_WINS" });
    await ctx.store.updateDb((next) => void (next.employees.find((x) => x.id === mapping.localId)!.address = "Yana Staffora"));
    const e2 = ctx.fake.botPatch("employees", 1, { address: "Yana bot" });
    await ctx.worker.processRecordedEvent((await ctx.store.readDb()).integrations[0], e2);
    expect((await ctx.store.readDb()).employees.find((x) => x.id === mapping.localId)!.address).toBe("Yana bot");
  });

  it("27. Failed API recovery — bot ishlamasa Staffora buzilmaydi, navbat keyin yetkazadi", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    await ctx.initialSync(id);
    const db = await ctx.store.readDb();
    const employee = db.employees.find((e) => e.telegramId === "1001")!;
    ctx.fake.state.down = true;
    // Mini App'dagi keldi-ketdi — xodimlar botiga navbat orqali
    const attendance = { id: "att-1", companyId: "c1", employeeId: employee.id, branchId: employee.branchId, date: "2026-09-29", scheduledStart: "08:00", scheduledEnd: "17:00", checkIn: "08:03", lateMinutes: 3, earlyLeaveMinutes: 0, workedMinutes: 0, overtimeMinutes: 0, status: "LATE" as const, verification: ["FACE" as const, "GPS" as const], latitude: 40.7, longitude: 72.3, updatedAt: new Date().toISOString() };
    await ctx.store.updateDb((next) => void next.attendance.push(attendance));
    ctx.hooks.onStafforaAttendance("c1", attendance, "CHECK_IN");
    await waitFor(async () => (await ctx!.sql.listOutbox(id)).some((r) => r.kind === "attendance.check_in"));
    await ctx.worker.processOutbox();
    let row = (await ctx.sql.listOutbox(id)).find((r) => r.kind === "attendance.check_in")!;
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    const logs = await ctx.sql.listLogs(id, "c1");
    expect(logs.some((l) => l.action === "outbox.attendance.check_in" && l.level === "warn")).toBe(true);
    // Staffora ma’lumoti joyida
    expect((await ctx.store.readDb()).attendance.find((a) => a.id === "att-1")).toBeTruthy();
    // Bot tiklandi — navbat yetkazadi (idempotent)
    ctx.fake.state.down = false;
    await ctx.sql.retryOutbox(id, row.id);
    await ctx.worker.processOutbox();
    row = (await ctx.sql.listOutbox(id)).find((r) => r.kind === "attendance.check_in")!;
    expect(row.status).toBe("done");
    const pushed = ctx.fake.state.calls.find((c) => c.path === "/attendance/check-in")!;
    expect(pushed.body).toMatchObject({ employee_id: 1, timestamp: "2026-09-29T08:03:00+05:00", source: "staffora", verification_method: "face", external_id: "att-1", enforce_geofence: false });
    expect(pushed.idempotencyKey).toBe("att:att-1:CHECK_IN");
    expect((await ctx.store.readDb()).attendance.find((a) => a.id === "att-1")!.externalIds).toEqual({ gulnora_hr_bot: expect.any(String) });
  });
});

describe("bir bosishda kirish (xodimlar boti Mini App)", () => {
  it("xodimlar boti imzolagan initData bilan xodim avtomatik ulanadi; soxtasi rad etiladi", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    await ctx.initialSync(id);
    const identity = await import("../server/integrations/identity");
    // Havola kiritilmaguncha bu yo‘l o‘chiq
    expect(await identity.verifyViaEmployeeBot("signed:1001&hash=x")).toBeNull();
    const saved = await ctx.call("PUT", `/integrations/${id}/settings`, { miniAppLink: "t.me/GulnoraFarmBot/staffora" });
    expect(saved.body.settings.miniAppLink).toBe("https://t.me/GulnoraFarmBot/staffora");
    expect((await ctx.call("PUT", `/integrations/${id}/settings`, { miniAppLink: "https://evil.example/x" })).status).toBe(400);
    const bad = await identity.verifyViaEmployeeBot("tampered&hash=x");
    expect(bad).toBeNull();
    // Xodimlar boti tasdiqlagan initData — xodim topiladi va ulanadi
    const result = await identity.verifyViaEmployeeBot("signed:1001&hash=abc");
    expect(result?.employee.telegramId).toBe("1001");
    const db = await ctx.store.readDb();
    expect(db.employees.find((e) => e.telegramId === "1001")).toMatchObject({ telegramConnected: true, deviceStatus: "CONNECTED" });
    // Botda xodim bo‘lmagan Telegram hisob — kirish yo‘q
    expect(await identity.verifyViaEmployeeBot("signed:999999&hash=abc")).toBeNull();
  });

  it("havolalar yuborilganda Mini App havolasi boradi (kod va START kerak emas)", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    await ctx.initialSync(id);
    await ctx.call("PUT", `/integrations/${id}/settings`, { miniAppLink: "https://t.me/GulnoraFarmBot/staffora" });
    const res = await ctx.call("POST", `/integrations/${id}/access/send`, { all: true });
    await ctx.waitJob(id, res.body.id);
    await ctx.worker.processOutbox();
    const messages = ctx.fake.state.notifications.filter((n) => n.type === "staffora_access");
    expect(messages).toHaveLength(3);
    expect(String(messages[0].message)).toContain("https://t.me/GulnoraFarmBot/staffora");
    expect(String(messages[0].message)).not.toContain("?start=");
  });
});

describe("maosh", () => {
  it("employees:salary ruxsati bo‘lsa maosh import qilinadi, Staffora'da kiritilgani ustidan yozilmaydi", async () => {
    const all = [
      "employees:read", "employees:salary", "branches:read", "departments:read", "positions:read", "attendance:read",
      "integration:read", "company:read", "webhooks:write",
    ];
    ctx = await boot({ scopes: all });
    await ctx.store.updateDb((db) => {
      db.employees.push({
        id: "existing", companyId: "c1", employeeNo: "EMP-0001", firstName: "Ism2", lastName: "Familiya2", phone: "+998900000002", email: "",
        departmentId: "", positionId: "", branchId: "", scheduleId: "", employmentType: "FULL_TIME", startDate: "2026-01-01", baseSalary: 7000000,
        currency: "UZS", telegramConnected: false, deviceStatus: "PENDING", status: "ACTIVE", createdAt: "", updatedAt: "",
      });
    });
    const id = await ctx.connect();
    await ctx.initialSync(id);
    const db = await ctx.store.readDb();
    expect(db.employees.find((e) => e.firstName === "Ism1")!.baseSalary).toBe(5_000_000);
    expect(db.employees.find((e) => e.firstName === "Ism3")!.baseSalary).toBe(3_500_000);
    expect(db.employees.find((e) => e.id === "existing")!.baseSalary).toBe(7_000_000);
    // Maosh snapshot (mapping) ga tushmaydi
    expect(JSON.stringify(db.entityMappings)).not.toContain("5 000 000");
  });
});

describe("bot'dagi o‘chirish va hisoblash sanasi", () => {
  it("bot'da o‘chirilgan xodim Staffora'da ishdan bo‘shatiladi (ma’lumot o‘chmaydi)", async () => {
    ctx = await boot();
    const id = await ctx.connect();
    await ctx.initialSync(id);
    const envelope = ctx.fake.botDelete("employees", 2);
    await ctx.worker.processRecordedEvent((await ctx.store.readDb()).integrations[0], envelope);
    const db = await ctx.store.readDb();
    const mapping = db.entityMappings.find((m) => m.entity === "employee" && m.externalId === "2")!;
    expect(db.employees.find((e) => e.id === mapping.localId)).toMatchObject({ status: "DISMISSED", dismissReason: "Xodimlar botida ishdan bo‘shatilgan" });
  });
});

async function rawPost(c: Ctx, integrationId: string, body: string, signature: string) {
  // Imzo aynan shu matn uchun — call() ishlatilmaydi (u tanani qayta seriyalaydi).
  return fetch(`${c.base}/integrations/${integrationId}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-signature": signature },
    body,
  });
}

async function waitFor(check: () => Promise<boolean>, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("kutish vaqti tugadi");
}
