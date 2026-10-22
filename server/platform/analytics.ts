import { dataVersion, opsStore, readDb } from "../../lib/store";
import type { Company, Database, User } from "../../lib/types";
import { MODULES } from "../../lib/modules";
import { LEADER_ROLES } from "../../lib/platform/types";
import { daysLeft, subscriptionStatus } from "../../lib/platform/subscriptions";
import { onboardingSteps } from "../../lib/platform/onboarding";
import { healthScore } from "../../lib/platform/health";
import { companyDisabledModules, companyModulePolicy } from "../modules";
import { moduleDecision } from "../../lib/modules";
import { runHealthChecks } from "./monitoring";
import { queryPlatformAudit } from "./audit";

/*
 * Analitika — faqat haqiqiy ma’lumotdan; demo (sintetik) kompaniyalar asosiy ko‘rsatkichlarga qo‘shilmaydi.
 * Og‘ir hisoblar ma’lumot versiyasi (dataVersion) bo‘yicha keshlanadi.
 * «Bugun» — hisobot vaqt mintaqasida (standart Asia/Tashkent; kompaniyalarning hammasi hozir shu mintaqada).
 */

export type DayStats = { present: number; late: number; absent: number; leave: number; dayOff: number; notYet: number };
let rosterProvider: ((db: Database, companyId: string, date: string) => DayStats) | null = null;
/** server/index.ts dagi mavjud kunlik ro‘yxat hisobini ulaydi (bir xil qoida — dashboard bilan mos). */
export function setRosterProvider(fn: (db: Database, companyId: string, date: string) => DayStats) {
  rosterProvider = fn;
}

export const isLive = (c: Company) => !c.demo && !c.archive;
export function localDate(timezone = "Asia/Tashkent", at = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return new Date(at.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
  }
}
export const isoDay = (offsetDays = 0, timezone = "Asia/Tashkent") => localDate(timezone, new Date(Date.now() + offsetDays * 86_400_000));

/* ---------------------------------------------------------- kompaniya indeksi --- */
export type CompanyIndexRow = {
  activeEmployees: number;
  dismissed: number;
  telegramLinked: number;
  faceEnrolled: number;
  withSchedule: number;
  branches: number;
  schedules: number;
  users: number;
  leaders: number;
  owner?: User;
  attendanceTotal: number;
  attendance7d: number;
  lastActivity?: string;
};
let indexCache: { version: number; value: Map<string, CompanyIndexRow> } | undefined;

export function companyIndex(db: Database) {
  const version = dataVersion();
  if (indexCache && indexCache.version === version) return indexCache.value;
  const map = new Map<string, CompanyIndexRow>();
  const row = (id: string) => {
    let r = map.get(id);
    if (!r) map.set(id, (r = { activeEmployees: 0, dismissed: 0, telegramLinked: 0, faceEnrolled: 0, withSchedule: 0, branches: 0, schedules: 0, users: 0, leaders: 0, attendanceTotal: 0, attendance7d: 0 }));
    return r;
  };
  const touch = (r: CompanyIndexRow, at?: string) => {
    if (at && at > (r.lastActivity || "")) r.lastActivity = at;
  };
  for (const c of db.companies) row(c.id);
  for (const e of db.employees) {
    const r = row(e.companyId);
    if (e.status === "ACTIVE") {
      r.activeEmployees += 1;
      if (e.telegramConnected) r.telegramLinked += 1;
      if (e.faceEnrolledAt) r.faceEnrolled += 1;
      if (e.scheduleId) r.withSchedule += 1;
    } else if (e.status === "DISMISSED") r.dismissed += 1;
  }
  for (const b of db.branches) row(b.companyId).branches += 1;
  for (const s of db.schedules) row(s.companyId).schedules += 1;
  const week = isoDay(-7);
  for (const a of db.attendance) {
    const r = row(a.companyId);
    r.attendanceTotal += 1;
    if (a.date >= week) r.attendance7d += 1;
    touch(r, a.updatedAt);
  }
  for (const u of db.users) {
    if (!u.companyId) continue;
    const r = row(u.companyId);
    r.users += 1;
    if (LEADER_ROLES.includes(u.role)) r.leaders += 1;
    if (u.role === "COMPANY_OWNER" && !r.owner) r.owner = u;
  }
  const userCompany = new Map(db.users.filter((u) => u.companyId).map((u) => [u.id, u.companyId!]));
  for (const s of db.panelSessions) {
    const company = userCompany.get(s.userId);
    if (company) touch(row(company), s.lastSeenAt);
  }
  for (const log of db.auditLogs) touch(row(log.companyId), log.createdAt);
  indexCache = { version, value: map };
  return map;
}

