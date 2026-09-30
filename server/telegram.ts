import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import {
  Api,
  Bot,
  GrammyError,
  InlineKeyboard,
  Keyboard,
  webhookCallback,
} from "grammy";
import { audit, readDb, updateDb } from "../lib/store";
import { phoneKey, tashkentIsoDate, tashkentWeekday } from "../lib/format";
import type { Database, Employee } from "../lib/types";

type TelegramBotState = {
  state: "disabled" | "starting" | "running" | "error";
  mode?: "webhook" | "polling";
  username?: string;
  webAppUrl?: string;
  error?: string;
};

let botState: TelegramBotState = { state: "disabled" };
let activeBot: Bot | undefined;
let webhookHandler:
  | ((req: Request, res: Response, next: NextFunction) => unknown)
  | undefined;
let stopping = false;

export function getTelegramBotState() {
  return botState;
}

export function telegramBotUsername() {
  return (
    botState.username ||
    process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "").trim() ||
    undefined
  );
}

export interface TelegramIdentity {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Telegram Mini App initData imzosini tekshiradi.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 24 * 3600,
): TelegramIdentity & { startParam?: string } {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) throw new Error("Telegram imzosi topilmadi.");
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) throw new Error("Telegram vaqti noto‘g‘ri.");
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age < -300 || age > maxAgeSeconds)
    throw new Error("Telegram sessiyasi eskirgan. Mini App’ni qayta oching.");
  // Muhim: kalitlar oddiy (bayt) tartibda saralanadi, localeCompare emas.
  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken.trim())
    .digest();
  const calculated = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  const received = Buffer.from(receivedHash, "hex");
  const expected = Buffer.from(calculated, "hex");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    throw new Error(
      "Telegram imzosi yaroqsiz. Bot tokeni server sozlamasiga mos kelmaydi.",
    );
  const rawUser = params.get("user");
  if (!rawUser) throw new Error("Telegram foydalanuvchisi topilmadi.");
  const user = JSON.parse(rawUser) as TelegramIdentity;
  if (!user.id) throw new Error("Telegram ID noto‘g‘ri.");
  return { ...user, startParam: params.get("start_param") || undefined };
}

type LinkResult =
  | { ok: true; employee: Employee }
  | { ok: false; reason: string };

function linkEmployee(
  db: Database,
  employee: Employee,
  telegram: { id: number | string; username?: string },
  via: string,
) {
  const telegramId = String(telegram.id);
  // Bitta Telegram hisob faqat bitta xodimga ulanadi.
  for (const other of db.employees)
    if (other.id !== employee.id && other.telegramId === telegramId) {
      other.telegramId = undefined;
      other.telegramConnected = false;
      other.deviceStatus = "PENDING";
    }
  employee.telegramId = telegramId;
  employee.telegramUsername = telegram.username || employee.telegramUsername;
  employee.telegramConnected = true;
  employee.deviceStatus = "CONNECTED";
  employee.updatedAt = new Date().toISOString();
  db.auditLogs.unshift(
    audit(
      employee.companyId,
      `${employee.firstName} ${employee.lastName}`,
      `Telegram hisobi ulandi (${via})`,
      "employee",
      employee.id,
    ),
  );
}

/** Tasdiqlangan Telegram hisobni aniq xodimga ulaydi (xodimlar boti Mini App orqali). */
export async function linkEmployeeById(
  employeeId: string,
  companyId: string,
  telegram: { id: number | string; username?: string },
  via: string,
) {
  return updateDb((db) => {
    const employee = db.employees.find(
      (item) => item.id === employeeId && item.companyId === companyId && item.status === "ACTIVE",
    );
    if (!employee) return undefined;
    if (!(employee.telegramConnected && employee.telegramId === String(telegram.id)))
      linkEmployee(db, employee, telegram, via);
    return { ...employee };
  });
}

export async function linkEmployeeByInvite(
  code: string,
  telegram: { id: number | string; username?: string },
): Promise<LinkResult> {
  return updateDb((db) => {
    const invite = db.telegramInvites.find(
      (item) =>
        item.code === code &&
        !item.usedAt &&
        !item.revokedAt &&
        new Date(item.expiresAt).getTime() > Date.now(),
    );
    if (!invite)
      return {
        ok: false,
        reason:
          "Ulanish havolasi yaroqsiz yoki muddati tugagan. HR’dan yangi havola so‘rang.",
      } as const;
    const employee = db.employees.find(
      (item) =>
        item.id === invite.employeeId &&
        item.companyId === invite.companyId &&
        item.status === "ACTIVE",
    );
    if (!employee)
      return { ok: false, reason: "Xodim profili faol emas." } as const;
    linkEmployee(db, employee, telegram, "taklif havolasi");
    invite.usedAt = new Date().toISOString();
    return { ok: true, employee } as const;
  });
}

