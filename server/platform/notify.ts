import { randomUUID } from "node:crypto";
import { opsStore, readDb, updateDb } from "../../lib/store";
import type { Company, Database } from "../../lib/types";
import { LEADER_ROLES, type NotificationAudience, type PlatformChannel, type PlatformNotification } from "../../lib/platform/types";
import { daysLeft } from "../../lib/platform/subscriptions";
import { platformCan, type PlatformPermission } from "../../lib/platform/permissions";
import { maskSecrets } from "../../lib/platform/security";
import { sendTelegramMessage } from "../telegram";

/*
 * Bildirishnomalar dvigateli (platforma → kompaniyalar va administratorlar).
 *   • yetkazish navbati — platform_deliveries (dedupe_key noyob: bitta xabar bir oluvchiga ikki marta ketmaydi);
 *   • IN_APP — kompaniya panelidagi bildirishnomalar (db.notifications, xodimga emas);
 *   • TELEGRAM — faqat botni boshlagan (telegramId ulangan) foydalanuvchilarga; aks holda SKIPPED, majburlanmaydi;
 *   • tezlik cheklovi: har siklda ko‘pi bilan 25 ta, Telegram yuborishi o‘zi ham navbatlangan (telegram.ts);
 *   • xato — qayta urinish (4 martagacha, kechikish bilan); bloklagan/boshlamagan — qayta urinilmaydi.
 */

type RawDelivery = {
  id: string;
  notification_id: string;
  company_id: string | null;
  user_id: string | null;
  recipient: string;
  channel: PlatformChannel;
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED" | "CANCELLED";
  attempts: number;
  error: string | null;
  message: string | null;
  dedupe_key: string;
  next_attempt_at: string;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
};

const liveCompany = (c: Company) => !c.demo && !c.archive;

/** Auditoriya: kompaniyalar va ularning rahbarlari (bloklanmagan panel foydalanuvchilari). */
export function resolveAudience(db: Database, audience: NotificationAudience, now = new Date().toISOString()) {
  let companies: Company[];
  switch (audience.type) {
    case "COMPANY":
    case "COMPANIES":
      companies = db.companies.filter((c) => audience.companyIds?.includes(c.id) && !c.archive);
      break;
    case "PLAN":
      companies = db.companies.filter((c) => liveCompany(c) && c.subscription && audience.planIds?.includes(c.subscription.planId));
      break;
    case "EXPIRING": {
      const days = Math.max(1, Math.min(365, audience.days || 7));
      companies = db.companies.filter((c) => {
        if (!liveCompany(c) || !c.subscription) return false;
        const left = daysLeft(c.subscription, now);
        return left !== null && left >= 0 && left <= days;
      });
      break;
    }
    default:
      companies = db.companies.filter(liveCompany);
  }
  const ids = new Set(companies.map((c) => c.id));
  const roles = audience.type === "OWNERS" || audience.ownersOnly ? ["COMPANY_OWNER"] : LEADER_ROLES;
  const users = db.users.filter((u) => u.companyId && ids.has(u.companyId) && roles.includes(u.role) && !u.blockedAt);
  return { companies, users };
}

async function insertDelivery(row: { notificationId: string; companyId?: string | null; userId?: string | null; recipient: string; channel: PlatformChannel; dedupeKey: string; message?: string; status?: RawDelivery["status"]; error?: string }) {
  const store = await opsStore();
  const now = new Date().toISOString();
  return store.run(
    "INSERT OR IGNORE INTO platform_deliveries (id, notification_id, company_id, user_id, recipient, channel, status, attempts, error, message, dedupe_key, next_attempt_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [randomUUID(), row.notificationId, row.companyId || null, row.userId || null, row.recipient, row.channel, row.status || "PENDING", 0, row.error || null, row.message || null, row.dedupeKey, now, now, now],
  );
}