export function botState(company: Company): "NONE" | "RUNNING" | "ERROR" | "STOPPED" {
  if (!company.bot?.enabled) return "NONE";
  return company.bot.status || "STOPPED";
}

/** Onboarding (haqiqiy ma’lumotdan). */
export function companyOnboarding(db: Database, company: Company) {
  const r = companyIndex(db).get(company.id)!;
  const disabled = companyDisabledModules(db, company);
  return onboardingSteps({
    hasOwner: Boolean(r.owner),
    branches: r.branches,
    activeEmployees: r.activeEmployees,
    schedules: r.schedules,
    employeesWithSchedule: r.withSchedule,
    modulesEnabled: MODULES.length - disabled.length,
    modulesTotal: MODULES.length,
    bot: botState(company),
    telegramLinked: r.telegramLinked,
    attendanceRecords: r.attendanceTotal,
    notes: company.onboardingNotes,
  });
}

/** Kompaniya bo‘yicha 7 kunlik so‘rov va xatolar (agregat). */
export async function companyRequests(companyId: string | null, days = 7) {
  const store = await opsStore();
  const since = isoDay(-days);
  const rows = await store.all<{ company_id: string; metric: string; v: number | string }>(
    `SELECT company_id, metric, SUM(value) AS v FROM platform_usage WHERE day >= ? AND metric IN ('api_requests','api_errors') ${companyId ? "AND company_id = ?" : ""} GROUP BY company_id, metric`,
    companyId ? [since, companyId] : [since],
  );
  const out = new Map<string, { requests: number; errors: number }>();
  for (const r of rows) {
    const item = out.get(r.company_id) || { requests: 0, errors: 0 };
    if (r.metric === "api_requests") item.requests = Number(r.v);
    else item.errors = Number(r.v);
    out.set(r.company_id, item);
  }
  return out;
}

/** Sog‘liq bahosi (formula — lib/platform/health.ts). */
export async function companyHealth(db: Database, company: Company, requests?: Map<string, { requests: number; errors: number }>) {
  const r = companyIndex(db).get(company.id)!;
  const traffic = (requests || (await companyRequests(company.id))).get(company.id) || { requests: 0, errors: 0 };
  const policy = companyModulePolicy(db, company);
  const expected = MODULES.filter((m) => policy.planModules === undefined || policy.planModules === "all" || policy.planModules.includes(m.key)).filter((m) => company.modules?.[m.key] !== false);
  const available = expected.filter((m) => moduleDecision(company.modules, m.key, policy).enabled);
  const onboarding = companyOnboarding(db, company);
  return healthScore({
    activeEmployees: r.activeEmployees,
    attendance7d: r.attendance7d,
    requests7d: traffic.requests,
    errors7d: traffic.errors,
    bot: botState(company),
    telegramLinked: r.telegramLinked,
    modulesAvailable: available.length,
    modulesExpected: expected.length,
    onboardingPercent: onboarding.percent,
    openIncidents: db.platformIncidents.filter((i) => i.companyId === company.id && i.status !== "RESOLVED").length,
    failingWebhooks: db.webhookEndpoints.filter((w) => w.companyId === company.id && w.enabled && w.failures >= 5).length,
  });
}

/* ------------------------------------------------------------------ overview --- */
let overviewCache: { at: number; version: number; value: unknown } | undefined;