/**
 * Integratsiya orqali import qilingan xodim: Telegram ID si xodimlar botidan
 * (server tomonida, ishonchli manbadan) kelgan. Xodim Staffora botida /start
 * bosganda Telegram bergan from.id shu ID ga teng bo‘lsa — avtomatik ulanadi.
 * Frontend yuborgan ID ga emas, faqat Telegram imzolagan ID ga ishoniladi.
 */
export async function linkEmployeeByKnownTelegramId(telegram: {
  id: number | string;
  username?: string;
}): Promise<LinkResult> {
  const telegramId = String(telegram.id);
  return updateDb((db) => {
    const matches = db.employees.filter(
      (item) =>
        item.status === "ACTIVE" &&
        item.telegramId === telegramId &&
        item.telegramIdSource === "INTEGRATION",
    );
    const connected = matches.find((item) => item.telegramConnected);
    if (connected) return { ok: true, employee: connected } as const;
    if (matches.length !== 1)
      return {
        ok: false,
        reason:
          matches.length > 1
            ? "Bu Telegram hisobi bir nechta xodimga biriktirilgan. HR bilan bog‘laning."
            : "Telegram hisobingiz xodim profiliga topilmadi.",
      } as const;
    linkEmployee(db, matches[0], telegram, "xodimlar boti orqali (Telegram ID)");
    return { ok: true, employee: matches[0] } as const;
  });
}

export async function linkEmployeeByPhone(
  phone: string,
  telegram: { id: number | string; username?: string },
): Promise<LinkResult> {
  const key = phoneKey(phone);
  if (key.length < 9)
    return { ok: false, reason: "Telefon raqami noto‘g‘ri." };
  return updateDb((db) => {
    const matches = db.employees.filter(
      (item) => item.status === "ACTIVE" && phoneKey(item.phone) === key,
    );
    if (!matches.length)
      return {
        ok: false,
        reason:
          "Bu telefon raqami bilan xodim topilmadi. HR bo‘limidan profilingizdagi raqamni tekshirishni so‘rang yoki taklif havolasidan foydalaning.",
      } as const;
    if (matches.length > 1)
      return {
        ok: false,
        reason:
          "Bu raqam bir nechta xodimga biriktirilgan. HR bergan taklif havolasi orqali ulaning.",
      } as const;
    const employee = matches[0];
    if (
      employee.telegramId &&
      employee.telegramConnected &&
      employee.telegramId !== String(telegram.id)
    )
      return {
        ok: false,
        reason:
          "Bu xodim profili boshqa Telegram hisobiga ulangan. HR bilan bog‘laning.",
      } as const;
    linkEmployee(db, employee, telegram, "telefon raqami");
    return { ok: true, employee } as const;
  });
}

const clean = (value?: string) => (value || "").trim().replace(/\/+$/, "");
const isPublicHttps = (value: string) =>
  /^https:\/\/[^/]+\.[^/]+/i.test(value) &&
  !/^https:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.)/i.test(value);

/**
 * Mini App uchun ochiq HTTPS manzilni topadi. Telegram web_app tugmasi faqat
 * HTTPS bilan ishlaydi, shuning uchun localhost/http qiymatlar o‘tkazib yuboriladi
 * va keyingi nomzod (APP_URL, Railway domeni) sinab ko‘riladi.
 */
export /* Panel foydalanuvchisini (HR, rahbar) Telegram’ga ulash — 2 bosqichli kirish uchun. */
const panelLinkCodes = new Map<string, { userId: string; expires: number }>();
export function createPanelLinkCode(userId: string) {
  for (const [key, value] of panelLinkCodes)
    if (value.expires < Date.now() || value.userId === userId) panelLinkCodes.delete(key);
  const code = crypto.randomUUID().replaceAll("-", "").slice(0, 24);
  panelLinkCodes.set(code, { userId, expires: Date.now() + 10 * 60_000 });
  return code;
}
async function linkPanelUser(
  code: string,
  telegram: { id: number; username?: string },
) {
  const entry = panelLinkCodes.get(code);
  if (!entry || entry.expires < Date.now()) return null;
  panelLinkCodes.delete(code);
  return updateDb((db) => {
    const user = db.users.find((u) => u.id === entry.userId);
    if (!user) return null;
    for (const other of db.users)
      if (other.id !== user.id && other.telegramId === String(telegram.id)) {
        other.telegramId = undefined;
        other.twoFactorEnabled = false;
      }
    user.telegramId = String(telegram.id);
    user.telegramUsername = telegram.username;
    if (user.companyId)
      db.auditLogs.unshift(
        audit(user.companyId, user.name, "Panel hisobi Telegram’ga ulandi", "user", user.id),
      );
    return user;
  });
}

