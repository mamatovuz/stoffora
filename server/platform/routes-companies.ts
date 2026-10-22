import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { audit, opsStore, queryAuditLogs, readDb, updateDb } from "../../lib/store";
import type { Company } from "../../lib/types";
import { createCompany, createUser } from "../../lib/seed";
import { dependencyIssues, isModuleKey, MODULE_PRESETS, MODULES, moduleDecision, presetState } from "../../lib/modules";
import { applySubscriptionAction, daysLeft, periodEnd, subscriptionStatus } from "../../lib/platform/subscriptions";
import { describeUserAgent } from "../../lib/platform/security";
import { signPreviewToken } from "../auth";
import { companyDisabledModules, companyModulePolicy } from "../modules";
import { actorOf, assertRecentAuth, asyncRoute, hasPermission, httpError, pageParams, paginate, q, requirePlatform, type PlatformRequest } from "./context";
import { platformAudit, queryPlatformAudit } from "./audit";
import { botState, companyHealth, companyIndex, companyOnboarding, companyRequests, companyResources, isoDay, isLive } from "./analytics";
import { ensurePlans, publicCompany, purgeDemoCompany, seedDemoData, syncCompanyPlan, tempPassword } from "./shared";
import { recordSecurityEvent } from "./security-events";
import { notifyAdmins } from "./notify";
import { publicApiKey, publicWebhook } from "./integrations-api";

/*
 * Kompaniyalarni boshqarish: ro‘yxat (server tomonda filtr, saralash, sahifalash), tafsilot tablari,
 * holat/arxiv, kompaniya panelini ko‘rish (READ_ONLY) va yordam kirishi (SUPPORT), demo kompaniya, onboarding.
 * Har bir yozish amali platforma auditiga va kompaniya auditiga yoziladi.
 */

const companyOr404 = (company: Company | undefined) => {
  if (!company) throw httpError("Kompaniya topilmadi.", 404);
  return company;
};

function companyRow(db: Awaited<ReturnType<typeof readDb>>, c: Company, index: ReturnType<typeof companyIndex>) {
  const r = index.get(c.id)!;
  const plan = c.subscription ? db.subscriptionPlans.find((p) => p.id === c.subscription!.planId) : undefined;
  const disabled = companyDisabledModules(db, c);
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    status: c.status,
    createdAt: c.createdAt,
    timezone: c.timezone,
    plan: plan?.name || c.plan,
    planId: plan?.id,
    subscriptionStatus: c.subscription ? subscriptionStatus(c.subscription) : null,
    periodEnd: c.subscription ? periodEnd(c.subscription) || null : null,
    daysLeft: c.subscription ? daysLeft(c.subscription) : null,
    employees: r.activeEmployees,
    employeeLimit: c.employeeLimit ?? null,
    branches: r.branches,
    leaders: r.leaders,
    owner: r.owner ? { id: r.owner.id, name: r.owner.name, email: r.owner.email } : null,
    ownerName: c.ownerName,
    modulesOn: MODULES.length - disabled.length,
    modulesTotal: MODULES.length,
    lastActivity: r.lastActivity || null,
    archive: c.archive || null,
    demo: c.demo || null,
    internal: Boolean(c.internal),
    bot: botState(c),
  };
}

