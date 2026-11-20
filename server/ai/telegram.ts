import type { Role } from "../../lib/types";
import { AI_QUICK, type AiCard, type AiQuickKey, type AiSuggestion, type AiTone } from "../../lib/ai/types";
import { readDb, updateDb } from "../../lib/store";
import type { AuthedRequest } from "../auth";
import { actionResultMessage, cancelStagedAction, confirmStagedAction, processChat, quickFor, telegramCall } from "./routes";

/*
 * Staffora AI Telegram’da — saytdagi bilan bir xil dvigatel (processChat), lekin Telegram ko‘rinishida:
 *   - javob tayyorlanayotganda «O‘ylayapman…» qoralamasi (sendMessageDraft, Bot API 9.3+);
 *   - hisobot/xodim kartasi xabar ichidagi HTML vidjet sifatida (sendWidget, Bot API 10.4),
 *     vidjet ishlamasa — oddiy formatlangan xabar;
 *   - pastida tugmalar: keyingi savollar, topilgan xodimlar, o‘zgarishni tasdiqlash/bekor qilish.
 * Callback ma’lumoti 64 baytdan oshmasligi uchun qisqa kalitlar: ai:k:<tezkor>, ai:e:<xodim>, ai:ok|no:<amal>.
 */

export type TgAiUser = { id: string; companyId: string; name: string; email: string; role: Role };
export type TgAiTarget = { token: string; companyId: string; chatId: string; user: TgAiUser };
type Button = { text: string; callback_data?: string; url?: string; style?: "success" | "danger" | "primary" };
type Keyboard = { inline_keyboard: Button[][] };
type ChatResult = Awaited<ReturnType<typeof processChat>>;

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const reqOf = (target: TgAiTarget) =>
  ({ session: { userId: target.user.id, companyId: target.companyId, name: target.user.name, email: target.user.email, role: target.user.role } }) as AuthedRequest;
const widgetsOn = () => process.env.AI_TELEGRAM_WIDGETS !== "false";
const appUrl = () => {
  const url = (process.env.APP_URL || process.env.PUBLIC_URL || "").replace(/\/$/, "");
  return url.startsWith("https://") ? url : "";
};

/* ------------------------------------------------------------ matn --- */

/** AI javobidagi Markdown → Telegram HTML (qalin, kod, ro‘yxat, sarlavha, jadval). */
export function markdownToTelegramHtml(markdown: string) {
  const inline = (line: string) =>
    esc(line)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/__(.+?)__/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  const out: string[] = [];
  for (const raw of markdown.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*\|?\s*:?-{2,}/.test(line) && line.includes("-") && /^[\s|:-]+$/.test(line)) continue;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).filter(Boolean);
      out.push(`• ${cells.map(inline).join(" · ")}`);
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      out.push(`<b>${inline(heading[1]).replace(/<\/?b>/g, "")}</b>`);
      continue;
    }
    out.push(inline(line.replace(/^(\s*)[-*]\s+/, "$1• ")));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Karta → matn (vidjet ochilmaydigan qurilmalar va eski ilovalar uchun). */
export function cardToTelegramHtml(card: AiCard) {
  const head = `<b>${esc(card.title)}</b>${card.subtitle ? ` · ${esc(card.subtitle)}` : ""}`;
  if (card.kind === "stats") return [head, ...card.items.map((i) => `${esc(i.label)}: <b>${esc(i.value)}</b>`)].join("\n");
  if (card.kind === "profile")
    return [head, ...(card.status ? [`● ${esc(card.status.text)}`] : []), "", ...card.fields.map((f) => `${esc(f.label)}: <b>${esc(f.value)}</b>`)].join("\n");
  const rows = card.rows.slice(0, 15).map((row) => `• <b>${esc(row[0])}</b>${row.length > 1 ? ` — ${row.slice(1).map(esc).join(" · ")}` : ""}`);
  return [head, `<i>${card.columns.map(esc).join(" · ")}</i>`, ...rows, ...(card.rows.length > 15 || card.more ? [`…va yana ${card.rows.length - 15 + (card.more || 0)} ta`] : [])].join("\n");
}

/* ---------------------------------------------------------- vidjet --- */

