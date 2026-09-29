import { createHmac, timingSafeEqual } from "node:crypto";
import { Bot, InlineKeyboard } from "grammy";
import { audit, readDb, updateDb } from "../lib/store";
import { tashkentIsoDate } from "../lib/format";

export interface TelegramIdentity {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 3600,
): TelegramIdentity {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) throw new Error("Telegram imzosi topilmadi.");
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) throw new Error("Telegram vaqti noto‘g‘ri.");
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age < -30 || age > maxAgeSeconds)
    throw new Error("Telegram sessiyasi eskirgan.");
  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
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
    throw new Error("Telegram imzosi yaroqsiz.");
  const rawUser = params.get("user");
  if (!rawUser) throw new Error("Telegram foydalanuvchisi topilmadi.");
  const user = JSON.parse(rawUser) as TelegramIdentity;
  if (!user.id) throw new Error("Telegram ID noto‘g‘ri.");
  return user;
}

export async function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const baseUrl =
    process.env.APP_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : undefined);
  const webAppUrl =
    process.env.TELEGRAM_WEBAPP_URL || (baseUrl ? `${baseUrl}/mini-app` : "");
  if (!token) {
    console.log("Telegram bot: token yo‘q, bot ishga tushirilmadi");
    return;
  }
  if (!webAppUrl) {
    console.warn("Telegram bot: TELEGRAM_WEBAPP_URL belgilanmagan");
    return;
  }
  const bot = new Bot(token);
  const keyboard = () =>
    new InlineKeyboard().webApp("STAFFORA’NI OCHISH", webAppUrl);

  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim();
    const telegramId = String(ctx.from?.id || "");
    if (payload) {
      const linked = await updateDb((db) => {
        const invite = db.telegramInvites.find(
          (item) =>
            item.code === payload &&
            !item.usedAt &&
            new Date(item.expiresAt).getTime() > Date.now(),
        );
        if (!invite) return null;
        const employee = db.employees.find(
          (item) =>
            item.id === invite.employeeId &&
            item.companyId === invite.companyId &&
            item.status === "ACTIVE",
        );
        if (!employee) return null;
        employee.telegramId = telegramId;
        employee.telegramUsername = ctx.from?.username;
        employee.telegramConnected = true;
        employee.deviceStatus = "CONNECTED";
        employee.updatedAt = new Date().toISOString();
        invite.usedAt = new Date().toISOString();
        db.auditLogs.unshift(
          audit(
            employee.companyId,
            `${employee.firstName} ${employee.lastName}`,
            "Telegram hisobi ulandi",
            "employee",
            employee.id,
          ),
        );
        return employee;
      });
      if (linked) {
        await ctx.reply(
          `✅ Hisob muvaffaqiyatli ulandi.\n\n${linked.firstName} ${linked.lastName}\n${linked.employeeNo}`,
          { reply_markup: keyboard() },
        );
        return;
      }
      await ctx.reply("Ulanish havolasi yaroqsiz yoki muddati tugagan.");
      return;
    }
    const db = await readDb();
    const employee = db.employees.find(
      (item) => item.telegramId === telegramId && item.status === "ACTIVE",
    );
    if (!employee) {
      await ctx.reply(
        "Staffora’ga xush kelibsiz. Telegram hisobingiz xodim profiliga ulanmagan. HR bergan taklif havolasini oching.",
      );
      return;
    }
    const branch = db.branches.find((item) => item.id === employee.branchId);
    const schedule = db.schedules.find(
      (item) => item.id === employee.scheduleId,
    );
    const day = schedule?.days.find((item) => item.day === new Date().getDay());
    await ctx.reply(
      `Assalomu alaykum, ${employee.firstName}!\n\nKompaniya: ${db.companies.find((c) => c.id === employee.companyId)?.name}\nFilial: ${branch?.name || "—"}\nBugungi grafik: ${day?.enabled ? `${day.start} – ${day.end}` : "Dam olish"}`,
      { reply_markup: keyboard() },
    );
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
    ctx.reply("Ta’til so‘rovi Mini App orqali yuboriladi.", {
      reply_markup: keyboard(),
    }),
  );
  bot.command("help", async (ctx) =>
    ctx.reply(
      "Yordam uchun kompaniyangiz HR bo‘limiga murojaat qiling.\n\n/start — bosh sahifa\n/profile — profil\n/attendance — bugungi davomat\n/schedule — ish grafigi\n/leave — ta’til",
    ),
  );
  bot.catch((error) => console.error("Telegram bot error", error.error));
  void bot.start({
    onStart: () => console.log("Staffora Telegram bot ishga tushdi"),
  });
}

async function employeeCommand(
  telegramId: number | undefined,
  ctx: { reply: (text: string, other?: object) => Promise<unknown> },
  command: "profile" | "attendance" | "schedule",
  keyboard: InlineKeyboard,
) {
  const db = await readDb();
  const employee = db.employees.find(
    (item) => item.telegramId === String(telegramId),
  );
  if (!employee)
    return ctx.reply("Telegram hisobingiz xodim profiliga ulanmagan.");
  if (command === "profile")
    return ctx.reply(
      `${employee.firstName} ${employee.lastName}\nID: ${employee.employeeNo}\nTelefon: ${employee.phone}`,
      { reply_markup: keyboard },
    );
  if (command === "schedule") {
    const schedule = db.schedules.find((s) => s.id === employee.scheduleId);
    return ctx.reply(
      `Ish grafigi: ${schedule?.name || "—"}\nKechikish imtiyozi: ${schedule?.graceMinutes || 0} daqiqa`,
      { reply_markup: keyboard },
    );
  }
  const today = tashkentIsoDate();
  const attendance = db.attendance.find(
    (a) => a.employeeId === employee.id && a.date === today,
  );
  return ctx.reply(
    `Bugungi davomat: ${attendance?.status || "Qayd etilmagan"}\nKelish: ${attendance?.checkIn || "—"}\nChiqish: ${attendance?.checkOut || "—"}`,
    { reply_markup: keyboard },
  );
}

export async function sendTelegramMessage(telegramId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  await new Bot(token).api.sendMessage(telegramId, text);
  return true;
}
