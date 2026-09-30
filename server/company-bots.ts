import { createHash, randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { Api, Bot, GrammyError, InlineKeyboard, webhookCallback, type Context } from "grammy";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { can } from "../lib/permissions";
import type { Company, CompanyBotSettings, Database, Employee, RegistrationData, RegistrationRequest, RegistrationStep } from "../lib/types";
import type { AuthedRequest } from "./auth";
import { registerCompanyBotApi } from "./bot-registry";
import { decryptSecret, encryptSecret } from "./integrations/secrets";
import {
  EDUCATION_OPTIONS,
  FIELD_LABELS,
  QUESTION_ORDER,
  SHIFTS,
  WEEKDAYS,
  WEEK_ORDER,
  approveRegistration,
  checkAddress,
  checkBirthDate,
  checkFullName,
  checkPhone,
  checkSalary,
  checkWorkHours,
  isComplete,
  money,
  nextStep,
  previousStep,
  questionText,
  rejectRegistration,
  summaryText,
} from "./registration";
import { resolveWebAppUrl } from "./telegram";

/*
 * Kompaniya boti: har bir kompaniya o‘z bot tokenini panel sozlamalarida kiritadi.
 *   - Xodim /start bosadi → anketa (12 savol, tugmalar bilan) → xulosa → tasdiqlash
 *   - Ariza HR (Telegram ID lari sozlamada) ga tugmalar bilan boradi; panelda ham ko‘rinadi
 *   - Tasdiqlansa xodim yaratiladi va unga «Profilimni ochish» (Mini App) tugmasi keladi
 * Token shifrlangan saqlanadi; productionda webhook, aks holda polling.
 */

type Running = { bot: Bot; token: string; webhook?: (req: Request, res: Response) => unknown; mode: "webhook" | "polling" };
const running = new Map<string, Running>();
let stopping = false;

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function defaultBotSettings(): CompanyBotSettings {
  return { enabled: false, registrationEnabled: true, approverTelegramIds: [] };
}

/** Mini App initData ni tekshirish uchun ishlab turgan kompaniya botlari tokenlari. */
export function companyBotTokens() {
  return [...running.entries()].map(([companyId, item]) => ({ companyId, token: item.token }));
}

function webhookSecret(companyId: string, token: string) {
  return createHash("sha256")
    .update(`${companyId}:${token}:${process.env.SESSION_SECRET || "staffora"}`)
    .digest("hex")
    .slice(0, 48);
}

async function setStatus(companyId: string, patch: Partial<CompanyBotSettings>) {
  await updateDb((db) => {
    const company = db.companies.find((c) => c.id === companyId);
    if (company?.bot) Object.assign(company.bot, patch, { updatedAt: new Date().toISOString() });
  });
}

/* ------------------------------------------------------ hayot sikli --- */

export async function startCompanyBots() {
  const db = await readDb();
  for (const company of db.companies)
    if (company.bot?.enabled && company.bot.tokenEnc)
      void startCompanyBot(company.id).catch((error) => console.error(`Kompaniya boti (${company.name}) ishga tushmadi`, error));
}

export async function stopCompanyBot(companyId: string, options: { deleteWebhook?: boolean } = {}) {
  const current = running.get(companyId);
  running.delete(companyId);
  registerCompanyBotApi(companyId, undefined);
  if (!current) return;
  try {
    if (current.mode === "polling") await current.bot.stop();
    else if (options.deleteWebhook) await current.bot.api.deleteWebhook({ drop_pending_updates: false });
  } catch {
    /* to‘xtatishda xato muhim emas */
  }
}

export async function stopAllCompanyBots() {
  stopping = true;
  await Promise.all([...running.keys()].map((id) => stopCompanyBot(id)));
}

export async function startCompanyBot(companyId: string) {
  await stopCompanyBot(companyId);
  const db = await readDb();
  const company = db.companies.find((c) => c.id === companyId);
  if (!company?.bot?.enabled || !company.bot.tokenEnc) return;
  const token = decryptSecret(company.bot.tokenEnc);
  const bot = new Bot(token);
  attachHandlers(bot, companyId);
  bot.catch((error) => console.error(`Kompaniya boti xatosi (${companyId})`, error.error));
  try {
    const me = await bot.api.getMe();
    bot.botInfo = me;
    const { baseUrl, baseOk, webAppUrl, ok } = resolveWebAppUrl();
    await bot.api.setMyCommands([
      { command: "start", description: "Bosh sahifa / ro‘yxatdan o‘tish" },
      { command: "id", description: "Telegram ID ni bilish" },
      { command: "cancel", description: "Anketani bekor qilish" },
    ]);
    if (ok) await bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: "Staffora", web_app: { url: webAppUrl } } });
    const useWebhook =
      process.env.TELEGRAM_USE_WEBHOOK === "true" ||
      (process.env.TELEGRAM_USE_WEBHOOK !== "false" && process.env.NODE_ENV === "production" && baseOk);
    if (useWebhook && baseOk) {
      const secretToken = webhookSecret(companyId, token);
      const handler = webhookCallback(bot, "express", { secretToken, onTimeout: "return" });
      await bot.api.setWebhook(`${baseUrl}/api/telegram/company/${companyId}/webhook`, {
        secret_token: secretToken,
        allowed_updates: ["message", "callback_query"],
      });
      running.set(companyId, { bot, token, webhook: handler, mode: "webhook" });
    } else {
      await bot.api.deleteWebhook({ drop_pending_updates: false });
      running.set(companyId, { bot, token, mode: "polling" });
      void pollLoop(companyId, bot);
    }
    registerCompanyBotApi(companyId, bot.api);
    await setStatus(companyId, { status: "RUNNING", mode: running.get(companyId)?.mode, username: me.username, botId: me.id, lastError: undefined });
    console.log(`Kompaniya boti ishga tushdi: @${me.username} (${company.name})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setStatus(companyId, { status: "ERROR", lastError: message.slice(0, 300) });
    // Tarmoq xatosi bo‘lsa keyinroq qayta urinamiz (token noto‘g‘ri bo‘lsa — yo‘q).
    if (!(error instanceof GrammyError && error.error_code === 401) && !stopping)
      setTimeout(() => void startCompanyBot(companyId).catch(() => undefined), 60_000).unref();
  }
}

async function pollLoop(companyId: string, bot: Bot) {
  let delay = 5_000;
  while (!stopping && running.get(companyId)?.bot === bot) {
    try {
      await bot.start({ allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
      return;
    } catch (error) {
      if (stopping || running.get(companyId)?.bot !== bot) return;
      await setStatus(companyId, { status: "ERROR", lastError: (error as Error).message?.slice(0, 300) });
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(60_000, delay * 2);
    }
  }
}

/** Ochiq webhook yo‘li — autentifikatsiyasiz (Telegram secret_token bilan himoyalangan). */
export function createCompanyBotWebhookRouter() {
  const router = Router();
  router.post("/telegram/company/:companyId/webhook", (req: Request, res: Response, next: NextFunction) => {
    const current = running.get(String(req.params.companyId));
    if (!current?.webhook) return res.sendStatus(404);
    return Promise.resolve(current.webhook(req, res)).catch(next);
  });
  return router;
}

/* ------------------------------------------------------ bot mantiqi --- */

function webAppKeyboard(label = "📲 Profilimni ochish") {
  const { webAppUrl, ok } = resolveWebAppUrl();
  return ok ? new InlineKeyboard().webApp(label, webAppUrl) : undefined;
}

function lookups(db: Database, companyId: string, data: RegistrationData) {
  return {
    position: db.positions.find((p) => p.id === data.positionId && p.companyId === companyId)?.name,
    branch: db.branches.find((b) => b.id === data.branchId && b.companyId === companyId)?.name,
  };
}

function keyboardFor(db: Database, request: RegistrationRequest): InlineKeyboard {
  const kb = new InlineKeyboard();
  const nav = () => {
    const back = previousStep(request.step);
    if (request.editing) kb.row().text("⬅️ Xulosaga qaytish", "rg:summary");
    else {
      kb.row();
      if (back) kb.text("⬅️ Orqaga", "rg:back");
      kb.text("✖️ Bekor qilish", "rg:cancel");
    }
    return kb;
  };
  const tenant = request.companyId;
  switch (request.step) {
    case "positionId": {
      const rows = db.positions.filter((p) => p.companyId === tenant).sort((a, b) => a.name.localeCompare(b.name));
      rows.forEach((p, i) => {
        if (i % 2 === 0) kb.row();
        kb.text(p.name.slice(0, 40), `rg:pos:${p.id}`);
      });
      return nav();
    }
    case "branchId": {
      const rows = db.branches.filter((b) => b.companyId === tenant && b.status === "ACTIVE").sort((a, b) => a.name.localeCompare(b.name));
      rows.forEach((b, i) => {
        if (i % 2 === 0) kb.row();
        kb.text(b.name.slice(0, 40), `rg:br:${b.id}`);
      });
      return nav();
    }
    case "shift":
      kb.row().text(SHIFTS.DAY.label, "rg:sh:DAY").row().text(SHIFTS.NIGHT.label, "rg:sh:NIGHT").row().text(SHIFTS.BOTH.label, "rg:sh:BOTH");
      return nav();
    case "workHours": {
      const presets = SHIFTS[request.data.shift || "DAY"].hours;
      kb.row();
      presets.forEach((hours, i) => kb.text(`🕒 ${hours}`, `rg:wh:${i}`));
      kb.row().text("✍️ Boshqa vaqt", "rg:wh:other");
      return nav();
    }
    case "salaryConfirm":
      kb.row().text("✅ Ha, to‘g‘ri", "rg:sc:yes").text("✏️ Tahrirlash", "rg:sc:edit");
      return kb;
    case "restDay":
      WEEK_ORDER.forEach((day, i) => {
        if (i % 3 === 0) kb.row();
        kb.text(WEEKDAYS[day], `rg:rd:${day}`);
      });
      kb.row().text("♾ Dam olishsiz", "rg:rd:-1");
      return nav();
    case "education":
      EDUCATION_OPTIONS.forEach((label, i) => kb.row().text(label, `rg:ed:${i}`));
      return nav();
    case "summary":
      kb.row().text("✅ Tasdiqlash va yuborish", "rg:submit").row().text("✏️ Tahrirlash", "rg:edit").text("✖️ Bekor qilish", "rg:cancel");
      return kb;
    case "editPick":
      (Object.keys(FIELD_LABELS) as (keyof RegistrationData)[]).forEach((key, i) => {
        if (i % 2 === 0) kb.row();
        kb.text(FIELD_LABELS[key], `rg:ef:${key}`);
      });
      kb.row().text("⬅️ Xulosaga qaytish", "rg:summary");
      return kb;
    default:
      return nav();
  }
}

function promptText(db: Database, request: RegistrationRequest, company: Company) {
  if (request.step === "summary")
    return summaryText(request, company.name, lookups(db, company.id, request.data), "Ma’lumotlar to‘g‘rimi? Tasdiqlasangiz, anketa HR bo‘limiga yuboriladi.");
  if (request.step === "editPick")
    return summaryText(request, company.name, lookups(db, company.id, request.data), "✏️ <b>Qaysi ma’lumotni o‘zgartirasiz?</b>");
  return questionText(request.step, request.data, company.name);
}

/** Joriy savolni yuboradi; oldingi savol tugmalarini olib tashlaydi. */
async function ask(ctx: Context, companyId: string, requestId: string, note?: string) {
  const db = await readDb();
  const company = db.companies.find((c) => c.id === companyId);
  const request = db.registrations.find((r) => r.id === requestId);
  if (!company || !request || !ctx.chat) return;
  if (request.lastPromptId)
    await ctx.api.editMessageReplyMarkup(ctx.chat.id, request.lastPromptId).catch(() => undefined);
  const text = `${note ? `${note}\n\n` : ""}${promptText(db, request, company)}`;
  const sent = await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboardFor(db, request) });
  await updateDb((next) => {
    const row = next.registrations.find((r) => r.id === requestId);
    if (row) row.lastPromptId = sent.message_id;
  });
}

async function activeDraft(companyId: string, telegramId: string) {
  const db = await readDb();
  return db.registrations.find((r) => r.companyId === companyId && r.telegramId === telegramId && r.status === "DRAFT");
}

async function setAnswer(requestId: string, step: RegistrationStep, patch: Partial<RegistrationData>) {
  return updateDb((db) => {
    const row = db.registrations.find((r) => r.id === requestId && r.status === "DRAFT");
    if (!row) return undefined;
    Object.assign(row.data, patch);
    // Smena o‘zgarsa oldingi ish vaqti yaroqsiz bo‘lishi mumkin.
    if (step === "shift") row.data.workHours = undefined;
    row.step = nextStep(row, step);
    if (row.step === "summary") row.editing = false;
    row.updatedAt = new Date().toISOString();
    return { ...row };
  });
}

export function attachHandlers(bot: Bot, companyId: string) {
  bot.command("id", async (ctx) => {
    if (!ctx.from) return;
    await ctx.reply(`🆔 Sizning Telegram ID raqamingiz: <code>${ctx.from.id}</code>\n\nHR bo‘lsangiz, shu raqamni Staffora panelida (Sozlamalar → Ro‘yxat boti) kiriting.`, {
      parse_mode: "HTML",
    });
  });

  bot.command("cancel", async (ctx) => {
    if (!ctx.from) return;
    const draft = await activeDraft(companyId, String(ctx.from.id));
    if (!draft) return void (await ctx.reply("Faol anketa yo‘q. Boshlash uchun /start bosing."));
    await updateDb((db) => {
      const row = db.registrations.find((r) => r.id === draft.id);
      if (row) {
        row.status = "CANCELLED";
        row.updatedAt = new Date().toISOString();
      }
    });
    await ctx.reply("Anketa bekor qilindi. Qaytadan boshlash uchun /start bosing.");
  });

  bot.command("start", async (ctx) => {
    if (!ctx.from) return;
    const telegramId = String(ctx.from.id);
    const db = await readDb();
    const company = db.companies.find((c) => c.id === companyId);
    if (!company) return;
    const employee = db.employees.find(
      (e) =>
        e.companyId === companyId &&
        e.status === "ACTIVE" &&
        e.telegramId === telegramId &&
        (e.telegramConnected || e.telegramIdSource === "INTEGRATION" || e.telegramChannel === "COMPANY_BOT"),
    );
    if (employee) {
      if (!employee.telegramConnected || employee.telegramChannel !== "COMPANY_BOT")
        await updateDb((next) => {
          const row = next.employees.find((e) => e.id === employee.id);
          if (row) {
            row.telegramConnected = true;
            row.telegramChannel = "COMPANY_BOT";
            row.deviceStatus = "CONNECTED";
            row.telegramUsername = ctx.from?.username || row.telegramUsername;
            row.updatedAt = new Date().toISOString();
            next.auditLogs.unshift(audit(companyId, `${row.firstName} ${row.lastName}`, "Kompaniya botiga ulandi", "employee", row.id));
          }
        });
      await ctx.reply(
        `Assalomu alaykum, <b>${escape(employee.firstName)}</b>! 👋\n\n🏢 ${escape(company.name)}\n\nKeldi-ketdi, ish grafigi va ta’til — hammasi Staffora ilovasida. Pastdagi tugmani bosing.`,
        { parse_mode: "HTML", reply_markup: webAppKeyboard("📲 Staffora'ni ochish") },
      );
      return;
    }
    const pending = db.registrations.find((r) => r.companyId === companyId && r.telegramId === telegramId && r.status === "PENDING");
    if (pending) {
      await ctx.reply("⏳ Anketangiz HR bo‘limida ko‘rib chiqilmoqda. Qaror chiqishi bilan shu yerga xabar keladi.");
      return;
    }
    if (!company.bot?.registrationEnabled) {
      await ctx.reply("Assalomu alaykum! Hozircha bot orqali ro‘yxatdan o‘tish yopiq. Iltimos, HR bo‘limi bilan bog‘laning.");
      return;
    }
    let draft = db.registrations.find((r) => r.companyId === companyId && r.telegramId === telegramId && r.status === "DRAFT");
    if (!draft) {
      const now = new Date().toISOString();
      draft = await updateDb((next) => {
        const row: RegistrationRequest = {
          id: randomUUID(),
          companyId,
          telegramId,
          telegramUsername: ctx.from?.username,
          telegramName: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" "),
          status: "DRAFT",
          step: "fullName",
          data: {},
          createdAt: now,
          updatedAt: now,
        };
        next.registrations.unshift(row);
        return row;
      });
      await ctx.reply(
        `🏢 <b>${escape(company.name)}</b> — xodim ro‘yxati\n\nAssalomu alaykum! Quyidagi ${QUESTION_ORDER.length} ta savolga javob bering — anketangiz HR bo‘limiga boradi. Tasdiqlangach, shu yerning o‘zida profilingiz ochiladi.\n\n⏱ Taxminan 2 daqiqa.`,
        { parse_mode: "HTML" },
      );
    } else {
      await ctx.reply("↩️ Anketani to‘xtagan joyingizdan davom ettiramiz.");
    }
    await ask(ctx, companyId, draft.id);
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const from = ctx.from;
    if (data.startsWith("hr:")) return handleHrDecision(ctx, companyId, data);
    if (!data.startsWith("rg:")) return void (await ctx.answerCallbackQuery());
    const draft = await activeDraft(companyId, String(from.id));
    if (!draft) {
      await ctx.answerCallbackQuery({ text: "Anketa topilmadi. /start bosing." });
      return;
    }
    const [, action, ...restParts] = data.split(":");
    const arg = restParts.join(":");
    const db = await readDb();
    const tenant = companyId;
    let updated: RegistrationRequest | undefined;
    let note: string | undefined;
    switch (action) {
      case "cancel":
        await updateDb((next) => {
          const row = next.registrations.find((r) => r.id === draft.id);
          if (row) {
            row.status = "CANCELLED";
            row.updatedAt = new Date().toISOString();
          }
        });
        await ctx.answerCallbackQuery({ text: "Bekor qilindi" });
        await ctx.editMessageReplyMarkup().catch(() => undefined);
        await ctx.reply("Anketa bekor qilindi. Qaytadan boshlash uchun /start bosing.");
        return;
      case "back": {
        const back = previousStep(draft.step);
        if (!back) return void (await ctx.answerCallbackQuery());
        updated = await updateDb((next) => {
          const row = next.registrations.find((r) => r.id === draft.id);
          if (row) row.step = back;
          return row ? { ...row } : undefined;
        });
        break;
      }
      case "summary":
      case "edit":
        updated = await updateDb((next) => {
          const row = next.registrations.find((r) => r.id === draft.id);
          if (!row) return undefined;
          if (action === "summary" && !isComplete(row.data)) return { ...row };
          row.step = action === "edit" ? "editPick" : "summary";
          row.editing = false;
          return { ...row };
        });
        break;
      case "ef": {
        const field = arg as keyof RegistrationData;
        if (!(field in FIELD_LABELS)) return void (await ctx.answerCallbackQuery());
        updated = await updateDb((next) => {
          const row = next.registrations.find((r) => r.id === draft.id);
          if (!row) return undefined;
          row.step = field as RegistrationStep;
          row.editing = true;
          return { ...row };
        });
        break;
      }
      case "pos":
        if (draft.step !== "positionId" || !db.positions.some((p) => p.id === arg && p.companyId === tenant)) return void (await ctx.answerCallbackQuery());
        updated = await setAnswer(draft.id, "positionId", { positionId: arg });
        break;
      case "br":
        if (draft.step !== "branchId" || !db.branches.some((b) => b.id === arg && b.companyId === tenant)) return void (await ctx.answerCallbackQuery());
        updated = await setAnswer(draft.id, "branchId", { branchId: arg });
        break;
      case "sh":
        if (draft.step !== "shift" || !(arg in SHIFTS)) return void (await ctx.answerCallbackQuery());
        updated = await setAnswer(draft.id, "shift", { shift: arg as keyof typeof SHIFTS });
        break;
      case "wh": {
        if (draft.step !== "workHours") return void (await ctx.answerCallbackQuery());
        if (arg === "other") {
          await ctx.answerCallbackQuery();
          await ctx.reply("✍️ Ish vaqtingizni yozing. Misol: <b>09:00 - 18:00</b>", { parse_mode: "HTML" });
          return;
        }
        const preset = SHIFTS[draft.data.shift || "DAY"].hours[Number(arg)];
        if (!preset) return void (await ctx.answerCallbackQuery());
        updated = await setAnswer(draft.id, "workHours", { workHours: preset });
        break;
      }
      case "sc":
        if (draft.step !== "salaryConfirm") return void (await ctx.answerCallbackQuery());
        if (arg === "edit")
          updated = await updateDb((next) => {
            const row = next.registrations.find((r) => r.id === draft.id);
            if (row) row.step = "salary";
            return row ? { ...row } : undefined;
          });
        else updated = await setAnswer(draft.id, "salaryConfirm", {});
        break;
      case "rd": {
        const day = Number(arg);
        if (draft.step !== "restDay" || !(day === -1 || (day >= 0 && day <= 6))) return void (await ctx.answerCallbackQuery());
        updated = await setAnswer(draft.id, "restDay", { restDay: day });
        break;
      }
      case "ed": {
        const option = EDUCATION_OPTIONS[Number(arg)];
        if (draft.step !== "education" || !option) return void (await ctx.answerCallbackQuery());
        updated = await setAnswer(draft.id, "education", { education: option });
        break;
      }
      case "submit":
        await ctx.answerCallbackQuery({ text: "Yuborilmoqda…" });
        await submit(ctx, companyId, draft.id);
        return;
      default:
        return void (await ctx.answerCallbackQuery());
    }
    await ctx.answerCallbackQuery();
    if (updated) await ask(ctx, companyId, updated.id, note);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    const draft = await activeDraft(companyId, String(ctx.from.id));
    if (!draft) {
      await ctx.reply("Boshlash uchun /start bosing.", { reply_markup: webAppKeyboard("📲 Staffora'ni ochish") });
      return;
    }
    const text = ctx.message.text;
    const step = draft.step;
    const handlers: Partial<Record<RegistrationStep, () => { ok: true; patch: Partial<RegistrationData> } | { ok: false; error: string }>> = {
      fullName: () => wrap(checkFullName(text), (v) => ({ fullName: v })),
      birthDate: () => wrap(checkBirthDate(text), (v) => ({ birthDate: v })),
      phone: () => wrap(checkPhone(text), (v) => ({ phone: v })),
      parentPhone: () => wrap(checkPhone(text), (v) => ({ parentPhone: v })),
      address: () => wrap(checkAddress(text), (v) => ({ address: v })),
      workHours: () => wrap(checkWorkHours(text), (v) => ({ workHours: v })),
      salary: () => wrap(checkSalary(text), (v) => ({ salary: v })),
    };
    const handler = handlers[step];
    if (!handler) {
      await ctx.reply("👇 Iltimos, yuqoridagi tugmalardan birini tanlang.");
      return;
    }
    const result = handler();
    if (!result.ok) {
      await ctx.reply(`⚠️ ${result.error}`);
      return;
    }
    const updated = await setAnswer(draft.id, step, result.patch);
    if (updated) await ask(ctx, companyId, updated.id);
  });

  bot.on("message", async (ctx) => {
    const draft = ctx.from ? await activeDraft(companyId, String(ctx.from.id)) : undefined;
    await ctx.reply(draft ? "✍️ Iltimos, javobni matn ko‘rinishida yozing yoki tugmani tanlang." : "Boshlash uchun /start bosing.");
  });
}

function wrap<T>(check: { ok: true; value: T } | { ok: false; error: string }, patch: (value: T) => Partial<RegistrationData>) {
  return check.ok ? ({ ok: true, patch: patch(check.value) } as const) : ({ ok: false, error: check.error } as const);
}

/** Anketani HR ga yuboradi. */
async function submit(ctx: Context, companyId: string, requestId: string) {
  const submitted = await updateDb((db) => {
    const row = db.registrations.find((r) => r.id === requestId && r.status === "DRAFT");
    if (!row || !isComplete(row.data)) return undefined;
    row.status = "PENDING";
    row.submittedAt = row.updatedAt = new Date().toISOString();
    const name = row.data.fullName || row.telegramName || "Nomsiz";
    db.notifications.unshift({
      id: randomUUID(),
      companyId,
      title: "Yangi xodim anketasi",
      body: `${name} botda ro‘yxatdan o‘tdi — tasdiqlashingizni kutmoqda.`,
      type: "REGISTRATION",
      read: false,
      createdAt: row.submittedAt,
    });
    db.auditLogs.unshift(audit(companyId, name, "Botda xodim anketasi yuborildi", "registration", row.id));
    return { ...row };
  });
  if (!submitted) {
    await ctx.reply("Anketada to‘ldirilmagan savol bor. /start bosing va davom eting.");
    return;
  }
  if (ctx.chat && submitted.lastPromptId) await ctx.api.editMessageReplyMarkup(ctx.chat.id, submitted.lastPromptId).catch(() => undefined);
  await ctx.reply("✅ <b>Anketangiz HR bo‘limiga yuborildi.</b>\n\nTasdiqlanishi bilan shu yerga xabar keladi va profilingiz ochiladi.", { parse_mode: "HTML" });
  await notifyApprovers(companyId, requestId);
}

/** Arizani HR larga (Telegram) tugmalar bilan yuboradi. */
async function notifyApprovers(companyId: string, requestId: string) {
  const current = running.get(companyId);
  const db = await readDb();
  const company = db.companies.find((c) => c.id === companyId);
  const request = db.registrations.find((r) => r.id === requestId);
  if (!current || !company || !request) return;
  const who = request.telegramUsername ? `@${request.telegramUsername}` : `<a href="tg://user?id=${request.telegramId}">${escape(request.telegramName || "profil")}</a>`;
  const text = `🆕 <b>Yangi xodim anketasi</b>\nTelegram: ${who}\n\n${summaryText(request, company.name, lookups(db, companyId, request.data))}`;
  const keyboard = new InlineKeyboard().text("✅ Tasdiqlash", `hr:a:${request.id}`).text("❌ Rad etish", `hr:r:${request.id}`);
  const messages: { chatId: string; messageId: number }[] = [];
  for (const chatId of company.bot?.approverTelegramIds || []) {
    try {
      const sent = await current.bot.api.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
      messages.push({ chatId, messageId: sent.message_id });
    } catch (error) {
      console.warn(`HR ga anketa yuborilmadi (${chatId}):`, (error as Error).message);
    }
  }
  if (messages.length)
    await updateDb((next) => {
      const row = next.registrations.find((r) => r.id === requestId);
      if (row) row.hrMessages = messages;
    });
}

async function handleHrDecision(ctx: Context, companyId: string, data: string) {
  const [, decision, requestId] = data.split(":");
  const db = await readDb();
  const company = db.companies.find((c) => c.id === companyId);
  const approverId = String(ctx.from?.id || "");
  if (!company?.bot?.approverTelegramIds.includes(approverId)) {
    await ctx.answerCallbackQuery({ text: "Sizda arizani tasdiqlash huquqi yo‘q.", show_alert: true });
    return;
  }
  const actor = `${ctx.from?.first_name || "HR"} (Telegram)`;
  try {
    await decideRegistration(companyId, requestId, decision === "a" ? "APPROVE" : "REJECT", actor);
    await ctx.answerCallbackQuery({ text: decision === "a" ? "Tasdiqlandi ✅" : "Rad etildi" });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: (error as Error).message.slice(0, 180), show_alert: true });
  }
}

/**
 * Arizani tasdiqlash / rad etish — bot tugmasidan ham, paneldan ham shu funksiya.
 * Natija arizachiga va barcha HR xabarlariga yetkaziladi.
 */
export async function decideRegistration(
  companyId: string,
  requestId: string,
  decision: "APPROVE" | "REJECT",
  actor: string,
  options: { reason?: string; positionId?: string; branchId?: string } = {},
) {
  const result = await updateDb((db) => {
    const request = db.registrations.find((r) => r.id === requestId && r.companyId === companyId);
    if (!request) throw Object.assign(new Error("Ariza topilmadi."), { status: 404 });
    if (decision === "APPROVE") {
      if (options.positionId) request.data.positionId = options.positionId;
      if (options.branchId) request.data.branchId = options.branchId;
      const employee = approveRegistration(db, request, actor);
      return { request: { ...request }, employee: { ...employee } as Employee | undefined };
    }
    rejectRegistration(db, request, actor, options.reason);
    return { request: { ...request }, employee: undefined as Employee | undefined };
  });
  const current = running.get(companyId);
  if (!current) return result;
  const db = await readDb();
  const company = db.companies.find((c) => c.id === companyId);
  const { request, employee } = result;
  const api: Api = current.bot.api;
  try {
    if (employee)
      await api.sendMessage(
        request.telegramId,
        `🎉 <b>Tabriklaymiz, ${escape(employee.firstName)}!</b>\n\nAnketangiz tasdiqlandi — endi siz <b>${escape(company?.name || "")}</b> xodimisiz.\n\nPastdagi tugmani bosing: keldi-ketdi, ish grafigi va ta’til — hammasi shu yerda. Birinchi kirishda Face ID sozlanadi.`,
        { parse_mode: "HTML", reply_markup: webAppKeyboard() },
      );
    else
      await api.sendMessage(
        request.telegramId,
        `❌ Afsuski, anketangiz rad etildi.${request.rejectReason ? `\n\nSabab: ${escape(request.rejectReason)}` : ""}\n\nSavollar bo‘lsa HR bo‘limi bilan bog‘laning. Qayta to‘ldirish uchun /start bosing.`,
        { parse_mode: "HTML" },
      );
  } catch (error) {
    console.warn("Arizachiga javob yuborilmadi:", (error as Error).message);
  }
  const stamp = employee ? `\n\n✅ <b>Tasdiqlandi</b> — ${escape(actor)}` : `\n\n❌ <b>Rad etildi</b> — ${escape(actor)}`;
  for (const message of request.hrMessages || []) {
    const text = `🗂 <b>Xodim anketasi</b>\n\n${summaryText(request, company?.name || "", lookups(db, companyId, request.data))}${stamp}`;
    await api.editMessageText(message.chatId, message.messageId, text, { parse_mode: "HTML" }).catch(() => undefined);
  }
  return result;
}

/* -------------------------------------------------------- panel API --- */

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(handler(req as AuthedRequest, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const permit = (permission: string) => (req: Request, res: Response, next: NextFunction) =>
  can((req as AuthedRequest).session!.role, permission) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
const tenantOf = (req: AuthedRequest) => {
  if (!req.session?.companyId) throw httpError("Kompaniya tanlanmagan.", 403);
  return req.session.companyId;
};

function publicBot(company: Company) {
  const bot = company.bot || defaultBotSettings();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tokenEnc, ...rest } = bot;
  return {
    ...rest,
    hasToken: Boolean(tokenEnc),
    running: running.has(company.id),
    link: bot.username ? `https://t.me/${bot.username}` : undefined,
    registerLink: bot.username ? `https://t.me/${bot.username}?start=anketa` : undefined,
    webAppUrl: resolveWebAppUrl().webAppUrl,
  };
}

