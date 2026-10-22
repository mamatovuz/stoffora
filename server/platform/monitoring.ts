import { randomUUID } from "node:crypto";
import { checkDatabaseHealth, databaseStatus, opsStore, readDb, updateDb } from "../../lib/store";
import type { IncidentSeverity, PlatformIncident } from "../../lib/platform/types";
import { getTelegramBotState } from "../telegram";
import { processStats, recentMinutes } from "./telemetry";
import { workerStates } from "./jobs";
import { notifyAdmins } from "./notify";
import { failedLoginsByIp } from "./security-events";

/*
 * Monitoring markazi: barcha qiymatlar haqiqiy (shu server jarayoni, baza, Telegram API holati).
 * Railway/Supabase monitoring API’lari uchun hisob ma’lumotlari bo‘lmasa — «Not configured» ko‘rsatiladi,
 * soxta CPU/RAM/DB qiymatlari yaratilmaydi.
 *
 * Avtomatik muammolarni aniqlash (qoidalar): har daqiqada baholanadi; bir qoida — bitta ochiq incident (dedupe),
 * holat yaxshilansa avtomatik «RESOLVED»; administratorlarga xabar cooldown bilan.
 */

export type CheckStatus = "OK" | "WARN" | "DOWN" | "NOT_CONFIGURED";
export type HealthCheck = { key: string; label: string; status: CheckStatus; detail: string; latencyMs?: number };

let webhookCache: { at: number; value: { url?: string; pending?: number; lastError?: string; lastErrorAt?: string } | null } | undefined;
/** Telegram getWebhookInfo — server tomonda, tokenni frontendga bermasdan (5 daqiqalik kesh). */
async function telegramWebhookInfo() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return null;
  if (webhookCache && Date.now() - webhookCache.at < 5 * 60_000) return webhookCache.value;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: controller.signal });
    clearTimeout(timer);
    const body = (await res.json()) as { ok: boolean; result?: { url?: string; pending_update_count?: number; last_error_message?: string; last_error_date?: number } };
    const value = body.ok
      ? {
          url: body.result?.url ? body.result.url.replace(/\/\/([^/]+)\/.*/, "//$1/…") : undefined,
          pending: body.result?.pending_update_count,
          lastError: body.result?.last_error_message,
          lastErrorAt: body.result?.last_error_date ? new Date(body.result.last_error_date * 1000).toISOString() : undefined,
        }
      : null;
    webhookCache = { at: Date.now(), value };
    return value;
  } catch {
    webhookCache = { at: Date.now(), value: null };
    return null;
  }
}