/** Bildirishnomani navbatga qo‘yadi: oluvchilar ro‘yxati shu paytdagi holat bo‘yicha. */
export async function queueNotification(notification: PlatformNotification) {
  const db = await readDb();
  const { companies, users } = resolveAudience(db, notification.audience);
  let total = 0;
  if (notification.channels.includes("IN_APP"))
    for (const company of companies) {
      total += 1;
      await insertDelivery({ notificationId: notification.id, companyId: company.id, recipient: company.name, channel: "IN_APP", dedupeKey: `${notification.id}:IN_APP:${company.id}` });
    }
  if (notification.channels.includes("TELEGRAM"))
    for (const user of users) {
      total += 1;
      await insertDelivery({
        notificationId: notification.id,
        companyId: user.companyId,
        userId: user.id,
        recipient: user.name,
        channel: "TELEGRAM",
        dedupeKey: `${notification.id}:TELEGRAM:${user.id}`,
        ...(user.telegramId ? {} : { status: "SKIPPED" as const, error: "Telegram ulanmagan (botni boshlamagan)" }),
      });
    }
  await refreshNotificationStats([notification.id]);
  void dispatchDeliveries();
  return total;
}

/** Kompaniya rahbarlariga tizim xabari (masalan, tarif muddati). key — takror yuborilmaslik uchun. */
export async function notifyCompanyLeaders(db: Database, companyId: string, input: { key: string; title: string; body: string; ownersOnly?: boolean; channels?: PlatformChannel[] }) {
  const channels = input.channels || ["IN_APP", "TELEGRAM"];
  const message = JSON.stringify({ title: input.title, body: input.body });
  const company = db.companies.find((c) => c.id === companyId);
  if (!company) return 0;
  let count = 0;
  if (channels.includes("IN_APP")) count += await insertDelivery({ notificationId: `system:${input.key}`, companyId, recipient: company.name, channel: "IN_APP", dedupeKey: `${input.key}:IN_APP:${companyId}`, message });
  if (channels.includes("TELEGRAM"))
    for (const user of db.users.filter((u) => u.companyId === companyId && !u.blockedAt && (input.ownersOnly ? u.role === "COMPANY_OWNER" : LEADER_ROLES.includes(u.role)) && u.telegramId))
      count += await insertDelivery({ notificationId: `system:${input.key}`, companyId, userId: user.id, recipient: user.name, channel: "TELEGRAM", dedupeKey: `${input.key}:TELEGRAM:${user.id}`, message });
  void dispatchDeliveries();
  return count;
}

/** Bitta panel foydalanuvchisiga Telegram xabari (masalan, murojaatga javob). Telegram ulanmagan bo‘lsa — yuborilmaydi. */
export async function notifyPanelUser(db: Database, userId: string, input: { key: string; title: string; body: string }) {
  const user = db.users.find((u) => u.id === userId);
  if (!user?.telegramId || user.blockedAt) return 0;
  const count = await insertDelivery({
    notificationId: `system:${input.key}`,
    companyId: user.companyId,
    userId: user.id,
    recipient: user.name,
    channel: "TELEGRAM",
    dedupeKey: `${input.key}:TELEGRAM:${user.id}`,
    message: JSON.stringify({ title: input.title, body: input.body }),
  });
  void dispatchDeliveries();
  return count;
}

/**
 * Platforma administratorlariga Telegram ogohlantirishi (incident, yangi murojaat, onboarding).
 * Global sozlamada yoqilgan bo‘lsa va administrator Telegram’ni ulagan bo‘lsa. cooldown oynasida takrorlanmaydi.
 */
export async function notifyAdmins(input: { key: string; text: string; permission: PlatformPermission; cooldownMinutes?: number }) {
  const db = await readDb();
  if (!db.platformSettings?.notifications?.adminTelegram) return 0;
  const window = Math.floor(Date.now() / (Math.max(1, input.cooldownMinutes ?? 30) * 60_000));
  const message = JSON.stringify({ title: "Staffora platforma", body: input.text });
  let count = 0;
  for (const admin of db.users.filter((u) => u.role === "SUPER_ADMIN" && !u.blockedAt && u.telegramId && platformCan(u.platformRole, input.permission)))
    count += await insertDelivery({ notificationId: `alert:${input.key}`, userId: admin.id, recipient: admin.name, channel: "TELEGRAM", dedupeKey: `alert:${input.key}:${admin.id}:${window}`, message });
  void dispatchDeliveries();
  return count;
}

