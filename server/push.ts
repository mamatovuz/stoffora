import { readDb, updateDb } from "../lib/store";
import type { Database } from "../lib/types";

/*
 * Native ilova push xabarnomalari — Expo Push Service (iOS: APNs, Android: FCM).
 * APNs/FCM kalitlari Expo (EAS) loyihasida saqlanadi; serverga ixtiyoriy EXPO_ACCESS_TOKEN kerak
 * (Expo «Enhanced Push Security» yoqilgan bo‘lsa). Tokenlar xodim profilidan alohida jadvalda.
 *
 * Manba — mavjud Staffora bildirishnomalari: xodimga yozilgan har bir yangi notification
 * (ta’til javobi, e’lon, avans, smena, HR javobi…) push bo‘lib ham ketadi. Dispetcher
 * bildirishnomani bir marta yuboradi (pushedAt) — Telegram xabarlari avvalgidek ishlayveradi.
 */

const EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send";
type PushMessage = { title: string; body: string; data?: Record<string, string> };

const plain = (text: string) => text.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Xodimning faol push tokenlariga yuboradi. Yaroqsiz tokenlar o‘chiriladi. */
export async function pushToEmployee(employeeId: string, message: PushMessage, db?: Database) {
  const state = db || (await readDb());
  const tokens = state.mobilePushTokens.filter((t) => t.employeeId === employeeId && t.active);
  // Faqat ishonchli (faol) qurilmalardagi tokenlar.
  const live = tokens.filter((t) => state.mobileDevices.some((d) => d.id === t.deviceId && d.status === "ACTIVE"));
  if (!live.length) return 0;
  const payload = live.map((t) => ({
    to: t.token,
    title: plain(message.title).slice(0, 120),
    body: plain(message.body).slice(0, 400),
    data: message.data || {},
    sound: "default",
    priority: "high",
    channelId: "default",
  }));
  let response: Response;
  try {
    response = await fetch(EXPO_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return 0;
  }
  const json = (await response.json().catch(() => ({}))) as { data?: { status: string; message?: string; details?: { error?: string } }[] };
  const results = json.data || [];
  const invalid = new Map<string, string>();
  results.forEach((r, i) => {
    if (r.status === "error" && live[i]) invalid.set(live[i].id, r.details?.error || r.message || "error");
  });
  if (invalid.size)
    await updateDb((next) => {
      for (const token of next.mobilePushTokens) {
        const error = invalid.get(token.id);
        if (!error) continue;
        token.lastError = error;
        token.updatedAt = new Date().toISOString();
        // Ilova o‘chirilgan / token eskirgan — boshqa yuborilmaydi.
        if (error === "DeviceNotRegistered") token.active = false;
      }
    }).catch(() => undefined);
  return results.filter((r) => r.status === "ok").length;
}

/** Bildirishnoma turidan ilova ichidagi bo‘limga havola (bildirishnomani bosganda ochiladi). */
function routeFor(type: string, go?: string) {
  if (go) return go;
  if (type === "LEAVE") return "leave";
  if (type === "PAYROLL") return "salary";
  if (type === "DOCUMENT") return "docs";
  return "notifs";
}

let running = false;
/** Yangi xodim bildirishnomalarini push qiladi (har 5 soniyada; faqat push tokeni borlar uchun). */
export async function dispatchPendingPushes() {
  if (running) return;
  running = true;
  try {
    const db = await readDb();
    const withTokens = new Set(db.mobilePushTokens.filter((t) => t.active).map((t) => t.employeeId));
    if (!withTokens.size) return;
    // Faqat yaqinda yaratilgan (10 daqiqa) — eski bildirishnomalar push bo‘lib kelmasin.
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const pending = db.notifications.filter((n) => n.employeeId && !n.pushedAt && n.createdAt >= since && withTokens.has(n.employeeId)).slice(0, 100);
    if (!pending.length) return;
    const now = new Date().toISOString();
    await updateDb((next) => {
      const ids = new Set(pending.map((n) => n.id));
      for (const n of next.notifications) if (ids.has(n.id)) n.pushedAt = now;
    });
    for (const n of pending)
      await pushToEmployee(n.employeeId!, { title: n.title.replace(/^📢\s*/, "📢 "), body: n.body, data: { go: routeFor(n.type, n.go), notificationId: n.id } }, db).catch(() => 0);
  } catch (error) {
    console.error("Push dispetcheri xatosi", error);
  } finally {
    running = false;
  }
}

export function startPushDispatcher() {
  if (process.env.MOBILE_PUSH === "false") return;
  setInterval(() => void dispatchPendingPushes(), 5_000).unref();
}