function resolveWebAppUrl() {
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${clean(process.env.RAILWAY_PUBLIC_DOMAIN).replace(/^https?:\/\//, "")}`
    : "";
  const bases = [clean(process.env.APP_URL), railway].filter(Boolean);
  const baseUrl = bases.find(isPublicHttps) || bases[0] || "";
  const explicit = clean(process.env.TELEGRAM_WEBAPP_URL);
  const withPath = (value: string) =>
    /^https?:\/\/[^/]+$/i.test(value) ? `${value}/mini-app` : value;
  const candidates = [
    explicit && withPath(explicit),
    ...bases.map((base) => `${base}/mini-app`),
  ].filter(Boolean) as string[];
  const webAppUrl = candidates.find(isPublicHttps) || candidates[0] || "";
  return {
    baseUrl,
    baseOk: isPublicHttps(baseUrl),
    webAppUrl,
    ok: isPublicHttps(webAppUrl),
  };
}

const statusLabel: Record<string, string> = {
  WORKING: "🟢 Ishda",
  LATE: "🟠 Kechikib keldi",
  CHECKED_OUT: "✅ Ish yakunlandi",
  PRESENT: "🟢 Vaqtida",
  ABSENT: "🔴 Kelmagan",
  ON_LEAVE: "🏖 Ta’tilda",
};

export async function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const { baseUrl, baseOk, webAppUrl } = resolveWebAppUrl();
  if (!token) {
    console.log("Telegram bot: token yo‘q, bot ishga tushirilmadi");
    botState = { state: "disabled" };
    return;
  }
  if (!webAppUrl) {
    botState = { state: "error", error: "TELEGRAM_WEBAPP_URL belgilanmagan" };
    console.warn(`Telegram bot: ${botState.error}`);
    return;
  }
  const canUseWebApp = resolveWebAppUrl().ok;
  if (!canUseWebApp)
    console.warn(
      `Telegram bot: Mini App URL (${webAppUrl}) ochiq HTTPS emas. Railway’da APP_URL=https://<domen> yoki TELEGRAM_WEBAPP_URL=https://<domen>/mini-app qiling.`,
    );

  botState = {
    state: "starting",
    webAppUrl,
    error: canUseWebApp ? undefined : "Mini App manzili HTTPS emas — tugma ko‘rinmaydi",
  };
  const bot = new Bot(token);
  activeBot = bot;
  const noAppNote = canUseWebApp
    ? ""
    : "\n\n⚠️ Mini App hozircha ochilmaydi: serverda HTTPS manzil sozlanmagan. Administratorga xabar bering.";
  const keyboard = () =>
    canUseWebApp
      ? new InlineKeyboard().webApp("📲 Staffora’ni ochish", webAppUrl)
      : undefined;
  const contactKeyboard = () =>
    new Keyboard()
      .requestContact("📱 Telefon raqamni yuborish")
      .resized()
      .oneTime();

  async function welcomeLinked(
    ctx: { reply: (text: string, other?: object) => Promise<unknown> },
    employee: Employee,
    title = "✅ Hisob muvaffaqiyatli ulandi.",
  ) {
    // Avval telefon klaviaturasini yopamiz, so‘ng tugmali xabar yuboramiz.
    await ctx.reply(title, { reply_markup: { remove_keyboard: true } });
    await ctx.reply(
      `👤 ${employee.firstName} ${employee.lastName}\n🆔 ${employee.employeeNo}\n\n` +
        (canUseWebApp
          ? "Davomatni belgilash uchun pastdagi «📲 Staffora’ni ochish» tugmasini bosing. Xuddi shu tugma chat pastidagi «Staffora» menyusida ham bor."
          : noAppNote.trim()),
      canUseWebApp ? { reply_markup: keyboard() } : undefined,
    );
  }

  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim();
    const from = ctx.from;
    if (!from) return;
    if (payload?.startsWith("adm_")) {
      const user = await linkPanelUser(payload.slice(4), from);
      await ctx.reply(
        user
          ? `✅ ${user.name}, panel hisobingiz Telegram’ga ulandi.

Endi Sozlamalar → Xavfsizlik bo‘limida 2 bosqichli kirishni yoqishingiz mumkin. Kirish kodlari shu chatga keladi.`
          : "⚠️ Ulash havolasi yaroqsiz yoki muddati tugagan. Panelda yangi havola yarating.",
      );
      return;
    }
    if (payload && payload !== "link") {
      const result = await linkEmployeeByInvite(payload, from);
      if (result.ok) return welcomeLinked(ctx, result.employee);
      // Havola eskirgan bo‘lsa ham, bot bergan Telegram ID bo‘yicha tanib olamiz.
      const known = await linkEmployeeByKnownTelegramId(from);
      if (known.ok) return welcomeLinked(ctx, known.employee);
      await ctx.reply(
        `⚠️ ${result.reason}\n\nYoki telefon raqamingizni yuborib ulaning:`,
        { reply_markup: contactKeyboard() },
      );
      return;
    }
    let db = await readDb();
    let employee = db.employees.find(
      (item) =>
        item.telegramId === String(from.id) &&
        item.telegramConnected &&
        item.status === "ACTIVE",
    );
    if (!employee) {
      const known = await linkEmployeeByKnownTelegramId(from);
      if (known.ok) return welcomeLinked(ctx, known.employee);
      db = await readDb();
      employee = undefined;
    }
    if (!employee) {
      await ctx.reply(
        "👋 Staffora’ga xush kelibsiz!\n\nTelegram hisobingiz hali xodim profiliga ulanmagan.\n\nUlash uchun pastdagi «📱 Telefon raqamni yuborish» tugmasini bosing — raqamingiz HR profilidagi raqam bilan solishtiriladi. Yoki HR bergan taklif havolasini oching.",
        { reply_markup: contactKeyboard() },
      );
      return;
    }
    const branch = db.branches.find((item) => item.id === employee.branchId);
    const schedule = db.schedules.find(
      (item) => item.id === employee.scheduleId,
    );
    const day = schedule?.days.find((item) => item.day === tashkentWeekday());
    const today = db.attendance.find(
      (item) =>
        item.employeeId === employee.id && item.date === tashkentIsoDate(),
    );
    await ctx.reply(
      `Assalomu alaykum, ${employee.firstName}! 👋\n\n🏢 ${db.companies.find((c) => c.id === employee.companyId)?.name || "—"}\n📍 Filial: ${branch?.name || "—"}\n🕘 Bugungi grafik: ${day?.enabled ? `${day.start} – ${day.end}` : "Dam olish kuni"}\n📋 Holat: ${today ? statusLabel[today.status] || today.status : "Hali qayd etilmagan"}${noAppNote}`,
      { reply_markup: keyboard() },
    );
  });

  bot.on("message:contact", async (ctx) => {
    const contact = ctx.message.contact;
    if (!ctx.from || contact.user_id !== ctx.from.id) {
      await ctx.reply(
        "Faqat o‘zingizning raqamingizni tugma orqali yuboring.",
        { reply_markup: contactKeyboard() },
      );
      return;
    }
    const result = await linkEmployeeByPhone(contact.phone_number, ctx.from);
    if (result.ok) return welcomeLinked(ctx, result.employee);
    await ctx.reply(`⚠️ ${result.reason}`, {
      reply_markup: { remove_keyboard: true },
    });
  });

  bot.command("profile", async (ctx) =>
    employeeCommand(ctx.from?.id, ctx, "profile", keyboard()),
  );
  bot.command("attendance", async (ctx) =>
    employeeCommand(ctx.from?.id, ctx, "attendance", keyboard()),
  );
  bot.command("schedule", async (ctx) =>
    employeeCommand(ctx.from?.id, ctx, "schedule", keyboard()),
  );
  bot.command("leave", async (ctx) =>
    ctx.reply("Ta’til so‘rovini Mini App’dagi «Ta’til» bo‘limidan yuboring.", {
      reply_markup: keyboard(),
    }),
  );
  bot.command("help", async (ctx) =>
    ctx.reply(
      "ℹ️ Yordam\n\n/start — bosh sahifa va hisobni ulash\n/attendance — bugungi davomat\n/schedule — ish grafigi\n/profile — profil\n/leave — ta’til so‘rovi\n\nMuammo bo‘lsa kompaniyangiz HR bo‘limiga murojaat qiling.",
      { reply_markup: keyboard() },
    ),
  );
  bot.on("message:text", async (ctx) => {
    await ctx.reply(
      "Kerakli bo‘limni Mini App orqali oching yoki /help buyrug‘idan foydalaning.",
      { reply_markup: keyboard() },
    );
  });
  bot.catch((error) => {
    console.error("Telegram bot update xatosi", error.error);
  });

  try {
    const me = await bot.api.getMe();
    bot.botInfo = me;
    botState = { state: "starting", username: me.username, webAppUrl };
    await bot.api.setMyCommands([
      { command: "start", description: "Bosh sahifa / hisobni ulash" },
      { command: "attendance", description: "Bugungi davomat" },
      { command: "schedule", description: "Ish grafigim" },
      { command: "profile", description: "Mening profilim" },
      { command: "leave", description: "Ta’til so‘rovi" },
      { command: "help", description: "Yordam" },
    ]);
    if (canUseWebApp)
      await bot.api.setChatMenuButton({
        menu_button: {
          type: "web_app",
          text: "Staffora",
          web_app: { url: webAppUrl },
        },
      });

    const useWebhook =
      process.env.TELEGRAM_USE_WEBHOOK === "true" ||
      (process.env.TELEGRAM_USE_WEBHOOK !== "false" &&
        process.env.NODE_ENV === "production" &&
        baseOk);
    if (useWebhook && baseOk) {
      const secretToken = webhookSecret(token);
      webhookHandler = webhookCallback(bot, "express", {
        secretToken,
        onTimeout: "return",
      });
      try {
        await bot.api.setWebhook(`${baseUrl}/api/telegram/webhook`, {
          secret_token: secretToken,
          allowed_updates: ["message", "callback_query"],
          drop_pending_updates: false,
        });
        botState = {
          state: "running",
          mode: "webhook",
          username: me.username,
          webAppUrl,
          error: botState.error,
        };
        console.log(`Staffora Telegram bot (webhook): @${me.username} → ${webAppUrl}`);
        return;
      } catch (reason) {
        webhookHandler = undefined;
        console.error("Webhook o‘rnatilmadi, polling rejimiga o‘tiladi", reason);
      }
    }
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    void runPolling(bot, me.username, webAppUrl);
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "Telegram bilan aloqa xatosi";
    botState = { state: "error", webAppUrl, error: message };
    console.error("Telegram bot sozlanmadi", reason);
    // Vaqtinchalik tarmoq xatosi bo‘lsa bot o‘chiq qolib ketmasin — qayta urinamiz.
    const unauthorized = reason instanceof GrammyError && reason.error_code === 401;
    if (!stopping && !unauthorized) {
      startAttempts += 1;
      const delay = Math.min(5 * 60_000, 10_000 * 2 ** Math.min(5, startAttempts - 1));
      setTimeout(() => {
        if (!stopping && botState.state === "error") void startTelegramBot();
      }, delay).unref();
    }
  }
}
let startAttempts = 0;

