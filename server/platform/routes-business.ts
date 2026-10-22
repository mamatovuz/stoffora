import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { audit, documentFiles, readDb, updateDb } from "../../lib/store";
import { isModuleKey } from "../../lib/modules";
import type { BillingRecord, BillingStatus, CompanyContract, PromoCode, SubscriptionPlan } from "../../lib/platform/types";
import { applySubscriptionAction, daysLeft, dueExpiryAlerts, periodEnd, subscriptionStatus, type SubscriptionAction } from "../../lib/platform/subscriptions";
import { describePromo, discountFor, normalizeCode, PROMO_CODE_RE, promoError } from "../../lib/platform/promo";
import { actorOf, assertRecentAuth, asyncRoute, httpError, pageParams, paginate, q, requirePlatform } from "./context";
import { platformAudit } from "./audit";
import { isLive } from "./analytics";
import { ensurePlans, syncCompanyPlan } from "./shared";
import { notifyCompanyLeaders } from "./notify";

/*
 * Biznes: tariflar (narx/limitlar kodga qattiq yozilmagan), obunalar, hisob-faktura, promo, shartnomalar.
 * To‘lov provayderi ulanmagan — tizim qo‘lda yuritiladigan hisob-faktura sifatida ishlaydi:
 *   «To‘langan» holati faqat to‘lov dalili (tranzaksiya/hujjat raqami) kiritilganda o‘rnatiladi; avtomatik pul yechilmaydi.
 */

const limitSchema = z.union([z.number().int().min(0).max(1_000_000), z.null()]).optional();
const planSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,30}$/, "Kalit: kichik lotin harflari, raqam, - yoki _"),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  price: z.union([z.number().min(0).max(1e12), z.null()]),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default("UZS"),
  period: z.enum(["MONTH", "YEAR"]).default("MONTH"),
  limits: z.object({ employees: limitSchema, branches: limitSchema, managers: limitSchema }).default({}),
  modules: z.union([z.literal("all"), z.array(z.string()).max(50)]).default("all"),
  trialDays: z.number().int().min(0).max(365).default(0),
});

const parseFile = (dataUrl: string, maxMb: number) => {
  const match = /^data:([\w/.+-]+);base64,(.+)$/s.exec(dataUrl);
  if (!match || !/^(application\/pdf|image\/(jpeg|png|webp))$/.test(match[1])) throw httpError("Faqat PDF yoki JPG/PNG/WEBP fayl yuklash mumkin.", 400);
  const buffer = Buffer.from(match[2], "base64");
  const max = Math.min(1.4, Math.max(0.1, maxMb)) * 1024 * 1024;
  if (buffer.length > max) throw httpError(`Fayl juda katta — ${(max / 1024 / 1024).toFixed(1)} MB gacha.`, 413);
  return { mime: match[1], buffer };
};

