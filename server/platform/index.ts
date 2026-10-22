import { Router } from "express";
import { documentFiles, opsStore, readDb, updateDb } from "../../lib/store";
import type { Database } from "../../lib/types";
import { evaluateFlag } from "../../lib/platform/flags";
import { originGuard } from "./context";
import { purgePlatformAudit } from "./audit";
import { flushTelemetry } from "./telemetry";
import { enqueueJob, purgeJobs, registerRecurring, startJobQueue } from "./jobs";
import { dispatchDeliveries, notifyAdmins, purgeDeliveries, releaseScheduled } from "./notify";
import { evaluateIncidentRules } from "./monitoring";
import { dispatchWebhooks, purgeWebhookDeliveries } from "./integrations-api";
import { purgeSecurityEvents } from "./security-events";
import { companyHealth, companyOnboarding, companyRequests, isLive, isoDay } from "./analytics";
import { ensurePlans, purgeDemoCompany } from "./shared";
import { createCompanyRouter } from "./routes-companies";
import { createUsersRouter } from "./routes-users";
import { createBusinessRouter, runSubscriptionJob } from "./routes-business";
import { createCommsRouter, createCompanySupportRouter } from "./routes-comms";
import { createOpsRouter, registerOpsJobs } from "./routes-ops";
import { createConfigRouter, createI18nReportRouter, createPublicI18nRouter } from "./routes-config";
import { platformAudit } from "./audit";

export { requestContext } from "./context";
export { telemetryMiddleware, captureError, flushTelemetry } from "./telemetry";
export { createPublicApiRouter, emitWebhook } from "./integrations-api";
export { setRosterProvider } from "./analytics";
export { recordSecurityEvent } from "./security-events";
export { platformAudit } from "./audit";
export { createPublicI18nRouter, createCompanySupportRouter, createI18nReportRouter };

/*
 * Super Admin Control Center — yig‘uvchi modul.
 *   createPlatformRouter — /api/super-admin/* (requireAuth dan keyin; har yo‘l o‘z ruxsatini tekshiradi);
 *   startPlatform        — fon ishlari va davriy vazifalar (alohida xizmat/infratuzilmasiz, shu jarayonda).
 */

export function createPlatformRouter(allowedOrigins: string[]) {
  const router = Router();
  router.use("/super-admin", originGuard(allowedOrigins));
  router.use(createConfigRouter());
  router.use(createCompanyRouter());
  router.use(createUsersRouter());
  router.use(createBusinessRouter());
  router.use(createCommsRouter());
  router.use(createOpsRouter());
  return router;
}

/** Kompaniya uchun yoqilgan feature flaglar (panelga /auth/me orqali). */
export function companyFeatures(db: Database, companyId: string | undefined) {
  if (!companyId) return [];
  const company = db.companies.find((c) => c.id === companyId);
  const ctx = { companyId, planId: company?.subscription?.planId, internal: Boolean(company?.internal || company?.demo) };
  return db.featureFlags.filter((f) => evaluateFlag(f, ctx)).map((f) => f.key);
}

