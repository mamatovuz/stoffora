import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, dataIndexes, readDb, updateDb } from "../lib/store";
import { can } from "../lib/permissions";
import { tashkentClock, tashkentIsoDate } from "../lib/format";
import { dayPlan } from "../lib/schedule";
import type { AutomationRule, Database, Employee, RuleRun } from "../lib/types";
import type { AuthedRequest } from "./auth";

/*
 * Avtomatlashtirish qoidalari: «AGAR … BO‘LSA → SHUNI QIL».
 *   Hodisalar: kechikish, kelmaslik, ketishni belgilamaslik, ketma-ket kechikish, hujjat muddati,
 *   vazifa muddati o‘tishi, jiddiy hodisa hal qilinmagani.
 *   Amallar: xodimga xabar, filial rahbariga xabar, HR’ga (panel) xabar, vazifa yaratish,
 *   jarima TAKLIFI (HR / direktor tasdiqlaydi — avtomatik ushlanmaydi).
 * Har bir qoida bir hodisaga bir marta ishlaydi (kalit: qoida + obyekt + kun), natija jurnalda.
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const nameOf = (e?: Pick<Employee, "firstName" | "lastName">) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const TRIGGERS: Record<AutomationRule["trigger"], { label: string; hint: string }> = {
  LATE: { label: "Xodim kechikdi", hint: "Kamida N daqiqa kechikib kelganda" },
  ABSENT: { label: "Xodim kelmadi", hint: "Ish boshlanib N daqiqa o‘tdi, kelish belgilanmagan (ta’til emas)" },
  NO_CHECKOUT: { label: "Ketish belgilanmadi", hint: "Ish tugab N daqiqa o‘tdi, «ketdim» yo‘q" },
  LATE_STREAK: { label: "Ketma-ket kechikish", hint: "Oxirgi N kunda K marta kechikdi" },
  DOC_EXPIRING: { label: "Hujjat muddati tugayapti", hint: "Muddati N kun ichida tugaydi" },
  TASK_OVERDUE: { label: "Vazifa muddati o‘tdi", hint: "Bajarilmagan vazifa muddati o‘tganda" },
  INCIDENT_HIGH: { label: "Jiddiy hodisa hal qilinmadi", hint: "Jiddiy hodisa N daqiqadan beri ochiq" },
};
export const ACTIONS: Record<AutomationRule["actions"][number]["type"], string> = {
  NOTIFY_EMPLOYEE: "Xodimga xabar",
  NOTIFY_MANAGER: "Filial rahbariga xabar",
  NOTIFY_HR: "HR / direktorga (panel) xabar",
  CREATE_TASK: "Xodimga vazifa berish",
  PROPOSE_FINE: "Jarima taklifi (HR tasdiqlaydi)",
};

/** Tayyor namunalar — bir bosishda yoqiladi. */
export const RULE_TEMPLATES: Omit<AutomationRule, "id" | "companyId" | "createdBy" | "createdAt" | "updatedAt">[] = [
  { name: "15 daqiqadan ko‘p kechiksa — rahbarga xabar", active: true, trigger: "LATE", conditions: { minutes: 15, branchIds: [] }, actions: [{ type: "NOTIFY_MANAGER" }] },
  { name: "Kelmasa (30 daqiqa) — xodim va rahbarga", active: true, trigger: "ABSENT", conditions: { minutes: 30, branchIds: [] }, actions: [{ type: "NOTIFY_EMPLOYEE", message: "{name}, bugun ish {start} da boshlangan — kelishingiz belgilanmagan. Kechiksangiz Mini App’da sababini yozing." }, { type: "NOTIFY_MANAGER" }] },
  { name: "Ketishni unutsa (30 daqiqa) — eslatma", active: true, trigger: "NO_CHECKOUT", conditions: { minutes: 30, branchIds: [] }, actions: [{ type: "NOTIFY_EMPLOYEE", message: "{name}, ish {end} da tugagan — «Ishdan ketdim»ni belgilashni unutmang." }] },
  { name: "7 kunda 3 marta kechiksa — HR’ga va suhbat vazifasi", active: false, trigger: "LATE_STREAK", conditions: { days: 7, count: 3, branchIds: [] }, actions: [{ type: "NOTIFY_HR" }, { type: "CREATE_TASK", message: "Kechikishlar bo‘yicha rahbar bilan suhbat" }] },
  { name: "Hujjat muddati 14 kunda tugaydi — xodimga", active: true, trigger: "DOC_EXPIRING", conditions: { days: 14, branchIds: [] }, actions: [{ type: "NOTIFY_EMPLOYEE", message: "{name}, «{doc}» muddati {date} da tugaydi — yangisini yuklang." }] },
];

