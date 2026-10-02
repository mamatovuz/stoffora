import { Router, type NextFunction, type Request, type Response } from "express";
import { dataIndexes, readDb } from "../lib/store";
import { can, canAny } from "../lib/permissions";
import { tashkentClock, tashkentIsoDate } from "../lib/format";
import { dayPlan } from "../lib/schedule";
import type { Database, Employee, Role } from "../lib/types";
import type { AuthedRequest } from "./auth";
import { documentStatus } from "./documents";
import { financeSummary } from "./finance";
import { closedPeriod } from "./payroll-routes";

/*
 * Ish stoli (har bir rol uchun):
 *   • Approval Inbox — barcha tasdiqlashlar bitta ro‘yxatda; rol va filial chegarasi bo‘yicha.
 *     Har bir yozuvda qaror qabul qilish yo‘li (mavjud API) — mijozlar umumiy tarzda chaqiradi.
 *   • Action Center — «bugun nima qilishim kerak»: rolga mos ogohlantirishlar.
 *   • Direktor Control Center — bugungi davomat, oy pullari, filiallar taqqoslanishi.
 *   • IT — qurilmalar va xavfsizlik markazi; filial rahbari — smena markazi (bugun va ertaga).
 *   • HR — xodim tarixi (timeline) va onboarding checklist.
 * Hech qanday yozish yo‘q — hammasi o‘qish; qarorlar mavjud (tekshirilgan) API’lar orqali.
 */

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req as AuthedRequest, res)).catch(next);
const nameOf = (e?: Pick<Employee, "firstName" | "lastName">) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
const som = (v: number) => `${Math.round(v).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
const dmy = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Eng so‘nggi ilova versiyasi (eskilarini ko‘rsatish uchun). */
export const compareVersions = (a = "0", b = "0") => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

/** Filial rahbari — faqat o‘z filiallari (boshqalar uchun null — cheklovsiz). */
function scopeOf(db: Database, req: AuthedRequest) {
  return req.session!.role === "BRANCH_MANAGER" ? new Set(db.users.find((u) => u.id === req.session!.userId)?.branchIds || []) : null;
}

/* =============================================================== Inbox === */
export type InboxItem = {
  kind: "correction" | "leave" | "swap" | "dayoff" | "advance" | "fine" | "overtime" | "device" | "registration";
  id: string;
  label: string;
  title: string;
  sub: string;
  detail?: string;
  urgent: boolean;
  stage?: string;
  employeeId?: string;
  photoDataUrl?: string;
  createdAt: string;
  /** Qaror: mavjud API yo‘li va tanalari (rad etish boshqa yo‘lda bo‘lsa — rejectPath). */
  decide: { method: "POST" | "PATCH"; path: string; rejectPath?: string; approve: Record<string, unknown>; reject: Record<string, unknown> };
  /** Belgilash so‘rovi uchun: sana, vaqt, Kirish/Chiqish, filial. */
  meta?: { date?: string; time?: string; markKind?: "IN" | "OUT"; branch?: string };
};

const LEAVE: Record<string, string> = { VACATION: "Mehnat ta’tili", SICK: "Kasallik", PERMISSION: "Ruxsat", UNPAID: "Haq to‘lanmaydigan", OTHER: "Boshqa" };

export function buildInbox(db: Database, tenant: string, role: Role, scope: Set<string> | null, today = tashkentIsoDate()): InboxItem[] {
  const items: InboxItem[] = [];
  const emp = (id: string) => db.employees.find((e) => e.id === id && e.companyId === tenant);
  const inScope = (e?: Employee, branchId?: string) => Boolean(e) && (!scope || scope.has(e!.branchId) || Boolean(branchId && scope.has(branchId)));
  const canAttendanceDecide = canAny(role, ["attendance.edit", "leave.approve"]);

  if (canAttendanceDecide)
    for (const r of db.attendanceCorrections.filter((x) => x.companyId === tenant && x.status === "PENDING")) {
      const e = emp(r.employeeId);
      if (!inScope(e, r.branchId)) continue;
      items.push({
        kind: "correction",
        id: r.id,
        label: "Belgilash",
        title: nameOf(e),
        sub: `${dmy(r.date)} · ${r.kind === "IN" ? "Kirish" : "Chiqish"} ${r.time} · ${db.branches.find((b) => b.id === r.branchId)?.name || ""}`,
        detail: r.comment,
        urgent: r.date >= addDays(today, -1),
        employeeId: e!.id,
        photoDataUrl: e!.photoDataUrl,
        createdAt: r.createdAt,
        decide: { method: "POST", path: `/attendance-corrections/${r.id}/decide`, approve: { approve: true }, reject: { approve: false } },
        meta: { date: r.date, time: r.time, markKind: r.kind, branch: db.branches.find((b) => b.id === r.branchId)?.name },
      });
    }

  if (can(role, "leave.approve"))
    for (const l of db.leaveRequests.filter((x) => x.companyId === tenant && x.status === "PENDING")) {
      const e = emp(l.employeeId);
      if (!inScope(e)) continue;
      items.push({
        kind: "leave",
        id: l.id,
        label: "Ta’til",
        title: nameOf(e),
        sub: `${LEAVE[l.type] || l.type} · ${dmy(l.startDate)} – ${dmy(l.endDate)}`,
        detail: l.reason,
        urgent: l.startDate <= addDays(today, 2),
        employeeId: e!.id,
        photoDataUrl: e!.photoDataUrl,
        createdAt: l.createdAt,
        decide: { method: "PATCH", path: `/leave/${l.id}`, approve: { status: "APPROVED" }, reject: { status: "REJECTED" } },
      });
    }

  if (canAttendanceDecide) {
    for (const s of db.shiftSwaps.filter((x) => x.companyId === tenant && x.status === "PENDING_MANAGER")) {
      const a = emp(s.requesterId);
      const b = emp(s.colleagueId);
      if (!inScope(a)) continue;
      items.push({
        kind: "swap",
        id: s.id,
        label: "Smena",
        title: `${nameOf(a)} ↔ ${nameOf(b)}`,
        sub: `${dmy(s.giveDate)}${s.takeDate ? ` ↔ ${dmy(s.takeDate)}` : ""}`,
        detail: s.reason,
        urgent: s.giveDate <= addDays(today, 1),
        employeeId: a!.id,
        photoDataUrl: a!.photoDataUrl,
        createdAt: s.createdAt,
        decide: { method: "POST", path: `/shift-swaps/${s.id}/decide`, approve: { approve: true }, reject: { approve: false } },
      });
    }
    for (const m of db.dayOffMoves.filter((x) => x.companyId === tenant && x.status === "PENDING")) {
      const e = emp(m.employeeId);
      if (!inScope(e)) continue;
      items.push({
        kind: "dayoff",
        id: m.id,
        label: "Dam kuni",
        title: nameOf(e),
        sub: `${dmy(m.fromDate)} ishlaydi → ${dmy(m.toDate)} dam oladi`,
        detail: m.reason,
        urgent: m.fromDate <= addDays(today, 1),
        employeeId: e!.id,
        photoDataUrl: e!.photoDataUrl,
        createdAt: m.createdAt,
        decide: { method: "POST", path: `/dayoff-moves/${m.id}/decide`, approve: { approve: true }, reject: { approve: false } },
      });
    }
  }

  // Avans: 2 bosqich — HR (PENDING), keyin moliya (HR_APPROVED). Bosqich o‘chirilgan bo‘lsa — darhol moliya.
  const twoStep = db.companies.find((c) => c.id === tenant)?.payroll?.advanceHrApproval !== false;
  const hr = canAny(role, ["leave.approve", "employees.edit"]);
  const finance = can(role, "payroll.edit");
  for (const a of db.advanceRequests.filter((x) => x.companyId === tenant && (x.status === "PENDING" || x.status === "HR_APPROVED"))) {
    const mine = a.status === "PENDING" ? (twoStep ? hr : finance) : finance;
    const e = emp(a.employeeId);
    if (!mine || !inScope(e)) continue;
    items.push({
      kind: "advance",
      id: a.id,
      label: "Avans",
      title: nameOf(e),
      sub: `${som(a.amount)}${a.payout?.method === "CARD" ? ` · ${a.payout.cardMask}` : a.payout?.method === "CASH" ? " · naqd" : ""}`,
      detail: a.reason,
      stage: a.status === "HR_APPROVED" ? "HR ✓ → Moliya kutilmoqda" : twoStep ? "HR kutilmoqda" : "Moliya kutilmoqda",
      urgent: Date.now() - Date.parse(a.createdAt) > 24 * 3600_000,
      employeeId: e!.id,
      photoDataUrl: e!.photoDataUrl,
      createdAt: a.createdAt,
      decide: { method: "POST", path: `/payroll/advances/${a.id}/decide`, approve: { approve: true }, reject: { approve: false } },
    });
  }

  if (canAny(role, ["employees.edit", "payroll.edit"]))
    for (const f of db.payrollAdjustments.filter((x) => x.companyId === tenant && x.type === "FINE" && x.status === "PENDING")) {
      const e = emp(f.employeeId);
      if (!e) continue;
      items.push({
        kind: "fine",
        id: f.id,
        label: "Jarima",
        title: nameOf(e),
        sub: `${som(f.amount)} · taklif: ${f.proposedBy || "—"}`,
        detail: f.note,
        urgent: false,
        employeeId: e.id,
        photoDataUrl: e.photoDataUrl,
        createdAt: f.createdAt,
        decide: { method: "POST", path: `/fines/${f.id}/decide`, approve: { approve: true }, reject: { approve: false } },
      });
    }

  const company = db.companies.find((c) => c.id === tenant);
  if (company?.payroll?.overtimeRequiresApproval && canAny(role, ["attendance.edit", "payroll.edit"])) {
    const month = today.slice(0, 7);
    if (!closedPeriod(db, tenant, month))
      for (const a of db.attendance.filter((x) => x.companyId === tenant && x.date.startsWith(month) && x.overtimeMinutes > 0 && x.overtimeApproved === undefined)) {
        const e = emp(a.employeeId);
        if (!inScope(e, a.branchId)) continue;
        items.push({
          kind: "overtime",
          id: a.id,
          label: "Qo‘shimcha ish",
          title: nameOf(e),
          sub: `${dmy(a.date)} · +${a.overtimeMinutes} daq (${a.checkOut || "…"} / grafik ${a.scheduledEnd})`,
          detail: a.overtimeNote,
          urgent: false,
          employeeId: e!.id,
          photoDataUrl: e!.photoDataUrl,
          createdAt: a.updatedAt,
          decide: { method: "POST", path: `/attendance/${a.id}/overtime`, approve: { approved: true }, reject: { approved: false } },
        });
      }
  }

  if (canAny(role, ["employees.edit", "devices.manage"]))
    for (const r of db.deviceChangeRequests.filter((x) => x.companyId === tenant && x.status === "PENDING")) {
      const e = emp(r.employeeId);
      if (!inScope(e)) continue;
      items.push({
        kind: "device",
        id: r.id,
        label: "Telefon",
        title: nameOf(e),
        sub: `Yangi telefon: ${r.model || r.platform}`,
        // Xodim yangi telefonda kira olmay turibdi — shoshilinch.
        urgent: true,
        employeeId: e!.id,
        photoDataUrl: e!.photoDataUrl,
        createdAt: r.createdAt,
        decide: { method: "POST", path: `/mobile/device-requests/${r.id}/decide`, approve: { approve: true }, reject: { approve: false } },
      });
    }

  if (can(role, "registrations.approve"))
    for (const r of db.registrations.filter((x) => x.companyId === tenant && x.status === "PENDING"))
      items.push({
        kind: "registration",
        id: r.id,
        label: "Anketa",
        title: r.data.fullName || r.telegramName || "Yangi xodim",
        sub: `${db.positions.find((p) => p.id === r.data.positionId)?.name || "—"} · ${db.branches.find((b) => b.id === r.data.branchId)?.name || "—"}`,
        urgent: false,
        createdAt: r.submittedAt || r.createdAt,
        decide: { method: "POST", path: `/registrations/${r.id}/approve`, rejectPath: `/registrations/${r.id}/reject`, approve: {}, reject: {} },
      });

  return items.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.createdAt.localeCompare(b.createdAt));
}

/* ================================================================ Bugun === */
type DayStat = { planned: number; came: number; late: number; absent: number; notYet: number; noCheckout: number };
function todayStats(db: Database, employees: Employee[], date: string, now: string): { stat: DayStat; issues: { employeeId: string; name: string; text: string; tone: "bad" | "warn" }[] } {
  const index = dataIndexes(db);
  const stat: DayStat = { planned: 0, came: 0, late: 0, absent: 0, notYet: 0, noCheckout: 0 };
  const issues: { employeeId: string; name: string; text: string; tone: "bad" | "warn" }[] = [];
  for (const e of employees) {
    const onLeave = (index.approvedLeaveByEmployee.get(e.id) || []).some((l) => l.startDate <= date && l.endDate >= date);
    const plan = dayPlan(db, e, date);
    if (!plan.enabled || onLeave) continue;
    stat.planned += 1;
    const record = index.attendanceByKey.get(`${e.id}|${date}`);
    if (record?.checkIn) {
      stat.came += 1;
      if (record.lateMinutes) {
        stat.late += 1;
        issues.push({ employeeId: e.id, name: nameOf(e), text: `${record.lateMinutes} daq kechikdi`, tone: "warn" });
      }
      if (!record.checkOut && plan.end <= now && plan.end > plan.start) {
        stat.noCheckout += 1;
        issues.push({ employeeId: e.id, name: nameOf(e), text: "chiqish belgilanmagan", tone: "warn" });
      }
    } else if (plan.start <= now) {
      stat.absent += 1;
      issues.push({ employeeId: e.id, name: nameOf(e), text: "kelmagan", tone: "bad" });
    } else stat.notYet += 1;
  }
  return { stat, issues: issues.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "bad" ? -1 : 1)) };
}

/** Ertangi smena: kim rejada (dam/ta’til emas) va filialga kerakli soni bilan solishtirish. */
function tomorrowReadiness(db: Database, employees: Employee[], date: string, required?: number) {
  const index = dataIndexes(db);
  let planned = 0;
  let onLeave = 0;
  for (const e of employees) {
    const plan = dayPlan(db, e, date);
    if (!plan.enabled) continue;
    if ((index.approvedLeaveByEmployee.get(e.id) || []).some((l) => l.startDate <= date && l.endDate >= date)) {
      onLeave += 1;
      continue;
    }
    planned += 1;
  }
  return { date, planned, onLeave, required: required || undefined, shortage: required ? Math.max(0, required - planned) : 0 };
}

/* ======================================================= Action Center === */
type Action = { level: "red" | "orange" | "yellow" | "info"; text: string; count: number; link?: string; view?: string };

function buildActions(db: Database, tenant: string, role: Role, scope: Set<string> | null, inbox: InboxItem[], today = tashkentIsoDate()): Action[] {
  const out: Action[] = [];
  const employees = db.employees.filter((e) => e.companyId === tenant && e.status === "ACTIVE" && (!scope || scope.has(e.branchId)));
  const ids = new Set(employees.map((e) => e.id));
  const push = (a: Action) => a.count > 0 && out.push(a);
  const count = (kind: InboxItem["kind"]) => inbox.filter((i) => i.kind === kind).length;
  const urgent = inbox.filter((i) => i.urgent).length;
  push({ level: "red", text: "shoshilinch tasdiqlash kutmoqda", count: urgent, link: "/inbox", view: "inbox" });

  const hr = canAny(role, ["employees.edit", "employees.view"]) && role !== "IT_ADMIN";
  if (hr || role === "BRANCH_MANAGER") {
    const docs = db.documents.filter((d) => d.companyId === tenant && ids.has(d.employeeId) && d.expiresAt);
    push({ level: "red", text: "xodim hujjati muddati o‘tgan", count: docs.filter((d) => documentStatus(d) === "EXPIRED").length, link: "/employees", view: "requests" });
    push({ level: "orange", text: "xodim hujjati 7 kunda tugaydi", count: docs.filter((d) => d.expiresAt! >= today && d.expiresAt! <= addDays(today, 7)).length, link: "/employees", view: "requests" });
    push({ level: "orange", text: "belgilash so‘rovi kutmoqda", count: count("correction"), link: "/attendance-requests", view: "inbox" });
    // Ketma-ket kechikish: oxirgi 7 kunda 3+ marta.
    const from = addDays(today, -7);
    const lateCount = new Map<string, number>();
    for (const a of db.attendance) if (ids.has(a.employeeId) && a.date >= from && a.date <= today && a.lateMinutes > 0) lateCount.set(a.employeeId, (lateCount.get(a.employeeId) || 0) + 1);
    push({ level: "yellow", text: "xodim 7 kunda 3+ marta kechikkan", count: [...lateCount.values()].filter((n) => n >= 3).length, link: "/attendance", view: "today" });
  }
  if (can(role, "employees.edit")) {
    const newcomers = employees.filter((e) => e.startDate >= addDays(today, -30));
    push({ level: "orange", text: "yangi xodim onboarding’ni tugatmagan", count: newcomers.filter((e) => onboarding(db, e).done < onboarding(db, e).total).length, link: "/employees", view: "requests" });
    const probation = employees.filter((e) => e.countingStartDate && e.countingStartDate > today && e.countingStartDate <= addDays(today, 7));
    push({ level: "yellow", text: "xodimning sinov (mashq) muddati 7 kunda tugaydi", count: probation.length, link: "/employees" });
    const md = today.slice(5);
    push({ level: "info", text: "xodimning bugun tug‘ilgan kuni", count: employees.filter((e) => e.birthDate?.slice(5) === md).length, link: "/employees" });
    push({ level: "info", text: "xodimning bugun ish yilligi", count: employees.filter((e) => e.startDate.slice(5) === md && e.startDate < today).length, link: "/employees" });
    push({ level: "orange", text: "botdagi anketa tasdiq kutmoqda", count: count("registration"), link: "/registrations", view: "inbox" });
  }
  if (can(role, "payroll.edit")) {
    push({ level: "orange", text: "avans moliya tasdig‘ini kutmoqda", count: inbox.filter((i) => i.kind === "advance").length, link: "/payroll", view: "inbox" });
    const month = today.slice(0, 7);
    push({ level: "orange", text: "tasdiqlangan avans hali to‘lanmagan", count: db.advanceRequests.filter((a) => a.companyId === tenant && a.month === month && a.status === "APPROVED" && !a.paidAt).length, link: "/advances", view: "money" });
    push({ level: "yellow", text: "xodimning oyligi kiritilmagan", count: employees.filter((e) => !e.baseSalary).length, link: "/payroll", view: "money" });
    const prev = addDays(`${month}-01`, -1).slice(0, 7);
    if (today.slice(8) > "05" && !closedPeriod(db, tenant, prev)) push({ level: "red", text: `o‘tgan oy (${prev}) hali yopilmagan`, count: 1, link: "/payroll", view: "money" });
  }
  if (canAny(role, ["employees.edit", "payroll.edit"])) push({ level: "orange", text: "jarima taklifi tasdiq kutmoqda", count: count("fine"), link: "/fines", view: "inbox" });
  if (canAny(role, ["devices.manage", "employees.edit"])) {
    push({ level: "red", text: "telefon almashtirish so‘rovi (xodim kira olmayapti)", count: count("device"), link: "/settings?tab=apps", view: "devices" });
    const active = db.mobileDevices.filter((d) => d.companyId === tenant && d.status === "ACTIVE");
    const pushOk = new Set(db.mobilePushTokens.filter((t) => t.active).map((t) => t.deviceId));
    push({ level: "yellow", text: "telefonda push ishlamayapti", count: active.filter((d) => !pushOk.has(d.id)).length, link: "/settings?tab=apps", view: "devices" });
    const latest = active.map((d) => d.appVersion).filter(Boolean).sort(compareVersions).pop();
    if (latest) push({ level: "yellow", text: `telefonda eski ilova versiyasi (oxirgisi ${latest})`, count: active.filter((d) => d.appVersion && compareVersions(d.appVersion, latest) < 0).length, link: "/settings?tab=apps", view: "devices" });
  }
  if (can(role, "attendance.view")) {
    const { stat } = todayStats(db, employees, today, tashkentClock());
    push({ level: "orange", text: "xodim bugun kelmagan", count: stat.absent, link: "/attendance", view: "today" });
    // Filial bo‘yicha muammo: davomat 70% dan past.
    const weak = db.branches.filter((b) => b.companyId === tenant && (!scope || scope.has(b.id))).filter((b) => {
      const s = todayStats(db, employees.filter((e) => e.branchId === b.id), today, tashkentClock()).stat;
      return s.planned >= 3 && s.came + s.notYet < s.planned * 0.7;
    });
    push({ level: "red", text: "filialda davomat 70% dan past", count: weak.length, link: "/map", view: "map" });
    const tomorrow = addDays(today, 1);
    const short = db.branches
      .filter((b) => b.companyId === tenant && (!scope || scope.has(b.id)) && b.requiredStaff)
      .filter((b) => tomorrowReadiness(db, employees.filter((e) => e.branchId === b.id), tomorrow, b.requiredStaff).shortage > 0);
    push({ level: "orange", text: "filialda ertaga xodim yetishmaydi", count: short.length, link: "/branches", view: "today" });
  }
  const order = { red: 0, orange: 1, yellow: 2, info: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/* ======================================================== onboarding === */
export function onboarding(db: Database, e: Employee) {
  const docs = db.documents.filter((d) => d.employeeId === e.id);
  const steps = [
    { key: "profile", label: "Profil to‘ldirilgan (telefon, rasm, tug‘ilgan sana)", done: Boolean(e.phone && e.photoDataUrl && e.birthDate) },
    { key: "branch", label: "Filial va grafik biriktirilgan", done: Boolean(e.branchId && e.scheduleId) },
    { key: "telegram", label: "Telegram (Mini App) ulangan", done: Boolean(e.telegramConnected) },
    { key: "phone", label: "Telefon (Staffora ilovasi) bog‘langan", done: db.mobileDevices.some((d) => d.employeeId === e.id && d.status === "ACTIVE") },
    { key: "passport", label: "Pasport / ID karta yuklangan", done: docs.some((d) => d.type === "PASSPORT") },
    { key: "contract", label: "Mehnat shartnomasi yuklangan", done: docs.some((d) => d.type === "CONTRACT") },
    { key: "face", label: "Face ID sozlangan", done: Boolean(e.faceEnrolledAt) },
    { key: "first", label: "Birinchi keldi-ketdi qilingan", done: db.attendance.some((a) => a.employeeId === e.id && a.checkIn) },
  ];
  return { steps, done: steps.filter((s) => s.done).length, total: steps.length };
}

/* ========================================================== timeline === */
export function employeeTimeline(db: Database, e: Employee) {
  const events: { date: string; icon: string; text: string }[] = [];
  events.push({ date: e.startDate, icon: "hire", text: "Ishga qabul qilindi" });
  if (e.countingStartDate && e.countingStartDate > e.startDate) events.push({ date: e.countingStartDate, icon: "probation", text: "Sinov (mashq) muddati yakunlanadi" });
  const name = (list: { id: string; name: string }[], id?: unknown) => list.find((x) => x.id === id)?.name || "—";
  for (const log of db.auditLogs.filter((l) => l.entityId === e.id && l.companyId === e.companyId)) {
    const before = (log.before || {}) as Partial<Employee>;
    const after = (log.after || {}) as Partial<Employee>;
    if (before.branchId && after.branchId && before.branchId !== after.branchId) events.push({ date: log.createdAt, icon: "branch", text: `${name(db.branches, before.branchId)} → ${name(db.branches, after.branchId)}` });
    if (before.positionId && after.positionId && before.positionId !== after.positionId) events.push({ date: log.createdAt, icon: "position", text: `${name(db.positions, before.positionId)} → ${name(db.positions, after.positionId)}` });
    if (before.baseSalary !== undefined && after.baseSalary !== undefined && before.baseSalary !== after.baseSalary) events.push({ date: log.createdAt, icon: "salary", text: "Oylik o‘zgartirildi" });
    if (/Hujjat yuklandi/.test(log.action)) events.push({ date: log.createdAt, icon: "document", text: log.action });
    if (/Jarima qo‘llandi|Jarima taklifi tasdiqlandi/.test(log.action)) events.push({ date: log.createdAt, icon: "fine", text: log.action.split(":")[0] });
    if (/Mukofot/.test(log.action)) events.push({ date: log.createdAt, icon: "reward", text: log.action.split(" — ").pop() || log.action });
    if (/Mobil ilova faollashtirildi|telefon.*tasdiqlandi|Mobil qurilma bekor/i.test(log.action)) events.push({ date: log.createdAt, icon: "device", text: log.action });
  }
  for (const l of db.leaveRequests.filter((x) => x.employeeId === e.id && x.status === "APPROVED"))
    events.push({ date: l.startDate, icon: "leave", text: `${LEAVE[l.type] || l.type}: ${dmy(l.startDate)} – ${dmy(l.endDate)}` });
  if (e.dismissedAt) events.push({ date: e.dismissedAt, icon: "dismiss", text: `Ishdan bo‘shadi${e.dismissReason ? ` — ${e.dismissReason}` : ""}` });
  return events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80);
}

/* ============================================================== router === */
export function createWorkspaceRouter() {
  const router = Router();

  router.get(
    "/workspace/inbox",
    route(async (req, res) => {
      const db = await readDb();
      res.json(buildInbox(db, req.session!.companyId!, req.session!.role, scopeOf(db, req)));
    }),
  );

  router.get(
    "/workspace/actions",
    route(async (req, res) => {
      const db = await readDb();
      const tenant = req.session!.companyId!;
      const scope = scopeOf(db, req);
      const inbox = buildInbox(db, tenant, req.session!.role, scope);
      res.json({ actions: buildActions(db, tenant, req.session!.role, scope, inbox), inbox: { total: inbox.length, urgent: inbox.filter((i) => i.urgent).length } });
    }),
  );

  /** Direktor (va davomat ko‘ra oladiganlar): bugun, oy pullari (moliya huquqi bo‘lsa), filiallar. */
  router.get(
    "/workspace/overview",
    route(async (req, res) => {
      const db = await readDb();
      const tenant = req.session!.companyId!;
      const role = req.session!.role;
      if (!can(role, "attendance.view")) return res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
      const scope = scopeOf(db, req);
      const today = tashkentIsoDate();
      const now = tashkentClock();
      const employees = db.employees.filter((e) => e.companyId === tenant && e.status === "ACTIVE" && (!scope || scope.has(e.branchId)));
      const { stat } = todayStats(db, employees, today, now);
      const branches = db.branches
        .filter((b) => b.companyId === tenant && b.status !== "INACTIVE" && (!scope || scope.has(b.id)))
        .map((b) => {
          const s = todayStats(db, employees.filter((e) => e.branchId === b.id), today, now).stat;
          return { id: b.id, name: b.name, ...s, rate: s.planned ? Math.round(((s.came) / Math.max(1, s.planned - s.notYet)) * 100) : 100 };
        })
        .filter((b) => b.planned)
        .sort((a, b) => a.rate - b.rate);
      // So‘nggi 14 kun: kelmagan va kechikkanlar dinamikasi.
      const trend = Array.from({ length: 14 }, (_, i) => {
        const date = addDays(today, i - 13);
        const s = todayStats(db, employees, date, date === today ? now : "23:59").stat;
        return { date, came: s.came, late: s.late, absent: s.absent, planned: s.planned };
      });
      const money = canAny(role, ["payroll.view", "payroll.edit"]) ? financeSummary(db, tenant, today.slice(0, 7)) : null;
      res.json({
        today: { employees: employees.length, ...stat },
        money: money && { net: money.net, advance: money.advance, bonus: money.bonus, fine: money.fine, overtime: money.overtime, base: money.base, trend: money.trend.map((t) => ({ month: t.month, net: t.net })) },
        branches,
        trend,
      });
    }),
  );

  /** Filial rahbari: smena markazi — bugun (muammolar bilan) va ertangi tayyorlik. */
  router.get(
    "/workspace/branch-shift",
    route(async (req, res) => {
      const db = await readDb();
      const tenant = req.session!.companyId!;
      if (!can(req.session!.role, "attendance.view")) return res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
      const scope = scopeOf(db, req);
      const today = tashkentIsoDate();
      const now = tashkentClock();
      const branches = db.branches.filter((b) => b.companyId === tenant && b.status !== "INACTIVE" && (!scope || scope.has(b.id)));
      res.json(
        branches.map((b) => {
          const staff = db.employees.filter((e) => e.companyId === tenant && e.status === "ACTIVE" && e.branchId === b.id);
          const { stat, issues } = todayStats(db, staff, today, now);
          const plan = staff.map((e) => dayPlan(db, e, today)).filter((p) => p.enabled);
          return {
            id: b.id,
            name: b.name,
            today: stat,
            window: plan.length ? { start: plan.map((p) => p.start).sort()[0], end: plan.map((p) => p.end).sort().pop() } : null,
            issues: issues.slice(0, 15),
            tomorrow: tomorrowReadiness(db, staff, addDays(today, 1), b.requiredStaff),
          };
        }),
      );
    }),
  );

  /** IT: qurilmalar va xavfsizlik markazi (oyliksiz, faqat qurilma ma’lumotlari). */
  router.get(
    "/workspace/devices",
    route(async (req, res) => {
      const role = req.session!.role;
      if (!canAny(role, ["devices.manage", "employees.edit"])) return res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
      const db = await readDb();
      const tenant = req.session!.companyId!;
      const devices = db.mobileDevices.filter((d) => d.companyId === tenant);
      const active = devices.filter((d) => d.status === "ACTIVE");
      const pushOk = new Set(db.mobilePushTokens.filter((t) => t.active).map((t) => t.deviceId));
      const latest = active.map((d) => d.appVersion).filter(Boolean).sort(compareVersions).pop();
      const versions = [...active.reduce((m, d) => m.set(d.appVersion || "—", (m.get(d.appVersion || "—") || 0) + 1), new Map<string, number>())]
        .map(([version, count]) => ({ version, count, outdated: Boolean(latest && version !== "—" && compareVersions(version, latest) < 0) }))
        .sort((a, b) => compareVersions(b.version, a.version));
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const events = db.auditLogs
        .filter((l) => l.companyId === tenant && l.createdAt >= since && (l.entity === "mobile-device" || /faollashtir|qurilma|telefon|kod/i.test(l.action)))
        .slice(0, 60)
        .map((l) => ({
          at: l.createdAt,
          actor: l.actor,
          text: l.action,
          tone: /bekor|rad|noto‘g‘ri|xato|bloklandi|urinish/i.test(l.action) ? "bad" : /almashtir|yangi/i.test(l.action) ? "warn" : "info",
          employee: nameOf(db.employees.find((e) => e.id === l.entityId)),
        }));
      res.json({
        stats: {
          active: active.length,
          pushUnavailable: active.filter((d) => !pushOk.has(d.id)).length,
          revoked: devices.filter((d) => d.status === "REVOKED" && d.revokedAt && d.revokedAt >= since).length,
          replacement: db.deviceChangeRequests.filter((r) => r.companyId === tenant && r.status === "PENDING").length,
          ios: active.filter((d) => d.platform === "ios").length,
          android: active.filter((d) => d.platform === "android").length,
          inactive7d: active.filter((d) => !d.lastSeenAt || d.lastSeenAt < since).length,
        },
        latest,
        versions,
        events,
      });
    }),
  );

  /** HR: xodim tarixi va onboarding (filial rahbari — o‘z filiali). */
  router.get(
    "/workspace/employees/:id/lifecycle",
    route(async (req, res) => {
      if (!can(req.session!.role, "employees.view")) return res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
      const db = await readDb();
      const scope = scopeOf(db, req);
      const e = db.employees.find((x) => x.id === req.params.id && x.companyId === req.session!.companyId);
      if (!e || (scope && !scope.has(e.branchId))) return res.status(404).json({ message: "Xodim topilmadi." });
      res.json({ onboarding: onboarding(db, e), timeline: employeeTimeline(db, e) });
    }),
  );
  return router;
}