/** Polling: 409 (boshqa instansiya ishlayapti) yoki tarmoq xatosida qayta urinadi. */
async function runPolling(bot: Bot, username: string, webAppUrl: string) {
  let delay = 5_000;
  while (!stopping) {
    try {
      await bot.start({
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false,
        onStart: () => {
          delay = 5_000;
          botState = { state: "running", mode: "polling", username, webAppUrl };
          console.log(`Staffora Telegram bot (polling): @${username}`);
        },
      });
      return; // bot.stop() chaqirilgan
    } catch (reason) {
      if (stopping) return;
      const conflict =
        reason instanceof GrammyError && reason.error_code === 409;
      const message =
        reason instanceof Error ? reason.message : "Bot polling to‘xtadi";
      botState = {
        state: "error",
        mode: "polling",
        username,
        webAppUrl,
        error: conflict
          ? "Bu token bilan boshqa bot nusxasi ishlayapti (409). Qayta urinilmoqda…"
          : message,
      };
      console.error(`Telegram polling xatosi, ${delay / 1000}s dan keyin qayta urinish`, message);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 60_000);
    }
  }
}

function webhookSecret(token: string) {
  return createHmac("sha256", "staffora-telegram-webhook")
    .update(token)
    .digest("hex")
    .slice(0, 48);
}

