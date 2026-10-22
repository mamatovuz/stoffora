import { createReadStream } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { Router } from "express";
import { z } from "zod";
import { documentFiles, opsStore, readDb, updateDb } from "../../lib/store";
import { platformCan } from "../../lib/platform/permissions";
import { periodEnd, subscriptionStatus } from "../../lib/platform/subscriptions";
import { actorOf, assertRecentAuth, asyncRoute, hasPermission, httpError, pageParams, paginate, q, requirePlatform } from "./context";
import { platformAudit, queryPlatformAudit } from "./audit";
import { deploymentInfo, evaluateIncidentRules, runHealthChecks } from "./monitoring";
import { recentMinutes } from "./telemetry";
import { cancelJob, enqueueJob, getJob, listJobs, registerJobHandler, retryJob, workerStates } from "./jobs";
import { backupEnvironment, backupFilePath, runBackup, verifyBackup } from "./backups";
import { querySecurityEvents, securityCounts } from "./security-events";
import { companyIndex, isLive, isoDay, usageAnalytics } from "./analytics";

/*
 * Operatsiyalar: monitoring, incidentlar, xatolar markazi, zaxira nusxalar, fon ishlari, xavfsizlik markazi,
 * resurslar va eksport markazi. Eksport — fon ishi, fayl yopiq saqlanadi, havola 24 soat va faqat ruxsatlilarga.
 */

type RawError = { fingerprint: string; service: string; company_id: string | null; severity: string; message: string; stack: string | null; path: string | null; status: string; note: string | null; first_seen: string; last_seen: string; count: number | string };
const toError = (r: RawError, withStack: boolean) => ({
  fingerprint: r.fingerprint,
  service: r.service,
  companyId: r.company_id,
  severity: r.severity,
  message: r.message,
  stack: withStack ? r.stack : null,
  path: r.path,
  status: r.status,
  note: r.note,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
  count: Number(r.count),
});

/* --------------------------------------------------------------- eksport --- */
const EXPORT_TYPES = {
  companies: "Kompaniyalar ro‘yxati",
  usage: "Foydalanish statistikasi",
  audit: "Audit hisoboti",
  billing: "Hisob-kitob hisoboti",
  company_data: "Kompaniya ma’lumotlari (xodimlar va davomat agregati)",
} as const;
type ExportType = keyof typeof EXPORT_TYPES;
type ExportPayload = { type: ExportType; format: "csv" | "xlsx" | "json"; from?: string; to?: string; companyId?: string; reason?: string };