const TONE: Record<AiTone, [string, string]> = {
  green: ["#16a34a", "rgba(22,163,74,.12)"],
  amber: ["#d97706", "rgba(217,119,6,.13)"],
  red: ["#dc2626", "rgba(220,38,38,.12)"],
  blue: ["#2563eb", "rgba(37,99,235,.11)"],
  gray: ["#64748b", "rgba(100,116,139,.12)"],
};

/**
 * Xabar ichidagi vidjet (Bot API 10.4 sendWidget): tashqi fayl yuklanmaydi, hammasi ichida.
 * Minimal, oq/qora mavzuga moslashadi; balandlik ~560px dan oshmasin (12 qatorgacha).
 */
export function cardWidgetHtml(card: AiCard) {
  const pill = (text: string, tone: AiTone) => `<span class="p" style="color:${TONE[tone][0]};background:${TONE[tone][1]}">${esc(text)}</span>`;
  let body = "";
  if (card.kind === "stats")
    body = `<div class="g">${card.items
      .slice(0, 9)
      .map((i) => `<div class="s"><small>${esc(i.label)}</small><b style="color:${i.tone && i.tone !== "gray" ? TONE[i.tone][0] : "inherit"}">${esc(i.value)}</b></div>`)
      .join("")}</div>`;
  else if (card.kind === "profile")
    body = `<div class="h"><div class="av">${esc(card.initials || "?")}</div><div class="t"><b>${esc(card.title)}</b>${card.subtitle ? `<small>${esc(card.subtitle)}</small>` : ""}</div></div>${
      card.status ? `<div class="st">${pill(card.status.text, card.status.tone)}</div>` : ""
    }${card.fields
      .slice(0, 10)
      .map((f) => `<div class="r"><small>${esc(f.label)}</small><span>${esc(f.value)}</span></div>`)
      .join("")}`;
  else {
    const rows = card.rows.slice(0, 12);
    const rest = card.rows.length - rows.length + (card.more || 0);
    body = `<table><tr>${card.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>${rows
      .map((row) => `<tr>${row.map((cell, i) => `<td${i === 0 ? ' class="n"' : ""}>${esc(cell)}</td>`).join("")}</tr>`)
      .join("")}</table>${rest > 0 ? `<small class="m">va yana ${rest} ta</small>` : ""}`;
  }
  const head = card.kind === "profile" ? "" : `<div class="hd"><b>${esc(card.title)}</b>${card.subtitle ? `<small>${esc(card.subtitle)}</small>` : ""}</div>`;
  const css =
    ":root{--i:#0f172a;--m:#64748b;--l:#e5e7eb;--c:#fff;--s:#f3f4f6}body.d{--i:#f1f5f9;--m:#94a3b8;--l:#2a3441;--c:#17212b;--s:#232e3c}" +
    "*{box-sizing:border-box;margin:0;padding:0}body{font:14px/1.4 -apple-system,system-ui,Roboto,Segoe UI,sans-serif;color:var(--i);background:var(--c);padding:12px 12px 10px}" +
    "small{display:block;color:var(--m);font-size:12px}.hd{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:8px}.hd b{font-size:15px}" +
    ".g{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.s{padding:8px;border-radius:10px;background:var(--s)}.s b{display:block;font-size:19px;font-variant-numeric:tabular-nums}" +
    "table{width:100%;border-collapse:collapse;font-size:12.5px}th{color:var(--m);font-weight:600;text-align:left;padding:0 4px 5px}td{padding:6px 4px;border-top:1px solid var(--l);font-variant-numeric:tabular-nums}td.n{font-weight:600}" +
    ".m{margin-top:6px}.h{display:flex;gap:10px;align-items:center}.av{width:42px;height:42px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(37,99,235,.12);color:#2563eb;font-weight:700}" +
    ".t b{display:block;font-size:16px}.st{margin:8px 0 4px}.p{display:inline-block;padding:3px 9px;border-radius:99px;font-size:12px;font-weight:600}" +
    ".r{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px solid var(--l)}.r span{text-align:right;font-weight:500}.r small{flex:none}";
  const js =
    "try{var W=window.TelegramWidget;var f=function(){document.body.className=W&&W.colorScheme==='dark'?'d':''};f();if(W&&W.onEvent)W.onEvent('themeChanged',f)}catch(e){}";
  return `<style>${css}</style>${head}${body}<script>${js}</script>`;
}