function nextInvoiceNumber(records: BillingRecord[], at = new Date()) {
  const year = at.getUTCFullYear();
  const prefix = `INV-${year}-`;
  const max = records.filter((r) => r.number.startsWith(prefix)).reduce((m, r) => Math.max(m, Number(r.number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

const TRANSITIONS: Record<BillingStatus, BillingStatus[]> = {
  DRAFT: ["ISSUED", "VOID"],
  ISSUED: ["PAID", "VOID", "OVERDUE"],
  OVERDUE: ["PAID", "VOID"],
  PAID: ["VOID"],
  VOID: [],
};

export function createBusinessRouter() {
  const router = Router();

  /* ---------------------------------------------------------------- tariflar --- */
  router.get(
    "/super-admin/plans",
    requirePlatform("subscriptions.read"),
    asyncRoute(async (_req, res) => {
      // Standart tariflar server ishga tushganda yaratiladi (startPlatform) — GET hech narsa yozmaydi.
      const db = await readDb();
      res.json(db.subscriptionPlans.map((p) => ({ ...p, companies: db.companies.filter((c) => isLive(c) && c.subscription?.planId === p.id).length })));
    }),
  );

  router.post(
    "/super-admin/plans",
    requirePlatform("plans.manage"),
    asyncRoute(async (req, res) => {
      const input = planSchema.parse(req.body);
      if (input.modules !== "all" && input.modules.some((m) => !isModuleKey(m))) throw httpError("Noma’lum modul.", 400);
      const plan = await updateDb((db) => {
        ensurePlans(db);
        if (db.subscriptionPlans.some((p) => p.key === input.key)) throw httpError("Bu kalitli tarif mavjud.", 409);
        const now = new Date().toISOString();
        const row: SubscriptionPlan = { id: randomUUID(), ...input, limits: input.limits, status: "ACTIVE", version: 1, createdAt: now, updatedAt: now };
        db.subscriptionPlans.push(row);
        return row;
      });
      await platformAudit({ req, action: "plan.create", entity: "plan", entityId: plan.id, summary: `Tarif yaratildi: ${plan.name}`, details: plan });
      res.status(201).json(plan);
    }),
  );

  router.patch(
    "/super-admin/plans/:id",
    requirePlatform("plans.manage"),
    asyncRoute(async (req, res) => {
      const input = planSchema.partial().omit({ key: true }).extend({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional() }).parse(req.body);
      if (input.modules && input.modules !== "all" && input.modules.some((m) => !isModuleKey(m))) throw httpError("Noma’lum modul.", 400);
      const result = await updateDb((db) => {
        const plan = db.subscriptionPlans.find((p) => p.id === req.params.id);
        if (!plan) throw httpError("Tarif topilmadi.", 404);
        const before = { ...plan };
        const material = (input.price !== undefined && input.price !== plan.price) || input.limits !== undefined || input.modules !== undefined;
        Object.assign(plan, input, { limits: input.limits ? { ...plan.limits, ...input.limits } : plan.limits, updatedAt: new Date().toISOString() });
        if (material) plan.version += 1;
        // Shu tarifdagi kompaniyalarning xodim limiti yangilanadi.
        let synced = 0;
        for (const company of db.companies)
          if (company.subscription?.planId === plan.id) {
            syncCompanyPlan(db, company);
            synced += 1;
          }
        return { plan, before, synced };
      });
      await platformAudit({ req, action: "plan.update", entity: "plan", entityId: result.plan.id, summary: `Tarif o‘zgartirildi: ${result.plan.name} (v${result.plan.version}, ${result.synced} kompaniya)`, details: { before: result.before, after: result.plan } });
      res.json(result.plan);
    }),
  );

  /* ---------------------------------------------------------------- obunalar --- */
  router.get(
    "/super-admin/subscriptions",
    requirePlatform("subscriptions.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const status = q(req, "status");
      const planId = q(req, "planId");
      const expiring = Number(q(req, "expiring")) || 0;
      const text = q(req, "q").toLowerCase();
      const now = new Date().toISOString();
      let rows = db.companies.filter(isLive).map((c) => {
        const sub = c.subscription;
        const plan = sub ? db.subscriptionPlans.find((p) => p.id === sub.planId) : undefined;
        return {
          companyId: c.id,
          company: c.name,
          companyStatus: c.status,
          plan: plan?.name || c.plan || "—",
          planId: plan?.id || null,
          status: sub ? subscriptionStatus(sub, now) : "NONE",
          mode: sub?.status || null,
          startedAt: sub?.startedAt || null,
          periodEnd: sub ? periodEnd(sub) || null : null,
          daysLeft: sub ? daysLeft(sub, now) : null,
          free: Boolean(sub?.free),
          manual: Boolean(sub?.manual),
          graceDays: sub?.graceDays ?? null,
          limits: sub?.limits || null,
          employeeLimit: c.employeeLimit ?? null,
        };
      });
      if (status) rows = rows.filter((r) => r.status === status);
      if (planId) rows = rows.filter((r) => r.planId === planId);
      if (expiring) rows = rows.filter((r) => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= expiring);
      if (text) rows = rows.filter((r) => r.company.toLowerCase().includes(text));
      rows.sort((a, b) => (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999));
      const counts: Record<string, number> = {};
      for (const c of db.companies.filter(isLive)) {
        const s = c.subscription ? subscriptionStatus(c.subscription, now) : "NONE";
        counts[s] = (counts[s] || 0) + 1;
      }
      const { page, pageSize } = pageParams(req);
      res.json({ ...paginate(rows, page, pageSize), counts });
    }),
  );

  router.post(
    "/super-admin/companies/:id/subscription",
    requirePlatform("subscriptions.manage"),
    asyncRoute(async (req, res) => {
      const input = z
        .discriminatedUnion("action", [
          z.object({ action: z.literal("change_plan"), planId: z.string() }),
          z.object({ action: z.literal("extend_trial"), days: z.number().int().min(1).max(365) }),
          z.object({ action: z.literal("grant_free"), planId: z.string(), days: z.number().int().min(1).max(3650) }),
          z.object({ action: z.literal("set_period"), endsAt: z.union([z.string().min(10), z.null()]) }),
          z.object({ action: z.literal("set_limits"), limits: z.object({ employees: limitSchema, branches: limitSchema, managers: limitSchema }) }),
          z.object({ action: z.literal("set_grace"), graceDays: z.number().int().min(0).max(90) }),
          z.object({ action: z.literal("pause") }),
          z.object({ action: z.literal("resume") }),
        ])
        .and(z.object({ note: z.string().trim().max(300).optional() }))
        .parse(req.body);
      const actor = actorOf(req);
      const result = await updateDb((db) => {
        ensurePlans(db);
        const company = db.companies.find((c) => c.id === req.params.id);
        if (!company) throw httpError("Kompaniya topilmadi.", 404);
        const before = company.subscription ? { ...company.subscription } : null;
        if (input.action === "set_grace") {
          if (!company.subscription) throw httpError("Avval tarif tanlang.", 409);
          company.subscription = { ...company.subscription, graceDays: input.graceDays, updatedAt: new Date().toISOString(), updatedBy: actor.name };
        } else company.subscription = applySubscriptionAction(company.subscription, db.subscriptionPlans, input as SubscriptionAction, actor.name);
        if (input.note) company.subscription.note = input.note;
        syncCompanyPlan(db, company);
        db.auditLogs.unshift(audit(company.id, actor.name, `Platforma: obuna o‘zgartirildi (${input.action})`, "company", company.id, before, company.subscription));
        return { company, before };
      });
      await platformAudit({
        req,
        companyId: result.company.id,
        action: `subscription.${input.action}`,
        entity: "subscription",
        entityId: result.company.id,
        summary: `${result.company.name}: obuna — ${input.action}${"days" in input ? ` (${input.days} kun)` : ""}`,
        details: { before: result.before, after: result.company.subscription },
        privileged: input.action === "grant_free",
      });
      res.json({ subscription: result.company.subscription, computedStatus: subscriptionStatus(result.company.subscription!), employeeLimit: result.company.employeeLimit ?? null });
    }),
  );

  /* ----------------------------------------------------------- hisob-faktura --- */
  router.get(
    "/super-admin/billing",
    requirePlatform("billing.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const status = q(req, "status");
      const companyId = q(req, "companyId");
      const from = q(req, "from");
      const to = q(req, "to");
      const text = q(req, "q").toLowerCase();
      const name = (id: string) => db.companies.find((c) => c.id === id)?.name || "—";
      let rows = db.billingRecords.map((r) => ({ ...r, company: name(r.companyId) }));
      if (status) rows = rows.filter((r) => r.status === status);
      if (companyId) rows = rows.filter((r) => r.companyId === companyId);
      if (from) rows = rows.filter((r) => r.createdAt.slice(0, 10) >= from);
      if (to) rows = rows.filter((r) => r.createdAt.slice(0, 10) <= to);
      if (text) rows = rows.filter((r) => `${r.number} ${r.company} ${r.paymentReference || ""}`.toLowerCase().includes(text));
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      // Daromad faqat dalil bilan tasdiqlangan (PAID) yozuvlardan; valyuta bo‘yicha alohida.
      const summary: Record<string, { paid: number; outstanding: number; overdue: number }> = {};
      for (const r of db.billingRecords) {
        const s = (summary[r.currency] ||= { paid: 0, outstanding: 0, overdue: 0 });
        const net = r.amount - (r.discount || 0);
        if (r.status === "PAID") s.paid += net;
        else if (r.status === "ISSUED") s.outstanding += net;
        else if (r.status === "OVERDUE") s.overdue += net;
      }
      const { page, pageSize } = pageParams(req);
      res.json({ ...paginate(rows, page, pageSize), summary });
    }),
  );

  router.post(
    "/super-admin/billing",
    requirePlatform("billing.manage"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          companyId: z.string(),
          planId: z.string().optional(),
          periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          amount: z.number().min(0).max(1e12),
          currency: z.string().trim().regex(/^[A-Z]{3}$/).default("UZS"),
          dueDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
          note: z.string().trim().max(500).optional(),
          issue: z.boolean().optional(),
        })
        .parse(req.body);
      if (input.periodEnd < input.periodStart) throw httpError("Davr oxiri boshidan oldin bo‘lmasin.", 400);
      const actor = actorOf(req);
      const record = await updateDb((db) => {
        const company = db.companies.find((c) => c.id === input.companyId);
        if (!company) throw httpError("Kompaniya topilmadi.", 404);
        const plan = input.planId ? db.subscriptionPlans.find((p) => p.id === input.planId) : company.subscription ? db.subscriptionPlans.find((p) => p.id === company.subscription!.planId) : undefined;
        const now = new Date().toISOString();
        const status: BillingStatus = input.issue ? "ISSUED" : "DRAFT";
        const row: BillingRecord = {
          id: randomUUID(),
          number: nextInvoiceNumber(db.billingRecords),
          companyId: company.id,
          planId: plan?.id,
          planName: plan?.name || company.plan,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          amount: input.amount,
          currency: input.currency,
          status,
          dueDate: input.dueDate || undefined,
          note: input.note,
          history: [{ at: now, by: actor.name, status }],
          createdAt: now,
          createdBy: actor.name,
          updatedAt: now,
        };
        db.billingRecords.unshift(row);
        db.auditLogs.unshift(audit(company.id, actor.name, `Platforma: hisob-faktura ${row.number} (${status})`, "company", company.id));
        return row;
      });
      await platformAudit({ req, companyId: record.companyId, action: "billing.create", entity: "billing", entityId: record.id, summary: `${record.number}: ${record.amount} ${record.currency} (${record.status})` });
      res.status(201).json(record);
    }),
  );

  router.patch(
    "/super-admin/billing/:id",
    requirePlatform("billing.manage"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({ amount: z.number().min(0).max(1e12).optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().trim().max(500).optional(), periodStart: z.string().optional(), periodEnd: z.string().optional() })
        .parse(req.body);
      const record = await updateDb((db) => {
        const row = db.billingRecords.find((r) => r.id === req.params.id);
        if (!row) throw httpError("Hisob-faktura topilmadi.", 404);
        if (row.status !== "DRAFT") throw httpError("Faqat qoralama tahrirlanadi.", 409);
        Object.assign(row, input, { updatedAt: new Date().toISOString() });
        return row;
      });
      await platformAudit({ req, companyId: record.companyId, action: "billing.update", entity: "billing", entityId: record.id, summary: `${record.number} tahrirlandi`, details: input });
      res.json(record);
    }),
  );

  router.post(
    "/super-admin/billing/:id/status",
    requirePlatform("billing.manage"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          status: z.enum(["ISSUED", "PAID", "VOID", "OVERDUE"]),
          paymentReference: z.string().trim().max(120).optional(),
          paymentMethod: z.string().trim().max(60).optional(),
          paidAt: z.string().optional(),
          note: z.string().trim().max(500).optional(),
        })
        .parse(req.body);
      if (input.status === "PAID" && (!input.paymentReference || input.paymentReference.length < 3))
        throw httpError("To‘lovni tasdiqlovchi hujjat yoki tranzaksiya raqamini kiriting — dalilsiz «To‘langan» qilinmaydi.", 400, "PAYMENT_PROOF_REQUIRED");
      const db0 = await readDb();
      const existing = db0.billingRecords.find((r) => r.id === req.params.id);
      if (existing?.status === "PAID" && input.status === "VOID") assertRecentAuth(req, db0);
      const actor = actorOf(req);
      const record = await updateDb((db) => {
        const row = db.billingRecords.find((r) => r.id === req.params.id);
        if (!row) throw httpError("Hisob-faktura topilmadi.", 404);
        if (!TRANSITIONS[row.status].includes(input.status)) throw httpError(`${row.status} → ${input.status} o‘tishi mumkin emas.`, 409);
        const now = new Date().toISOString();
        row.status = input.status;
        if (input.status === "PAID") {
          row.paidAt = input.paidAt ? new Date(input.paidAt).toISOString() : now;
          row.paymentReference = input.paymentReference;
          row.paymentMethod = input.paymentMethod;
          row.confirmedBy = actor.name;
        }
        row.history.push({ at: now, by: actor.name, status: input.status, note: input.note });
        row.updatedAt = now;
        db.auditLogs.unshift(audit(row.companyId, actor.name, `Platforma: ${row.number} — ${input.status}`, "company", row.companyId));
        return row;
      });
      await platformAudit({ req, companyId: record.companyId, action: `billing.${input.status.toLowerCase()}`, entity: "billing", entityId: record.id, summary: `${record.number} → ${input.status}${input.paymentReference ? ` (dalil: ${input.paymentReference})` : ""}`, privileged: input.status === "PAID" || input.status === "VOID" });
      res.json(record);
    }),
  );

  /* -------------------------------------------------------------------- promo --- */
  router.get(
    "/super-admin/promos",
    requirePlatform("promos.manage"),
    asyncRoute(async (_req, res) => {
      const db = await readDb();
      res.json(db.promoCodes.map((p) => ({ ...p, effect: describePromo(p, db.subscriptionPlans.find((x) => x.id === p.planId)?.name), redemptions: db.promoRedemptions.filter((r) => r.promoId === p.id).length })));
    }),
  );

  router.post(
    "/super-admin/promos",
    requirePlatform("promos.manage"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          code: z.string().transform(normalizeCode).refine((v) => PROMO_CODE_RE.test(v), "Kod: 3–32 ta lotin harfi, raqam, - yoki _"),
          description: z.string().trim().max(200).optional(),
          kind: z.enum(["PERCENT", "FIXED", "TRIAL_EXTENSION", "FREE_PLAN"]),
          value: z.number().positive().max(1e12),
          currency: z.string().regex(/^[A-Z]{3}$/).optional(),
          planId: z.string().optional(),
          expiresAt: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
          usageLimit: z.number().int().min(1).max(1_000_000).optional(),
          perCompanyLimit: z.number().int().min(1).max(100).default(1),
          companyIds: z.array(z.string()).max(500).optional(),
        })
        .parse(req.body);
      if (input.kind === "PERCENT" && input.value > 100) throw httpError("Foiz 100 dan oshmasin.", 400);
      if (input.kind === "FREE_PLAN" && !input.planId) throw httpError("Bepul tarif uchun tarifni tanlang.", 400);
      if ((input.kind === "TRIAL_EXTENSION" || input.kind === "FREE_PLAN") && (!Number.isInteger(input.value) || input.value > 3650)) throw httpError("Kunlar 1–3650 butun son bo‘lsin.", 400);
      const actor = actorOf(req);
      const promo = await updateDb((db) => {
        if (db.promoCodes.some((p) => p.code === input.code)) throw httpError("Bu kod mavjud.", 409);
        if (input.planId && !db.subscriptionPlans.some((p) => p.id === input.planId)) throw httpError("Tarif topilmadi.", 404);
        const row: PromoCode = {
          id: randomUUID(),
          ...input,
          expiresAt: input.expiresAt ? `${input.expiresAt}T23:59:59.000Z` : undefined,
          status: "ACTIVE",
          used: 0,
          createdAt: new Date().toISOString(),
          createdBy: actor.name,
        };
        db.promoCodes.unshift(row);
        return row;
      });
      await platformAudit({ req, action: "promo.create", entity: "promo", entityId: promo.id, summary: `Promo kod: ${promo.code} — ${describePromo(promo)}` });
      res.status(201).json(promo);
    }),
  );

  router.patch(
    "/super-admin/promos/:id",
    requirePlatform("promos.manage"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({ status: z.enum(["ACTIVE", "DISABLED"]).optional(), description: z.string().trim().max(200).optional(), usageLimit: z.union([z.number().int().min(1), z.null()]).optional(), expiresAt: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).optional() })
        .parse(req.body);
      const promo = await updateDb((db) => {
        const row = db.promoCodes.find((p) => p.id === req.params.id);
        if (!row) throw httpError("Promo kod topilmadi.", 404);
        if (input.status) row.status = input.status;
        if (input.description !== undefined) row.description = input.description || undefined;
        if (input.usageLimit !== undefined) row.usageLimit = input.usageLimit ?? undefined;
        if (input.expiresAt !== undefined) row.expiresAt = input.expiresAt ? `${input.expiresAt}T23:59:59.000Z` : undefined;
        return row;
      });
      await platformAudit({ req, action: "promo.update", entity: "promo", entityId: promo.id, summary: `Promo ${promo.code} o‘zgartirildi`, details: input });
      res.json(promo);
    }),
  );

  router.get(
    "/super-admin/promos/:id/redemptions",
    requirePlatform("promos.manage"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      res.json(db.promoRedemptions.filter((r) => r.promoId === req.params.id).map((r) => ({ ...r, company: db.companies.find((c) => c.id === r.companyId)?.name || "—" })));
    }),
  );

  /** Promo kodni kompaniyaga qo‘llash — bitta tranzaksiyada tekshiruv + effekt + hisoblagich (takror ishlatilmaydi). */
  router.post(
    "/super-admin/promos/:id/redeem",
    requirePlatform("promos.manage"),
    asyncRoute(async (req, res) => {
      const input = z.object({ companyId: z.string(), billingRecordId: z.string().optional() }).parse(req.body);
      const actor = actorOf(req);
      const result = await updateDb((db) => {
        ensurePlans(db);
        const promo = db.promoCodes.find((p) => p.id === req.params.id);
        const company = db.companies.find((c) => c.id === input.companyId);
        if (!company) throw httpError("Kompaniya topilmadi.", 404);
        const error = promoError(promo, company.id, db.promoRedemptions, new Date().toISOString(), company.subscription?.planId);
        if (error) throw httpError(error, 409, "PROMO_INVALID");
        const p = promo!;
        let effect = describePromo(p, db.subscriptionPlans.find((x) => x.id === p.planId)?.name);
        let billingRecordId: string | undefined;
        if (p.kind === "TRIAL_EXTENSION") {
          company.subscription = applySubscriptionAction(company.subscription, db.subscriptionPlans, { action: "extend_trial", days: p.value }, actor.name);
        } else if (p.kind === "FREE_PLAN") {
          company.subscription = applySubscriptionAction(company.subscription, db.subscriptionPlans, { action: "grant_free", planId: p.planId!, days: p.value }, actor.name);
          syncCompanyPlan(db, company);
        } else {
          const bill = db.billingRecords.find((r) => r.id === input.billingRecordId && r.companyId === company.id);
          if (!bill) throw httpError("Chegirma uchun shu kompaniyaning hisob-fakturasini tanlang.", 400);
          if (!["DRAFT", "ISSUED"].includes(bill.status)) throw httpError("Chegirma faqat qoralama yoki chiqarilgan hisob-fakturaga.", 409);
          if (bill.promoCode) throw httpError("Bu hisob-fakturada allaqachon promo bor.", 409);
          if (p.kind === "FIXED" && p.currency && p.currency !== bill.currency) throw httpError("Promo valyutasi hisob-faktura valyutasiga mos emas.", 409);
          bill.discount = discountFor(p, bill.amount);
          bill.promoCode = p.code;
          bill.updatedAt = new Date().toISOString();
          billingRecordId = bill.id;
          effect = `${effect} → ${bill.number}: −${bill.discount} ${bill.currency}`;
        }
        p.used += 1;
        const redemption = { id: randomUUID(), promoId: p.id, code: p.code, companyId: company.id, at: new Date().toISOString(), by: actor.name, effect, billingRecordId };
        db.promoRedemptions.unshift(redemption);
        db.auditLogs.unshift(audit(company.id, actor.name, `Platforma: promo kod qo‘llandi (${p.code}: ${effect})`, "company", company.id));
        return { redemption, company };
      });
      await platformAudit({ req, companyId: result.company.id, action: "promo.redeem", entity: "promo", entityId: String(req.params.id), summary: `${result.redemption.code} → ${result.company.name}: ${result.redemption.effect}` });
      res.json(result.redemption);
    }),
  );

  /* -------------------------------------------------------------- shartnomalar --- */
  router.get(
    "/super-admin/contracts",
    requirePlatform("contracts.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const companyId = q(req, "companyId");
      const expiring = Number(q(req, "expiring")) || 0;
      const today = new Date().toISOString().slice(0, 10);
      const limit = new Date(Date.now() + expiring * 86_400_000).toISOString().slice(0, 10);
      let rows = db.companyContracts.map((c) => ({ ...c, company: db.companies.find((x) => x.id === c.companyId)?.name || "—", expired: Boolean(c.endsAt && c.endsAt < today) }));
      if (companyId) rows = rows.filter((r) => r.companyId === companyId);
      if (expiring) rows = rows.filter((r) => r.status === "ACTIVE" && r.endsAt && r.endsAt >= today && r.endsAt <= limit);
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json(rows);
    }),
  );

  router.post(
    "/super-admin/contracts",
    requirePlatform("contracts.manage"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          companyId: z.string(),
          groupId: z.string().optional(),
          type: z.enum(["SERVICE", "NDA", "DPA", "ADDENDUM", "OTHER"]),
          title: z.string().trim().min(2).max(160),
          number: z.string().trim().max(60).optional(),
          startsAt: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
          endsAt: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
          note: z.string().trim().max(500).optional(),
          fileName: z.string().trim().min(1).max(160),
          dataUrl: z.string().min(30).max(2_000_000),
        })
        .parse(req.body);
      const db0 = await readDb();
      if (!db0.companies.some((c) => c.id === input.companyId)) throw httpError("Kompaniya topilmadi.", 404);
      const { mime, buffer } = parseFile(input.dataUrl, db0.platformSettings?.uploads?.maxMb ?? 1.4);
      const fileId = `contract:${randomUUID()}`;
      const now = new Date().toISOString();
      // Fayl document_files jadvalida (yopiq): faqat ruxsatli administrator yuklab oladi.
      await (await documentFiles()).putFile(fileId, input.companyId, mime, buffer, now);
      const actor = actorOf(req);
      const contract = await updateDb((db) => {
        const previous = input.groupId ? db.companyContracts.filter((c) => c.groupId === input.groupId && c.companyId === input.companyId) : [];
        if (input.groupId && !previous.length) throw httpError("Shartnoma guruhi topilmadi.", 404);
        for (const p of previous) if (p.status === "ACTIVE") p.status = "SUPERSEDED";
        const row: CompanyContract = {
          id: randomUUID(),
          companyId: input.companyId,
          groupId: input.groupId || randomUUID(),
          version: previous.reduce((m, p) => Math.max(m, p.version), 0) + 1,
          type: input.type,
          title: input.title,
          number: input.number,
          startsAt: input.startsAt || undefined,
          endsAt: input.endsAt || undefined,
          status: "ACTIVE",
          fileId,
          fileName: input.fileName,
          mime,
          size: buffer.length,
          note: input.note,
          uploadedBy: actor.name,
          createdAt: now,
        };
        db.companyContracts.unshift(row);
        db.auditLogs.unshift(audit(row.companyId, actor.name, `Platforma: shartnoma yuklandi (${row.title}, v${row.version})`, "company", row.companyId));
        return row;
      });
      await platformAudit({ req, companyId: contract.companyId, action: "contract.upload", entity: "contract", entityId: contract.id, summary: `${contract.title} v${contract.version} (${Math.round(contract.size / 1024)} KB)` });
      res.status(201).json(contract);
    }),
  );

  router.patch(
    "/super-admin/contracts/:id",
    requirePlatform("contracts.manage"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({ status: z.enum(["ACTIVE", "EXPIRED", "TERMINATED"]).optional(), title: z.string().trim().min(2).max(160).optional(), endsAt: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(), note: z.string().trim().max(500).optional() })
        .parse(req.body);
      const contract = await updateDb((db) => {
        const row = db.companyContracts.find((c) => c.id === req.params.id);
        if (!row) throw httpError("Shartnoma topilmadi.", 404);
        if (input.status) row.status = input.status;
        if (input.title) row.title = input.title;
        if (input.endsAt !== undefined) row.endsAt = input.endsAt || undefined;
        if (input.note !== undefined) row.note = input.note || undefined;
        return row;
      });
      await platformAudit({ req, companyId: contract.companyId, action: "contract.update", entity: "contract", entityId: contract.id, summary: `${contract.title}: o‘zgartirildi`, details: input });
      res.json(contract);
    }),
  );

  router.get(
    "/super-admin/contracts/:id/file",
    requirePlatform("contracts.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const contract = db.companyContracts.find((c) => c.id === req.params.id);
      if (!contract) throw httpError("Shartnoma topilmadi.", 404);
      const file = await (await documentFiles()).getFile(contract.fileId);
      if (!file) throw httpError("Fayl topilmadi.", 404);
      await platformAudit({ req, companyId: contract.companyId, action: "contract.download", entity: "contract", entityId: contract.id, summary: `Shartnoma yuklab olindi: ${contract.title} v${contract.version}` });
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(contract.fileName)}"`);
      res.type(file.mime).send(Buffer.from(file.data));
    }),
  );

  return router;
}

