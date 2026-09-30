import { readDb, updateDb } from "../../lib/store";
import type { Integration } from "../../lib/types";
import { BotApiError } from "./client";
import { PROVIDER, clientFor, upsertMapping } from "./model";
import {
  completeOutbox,
  dueFailedEvents,
  dueOutbox,
  failOutbox,
  finishEvent,
  logIntegration,
  postponeOutbox,
  queuedBotDeliveries,
  recordEvent,
  setDeliveryStatus,
  touchDelivery,
  upsertDelivery,
  type OutboxJob,
} from "./sqlstore";
import {
  collectionPath,
  handleBotEvent,
  queueOutboundChanges,
  type BotEventEnvelope,
  type LocalEntity,
} from "./sync";

/*
 * Fon ishchisi (bitta jarayon ichida, bir vaqtda bitta sikl):
 *   - navbat (outbox): Staffora → bot amallari, retry + backoff, 429 da Retry-After
 *   - o‘zgarishlar lentasi (GET /integration/changes) — webhook ishlamasa ham ma’lumot yo‘qolmaydi
 *   - xato bergan hodisalarni qayta ishlash (dead-letter bilan)
 *   - eksport: Staffora'dagi o‘zgarishlarni aniqlash
 *   - bot orqali yuborilgan xabarlar va e’lonlar holatini tekshirish
 * Bot ishlamay qolsa — faqat jurnalga yoziladi, Staffora ishlashda davom etadi.
 */

let timer: NodeJS.Timeout | undefined;
let busy = false;
let tick = 0;
const lastPoll = new Map<string, number>();

export function startIntegrationWorker(intervalMs = 5_000) {
  if (timer || process.env.INTEGRATION_WORKER === "false") return;
  timer = setInterval(() => void runWorkerOnce().catch((error) => console.error("Integratsiya ishchisi xatosi", error)), intervalMs);
  timer.unref();
}

export function stopIntegrationWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

export async function runWorkerOnce(options: { force?: boolean } = {}) {
  if (busy) return;
  busy = true;
  tick += 1;
  try {
    await processOutbox();
    const db = await readDb();
    const active = db.integrations.filter((i) => i.status !== "DISCONNECTED");
    for (const integration of active) {
      const interval = integration.settings.pollIntervalSeconds;
      // Webhook bor bo‘lsa lenta faqat zaxira sifatida (kamida 5 daqiqada) tekshiriladi; 0 — faqat qo‘lda.
      const every = (integration.remoteWebhookId ? Math.max(interval || 900, 300) : interval) * 1000;
      if (options.force || (every > 0 && Date.now() - (lastPoll.get(integration.id) || 0) >= every)) {
        lastPoll.set(integration.id, Date.now());
        await pollChanges(integration.id).catch(() => undefined);
      }
      if (options.force || tick % 6 === 0) await queueOutboundChanges(integration.id).catch(() => undefined);
    }
    if (options.force || tick % 6 === 0) {
      await retryFailedEvents();
      await refreshDeliveries();
    }
    if (options.force || tick % 12 === 0) await refreshAnnouncementStats();
  } finally {
    busy = false;
  }
}

/* ------------------------------------------------------------ outbox --- */

export async function processOutbox(limit = 25) {
  const jobs = await dueOutbox(limit);
  let processed = 0;
  for (const job of jobs) {
    const db = await readDb();
    const integration = db.integrations.find((i) => i.id === job.integrationId && i.companyId === job.companyId);
    if (!integration || integration.status === "DISCONNECTED") {
      await postponeOutbox(job.id, 3600_000);
      continue;
    }
    try {
      const result = await executeOutbox(integration, job);
      await completeOutbox(job.id, result);
      processed += 1;
    } catch (error) {
      await handleOutboxError(integration, job, error);
      if (error instanceof BotApiError && error.status === 429) break; // limit — keyingi siklda davom
    }
  }
  return processed;
}

async function handleOutboxError(integration: Integration, job: OutboxJob, error: unknown) {
  const err = error instanceof BotApiError ? error : new BotApiError((error as Error).message || String(error), 0, "internal");
  if (err.status === 429) {
    await postponeOutbox(job.id, err.retryAfterMs ?? 30_000);
    return;
  }
  const permanent = !err.transient;
  const dead = await failOutbox(job, `${err.code}: ${err.message}`, { permanent });
  if (job.kind === "notification.send" && typeof job.payload.deliveryId === "string" && (dead || permanent))
    await setDeliveryStatus(job.payload.deliveryId, "FAILED", err.message);
  await logIntegration(integration, dead ? "error" : "warn", `outbox.${job.kind}`, `${outboxLabel(job.kind)}: ${err.message}${dead ? " (to‘xtatildi)" : " (qayta uriniladi)"}`, {
    status: err.status,
    code: err.code,
    attempt: job.attempts + 1,
  });
  if (err.status === 0 || err.status >= 500)
    await updateDb((db) => {
      const current = db.integrations.find((i) => i.id === integration.id);
      if (current) {
        current.lastError = err.message;
        current.lastErrorAt = new Date().toISOString();
      }
    });
}

