import { InlineKeyboard, type Context } from "grammy";
import { readDb } from "../lib/store";
import type { Database, User } from "../lib/types";
import { signSession, type Session } from "./auth";
import { branchManagers } from "./mini-extra";
import { pushToEmployee } from "./push";
import { miniAppUrl, sendTelegramMessage } from "./telegram";

/*
 * So‘rovlar bo‘yicha rahbarga xabar: Telegram’da «✅ Tasdiqlash / ❌ Rad etish» tugmalari bilan,
 * telefon ilovasida esa push bildirishnoma bilan.
 *
 * Tugma bosilganda qaror panelning o‘zi ishlatadigan API orqali qabul qilinadi (shu rahbar nomidan
 * qisqa sessiya bilan) — huquqlar, filial chegarasi, xodimga xabar va audit xuddi paneldagidek.
 * Callback ma’lumoti: «rq:a:<tur>:<id>» yoki «rq:r:<tur>:<id>» (Telegram cheklovi — 64 bayt).
 */

export type RequestKind = "leave" | "swap" | "dayoff" | "mark" | "advance";

const DECIDE: Record<RequestKind, (id: string, approve: boolean) => { method: "POST" | "PATCH"; path: string; body: Record<string, unknown> }> = {
  leave: (id, approve) => ({ method: "PATCH", path: `/leave/${id}`, body: { status: approve ? "APPROVED" : "REJECTED" } }),
  swap: (id, approve) => ({ method: "POST", path: `/shift-swaps/${id}/decide`, body: { approve } }),
  dayoff: (id, approve) => ({ method: "POST", path: `/dayoff-moves/${id}/decide`, body: { approve } }),
  mark: (id, approve) => ({ method: "POST", path: `/attendance-corrections/${id}/decide`, body: { approve } }),
  advance: (id, approve) => ({ method: "POST", path: `/payroll/advances/${id}/decide`, body: { approve } }),
};
const KINDS = Object.keys(DECIDE) as RequestKind[];

export function requestKeyboard(kind: RequestKind, id: string) {
  const keyboard = new InlineKeyboard().text("✅ Tasdiqlash", `rq:a:${kind}:${id}`).text("❌ Rad etish", `rq:r:${kind}:${id}`);
  const url = miniAppUrl("manager_requests");
  if (url) keyboard.row().webApp("📋 Barcha so‘rovlar", url);
  return keyboard;
}

/** Rahbar (panel foydalanuvchisi) xodim sifatida ilovaga ulangan bo‘lsa — o‘sha telefonlarga push. */
export async function pushToManager(db: Database, user: Pick<User, "telegramId" | "companyId">, title: string, body: string, go = "manager_requests") {
  if (process.env.MOBILE_PUSH === "false" || !user.telegramId) return 0;
  const employees = db.employees.filter((e) => e.companyId === user.companyId && e.telegramId === user.telegramId && e.status === "ACTIVE");
  const results = await Promise.allSettled(employees.map((e) => pushToEmployee(e.id, { title, body, data: { go } }, db)));
  return results.reduce((sum, r) => sum + (r.status === "fulfilled" ? r.value : 0), 0);
}

const plain = (text: string) => text.replace(/<[^>]+>/g, "");

/**
 * Yangi so‘rov haqida javobgar rahbarlarga xabar (Telegram tugmalari + ilova push).
 * `approvers` berilmasa — egasi, HR va shu filial rahbari (branchManagers).
 */
export async function notifyRequest(
  db: Database,
  input: { companyId: string; branchId?: string; kind: RequestKind; id: string; text: string; pushTitle: string; approvers?: User[] },
) {
  const approvers = input.approvers || branchManagers(db, input.companyId, input.branchId);
  const keyboard = requestKeyboard(input.kind, input.id);
  const body = plain(input.text).split("\n").slice(1).join(" · ").slice(0, 300);
  const results = await Promise.allSettled(
    approvers.map(async (u) => {
      const sent = process.env.TELEGRAM_BOT_TOKEN && u.telegramId ? await sendTelegramMessage(u.telegramId, input.text, { keyboard }).catch(() => false) : false;
      await pushToManager(db, u, input.pushTitle, body).catch(() => 0);
      return sent;
    }),
  );
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}

