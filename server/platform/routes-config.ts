import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { audit, opsStore, readDb, updateDb } from "../../lib/store";
import { isModuleKey, MODULES } from "../../lib/modules";
import type { FeatureFlag, FeatureFlagState, PlatformSettings } from "../../lib/platform/types";
import { FLAG_KEY_RE } from "../../lib/platform/flags";
import { isPrivateAddress, webhookUrlError } from "../../lib/platform/security";
import { platformPermissionsOf, PLATFORM_ROLES } from "../../lib/platform/permissions";
import type { AuthedRequest } from "../auth";
import { getTelegramBotState } from "../telegram";
import { companyDisabledModules } from "../modules";
import { actorOf, assertRecentAuth, asyncRoute, hasPermission, httpError, pageParams, paginate, q, requirePlatform } from "./context";
import { platformAudit, queryPlatformAudit } from "./audit";
import { isLive, isoDay, platformAnalytics, platformOverview, recentActivities, usageAnalytics } from "./analytics";
import { API_SCOPES, emitWebhook, generateApiKey, listWebhookDeliveries, newWebhookSecret, publicApiKey, publicWebhook, retryWebhookDelivery, WEBHOOK_EVENTS } from "./integrations-api";

/*
 * Platforma konfiguratsiyasi va ko‘rinishlar: dashboard, analitika, audit, global sozlamalar (maxfiy qiymatlarsiz),
 * feature flaglar (versiya + rollback), modul katalogi, tillar, integratsiyalar, API kalitlar, webhooklar.
 */

const allowPrivateWebhooks = () => process.env.NODE_ENV !== "production" && process.env.WEBHOOK_ALLOW_PRIVATE === "true";

function rangeOf(req: { query: Record<string, unknown> }) {
  const range = String(req.query.range || "30");
  const today = isoDay(0);
  if (range === "custom") {
    const from = String(req.query.from || "");
    const to = String(req.query.to || today);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw httpError("Sana oralig‘i noto‘g‘ri.", 400);
    if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw httpError("Oraliq 1 yildan oshmasin.", 400);
    return { from, to };
  }
  const days = range === "today" ? 1 : Math.max(1, Math.min(90, Number(range) || 30));
  return { from: isoDay(-(days - 1)), to: today };
}

const settingsSchema = z
  .object({
    platformName: z.string().trim().min(2).max(60),
    support: z.object({ email: z.union([z.string().email(), z.literal("")]).optional(), telegram: z.string().trim().max(60).optional(), phone: z.string().trim().max(40).optional(), hours: z.string().trim().max(80).optional() }),
    defaultTimezone: z.string().max(60),
    reportingTimezone: z.string().max(60),
    defaultLanguage: z.enum(["uz", "ru"]),
    trialDays: z.number().int().min(0).max(365),
    session: z.object({ panelHours: z.number().int().min(1).max(72).optional(), reauthMinutes: z.number().int().min(1).max(120).optional() }),
    uploads: z.object({ maxMb: z.number().min(0.1).max(1.4).optional() }),
    notifications: z.object({ adminTelegram: z.boolean().optional(), subscriptionAlerts: z.boolean().optional(), expiryDays: z.array(z.number().int().min(1).max(90)).max(6).optional(), onboardingUpdates: z.boolean().optional() }),
    maintenance: z.object({ enabled: z.boolean(), message: z.string().trim().max(300), level: z.enum(["info", "warning", "critical"]), startsAt: z.string().optional(), endsAt: z.string().optional() }),
    retention: z.object({
      auditDays: z.number().int().min(30).max(3650).optional(),
      metricsDays: z.number().int().min(7).max(730).optional(),
      usageDays: z.number().int().min(30).max(1095).optional(),
      errorsDays: z.number().int().min(7).max(730).optional(),
      deliveriesDays: z.number().int().min(7).max(365).optional(),
      jobsDays: z.number().int().min(7).max(365).optional(),
      securityDays: z.number().int().min(30).max(1095).optional(),
    }),
    alerts: z.object({
      errorRatePercent: z.number().min(0.1).max(100).optional(),
      minRequests: z.number().int().min(1).max(100_000).optional(),
      latencyP95Ms: z.number().int().min(100).max(60_000).optional(),
      queueBacklog: z.number().int().min(10).max(1_000_000).optional(),
      backupMaxAgeHours: z.number().int().min(1).max(720).optional(),
      failedLogins: z.number().int().min(3).max(10_000).optional(),
      cooldownMinutes: z.number().int().min(1).max(1440).optional(),
    }),
    backups: z.object({ scheduleHours: z.number().int().min(0).max(168).optional(), keep: z.number().int().min(1).max(30).optional(), includeMedia: z.boolean().optional(), includeFiles: z.boolean().optional() }),
    supportAccessEnabled: z.boolean(),
    languages: z.object({ enabled: z.array(z.enum(["uz", "ru"])).min(1).optional() }),
    demo: z.object({ ttlDays: z.number().int().min(1).max(30).optional() }),
    requireAdminMfa: z.boolean(),
  })
  .partial();