const TEMPLATE_DEFAULT: Record<AutomationRule["trigger"], string> = {
  LATE: "{name} bugun {minutes} daqiqa kechikib keldi ({time}, {branch}).",
  ABSENT: "{name} bugun ishga kelmadi (ish {start} da boshlangan, {branch}).",
  NO_CHECKOUT: "{name} ish tugagach ({end}) ketishni belgilamadi ({branch}).",
  LATE_STREAK: "{name} oxirgi {days} kunda {count} marta kechikdi ({branch}).",
  DOC_EXPIRING: "{name}: «{doc}» muddati {date} da tugaydi.",
  TASK_OVERDUE: "Vazifa muddati o‘tdi: «{task}» ({name}).",
  INCIDENT_HIGH: "Jiddiy hodisa hal qilinmagan: «{incident}» ({branch}).",
};
const fill = (text: string, vars: Record<string, string | number | undefined>) => text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? "" : String(vars[k])));

type Hit = { key: string; employee?: Employee; branchId?: string; vars: Record<string, string | number | undefined>; entity: string };

/** Qoida shartiga mos «hodisalar» (hali bajarilmaganlarini runRules filtrlaydi). */
export function ruleHits(db: Database, rule: AutomationRule, today = tashkentIsoDate(), clock = tashkentClock()): Hit[] {
  const c = rule.conditions;
  const branchOk = (id?: string) => !c.branchIds?.length || (id ? c.branchIds.includes(id) : false);
  const staff = db.employees.filter((e) => e.companyId === rule.companyId && e.status === "ACTIVE" && branchOk(e.branchId));
  const branchName = (id?: string) => db.branches.find((b) => b.id === id)?.name || "";
  const index = dataIndexes(db);
  const onLeave = (e: Employee, date: string) => ((index.approvedLeaveByEmployee.get(e.id) || []) as Database["leaveRequests"]).some((l) => l.startDate <= date && l.endDate >= date);
  const hits: Hit[] = [];
  const now = minutesOf(clock);
  const base = (e: Employee) => ({ name: nameOf(e), branch: branchName(e.branchId) });
  switch (rule.trigger) {
    case "LATE":
      for (const e of staff) {
        const a = index.attendanceByKey.get(`${e.id}|${today}`);
        if (a?.checkIn && a.lateMinutes >= (c.minutes || 1)) hits.push({ key: `${e.id}|${today}`, employee: e, branchId: e.branchId, entity: a.id, vars: { ...base(e), minutes: a.lateMinutes, time: a.checkIn } });
      }
      break;
    case "ABSENT":
      for (const e of staff) {
        const plan = dayPlan(db, e, today);
        if (!plan.enabled || onLeave(e, today) || e.startDate > today) continue;
        if (now < minutesOf(plan.start) + (c.minutes || 30)) continue;
        if (index.attendanceByKey.get(`${e.id}|${today}`)?.checkIn) continue;
        hits.push({ key: `${e.id}|${today}`, employee: e, branchId: e.branchId, entity: e.id, vars: { ...base(e), start: plan.start } });
      }
      break;
    case "NO_CHECKOUT":
      for (const e of staff) {
        const a = index.attendanceByKey.get(`${e.id}|${today}`);
        if (!a?.checkIn || a.checkOut) continue;
        const end = minutesOf(a.scheduledEnd);
        // Tungi smena (tugash ertasi kuni) — bugungi soatga solishtirilmaydi.
        if (end <= minutesOf(a.scheduledStart)) continue;
        if (now < end + (c.minutes || 30)) continue;
        hits.push({ key: `${e.id}|${today}`, employee: e, branchId: e.branchId, entity: a.id, vars: { ...base(e), end: a.scheduledEnd } });
      }
      break;
    case "LATE_STREAK": {
      const from = addDays(today, -((c.days || 7) - 1));
      for (const e of staff) {
        const lates = (index.attendanceByEmployee.get(e.id) || []).filter((a) => a.date >= from && a.date <= today && a.lateMinutes > 0).length;
        // Bir davr uchun bir marta (davr boshidan kalit).
        if (lates >= (c.count || 3)) hits.push({ key: `${e.id}|${from}`, employee: e, branchId: e.branchId, entity: e.id, vars: { ...base(e), days: c.days || 7, count: lates } });
      }
      break;
    }
    case "DOC_EXPIRING": {
      const until = addDays(today, c.days || 14);
      for (const d of db.documents) {
        const e = staff.find((x) => x.id === d.employeeId);
        if (!e || !d.expiresAt || d.expiresAt < today || d.expiresAt > until) continue;
        hits.push({ key: `${d.id}|${d.expiresAt}`, employee: e, branchId: e.branchId, entity: d.id, vars: { ...base(e), doc: d.title, date: d.expiresAt.split("-").reverse().join(".") } });
      }
      break;
    }
    case "TASK_OVERDUE":
      for (const t of db.tasks) {
        if (t.companyId !== rule.companyId || !t.dueDate || t.dueDate >= today || (t.status !== "TODO" && t.status !== "IN_PROGRESS") || !branchOk(t.branchId)) continue;
        const e = db.employees.find((x) => x.id === t.assigneeIds[0]);
        hits.push({ key: `${t.id}|${t.dueDate}`, employee: e, branchId: t.branchId || e?.branchId, entity: t.id, vars: { name: t.assigneeIds.map((id) => nameOf(db.employees.find((x) => x.id === id))).join(", "), task: t.title, branch: branchName(t.branchId) } });
      }
      break;
    case "INCIDENT_HIGH":
      for (const i of db.incidents) {
        if (i.companyId !== rule.companyId || i.severity !== "HIGH" || i.status === "RESOLVED" || !branchOk(i.branchId)) continue;
        if (Date.now() - Date.parse(i.createdAt) < (c.minutes || 60) * 60_000) continue;
        hits.push({ key: i.id, branchId: i.branchId, entity: i.id, vars: { incident: i.title, branch: branchName(i.branchId), name: i.reporterName } });
      }
      break;
  }
  return hits;
}