export async function platformOverview() {
  const db = await readDb();
  if (overviewCache && overviewCache.version === dataVersion() && Date.now() - overviewCache.at < 60_000) return overviewCache.value;
  const tz = db.platformSettings?.reportingTimezone || "Asia/Tashkent";
  const today = localDate(tz);
  const live = db.companies.filter(isLive);
  const liveIds = new Set(live.map((c) => c.id));
  const index = companyIndex(db);
  let present = 0;
  let absent = 0;
  if (rosterProvider)
    for (const c of live) {
      if (c.status === "SUSPENDED") continue;
      const s = rosterProvider(db, c.id, localDate(c.timezone || tz));
      present += s.present;
      absent += s.absent;
    }
  const now = new Date().toISOString();
  const recent = new Date(Date.now() - 30 * 60_000).toISOString();
  const store = await opsStore();
  const since24 = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 13);
  const errors24 = Number((await store.all<{ n: number | string }>("SELECT COALESCE(SUM(errors), 0) AS n FROM platform_metrics WHERE bucket >= ?", [since24]))[0]?.n || 0);
  const health = await runHealthChecks();
  const value = {
    generatedAt: now,
    today,
    kpis: {
      companies: live.length,
      active: live.filter((c) => c.status === "ACTIVE").length,
      blocked: live.filter((c) => c.status === "SUSPENDED").length,
      trial: live.filter((c) => c.status === "TRIAL" || c.subscription?.status === "TRIAL").length,
      archived: db.companies.filter((c) => c.archive).length,
      demo: db.companies.filter((c) => c.demo).length,
      employees: live.reduce((s, c) => s + (index.get(c.id)?.activeEmployees || 0), 0),
      branches: db.branches.filter((b) => liveIds.has(b.companyId)).length,
      leaders: db.users.filter((u) => u.companyId && liveIds.has(u.companyId) && LEADER_ROLES.includes(u.role) && !u.blockedAt).length,
      presentToday: present,
      absentToday: absent,
      activeSessions:
        db.panelSessions.filter((s) => !s.revokedAt && s.lastSeenAt >= recent).length + db.mobileSessions.filter((s) => !s.revokedAt && s.lastUsedAt >= recent && s.expiresAt > now).length,
      errors24h: errors24,
      openTickets: db.supportTickets.filter((t) => ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"].includes(t.status)).length,
      expiringSoon: live.filter((c) => {
        if (!c.subscription) return false;
        const left = daysLeft(c.subscription, now);
        return left !== null && left >= 0 && left <= 7;
      }).length,
      platformHealth: health.overall,
    },
    health,
    openIncidents: db.platformIncidents.filter((i) => i.status !== "RESOLVED").slice(0, 5),
  };
  overviewCache = { at: Date.now(), version: dataVersion(), value };
  return value;
}