async function exportRows(p: ExportPayload): Promise<{ headers: string[]; rows: unknown[][] }> {
  const db = await readDb();
  const from = p.from || isoDay(-30);
  const to = p.to || isoDay(0);
  if (p.type === "companies") {
    const index = companyIndex(db);
    return {
      headers: ["ID", "Nomi", "Holat", "Tarif", "Obuna holati", "Tugash sanasi", "Faol xodimlar", "Filiallar", "Rahbarlar", "Yaratilgan", "Arxiv", "Demo"],
      rows: db.companies.map((c) => {
        const r = index.get(c.id)!;
        const plan = c.subscription ? db.subscriptionPlans.find((x) => x.id === c.subscription!.planId)?.name : c.plan;
        return [c.id, c.name, c.status, plan || "", c.subscription ? subscriptionStatus(c.subscription) : "", c.subscription ? periodEnd(c.subscription) || "" : "", r.activeEmployees, r.branches, r.leaders, c.createdAt.slice(0, 10), c.archive ? "ha" : "", c.demo ? "ha" : ""];
      }),
    };
  }
  if (p.type === "usage") {
    const usage = await usageAnalytics(from, to);
    return { headers: ["Kompaniya", "API so‘rovlar", "API xatolar", "Xodim so‘rovlari", "Faol panel foydalanuvchilari", "Davomat qaydlari", "Faol xodimlar", "Fayllar", "Hajm (bayt)"], rows: usage.companies.map((c) => [c.name, c.requests, c.errors, c.employeeRequests, c.activeUsers, c.attendance, c.employees, c.files, c.storageBytes]) };
  }
  if (p.type === "audit") {
    const audit = await queryPlatformAudit({ from: `${from}T00:00:00`, to: `${to}T23:59:59`, companyId: p.companyId }, 5000, 0);
    return { headers: ["Vaqt", "Kim", "Rol", "Kompaniya", "Amal", "Obyekt", "Natija", "Tavsif", "Request ID", "IP"], rows: audit.rows.map((r) => [r.at, r.actorName, r.actorRole || "", r.companyId || "", r.action, `${r.entity || ""}:${r.entityId || ""}`, r.result, r.summary, r.requestId || "", r.ip || ""]) };
  }
  if (p.type === "billing") {
    const name = (id: string) => db.companies.find((c) => c.id === id)?.name || id;
    return {
      headers: ["Raqam", "Kompaniya", "Tarif", "Davr boshi", "Davr oxiri", "Summa", "Chegirma", "Valyuta", "Holat", "To‘lov sanasi", "To‘lov dalili", "Tasdiqlagan"],
      rows: db.billingRecords.filter((b) => b.createdAt.slice(0, 10) >= from && b.createdAt.slice(0, 10) <= to).map((b) => [b.number, name(b.companyId), b.planName || "", b.periodStart, b.periodEnd, b.amount, b.discount || 0, b.currency, b.status, b.paidAt || "", b.paymentReference || "", b.confirmedBy || ""]),
    };
  }
  // Kompaniya ma’lumotlari: xodimlar ro‘yxati (minimal maydonlar) va davr bo‘yicha davomat agregati.
  if (!p.companyId) throw new Error("Kompaniya tanlanmagan.");
  const attendance = new Map<string, { days: number; late: number; minutes: number }>();
  for (const a of db.attendance) {
    if (a.companyId !== p.companyId || a.date < from || a.date > to) continue;
    const item = attendance.get(a.employeeId) || { days: 0, late: 0, minutes: 0 };
    item.days += 1;
    if (a.lateMinutes > 0) item.late += 1;
    item.minutes += a.workedMinutes || 0;
    attendance.set(a.employeeId, item);
  }
  const branch = (id: string) => db.branches.find((b) => b.id === id)?.name || "";
  return {
    headers: ["Tabel №", "Familiya", "Ism", "Holat", "Filial", "Ish boshlagan", "Kelgan kunlar", "Kechikkan kunlar", "Ishlagan soat"],
    rows: db.employees
      .filter((e) => e.companyId === p.companyId)
      .map((e) => {
        const a = attendance.get(e.id) || { days: 0, late: 0, minutes: 0 };
        return [e.employeeNo, e.lastName, e.firstName, e.status, branch(e.branchId), e.startDate, a.days, a.late, Math.round((a.minutes / 60) * 10) / 10];
      }),
  };
}

async function encode(format: ExportPayload["format"], headers: string[], rows: unknown[][], title: string) {
  if (format === "json") return { mime: "application/json", buffer: Buffer.from(JSON.stringify(rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]]))), null, 2)) };
  if (format === "csv") {
    const cell = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    return { mime: "text/csv", buffer: Buffer.from(`﻿${[headers, ...rows].map((r) => r.map(cell).join(",")).join("\n")}`) };
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title.slice(0, 31));
  sheet.addRow(headers).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  sheet.columns.forEach((col) => (col.width = 18));
  return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
}