/** Bitta qoidani bajaradi (updateDb ichida). Qaytaradi: yangi bajarilganlar soni. */
function applyRule(db: Database, rule: AutomationRule, hits: Hit[], sent: Set<string>) {
  const now = new Date().toISOString();
  const month = tashkentIsoDate().slice(0, 7);
  let done = 0;
  for (const hit of hits) {
    const key = `rule:${rule.id}:${hit.key}`;
    if (sent.has(key)) continue;
    sent.add(key);
    db.sentGreetings.push({ key, at: now });
    const summary: string[] = [];
    for (const action of rule.actions) {
      const text = fill(action.message || TEMPLATE_DEFAULT[rule.trigger], hit.vars);
      if (action.type === "NOTIFY_EMPLOYEE" && hit.employee) {
        db.notifications.unshift({ id: randomUUID(), companyId: rule.companyId, employeeId: hit.employee.id, title: rule.name, body: text, type: "ATTENDANCE", read: false, createdAt: now });
        summary.push("xodimga xabar");
      } else if (action.type === "NOTIFY_MANAGER") {
        const branch = db.branches.find((b) => b.id === hit.branchId);
        const managers = (branch?.managerEmployeeIds || []).filter((id) => id !== hit.employee?.id);
        for (const id of managers) db.notifications.unshift({ id: randomUUID(), companyId: rule.companyId, employeeId: id, title: rule.name, body: text, type: "MANAGER", read: false, createdAt: now, go: "manager" });
        // Rahbar biriktirilmagan bo‘lsa — panelga.
        if (!managers.length) db.notifications.unshift({ id: randomUUID(), companyId: rule.companyId, title: rule.name, body: text, type: "ATTENDANCE", read: false, createdAt: now });
        summary.push(managers.length ? `rahbarga (${managers.length})` : "panelga (rahbar yo‘q)");
      } else if (action.type === "NOTIFY_HR") {
        db.notifications.unshift({ id: randomUUID(), companyId: rule.companyId, title: `⚙️ ${rule.name}`, body: text, type: "ATTENDANCE", read: false, createdAt: now });
        summary.push("HR’ga xabar");
      } else if (action.type === "CREATE_TASK" && hit.employee) {
        db.tasks.unshift({
          id: randomUUID(),
          companyId: rule.companyId,
          title: fill(action.message || rule.name, hit.vars).slice(0, 140),
          description: text,
          assigneeIds: [hit.employee.id],
          branchId: hit.employee.branchId,
          dueDate: addDays(tashkentIsoDate(), 3),
          priority: "NORMAL",
          status: "TODO",
          createdBy: `Qoida: ${rule.name}`,
          createdAt: now,
          updatedAt: now,
          photoIds: [],
          comments: [],
        });
        db.notifications.unshift({ id: randomUUID(), companyId: rule.companyId, employeeId: hit.employee.id, title: "Yangi vazifa", body: fill(action.message || rule.name, hit.vars), type: "OPS", read: false, createdAt: now, go: "tasks" });
        summary.push("vazifa");
      } else if (action.type === "PROPOSE_FINE" && hit.employee && (action.amount || 0) > 0) {
        db.payrollAdjustments.push({
          id: randomUUID(),
          companyId: rule.companyId,
          employeeId: hit.employee.id,
          month,
          type: "FINE",
          amount: action.amount!,
          note: `${rule.name}: ${text}`.slice(0, 300),
          createdBy: `Qoida: ${rule.name}`,
          createdAt: now,
          status: "PENDING",
          proposedBy: `Qoida: ${rule.name}`,
        });
        db.notifications.unshift({ id: randomUUID(), companyId: rule.companyId, title: "Jarima taklifi — tasdiq kutilmoqda", body: `${nameOf(hit.employee)}: ${action.amount!.toLocaleString("ru-RU")} so‘m (${rule.name})`, type: "FINE", read: false, createdAt: now, go: "/fines" });
        summary.push("jarima taklifi");
      }
    }
    const run: RuleRun = { id: randomUUID(), companyId: rule.companyId, ruleId: rule.id, at: now, entity: hit.entity, employeeId: hit.employee?.id, summary: `${hit.employee ? nameOf(hit.employee) : hit.vars.incident || hit.vars.task || ""} → ${summary.join(", ") || "—"}` };
    db.ruleRuns.unshift(run);
    done += 1;
  }
  if (done) {
    rule.lastRunAt = now;
    rule.runs = (rule.runs || 0) + done;
  }
  db.ruleRuns = db.ruleRuns.slice(0, 5000);
  return done;
}