const backoff = (attempt: number) => Math.min(60 * 60_000, 60_000 * 2 ** attempt);
let dispatching = false;

/** Navbatdagi yetkazishlarni bajaradi (har bir siklda ko‘pi bilan 25 ta). */
export async function dispatchDeliveries() {
  if (dispatching) return 0;
  dispatching = true;
  let done = 0;
  const touched = new Set<string>();
  try {
    const store = await opsStore();
    const due = await store.all<RawDelivery>("SELECT * FROM platform_deliveries WHERE status = 'PENDING' AND next_attempt_at <= ? ORDER BY created_at LIMIT 25", [new Date().toISOString()]);
    if (!due.length) return 0;
    const db = await readDb();
    for (const row of due) {
      const notification = db.platformNotifications.find((n) => n.id === row.notification_id);
      if (notification?.status === "CANCELLED") {
        await store.run("UPDATE platform_deliveries SET status = 'CANCELLED', updated_at = ? WHERE id = ?", [new Date().toISOString(), row.id]);
        touched.add(row.notification_id);
        continue;
      }
      const content = row.message ? (JSON.parse(row.message) as { title: string; body: string }) : notification ? { title: notification.title, body: notification.body } : null;
      if (!content) {
        await store.run("UPDATE platform_deliveries SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?", ["Xabar topilmadi", new Date().toISOString(), row.id]);
        continue;
      }
      try {
        if (row.channel === "IN_APP") {
          await updateDb((next) => {
            if (!row.company_id || !next.companies.some((c) => c.id === row.company_id)) throw new Error("Kompaniya topilmadi");
            next.notifications.unshift({ id: row.id, companyId: row.company_id, title: content.title.slice(0, 200), body: content.body.slice(0, 4000), type: "PLATFORM", read: false, createdAt: new Date().toISOString() });
          });
          await store.run("UPDATE platform_deliveries SET status = 'SENT', sent_at = ?, updated_at = ?, attempts = attempts + 1 WHERE id = ?", [new Date().toISOString(), new Date().toISOString(), row.id]);
        } else {
          const user = db.users.find((u) => u.id === row.user_id);
          if (!user?.telegramId || user.blockedAt) {
            await store.run("UPDATE platform_deliveries SET status = 'SKIPPED', error = ?, updated_at = ? WHERE id = ?", ["Telegram ulanmagan yoki hisob bloklangan", new Date().toISOString(), row.id]);
          } else {
            const ok = await sendTelegramMessage(user.telegramId, `<b>${escapeHtml(content.title)}</b>\n\n${escapeHtml(content.body)}`);
            const at = new Date().toISOString();
            if (ok) await store.run("UPDATE platform_deliveries SET status = 'SENT', sent_at = ?, updated_at = ?, attempts = attempts + 1, error = NULL WHERE id = ?", [at, at, row.id]);
            // Bloklagan yoki botni boshlamagan — qayta urinish befoyda.
            else await store.run("UPDATE platform_deliveries SET status = 'FAILED', error = 'Bot bloklangan yoki boshlanmagan', updated_at = ?, attempts = attempts + 1 WHERE id = ?", [at, row.id]);
          }
        }
        done += 1;
      } catch (error) {
        const attempts = Number(row.attempts) + 1;
        const message = maskSecrets(error instanceof Error ? error.message : String(error), 500);
        await store.run(
          attempts >= 4
            ? "UPDATE platform_deliveries SET status = 'FAILED', attempts = ?, error = ?, updated_at = ? WHERE id = ?"
            : "UPDATE platform_deliveries SET attempts = ?, error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?",
          attempts >= 4 ? [attempts, message, new Date().toISOString(), row.id] : [attempts, message, new Date(Date.now() + backoff(attempts)).toISOString(), new Date().toISOString(), row.id],
        );
      }
      touched.add(row.notification_id);
    }
  } catch (error) {
    console.error("Bildirishnomalarni yetkazishda xato", error);
  } finally {
    dispatching = false;
    if (touched.size) await refreshNotificationStats([...touched]).catch(() => undefined);
  }
  return done;
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Bildirishnoma statistikasi va yakuniy holat (yetkazishlar bo‘yicha). */
export async function refreshNotificationStats(ids: string[]) {
  const real = ids.filter((id) => !id.startsWith("system:") && !id.startsWith("alert:"));
  if (!real.length) return;
  const store = await opsStore();
  const stats = new Map<string, NonNullable<PlatformNotification["stats"]>>();
  for (const id of real) {
    const rows = await store.all<{ status: string; n: number | string }>("SELECT status, COUNT(*) AS n FROM platform_deliveries WHERE notification_id = ? GROUP BY status", [id]);
    const count = (s: string) => Number(rows.find((r) => r.status === s)?.n || 0);
    const total = rows.reduce((s, r) => s + Number(r.n), 0);
    stats.set(id, { total, sent: count("SENT"), failed: count("FAILED"), skipped: count("SKIPPED"), pending: count("PENDING") });
  }
  await updateDb((db) => {
    for (const notification of db.platformNotifications) {
      const s = stats.get(notification.id);
      if (!s) continue;
      notification.stats = s;
      if (["QUEUED", "SENDING"].includes(notification.status)) {
        if (s.pending > 0) notification.status = "SENDING";
        else {
          notification.status = s.failed > 0 ? (s.sent > 0 ? "PARTIAL" : "FAILED") : "SENT";
          notification.sentAt ||= new Date().toISOString();
        }
        notification.updatedAt = new Date().toISOString();
      }
    }
  });
}

export async function listDeliveries(notificationId: string, status: string | undefined, limit: number, offset: number) {
  const store = await opsStore();
  const params: unknown[] = [notificationId];
  let where = "WHERE notification_id = ?";
  if (status) {
    where += " AND status = ?";
    params.push(status);
  }
  const rows = await store.all<RawDelivery>(`SELECT * FROM platform_deliveries ${where} ORDER BY created_at LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const total = Number((await store.all<{ n: number | string }>(`SELECT COUNT(*) AS n FROM platform_deliveries ${where}`, params))[0]?.n || 0);
  return {
    total,
    rows: rows.map((r) => ({ id: r.id, companyId: r.company_id, userId: r.user_id, recipient: r.recipient, channel: r.channel, status: r.status, attempts: Number(r.attempts), error: r.error, sentAt: r.sent_at, updatedAt: r.updated_at })),
  };
}

/** Muvaffaqiyatsiz yetkazishlarni qayta navbatga qo‘yadi (SKIPPED — Telegram ulanmaganlar qayta urinilmaydi). */
export async function retryFailedDeliveries(notificationId: string) {
  const store = await opsStore();
  const now = new Date().toISOString();
  const count = await store.run("UPDATE platform_deliveries SET status = 'PENDING', attempts = 0, next_attempt_at = ?, updated_at = ? WHERE notification_id = ? AND status = 'FAILED'", [now, now, notificationId]);
  if (count) {
    await updateDb((db) => {
      const n = db.platformNotifications.find((x) => x.id === notificationId);
      if (n) n.status = "SENDING";
    });
    void dispatchDeliveries();
  }
  return count;
}

/** Rejalashtirilgan bildirishnomalar vaqti kelganda navbatga qo‘yiladi. */
export async function releaseScheduled() {
  const now = new Date().toISOString();
  const due = await updateDb((db) => {
    const list = db.platformNotifications.filter((n) => n.status === "SCHEDULED" && n.scheduledAt && n.scheduledAt <= now);
    for (const n of list) {
      n.status = "QUEUED";
      n.updatedAt = now;
    }
    return list.map((n) => ({ ...n }));
  });
  for (const n of due) await queueNotification(n);
  return due.length;
}

export async function purgeDeliveries(beforeIso: string) {
  const store = await opsStore();
  return store.run("DELETE FROM platform_deliveries WHERE created_at < ? AND status <> 'PENDING'", [beforeIso]);
}