/** Fon ishlari: eksport, zaxira, zaxirani tekshirish. */
export function registerOpsJobs() {
  registerJobHandler("EXPORT", async (payload, ctx) => {
    const p = payload as ExportPayload;
    const { headers, rows } = await exportRows(p);
    const { mime, buffer } = await encode(p.format, headers, rows, EXPORT_TYPES[p.type]);
    const fileId = `export:${ctx.id}`;
    await (await documentFiles()).putFile(fileId, p.companyId || "platform", mime, buffer, new Date().toISOString());
    return { fileId, rows: rows.length, size: buffer.length, mime, name: `staffora-${p.type}-${new Date().toISOString().slice(0, 10)}.${p.format}` };
  });
  registerJobHandler("BACKUP", async (payload, ctx) => runBackup({ kind: (payload as { kind?: "MANUAL" | "SCHEDULED" }).kind || "MANUAL", createdBy: ctx.createdBy || "Tizim" }), 60 * 60_000);
  registerJobHandler("BACKUP_VERIFY", async (payload) => verifyBackup((payload as { id: string }).id), 30 * 60_000);
}

export function createOpsRouter() {
  const router = Router();

  /* ---------------------------------------------------------------- monitoring --- */
  router.get(
    "/super-admin/monitoring",
    requirePlatform("monitoring.read"),
    asyncRoute(async (_req, res) => {
      const db = await readDb();
      const jobs = await listJobs({}, 1, 0);
      res.json({
        health: await runHealthChecks(),
        minutes: recentMinutes(60),
        deployment: deploymentInfo(),
        workers: workerStates(),
        jobs: jobs.counts,
        incidents: db.platformIncidents.filter((i) => i.status !== "RESOLVED"),
        integrations: { railway: Boolean(process.env.RAILWAY_API_TOKEN), supabase: /supabase\.(co|com)/i.test(process.env.DATABASE_URL || "") },
      });
    }),
  );

  router.get(
    "/super-admin/incidents",
    requirePlatform("monitoring.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const status = q(req, "status");
      const rows = db.platformIncidents.filter((i) => (status === "open" ? i.status !== "RESOLVED" : !status || i.status === status));
      const { page, pageSize } = pageParams(req);
      res.json({ ...paginate(rows, page, pageSize), rules: db.platformSettings?.alerts || {} });
    }),
  );

  const incidentAction = (next: "ACKNOWLEDGED" | "RESOLVED") =>
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      const incident = await updateDb((db) => {
        const row = db.platformIncidents.find((i) => i.id === req.params.id);
        if (!row) throw httpError("Incident topilmadi.", 404);
        row.status = next;
        if (next === "ACKNOWLEDGED") row.acknowledgedBy = actor.name;
        else {
          row.resolvedAt = new Date().toISOString();
          row.resolvedBy = actor.name;
        }
        return row;
      });
      await platformAudit({ req, companyId: incident.companyId, action: `incident.${next.toLowerCase()}`, entity: "incident", entityId: incident.id, summary: `${incident.title} → ${next}` });
      res.json(incident);
    });
  router.post("/super-admin/incidents/:id/ack", requirePlatform("incidents.manage"), incidentAction("ACKNOWLEDGED"));
  router.post("/super-admin/incidents/:id/resolve", requirePlatform("incidents.manage"), incidentAction("RESOLVED"));
  router.post(
    "/super-admin/incidents/evaluate",
    requirePlatform("incidents.manage"),
    asyncRoute(async (_req, res) => res.json(await evaluateIncidentRules())),
  );

  /* --------------------------------------------------------------- xatolar --- */
  router.get(
    "/super-admin/errors",
    requirePlatform("monitoring.read"),
    asyncRoute(async (req, res) => {
      const store = await opsStore();
      const parts: string[] = [];
      const params: unknown[] = [];
      const add = (sql: string, value: unknown) => {
        parts.push(sql);
        params.push(value);
      };
      if (q(req, "status")) add("status = ?", q(req, "status"));
      if (q(req, "service")) add("service = ?", q(req, "service"));
      if (q(req, "severity")) add("severity = ?", q(req, "severity"));
      if (q(req, "companyId")) add("company_id = ?", q(req, "companyId"));
      if (q(req, "q")) add("message LIKE ?", `%${q(req, "q")}%`);
      const where = parts.length ? `WHERE ${parts.join(" AND ")}` : "";
      const { page, pageSize, offset } = pageParams(req);
      const rows = await store.all<RawError>(`SELECT * FROM platform_errors ${where} ORDER BY last_seen DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
      const total = Number((await store.all<{ n: number | string }>(`SELECT COUNT(*) AS n FROM platform_errors ${where}`, params))[0]?.n || 0);
      const counts = await store.all<{ status: string; n: number | string }>("SELECT status, COUNT(*) AS n FROM platform_errors GROUP BY status");
      res.json({ rows: rows.map((r) => toError(r, false)), total, page, pageSize, counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])) });
    }),
  );

  router.get(
    "/super-admin/errors/:fingerprint",
    requirePlatform("monitoring.read"),
    asyncRoute(async (req, res) => {
      const store = await opsStore();
      const rows = await store.all<RawError>("SELECT * FROM platform_errors WHERE fingerprint = ?", [req.params.fingerprint]);
      if (!rows[0]) throw httpError("Xato topilmadi.", 404);
      // Stack trace faqat incidentlarni boshqaradigan administratorlarga (maxfiy qiymatlar yozishda yashirilgan).
      res.json(toError(rows[0], hasPermission(req, "incidents.manage")));
    }),
  );

  router.patch(
    "/super-admin/errors/:fingerprint",
    requirePlatform("incidents.manage"),
    asyncRoute(async (req, res) => {
      const input = z.object({ status: z.enum(["NEW", "INVESTIGATING", "RESOLVED", "IGNORED"]), note: z.string().trim().max(500).optional() }).parse(req.body);
      const store = await opsStore();
      const changed = await store.run("UPDATE platform_errors SET status = ?, note = COALESCE(?, note) WHERE fingerprint = ?", [input.status, input.note ?? null, req.params.fingerprint]);
      if (!changed) throw httpError("Xato topilmadi.", 404);
      await platformAudit({ req, action: "error.status", entity: "error", entityId: String(req.params.fingerprint), summary: `Xato holati: ${input.status}` });
      res.json({ ok: true });
    }),
  );

  /* -------------------------------------------------------------- zaxiralar --- */
  router.get(
    "/super-admin/backups",
    requirePlatform("backups.read"),
    asyncRoute(async (_req, res) => {
      const db = await readDb();
      res.json({ records: db.backupRecords.slice(0, 50), environment: await backupEnvironment(), settings: db.platformSettings?.backups || {} });
    }),
  );

  router.post(
    "/super-admin/backups",
    requirePlatform("backups.manage"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      assertRecentAuth(req, db);
      if (db.backupRecords.some((b) => b.status === "RUNNING")) throw httpError("Zaxira allaqachon yaratilmoqda.", 409);
      const actor = actorOf(req);
      const job = await enqueueJob({ type: "BACKUP", payload: { kind: "MANUAL" }, createdBy: actor.name, maxAttempts: 1, dedupeKey: `backup:${new Date().toISOString().slice(0, 16)}` });
      await platformAudit({ req, action: "backup.create", entity: "backup", entityId: job?.id, summary: "Zaxira nusxa yaratish boshlandi", privileged: true });
      res.status(202).json({ job });
    }),
  );

  router.post(
    "/super-admin/backups/:id/verify",
    requirePlatform("backups.read"),
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      const job = await enqueueJob({ type: "BACKUP_VERIFY", payload: { id: req.params.id }, createdBy: actor.name, maxAttempts: 1 });
      await platformAudit({ req, action: "backup.verify", entity: "backup", entityId: String(req.params.id), summary: "Zaxirani tekshirish (restore test) boshlandi" });
      res.status(202).json({ job });
    }),
  );

  router.get(
    "/super-admin/backups/:id/download",
    requirePlatform("backups.manage"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      assertRecentAuth(req, db);
      const record = db.backupRecords.find((b) => b.id === req.params.id);
      const file = record ? backupFilePath(record) : null;
      if (!record || !file) throw httpError("Zaxira fayli topilmadi.", 404);
      await platformAudit({ req, action: "backup.download", entity: "backup", entityId: record.id, summary: `Zaxira yuklab olindi: ${record.file}`, privileged: true });
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(file)}"`);
      res.type("application/octet-stream");
      createReadStream(file).pipe(res);
    }),
  );

  /* ------------------------------------------------------------- fon ishlari --- */
  router.get(
    "/super-admin/jobs",
    requirePlatform("monitoring.read"),
    asyncRoute(async (req, res) => {
      const { page, pageSize, offset } = pageParams(req);
      const result = await listJobs({ status: q(req, "status") || undefined, type: q(req, "type") || undefined }, pageSize, offset);
      res.json({ ...result, page, pageSize, workers: workerStates() });
    }),
  );
  router.post(
    "/super-admin/jobs/:id/retry",
    requirePlatform("jobs.manage"),
    asyncRoute(async (req, res) => {
      const changed = await retryJob(String(req.params.id));
      if (!changed) throw httpError("Faqat xato yoki bekor qilingan ish qayta ishga tushiriladi.", 409);
      await platformAudit({ req, action: "job.retry", entity: "job", entityId: String(req.params.id), summary: "Fon ishi qayta navbatga qo‘yildi" });
      res.json({ ok: true });
    }),
  );
  router.post(
    "/super-admin/jobs/:id/cancel",
    requirePlatform("jobs.manage"),
    asyncRoute(async (req, res) => {
      const changed = await cancelJob(String(req.params.id));
      if (!changed) throw httpError("Faqat navbatdagi ish bekor qilinadi.", 409);
      await platformAudit({ req, action: "job.cancel", entity: "job", entityId: String(req.params.id), summary: "Fon ishi bekor qilindi" });
      res.json({ ok: true });
    }),
  );

  /* -------------------------------------------------------- xavfsizlik markazi --- */
  router.get(
    "/super-admin/security/overview",
    requirePlatform("security.read"),
    asyncRoute(async (_req, res) => {
      const db = await readDb();
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const counts = await securityCounts(since);
      const privileged = await queryPlatformAudit({ privileged: true, from: new Date(Date.now() - 7 * 86_400_000).toISOString() }, 20, 0);
      const now = new Date().toISOString();
      const expiredCutoff = new Date(Date.now() - 12 * 3600_000).toISOString();
      const admins = db.users.filter((u) => u.role === "SUPER_ADMIN");
      // Shubhali sessiyalar: administratorning yangi IP manzildan ochilgan faol sessiyasi (oldingi 30 kunda bo‘lmagan).
      const suspicious = db.panelSessions
        .filter((s) => !s.revokedAt && s.lastSeenAt > expiredCutoff)
        .filter((s) => {
          const user = db.users.find((u) => u.id === s.userId);
          if (user?.role !== "SUPER_ADMIN") return false;
          // Birinchi kirish shubhali emas: avval boshqa sessiyalar bo‘lgan, lekin hech biri shu IP’dan emas.
          const ip = (value: string | undefined) => String(value || "").replace(/^::ffff:/, "");
          const earlier = db.panelSessions.filter((o) => o.userId === s.userId && o.id !== s.id && o.createdAt < s.createdAt);
          return earlier.length > 0 && !earlier.some((o) => ip(o.ip) === ip(s.ip));
        })
        .map((s) => ({ id: s.id, user: db.users.find((u) => u.id === s.userId)?.email || "—", ip: s.ip, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, reason: "Administrator uchun yangi IP manzil" }));
      res.json({
        last24h: counts,
        admins: admins.map((a) => ({ id: a.id, email: a.email, role: a.platformRole || "OWNER", twoFactor: Boolean(a.twoFactorEnabled && a.telegramId), telegramLinked: Boolean(a.telegramId), blocked: Boolean(a.blockedAt) })),
        sessions: {
          active: db.panelSessions.filter((s) => !s.revokedAt && s.lastSeenAt > expiredCutoff).length,
          expired: db.panelSessions.filter((s) => !s.revokedAt && s.lastSeenAt <= expiredCutoff).length,
          revoked: db.panelSessions.filter((s) => s.revokedAt).length,
          mobileActive: db.mobileSessions.filter((s) => !s.revokedAt && s.expiresAt > now).length,
        },
        suspicious,
        privileged: privileged.rows,
        blockedUsers: db.users.filter((u) => u.blockedAt).length,
        requireAdminMfa: Boolean(db.platformSettings?.requireAdminMfa),
        checks: [
          { key: "rbac", label: "Server tomonda RBAC (platforma ruxsatlari)", ok: true },
          { key: "cookies", label: "Cookie: httpOnly + SameSite=Lax", ok: true, note: process.env.COOKIE_SECURE === "true" ? "Secure yoqilgan" : "COOKIE_SECURE=true tavsiya etiladi (HTTPS)" },
          { key: "csrf", label: "CSRF: Origin tekshiruvi (super admin API) + SameSite", ok: true },
          { key: "secrets", label: "SESSION_SECRET / JWT_SECRET uzunligi", ok: (process.env.SESSION_SECRET || "").length >= 32, note: "Productionda kamida 32 belgi majburiy" },
          { key: "mfa", label: "Administratorlar uchun 2 bosqichli kirish", ok: admins.every((a) => a.twoFactorEnabled && a.telegramId), note: "Telegram ulangan va 2FA yoqilgan bo‘lishi kerak" },
        ],
      });
    }),
  );

  router.get(
    "/super-admin/security/events",
    requirePlatform("security.read"),
    asyncRoute(async (req, res) => {
      const { page, pageSize, offset } = pageParams(req);
      res.json({ ...(await querySecurityEvents({ type: q(req, "type") || undefined, userId: q(req, "userId") || undefined }, pageSize, offset)), page, pageSize });
    }),
  );

  /* ---------------------------------------------------------------- resurslar --- */
  router.get(
    "/super-admin/resources",
    requirePlatform("monitoring.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const store = await opsStore();
      const files = await store.all<{ company_id: string; n: number | string; bytes: number | string | null }>("SELECT company_id, COUNT(*) AS n, SUM(LENGTH(data)) AS bytes FROM document_files GROUP BY company_id");
      const requests = await store.all<{ company_id: string; metric: string; v: number | string }>(
        "SELECT company_id, metric, SUM(value) AS v FROM platform_usage WHERE day >= ? AND metric IN ('api_requests','api_errors') GROUP BY company_id, metric",
        [isoDay(-30)],
      );
      const jobs = await store.all<{ company_id: string | null; type: string; n: number | string }>("SELECT company_id, type, COUNT(*) AS n FROM platform_jobs GROUP BY company_id, type");
      const rows = db.companies
        .filter((c) => isLive(c) || q(req, "all") === "1")
        .map((c) => {
          const f = files.find((x) => x.company_id === c.id);
          const metric = (m: string) => Number(requests.find((r) => r.company_id === c.id && r.metric === m)?.v || 0);
          return {
            id: c.id,
            name: c.name,
            files: Number(f?.n || 0),
            storageBytes: Number(f?.bytes || 0),
            attachments: db.supportTickets.filter((t) => t.companyId === c.id).reduce((s, t) => s + t.messages.reduce((m, msg) => m + (msg.attachments?.length || 0), 0), 0),
            requests30d: metric("api_requests"),
            errors30d: metric("api_errors"),
            exports: Number(jobs.filter((j) => j.company_id === c.id && j.type === "EXPORT").reduce((s, j) => s + Number(j.n), 0)),
            jobs: Number(jobs.filter((j) => j.company_id === c.id).reduce((s, j) => s + Number(j.n), 0)),
            integrations: (c.bot?.enabled ? 1 : 0) + (db.integrations.some((i) => i.companyId === c.id && i.status !== "DISCONNECTED") ? 1 : 0) + db.webhookEndpoints.filter((w) => w.companyId === c.id && w.enabled).length + db.apiKeys.filter((k) => k.companyId === c.id && !k.revokedAt).length,
          };
        })
        .sort((a, b) => b.storageBytes - a.storageBytes || b.requests30d - a.requests30d);
      const { page, pageSize } = pageParams(req);
      res.json({
        ...paginate(rows, page, pageSize),
        totals: { storageBytes: rows.reduce((s, r) => s + r.storageBytes, 0), files: rows.reduce((s, r) => s + r.files, 0), requests30d: rows.reduce((s, r) => s + r.requests30d, 0) },
        note: "CPU va RAM kompaniya kesimida ajratib o‘lchanmaydi — shuning uchun ko‘rsatilmaydi (taxminiy qiymat haqiqiy deb berilmaydi).",
      });
    }),
  );

  /* ------------------------------------------------------------------ eksport --- */
  router.get(
    "/super-admin/exports",
    requirePlatform("audit.export"),
    asyncRoute(async (req, res) => {
      const { page, pageSize, offset } = pageParams(req);
      const result = await listJobs({ type: "EXPORT" }, pageSize, offset);
      res.json({ ...result, page, pageSize, types: EXPORT_TYPES });
    }),
  );

  router.post(
    "/super-admin/exports",
    requirePlatform("audit.export"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          type: z.enum(["companies", "usage", "audit", "billing", "company_data"]),
          format: z.enum(["csv", "xlsx", "json"]),
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          companyId: z.string().optional(),
          reason: z.string().trim().max(300).optional(),
        })
        .parse(req.body);
      const db = await readDb();
      const actor = actorOf(req);
      // Ruxsatlar: audit/hisob-kitob uchun tegishli huquq; kompaniya ma’lumoti — sabab + qayta autentifikatsiya.
      if (input.type === "audit" && !platformCan(actor.role, "audit.read")) throw httpError("Audit eksporti uchun audit.read huquqi kerak.", 403);
      if (input.type === "billing" && !platformCan(actor.role, "billing.read")) throw httpError("Hisob-kitob eksporti uchun billing.read huquqi kerak.", 403);
      if (input.type === "company_data") {
        if (!input.companyId || !db.companies.some((c) => c.id === input.companyId)) throw httpError("Kompaniyani tanlang.", 400);
        if (!input.reason || input.reason.length < 10) throw httpError("Kompaniya ma’lumotini eksport qilish sababini yozing (kamida 10 belgi).", 400);
        assertRecentAuth(req, db);
      }
      const job = await enqueueJob({ type: "EXPORT", payload: input, createdBy: actor.name, companyId: input.companyId, maxAttempts: 2 });
      await platformAudit({
        req,
        companyId: input.companyId,
        action: "export.create",
        entity: "export",
        entityId: job?.id,
        summary: `Eksport: ${EXPORT_TYPES[input.type]} (${input.format.toUpperCase()})${input.reason ? ` — ${input.reason}` : ""}`,
        privileged: input.type === "company_data",
      });
      res.status(202).json(job);
    }),
  );

  router.get(
    "/super-admin/exports/:id/download",
    requirePlatform("audit.export"),
    asyncRoute(async (req, res) => {
      const job = await getJob(String(req.params.id));
      const actor = actorOf(req);
      if (!job || job.type !== "EXPORT" || job.status !== "SUCCEEDED") throw httpError("Eksport tayyor emas yoki topilmadi.", 404);
      if (job.createdBy !== actor.name && actor.role !== "OWNER") throw httpError("Eksportni faqat yaratgan administrator yuklab oladi.", 403);
      if (Date.now() - Date.parse(job.finishedAt || job.createdAt) > 24 * 3600_000) throw httpError("Havola muddati tugagan (24 soat). Qayta eksport qiling.", 410);
      const result = job.result as { fileId: string; name: string; mime: string };
      const file = await (await documentFiles()).getFile(result.fileId);
      if (!file) throw httpError("Fayl topilmadi.", 404);
      await platformAudit({ req, companyId: job.companyId || undefined, action: "export.download", entity: "export", entityId: job.id, summary: `Eksport yuklab olindi: ${result.name}` });
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", `attachment; filename="${result.name}"`);
      res.type(result.mime).send(Buffer.from(file.data));
    }),
  );

  return router;
}