/**
 * Davriy ish: obuna holati o‘zgarishlarini auditga yozadi, muddati yaqinlashgan kompaniyalarga
 * ogohlantirish yuboradi (sozlamada yoqilgan bo‘lsa: 7/3/1 kun), muddati o‘tgan hisob-fakturalarni OVERDUE qiladi.
 * Muddat tugashi ma’lumotni o‘chirmaydi.
 */
export async function runSubscriptionJob() {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const db = await readDb();
  const settings = db.platformSettings?.notifications || {};
  const days = (settings.expiryDays?.length ? settings.expiryDays : [7, 3, 1]).filter((d) => d > 0 && d <= 90);
  const transitions: { companyId: string; name: string; from?: string; to: string }[] = [];
  const alerts: { companyId: string; key: string; days: number; left: number; end: string }[] = [];
  for (const company of db.companies.filter(isLive)) {
    const sub = company.subscription;
    if (!sub) continue;
    const computed = subscriptionStatus(sub, now);
    if (sub.lastStatus !== computed) transitions.push({ companyId: company.id, name: company.name, from: sub.lastStatus, to: computed });
    if (settings.subscriptionAlerts)
      for (const alert of dueExpiryAlerts(sub, days, now)) alerts.push({ companyId: company.id, key: alert.key, days: alert.days, left: alert.left, end: periodEnd(sub)!.slice(0, 10) });
  }
  const overdue = db.billingRecords.filter((r) => r.status === "ISSUED" && r.dueDate && r.dueDate < today).map((r) => r.id);
  if (!transitions.length && !alerts.length && !overdue.length) return { transitions: 0, alerts: 0, overdue: 0 };
  await updateDb((next) => {
    for (const t of transitions) {
      const company = next.companies.find((c) => c.id === t.companyId);
      if (company?.subscription) company.subscription.lastStatus = t.to as typeof company.subscription.lastStatus;
    }
    for (const a of alerts) {
      const company = next.companies.find((c) => c.id === a.companyId);
      if (company?.subscription) company.subscription.alertsSent = [...(company.subscription.alertsSent || []), a.key].slice(-20);
    }
    for (const id of overdue) {
      const row = next.billingRecords.find((r) => r.id === id);
      if (row && row.status === "ISSUED") {
        row.status = "OVERDUE";
        row.history.push({ at: now, by: "Tizim", status: "OVERDUE", note: "To‘lov muddati o‘tdi" });
        row.updatedAt = now;
      }
    }
  });
  for (const t of transitions)
    if (t.from) await platformAudit({ actor: { name: "Tizim" }, companyId: t.companyId, action: "subscription.status", entity: "subscription", entityId: t.companyId, summary: `${t.name}: obuna holati ${t.from} → ${t.to}` });
  const fresh = await readDb();
  for (const a of alerts)
    await notifyCompanyLeaders(fresh, a.companyId, {
      key: `sub:${a.companyId}:${a.key}`,
      title: "Tarif muddati tugamoqda",
      body: `Staffora tarifingiz muddati ${a.end} da tugaydi (${a.left} kun qoldi). Uzaytirish uchun platforma administratoriga murojaat qiling. Muddat tugaganda ma’lumotlaringiz o‘chmaydi.`,
      ownersOnly: true,
    });
  return { transitions: transitions.length, alerts: alerts.length, overdue: overdue.length };
}
