import { GrammyError, InputFile } from "grammy";
import { readDb, updateDb } from "../lib/store";
import type { Attendance, Branch, Database, Employee } from "../lib/types";
import { botApi } from "./telegram";

const MAX_AGE_MS = 7 * 86_400_000; // navbatdagi rasm 7 kundan keyin tashlanadi
const SEND_INTERVAL_MS = 15_000;
const CLEANUP_INTERVAL_MS = 60 * 60_000;

const ddmmyyyy = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

/**
 * Keldi-ketdi rasmini navbatga qo‘yadi. Caption’da hodisaning haqiqiy vaqti
 * yoziladi — server yoki Telegram vaqtincha ishlamasa ham, keyin yuborilganda
 * vaqt to‘g‘ri ko‘rinadi.
 */
export function enqueueAttendancePhoto(
  db: Database,
  input: {
    employee: Employee;
    branch: Branch;
    attendance: Attendance;
    action: "CHECK_IN" | "CHECK_OUT";
    photoDataUrl?: string;
  },
) {
  const company = db.companies.find((c) => c.id === input.employee.companyId);
  const channel = company?.photoChannel;
  if (!channel?.enabled || !channel.chatId || !input.photoDataUrl) return;
  const a = input.attendance;
  const checkIn = input.action === "CHECK_IN";
  const lines = [
    `${checkIn ? "🟢 KELDI" : "🔴 KETDI"} — ${input.employee.firstName} ${input.employee.lastName}`,
    `🆔 ${input.employee.employeeNo}`,
    `🕘 ${checkIn ? a.checkIn : a.checkOut} · ${ddmmyyyy(a.date)}`,
    checkIn
      ? a.lateMinutes
        ? `⚠️ ${a.lateMinutes} daqiqa kechikdi (grafik ${a.scheduledStart})`
        : `✅ Vaqtida (grafik ${a.scheduledStart})`
      : `⏱ Ishladi: ${Math.floor(a.workedMinutes / 60)} soat ${a.workedMinutes % 60} daq`,
    `📍 ${input.branch.name}${a.distanceMeters !== undefined ? ` · ${a.distanceMeters} m` : ""}`,
    `🔐 Face ID + GPS${a.verification.includes("QR") ? " + QR" : ""}`,
  ];
  db.photoQueue.push({
    id: crypto.randomUUID(),
    companyId: input.employee.companyId,
    chatId: channel.chatId,
    photoDataUrl: input.photoDataUrl,
    caption: lines.join("\n"),
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
}

function photoBuffer(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] || "";
  return Buffer.from(base64, "base64");
}

let sending = false;
async function flushQueue() {
  if (sending) return;
  const api = botApi();
  if (!api) return;
  sending = true;
  try {
    const db = await readDb();
    const now = Date.now();
    const jobs = db.photoQueue
      .filter((job) => {
        // Qayta urinishlar orasidagi kutish: 15s, 30s, 1m … maksimal 10 daqiqa.
        if (!job.attempts || !job.lastAttemptAt) return true;
        const wait = Math.min(10 * 60_000, SEND_INTERVAL_MS * 2 ** Math.min(job.attempts, 6));
        return now - new Date(job.lastAttemptAt).getTime() >= wait;
      })
      .slice(0, 10);
    for (const job of jobs) {
      try {
        const message = await api.sendPhoto(
          job.chatId,
          new InputFile(photoBuffer(job.photoDataUrl), "staffora.jpg"),
          { caption: job.caption },
        );
        await updateDb((next) => {
          next.photoQueue = next.photoQueue.filter((item) => item.id !== job.id);
          next.channelPosts.push({
            companyId: job.companyId,
            chatId: job.chatId,
            messageId: message.message_id,
            sentAt: new Date().toISOString(),
          });
        });
      } catch (error) {
        const text =
          error instanceof GrammyError ? error.description : error instanceof Error ? error.message : "xato";
        await updateDb((next) => {
          const item = next.photoQueue.find((row) => row.id === job.id);
          if (item) {
            item.attempts += 1;
            item.lastError = text.slice(0, 200);
            item.lastAttemptAt = new Date().toISOString();
          }
        });
        // Tarmoq xatosi bo‘lsa, qolganlarini keyingi safar urinamiz.
        if (!(error instanceof GrammyError)) break;
      }
    }
    // Juda eski rasmlarni navbatdan olib tashlaymiz (xotira to‘lib ketmasin).
    if (db.photoQueue.some((job) => now - new Date(job.createdAt).getTime() > MAX_AGE_MS))
      await updateDb((next) => {
        next.photoQueue = next.photoQueue.filter(
          (job) => Date.now() - new Date(job.createdAt).getTime() <= MAX_AGE_MS,
        );
      });
  } catch (error) {
    console.error("Rasm navbati xatosi", error);
  } finally {
    sending = false;
  }
}

/** Sozlamada belgilangan kundan eski kanal postlarini o‘chiradi. */
async function cleanupChannel() {
  const api = botApi();
  if (!api) return;
  try {
    const db = await readDb();
    const expired = db.channelPosts.filter((post) => {
      const days = db.companies.find((c) => c.id === post.companyId)?.photoChannel?.retentionDays || 0;
      return days > 0 && Date.now() - new Date(post.sentAt).getTime() > days * 86_400_000;
    });
    if (!expired.length) return;
    const done = new Set<string>();
    for (const post of expired.slice(0, 200)) {
      try {
        await api.deleteMessage(post.chatId, post.messageId);
        done.add(`${post.chatId}:${post.messageId}`);
      } catch (error) {
        // Xabar allaqachon o‘chirilgan yoki topilmasa — ro‘yxatdan chiqaramiz.
        if (error instanceof GrammyError && error.error_code === 400)
          done.add(`${post.chatId}:${post.messageId}`);
      }
    }
    if (done.size)
      await updateDb((next) => {
        next.channelPosts = next.channelPosts.filter(
          (post) => !done.has(`${post.chatId}:${post.messageId}`),
        );
      });
  } catch (error) {
    console.error("Kanal tozalash xatosi", error);
  }
}

export function startPhotoChannelWorker() {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  setInterval(() => void flushQueue(), SEND_INTERVAL_MS).unref();
  setInterval(() => void cleanupChannel(), CLEANUP_INTERVAL_MS).unref();
  setTimeout(() => void cleanupChannel(), 30_000).unref();
}

/** Kanal sozlamasini tekshiradi: bot kanalga yoza oladimi. */
export async function testPhotoChannel(chatId: string) {
  const api = botApi();
  if (!api) throw Object.assign(new Error("Telegram bot sozlanmagan."), { status: 503 });
  try {
    const chat = await api.getChat(chatId);
    const me = await api.getMe();
    const member = await api.getChatMember(chat.id, me.id);
    if (member.status !== "administrator" && member.status !== "creator")
      throw Object.assign(
        new Error(`@${me.username} kanalga administrator qilib qo‘shilmagan.`),
        { status: 422 },
      );
    const canDelete = member.status === "creator" || Boolean((member as { can_delete_messages?: boolean }).can_delete_messages);
    const canPost = member.status === "creator" || Boolean((member as { can_post_messages?: boolean }).can_post_messages);
    if (chat.type === "channel" && !canPost)
      throw Object.assign(new Error("Botga «Xabar joylash» huquqini bering."), { status: 422 });
    await api.sendMessage(
      chat.id,
      "✅ Staffora ulandi. Endi xodimlarning keldi-ketdi rasmlari shu yerga tushadi.",
    );
    const title = "title" in chat && chat.title ? chat.title : String(chat.id);
    return { chatId: String(chat.id), title, canDelete };
  } catch (error) {
    if (error instanceof GrammyError)
      throw Object.assign(
        new Error(
          error.error_code === 400
            ? "Kanal topilmadi. Kanal ID (-100…) yoki @username’ni tekshiring va botni kanalga admin qiling."
            : error.error_code === 403
              ? "Bot kanalga kira olmaydi. Botni kanalga administrator qilib qo‘shing."
              : error.description,
        ),
        { status: 422 },
      );
    throw error;
  }
}
