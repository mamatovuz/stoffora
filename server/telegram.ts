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

export async function linkEmployeeByInvite(
  code: string,
  telegram: { id: number | string; username?: string },
): Promise<LinkResult> {
  return updateDb((db) => {
    const invite = db.telegramInvites.find(
      (item) =>
        item.code === code &&
        !item.usedAt &&
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

function resolveWebAppUrl() {
  const baseUrl = (
    process.env.APP_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "")
  ).replace(/\/+$/, "");
  return {
    baseUrl,
    webAppUrl: (
      process.env.TELEGRAM_WEBAPP_URL || (baseUrl ? `${baseUrl}/mini-app` : "")
    ).trim(),
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
  const { baseUrl, webAppUrl } = resolveWebAppUrl();
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
  if (!webAppUrl.startsWith("https://"))
    console.warn(
      "Telegram bot: Mini App URL HTTPS emas. Telegram ichida tugma ishlamaydi — HTTPS domen yoki tunnel kerak.",
    );

  botState = { state: "starting", webAppUrl };
  const bot = new Bot(token);
  activeBot = bot;
  const canUseWebApp = webAppUrl.startsWith("https://");
  const keyboard = () =>
    canUseWebApp
      ? new InlineKeyboard().webApp("📲 STAFFORA’NI OCHISH", webAppUrl)
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
    await ctx.reply(
      `${title}\n\n👤 ${employee.firstName} ${employee.lastName}\n🆔 ${employee.employeeNo}\n\nDavomatni belgilash uchun quyidagi tugmani bosing.`,
      { reply_markup: { remove_keyboard: true } },
    );
    await ctx.reply("Staffora Mini App:", { reply_markup: keyboard() });
  }

  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim();
    const from = ctx.from;
    if (!from) return;
    if (payload) {
      const result = await linkEmployeeByInvite(payload, from);
      if (result.ok) return welcomeLinked(ctx, result.employee);
      await ctx.reply(
        `⚠️ ${result.reason}\n\nYoki telefon raqamingizni yuborib ulaning:`,
        { reply_markup: contactKeyboard() },
      );
      return;
    }
    const db = await readDb();
    const employee = db.employees.find(
      (item) =>
        item.telegramId === String(from.id) &&
        item.telegramConnected &&
        item.status === "ACTIVE",
    );
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
      `Assalomu alaykum, ${employee.firstName}! 👋\n\n🏢 ${db.companies.find((c) => c.id === employee.companyId)?.name || "—"}\n📍 Filial: ${branch?.name || "—"}\n🕘 Bugungi grafik: ${day?.enabled ? `${day.start} – ${day.end}` : "Dam olish kuni"}\n📋 Holat: ${today ? statusLabel[today.status] || today.status : "Hali qayd etilmagan"}`,
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
        baseUrl.startsWith("https://"));
    if (useWebhook) {
      const secretToken = webhookSecret(token);
      webhookHandler = webhookCallback(bot, "express", {
        secretToken,
        onTimeout: "return",
      });
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
      };
      console.log(`Staffora Telegram bot (webhook): @${me.username}`);
      return;
    }
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    void runPolling(bot, me.username, webAppUrl);
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "Telegram bilan aloqa xatosi";
    botState = { state: "error", webAppUrl, error: message };
    console.error("Telegram bot sozlanmadi", reason);
  }
}

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
export async function sendTelegramMessage(
  telegramId: string,
  text: string,
  options: { openButton?: boolean } = {},
) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return false;
  const api = activeBot?.api || (sharedApi ||= new Api(token));
  const { webAppUrl } = resolveWebAppUrl();
  await api.sendMessage(
    telegramId,
    text,
    options.openButton && webAppUrl.startsWith("https://")
      ? {
          reply_markup: new InlineKeyboard().webApp(
            "📲 Staffora’ni ochish",
            webAppUrl,
          ),
        }
      : undefined,
  );
  return true;
}