/** Qarorni shu rahbar nomidan panel API’si orqali bajaradi. */
async function decideAs(user: User, kind: RequestKind, id: string, approve: boolean) {
  const session: Session = { userId: user.id, companyId: user.companyId, name: user.name, email: user.email, role: user.role };
  const spec = DECIDE[kind](id, approve);
  const port = Number(process.env.PORT || 4000);
  const response = await fetch(`http://127.0.0.1:${port}/api${spec.path}`, {
    method: spec.method,
    headers: { authorization: `Bearer ${signSession(session)}`, "content-type": "application/json" },
    body: JSON.stringify(spec.body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(data.message || `So‘rov bajarilmadi (${response.status}).`);
}

/** Bot callback’i: «rq:…» bo‘lsa — qayta ishlaydi va true qaytaradi. */
export async function handleRequestCallback(ctx: Context, companyId?: string) {
  const data = ctx.callbackQuery?.data || "";
  const match = /^rq:([ar]):([a-z]+):([\w-]{1,48})$/.exec(data);
  if (!match) return false;
  const [, action, kind, id] = match;
  if (!KINDS.includes(kind as RequestKind)) {
    await ctx.answerCallbackQuery();
    return true;
  }
  const db = await readDb();
  const telegramId = String(ctx.from?.id || "");
  const user = db.users.find((u) => u.telegramId === telegramId && u.companyId && (!companyId || u.companyId === companyId));
  if (!user) {
    await ctx.answerCallbackQuery({ text: "Rahbar hisobi topilmadi.", show_alert: true });
    return true;
  }
  const approve = action === "a";
  try {
    await decideAs(user, kind as RequestKind, id, approve);
  } catch (reason) {
    await ctx.answerCallbackQuery({ text: reason instanceof Error ? reason.message.slice(0, 190) : "Xatolik", show_alert: true });
    return true;
  }
  await ctx.answerCallbackQuery({ text: approve ? "Tasdiqlandi" : "Rad etildi" });
  // Xabar ostiga natija yoziladi, tugmalar olib tashlanadi — ikkinchi marta bosilmaydi.
  const message = ctx.callbackQuery?.message;
  const original = message && "text" in message ? message.text || "" : "";
  const stamp = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });
  await ctx
    .editMessageText(`${original}\n\n${approve ? "✅ Tasdiqlandi" : "❌ Rad etildi"} — ${user.name}, ${stamp}`)
    .catch(() => ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined));
  return true;
}

/**
 * Rahbarlarga (egasi, HR, shu filial rahbari) muhim hodisa: Telegram xabari va telefon push’i.
 * `go` — bosilganda ochiladigan bo‘lim (Mini App va ilovada bir xil nomlar).
 */
export async function alertManagers(db: Database, input: { companyId: string; branchId?: string; text: string; pushTitle: string; pushBody: string; go: string }) {
  const managers = branchManagers(db, input.companyId, input.branchId);
  const results = await Promise.allSettled(
    managers.map(async (u) => {
      const sent = process.env.TELEGRAM_BOT_TOKEN && u.telegramId ? await sendTelegramMessage(u.telegramId, input.text, { go: input.go }).catch(() => false) : false;
      const pushed = await pushToManager(db, u, input.pushTitle, input.pushBody, input.go).catch(() => 0);
      return sent || pushed > 0;
    }),
  );
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}

const FLAG_TEXT: Record<string, string> = {
  GPS_ACCURACY: "GPS aniqligi g‘ayritabiiy",
  GPS_EXACT_REPEAT: "koordinata avvalgisi bilan aynan bir xil",
  GPS_TELEPORT: "imkonsiz tezlikda joy o‘zgargan",
  GPS_EDGE: "hudud chegarasida (faqat aniqlik hisobiga ichkarida)",
  GPS_STALE: "eski (keshlangan) joylashuv",
  DEVICE_STILL: "telefon umuman qimirlamagan",
  DESKTOP: "kompyuterdan belgilangan",
  MOCK_LOCATION: "soxta joylashuv (mock GPS)",
};

/**
 * Shubhali belgi (soxta GPS, chegarada, teleport…) — rahbarga darhol. Xodim uchun kuniga bir marta
 * (ketishda yana bayroq chiqsa ham takrorlanmaydi). «Internetsiz» yolg‘iz o‘zi shubhali hisoblanmaydi.
 */
export async function alertSuspiciousMark(
  employee: { id: string; companyId: string; firstName: string; lastName: string },
  input: { branchId: string; branchName: string; date: string; time: string; action: "CHECK_IN" | "CHECK_OUT"; flags: string[] },
) {
  const serious = input.flags.filter((f) => f !== "OFFLINE");
  if (!serious.length) return false;
  const key = `FLAGALERT:${employee.id}:${input.date}`;
  const { readDb: read, updateDb: update } = await import("../lib/store");
  const before = await read();
  if (before.sentGreetings.some((g) => g.key === key)) return false;
  await update((next) => void next.sentGreetings.push({ key, at: new Date().toISOString() }));
  const db = await read();
  const name = `${employee.firstName} ${employee.lastName}`.trim();
  const labels = serious.map((f) => FLAG_TEXT[f] || f);
  await alertManagers(db, {
    companyId: employee.companyId,
    branchId: input.branchId,
    text: `⚠️ <b>Shubhali belgi</b>\n${name} · ${input.action === "CHECK_IN" ? "kelish" : "ketish"} ${input.time} · ${input.branchName}\n${labels.map((l) => `• ${l}`).join("\n")}\n\nDavomatda ko‘rib chiqing.`,
    pushTitle: "⚠️ Shubhali belgi",
    pushBody: `${name} (${input.branchName}): ${labels.join(", ")}`,
    go: "manager_today_FLAGGED",
  });
  return true;
}