/** Xavfli sozlamalar — o‘zgartirish uchun parol qayta kiritiladi. */
const DANGEROUS: (keyof PlatformSettings)[] = ["session", "retention", "supportAccessEnabled", "requireAdminMfa", "backups"];

const flagSchema = z.object({
  key: z.string().trim().regex(FLAG_KEY_RE, "Kalit: kichik lotin harflari, raqam, nuqta, - yoki _ (3–64)"),
  description: z.string().trim().max(300).optional(),
  enabled: z.boolean().default(false),
  rollout: z.number().int().min(0).max(100).optional(),
  rules: z.array(z.object({ scope: z.enum(["COMPANY", "PLAN", "INTERNAL"]), ids: z.array(z.string()).max(500).optional(), enabled: z.boolean() })).max(50).default([]),
  expiresAt: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
});
const flagState = (f: FeatureFlag): FeatureFlagState => ({ key: f.key, description: f.description, enabled: f.enabled, rollout: f.rollout, rules: f.rules.map((r) => ({ ...r, ids: r.ids ? [...r.ids] : undefined })), expiresAt: f.expiresAt });

async function assertPublicHost(url: string) {
  const error = webhookUrlError(url, allowPrivateWebhooks());
  if (error) throw httpError(error, 400);
  if (allowPrivateWebhooks()) return;
  try {
    const addresses = await lookup(new URL(url).hostname, { all: true });
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw httpError("Manzil xususiy/lokal tarmoqqa yo‘naltirilgan — ruxsat yo‘q.", 400);
  } catch (reason) {
    if ((reason as { status?: number }).status) throw reason;
    throw httpError("Domen topilmadi (DNS).", 400);
  }
}