export async function runHealthChecks(): Promise<{ overall: CheckStatus; checks: HealthCheck[] }> {
  const checks: HealthCheck[] = [];
  checks.push({ key: "backend", label: "Backend (API)", status: "OK", detail: `Ishlayapti · ${Math.round(process.uptime() / 60)} daqiqadan beri` });

  const started = Date.now();
  let dbOk = false;
  try {
    dbOk = await checkDatabaseHealth();
  } catch {
    dbOk = false;
  }
  const status = databaseStatus();
  checks.push({ key: "database", label: `Ma’lumotlar bazasi (${status.kind})`, status: dbOk ? "OK" : "DOWN", detail: dbOk ? "Ulanish va tekshiruv muvaffaqiyatli" : "Bazaga ulanib bo‘lmadi", latencyMs: Date.now() - started });

  const store = await opsStore();
  const pool = store.poolStats?.();
  checks.push(
    pool
      ? { key: "pool", label: "Ulanishlar havzasi", status: pool.waiting > 0 ? "WARN" : "OK", detail: `${pool.total}/${pool.max} ulanish · ${pool.idle} bo‘sh · ${pool.waiting} navbatda` }
      : { key: "pool", label: "Ulanishlar havzasi", status: "NOT_CONFIGURED", detail: "SQLite — havza ishlatilmaydi" },
  );

  const minutes = recentMinutes(5);
  const requests = minutes.reduce((s, m) => s + m.requests, 0);
  const errors = minutes.reduce((s, m) => s + m.errors, 0);
  const p95 = Math.max(0, ...minutes.map((m) => m.p95));
  const db = await readDb();
  const alerts = db.platformSettings?.alerts || {};
  const errorRate = requests ? (errors / requests) * 100 : 0;
  checks.push({
    key: "api",
    label: "API javob vaqti va xatolar (5 daq)",
    status: requests >= (alerts.minRequests ?? 20) && errorRate >= (alerts.errorRatePercent ?? 5) ? "DOWN" : p95 > (alerts.latencyP95Ms ?? 2000) ? "WARN" : "OK",
    detail: requests ? `${requests} so‘rov · ${errors} xato (${errorRate.toFixed(1)}%) · p95 ${p95} ms` : "Oxirgi 5 daqiqada so‘rov yo‘q",
  });

  const bot = getTelegramBotState();
  const info = bot.mode === "webhook" ? await telegramWebhookInfo() : null;
  const recentWebhookError = info?.lastErrorAt && Date.now() - Date.parse(info.lastErrorAt) < 30 * 60_000;
  checks.push(
    bot.state === "disabled"
      ? { key: "telegram", label: "Telegram bot", status: "NOT_CONFIGURED", detail: "TELEGRAM_BOT_TOKEN berilmagan" }
      : {
          key: "telegram",
          label: `Telegram bot${bot.username ? ` @${bot.username}` : ""}`,
          status: bot.state === "running" ? (recentWebhookError ? "WARN" : "OK") : bot.state === "starting" ? "WARN" : "DOWN",
          detail:
            bot.state === "running"
              ? `${bot.mode === "webhook" ? "Webhook" : "Polling"} rejimi${info?.pending ? ` · navbatda ${info.pending}` : ""}${recentWebhookError ? ` · oxirgi xato: ${info?.lastError}` : ""}`
              : bot.error || bot.state,
        },
  );
  const companyBots = db.companies.filter((c) => c.bot?.enabled);
  const brokenBots = companyBots.filter((c) => c.bot?.status === "ERROR");
  checks.push({
    key: "mini",
    label: "Telegram Mini App / kompaniya botlari",
    status: brokenBots.length ? "WARN" : "OK",
    detail: `${companyBots.length} ta kompaniya boti${brokenBots.length ? ` · ${brokenBots.length} tasida xato` : ""}`,
  });

  const store2 = await opsStore();
  const jobRows = await store2.all<{ status: string; n: number | string }>("SELECT status, COUNT(*) AS n FROM platform_jobs WHERE status IN ('QUEUED','RUNNING','FAILED') GROUP BY status");
  const jobCount = (s: string) => Number(jobRows.find((r) => r.status === s)?.n || 0);
  const failedWorkers = workerStates().filter((w) => w.lastError);
  checks.push({
    key: "jobs",
    label: "Fon ishlari",
    status: failedWorkers.length || jobCount("FAILED") ? "WARN" : jobCount("QUEUED") > (alerts.queueBacklog ?? 200) ? "WARN" : "OK",
    detail: `Navbatda ${jobCount("QUEUED")} · bajarilmoqda ${jobCount("RUNNING")} · xato ${jobCount("FAILED")}${failedWorkers.length ? ` · ${failedWorkers.length} ta davriy vazifada xato` : ""}`,
  });
  const photoBacklog = db.photoQueue.length;
  checks.push({ key: "queues", label: "Rasm va integratsiya navbatlari", status: photoBacklog > (alerts.queueBacklog ?? 200) ? "WARN" : "OK", detail: `Rasm navbati: ${photoBacklog} · integratsiya xatolari: ${db.integrations.filter((i) => i.status === "ERROR").length}` });

  const lastBackup = db.backupRecords.find((b) => b.status === "SUCCESS");
  const maxAge = alerts.backupMaxAgeHours ?? 48;
  const scheduled = (db.platformSettings?.backups?.scheduleHours || 0) > 0;
  checks.push(
    !scheduled && !lastBackup
      ? { key: "backup", label: "Zaxira nusxa", status: "NOT_CONFIGURED", detail: "Avtomatik zaxira yoqilmagan" }
      : {
          key: "backup",
          label: "Zaxira nusxa",
          status: !lastBackup || Date.now() - Date.parse(lastBackup.startedAt) > maxAge * 3600_000 ? "WARN" : "OK",
          detail: lastBackup ? `Oxirgisi: ${lastBackup.startedAt.slice(0, 16).replace("T", " ")} UTC` : "Hali zaxira yo‘q",
        },
  );
  checks.push(
    process.env.RAILWAY_API_TOKEN
      ? { key: "railway", label: "Railway monitoring API", status: "NOT_CONFIGURED", detail: "Token bor, lekin integratsiya hali ulanmagan (keyingi bosqich)" }
      : { key: "railway", label: "Railway monitoring API", status: "NOT_CONFIGURED", detail: "RAILWAY_API_TOKEN berilmagan" },
  );
  const order: CheckStatus[] = ["DOWN", "WARN", "OK"];
  const overall = order.find((s) => checks.some((c) => c.status === s)) || "OK";
  return { overall, checks };
}

export function deploymentInfo() {
  const env = process.env;
  return {
    environment: env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || "development",
    service: env.RAILWAY_SERVICE_NAME || null,
    deploymentId: env.RAILWAY_DEPLOYMENT_ID || null,
    commit: env.RAILWAY_GIT_COMMIT_SHA ? env.RAILWAY_GIT_COMMIT_SHA.slice(0, 12) : null,
    branch: env.RAILWAY_GIT_BRANCH || null,
    region: env.RAILWAY_REPLICA_REGION || null,
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    process: processStats(),
  };
}

