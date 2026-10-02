import { createHash, randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { Api, Bot, GrammyError, InlineKeyboard, InputFile, webhookCallback, type Context } from "grammy";
import { z } from "zod";
import { audit, documentFiles, readDb, updateDb } from "../lib/store";
import { can } from "../lib/permissions";
import type { Company, CompanyBotSettings, Database, Employee, RegistrationForm, RegistrationQuestion, RegistrationRequest } from "../lib/types";
import type { AuthedRequest } from "./auth";
import { registerCompanyBotApi } from "./bot-registry";
import { decryptSecret, encryptSecret } from "./integrations/secrets";
import {
  BUILTINS,
  CUSTOM_TYPES,
  DEFAULT_TEXTS,
  activeQuestions,
  approveRegistration,
  buttonsFor,
  companyForm,
  describe,
  escape,
  findQuestion,
  firstStep,
  firstUnanswered,
  isComplete,
  lookupsFor,
  nextStep,
  normalizeForm,
  parseButton,
  previousStep,
  questionText,
  rejectRegistration,
  setValue,
  shortLabel,
  summaryText,
  validateText,
} from "./registration";
import { resolveWebAppUrl } from "./telegram";
import { referenceFromPhoto } from "./face-reference";

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
    // START bosishdan oldingi oynada kompaniya nomi ko‘rinadi (bot nomi o‘zgartirilmaydi).
    await bot.api
      .setMyDescription(`🏢 ${company.name}

Xodimlar uchun rasmiy bot: ro‘yxatdan o‘tish, keldi-ketdi va ish grafigi. Boshlash uchun «Start» ni bosing.`)
      .catch(() => undefined);
    await bot.api.setMyShortDescription(`${company.name} — xodimlar boti`.slice(0, 120)).catch(() => undefined);
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

/** Admin yozgan matn: hammasi xavfsiz, faqat <b>, <i>, <u> teglari qoladi. */
function safeHtml(text: string) {
  return escape(text).replace(/&lt;(\/?)(b|i|u)&gt;/g, "<$1$2>");
}

function webAppKeyboard(label = "📲 Profilimni ochish") {
  const { webAppUrl, ok } = resolveWebAppUrl();
  return ok ? new InlineKeyboard().webApp(label, webAppUrl) : undefined;
}

function keyboardFor(db: Database, request: RegistrationRequest, form: RegistrationForm): InlineKeyboard {
  const kb = new InlineKeyboard();
  const nav = (question?: RegistrationQuestion) => {
    kb.row();
    if (question && !question.required) kb.text("⏭ O‘tkazib yuborish", "rg:skip");
    if (request.editing) {
      kb.row().text("⬅️ Xulosaga qaytish", "rg:summary");
      return kb;
    }
    const back = previousStep(form, request.step);
    kb.row();
    if (back) kb.text("⬅️ Orqaga", "rg:back");
    kb.text("✖️ Bekor qilish", "rg:cancel");
    return kb;
  };
  if (request.step === "summary") {
    kb.row().text("✅ Tasdiqlash va yuborish", "rg:submit").row().text("✏️ Tahrirlash", "rg:edit").text("✖️ Bekor qilish", "rg:cancel");
    return kb;
  }
  if (request.step === "editPick") {
    activeQuestions(form).forEach((q, i) => {
      if (i % 2 === 0) kb.row();
      kb.text(shortLabel(q).slice(0, 30), `rg:ef:${q.id}`);
    });
    kb.row().text("⬅️ Xulosaga qaytish", "rg:summary");
    return kb;
  }
  const question = findQuestion(form, request.step);
  if (!question) return kb;
  if (request.confirming) {
    kb.row().text("✅ Ha, to‘g‘ri", "rg:ok").text("✏️ Qayta yozish", "rg:redo");
    return kb;
  }
  for (const row of buttonsFor(question, db, request.companyId, request.data) || []) {
    kb.row();
    for (const button of row) kb.text(button.label, `rg:a:${question.id}:${button.value}`);
  }
  return nav(question);
}

function promptText(db: Database, request: RegistrationRequest, company: Company, form: RegistrationForm) {
  const lookups = lookupsFor(db, company.id);
  if (request.step === "summary")
    return summaryText(form, request, company.name, lookups, "Ma’lumotlar to‘g‘rimi? Tasdiqlasangiz, anketa HR bo‘limiga yuboriladi.");
  if (request.step === "editPick") return summaryText(form, request, company.name, lookups, "✏️ <b>Qaysi javobni o‘zgartirasiz?</b>");
  const question = findQuestion(form, request.step);
  if (!question) return summaryText(form, request, company.name, lookups);
  return questionText(form, question, company.name, request.data, request.confirming);
}

/** Joriy savolni yuboradi; oldingi savol tugmalarini olib tashlaydi. */
async function ask(ctx: Context, companyId: string, requestId: string) {
  const db = await readDb();
  const company = db.companies.find((c) => c.id === companyId);
  const request = db.registrations.find((r) => r.id === requestId);
  if (!company || !request || !ctx.chat) return;
  const form = companyForm(company);
  if (request.lastPromptId) await ctx.api.editMessageReplyMarkup(ctx.chat.id, request.lastPromptId).catch(() => undefined);
  const sent = await ctx.reply(promptText(db, request, company, form), { parse_mode: "HTML", reply_markup: keyboardFor(db, request, form) });
  await updateDb((next) => {
    const row = next.registrations.find((r) => r.id === requestId);
    if (row) row.lastPromptId = sent.message_id;
  });
}

async function activeDraft(companyId: string, telegramId: string) {
  const db = await readDb();
  return db.registrations.find((r) => r.companyId === companyId && r.telegramId === telegramId && r.status === "DRAFT");
}

/** Javobni saqlab keyingi qadamga o‘tadi. `confirm` — summani tasdiqlatish. */
async function answer(requestId: string, questionId: string, value: string | number | undefined, options: { confirm?: boolean; scheduleId?: string | null } = {}) {
  return updateDb((db) => {
    const row = db.registrations.find((r) => r.id === requestId && r.status === "DRAFT");
    if (!row) return undefined;
    const form = companyForm(db.companies.find((c) => c.id === row.companyId));
    const question = findQuestion(form, questionId);
    if (!question || row.step !== questionId) return { ...row };
    setValue(question, row.data, value);
    if (question.type === "workHours") row.data.scheduleId = options.scheduleId || undefined;
    // Smena o‘zgarsa oldingi ish vaqti yaroqsiz bo‘lishi mumkin.
    if (question.type === "shift") {
      const hours = activeQuestions(form).find((q) => q.type === "workHours");
      if (hours) setValue(hours, row.data, undefined);
    }
    if (options.confirm) row.confirming = true;
    else {
      row.confirming = false;
      row.step = nextStep(form, row, questionId);
      if (row.step === "summary") row.editing = false;
    }
    row.updatedAt = new Date().toISOString();
    return { ...row };
  });
}

async function moveTo(requestId: string, change: (row: RegistrationRequest, form: RegistrationForm) => void) {
  return updateDb((db) => {
    const row = db.registrations.find((r) => r.id === requestId && r.status === "DRAFT");
    if (!row) return undefined;
    change(row, companyForm(db.companies.find((c) => c.id === row.companyId)));
    row.updatedAt = new Date().toISOString();
    return { ...row };
  });
}

async function cancelDraft(requestId: string) {
  await updateDb((db) => {
    const row = db.registrations.find((r) => r.id === requestId);
    if (row) {
      row.status = "CANCELLED";
      row.updatedAt = new Date().toISOString();
    }
  });
}

/** Anketaga yuboriladigan hujjat rasmi chegarasi (hujjatlar bilan bir xil). */
const MAX_DOC_BYTES = 1_400_000;

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
    await cancelDraft(draft.id);
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
        `Assalomu alaykum, <b>${escape(employee.firstName)}</b>! 👋\n\n🏢 <b>${escape(company.name)}</b>\n\nKeldi-ketdi, ish grafigi va ta’til — hammasi Staffora ilovasida. Pastdagi tugmani bosing.`,
        { parse_mode: "HTML", reply_markup: webAppKeyboard("📲 Staffora'ni ochish") },
      );
      return;
    }
    const pending = db.registrations.find((r) => r.companyId === companyId && r.telegramId === telegramId && r.status === "PENDING");
    if (pending) {
      await ctx.reply(`⏳ <b>${escape(company.name)}</b>: anketangiz HR bo‘limida ko‘rib chiqilmoqda. Qaror chiqishi bilan shu yerga xabar keladi.`, {
        parse_mode: "HTML",
      });
      return;
    }
    if (!company.bot?.registrationEnabled) {
      await ctx.reply(`Assalomu alaykum! <b>${escape(company.name)}</b> boti.\n\nHozircha bot orqali ro‘yxatdan o‘tish yopiq. Iltimos, HR bo‘limi bilan bog‘laning.`, {
        parse_mode: "HTML",
      });
      return;
    }
    const form = companyForm(company);
    let draft = db.registrations.find((r) => r.companyId === companyId && r.telegramId === telegramId && r.status === "DRAFT");
    if (draft && !findQuestion(form, draft.step) && !["summary", "editPick"].includes(draft.step))
      draft = await moveTo(draft.id, (row, f) => (row.step = firstUnanswered(f, row.data)));
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
          step: firstStep(form),
          data: {},
          createdAt: now,
          updatedAt: now,
        };
        next.registrations.unshift(row);
        return row;
      });
      const count = activeQuestions(form).length;
      await ctx.reply(
        `${safeHtml(fillTemplateRaw(form.intro || DEFAULT_TEXTS.intro, { company: company.name }))}\n\n📝 ${count} ta savol · ⏱ taxminan ${Math.max(1, Math.round(count / 5))} daqiqa`,
        { parse_mode: "HTML" },
      );
    } else {
      await ctx.reply("↩️ Anketani to‘xtagan joyingizdan davom ettiramiz.");
    }
    await ask(ctx, companyId, draft!.id);
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (data.startsWith("hr:")) return handleHrDecision(ctx, companyId, data);
    if (!data.startsWith("rg:")) return void (await ctx.answerCallbackQuery());
    const draft = await activeDraft(companyId, String(ctx.from.id));
    if (!draft) {
      await ctx.answerCallbackQuery({ text: "Anketa topilmadi. /start bosing." });
      return;
    }
    const [, action, ...parts] = data.split(":");
    let updated: RegistrationRequest | undefined;
    switch (action) {
      case "cancel":
        await cancelDraft(draft.id);
        await ctx.answerCallbackQuery({ text: "Bekor qilindi" });
        await ctx.editMessageReplyMarkup().catch(() => undefined);
        await ctx.reply("Anketa bekor qilindi. Qaytadan boshlash uchun /start bosing.");
        return;
      case "back":
        updated = await moveTo(draft.id, (row, form) => {
          const back = previousStep(form, row.step);
          if (back) row.step = back;
          row.confirming = false;
        });
        break;
      case "skip":
        updated = await moveTo(draft.id, (row, form) => {
          const question = findQuestion(form, row.step);
          if (!question || question.required) return;
          setValue(question, row.data, undefined);
          row.step = nextStep(form, row, question.id);
          if (row.step === "summary") row.editing = false;
        });
        break;
      case "summary":
        updated = await moveTo(draft.id, (row, form) => {
          row.editing = false;
          row.confirming = false;
          row.step = isComplete(form, row.data) ? "summary" : firstUnanswered(form, row.data);
        });
        break;
      case "edit":
        updated = await moveTo(draft.id, (row) => {
          row.step = "editPick";
          row.editing = false;
        });
        break;
      case "ef":
        updated = await moveTo(draft.id, (row, form) => {
          if (!findQuestion(form, parts[0])) return;
          row.step = parts[0];
          row.editing = true;
          row.confirming = false;
        });
        break;
      case "ok":
        updated = await moveTo(draft.id, (row, form) => {
          if (!row.confirming) return;
          row.confirming = false;
          row.step = nextStep(form, row, row.step);
          if (row.step === "summary") row.editing = false;
        });
        break;
      case "redo":
        updated = await moveTo(draft.id, (row, form) => {
          const question = findQuestion(form, row.step);
          if (question) setValue(question, row.data, undefined);
          row.confirming = false;
        });
        break;
      case "a": {
        const [questionId, ...valueParts] = parts;
        const value = valueParts.join(":");
        const db = await readDb();
        const form = companyForm(db.companies.find((c) => c.id === companyId));
        const question = findQuestion(form, questionId);
        if (!question || draft.step !== questionId) return void (await ctx.answerCallbackQuery({ text: "Bu savol yopilgan" }));
        if (question.type === "workHours" && value === "__other") {
          await ctx.answerCallbackQuery();
          await ctx.reply("✍️ Ish vaqtingizni yozing. Misol: <b>09:00 - 18:00</b>", { parse_mode: "HTML" });
          return;
        }
        const parsed = parseButton(question, value, db, companyId);
        if (!parsed.ok) return void (await ctx.answerCallbackQuery({ text: parsed.error }));
        updated = await answer(draft.id, questionId, parsed.value, { scheduleId: question.type === "workHours" && value.startsWith("s:") ? value.slice(2) : null });
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
    if (updated) await ask(ctx, companyId, updated.id);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    const draft = await activeDraft(companyId, String(ctx.from.id));
    if (!draft) {
      await ctx.reply("Boshlash uchun /start bosing.", { reply_markup: webAppKeyboard("📲 Staffora'ni ochish") });
      return;
    }
    const db = await readDb();
    const form = companyForm(db.companies.find((c) => c.id === companyId));
    const question = findQuestion(form, draft.step);
    if (!question || draft.confirming) {
      await ctx.reply("👇 Iltimos, yuqoridagi tugmalardan birini tanlang.");
      return;
    }
    const result = validateText(question, ctx.message.text);
    if (!result) {
      await ctx.reply("👇 Iltimos, yuqoridagi tugmalardan birini tanlang.");
      return;
    }
    if (!result.ok) {
      await ctx.reply(`⚠️ ${result.error}`);
      return;
    }
    const updated = await answer(draft.id, question.id, result.value, { confirm: question.type === "money" });
    if (updated) await ask(ctx, companyId, updated.id);
  });

  // Pasport / ID karta rasmi (anketadagi «Rasm» savoli): rasm yoki rasm/PDF fayl sifatida yuborilishi mumkin.
  bot.on(["message:photo", "message:document"], async (ctx, next) => {
    const draft = await activeDraft(companyId, String(ctx.from.id));
    if (!draft) return next();
    const db = await readDb();
    const form = companyForm(db.companies.find((c) => c.id === companyId));
    const question = findQuestion(form, draft.step);
    if (!question || question.type !== "photo") {
      await ctx.reply("👇 Hozir rasm so‘ralmayapti — yuqoridagi savolga javob bering.");
      return;
    }
    const doc = ctx.message.document;
    const photo = ctx.message.photo ? [...ctx.message.photo].sort((a, b) => (b.file_size || 0) - (a.file_size || 0)).find((p) => (p.file_size || 0) <= MAX_DOC_BYTES) : undefined;
    const mime = doc ? doc.mime_type || "" : "image/jpeg";
    const selfie = question.field === "selfie";
    if (selfie && mime !== "image/jpeg") {
      await ctx.reply("⚠️ Yuz rasmini oddiy rasm (📎 → Rasm) sifatida yuboring.");
      return;
    }
    if (doc && !/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(mime)) {
      await ctx.reply("⚠️ Faqat rasm (JPG, PNG) yoki PDF yuboring.");
      return;
    }
    const fileId = doc ? doc.file_id : photo?.file_id;
    if (!fileId || (doc?.file_size || 0) > MAX_DOC_BYTES) {
      await ctx.reply("⚠️ Fayl juda katta — 1,4 MB gacha bo‘lsin. Oddiy rasm sifatida yuboring.");
      return;
    }
    try {
      const file = await ctx.api.getFile(fileId);
      const response = await fetch(`https://api.telegram.org/file/bot${bot.token}/${file.file_path}`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_DOC_BYTES) {
        await ctx.reply("⚠️ Fayl juda katta — 1,4 MB gacha bo‘lsin.");
        return;
      }
      // Yuz rasmi: yuz topilishi va to‘g‘ri qaragan bo‘lishi shart (Face ID namunasi shundan).
      let descriptor: number[] | undefined;
      if (selfie)
        try {
          descriptor = await referenceFromPhoto(`data:image/jpeg;base64,${buffer.toString("base64")}`);
        } catch (error) {
          await ctx.reply(`⚠️ ${(error as Error).message.replace("3×4 rasm yuklang", "rasm yuboring")}`);
          return;
        }
      const id = randomUUID();
      await (await documentFiles()).putFile(id, companyId, mime, buffer, new Date().toISOString());
      const previous = selfie ? draft.data.selfie : draft.data.idDocument;
      const updated = await updateDb((next) => {
        const row = next.registrations.find((r) => r.id === draft.id && r.status === "DRAFT");
        if (row && selfie) row.data.selfieDescriptor = descriptor;
        else if (row) {
          row.data.idDocumentMime = mime;
          row.data.idDocumentSize = buffer.length;
        }
        return row ? { ...row } : undefined;
      });
      if (!updated) return;
      const saved = await answer(draft.id, question.id, id);
      // Qayta yuborilgan bo‘lsa — eski rasm o‘chiriladi.
      if (previous && previous !== id) await (await documentFiles()).deleteFile(previous).catch(() => undefined);
      await ctx.reply(selfie ? "✅ Yuz rasmi qabul qilindi." : "✅ Rasm qabul qilindi."); 
      if (saved) await ask(ctx, companyId, saved.id);
    } catch (error) {
      console.warn("Anketa rasmi yuklanmadi:", (error as Error).message);
      await ctx.reply("⚠️ Rasmni qabul qilib bo‘lmadi. Qaytadan yuboring.");
    }
  });

  bot.on("message", async (ctx) => {
    const draft = ctx.from ? await activeDraft(companyId, String(ctx.from.id)) : undefined;
    await ctx.reply(draft ? "✍️ Iltimos, javobni matn ko‘rinishida yozing yoki tugmani tanlang." : "Boshlash uchun /start bosing.");
  });
}