export function createConfigRouter() {
  const router = Router();

  /* ---------------------------------------------------------------- men --- */
  router.get(
    "/super-admin/me",
    requirePlatform(),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const actor = actorOf(req);
      const store = await opsStore();
      const newErrors = Number((await store.all<{ n: number | string }>("SELECT COUNT(*) AS n FROM platform_errors WHERE status = 'NEW'"))[0]?.n || 0);
      res.json({
        user: { id: actor.id, name: actor.name, email: actor.email, role: actor.role, roleLabel: PLATFORM_ROLES[actor.role].label, telegramLinked: Boolean(req.platform!.user.telegramId) },
        permissions: platformPermissionsOf(actor.role),
        platformName: db.platformSettings?.platformName || "Staffora",
        badges: {
          tickets: db.supportTickets.filter((t) => t.unreadAdmin && !["CLOSED"].includes(t.status)).length,
          incidents: db.platformIncidents.filter((i) => i.status === "OPEN").length,
          errors: newErrors,
          approvals: db.previewSessions.filter((p) => p.status === "PENDING_APPROVAL").length,
        },
      });
    }),
  );

  /* ---------------------------------------------------- dashboard/analitika --- */
  router.get("/super-admin/overview", requirePlatform("dashboard.read"), asyncRoute(async (_req, res) => res.json(await platformOverview())));
  router.get(
    "/super-admin/analytics",
    requirePlatform("analytics.read"),
    asyncRoute(async (req, res) => {
      const { from, to } = rangeOf(req);
      res.json(await platformAnalytics(from, to));
    }),
  );
  router.get(
    "/super-admin/usage",
    requirePlatform("analytics.read"),
    asyncRoute(async (req, res) => {
      const { from, to } = rangeOf(req);
      res.json(await usageAnalytics(from, to));
    }),
  );
  router.get(
    "/super-admin/activities",
    requirePlatform("dashboard.read"),
    asyncRoute(async (req, res) => {
      const items = await recentActivities(Math.max(5, Math.min(100, Number(req.query.limit) || 20)));
      // Audit huquqi bo‘lmasa — faqat umumiy voqealar (kompaniya yaratildi, yangi xato), amallar tafsilotisiz.
      res.json(hasPermission(req, "audit.read") ? items : items.filter((i) => i.kind !== "audit"));
    }),
  );

  router.get(
    "/super-admin/audit-logs",
    requirePlatform("audit.read"),
    asyncRoute(async (req, res) => {
      const { page, pageSize, offset } = pageParams(req, 200);
      const result = await queryPlatformAudit(
        {
          companyId: q(req, "companyId") || undefined,
          actorId: q(req, "actorId") || undefined,
          action: q(req, "action") || undefined,
          result: q(req, "result") || undefined,
          from: q(req, "from") ? `${q(req, "from")}T00:00:00` : undefined,
          to: q(req, "to") ? `${q(req, "to")}T23:59:59` : undefined,
          q: q(req, "q") || undefined,
          privileged: q(req, "privileged") === "1",
        },
        pageSize,
        offset,
      );
      res.json({ ...result, page, pageSize });
    }),
  );

  /* ------------------------------------------------------------ sozlamalar --- */
  router.get(
    "/super-admin/settings",
    requirePlatform("settings.read"),
    asyncRoute(async (_req, res) => {
      const db = await readDb();
      const env = process.env;
      res.json({
        settings: db.platformSettings || {},
        // Maxfiy qiymatlarning o‘zi emas — faqat berilgan/berilmaganligi.
        environment: {
          DATABASE_URL: Boolean(env.DATABASE_URL),
          TELEGRAM_BOT_TOKEN: Boolean(env.TELEGRAM_BOT_TOKEN),
          SESSION_SECRET: (env.SESSION_SECRET || "").length >= 32,
          JWT_SECRET: (env.JWT_SECRET || "").length >= 32,
          COOKIE_SECURE: env.COOKIE_SECURE === "true",
          RAILWAY_VOLUME_MOUNT_PATH: Boolean(env.RAILWAY_VOLUME_MOUNT_PATH),
          RAILWAY_API_TOKEN: Boolean(env.RAILWAY_API_TOKEN),
          APP_URL: env.APP_URL || null,
          EMAIL: false,
        },
      });
    }),
  );

  router.put(
    "/super-admin/settings",
    requirePlatform("settings.manage"),
    asyncRoute(async (req, res) => {
      const input = settingsSchema.parse(req.body);
      for (const tz of [input.defaultTimezone, input.reportingTimezone].filter(Boolean) as string[])
        try {
          new Intl.DateTimeFormat("en", { timeZone: tz });
        } catch {
          throw httpError(`Vaqt mintaqasi noto‘g‘ri: ${tz}`, 400);
        }
      const db0 = await readDb();
      const dangerous = DANGEROUS.filter((key) => key in input && JSON.stringify((input as Record<string, unknown>)[key]) !== JSON.stringify(db0.platformSettings?.[key]));
      if (dangerous.length) assertRecentAuth(req, db0);
      const actor = actorOf(req);
      const result = await updateDb((db) => {
        const before = JSON.parse(JSON.stringify(db.platformSettings || {})) as PlatformSettings;
        const next: PlatformSettings = { ...before };
        for (const [key, value] of Object.entries(input)) {
          const current = (before as Record<string, unknown>)[key];
          (next as Record<string, unknown>)[key] = value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" ? { ...current, ...value } : value;
        }
        next.updatedAt = new Date().toISOString();
        next.updatedBy = actor.name;
        db.platformSettings = next;
        return { before, after: next };
      });
      await platformAudit({ req, action: "settings.update", entity: "settings", summary: `Global sozlamalar: ${Object.keys(input).join(", ")}`, details: { before: Object.fromEntries(Object.keys(input).map((k) => [k, (result.before as Record<string, unknown>)[k]])), after: input }, privileged: dangerous.length > 0 });
      res.json(result.after);
    }),
  );

  /* ---------------------------------------------------------- feature flaglar --- */
  router.get(
    "/super-admin/flags",
    requirePlatform("flags.manage"),
    asyncRoute(async (_req, res) => {
      const db = await readDb();
      res.json(db.featureFlags);
    }),
  );
  router.post(
    "/super-admin/flags",
    requirePlatform("flags.manage"),
    asyncRoute(async (req, res) => {
      const input = flagSchema.parse(req.body);
      const actor = actorOf(req);
      const flag = await updateDb((db) => {
        if (db.featureFlags.some((f) => f.key === input.key)) throw httpError("Bu kalitli flag mavjud.", 409);
        const now = new Date().toISOString();
        const row: FeatureFlag = { id: randomUUID(), ...input, expiresAt: input.expiresAt ? `${input.expiresAt}T23:59:59.000Z` : undefined, version: 1, history: [], createdAt: now, updatedAt: now, updatedBy: actor.name };
        row.history.push({ version: 1, at: now, by: actor.name, snapshot: flagState(row) });
        db.featureFlags.unshift(row);
        return row;
      });
      await platformAudit({ req, action: "flag.create", entity: "flag", entityId: flag.id, summary: `Feature flag: ${flag.key} (${flag.enabled ? "yoqilgan" : "o‘chiq"})`, details: flagState(flag) });
      res.status(201).json(flag);
    }),
  );
  router.patch(
    "/super-admin/flags/:id",
    requirePlatform("flags.manage"),
    asyncRoute(async (req, res) => {
      const input = flagSchema.partial().omit({ key: true }).parse(req.body);
      const actor = actorOf(req);
      const flag = await updateDb((db) => {
        const row = db.featureFlags.find((f) => f.id === req.params.id);
        if (!row) throw httpError("Flag topilmadi.", 404);
        Object.assign(row, input, input.expiresAt !== undefined ? { expiresAt: input.expiresAt ? `${input.expiresAt}T23:59:59.000Z` : undefined } : {});
        row.version += 1;
        row.updatedAt = new Date().toISOString();
        row.updatedBy = actor.name;
        row.history = [...row.history, { version: row.version, at: row.updatedAt, by: actor.name, snapshot: flagState(row) }].slice(-20);
        return row;
      });
      await platformAudit({ req, action: "flag.update", entity: "flag", entityId: flag.id, summary: `Flag ${flag.key} → v${flag.version}`, details: input });
      res.json(flag);
    }),
  );
  router.post(
    "/super-admin/flags/:id/rollback",
    requirePlatform("flags.manage"),
    asyncRoute(async (req, res) => {
      const { version } = z.object({ version: z.number().int().min(1) }).parse(req.body);
      const actor = actorOf(req);
      const flag = await updateDb((db) => {
        const row = db.featureFlags.find((f) => f.id === req.params.id);
        if (!row) throw httpError("Flag topilmadi.", 404);
        const snapshot = row.history.find((h) => h.version === version)?.snapshot;
        if (!snapshot) throw httpError("Bu versiya tarixda yo‘q.", 404);
        Object.assign(row, { ...snapshot, key: row.key });
        row.version += 1;
        row.updatedAt = new Date().toISOString();
        row.updatedBy = actor.name;
        row.history = [...row.history, { version: row.version, at: row.updatedAt, by: `${actor.name} (rollback v${version})`, snapshot: flagState(row) }].slice(-20);
        return row;
      });
      await platformAudit({ req, action: "flag.rollback", entity: "flag", entityId: flag.id, summary: `Flag ${flag.key}: v${version} holatiga qaytarildi` });
      res.json(flag);
    }),
  );
  router.delete(
    "/super-admin/flags/:id",
    requirePlatform("flags.manage"),
    asyncRoute(async (req, res) => {
      const flag = await updateDb((db) => {
        const row = db.featureFlags.find((f) => f.id === req.params.id);
        if (!row) throw httpError("Flag topilmadi.", 404);
        db.featureFlags = db.featureFlags.filter((f) => f.id !== row.id);
        return row;
      });
      await platformAudit({ req, action: "flag.delete", entity: "flag", entityId: flag.id, summary: `Flag o‘chirildi: ${flag.key}`, details: flagState(flag) });
      res.json({ ok: true });
    }),
  );

  /* ---------------------------------------------------------- modul katalogi --- */
  router.get(
    "/super-admin/modules",
    requirePlatform("companies.read"),
    asyncRoute(async (_req, res) => {
      const db = await readDb();
      const live = db.companies.filter(isLive);
      res.json(
        MODULES.map((m) => ({
          key: m.key,
          label: m.label,
          description: m.description,
          group: m.group,
          dependsOn: (m as { dependsOn?: string[] }).dependsOn || [],
          dependents: MODULES.filter((x) => ((x as { dependsOn?: string[] }).dependsOn || []).includes(m.key)).map((x) => x.key),
          catalog: db.platformSettings?.modules?.[m.key] || {},
          plans: db.subscriptionPlans.filter((p) => p.modules === "all" || p.modules.includes(m.key)).map((p) => p.name),
          companiesEnabled: live.filter((c) => !companyDisabledModules(db, c).includes(m.key)).length,
          overrides: live.filter((c) => c.moduleOverrides?.[m.key]).length,
          totalCompanies: live.length,
        })),
      );
    }),
  );
  router.patch(
    "/super-admin/modules/:key",
    requirePlatform("modules.manage"),
    asyncRoute(async (req, res) => {
      const key = String(req.params.key);
      if (!isModuleKey(key)) throw httpError("Noma’lum modul.", 400);
      const input = z
        .object({ globalEnabled: z.boolean().optional(), defaultEnabled: z.boolean().optional(), version: z.string().trim().max(20).optional(), requiredPlan: z.string().trim().max(30).optional(), limits: z.record(z.number().int().min(0).max(1_000_000)).optional(), note: z.string().trim().max(300).optional() })
        .parse(req.body);
      const db0 = await readDb();
      if (input.globalEnabled === false && db0.platformSettings?.modules?.[key]?.globalEnabled !== false) assertRecentAuth(req, db0);
      const result = await updateDb((db) => {
        const before = db.platformSettings.modules?.[key] || {};
        db.platformSettings = { ...db.platformSettings, modules: { ...(db.platformSettings.modules || {}), [key]: { ...before, ...input } } };
        return { before, after: db.platformSettings.modules![key] };
      });
      await platformAudit({ req, action: "module.catalog", entity: "module", entityId: key, summary: `Modul katalogi: ${key}${input.globalEnabled === false ? " — butun platformada o‘chirildi" : ""}`, details: result, privileged: input.globalEnabled !== undefined });
      res.json(result.after);
    }),
  );

  /* ------------------------------------------------------------------ tillar --- */
  router.get(
    "/super-admin/languages",
    requirePlatform("settings.read"),
    asyncRoute(async (_req, res) => {
      const db = await readDb();
      const store = await opsStore();
      const missing = await store.all<{ lang: string; text: string; count: number | string; last_seen: string }>("SELECT * FROM platform_i18n_missing ORDER BY count DESC LIMIT 200");
      const enabled = db.platformSettings?.languages?.enabled || ["uz", "ru"];
      res.json({
        languages: [
          { code: "uz", label: "O‘zbekcha", base: true, enabled: enabled.includes("uz"), default: (db.platformSettings?.defaultLanguage || "uz") === "uz" },
          { code: "ru", label: "Русский", base: false, enabled: enabled.includes("ru"), default: db.platformSettings?.defaultLanguage === "ru", overrides: db.translationOverrides.filter((t) => t.lang === "ru").length, missing: missing.filter((m) => m.lang === "ru").length },
        ],
        overrides: db.translationOverrides,
        missing: missing.map((m) => ({ lang: m.lang, text: m.text, count: Number(m.count), lastSeen: m.last_seen })),
      });
    }),
  );
  router.post(
    "/super-admin/translations",
    requirePlatform("settings.manage"),
    asyncRoute(async (req, res) => {
      const input = z.object({ lang: z.enum(["ru"]), source: z.string().trim().min(1).max(300), text: z.string().trim().min(1).max(500) }).parse(req.body);
      const actor = actorOf(req);
      const row = await updateDb((db) => {
        const now = new Date().toISOString();
        const existing = db.translationOverrides.find((t) => t.lang === input.lang && t.source === input.source);
        if (existing) return Object.assign(existing, { text: input.text, updatedAt: now, updatedBy: actor.name });
        const created = { id: randomUUID(), ...input, updatedAt: now, updatedBy: actor.name };
        db.translationOverrides.push(created);
        return created;
      });
      const store = await opsStore();
      await store.run("DELETE FROM platform_i18n_missing WHERE lang = ? AND text = ?", [input.lang, input.source]);
      await platformAudit({ req, action: "i18n.override", entity: "translation", entityId: row.id, summary: `Tarjima (${input.lang}): «${input.source.slice(0, 60)}»` });
      res.json(row);
    }),
  );
  router.delete(
    "/super-admin/translations/:id",
    requirePlatform("settings.manage"),
    asyncRoute(async (req, res) => {
      await updateDb((db) => {
        db.translationOverrides = db.translationOverrides.filter((t) => t.id !== req.params.id);
      });
      await platformAudit({ req, action: "i18n.delete", entity: "translation", entityId: String(req.params.id), summary: "Tarjima o‘chirildi" });
      res.json({ ok: true });
    }),
  );

  /* --------------------------------------------------------- integratsiyalar --- */
  router.get(
    "/super-admin/integrations",
    requirePlatform("integrations.read"),
    asyncRoute(async (_req, res) => {
      const db = await readDb();
      const bot = getTelegramBotState();
      res.json({
        platformBot: { state: bot.state, mode: bot.mode || null, username: bot.username || null, error: bot.error || null },
        email: { configured: false, note: "Email integratsiyasi ulanmagan" },
        companies: db.companies.filter(isLive).map((c) => {
          const integration = db.integrations.find((i) => i.companyId === c.id && i.status !== "DISCONNECTED");
          return {
            id: c.id,
            name: c.name,
            bot: c.bot?.enabled ? { status: c.bot.status || "STOPPED", username: c.bot.username || null, lastError: c.bot.lastError || null } : null,
            hrIntegration: integration ? { status: integration.status, lastSyncAt: integration.lastSyncAt || null, lastError: integration.lastError || null } : null,
            photoChannel: Boolean(c.photoChannel?.enabled),
            webhooks: db.webhookEndpoints.filter((w) => w.companyId === c.id).length,
            failingWebhooks: db.webhookEndpoints.filter((w) => w.companyId === c.id && w.failures >= 5).length,
            apiKeys: db.apiKeys.filter((k) => k.companyId === c.id && !k.revokedAt).length,
          };
        }),
      });
    }),
  );

  /* ------------------------------------------------------------- API kalitlar --- */
  router.get(
    "/super-admin/api-keys",
    requirePlatform("integrations.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const companyId = q(req, "companyId");
      res.json({
        scopes: API_SCOPES,
        keys: db.apiKeys.filter((k) => !companyId || k.companyId === companyId).map((k) => ({ ...publicApiKey(k), company: db.companies.find((c) => c.id === k.companyId)?.name || "—" })),
      });
    }),
  );
  router.post(
    "/super-admin/companies/:id/api-keys",
    requirePlatform("integrations.manage"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({ name: z.string().trim().min(2).max(60), scopes: z.array(z.enum(Object.keys(API_SCOPES) as [keyof typeof API_SCOPES])).min(1), expiresAt: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional() })
        .parse(req.body);
      const actor = actorOf(req);
      const generated = generateApiKey();
      const key = await updateDb((db) => {
        const company = db.companies.find((c) => c.id === req.params.id);
        if (!company || company.archive) throw httpError("Kompaniya topilmadi yoki arxivda.", 404);
        if (db.apiKeys.filter((k) => k.companyId === company.id && !k.revokedAt).length >= 20) throw httpError("Kompaniyada 20 tadan ortiq faol kalit bo‘lmaydi.", 409);
        const row = { id: randomUUID(), companyId: company.id, name: input.name, prefix: generated.prefix, hash: generated.hash, scopes: input.scopes, expiresAt: input.expiresAt ? `${input.expiresAt}T23:59:59.000Z` : undefined, createdAt: new Date().toISOString(), createdBy: actor.name };
        db.apiKeys.unshift(row);
        db.auditLogs.unshift(audit(company.id, actor.name, `Platforma: API kalit yaratildi (${input.name})`, "company", company.id));
        return row;
      });
      await platformAudit({ req, companyId: key.companyId, action: "apikey.create", entity: "api_key", entityId: key.id, summary: `API kalit: ${key.name} (${key.scopes.join(", ")})`, privileged: true });
      // Kalit faqat shu javobda ko‘rinadi — bazada faqat xesh.
      res.status(201).json({ ...publicApiKey(key), key: generated.key });
    }),
  );
  router.post(
    "/super-admin/api-keys/:id/revoke",
    requirePlatform("integrations.manage"),
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      const key = await updateDb((db) => {
        const row = db.apiKeys.find((k) => k.id === req.params.id);
        if (!row) throw httpError("Kalit topilmadi.", 404);
        row.revokedAt ||= new Date().toISOString();
        row.revokedBy = actor.name;
        return row;
      });
      await platformAudit({ req, companyId: key.companyId, action: "apikey.revoke", entity: "api_key", entityId: key.id, summary: `API kalit bekor qilindi: ${key.name}`, privileged: true });
      res.json(publicApiKey(key));
    }),
  );
  router.post(
    "/super-admin/api-keys/:id/rotate",
    requirePlatform("integrations.manage"),
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      const generated = generateApiKey();
      const result = await updateDb((db) => {
        const old = db.apiKeys.find((k) => k.id === req.params.id);
        if (!old || old.revokedAt) throw httpError("Faol kalit topilmadi.", 404);
        const now = new Date().toISOString();
        old.revokedAt = now;
        old.revokedBy = `${actor.name} (rotatsiya)`;
        const row = { ...old, id: randomUUID(), prefix: generated.prefix, hash: generated.hash, createdAt: now, createdBy: actor.name, revokedAt: undefined, revokedBy: undefined, lastUsedAt: undefined, rotatedFromId: old.id };
        db.apiKeys.unshift(row);
        return row;
      });
      await platformAudit({ req, companyId: result.companyId, action: "apikey.rotate", entity: "api_key", entityId: result.id, summary: `API kalit almashtirildi: ${result.name}`, privileged: true });
      res.json({ ...publicApiKey(result), key: generated.key });
    }),
  );

  /* --------------------------------------------------------------- webhooklar --- */
  router.get(
    "/super-admin/webhooks",
    requirePlatform("integrations.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const companyId = q(req, "companyId");
      res.json({ events: WEBHOOK_EVENTS, endpoints: db.webhookEndpoints.filter((w) => !companyId || w.companyId === companyId).map((w) => ({ ...publicWebhook(w), company: db.companies.find((c) => c.id === w.companyId)?.name || "—" })) });
    }),
  );
  const eventsSchema = z.array(z.enum(Object.keys(WEBHOOK_EVENTS).filter((e) => e !== "ping") as [string, ...string[]])).min(1);
  router.post(
    "/super-admin/companies/:id/webhooks",
    requirePlatform("integrations.manage"),
    asyncRoute(async (req, res) => {
      const input = z.object({ url: z.string().trim().url().max(500), events: eventsSchema, description: z.string().trim().max(120).optional() }).parse(req.body);
      await assertPublicHost(input.url);
      const actor = actorOf(req);
      const secret = newWebhookSecret();
      const endpoint = await updateDb((db) => {
        const company = db.companies.find((c) => c.id === req.params.id);
        if (!company || company.archive) throw httpError("Kompaniya topilmadi yoki arxivda.", 404);
        if (db.webhookEndpoints.filter((w) => w.companyId === company.id).length >= 10) throw httpError("Kompaniyada 10 tadan ortiq webhook bo‘lmaydi.", 409);
        const now = new Date().toISOString();
        const row = { id: randomUUID(), companyId: company.id, url: input.url, description: input.description, events: input.events, secretEnc: secret.secretEnc, secretHint: secret.secretHint, enabled: true, failures: 0, createdAt: now, createdBy: actor.name, updatedAt: now };
        db.webhookEndpoints.unshift(row);
        db.auditLogs.unshift(audit(company.id, actor.name, `Platforma: webhook qo‘shildi (${new URL(input.url).host})`, "company", company.id));
        return row;
      });
      await platformAudit({ req, companyId: endpoint.companyId, action: "webhook.create", entity: "webhook", entityId: endpoint.id, summary: `Webhook: ${new URL(endpoint.url).host} (${endpoint.events.join(", ")})`, privileged: true });
      res.status(201).json({ ...publicWebhook(endpoint), secret: secret.secret });
    }),
  );
  router.patch(
    "/super-admin/webhooks/:id",
    requirePlatform("integrations.manage"),
    asyncRoute(async (req, res) => {
      const input = z.object({ url: z.string().trim().url().max(500).optional(), events: eventsSchema.optional(), enabled: z.boolean().optional(), description: z.string().trim().max(120).optional() }).parse(req.body);
      if (input.url) await assertPublicHost(input.url);
      const endpoint = await updateDb((db) => {
        const row = db.webhookEndpoints.find((w) => w.id === req.params.id);
        if (!row) throw httpError("Webhook topilmadi.", 404);
        Object.assign(row, input, { updatedAt: new Date().toISOString() });
        if (input.enabled) {
          row.failures = 0;
          row.disabledReason = undefined;
        }
        return row;
      });
      await platformAudit({ req, companyId: endpoint.companyId, action: "webhook.update", entity: "webhook", entityId: endpoint.id, summary: `Webhook o‘zgartirildi: ${new URL(endpoint.url).host}`, details: input });
      res.json(publicWebhook(endpoint));
    }),
  );
  router.post(
    "/super-admin/webhooks/:id/rotate-secret",
    requirePlatform("integrations.manage"),
    asyncRoute(async (req, res) => {
      const secret = newWebhookSecret();
      const endpoint = await updateDb((db) => {
        const row = db.webhookEndpoints.find((w) => w.id === req.params.id);
        if (!row) throw httpError("Webhook topilmadi.", 404);
        Object.assign(row, { secretEnc: secret.secretEnc, secretHint: secret.secretHint, updatedAt: new Date().toISOString() });
        return row;
      });
      await platformAudit({ req, companyId: endpoint.companyId, action: "webhook.rotate", entity: "webhook", entityId: endpoint.id, summary: "Webhook maxfiy kaliti almashtirildi", privileged: true });
      res.json({ ...publicWebhook(endpoint), secret: secret.secret });
    }),
  );
  router.post(
    "/super-admin/webhooks/:id/test",
    requirePlatform("integrations.manage"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const endpoint = db.webhookEndpoints.find((w) => w.id === req.params.id);
      if (!endpoint) throw httpError("Webhook topilmadi.", 404);
      if (!endpoint.enabled) throw httpError("Avval webhookni yoqing.", 409);
      emitWebhook(endpoint.companyId, "ping", { message: "Staffora sinov hodisasi", endpointId: endpoint.id });
      await platformAudit({ req, companyId: endpoint.companyId, action: "webhook.test", entity: "webhook", entityId: endpoint.id, summary: "Sinov (ping) yuborildi" });
      res.json({ ok: true });
    }),
  );
  router.delete(
    "/super-admin/webhooks/:id",
    requirePlatform("integrations.manage"),
    asyncRoute(async (req, res) => {
      const endpoint = await updateDb((db) => {
        const row = db.webhookEndpoints.find((w) => w.id === req.params.id);
        if (!row) throw httpError("Webhook topilmadi.", 404);
        db.webhookEndpoints = db.webhookEndpoints.filter((w) => w.id !== row.id);
        return row;
      });
      await platformAudit({ req, companyId: endpoint.companyId, action: "webhook.delete", entity: "webhook", entityId: endpoint.id, summary: `Webhook o‘chirildi: ${new URL(endpoint.url).host}`, privileged: true });
      res.json({ ok: true });
    }),
  );
  router.get(
    "/super-admin/webhooks/:id/deliveries",
    requirePlatform("integrations.read"),
    asyncRoute(async (req, res) => {
      const { page, pageSize, offset } = pageParams(req);
      res.json({ ...(await listWebhookDeliveries({ endpointId: String(req.params.id), status: q(req, "status") || undefined }, pageSize, offset)), page, pageSize });
    }),
  );
  router.post(
    "/super-admin/webhook-deliveries/:id/retry",
    requirePlatform("integrations.manage"),
    asyncRoute(async (req, res) => {
      const count = await retryWebhookDelivery(String(req.params.id));
      if (!count) throw httpError("Faqat muvaffaqiyatsiz yetkazish qayta yuboriladi.", 409);
      await platformAudit({ req, action: "webhook.retry", entity: "webhook_delivery", entityId: String(req.params.id), summary: "Webhook qayta yuborishga qo‘yildi" });
      res.json({ ok: true });
    }),
  );

  return router;
}