const outboxLabel = (kind: string) =>
  ({
    "attendance.check_in": "Kelishni botga yuborish",
    "attendance.check_out": "Ketishni botga yuborish",
    "notification.send": "Bot orqali xabar",
    "external_id.link": "Tashqi ID bog‘lash",
  })[kind] || `Botga yuborish (${kind})`;

async function executeOutbox(integration: Integration, job: OutboxJob) {
  const client = clientFor(integration);
  const payload = job.payload;
  switch (job.kind) {
    case "attendance.check_in":
    case "attendance.check_out": {
      const path = job.kind === "attendance.check_in" ? "/attendance/check-in" : "/attendance/check-out";
      const { data } = await client.request<{ id: number }>("POST", path, { body: payload.body, idempotencyKey: job.idempotencyKey });
      const attendanceId = String(payload.attendanceId || "");
      if (data?.id && attendanceId)
        await updateDb((db) => {
          const record = db.attendance.find((a) => a.id === attendanceId && a.companyId === integration.companyId);
          if (record && record.externalIds?.[PROVIDER] !== String(data.id)) {
            record.externalIds = { ...(record.externalIds || {}), [PROVIDER]: String(data.id) };
            record.updatedAt = new Date().toISOString();
          }
        });
      return { remoteId: data?.id };
    }
    case "external_id.link": {
      await client.request("PUT", "/integration/external-ids", { body: payload, idempotencyKey: job.idempotencyKey });
      await updateDb((db) => {
        const m = db.entityMappings.find(
          (x) => x.integrationId === integration.id && x.entity === payload.entity_type && x.externalId === String(payload.entity_id),
        );
        if (m) {
          const raw = { ...((m.snapshot?.raw || {}) as Record<string, unknown>) };
          raw.external_ids = { ...((raw.external_ids || {}) as Record<string, string>), staffora: String(payload.external_id) };
          m.snapshot = { ...(m.snapshot || {}), raw };
        }
      });
      return { ok: true };
    }
    case "notification.send": {
      const { data } = await client.request<{ id: number; status?: string }>("POST", "/notifications", {
        body: payload.body,
        idempotencyKey: job.idempotencyKey,
      });
      if (typeof payload.deliveryId === "string")
        await upsertDelivery({
          id: payload.deliveryId,
          companyId: integration.companyId,
          integrationId: integration.id,
          kind: (payload.kind as "ACCESS" | "NOTIFY") || "NOTIFY",
          refId: String(payload.refId || ""),
          employeeId: String(payload.employeeId || ""),
          channel: "bot",
          status: data?.status === "sent" ? "SENT" : "QUEUED",
          externalId: data?.id ? String(data.id) : undefined,
        });
      return { remoteId: data?.id };
    }
    default: {
      const [entity, action] = job.kind.split(".") as [LocalEntity, "create" | "update"];
      const base = collectionPath[entity];
      if (action === "update") {
        const { data } = await client.request<Record<string, unknown>>("PATCH", `${base}/${payload.externalId}`, {
          body: payload.body,
          idempotencyKey: job.idempotencyKey,
        });
        await updateDb((db) => {
          const m = db.entityMappings.find((x) => x.integrationId === integration.id && x.entity === entity && x.localId === payload.localId);
          if (m) m.snapshot = { fields: payload.fields as Record<string, unknown>, raw: data || m.snapshot?.raw };
        });
        return { ok: true };
      }
      let created: { id: number } & Record<string, unknown>;
      try {
        created = (await client.request<{ id: number } & Record<string, unknown>>("POST", base, { body: payload.body, idempotencyKey: job.idempotencyKey })).data;
      } catch (error) {
        // Xodim botda allaqachon bor bo‘lsa (Telegram ID bo‘yicha) — yangisini yaratmay bog‘laymiz.
        const telegramId = (payload.body as { telegram_id?: number }).telegram_id;
        if (entity === "employee" && error instanceof BotApiError && [409, 422].includes(error.status) && telegramId)
          created = (await client.get<{ id: number } & Record<string, unknown>>(`/employees/by-telegram/${telegramId}`)).data;
        else throw error;
      }
      await updateDb((db) => {
        const current = db.integrations.find((i) => i.id === integration.id)!;
        upsertMapping(db, current, entity, String(payload.localId), created.id, {
          snapshot: { fields: payload.fields as Record<string, unknown>, raw: created },
        });
      });
      await logIntegration(integration, "info", `outbox.${job.kind}`, `Botda yaratildi: ${entity} #${created.id}`);
      return { remoteId: created.id };
    }
  }
}

/* ------------------------------------------------------ o‘zgarishlar --- */