/** {company} kabi o‘rinbosarlar — xom matn (safeHtml keyin tozalaydi). */
function fillTemplateRaw(text: string, vars: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? vars[key] : match));
}

/** Anketani HR ga yuboradi. */
async function submit(ctx: Context, companyId: string, requestId: string) {
  const submitted = await updateDb((db) => {
    const row = db.registrations.find((r) => r.id === requestId && r.status === "DRAFT");
    const company = db.companies.find((c) => c.id === companyId);
    const form = companyForm(company);
    if (!row || !isComplete(form, row.data)) return undefined;
    row.status = "PENDING";
    row.questions = activeQuestions(form).map((q) => ({ ...q }));
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
    return { row: { ...row }, text: form.submittedText };
  });
  if (!submitted) {
    await ctx.reply("Anketada to‘ldirilmagan savol bor. /start bosing va davom eting.");
    return;
  }
  if (ctx.chat && submitted.row.lastPromptId) await ctx.api.editMessageReplyMarkup(ctx.chat.id, submitted.row.lastPromptId).catch(() => undefined);
  await ctx.reply(safeHtml(submitted.text || DEFAULT_TEXTS.submittedText), { parse_mode: "HTML" });
  await notifyApprovers(companyId, requestId);
}

/** Arizani HR larga (Telegram) tugmalar bilan yuboradi. */
async function notifyApprovers(companyId: string, requestId: string) {
  const current = running.get(companyId);
  const db = await readDb();
  const company = db.companies.find((c) => c.id === companyId);
  const request = db.registrations.find((r) => r.id === requestId);
  if (!current || !company || !request) return;
  const form = companyForm(company);
  const who = request.telegramUsername ? `@${escape(request.telegramUsername)}` : `<a href="tg://user?id=${request.telegramId}">${escape(request.telegramName || "profil")}</a>`;
  const text = `🆕 <b>Yangi xodim anketasi</b>\nTelegram: ${who}\n\n${summaryText(form, request, company.name, lookupsFor(db, companyId))}`;
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
  // Pasport / ID karta rasmi — HR’ga alohida xabar bo‘lib.
  const file = request.data.idDocument ? await (await documentFiles()).getFile(request.data.idDocument).catch(() => undefined) : undefined;
  if (file)
    for (const { chatId } of messages) {
      const caption = `🪪 ${request.data.fullName || "Xodim"} — pasport / ID karta`;
      const input = new InputFile(file.data, file.mime === "application/pdf" ? "pasport.pdf" : "pasport.jpg");
      await (file.mime.startsWith("image/") ? current.bot.api.sendPhoto(chatId, input, { caption }) : current.bot.api.sendDocument(chatId, input, { caption })).catch((error) =>
        console.warn(`HR ga pasport rasmi yuborilmadi (${chatId}):`, (error as Error).message),
      );
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
  // Yuz rasmi (bo‘lsa) — profil rasmi uchun oldindan o‘qiladi.
  const pre = (await readDb()).registrations.find((r) => r.id === requestId && r.companyId === companyId);
  const selfieFile = decision === "APPROVE" && pre?.data.selfie ? await (await documentFiles()).getFile(pre.data.selfie).catch(() => undefined) : undefined;
  const selfieDataUrl = selfieFile ? `data:${selfieFile.mime};base64,${Buffer.from(selfieFile.data).toString("base64")}` : undefined;
  const result = await updateDb((db) => {
    const request = db.registrations.find((r) => r.id === requestId && r.companyId === companyId);
    if (!request) throw Object.assign(new Error("Ariza topilmadi."), { status: 404 });
    if (decision === "APPROVE") {
      if (options.positionId) request.data.positionId = options.positionId;
      if (options.branchId) request.data.branchId = options.branchId;
      const employee = approveRegistration(db, request, actor, { selfieDataUrl });
      return { request: { ...request }, employee: { ...employee } as Employee | undefined };
    }
    rejectRegistration(db, request, actor, options.reason);
    return { request: { ...request }, employee: undefined as Employee | undefined };
  });
  const current = running.get(companyId);
  if (!current) return result;
  const db = await readDb();
  const company = db.companies.find((c) => c.id === companyId);
  const form = companyForm(company);
  const { request, employee } = result;
  const api: Api = current.bot.api;
  try {
    if (employee)
      await api.sendMessage(
        request.telegramId,
        safeHtml(fillTemplateRaw(form.approvedText || DEFAULT_TEXTS.approvedText, { name: employee.firstName, company: company?.name || "" })),
        { parse_mode: "HTML", reply_markup: webAppKeyboard() },
      );
    else
      await api.sendMessage(
        request.telegramId,
        `❌ Afsuski, <b>${escape(company?.name || "")}</b> anketangizni rad etdi.${request.rejectReason ? `\n\nSabab: ${escape(request.rejectReason)}` : ""}\n\nSavollar bo‘lsa HR bo‘limi bilan bog‘laning. Qayta to‘ldirish uchun /start bosing.`,
        { parse_mode: "HTML" },
      );
  } catch (error) {
    console.warn("Arizachiga javob yuborilmadi:", (error as Error).message);
  }
  const stamp = employee ? `\n\n✅ <b>Tasdiqlandi</b> — ${escape(actor)}` : `\n\n❌ <b>Rad etildi</b> — ${escape(actor)}`;
  for (const message of request.hrMessages || []) {
    const text = `🗂 <b>Xodim anketasi</b>\n\n${summaryText(form, request, company?.name || "", lookupsFor(db, companyId))}${stamp}`;
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

  /* ---------------------------------------------- anketa savollari --- */
  router.get(
    "/company/registration-form",
    permit("settings.manage"),
    route(async (req, res) => {
      const db = await readDb();
      const company = db.companies.find((c) => c.id === tenantOf(req));
      if (!company) throw httpError("Kompaniya topilmadi.", 404);
      res.json({
        form: companyForm(company),
        defaults: DEFAULT_TEXTS,
        builtins: Object.fromEntries(Object.entries(BUILTINS).map(([key, value]) => [key, { label: value.label, locked: value.locked, type: value.type }])),
        customTypes: CUSTOM_TYPES,
        companyName: company.name,
        positions: db.positions.filter((p) => p.companyId === company.id).map((p) => p.name),
        branches: db.branches.filter((b) => b.companyId === company.id && b.status === "ACTIVE").map((b) => b.name),
      });
    }),
  );

  router.put(
    "/company/registration-form",
    permit("settings.manage"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const question = z.object({
        id: z.string().trim().min(1).max(40),
        field: z.string().optional(),
        type: z.string(),
        title: z.string().trim().min(2, "Savol matni juda qisqa.").max(300),
        hint: z.string().trim().max(200).optional(),
        options: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
        required: z.boolean(),
        enabled: z.boolean(),
      });
      const input = z
        .object({
          questions: z.array(question).min(1).max(40),
          intro: z.string().max(1500).optional(),
          submittedText: z.string().max(1000).optional(),
          approvedText: z.string().max(1000).optional(),
        })
        .parse(req.body);
      for (const q of input.questions)
        if (q.type === "choice" && !q.field && (q.options?.length || 0) < 2) throw httpError(`«${q.title}» savoliga kamida 2 ta variant kiriting.`, 400);
      const form = normalizeForm({ ...(input as RegistrationForm), updatedAt: new Date().toISOString(), updatedBy: req.session!.name });
      await updateDb((db) => {
        const company = db.companies.find((c) => c.id === tenant);
        if (!company) throw httpError("Kompaniya topilmadi.", 404);
        const before = company.registrationForm;
        company.registrationForm = form;
        db.auditLogs.unshift(
          audit(tenant, req.session!.name, "Bot anketasi savollari o‘zgartirildi", "company", tenant, before ? { questions: before.questions.length } : undefined, {
            questions: form.questions.filter((q) => q.enabled).length,
          }),
        );
      });
      res.json({ form });
    }),
  );

  router.delete(
    "/company/registration-form",
    permit("settings.manage"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      await updateDb((db) => {
        const company = db.companies.find((c) => c.id === tenant);
        if (company) company.registrationForm = undefined;
        db.auditLogs.unshift(audit(tenant, req.session!.name, "Bot anketasi standart holatga qaytarildi", "company", tenant));
      });
      res.json({ form: normalizeForm() });
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
      const form = companyForm(db.companies.find((c) => c.id === tenant));
      const rows = db.registrations
        .filter((r) => r.companyId === tenant && (status === "ALL" ? r.status !== "DRAFT" : r.status === status))
        .slice(0, 300)
        .map((r) => {
          const lookups = lookupsFor(db, tenant);
          const questions = (r.questions?.length ? r.questions : activeQuestions(form)).filter((q) => q.enabled);
          return {
            ...r,
            lastPromptId: undefined,
            hrMessages: undefined,
            questions: undefined,
            positionName: db.positions.find((p) => p.id === r.data.positionId)?.name,
            branchName: db.branches.find((b) => b.id === r.data.branchId)?.name,
            answers: questions.map((q) => ({ id: q.id, label: shortLabel(q), value: describe(q, r.data, lookups), field: q.field })),
          };
        });
      const counts = {
        PENDING: db.registrations.filter((r) => r.companyId === tenant && r.status === "PENDING").length,
        DRAFT: db.registrations.filter((r) => r.companyId === tenant && r.status === "DRAFT").length,
      };
      res.json({ items: rows, counts });
    }),
  );

  // Anketadagi pasport / ID karta rasmi (faqat arizani ko‘ra oladiganlar uchun).
  router.get(
    "/registrations/:id/document",
    permit("registrations.view"),
    route(async (req, res) => {
      const tenant = tenantOf(req);
      const db = await readDb();
      const request = db.registrations.find((r) => r.id === req.params.id && r.companyId === tenant);
      const fileId = req.query.kind === "selfie" ? request?.data.selfie : request?.data.idDocument;
      const row = fileId ? await (await documentFiles()).getFile(fileId) : undefined;
      if (!row) return res.status(404).json({ message: "Hujjat rasmi topilmadi." });
      res.setHeader("Content-Type", row.mime);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(row.data);
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