export function telegramWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!webhookHandler)
    return res.status(503).json({ message: "Telegram webhook tayyor emas." });
  return webhookHandler(req, res, next);
}

export async function stopTelegramBot() {
  stopping = true;
  if (activeBot?.isRunning()) await activeBot.stop();
  botState = { ...botState, state: "disabled" };
}

async function employeeCommand(
  telegramId: number | undefined,
  ctx: { reply: (text: string, other?: object) => Promise<unknown> },
  command: "profile" | "attendance" | "schedule",
  keyboard?: InlineKeyboard,
) {
  const db = await readDb();
  const employee = db.employees.find(
    (item) =>
      item.telegramId === String(telegramId) &&
      item.telegramConnected &&
      item.status === "ACTIVE",
  );
  if (!employee)
    return ctx.reply(
      "Telegram hisobingiz xodim profiliga ulanmagan. /start buyrug‘ini bosing.",
    );
  const extra = keyboard ? { reply_markup: keyboard } : undefined;
  if (command === "profile") {
    const position = db.positions.find((p) => p.id === employee.positionId);
    const branch = db.branches.find((b) => b.id === employee.branchId);
    return ctx.reply(
      `👤 ${employee.firstName} ${employee.lastName}\n🆔 ${employee.employeeNo}\n💼 ${position?.name || "—"}\n📍 ${branch?.name || "—"}\n📞 ${employee.phone}\n🔐 Face ID: ${employee.faceEnrolledAt ? "faol" : "sozlanmagan"}`,
      extra,
    );
  }
  if (command === "schedule") {
    const schedule = db.schedules.find((s) => s.id === employee.scheduleId);
    const names = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
    const lines =
      schedule?.days
        .slice()
        .sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7))
        .map(
          (d) =>
            `${names[d.day]}: ${d.enabled ? `${d.start} – ${d.end}` : "dam olish"}`,
        )
        .join("\n") || "—";
    return ctx.reply(
      `🗓 ${schedule?.name || "Grafik belgilanmagan"}\nKechikish imtiyozi: ${schedule?.graceMinutes || 0} daqiqa\n\n${lines}`,
      extra,
    );
  }
  const attendance = db.attendance.find(
    (a) => a.employeeId === employee.id && a.date === tashkentIsoDate(),
  );
  return ctx.reply(
    `📋 Bugungi davomat\n\nHolat: ${attendance ? statusLabel[attendance.status] || attendance.status : "Hali qayd etilmagan"}\nKelish: ${attendance?.checkIn || "—"}\nKetish: ${attendance?.checkOut || "—"}${attendance?.lateMinutes ? `\nKechikish: ${attendance.lateMinutes} daqiqa` : ""}`,
    extra,
  );
}