/** GET /integration/changes — kursor bilan (webhook zaxirasi). */
export async function pollChanges(integrationId: string, maxPages = 5) {
  let processed = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const db = await readDb();
    const integration = db.integrations.find((i) => i.id === integrationId);
    if (!integration || integration.status === "DISCONNECTED") return processed;
    const client = clientFor(integration);
    let result: { data: BotEventEnvelope[]; meta?: Record<string, unknown> };
    try {
      result = await client.get<BotEventEnvelope[]>("/integration/changes", { since_id: integration.cursor || 0, limit: 200 });
    } catch (error) {
      const message = (error as Error).message;
      await updateDb((next) => {
        const current = next.integrations.find((i) => i.id === integrationId);
        if (current) {
          current.lastError = message;
          current.lastErrorAt = new Date().toISOString();
          current.lastPollAt = new Date().toISOString();
        }
      });
      await logIntegration(integration, "warn", "poll.failed", `O‘zgarishlar lentasini olib bo‘lmadi: ${message}`);
      throw error;
    }
    for (const envelope of result.data || []) {
      if (await recordEvent(integrationId, String(envelope.id), String(envelope.event), "poll", JSON.stringify(envelope))) {
        await processRecordedEvent(integration, envelope);
        processed += 1;
      }
    }
    const next = Number(result.meta?.next_cursor ?? integration.cursor);
    await updateDb((db2) => {
      const current = db2.integrations.find((i) => i.id === integrationId);
      if (current) {
        if (Number.isFinite(next) && next > current.cursor) current.cursor = next;
        current.lastPollAt = new Date().toISOString();
        if (current.status === "ERROR") current.status = "CONNECTED";
        current.lastError = undefined;
      }
    });
    if (!result.meta?.has_more) break;
  }
  return processed;
}

/** Hodisani qayta ishlaydi va natijani jurnalga yozadi. */
export async function processRecordedEvent(integration: Integration, envelope: BotEventEnvelope) {
  try {
    const result = await handleBotEvent(integration.id, envelope);
    await finishEvent(integration.id, String(envelope.id), result.status, result.status === "ignored" ? result.detail : undefined);
    return result;
  } catch (error) {
    const message = (error as Error).message;
    await finishEvent(integration.id, String(envelope.id), "failed", message);
    await logIntegration(integration, "error", "event.failed", `${envelope.event} (${envelope.id}) qayta ishlanmadi: ${message}`);
    return { status: "failed" as const, detail: message };
  }
}

async function retryFailedEvents() {
  const rows = await dueFailedEvents();
  if (!rows.length) return;
  const db = await readDb();
  for (const row of rows) {
    const integration = db.integrations.find((i) => i.id === row.integration_id);
    if (!integration || integration.status === "DISCONNECTED") continue;
    await processRecordedEvent(integration, JSON.parse(row.payload));
  }
}

/* ------------------------------------------------ yetkazish holatlari --- */

async function refreshDeliveries() {
  const rows = await queuedBotDeliveries(40);
  if (!rows.length) return;
  const db = await readDb();
  for (const row of rows) {
    const integration = db.integrations.find((i) => i.id === row.integrationId);
    if (!integration || integration.status === "DISCONNECTED") continue;
    try {
      const { data } = await clientFor(integration).get<{ status: string; error?: string }>(`/notifications/${row.externalId}`);
      if (data.status === "sent") await setDeliveryStatus(row.id, "SENT");
      else if (data.status === "failed") await setDeliveryStatus(row.id, "FAILED", data.error || "Telegram xabarni qabul qilmadi");
      else if (Date.now() - Date.parse(row.createdAt) > 24 * 3600_000)
        await setDeliveryStatus(row.id, "FAILED", "Bot 24 soat ichida yubormadi");
      else await touchDelivery(row.id);
    } catch (error) {
      if (error instanceof BotApiError && error.status === 429) return;
      await touchDelivery(row.id);
    }
  }
}

async function refreshAnnouncementStats() {
  const db = await readDb();
  const since = Date.now() - 48 * 3600_000;
  const targets = db.announcements.filter(
    (a) => a.report?.bot?.externalId && Date.parse(a.scheduledAt) > since && a.report.bot.status !== "FAILED",
  );
  for (const announcement of targets) {
    const bot = announcement.report!.bot!;
    const integration = db.integrations.find((i) => i.id === bot.integrationId && i.companyId === announcement.companyId);
    if (!integration || integration.status === "DISCONNECTED") continue;
    try {
      const { data } = await clientFor(integration).get<{ status: string; stats?: { recipients: number; sent: number; failed: number; acknowledged: number } }>(
        `/announcements/${bot.externalId}`,
      );
      await updateDb((next) => {
        const row = next.announcements.find((a) => a.id === announcement.id);
        if (!row?.report?.bot) return;
        const stats = data.stats || { recipients: bot.recipients, sent: 0, failed: 0, acknowledged: 0 };
        row.report.bot = {
          ...row.report.bot,
          recipients: stats.recipients,
          sent: stats.sent,
          failed: stats.failed,
          acknowledged: stats.acknowledged,
          status: data.status === "sent" ? (stats.failed ? "PARTIAL" : "SENT") : data.status === "failed" ? "FAILED" : "QUEUED",
          checkedAt: new Date().toISOString(),
        };
      });
    } catch (error) {
      if (error instanceof BotApiError && error.status === 429) return;
    }
  }
}