/* ===================================== panel uchun: tarjima va i18n hisoboti === */
/** Ochiq: tarjima override’lari (maxfiy emas) — panel va Mini App tarjimoni shu ro‘yxat bilan to‘ldiriladi. */
export function createPublicI18nRouter() {
  const router = Router();
  router.get(
    "/i18n/overrides",
    rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }),
    asyncRoute(async (req, res) => {
      const lang = q(req, "lang") || "ru";
      const db = await readDb();
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(Object.fromEntries(db.translationOverrides.filter((t) => t.lang === lang).map((t) => [t.source, t.text])));
    }),
  );
  return router;
}

/** Panel (kirgan foydalanuvchi): tarjimasi topilmagan matnlar (agregat, shaxsiy ma’lumotsiz). */
export function createI18nReportRouter() {
  const router = Router();
  router.post(
    "/i18n/missing",
    rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => (req as AuthedRequest).session?.userId || String(req.ip) }),
    asyncRoute(async (req, res) => {
      const input = z.object({ lang: z.enum(["ru"]), texts: z.array(z.string().trim().min(2).max(200)).max(50) }).parse(req.body);
      const store = await opsStore();
      const now = new Date().toISOString();
      for (const text of [...new Set(input.texts)])
        // Raqam, email yoki telefon ko‘rinishidagi matnlar (shaxsiy ma’lumot bo‘lishi mumkin) saqlanmaydi.
        if (/[a-zA-Zʻ‘’]{3,}/.test(text) && !/\d{4,}|@|\+?\d[\d\s-]{7,}/.test(text))
          await store.run("INSERT INTO platform_i18n_missing (lang, text, count, last_seen) VALUES (?,?,1,?) ON CONFLICT (lang, text) DO UPDATE SET count = platform_i18n_missing.count + 1, last_seen = excluded.last_seen", [input.lang, text, now]);
      res.json({ ok: true });
    }),
  );
  return router;
}