/* ----------------------------------------------------------------- analytics --- */
const dayList = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`) && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

export async function platformAnalytics(from: string, to: string) {
  const db = await readDb();
  const days = dayList(from, to);
  const live = db.companies.filter(isLive);
  const liveIds = new Set(live.map((c) => c.id));
  const store = await opsStore();

  // Kompaniyalar o‘sishi (yaratilgan sana bo‘yicha).
  const created = live.map((c) => c.createdAt.slice(0, 10)).sort();
  const companiesGrowth = days.map((day) => ({ date: day, total: created.filter((d) => d <= day).length, added: created.filter((d) => d === day).length }));

  // Faol panel foydalanuvchilari (DAU) va MAU.
  const dau = await store.all<{ day: string; n: number | string }>("SELECT day, COUNT(*) AS n FROM platform_active_users WHERE day >= ? AND day <= ? GROUP BY day", [from, to]);
  const mau = Number((await store.all<{ n: number | string }>("SELECT COUNT(DISTINCT user_id) AS n FROM platform_active_users WHERE day >= ? AND day <= ?", [from, to]))[0]?.n || 0);
  const dauMap = new Map(dau.map((r) => [r.day, Number(r.n)]));
  const activeUsers = days.map((day) => ({ date: day, users: dauMap.get(day) || 0 }));

  // Davomat faolligi (qaydlar va noyob xodimlar).
  const att = new Map<string, { records: number; employees: Set<string> }>();
  for (const a of db.attendance) {
    if (!liveIds.has(a.companyId) || a.date < from || a.date > to) continue;
    let item = att.get(a.date);
    if (!item) att.set(a.date, (item = { records: 0, employees: new Set() }));
    item.records += 1;
    item.employees.add(a.employeeId);
  }
  const attendance = days.map((day) => ({ date: day, records: att.get(day)?.records || 0, employees: att.get(day)?.employees.size || 0 }));

  // Modullardan foydalanish: nechta kompaniyada yoqilgan va so‘rovlar soni.
  const moduleRows = await store.all<{ metric: string; v: number | string }>("SELECT metric, SUM(value) AS v FROM platform_usage WHERE day >= ? AND day <= ? AND metric LIKE 'module:%' GROUP BY metric", [from, to]);
  const moduleReq = new Map(moduleRows.map((r) => [r.metric.slice(7), Number(r.v)]));
  const moduleUsage = MODULES.map((m) => ({
    key: m.key,
    label: m.label,
    companies: live.filter((c) => !companyDisabledModules(db, c).includes(m.key)).length,
    requests: moduleReq.get(m.key) || 0,
  })).sort((a, b) => b.requests - a.requests);

  // Tariflar bo‘yicha.
  const planName = (c: Company) => (c.subscription ? db.subscriptionPlans.find((p) => p.id === c.subscription!.planId)?.name : undefined) || c.plan || "—";
  const planCounts = new Map<string, number>();
  for (const c of live) planCounts.set(planName(c), (planCounts.get(planName(c)) || 0) + 1);
  const plans = [...planCounts.entries()].map(([plan, companies]) => ({ plan, companies })).sort((a, b) => b.companies - a.companies);

  // API xatolari va resurslar (soatlik metrikalardan).
  const metrics = await store.all<{ bucket: string; requests: number | string; errors: number | string; client_errors: number | string; p95_ms: number | string; rss_mb: number | string; lag_ms: number | string }>(
    "SELECT * FROM platform_metrics WHERE bucket >= ? AND bucket <= ? ORDER BY bucket",
    [`${from}T00:00`, `${to}T23:59`],
  );
  const byDay = new Map<string, { requests: number; errors: number; clientErrors: number }>();
  for (const m of metrics) {
    const day = m.bucket.slice(0, 10);
    const item = byDay.get(day) || { requests: 0, errors: 0, clientErrors: 0 };
    item.requests += Number(m.requests);
    item.errors += Number(m.errors);
    item.clientErrors += Number(m.client_errors);
    byDay.set(day, item);
  }
  const apiErrors = days.map((day) => ({ date: day, ...(byDay.get(day) || { requests: 0, errors: 0, clientErrors: 0 }) }));
  const resources = metrics.map((m) => ({ bucket: m.bucket, rssMb: Number(m.rss_mb), lagMs: Number(m.lag_ms), p95Ms: Number(m.p95_ms), requests: Number(m.requests) }));

  return { from, to, companiesGrowth, activeUsers, mau, attendance, moduleUsage, plans, apiErrors, resources };
}

/* ------------------------------------------------------------- foydalanish --- */
export async function usageAnalytics(from: string, to: string) {
  const db = await readDb();
  const store = await opsStore();
  const live = db.companies.filter(isLive);
  const index = companyIndex(db);
  const usage = await store.all<{ company_id: string; metric: string; v: number | string }>(
    "SELECT company_id, metric, SUM(value) AS v FROM platform_usage WHERE day >= ? AND day <= ? AND metric IN ('api_requests','api_errors','employee_requests') GROUP BY company_id, metric",
    [from, to],
  );
  const users = await store.all<{ company_id: string; n: number | string }>("SELECT company_id, COUNT(DISTINCT user_id) AS n FROM platform_active_users WHERE day >= ? AND day <= ? GROUP BY company_id", [from, to]);
  const today = isoDay(0);
  const dau = Number((await store.all<{ n: number | string }>("SELECT COUNT(*) AS n FROM platform_active_users WHERE day = ?", [today]))[0]?.n || 0);
  const mau = Number((await store.all<{ n: number | string }>("SELECT COUNT(DISTINCT user_id) AS n FROM platform_active_users WHERE day >= ?", [isoDay(-30)]))[0]?.n || 0);
  const storage = await store.all<{ company_id: string; n: number | string; bytes: number | string | null }>("SELECT company_id, COUNT(*) AS n, SUM(LENGTH(data)) AS bytes FROM document_files GROUP BY company_id");
  const metric = (company: string, name: string) => Number(usage.find((u) => u.company_id === company && u.metric === name)?.v || 0);
  const attendanceIn = new Map<string, number>();
  for (const a of db.attendance) if (a.date >= from && a.date <= to) attendanceIn.set(a.companyId, (attendanceIn.get(a.companyId) || 0) + 1);
  const companies = live
    .map((c) => ({
      id: c.id,
      name: c.name,
      requests: metric(c.id, "api_requests"),
      errors: metric(c.id, "api_errors"),
      employeeRequests: metric(c.id, "employee_requests"),
      activeUsers: Number(users.find((u) => u.company_id === c.id)?.n || 0),
      attendance: attendanceIn.get(c.id) || 0,
      employees: index.get(c.id)?.activeEmployees || 0,
      files: Number(storage.find((s) => s.company_id === c.id)?.n || 0),
      storageBytes: Number(storage.find((s) => s.company_id === c.id)?.bytes || 0),
    }))
    .sort((a, b) => b.requests - a.requests);
  const analytics = await platformAnalytics(from, to);
  const recent = new Date(Date.now() - 30 * 60_000).toISOString();
  return {
    from,
    to,
    dau,
    mau,
    activeSessions: db.panelSessions.filter((s) => !s.revokedAt && s.lastSeenAt >= recent).length,
    mobileSessions: db.mobileSessions.filter((s) => !s.revokedAt && s.lastUsedAt >= recent).length,
    totals: {
      requests: companies.reduce((s, c) => s + c.requests, 0),
      attendance: companies.reduce((s, c) => s + c.attendance, 0),
      storageBytes: storage.reduce((s, r) => s + Number(r.bytes || 0), 0),
    },
    companies,
    modules: analytics.moduleUsage,
    activeUsers: analytics.activeUsers,
  };
}

/** So‘nggi muhim voqealar: platforma auditi + yangi kompaniyalar + yangi muhim xatolar. */
export async function recentActivities(limit = 20) {
  const db = await readDb();
  const audit = await queryPlatformAudit({}, limit, 0);
  const store = await opsStore();
  const errors = await store.all<{ fingerprint: string; message: string; first_seen: string; severity: string; service: string }>(
    "SELECT fingerprint, message, first_seen, severity, service FROM platform_errors WHERE severity IN ('HIGH','CRITICAL') ORDER BY first_seen DESC LIMIT 5",
  );
  const items = [
    ...audit.rows.map((r) => ({ id: r.id, at: r.at, kind: "audit", action: r.action, title: r.summary, actor: r.actorName, companyId: r.companyId })),
    ...db.companies
      .filter((c) => !c.demo)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5)
      .map((c) => ({ id: `company:${c.id}`, at: c.createdAt, kind: "company", action: "company.created", title: `Yangi kompaniya: ${c.name}`, actor: "", companyId: c.id })),
    ...errors.map((e) => ({ id: `error:${e.fingerprint}`, at: e.first_seen, kind: "error", action: "error.new", title: `Yangi xato (${e.service}): ${e.message.slice(0, 120)}`, actor: "", companyId: null })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Kompaniya resurslari (haqiqiy qiymatlar; CPU/RAM kompaniya kesimida ajratib bo‘lmaydi — ko‘rsatilmaydi). */
export async function companyResources(db: Database, companyId: string) {
  const store = await opsStore();
  const files = await store.all<{ n: number | string; bytes: number | string | null }>("SELECT COUNT(*) AS n, SUM(LENGTH(data)) AS bytes FROM document_files WHERE company_id = ?", [companyId]);
  const requests30 = await store.all<{ metric: string; v: number | string }>("SELECT metric, SUM(value) AS v FROM platform_usage WHERE company_id = ? AND day >= ? AND metric IN ('api_requests','api_errors','employee_requests') GROUP BY metric", [companyId, isoDay(-30)]);
  const jobs = await store.all<{ status: string; n: number | string }>("SELECT status, COUNT(*) AS n FROM platform_jobs WHERE company_id = ? GROUP BY status", [companyId]);
  const exports = Number((await store.all<{ n: number | string }>("SELECT COUNT(*) AS n FROM platform_jobs WHERE company_id = ? AND type = 'EXPORT'", [companyId]))[0]?.n || 0);
  const company = db.companies.find((c) => c.id === companyId);
  const integrations = [
    company?.bot?.enabled ? "Kompaniya boti" : null,
    db.integrations.some((i) => i.companyId === companyId && i.status !== "DISCONNECTED") ? "Xodimlar boti (HR)" : null,
    company?.photoChannel?.enabled ? "Rasm kanali" : null,
    ...db.webhookEndpoints.filter((w) => w.companyId === companyId && w.enabled).map((w) => `Webhook: ${new URL(w.url).host}`),
    ...db.apiKeys.filter((k) => k.companyId === companyId && !k.revokedAt).map((k) => `API kalit: ${k.name}`),
  ].filter(Boolean) as string[];
  const metric = (name: string) => Number(requests30.find((r) => r.metric === name)?.v || 0);
  return {
    files: Number(files[0]?.n || 0),
    storageBytes: Number(files[0]?.bytes || 0),
    attachments: db.supportTickets.filter((t) => t.companyId === companyId).reduce((s, t) => s + t.messages.reduce((m, msg) => m + (msg.attachments?.length || 0), 0), 0),
    contracts: db.companyContracts.filter((c) => c.companyId === companyId).length,
    requests30d: metric("api_requests"),
    errors30d: metric("api_errors"),
    employeeRequests30d: metric("employee_requests"),
    exports,
    jobs: Object.fromEntries(jobs.map((j) => [j.status, Number(j.n)])),
    integrations,
  };
}

export { subscriptionStatus };