/** Texnik xizmat e’loni (barcha kompaniya panellarida banner). */
export function activeMaintenance(db: Database) {
  const m = db.platformSettings?.maintenance;
  if (!m?.enabled || !m.message) return null;
  const now = new Date().toISOString();
  if (m.startsAt && m.startsAt > now) return null;
  if (m.endsAt && m.endsAt < now) return null;
  return { message: m.message, level: m.level, endsAt: m.endsAt || null };
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/** Saqlash muddati (retention) bo‘yicha tozalash — sozlamalardagi kunlar. */
async function retentionCleanup() {
  const db = await readDb();
  const r = db.platformSettings?.retention || {};
  const store = await opsStore();
  const result = {
    audit: await purgePlatformAudit(daysAgo(r.auditDays ?? 365)),
    metrics: await store.run("DELETE FROM platform_metrics WHERE bucket < ?", [daysAgo(r.metricsDays ?? 90).slice(0, 13)]),
    usage: await store.run("DELETE FROM platform_usage WHERE day < ?", [daysAgo(r.usageDays ?? 400).slice(0, 10)]),
    activeUsers: await store.run("DELETE FROM platform_active_users WHERE day < ?", [daysAgo(r.usageDays ?? 400).slice(0, 10)]),
    errors: await store.run("DELETE FROM platform_errors WHERE status IN ('RESOLVED','IGNORED') AND last_seen < ?", [daysAgo(r.errorsDays ?? 90)]),
    deliveries: await purgeDeliveries(daysAgo(r.deliveriesDays ?? 90)),
    webhooks: await purgeWebhookDeliveries(daysAgo(r.deliveriesDays ?? 90)),
    security: await purgeSecurityEvents(daysAgo(r.securityDays ?? 180)),
    health: await store.run("DELETE FROM company_health WHERE day < ?", [daysAgo(400).slice(0, 10)]),
    // Topilmagan tarjimalar hisoboti — 90 kun ko‘rinmagan matnlar o‘chiriladi.
    i18n: await store.run("DELETE FROM platform_i18n_missing WHERE last_seen < ?", [daysAgo(90)]),
    exports: 0,
    jobs: 0,
  };
  // Eksport fayllari 24 soatdan keyin o‘chiriladi (havola ham shu muddatda tugaydi).
  const old = await store.all<{ id: string }>("SELECT id FROM platform_jobs WHERE type = 'EXPORT' AND status = 'SUCCEEDED' AND finished_at < ?", [daysAgo(1)]);
  const files = await documentFiles();
  for (const job of old) {
    await files.deleteFile(`export:${job.id}`).catch(() => undefined);
    result.exports += 1;
  }
  result.jobs = await purgeJobs(daysAgo(r.jobsDays ?? 30));
  return result;
}

/** Muddati o‘tgan demo kompaniyalar avtomatik tozalanadi (faqat demo belgisi bor kompaniyalar). */
async function demoCleanup() {
  const now = new Date().toISOString();
  const expired = (await readDb()).companies.filter((c) => c.demo && c.demo.expiresAt < now).map((c) => ({ id: c.id, name: c.name }));
  for (const company of expired) {
    await updateDb((db) => purgeDemoCompany(db, company.id));
    await platformAudit({ actor: { name: "Tizim" }, action: "company.demo_cleanup", entity: "company", entityId: company.id, summary: `Muddati o‘tgan demo kompaniya tozalandi: ${company.name}` });
  }
  return expired.length;
}

/** Kunlik sog‘liq bahosi tarixi va onboarding yakunlanishi haqida xabar. */
async function healthSnapshots() {
  const db = await readDb();
  const store = await opsStore();
  const day = isoDay(0);
  const done = new Set((await store.all<{ company_id: string }>("SELECT company_id FROM company_health WHERE day = ?", [day])).map((r) => r.company_id));
  const requests = await companyRequests(null);
  const completed: { id: string; name: string }[] = [];
  for (const company of db.companies.filter(isLive)) {
    if (!done.has(company.id)) {
      const health = await companyHealth(db, company, requests);
      await store.run("INSERT OR IGNORE INTO company_health (day, company_id, score, components) VALUES (?,?,?,?)", [day, company.id, health.score, JSON.stringify(health.components)]);
    }
    if (!company.onboardingCompletedAt && companyOnboarding(db, company).percent === 100) completed.push({ id: company.id, name: company.name });
  }
  if (completed.length) {
    await updateDb((next) => {
      for (const c of completed) {
        const row = next.companies.find((x) => x.id === c.id);
        if (row && !row.onboardingCompletedAt) row.onboardingCompletedAt = new Date().toISOString();
      }
    });
    if (db.platformSettings?.notifications?.onboardingUpdates)
      for (const c of completed) await notifyAdmins({ key: `onboarding:${c.id}`, text: `✅ ${c.name}: onboarding yakunlandi (birinchi davomat qayd etildi)`, permission: "companies.read", cooldownMinutes: 1440 });
  }
  return { companies: db.companies.length, completed: completed.length };
}

/** Avtomatik zaxira (sozlamada scheduleHours > 0 bo‘lsa). */
async function scheduledBackup() {
  const db = await readDb();
  const hours = db.platformSettings?.backups?.scheduleHours || 0;
  if (!hours) return "off";
  if (db.backupRecords.some((b) => b.status === "RUNNING")) return "running";
  const last = db.backupRecords.find((b) => b.kind === "SCHEDULED" || b.status === "SUCCESS");
  if (last && Date.now() - Date.parse(last.startedAt) < hours * 3600_000) return "not-due";
  await enqueueJob({ type: "BACKUP", payload: { kind: "SCHEDULED" }, createdBy: "Tizim (jadval)", maxAttempts: 1, dedupeKey: `backup:scheduled:${new Date().toISOString().slice(0, 13)}` });
  return "queued";
}

let started = false;
export function startPlatform() {
  if (started) return;
  started = true;
  void updateDb((db) => {
    ensurePlans(db);
  }).catch((error) => console.error("Standart tariflarni yaratishda xato", error));
  registerOpsJobs();
  startJobQueue();
  registerRecurring("telemetry.flush", "Metrikalarni yozish", 60_000, flushTelemetry, 60_000);
  registerRecurring("notifications.dispatch", "Bildirishnomalar yetkazish", 5_000, async () => {
    await releaseScheduled();
    await dispatchDeliveries();
  });
  registerRecurring("webhooks.dispatch", "Webhook yetkazish", 10_000, dispatchWebhooks);
  registerRecurring("incidents.evaluate", "Muammolarni aniqlash", 60_000, evaluateIncidentRules, 90_000);
  registerRecurring("subscriptions", "Obuna muddatlari", 30 * 60_000, runSubscriptionJob, 120_000);
  registerRecurring("backups.schedule", "Zaxira jadvali", 10 * 60_000, scheduledBackup, 180_000);
  registerRecurring("retention.cleanup", "Saqlash muddati bo‘yicha tozalash", 6 * 3600_000, retentionCleanup, 10 * 60_000);
  registerRecurring("demo.cleanup", "Demo kompaniyalarni tozalash", 3600_000, demoCleanup, 5 * 60_000);
  registerRecurring("health.snapshot", "Sog‘liq bahosi tarixi", 3600_000, healthSnapshots, 4 * 60_000);
}

export { retentionCleanup, demoCleanup, healthSnapshots, scheduledBackup };