/* ------------------------------------------------------------ incidentlar --- */
type RuleResult = { rule: string; active: boolean; severity: IncidentSeverity; title: string; detail: string; companyId?: string };

/** Qoidalarni baholaydi va incidentlarni ochadi/yopadi. */
export async function evaluateIncidentRules() {
  const db = await readDb();
  const alerts = db.platformSettings?.alerts || {};
  const results: RuleResult[] = [];
  const health = await runHealthChecks();
  const by = (key: string) => health.checks.find((c) => c.key === key)!;
  results.push({ rule: "database.down", active: by("database").status === "DOWN", severity: "CRITICAL", title: "Ma’lumotlar bazasiga ulanish xatosi", detail: by("database").detail });
  results.push({ rule: "api.error_rate", active: by("api").status === "DOWN", severity: "CRITICAL", title: "API xatolari ulushi oshdi", detail: by("api").detail });
  results.push({ rule: "api.latency", active: by("api").status === "WARN", severity: "WARNING", title: "API javob vaqti sekinlashdi", detail: by("api").detail });
  results.push({ rule: "telegram.webhook", active: by("telegram").status === "DOWN" || by("telegram").status === "WARN", severity: "WARNING", title: "Telegram bot/webhook muammosi", detail: by("telegram").detail });
  results.push({ rule: "jobs.failed", active: by("jobs").status === "WARN", severity: "WARNING", title: "Fon ishlarida xato yoki navbat to‘ldi", detail: by("jobs").detail });
  results.push({ rule: "queues.backlog", active: by("queues").status === "WARN", severity: "WARNING", title: "Navbat to‘lib qoldi", detail: by("queues").detail });
  results.push({ rule: "backup.late", active: by("backup").status === "WARN", severity: "WARNING", title: "Zaxira nusxa kechikdi", detail: by("backup").detail });
  const lastBackup = db.backupRecords[0];
  results.push({ rule: "backup.failed", active: lastBackup?.status === "FAILED", severity: "CRITICAL", title: "Oxirgi zaxira muvaffaqiyatsiz", detail: lastBackup?.error || "" });
  const failed = await failedLoginsByIp(15);
  const worst = failed[0];
  results.push({ rule: "security.failed_logins", active: Boolean(worst && worst.count >= (alerts.failedLogins ?? 20)), severity: "WARNING", title: "Ko‘p muvaffaqiyatsiz kirish urinishlari", detail: worst ? `${worst.ip}: 15 daqiqada ${worst.count} ta` : "" });
  // Integratsiya sinxronlashi (xodimlar boti) xatoda bo‘lgan kompaniyalar.
  for (const integration of db.integrations.filter((i) => i.status === "ERROR"))
    results.push({ rule: `integration.error:${integration.companyId}`, active: true, severity: "WARNING", title: "Davomat sinxronlashi xatoda", detail: integration.lastError || "Integratsiya xatosi", companyId: integration.companyId });
  for (const open of db.platformIncidents.filter((i) => i.status !== "RESOLVED" && i.rule.startsWith("integration.error:")))
    if (!results.some((r) => r.rule === open.rule)) results.push({ rule: open.rule, active: false, severity: "WARNING", title: open.title, detail: "", companyId: open.companyId });

  const now = new Date().toISOString();
  const opened: PlatformIncident[] = [];
  await updateDb((next) => {
    for (const result of results) {
      const current = next.platformIncidents.find((i) => i.rule === result.rule && i.status !== "RESOLVED");
      if (result.active) {
        if (current) {
          current.lastSeen = now;
          current.count += 1;
          current.detail = result.detail || current.detail;
        } else {
          const incident: PlatformIncident = { id: randomUUID(), rule: result.rule, severity: result.severity, title: result.title, detail: result.detail, status: "OPEN", companyId: result.companyId, firstSeen: now, lastSeen: now, count: 1 };
          next.platformIncidents.unshift(incident);
          opened.push(incident);
        }
      } else if (current) {
        current.status = "RESOLVED";
        current.resolvedAt = now;
        current.resolvedBy = "Avtomatik (holat tiklandi)";
      }
    }
  });
  const cooldown = alerts.cooldownMinutes ?? 30;
  for (const incident of opened)
    await notifyAdmins({ key: `incident:${incident.rule}`, text: `${incident.severity === "CRITICAL" ? "🔴" : "🟠"} ${incident.title}\n${incident.detail}`, permission: "monitoring.read", cooldownMinutes: cooldown });
  return { opened: opened.length, evaluated: results.length };
}