/* --------------------------------------------------------- tugmalar --- */

export function keyboardFor(result: Pick<ChatResult, "message" | "pendingAction">): Keyboard | undefined {
  const rows: Button[][] = [];
  const pending = result.pendingAction as { id?: string } | null;
  if (pending?.id)
    rows.push([
      { text: "✅ Tasdiqlash", callback_data: `ai:ok:${pending.id}`, style: "success" },
      { text: "Bekor qilish", callback_data: `ai:no:${pending.id}`, style: "danger" },
    ]);
  const suggestions = (result.message as { suggestions?: AiSuggestion[] }).suggestions || [];
  const people = suggestions.filter((s) => s.key?.startsWith("e:"));
  const quick = suggestions.filter((s) => s.key?.startsWith("k:"));
  for (const s of people.slice(0, 6)) rows.push([{ text: `👤 ${s.label}`.slice(0, 60), callback_data: `ai:${s.key}`.slice(0, 64) }]);
  for (let i = 0; i < Math.min(quick.length, 6); i += 3) rows.push(quick.slice(i, i + 3).map((s) => ({ text: s.label, callback_data: `ai:${s.key}` })));
  const card = (result.message as { card?: AiCard }).card;
  if (card?.kind === "profile" && card.link && appUrl()) rows.push([{ text: "Panelda ochish", url: `${appUrl()}${card.link}` }]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

/* --------------------------------------------------------- yuborish --- */

async function sendHtml(token: string, chatId: string, html: string, reply_markup?: Keyboard) {
  const text = html.length > 4000 ? `${html.replace(/<[^>]+>/g, "").slice(0, 3990)}…` : html;
  try {
    return await telegramCall(token, "sendMessage", { chat_id: chatId, text, parse_mode: html.length > 4000 ? undefined : "HTML", link_preview_options: { is_disabled: true }, reply_markup });
  } catch {
    // Formatlash xatosi bo‘lsa — oddiy matn.
    return telegramCall(token, "sendMessage", { chat_id: chatId, text: text.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"), reply_markup });
  }
}

/** AI javobini Telegram’ga yuboradi: karta bo‘lsa — vidjet, bo‘lmasa — formatlangan xabar. */
export async function sendAiReply(target: TgAiTarget, result: Pick<ChatResult, "message" | "pendingAction">) {
  const message = result.message as { text: string; card?: AiCard };
  const reply_markup = keyboardFor(result);
  const html = markdownToTelegramHtml(message.text);
  if (message.card && widgetsOn()) {
    const caption = html.split("\n")[0].slice(0, 900);
    try {
      await telegramCall(target.token, "sendWidget", { chat_id: target.chatId, html: cardWidgetHtml(message.card), caption, parse_mode: "HTML", reply_markup });
      return;
    } catch {
      /* vidjet qo‘llanmasa — oddiy xabar */
    }
  }
  await sendHtml(target.token, target.chatId, message.card ? cardToTelegramHtml(message.card) : html, reply_markup);
}

/** «O‘ylayapman…» — javob tayyorlanguncha (shaxsiy chatda qoralama, aks holda «yozmoqda»). */
async function thinking(target: TgAiTarget) {
  const draftId = 1 + Math.floor(Math.random() * 2_000_000_000);
  await telegramCall(target.token, "sendMessageDraft", { chat_id: Number(target.chatId) || target.chatId, draft_id: draftId, text: "" }).catch(() =>
    telegramCall(target.token, "sendChatAction", { chat_id: target.chatId, action: "typing" }).catch(() => undefined),
  );
}

async function latestConversation(target: TgAiTarget) {
  const db = await readDb();
  return db.aiConversations
    .filter((x) => x.companyId === target.companyId && x.userId === target.user.id && x.channel === "TELEGRAM" && x.telegramChatId === target.chatId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** Foydalanuvchi yozgan matn → AI javobi (sayt bilan bir xil dvigatel). */
export async function handleTelegramAiText(target: TgAiTarget, text: string) {
  try {
    await thinking(target);
    const existing = await latestConversation(target);
    const result = await processChat(reqOf(target), text.slice(0, 4000), existing?.id, "TELEGRAM");
    if (!existing || existing.id !== result.conversationId)
      await updateDb((next) => {
        const conversation = next.aiConversations.find((row) => row.id === result.conversationId);
        if (conversation) conversation.telegramChatId = target.chatId;
      });
    await sendAiReply(target, result);
  } catch (error) {
    await telegramCall(target.token, "sendMessage", {
      chat_id: target.chatId,
      text: `⚠️ Staffora AI: ${error instanceof Error ? error.message.slice(0, 240) : "so‘rov bajarilmadi"}`,
    }).catch(() => undefined);
  }
}

/** Salomlashish va tezkor tugmalar (/start, /ai). */
export async function sendAiWelcome(target: TgAiTarget, lead = "") {
  const first = target.user.name.split(" ")[0] || "";
  const keys: AiQuickKey[] = ["today", "late", "absent", "branches", "week", "rank", "leave", "schedules"];
  const buttons = quickFor({ role: target.user.role }, keys);
  const rows: Button[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2).map((s) => ({ text: s.label, callback_data: `ai:${s.key}` })));
  const text = [
    lead ? `<b>${esc(lead)}</b>\n` : "",
    `Assalomu alaykum${first ? `, ${esc(first)}` : ""}! Men <b>Staffora AI</b>.`,
    "Savol yozing yoki tugmani bosing — javob bazadagi real ma’lumotdan.",
    "",
    "<b>Xodim qidirish:</b> “Ali Valiyev bormi?”, “ID 001”, “+998 90 123 45 67”",
    "<b>Buyruq:</b> “ID 001 bugun 08:30 da keldi” — tasdiqlagandan keyin bajariladi.",
  ]
    .filter((line, i) => line || i > 0)
    .join("\n");
  await sendHtml(target.token, target.chatId, text, rows.length ? { inline_keyboard: rows } : undefined);
}

/**
 * Tugma bosildi. `true` — AI tugmasi edi (ishlov berildi). Tasdiqlash tokeni Telegram’da talab
 * qilinmaydi: tugmani faqat shu suhbatdagi, panelga ulangan foydalanuvchi bosa oladi va amal unga tegishli.
 */
export async function handleTelegramAiCallback(target: TgAiTarget, callback: { id: string; data: string; messageId?: number }) {
  const [, kind, ...rest] = callback.data.split(":");
  const value = rest.join(":");
  const answer = (text?: string, alert = false) =>
    telegramCall(target.token, "answerCallbackQuery", { callback_query_id: callback.id, ...(text ? { text: text.slice(0, 190), show_alert: alert } : {}) }).catch(() => undefined);
  const dropButtons = () =>
    callback.messageId
      ? telegramCall(target.token, "editMessageReplyMarkup", { chat_id: target.chatId, message_id: callback.messageId, reply_markup: { inline_keyboard: [] } }).catch(() => undefined)
      : Promise.resolve(undefined);

  if (kind === "ok" || kind === "no") {
    try {
      if (kind === "ok") {
        const action = await confirmStagedAction(reqOf(target), value, null);
        await answer("Bajarildi");
        await dropButtons();
        await sendHtml(target.token, target.chatId, `✅ ${esc(actionResultMessage(action.result))}`);
      } else {
        await cancelStagedAction(reqOf(target), value);
        await answer("Bekor qilindi");
        await dropButtons();
        await sendHtml(target.token, target.chatId, "Bekor qilindi — bazaga hech narsa yozilmadi.");
      }
    } catch (error) {
      await answer(error instanceof Error ? error.message : "Amal bajarilmadi", true);
      await dropButtons();
    }
    return true;
  }
  if (kind === "k" && value in AI_QUICK) {
    await answer();
    await handleTelegramAiText(target, AI_QUICK[value as AiQuickKey].prompt);
    return true;
  }
  if (kind === "e" && value) {
    const db = await readDb();
    const employee = db.employees.find((e) => e.companyId === target.companyId && e.id === value);
    if (!employee) {
      await answer("Xodim topilmadi", true);
      return true;
    }
    await answer();
    await handleTelegramAiText(target, `ID ${employee.employeeNo || employee.id}`);
    return true;
  }
  await answer();
  return false;
}