let sharedApi: Api | undefined;
/** Bot API mijozini qaytaradi (token bo‘lmasa — undefined). */
export function botApi() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return undefined;
  return activeBot?.api || (sharedApi ||= new Api(token));
}
// Telegram bitta botga soniyasiga ~30 xabar ruxsat beradi — biz 25 tadan oshirmaymiz.
const SEND_SPACING_MS = 40;
let nextSendAt = 0;
async function sendSlot() {
  const now = Date.now();
  const at = Math.max(now, nextSendAt);
  nextSendAt = at + SEND_SPACING_MS;
  if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
}

/**
 * Xodimga xabar. Ko‘p xabar birdan yuborilsa ham navbat bilan ketadi, Telegram
 * 429 qaytarsa ko‘rsatilgan vaqt kutib qayta uriniladi. Xodim botni bloklagan
 * bo‘lsa (403) — xato otilmaydi, false qaytadi.
 */
export async function sendTelegramMessage(
  telegramId: string,
  text: string,
  options: { openButton?: boolean } = {},
) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return false;
  const api = activeBot?.api || (sharedApi ||= new Api(token));
  const { webAppUrl, ok } = resolveWebAppUrl();
  const extra =
    options.openButton && ok
      ? { reply_markup: new InlineKeyboard().webApp("📲 Staffora’ni ochish", webAppUrl) }
      : undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await sendSlot();
    try {
      await api.sendMessage(telegramId, text, extra);
      return true;
    } catch (reason) {
      if (reason instanceof GrammyError) {
        if (reason.error_code === 429) {
          const wait = Number(reason.parameters?.retry_after || 1) * 1000;
          nextSendAt = Math.max(nextSendAt, Date.now() + wait);
          continue;
        }
        // Bloklagan, o‘chirilgan yoki botni boshlamagan foydalanuvchi — qayta urinish befoyda.
        if (reason.error_code === 403 || reason.error_code === 400) return false;
      }
      if (attempt === 3) throw reason;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  return false;
}