export function createCompanyRouter() {
  const router = Router();

  /* ----------------------------------------------------------- ro‘yxat --- */
  router.get(
    "/super-admin/companies",
    requirePlatform("companies.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const index = companyIndex(db);
      const view = q(req, "view") || "live";
      const status = q(req, "status");
      const plan = q(req, "plan");
      const text = q(req, "q").toLowerCase();
      const from = q(req, "createdFrom");
      const to = q(req, "createdTo");
      const inactive = Number(q(req, "inactiveDays")) || 0;
      let rows = db.companies
        .filter((c) => (view === "all" ? true : view === "archived" ? Boolean(c.archive) : view === "demo" ? Boolean(c.demo) : isLive(c)))
        .map((c) => companyRow(db, c, index));
      if (status) rows = rows.filter((r) => r.status === status || r.subscriptionStatus === status);
      if (plan) rows = rows.filter((r) => r.planId === plan || r.plan === plan);
      if (from) rows = rows.filter((r) => r.createdAt.slice(0, 10) >= from);
      if (to) rows = rows.filter((r) => r.createdAt.slice(0, 10) <= to);
      if (inactive) {
        const cutoff = new Date(Date.now() - inactive * 86_400_000).toISOString();
        rows = rows.filter((r) => !r.lastActivity || r.lastActivity < cutoff);
      }
      if (text)
        rows = rows.filter((r) => [r.name, r.id, r.slug, r.ownerName, r.owner?.name, r.owner?.email].some((v) => (v || "").toLowerCase().includes(text)));
      const sort = q(req, "sort") || "created";
      const dir = q(req, "dir") === "asc" ? 1 : -1;
      const key: Record<string, (r: (typeof rows)[number]) => string | number> = {
        name: (r) => r.name.toLowerCase(),
        created: (r) => r.createdAt,
        employees: (r) => r.employees,
        branches: (r) => r.branches,
        activity: (r) => r.lastActivity || "",
        modules: (r) => r.modulesOn,
      };
      const pick = key[sort] || key.created;
      rows.sort((a, b) => (pick(a) > pick(b) ? dir : pick(a) < pick(b) ? -dir : 0));
      const { page, pageSize } = pageParams(req);
      res.json({
        ...paginate(rows, page, pageSize),
        facets: {
          plans: [...new Map(db.subscriptionPlans.map((p) => [p.id, p.name])).entries()].map(([id, name]) => ({ id, name })),
          views: { live: db.companies.filter(isLive).length, archived: db.companies.filter((c) => c.archive).length, demo: db.companies.filter((c) => c.demo).length, all: db.companies.length },
        },
      });
    }),
  );

  /* ---------------------------------------------------------- yaratish --- */
  router.post(
    "/super-admin/companies",
    requirePlatform("companies.create"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          name: z.string().trim().min(2).max(120),
          ownerName: z.string().trim().min(2).max(120),
          ownerEmail: z.string().trim().email(),
          ownerPassword: z.union([z.string().min(10, "Parol kamida 10 belgi bo‘lsin."), z.literal("")]).optional(),
          planId: z.string().optional(),
          status: z.enum(["ACTIVE", "TRIAL"]).default("TRIAL"),
          timezone: z.string().max(60).optional(),
          preset: z.string().optional(),
          internal: z.boolean().optional(),
        })
        .parse(req.body);
      const actor = actorOf(req);
      const password = input.ownerPassword || tempPassword();
      const owner = await createUser({ name: input.ownerName, email: input.ownerEmail, password, role: "COMPANY_OWNER" });
      const company = await updateDb((db) => {
        if (db.users.some((u) => u.email === owner.email)) throw httpError("Bu email bilan foydalanuvchi mavjud.", 409);
        ensurePlans(db);
        const row = createCompany({ name: input.name, ownerName: input.ownerName, status: input.status });
        if (db.companies.some((c) => c.slug === row.slug)) row.slug = `${row.slug}-${Date.now().toString(36)}`;
        if (input.timezone) row.timezone = input.timezone;
        if (input.internal) row.internal = true;
        const planId = input.planId || db.subscriptionPlans.find((p) => p.key === (input.status === "TRIAL" ? "pro" : "free") && p.status === "ACTIVE")?.id;
        if (planId) {
          row.subscription = applySubscriptionAction(undefined, db.subscriptionPlans, { action: "change_plan", planId }, actor.name);
          const trialDays = db.platformSettings?.trialDays;
          if (input.status === "TRIAL" && trialDays && row.subscription.status === "TRIAL") row.subscription.trialEndsAt = new Date(Date.now() + trialDays * 86_400_000).toISOString();
          if (input.status === "ACTIVE") {
            row.subscription.status = "ACTIVE";
            row.subscription.trialEndsAt = undefined;
          }
          syncCompanyPlan(db, row);
        }
        const preset = MODULE_PRESETS.find((p) => p.key === input.preset);
        if (preset && preset.enabled !== "all") {
          const state = presetState(preset);
          const off = Object.fromEntries(Object.entries(state).filter(([, on]) => !on).map(([k]) => [k, false]));
          row.modules = Object.keys(off).length ? off : undefined;
        } else {
          // Global katalogda «yangi kompaniyalarda o‘chiq» deb belgilangan modullar.
          const defaults = Object.entries(db.platformSettings?.modules || {}).filter(([, v]) => v?.defaultEnabled === false).map(([k]) => [k, false]);
          if (defaults.length) row.modules = Object.fromEntries(defaults);
        }
        owner.companyId = row.id;
        db.companies.push(row);
        db.users.push(owner);
        db.auditLogs.unshift(audit(row.id, actor.name, "Platforma: kompaniya yaratildi", "company", row.id));
        return row;
      });
      await platformAudit({ req, companyId: company.id, action: "company.create", entity: "company", entityId: company.id, summary: `Kompaniya yaratildi: ${company.name}`, details: { plan: company.plan, status: company.status } });
      void notifyAdmins({ key: `company:${company.id}`, text: `🆕 Yangi kompaniya: ${company.name}`, permission: "companies.read", cooldownMinutes: 1 });
      res.status(201).json({ company: publicCompany(company), owner: { email: owner.email, password: input.ownerPassword ? undefined : password } });
    }),
  );

  /* --------------------------------------------------------- tafsilot --- */
  router.get(
    "/super-admin/companies/:id",
    requirePlatform("companies.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const company = companyOr404(db.companies.find((c) => c.id === req.params.id));
      const index = companyIndex(db);
      const requests = await companyRequests(company.id);
      const health = await companyHealth(db, company, requests);
      const plan = company.subscription ? db.subscriptionPlans.find((p) => p.id === company.subscription!.planId) : undefined;
      res.json({
        company: publicCompany(company),
        row: companyRow(db, company, index),
        plan: plan || null,
        subscription: company.subscription ? { ...company.subscription, computedStatus: subscriptionStatus(company.subscription), daysLeft: daysLeft(company.subscription), periodEnd: periodEnd(company.subscription) || null } : null,
        counts: (() => {
          const r = index.get(company.id)!;
          return {
            activeEmployees: r.activeEmployees,
            dismissed: r.dismissed,
            branches: r.branches,
            users: r.users,
            leaders: r.leaders,
            telegramLinked: r.telegramLinked,
            faceEnrolled: r.faceEnrolled,
            attendance7d: r.attendance7d,
            attendanceTotal: r.attendanceTotal,
            openTickets: db.supportTickets.filter((t) => t.companyId === company.id && !["RESOLVED", "CLOSED"].includes(t.status)).length,
          };
        })(),
        traffic7d: requests.get(company.id) || { requests: 0, errors: 0 },
        health,
        onboarding: companyOnboarding(db, company),
        previews: db.previewSessions.filter((p) => p.companyId === company.id).slice(0, 10),
      });
    }),
  );

  router.patch(
    "/super-admin/companies/:id",
    requirePlatform("companies.manage"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          name: z.string().trim().min(2).max(120).optional(),
          timezone: z.string().trim().max(60).optional(),
          adminNote: z.string().trim().max(2000).optional(),
          internal: z.boolean().optional(),
          limitContact: z.string().trim().max(80).optional(),
          onboardingNotes: z.record(z.string().max(300)).optional(),
        })
        .parse(req.body);
      const actor = actorOf(req);
      const result = await updateDb((db) => {
        const company = companyOr404(db.companies.find((c) => c.id === req.params.id));
        const before = { name: company.name, timezone: company.timezone, internal: company.internal, limitContact: company.limitContact };
        if (input.name) company.name = input.name;
        if (input.timezone) {
          try {
            new Intl.DateTimeFormat("en", { timeZone: input.timezone });
          } catch {
            throw httpError("Vaqt mintaqasi noto‘g‘ri (masalan, Asia/Tashkent).", 400);
          }
          company.timezone = input.timezone;
        }
        if (input.adminNote !== undefined) company.adminNote = input.adminNote || undefined;
        if (input.internal !== undefined) company.internal = input.internal || undefined;
        if (input.limitContact !== undefined) company.limitContact = input.limitContact || undefined;
        if (input.onboardingNotes) {
          const notes = Object.fromEntries(Object.entries(input.onboardingNotes).filter(([, v]) => v.trim()));
          company.onboardingNotes = Object.keys(notes).length ? notes : undefined;
        }
        const after = { name: company.name, timezone: company.timezone, internal: company.internal, limitContact: company.limitContact };
        db.auditLogs.unshift(audit(company.id, actor.name, "Platforma: kompaniya sozlamasi o‘zgartirildi", "company", company.id, before, after));
        return { company, before, after };
      });
      await platformAudit({ req, companyId: result.company.id, action: "company.update", entity: "company", entityId: result.company.id, summary: `Kompaniya sozlamasi o‘zgartirildi: ${result.company.name}`, details: { before: result.before, after: result.after } });
      res.json(publicCompany(result.company));
    }),
  );

  /** Bloklash / faollashtirish. */
  router.post(
    "/super-admin/companies/:id/status",
    requirePlatform("companies.manage"),
    asyncRoute(async (req, res) => {
      const input = z.object({ status: z.enum(["ACTIVE", "TRIAL", "SUSPENDED"]), reason: z.string().trim().max(500).optional() }).parse(req.body);
      if (input.status === "SUSPENDED" && !input.reason) throw httpError("Bloklash sababini yozing.", 400);
      const actor = actorOf(req);
      const result = await updateDb((db) => {
        const company = companyOr404(db.companies.find((c) => c.id === req.params.id));
        if (company.archive) throw httpError("Arxivdagi kompaniya — avval tiklang.", 409);
        const before = company.status;
        company.status = input.status;
        db.auditLogs.unshift(audit(company.id, actor.name, input.status === "SUSPENDED" ? `Platforma: kompaniya bloklandi (${input.reason})` : "Platforma: kompaniya holati o‘zgartirildi", "company", company.id, { status: before }, { status: input.status }));
        return { company, before };
      });
      await platformAudit({
        req,
        companyId: result.company.id,
        action: input.status === "SUSPENDED" ? "company.block" : "company.status",
        entity: "company",
        entityId: result.company.id,
        summary: `${result.company.name}: ${result.before} → ${input.status}${input.reason ? ` (${input.reason})` : ""}`,
        privileged: input.status === "SUSPENDED",
      });
      res.json(publicCompany(result.company));
    }),
  );

  router.post(
    "/super-admin/companies/:id/archive",
    requirePlatform("companies.archive"),
    asyncRoute(async (req, res) => {
      const { reason } = z.object({ reason: z.string().trim().min(3, "Arxivlash sababini yozing.").max(500) }).parse(req.body);
      assertRecentAuth(req, await readDb());
      const actor = actorOf(req);
      const company = await updateDb((db) => {
        const row = companyOr404(db.companies.find((c) => c.id === req.params.id));
        if (row.archive) throw httpError("Kompaniya allaqachon arxivda.", 409);
        // Ma’lumot o‘chirilmaydi: kompaniya to‘xtatiladi (kirish va botlar ishlamaydi), tiklash mumkin.
        row.archive = { at: new Date().toISOString(), by: actor.name, reason, previousStatus: row.status };
        row.status = "SUSPENDED";
        db.auditLogs.unshift(audit(row.id, actor.name, `Platforma: kompaniya arxivlandi (${reason})`, "company", row.id));
        return row;
      });
      await platformAudit({ req, companyId: company.id, action: "company.archive", entity: "company", entityId: company.id, summary: `Arxivlandi: ${company.name} — ${reason}`, privileged: true });
      res.json(publicCompany(company));
    }),
  );

  router.post(
    "/super-admin/companies/:id/restore",
    requirePlatform("companies.archive"),
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      const company = await updateDb((db) => {
        const row = companyOr404(db.companies.find((c) => c.id === req.params.id));
        if (!row.archive) throw httpError("Kompaniya arxivda emas.", 409);
        row.status = row.archive.previousStatus || "ACTIVE";
        row.archive = undefined;
        db.auditLogs.unshift(audit(row.id, actor.name, "Platforma: kompaniya arxivdan tiklandi", "company", row.id));
        return row;
      });
      await platformAudit({ req, companyId: company.id, action: "company.restore", entity: "company", entityId: company.id, summary: `Arxivdan tiklandi: ${company.name}`, privileged: true });
      res.json(publicCompany(company));
    }),
  );

  /* ------------------------------------------------------------- tablar --- */
  router.get(
    "/super-admin/companies/:id/leaders",
    requirePlatform("companies.read", "users.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      companyOr404(db.companies.find((c) => c.id === req.params.id));
      const now = new Date().toISOString();
      const users = db.users
        .filter((u) => u.companyId === req.params.id || u.extraCompanyIds?.includes(String(req.params.id)))
        .map((u) => {
          const sessions = db.panelSessions.filter((s) => s.userId === u.id && !s.revokedAt);
          return {
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            primary: u.companyId === req.params.id,
            branchIds: u.branchIds || [],
            telegramLinked: Boolean(u.telegramId),
            twoFactor: Boolean(u.twoFactorEnabled && u.telegramId),
            blockedAt: u.blockedAt || null,
            blockReason: u.blockReason || null,
            lastLoginAt: u.lastLoginAt || null,
            lastSeenAt: sessions.map((s) => s.lastSeenAt).sort().pop() || null,
            activeSessions: sessions.filter((s) => s.lastSeenAt > new Date(Date.now() - 12 * 3600_000).toISOString()).length,
            autoRole: Boolean(u.autoRole),
            extraCompanies: (u.extraCompanyIds || []).length,
          };
        })
        .sort((a, b) => Number(b.role === "COMPANY_OWNER") - Number(a.role === "COMPANY_OWNER") || a.name.localeCompare(b.name));
      res.json({ users, now });
    }),
  );

  router.get(
    "/super-admin/companies/:id/employees",
    requirePlatform("companies.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      companyOr404(db.companies.find((c) => c.id === req.params.id));
      const text = q(req, "q").toLowerCase();
      const status = q(req, "status") || "ACTIVE";
      const branch = (id: string) => db.branches.find((b) => b.id === id)?.name || "—";
      const position = (id: string) => db.positions.find((p) => p.id === id)?.name || "—";
      // Minimal shaxsiy ma’lumot: telefon, manzil, pasport, oylik — ko‘rsatilmaydi.
      const rows = db.employees
        .filter((e) => e.companyId === req.params.id && (status === "ALL" || e.status === status))
        .filter((e) => !text || `${e.firstName} ${e.lastName} ${e.employeeNo}`.toLowerCase().includes(text))
        .sort((a, b) => a.lastName.localeCompare(b.lastName))
        .map((e) => ({ id: e.id, employeeNo: e.employeeNo, name: `${e.lastName} ${e.firstName}`, status: e.status, branch: branch(e.branchId), position: position(e.positionId), telegram: e.telegramConnected, face: Boolean(e.faceEnrolledAt), startDate: e.startDate }));
      const { page, pageSize } = pageParams(req);
      res.json(paginate(rows, page, pageSize));
    }),
  );

  router.get(
    "/super-admin/companies/:id/branches",
    requirePlatform("companies.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      companyOr404(db.companies.find((c) => c.id === req.params.id));
      const today = isoDay(0);
      res.json(
        db.branches
          .filter((b) => b.companyId === req.params.id)
          .map((b) => ({
            id: b.id,
            name: b.name,
            address: b.address,
            status: b.status,
            radiusMeters: b.radiusMeters,
            attendanceMode: (b as { attendanceMode?: string }).attendanceMode || null,
            employees: db.employees.filter((e) => e.branchId === b.id && e.status === "ACTIVE").length,
            today: db.attendance.filter((a) => a.branchId === b.id && a.date === today).length,
          })),
      );
    }),
  );

  router.get(
    "/super-admin/companies/:id/modules",
    requirePlatform("companies.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const company = companyOr404(db.companies.find((c) => c.id === req.params.id));
      const policy = companyModulePolicy(db, company);
      res.json({
        presets: MODULE_PRESETS.map((p) => ({ key: p.key, label: p.label, description: p.description })),
        modules: MODULES.map((m) => {
          const decision = moduleDecision(company.modules, m.key, policy);
          return {
            key: m.key,
            label: m.label,
            description: m.description,
            group: m.group,
            dependsOn: (m as { dependsOn?: string[] }).dependsOn || [],
            base: company.modules?.[m.key] !== false,
            enabled: decision.enabled,
            reason: decision.reason,
            override: company.moduleOverrides?.[m.key] || null,
            global: db.platformSettings?.modules?.[m.key] || null,
          };
        }),
      });
    }),
  );

  router.patch(
    "/super-admin/companies/:id/modules/:key",
    requirePlatform("modules.manage"),
    asyncRoute(async (req, res) => {
      const key = String(req.params.key);
      if (!isModuleKey(key)) throw httpError("Noma’lum modul.", 400);
      const input = z
        .object({
          mode: z.enum(["base", "override", "clear_override"]),
          enabled: z.boolean().optional(),
          expiresAt: z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
          trial: z.boolean().optional(),
          limits: z.record(z.number().int().min(0).max(1_000_000)).optional(),
          note: z.string().trim().max(300).optional(),
          cascade: z.boolean().optional(),
        })
        .parse(req.body);
      const actor = actorOf(req);
      const result = await updateDb((db) => {
        const company = companyOr404(db.companies.find((c) => c.id === req.params.id));
        const before = { base: company.modules?.[key] !== false, override: company.moduleOverrides?.[key] || null };
        if (input.mode === "base") {
          if (input.enabled === undefined) throw httpError("enabled kerak.", 400);
          const next: Record<string, boolean> = { ...(company.modules as Record<string, boolean>), [key]: input.enabled };
          const issues = dependencyIssues(next).filter((i) => i.key === key);
          const issue = issues[0];
          if (issue && (issue.needs.length || issue.requiredBy.length)) {
            if (!input.cascade)
              throw Object.assign(httpError(issue.needs.length ? `Avval bog‘liq modullarni yoqing: ${issue.needs.join(", ")}` : `Bu modulga bog‘liq modullar ham o‘chadi: ${issue.requiredBy.join(", ")}`, 409, "MODULE_DEPENDENCY"), { issue });
            for (const dep of issue.needs) next[dep] = true;
            for (const dep of issue.requiredBy) next[dep] = false;
          }
          const off = Object.fromEntries(Object.entries(next).filter(([k, on]) => isModuleKey(k) && on === false));
          company.modules = Object.keys(off).length ? off : undefined;
        } else if (input.mode === "override") {
          if (input.enabled === undefined) throw httpError("enabled kerak.", 400);
          const expiresAt = input.expiresAt ? new Date(input.expiresAt.length === 10 ? `${input.expiresAt}T23:59:59+05:00` : input.expiresAt).toISOString() : undefined;
          if (expiresAt && expiresAt < new Date().toISOString()) throw httpError("Muddat o‘tmishda bo‘lmasin.", 400);
          company.moduleOverrides = {
            ...(company.moduleOverrides || {}),
            [key]: { enabled: input.enabled, expiresAt, trial: input.trial || undefined, limits: input.limits, note: input.note || undefined, updatedAt: new Date().toISOString(), updatedBy: actor.name },
          };
        } else {
          const rest = { ...(company.moduleOverrides || {}) };
          delete rest[key];
          company.moduleOverrides = Object.keys(rest).length ? rest : undefined;
        }
        const after = { base: company.modules?.[key] !== false, override: company.moduleOverrides?.[key] || null };
        db.auditLogs.unshift(audit(company.id, actor.name, `Platforma: «${MODULES.find((m) => m.key === key)?.label}» moduli o‘zgartirildi`, "company", company.id, before, after));
        return { company, before, after };
      });
      await platformAudit({ req, companyId: result.company.id, action: "module.toggle", entity: "module", entityId: key, summary: `${result.company.name}: ${key} (${input.mode})`, details: { before: result.before, after: result.after } });
      res.json({ ok: true, disabled: companyDisabledModules(await readDb(), result.company) });
    }),
  );

  router.post(
    "/super-admin/companies/:id/modules/preset",
    requirePlatform("modules.manage"),
    asyncRoute(async (req, res) => {
      const { preset } = z.object({ preset: z.string() }).parse(req.body);
      const chosen = MODULE_PRESETS.find((p) => p.key === preset);
      if (!chosen) throw httpError("To‘plam topilmadi.", 404);
      const actor = actorOf(req);
      const company = await updateDb((db) => {
        const row = companyOr404(db.companies.find((c) => c.id === req.params.id));
        const state = presetState(chosen);
        const off = Object.fromEntries(Object.entries(state).filter(([, on]) => !on).map(([k]) => [k, false]));
        row.modules = Object.keys(off).length ? off : undefined;
        db.auditLogs.unshift(audit(row.id, actor.name, `Platforma: modullar «${chosen.label}» to‘plamiga o‘tkazildi`, "company", row.id));
        return row;
      });
      await platformAudit({ req, companyId: company.id, action: "module.preset", entity: "company", entityId: company.id, summary: `${company.name}: modullar to‘plami — ${chosen.label}` });
      res.json({ ok: true });
    }),
  );

  router.get(
    "/super-admin/companies/:id/activity",
    requirePlatform("companies.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const company = companyOr404(db.companies.find((c) => c.id === req.params.id));
      const days = Math.max(7, Math.min(90, Number(req.query.days) || 30));
      const from = isoDay(-days + 1);
      const store = await opsStore();
      const usage = await store.all<{ day: string; metric: string; value: number | string }>("SELECT day, metric, value FROM platform_usage WHERE company_id = ? AND day >= ? AND metric IN ('api_requests','api_errors','employee_requests')", [company.id, from]);
      const users = await store.all<{ day: string; n: number | string }>("SELECT day, COUNT(*) AS n FROM platform_active_users WHERE company_id = ? AND day >= ? GROUP BY day", [company.id, from]);
      const att = new Map<string, { records: number; late: number }>();
      for (const a of db.attendance) {
        if (a.companyId !== company.id || a.date < from) continue;
        const item = att.get(a.date) || { records: 0, late: 0 };
        item.records += 1;
        if (a.lateMinutes > 0) item.late += 1;
        att.set(a.date, item);
      }
      const series = Array.from({ length: days }, (_, i) => {
        const day = isoDay(-days + 1 + i);
        const metric = (name: string) => Number(usage.find((u) => u.day === day && u.metric === name)?.value || 0);
        return { date: day, attendance: att.get(day)?.records || 0, late: att.get(day)?.late || 0, requests: metric("api_requests"), errors: metric("api_errors"), employeeRequests: metric("employee_requests"), activeUsers: Number(users.find((u) => u.day === day)?.n || 0) };
      });
      res.json({ days, series });
    }),
  );

  /** Kompaniya tarixi: platforma auditi + kompaniyaning o‘z audit jurnali (birlashtirilgan, takrorlanmaydi). */
  router.get(
    "/super-admin/companies/:id/timeline",
    requirePlatform("companies.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const company = companyOr404(db.companies.find((c) => c.id === req.params.id));
      const { page, pageSize, offset } = pageParams(req, 100);
      const platform = hasPermission(req, "audit.read") || hasPermission(req, "companies.manage") ? await queryPlatformAudit({ companyId: company.id }, offset + pageSize, 0) : { rows: [], total: 0 };
      const local = await queryAuditLogs(company.id, { limit: Math.min(1000, offset + pageSize) });
      const items = [
        { id: `created:${company.id}`, at: company.createdAt, source: "system", action: "company.created", title: "Kompaniya yaratildi", actor: "" },
        ...platform.rows.map((r) => ({ id: r.id, at: r.at, source: "platform", action: r.action, title: r.summary, actor: r.actorName })),
        // Platforma amallari kompaniya jurnaliga ham yoziladi — ular takrorlanmasin.
        ...local.filter((l) => !l.action.startsWith("Platforma:") && !l.action.startsWith("Super admin")).map((l) => ({ id: l.id, at: l.createdAt, source: "company", action: l.entity, title: l.action, actor: l.actor })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      res.json({ rows: items.slice(offset, offset + pageSize), total: Math.max(items.length, platform.total), page, pageSize });
    }),
  );

  router.get(
    "/super-admin/companies/:id/devices",
    requirePlatform("companies.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const company = companyOr404(db.companies.find((c) => c.id === req.params.id));
      const userIds = new Set(db.users.filter((u) => u.companyId === company.id).map((u) => u.id));
      const name = (id: string) => db.users.find((u) => u.id === id)?.name || "—";
      const employee = (id: string) => {
        const e = db.employees.find((x) => x.id === id);
        return e ? `${e.lastName} ${e.firstName}` : "—";
      };
      res.json({
        panel: db.panelSessions
          .filter((s) => userIds.has(s.userId))
          .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
          .slice(0, 200)
          .map((s) => ({ id: s.id, userId: s.userId, user: name(s.userId), ...describeUserAgent(s.userAgent), ip: s.ip, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, revokedAt: s.revokedAt || null })),
        mobile: db.mobileDevices
          .filter((d) => d.companyId === company.id)
          .slice(0, 300)
          .map((d) => ({ id: d.id, employee: employee(d.employeeId), platform: d.platform, model: d.model || null, appVersion: d.appVersion || null, status: d.status, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt || null, revokedAt: d.revokedAt || null })),
        biometric: db.biometricDevices.filter((d) => d.companyId === company.id && !d.revokedAt).length,
      });
    }),
  );

  router.get(
    "/super-admin/companies/:id/integrations",
    requirePlatform("integrations.read", "companies.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const company = companyOr404(db.companies.find((c) => c.id === req.params.id));
      const integration = db.integrations.find((i) => i.companyId === company.id && i.status !== "DISCONNECTED");
      res.json({
        bot: company.bot ? { enabled: company.bot.enabled, username: company.bot.username || null, status: company.bot.status || null, lastError: company.bot.lastError || null, mode: company.bot.mode || null } : null,
        integration: integration ? { id: integration.id, name: integration.name, status: integration.status, baseUrl: integration.baseUrl, lastSyncAt: integration.lastSyncAt || null, lastError: integration.lastError || null } : null,
        photoChannel: company.photoChannel ? { enabled: company.photoChannel.enabled } : null,
        apiKeys: db.apiKeys.filter((k) => k.companyId === company.id).map(publicApiKey),
        webhooks: db.webhookEndpoints.filter((w) => w.companyId === company.id).map(publicWebhook),
      });
    }),
  );

  router.get(
    "/super-admin/companies/:id/health",
    requirePlatform("companies.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const company = companyOr404(db.companies.find((c) => c.id === req.params.id));
      const store = await opsStore();
      const history = await store.all<{ day: string; score: number | string }>("SELECT day, score FROM company_health WHERE company_id = ? AND day >= ? ORDER BY day", [company.id, isoDay(-90)]);
      res.json({ current: await companyHealth(db, company), history: history.map((h) => ({ day: h.day, score: Number(h.score) })) });
    }),
  );

  router.get(
    "/super-admin/companies/:id/resources",
    requirePlatform("companies.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const company = companyOr404(db.companies.find((c) => c.id === req.params.id));
      res.json(await companyResources(db, company.id));
    }),
  );

  /* -------------------------------------- kompaniya panelini ko‘rish --- */
  router.post(
    "/super-admin/companies/:id/preview",
    requirePlatform("companies.preview"),
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      const minutes = 30;
      const session = await updateDb((db) => {
        const company = companyOr404(db.companies.find((c) => c.id === req.params.id));
        const now = new Date();
        const record = {
          id: randomUUID(),
          adminId: actor.id,
          adminName: actor.name,
          companyId: company.id,
          mode: "READ_ONLY" as const,
          status: "ACTIVE" as const,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
          ip: String(req.ip || "").replace(/^::ffff:/, ""),
        };
        db.previewSessions.unshift(record);
        db.auditLogs.unshift(audit(company.id, actor.name, "Platforma: kompaniya paneli ko‘rish rejimida ochildi", "company", company.id));
        return { record, company };
      });
      await platformAudit({ req, companyId: session.company.id, action: "company.preview", entity: "preview", entityId: session.record.id, summary: `Panel ko‘rish rejimida ochildi: ${session.company.name}`, privileged: true });
      void recordSecurityEvent({ type: "PREVIEW_STARTED", severity: "MEDIUM", userId: actor.id, subject: session.company.name, req });
      const token = signPreviewToken({ previewId: session.record.id, adminId: actor.id, companyId: session.company.id, mode: "READ_ONLY", ttlSeconds: minutes * 60 });
      res.json({ url: `/preview#${token}`, expiresAt: session.record.expiresAt, id: session.record.id });
    }),
  );

  /** Yozish huquqli yordam kirishi: global sozlamada yoqilgan bo‘lishi, sabab, vaqt chegarasi, Owner tasdig‘i. */
  router.post(
    "/super-admin/companies/:id/support-access",
    requirePlatform("companies.support"),
    asyncRoute(async (req, res) => {
      const input = z.object({ reason: z.string().trim().min(10, "Sababni batafsil yozing (kamida 10 belgi).").max(500), minutes: z.coerce.number().int().min(5).max(60) }).parse(req.body);
      const db = await readDb();
      if (!db.platformSettings?.supportAccessEnabled) throw httpError("Yordam kirishi global sozlamalarda o‘chirilgan.", 403, "SUPPORT_ACCESS_DISABLED");
      assertRecentAuth(req, db);
      const actor = actorOf(req);
      const record = await updateDb((next) => {
        const company = companyOr404(next.companies.find((c) => c.id === req.params.id));
        const now = new Date();
        const row = {
          id: randomUUID(),
          adminId: actor.id,
          adminName: actor.name,
          companyId: company.id,
          mode: "SUPPORT" as const,
          reason: input.reason,
          // Owner o‘zi tasdiqlangan hisoblanadi; boshqalar uchun ikkinchi Owner tasdig‘i kerak.
          status: actor.role === "OWNER" ? ("ACTIVE" as const) : ("PENDING_APPROVAL" as const),
          approvedBy: actor.role === "OWNER" ? actor.name : undefined,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + input.minutes * 60_000).toISOString(),
          ip: String(req.ip || "").replace(/^::ffff:/, ""),
        };
        next.previewSessions.unshift(row);
        next.auditLogs.unshift(audit(company.id, actor.name, `Platforma: yordam kirishi so‘raldi (${input.reason})`, "company", company.id));
        return row;
      });
      await platformAudit({ req, companyId: record.companyId, action: "company.support_access", entity: "preview", entityId: record.id, summary: `Yordam kirishi (${record.status}): ${input.reason}`, privileged: true });
      void recordSecurityEvent({ type: "SUPPORT_ACCESS", severity: "HIGH", userId: actor.id, subject: record.companyId, req, detail: input.reason });
      if (record.status === "PENDING_APPROVAL")
        void notifyAdmins({ key: `support-access:${record.id}`, text: `🔐 ${actor.name} yordam kirishini so‘radi: ${input.reason}`, permission: "admins.manage", cooldownMinutes: 1 });
      const url = record.status === "ACTIVE" ? `/preview#${signPreviewToken({ previewId: record.id, adminId: actor.id, companyId: record.companyId, mode: "SUPPORT", ttlSeconds: input.minutes * 60 })}` : null;
      res.status(201).json({ session: record, url });
    }),
  );

  router.get(
    "/super-admin/preview-sessions",
    requirePlatform("companies.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const companyId = q(req, "companyId");
      res.json(db.previewSessions.filter((p) => !companyId || p.companyId === companyId).slice(0, 200));
    }),
  );

  router.post(
    "/super-admin/preview-sessions/:id/approve",
    requirePlatform("admins.manage"),
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      if (actor.role !== "OWNER") throw httpError("Faqat Platform Owner tasdiqlaydi.", 403);
      const record = await updateDb((db) => {
        const row = db.previewSessions.find((p) => p.id === req.params.id);
        if (!row || row.status !== "PENDING_APPROVAL") throw httpError("Tasdiqlanadigan so‘rov topilmadi.", 404);
        if (row.adminId === actor.id) throw httpError("O‘z so‘rovingizni tasdiqlay olmaysiz.", 409);
        row.status = "ACTIVE";
        row.approvedBy = actor.name;
        // Muddat tasdiqlangan paytdan boshlanadi.
        const minutes = Math.round((Date.parse(row.expiresAt) - Date.parse(row.createdAt)) / 60_000);
        row.expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
        return row;
      });
      await platformAudit({ req, companyId: record.companyId, action: "company.support_approve", entity: "preview", entityId: record.id, summary: `Yordam kirishi tasdiqlandi (${record.adminName})`, privileged: true });
      res.json(record);
    }),
  );

  /** Tasdiqlangan yordam kirishi uchun havola (faqat so‘ragan administrator). */
  router.post(
    "/super-admin/preview-sessions/:id/link",
    requirePlatform("companies.support"),
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      const db = await readDb();
      const record = db.previewSessions.find((p) => p.id === req.params.id);
      if (!record || record.adminId !== actor.id || record.status !== "ACTIVE" || record.expiresAt < new Date().toISOString()) throw httpError("Faol yordam kirishi topilmadi.", 404);
      const ttl = Math.round((Date.parse(record.expiresAt) - Date.now()) / 1000);
      res.json({ url: `/preview#${signPreviewToken({ previewId: record.id, adminId: actor.id, companyId: record.companyId, mode: record.mode, ttlSeconds: ttl })}` });
    }),
  );

  router.post(
    "/super-admin/preview-sessions/:id/end",
    requirePlatform("companies.preview"),
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      const record = await updateDb((db) => {
        const row = db.previewSessions.find((p) => p.id === req.params.id);
        if (!row) throw httpError("Sessiya topilmadi.", 404);
        if (row.status === "ACTIVE" || row.status === "PENDING_APPROVAL") {
          row.status = row.status === "PENDING_APPROVAL" ? "REJECTED" : "ENDED";
          row.endedAt = new Date().toISOString();
          row.endedBy = actor.name;
        }
        return row;
      });
      await platformAudit({ req, companyId: record.companyId, action: "company.preview_end", entity: "preview", entityId: record.id, summary: `Ko‘rish/yordam sessiyasi tugatildi (${record.mode})` });
      res.json(record);
    }),
  );

  /** Egasi parolni unutgan: vaqtinchalik parol bir marta ko‘rsatiladi, eski sessiyalar yopiladi. */
  router.post(
    "/super-admin/companies/:id/reset-owner-password",
    requirePlatform("users.manage"),
    asyncRoute(async (req, res) => {
      assertRecentAuth(req, await readDb());
      const password = tempPassword(12);
      const passwordHash = await bcrypt.hash(password, 12);
      const actor = actorOf(req);
      const owner = await updateDb((db) => {
        const user = db.users.find((u) => u.companyId === String(req.params.id) && u.role === "COMPANY_OWNER");
        if (!user) throw httpError("Kompaniya egasi topilmadi.", 404);
        user.passwordHash = passwordHash;
        const now = new Date().toISOString();
        for (const row of db.panelSessions) if (row.userId === user.id && !row.revokedAt) row.revokedAt = now;
        db.auditLogs.unshift(audit(String(req.params.id), actor.name, "Platforma: egasining paroli tiklandi", "user", user.id));
        return { id: user.id, email: user.email, name: user.name };
      });
      await platformAudit({ req, companyId: String(req.params.id), action: "user.password_reset", entity: "user", entityId: owner.id, summary: `Egasining paroli tiklandi: ${owner.email}`, privileged: true });
      res.json({ email: owner.email, name: owner.name, password });
    }),
  );

  /* ------------------------------------------------------------ demo --- */
  router.post(
    "/super-admin/demo-companies",
    requirePlatform("companies.create"),
    asyncRoute(async (req, res) => {
      const input = z.object({ name: z.string().trim().min(2).max(80).optional(), days: z.coerce.number().int().min(1).max(30).optional() }).parse(req.body);
      const actor = actorOf(req);
      const password = tempPassword();
      const suffix = Date.now().toString(36).slice(-5);
      const owner = await createUser({ name: "Demo Rahbar", email: `demo-${suffix}@demo.staffora.local`, password, role: "COMPANY_OWNER" });
      const company = await updateDb((db) => {
        ensurePlans(db);
        const ttl = input.days || db.platformSettings?.demo?.ttlDays || 7;
        const row = createCompany({ name: input.name || `Demo kompaniya ${suffix.toUpperCase()}`, ownerName: "Demo Rahbar", status: "TRIAL" });
        row.slug = `demo-${suffix}`;
        row.internal = true;
        row.demo = { createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + ttl * 86_400_000).toISOString(), createdBy: actor.name };
        const pro = db.subscriptionPlans.find((p) => p.key === "pro" && p.status === "ACTIVE") || db.subscriptionPlans.find((p) => p.status === "ACTIVE");
        if (pro) {
          row.subscription = applySubscriptionAction(undefined, db.subscriptionPlans, { action: "change_plan", planId: pro.id }, actor.name);
          syncCompanyPlan(db, row);
        }
        owner.companyId = row.id;
        db.companies.push(row);
        db.users.push(owner);
        seedDemoData(db, row);
        db.auditLogs.unshift(audit(row.id, actor.name, "Platforma: demo kompaniya yaratildi (sintetik ma’lumot)", "company", row.id));
        return row;
      });
      await platformAudit({ req, companyId: company.id, action: "company.demo_create", entity: "company", entityId: company.id, summary: `Demo kompaniya: ${company.name} (muddati ${company.demo!.expiresAt.slice(0, 10)})` });
      res.status(201).json({ company: publicCompany(company), owner: { email: owner.email, password } });
    }),
  );

  router.post(
    "/super-admin/companies/:id/demo/cleanup",
    requirePlatform("companies.create"),
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      const name = await updateDb((db) => {
        const company = companyOr404(db.companies.find((c) => c.id === req.params.id));
        if (!company.demo) throw httpError("Faqat demo kompaniya tozalanadi.", 409);
        purgeDemoCompany(db, company.id);
        return company.name;
      });
      await platformAudit({ req, action: "company.demo_cleanup", entity: "company", entityId: String(req.params.id), summary: `Demo kompaniya tozalandi: ${name} (${actor.name})` });
      res.json({ ok: true });
    }),
  );

  /* ------------------------------------------------------- onboarding --- */
  router.get(
    "/super-admin/onboarding",
    requirePlatform("companies.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const filter = q(req, "filter");
      const rows = db.companies
        .filter(isLive)
        .map((c) => {
          const onboarding = companyOnboarding(db, c);
          return { id: c.id, name: c.name, createdAt: c.createdAt, status: c.status, ...onboarding };
        })
        .filter((r) => (filter === "attention" ? r.attention > 0 : filter === "incomplete" ? r.percent < 100 : filter === "done" ? r.percent === 100 : true))
        .sort((a, b) => a.percent - b.percent || b.createdAt.localeCompare(a.createdAt));
      const { page, pageSize } = pageParams(req);
      res.json({ ...paginate(rows, page, pageSize), summary: { total: rows.length, completed: rows.filter((r) => r.percent === 100).length, attention: rows.filter((r) => r.attention > 0).length } });
    }),
  );

  return router;
}