/** Fon ishi (har 10 daqiqa): barcha faol qoidalar. */
export async function runRules(today = tashkentIsoDate(), clock = tashkentClock()) {
  const db = await readDb();
  const active = db.automationRules.filter((r) => r.active);
  if (!active.length) return 0;
  const sent = new Set(db.sentGreetings.map((g) => g.key));
  const plans = active.map((rule) => ({ id: rule.id, hits: ruleHits(db, rule, today, clock).filter((h) => !sent.has(`rule:${rule.id}:${h.key}`)) })).filter((p) => p.hits.length);
  if (!plans.length) return 0;
  return updateDb((next) => {
    const fresh = new Set(next.sentGreetings.map((g) => g.key));
    let total = 0;
    for (const p of plans) {
      const rule = next.automationRules.find((r) => r.id === p.id && r.active);
      if (rule) total += applyRule(next, rule, p.hits, fresh);
    }
    return total;
  });
}

export function createRulesRouter() {
  const router = Router();
  const permit = (req: Request, res: Response, next: NextFunction) =>
    can((req as AuthedRequest).session!.role, "employees.edit") ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  const tenant = (req: Request) => (req as AuthedRequest).session!.companyId!;
  const ruleInput = z.object({
    name: z.string().trim().min(3).max(120),
    active: z.boolean().default(true),
    trigger: z.enum(Object.keys(TRIGGERS) as [AutomationRule["trigger"], ...AutomationRule["trigger"][]]),
    conditions: z.object({ minutes: z.number().int().min(1).max(1440).optional(), count: z.number().int().min(1).max(31).optional(), days: z.number().int().min(1).max(90).optional(), branchIds: z.array(z.string()).max(500).default([]) }).default({ branchIds: [] }),
    actions: z
      .array(z.object({ type: z.enum(Object.keys(ACTIONS) as [AutomationRule["actions"][number]["type"], ...AutomationRule["actions"][number]["type"][]]), message: z.string().trim().max(500).optional(), amount: z.number().int().min(0).max(100_000_000).optional() }))
      .min(1)
      .max(6),
  });

  router.get(
    "/rules",
    permit,
    route(async (req, res) => {
      const db = await readDb();
      res.json({
        rules: db.automationRules.filter((r) => r.companyId === tenant(req)),
        triggers: TRIGGERS,
        actions: ACTIONS,
        templates: RULE_TEMPLATES,
        defaults: TEMPLATE_DEFAULT,
      });
    }),
  );
  router.get(
    "/rules/runs",
    permit,
    route(async (req, res) => {
      const db = await readDb();
      res.json(db.ruleRuns.filter((r) => r.companyId === tenant(req) && (!req.query.ruleId || r.ruleId === req.query.ruleId)).slice(0, 200).map((r) => ({ ...r, rule: db.automationRules.find((x) => x.id === r.ruleId)?.name || "—" })));
    }),
  );
  /** Sinov: hozir qancha xodimga ishlardi (hech narsa yuborilmaydi). */
  router.post(
    "/rules/preview",
    permit,
    route(async (req, res) => {
      const input = ruleInput.parse(req.body);
      const db = await readDb();
      const hits = ruleHits(db, { ...input, id: "preview", companyId: tenant(req), createdBy: "", createdAt: "", updatedAt: "" });
      res.json({ count: hits.length, sample: hits.slice(0, 10).map((h) => fill(TEMPLATE_DEFAULT[input.trigger], h.vars)) });
    }),
  );
  router.post(
    "/rules",
    permit,
    route(async (req, res) => {
      const input = ruleInput.parse(req.body);
      const row = await updateDb((db) => {
        const now = new Date().toISOString();
        const value: AutomationRule = { id: randomUUID(), companyId: tenant(req), ...input, createdBy: (req as AuthedRequest).session!.name, createdAt: now, updatedAt: now };
        db.automationRules.push(value);
        db.auditLogs.unshift(audit(value.companyId, value.createdBy, `Avtomatlashtirish qoidasi yaratildi: «${value.name}»`, "company", value.companyId));
        return value;
      });
      res.status(201).json(row);
    }),
  );
  router.put(
    "/rules/:id",
    permit,
    route(async (req, res) => {
      const input = ruleInput.parse(req.body);
      const row = await updateDb((db) => {
        const r = db.automationRules.find((x) => x.id === req.params.id && x.companyId === tenant(req));
        if (!r) throw httpError("Qoida topilmadi.", 404);
        Object.assign(r, input, { updatedAt: new Date().toISOString() });
        db.auditLogs.unshift(audit(r.companyId, (req as AuthedRequest).session!.name, `Qoida o‘zgartirildi: «${r.name}» (${r.active ? "faol" : "o‘chiq"})`, "company", r.companyId));
        return r;
      });
      res.json(row);
    }),
  );
  router.delete(
    "/rules/:id",
    permit,
    route(async (req, res) => {
      await updateDb((db) => {
        db.automationRules = db.automationRules.filter((x) => !(x.id === req.params.id && x.companyId === tenant(req)));
      });
      res.json({ ok: true });
    }),
  );
  return router;
}