export function createCompanyBotRouter() {
  const router = Router();

  router.get(
    "/company/bot",
    permit("settings.manage"),
    route(async (req, res) => {
      const db = await readDb();
      const company = db.companies.find((c) => c.id === tenantOf(req));
      if (!company) throw httpError("Kompaniya topilmadi.", 404);
      res.json(publicBot(company));
    }),
  );

  router.put(
    "/company/bot",
    permit("settings.manage"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const input = z
        .object({
          token: z.string().trim().regex(/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/, "Bot tokeni noto‘g‘ri ko‘rinishda (BotFather bergan 123456:ABC… token).").optional(),
          enabled: z.boolean().optional(),
          registrationEnabled: z.boolean().optional(),
          approverTelegramIds: z.array(z.string().trim().regex(/^\d{4,15}$/, "Telegram ID faqat raqamlardan iborat.")).max(20).optional(),
        })
        .parse(req.body);
      let username: string | undefined;
      let botId: number | undefined;
      if (input.token) {
        if (input.token === process.env.TELEGRAM_BOT_TOKEN?.trim())
          throw httpError("Bu Staffora'ning umumiy boti. Kompaniyangiz uchun @BotFather'da alohida bot yarating.", 400);
        try {
          const me = await new Api(input.token).getMe();
          username = me.username;
          botId = me.id;
        } catch {
          throw httpError("Token ishlamadi: Telegram botni topmadi. @BotFather'dan tokenni qayta nusxalang.", 400);
        }
        const db = await readDb();
        const clash = db.companies.find((c) => c.id !== tenant && c.bot?.botId === botId);
        if (clash) throw httpError("Bu bot boshqa kompaniyaga ulangan.", 409);
      }
      const company = await updateDb((db) => {
        const row = db.companies.find((c) => c.id === tenant);
        if (!row) throw httpError("Kompaniya topilmadi.", 404);
        const bot = (row.bot ||= defaultBotSettings());
        if (input.token) {
          bot.tokenEnc = encryptSecret(input.token);
          bot.tokenHint = `${input.token.split(":")[0]}:••••`;
          bot.username = username;
          bot.botId = botId;
          bot.enabled = input.enabled ?? true;
        }
        if (input.enabled !== undefined) bot.enabled = input.enabled && Boolean(bot.tokenEnc);
        if (input.registrationEnabled !== undefined) bot.registrationEnabled = input.registrationEnabled;
        if (input.approverTelegramIds) bot.approverTelegramIds = [...new Set(input.approverTelegramIds)];
        bot.updatedAt = new Date().toISOString();
        db.auditLogs.unshift(
          audit(tenant, req.session!.name, input.token ? "Kompaniya boti ulandi / tokeni yangilandi" : "Kompaniya boti sozlamalari o‘zgartirildi", "company", tenant, undefined, {
            username: bot.username,
            enabled: bot.enabled,
            registrationEnabled: bot.registrationEnabled,
            approvers: bot.approverTelegramIds.length,
          }),
        );
        return { ...row, bot: { ...bot } };
      });
      if (company.bot.enabled && company.bot.tokenEnc) await startCompanyBot(tenant);
      else await stopCompanyBot(tenant, { deleteWebhook: true });
      const db = await readDb();
      res.json(publicBot(db.companies.find((c) => c.id === tenant)!));
    }),
  );

  router.delete(
    "/company/bot",
    permit("settings.manage"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      await stopCompanyBot(tenant, { deleteWebhook: true });
      await updateDb((db) => {
        const row = db.companies.find((c) => c.id === tenant);
        if (row?.bot) row.bot = { ...defaultBotSettings(), approverTelegramIds: row.bot.approverTelegramIds, registrationEnabled: row.bot.registrationEnabled };
        db.auditLogs.unshift(audit(tenant, req.session!.name, "Kompaniya boti uzildi", "company", tenant));
      });
      res.json({ ok: true });
    }),
  );

  router.post(
    "/company/bot/test",
    permit("settings.manage"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const { telegramId } = z.object({ telegramId: z.string().regex(/^\d{4,15}$/) }).parse(req.body);
      const current = running.get(tenant);
      if (!current) throw httpError("Bot ishlamayapti — avval tokenni saqlang.", 409);
      try {
        await current.bot.api.sendMessage(telegramId, "✅ Staffora: sinov xabari. Anketalar shu chatga keladi.");
      } catch {
        throw httpError("Xabar yetmadi: bu odam botga /start bosmagan yoki ID noto‘g‘ri.", 400);
      }
      res.json({ ok: true });
    }),
  );

  /* ---------------------------------------------------- arizalar --- */
  router.get(
    "/registrations",
    permit("registrations.view"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const status = typeof req.query.status === "string" ? req.query.status : "PENDING";
      const db = await readDb();
      const rows = db.registrations
        .filter((r) => r.companyId === tenant && (status === "ALL" ? r.status !== "DRAFT" : r.status === status))
        .slice(0, 300)
        .map((r) => ({
          ...r,
          lastPromptId: undefined,
          hrMessages: undefined,
          positionName: db.positions.find((p) => p.id === r.data.positionId)?.name,
          branchName: db.branches.find((b) => b.id === r.data.branchId)?.name,
        }));
      const counts = {
        PENDING: db.registrations.filter((r) => r.companyId === tenant && r.status === "PENDING").length,
        DRAFT: db.registrations.filter((r) => r.companyId === tenant && r.status === "DRAFT").length,
      };
      res.json({ items: rows, counts });
    }),
  );

  router.post(
    "/registrations/:id/approve",
    permit("registrations.approve"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const input = z.object({ positionId: z.string().optional(), branchId: z.string().optional() }).parse(req.body || {});
      const db = await readDb();
      if (input.positionId && !db.positions.some((p) => p.id === input.positionId && p.companyId === tenant)) throw httpError("Lavozim topilmadi.", 422);
      if (input.branchId && !db.branches.some((b) => b.id === input.branchId && b.companyId === tenant)) throw httpError("Filial topilmadi.", 422);
      const result = await decideRegistration(tenant, String(req.params.id), "APPROVE", req.session!.name, input);
      res.json({ ok: true, employeeId: result.employee?.id });
    }),
  );

  router.post(
    "/registrations/:id/reject",
    permit("registrations.approve"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const input = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body || {});
      await decideRegistration(tenant, String(req.params.id), "REJECT", req.session!.name, input);
      res.json({ ok: true });
    }),
  );

  return router;
}

/** Testlar uchun: botni tarmoqsiz "ishlab turgan" deb ro‘yxatga olish. */
export function registerRunningBotForTests(companyId: string, bot: Bot, token = "test:token") {
  running.set(companyId, { bot, token, mode: "polling" });
  registerCompanyBotApi(companyId, bot.api);
}
