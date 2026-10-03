import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, documentFiles, readDb, updateDb } from "../lib/store";
import { can, canAny } from "../lib/permissions";
import { tashkentClock, tashkentIsoDate } from "../lib/format";
import type { ChecklistRun, ChecklistTemplate, Database, Employee, Incident, OpsTask, Role } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";
import { notifyEmployee } from "./integrations/hooks";

/*
 * Operatsiya: vazifalar, takrorlanuvchi checklistlar va hodisalar (incident).
 *   • Vazifa: HR / filial rahbari xodim(lar)ga beradi → xodim «Boshladim» / «Bajarildi» (kerak bo‘lsa rasm bilan).
 *   • Checklist: filial uchun kundalik ro‘yxat (ochilish, kassa, tozalik…) — xodimlar band-band belgilaydi,
 *     belgilangan vaqtgacha tugamasa rahbarga xabar.
 *   • Hodisa: xodim muammoni (rasm bilan) yuboradi → Ochiq → Jarayonda → Hal qilindi; har o‘tish tarixda.
 * Filial rahbari faqat o‘z filiallarini, IT faqat IT/jihoz hodisalarini ko‘radi.
 * Rasmlar hujjatlar ombori (document_files) da saqlanadi.
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const panel = (req: Request) => (req as AuthedRequest).session!;
const worker = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
const nameOf = (e?: Pick<Employee, "firstName" | "lastName">) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
const dmy = (iso: string) => iso.split("-").reverse().join(".");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana noto‘g‘ri.");
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Vaqt HH:MM bo‘lsin.");
const photoSchema = z.string().min(30).max(2_000_000).optional();

export const INCIDENT_CATEGORIES: Record<Incident["category"], string> = {
  EQUIPMENT: "Jihoz / texnika",
  IT: "IT (kompyuter, internet, kassa dasturi)",
  SAFETY: "Xavfsizlik / sog‘liq",
  CUSTOMER: "Mijoz bilan muammo",
  CLEANING: "Tozalik / sanitariya",
  OTHER: "Boshqa",
};
const IT_CATEGORIES: Incident["category"][] = ["IT", "EQUIPMENT"];
export const INCIDENT_STATUS: Record<Incident["status"], string> = { OPEN: "Ochiq", IN_PROGRESS: "Jarayonda", RESOLVED: "Hal qilindi" };
export const TASK_STATUS: Record<OpsTask["status"], string> = { TODO: "Yangi", IN_PROGRESS: "Jarayonda", DONE: "Bajarildi", CANCELLED: "Bekor qilindi" };

/* --------------------------------------------------------------- rasm --- */
const PHOTO = /^data:(image\/(jpeg|png|webp));base64,(.+)$/s;
async function savePhoto(companyId: string, dataUrl: string) {
  const match = PHOTO.exec(dataUrl);
  if (!match) throw httpError("Faqat JPG, PNG yoki WEBP rasm yuklash mumkin.", 400);
  const buffer = Buffer.from(match[3], "base64");
  if (buffer.length > 1_400_000) throw httpError("Rasm juda katta — 1,4 MB gacha bo‘lsin.", 413);
  const id = randomUUID();
  await (await documentFiles()).putFile(id, companyId, match[1], buffer, new Date().toISOString());
  return id;
}
/** Operatsiya rasmlari — fayllar tozalashda o‘chib ketmasin. */
export function opsPhotoIds(db: Database) {
  return [
    ...db.tasks.flatMap((t) => [...t.photoIds, ...t.comments.map((c) => c.photoId)]),
    ...db.checklistRuns.flatMap((r) => r.items.map((i) => i.photoId)),
    ...db.incidents.flatMap((i) => i.photoIds),
  ].filter((id): id is string => Boolean(id));
}

/* -------------------------------------------------------------- doira --- */
type Scope = { branches: Set<string> | null; itOnly: boolean };
function scopeOf(db: Database, role: Role, userId: string): Scope {
  if (role === "BRANCH_MANAGER") return { branches: new Set(db.users.find((u) => u.id === userId)?.branchIds || []), itOnly: false };
  return { branches: null, itOnly: !can(role, "ops.manage") && can(role, "incidents.it") };
}
const inBranch = (scope: Scope, branchId?: string) => !scope.branches || (Boolean(branchId) && scope.branches.has(branchId!));
function taskVisible(db: Database, scope: Scope, t: OpsTask) {
  if (!scope.branches) return true;
  if (t.branchId && scope.branches.has(t.branchId)) return true;
  return t.assigneeIds.some((id) => scope.branches!.has(db.employees.find((e) => e.id === id)?.branchId || ""));
}
const incidentVisible = (scope: Scope, i: Incident) => inBranch(scope, i.branchId) && (!scope.itOnly || IT_CATEGORIES.includes(i.category));

/** Shu kun uchun filialga tegishli checklistlar (hafta kuni va filial bo‘yicha). */
export function checklistsFor(db: Database, companyId: string, branchId: string, date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return db.checklistTemplates.filter((t) => t.companyId === companyId && t.active && (!t.branchIds.length || t.branchIds.includes(branchId)) && t.weekdays.includes(weekday));
}
function runOf(db: Database, t: ChecklistTemplate, branchId: string, date: string) {
  return db.checklistRuns.find((r) => r.templateId === t.id && r.branchId === branchId && r.date === date);
}
function describeRun(db: Database, t: ChecklistTemplate, branchId: string, date: string) {
  const run = runOf(db, t, branchId, date);
  const items = t.items.map((item) => {
    const mark = run?.items.find((m) => m.itemId === item.id);
    return { ...item, done: Boolean(mark?.done), by: mark?.by, at: mark?.at, photoId: mark?.photoId, note: mark?.note };
  });
  const done = items.filter((i) => i.done).length;
  const overdue = Boolean(t.dueTime && date === tashkentIsoDate() && tashkentClock() > t.dueTime && done < items.length) || (date < tashkentIsoDate() && done < items.length);
  return { templateId: t.id, title: t.title, dueTime: t.dueTime, branchId, branch: db.branches.find((b) => b.id === branchId)?.name || "", date, items, done, total: items.length, completedAt: run?.completedAt, overdue };
}

function describeTask(db: Database, t: OpsTask, today = tashkentIsoDate()) {
  return {
    ...t,
    assignees: t.assigneeIds.map((id) => ({ id, name: nameOf(db.employees.find((e) => e.id === id)) })),
    branch: t.branchId ? db.branches.find((b) => b.id === t.branchId)?.name : undefined,
    overdue: Boolean(t.dueDate && t.dueDate < today && (t.status === "TODO" || t.status === "IN_PROGRESS")),
  };
}
function describeIncident(db: Database, i: Incident) {
  return { ...i, branch: db.branches.find((b) => b.id === i.branchId)?.name || "", categoryLabel: INCIDENT_CATEGORIES[i.category] };
}

function panelNote(db: Database, companyId: string, title: string, body: string, go: string) {
  db.notifications.unshift({ id: randomUUID(), companyId, title, body, type: "OPS", read: false, createdAt: new Date().toISOString(), go });
}
function employeeNote(db: Database, e: Employee, title: string, body: string, go: string) {
  db.notifications.unshift({ id: randomUUID(), companyId: e.companyId, employeeId: e.id, title, body, type: "OPS", read: false, createdAt: new Date().toISOString(), go });
}
async function pushTelegram(employeeIds: string[], text: string, title: string, go: string) {
  const db = await readDb();
  for (const id of employeeIds) {
    const e = db.employees.find((x) => x.id === id && x.status === "ACTIVE");
    if (e) await notifyEmployee(db, e, "attendance", text, { title, openButton: true, go }).catch(() => undefined);
  }
}

/* ===================================================== panel (sayt) === */
export function createOpsRouter() {
  const router = Router();
  const permit = (permissions: string[]) => (req: Request, res: Response, next: NextFunction) =>
    canAny(panel(req).role, permissions) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  const manage = permit(["ops.manage"]);
  const tenantOf = (req: Request) => {
    const id = panel(req).companyId;
    if (!id) throw httpError("Kompaniya tanlanmagan.", 400);
    return id;
  };

  /* ---------------------------------------------------- vazifalar --- */
  router.get(
    "/tasks",
    manage,
    route(async (req, res) => {
      const db = await readDb();
      const tenant = tenantOf(req);
      const scope = scopeOf(db, panel(req).role, panel(req).userId);
      const rows = db.tasks.filter((t) => t.companyId === tenant && taskVisible(db, scope, t)).map((t) => describeTask(db, t));
      const employees = db.employees
        .filter((e) => e.companyId === tenant && e.status === "ACTIVE" && inBranch(scope, e.branchId))
        .map((e) => ({ id: e.id, name: nameOf(e), branchId: e.branchId }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ tasks: rows, employees });
    }),
  );
  const taskInput = z.object({
    title: z.string().trim().min(2).max(140),
    description: z.string().trim().max(1000).optional(),
    assigneeIds: z.array(z.string()).max(200).default([]),
    /** Filialning barcha xodimlariga (assigneeIds bo‘sh bo‘lsa). */
    branchId: z.string().optional(),
    dueDate: z.union([dateSchema, z.literal("")]).optional(),
    priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
    requirePhoto: z.boolean().default(false),
  });
  router.post(
    "/tasks",
    manage,
    route(async (req, res) => {
      const input = taskInput.parse(req.body);
      const tenant = tenantOf(req);
      const task = await updateDb((db) => {
        const scope = scopeOf(db, panel(req).role, panel(req).userId);
        if (input.branchId && !inBranch(scope, input.branchId)) throw httpError("Filial topilmadi.", 404);
        let ids = [...new Set(input.assigneeIds)];
        if (!ids.length && input.branchId) ids = db.employees.filter((e) => e.companyId === tenant && e.status === "ACTIVE" && e.branchId === input.branchId).map((e) => e.id);
        const people = db.employees.filter((e) => ids.includes(e.id) && e.companyId === tenant && e.status === "ACTIVE" && inBranch(scope, e.branchId));
        if (!people.length) throw httpError("Kamida bitta xodimni tanlang.", 422);
        const now = new Date().toISOString();
        const row: OpsTask = {
          id: randomUUID(),
          companyId: tenant,
          title: input.title,
          description: input.description || undefined,
          assigneeIds: people.map((e) => e.id),
          branchId: input.branchId || (new Set(people.map((e) => e.branchId)).size === 1 ? people[0].branchId : undefined),
          dueDate: input.dueDate || undefined,
          priority: input.priority,
          requirePhoto: input.requirePhoto,
          status: "TODO",
          createdBy: panel(req).name,
          createdById: panel(req).userId,
          createdAt: now,
          updatedAt: now,
          photoIds: [],
          comments: [],
        };
        db.tasks.unshift(row);
        for (const e of people) employeeNote(db, e, "Yangi vazifa", `${row.title}${row.dueDate ? ` — muddat ${dmy(row.dueDate)}` : ""}`, `tasks_${row.id}`);
        db.auditLogs.unshift(audit(tenant, panel(req).name, `Vazifa berildi: «${row.title}» — ${people.length} xodim`, "company", tenant));
        return row;
      });
      void pushTelegram(task.assigneeIds, `📝 Yangi vazifa: <b>${task.title}</b>${task.dueDate ? `\nMuddat: ${dmy(task.dueDate)}` : ""}`, "Yangi vazifa", `tasks_${task.id}`);
      const db = await readDb();
      res.status(201).json(describeTask(db, task));
    }),
  );
  router.patch(
    "/tasks/:id",
    manage,
    route(async (req, res) => {
      const input = z.object({ status: z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(), dueDate: z.union([dateSchema, z.literal("")]).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH"]).optional() }).parse(req.body);
      const row = await updateDb((db) => {
        const t = db.tasks.find((x) => x.id === req.params.id && x.companyId === tenantOf(req));
        if (!t || !taskVisible(db, scopeOf(db, panel(req).role, panel(req).userId), t)) throw httpError("Vazifa topilmadi.", 404);
        if (input.status && input.status !== t.status) {
          t.status = input.status;
          if (input.status === "DONE") Object.assign(t, { doneAt: new Date().toISOString(), doneBy: panel(req).name });
          if (input.status === "TODO" || input.status === "IN_PROGRESS") Object.assign(t, { doneAt: undefined, doneBy: undefined });
          t.comments.push({ by: panel(req).name, text: `Holat: ${TASK_STATUS[input.status]}`, at: new Date().toISOString() });
        }
        if (input.dueDate !== undefined) t.dueDate = input.dueDate || undefined;
        if (input.priority) t.priority = input.priority;
        t.updatedAt = new Date().toISOString();
        db.auditLogs.unshift(audit(t.companyId, panel(req).name, `Vazifa «${t.title}»: ${TASK_STATUS[t.status]}`, "company", t.companyId));
        return describeTask(db, t);
      });
      res.json(row);
    }),
  );
  router.post(
    "/tasks/:id/comment",
    manage,
    route(async (req, res) => {
      const { text } = z.object({ text: z.string().trim().min(1).max(1000) }).parse(req.body);
      const row = await updateDb((db) => {
        const t = db.tasks.find((x) => x.id === req.params.id && x.companyId === tenantOf(req));
        if (!t || !taskVisible(db, scopeOf(db, panel(req).role, panel(req).userId), t)) throw httpError("Vazifa topilmadi.", 404);
        t.comments.push({ by: panel(req).name, text, at: new Date().toISOString() });
        t.updatedAt = new Date().toISOString();
        for (const id of t.assigneeIds) {
          const e = db.employees.find((x) => x.id === id && x.status === "ACTIVE");
          if (e) employeeNote(db, e, `Vazifaga izoh: ${t.title}`, text.slice(0, 200), `tasks_${t.id}`);
        }
        return describeTask(db, t);
      });
      res.json(row);
    }),
  );
  router.delete(
    "/tasks/:id",
    manage,
    route(async (req, res) => {
      await updateDb((db) => {
        const t = db.tasks.find((x) => x.id === req.params.id && x.companyId === tenantOf(req));
        if (!t || !taskVisible(db, scopeOf(db, panel(req).role, panel(req).userId), t)) throw httpError("Vazifa topilmadi.", 404);
        db.tasks = db.tasks.filter((x) => x.id !== t.id);
        db.auditLogs.unshift(audit(t.companyId, panel(req).name, `Vazifa o‘chirildi: «${t.title}»`, "company", t.companyId));
      });
      res.json({ ok: true });
    }),
  );

  /* -------------------------------------------------- checklistlar --- */
  router.get(
    "/checklists",
    manage,
    route(async (req, res) => {
      const db = await readDb();
      const tenant = tenantOf(req);
      const scope = scopeOf(db, panel(req).role, panel(req).userId);
      const date = dateSchema.parse(String(req.query.date || tashkentIsoDate()));
      const branches = db.branches.filter((b) => b.companyId === tenant && b.status === "ACTIVE" && inBranch(scope, b.id));
      const templates = db.checklistTemplates.filter((t) => t.companyId === tenant && (!scope.branches || !t.branchIds.length || t.branchIds.some((id) => scope.branches!.has(id))));
      const runs = branches.flatMap((b) => checklistsFor(db, tenant, b.id, date).map((t) => describeRun(db, t, b.id, date)));
      res.json({ date, templates, runs, branches: branches.map((b) => ({ id: b.id, name: b.name })) });
    }),
  );
  const templateInput = z.object({
    title: z.string().trim().min(2).max(100),
    branchIds: z.array(z.string()).max(200).default([]),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).default([0, 1, 2, 3, 4, 5, 6]),
    dueTime: z.union([timeSchema, z.literal("")]).optional(),
    items: z.array(z.object({ id: z.string().optional(), text: z.string().trim().min(1).max(200), requirePhoto: z.boolean().default(false) })).min(1).max(50),
    active: z.boolean().default(true),
  });
  const saveTemplate = (req: Request, existing?: ChecklistTemplate) => (db: Database) => {
    const input = templateInput.parse(req.body);
    const tenant = tenantOf(req);
    const scope = scopeOf(db, panel(req).role, panel(req).userId);
    // Filial rahbari faqat o‘z filiallari uchun (bo‘sh — uning barcha filiallari).
    const branchIds = scope.branches ? (input.branchIds.length ? input.branchIds.filter((id) => scope.branches!.has(id)) : [...scope.branches]) : input.branchIds;
    if (scope.branches && !branchIds.length) throw httpError("Filialni tanlang.", 422);
    const value: ChecklistTemplate = {
      id: existing?.id || randomUUID(),
      companyId: tenant,
      title: input.title,
      branchIds,
      weekdays: [...new Set(input.weekdays)].sort(),
      dueTime: input.dueTime || undefined,
      items: input.items.map((i) => ({ id: i.id && existing?.items.some((x) => x.id === i.id) ? i.id : randomUUID(), text: i.text, requirePhoto: i.requirePhoto })),
      active: input.active,
      createdBy: existing?.createdBy || panel(req).name,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    if (existing) Object.assign(existing, value);
    else db.checklistTemplates.push(value);
    db.auditLogs.unshift(audit(tenant, panel(req).name, `Checklist ${existing ? "o‘zgartirildi" : "yaratildi"}: «${value.title}» (${value.items.length} band)`, "company", tenant));
    return value;
  };
  const ownTemplate = (req: Request, db: Database) => {
    const t = db.checklistTemplates.find((x) => x.id === req.params.id && x.companyId === tenantOf(req));
    const scope = scopeOf(db, panel(req).role, panel(req).userId);
    // Filial rahbari faqat to‘liq o‘z filiallaridagi shablonni o‘zgartiradi.
    if (!t || (scope.branches && (!t.branchIds.length || t.branchIds.some((id) => !scope.branches!.has(id))))) throw httpError("Checklist topilmadi.", 404);
    return t;
  };
  router.post(
    "/checklists",
    manage,
    route(async (req, res) => res.status(201).json(await updateDb((db) => saveTemplate(req)(db)))),
  );
  router.put(
    "/checklists/:id",
    manage,
    route(async (req, res) => res.json(await updateDb((db) => saveTemplate(req, ownTemplate(req, db))(db)))),
  );
  router.delete(
    "/checklists/:id",
    manage,
    route(async (req, res) => {
      await updateDb((db) => {
        const t = ownTemplate(req, db);
        db.checklistTemplates = db.checklistTemplates.filter((x) => x.id !== t.id);
        db.auditLogs.unshift(audit(t.companyId, panel(req).name, `Checklist o‘chirildi: «${t.title}»`, "company", t.companyId));
      });
      res.json({ ok: true });
    }),
  );

  /* ---------------------------------------------------- hodisalar --- */
  const incidentAccess = permit(["ops.manage", "incidents.it"]);
  router.get(
    "/incidents",
    incidentAccess,
    route(async (req, res) => {
      const db = await readDb();
      const scope = scopeOf(db, panel(req).role, panel(req).userId);
      const rows = db.incidents.filter((i) => i.companyId === tenantOf(req) && incidentVisible(scope, i)).map((i) => describeIncident(db, i));
      res.json({ incidents: rows, categories: INCIDENT_CATEGORIES, branches: db.branches.filter((b) => b.companyId === tenantOf(req) && inBranch(scope, b.id)).map((b) => ({ id: b.id, name: b.name })) });
    }),
  );
  router.post(
    "/incidents",
    incidentAccess,
    route(async (req, res) => {
      const input = z
        .object({ branchId: z.string().min(1), title: z.string().trim().min(3).max(140), description: z.string().trim().max(1500).optional(), category: z.enum(Object.keys(INCIDENT_CATEGORIES) as [Incident["category"], ...Incident["category"][]]), severity: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"), photo: photoSchema })
        .parse(req.body);
      const tenant = tenantOf(req);
      const photoId = input.photo ? await savePhoto(tenant, input.photo) : undefined;
      const row = await updateDb((db) => {
        const scope = scopeOf(db, panel(req).role, panel(req).userId);
        if (!db.branches.some((b) => b.id === input.branchId && b.companyId === tenant) || !inBranch(scope, input.branchId)) throw httpError("Filial topilmadi.", 404);
        const now = new Date().toISOString();
        const value: Incident = {
          id: randomUUID(),
          companyId: tenant,
          branchId: input.branchId,
          title: input.title,
          description: input.description || undefined,
          category: input.category,
          severity: input.severity,
          status: "OPEN",
          reporterName: panel(req).name,
          photoIds: photoId ? [photoId] : [],
          history: [{ at: now, by: panel(req).name, status: "OPEN", note: "Yaratildi" }],
          createdAt: now,
          updatedAt: now,
        };
        db.incidents.unshift(value);
        db.auditLogs.unshift(audit(tenant, panel(req).name, `Hodisa: «${value.title}» (${INCIDENT_CATEGORIES[value.category]})`, "company", tenant));
        return describeIncident(db, value);
      });
      res.status(201).json(row);
    }),
  );
  router.post(
    "/incidents/:id/status",
    incidentAccess,
    route(async (req, res) => {
      const input = z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]), note: z.string().trim().max(500).optional(), assignee: z.string().trim().max(80).optional() }).parse(req.body);
      if (input.status === "RESOLVED" && !input.note) throw httpError("Qanday hal qilinganini yozing.", 422);
      const { row, reporter } = await updateDb((db) => {
        const i = db.incidents.find((x) => x.id === req.params.id && x.companyId === tenantOf(req));
        if (!i || !incidentVisible(scopeOf(db, panel(req).role, panel(req).userId), i)) throw httpError("Hodisa topilmadi.", 404);
        const now = new Date().toISOString();
        i.status = input.status;
        if (input.assignee !== undefined) i.assignee = input.assignee || undefined;
        if (input.status === "IN_PROGRESS" && !i.assignee) i.assignee = panel(req).name;
        i.resolvedAt = input.status === "RESOLVED" ? now : undefined;
        i.updatedAt = now;
        i.history.push({ at: now, by: panel(req).name, status: input.status, note: input.note || undefined });
        const reporter = i.reporterEmployeeId ? db.employees.find((e) => e.id === i.reporterEmployeeId && e.status === "ACTIVE") : undefined;
        if (reporter) employeeNote(db, reporter, `Hodisa: ${INCIDENT_STATUS[i.status]}`, `«${i.title}»${input.note ? ` — ${input.note}` : ""}`, `incident_${i.id}`);
        db.auditLogs.unshift(audit(i.companyId, panel(req).name, `Hodisa «${i.title}»: ${INCIDENT_STATUS[i.status]}${input.note ? ` — ${input.note}` : ""}`, "company", i.companyId));
        return { row: describeIncident(db, i), reporter };
      });
      if (reporter) void pushTelegram([reporter.id], `🛠 Hodisa «${row.title}»: <b>${INCIDENT_STATUS[row.status]}</b>${input.note ? `\n${input.note}` : ""}`, "Hodisa yangilandi", `incident_${row.id}`);
      res.json(row);
    }),
  );

  /* ------------------------------------------------------- rasmlar --- */
  router.get(
    "/ops/photos/:id",
    permit(["ops.manage", "incidents.it"]),
    route(async (req, res) => {
      const db = await readDb();
      const tenant = tenantOf(req);
      const scope = scopeOf(db, panel(req).role, panel(req).userId);
      const id = String(req.params.id);
      const allowed =
        db.incidents.some((i) => i.companyId === tenant && i.photoIds.includes(id) && incidentVisible(scope, i)) ||
        (can(panel(req).role, "ops.manage") &&
          (db.tasks.some((t) => t.companyId === tenant && (t.photoIds.includes(id) || t.comments.some((c) => c.photoId === id)) && taskVisible(db, scope, t)) ||
            db.checklistRuns.some((r) => r.companyId === tenant && r.items.some((i) => i.photoId === id) && inBranch(scope, r.branchId))));
      if (!allowed) throw httpError("Rasm topilmadi.", 404);
      const file = await (await documentFiles()).getFile(id);
      if (!file) throw httpError("Rasm topilmadi.", 404);
      res.setHeader("Content-Type", file.mime);
      res.setHeader("Cache-Control", "private, max-age=600");
      res.send(file.data);
    }),
  );

  /** Filial rahbari / ish stoli uchun qisqa holat. */
  router.get(
    "/ops/summary",
    permit(["ops.manage", "incidents.it"]),
    route(async (req, res) => {
      const db = await readDb();
      res.json(opsSummary(db, tenantOf(req), scopeOf(db, panel(req).role, panel(req).userId)));
    }),
  );
  return router;
}

export function opsSummary(db: Database, tenant: string, scope: Scope, today = tashkentIsoDate()) {
  const tasks = db.tasks.filter((t) => t.companyId === tenant && taskVisible(db, scope, t) && (t.status === "TODO" || t.status === "IN_PROGRESS"));
  const incidents = db.incidents.filter((i) => i.companyId === tenant && i.status !== "RESOLVED" && incidentVisible(scope, i));
  const branches = scope.itOnly ? [] : db.branches.filter((b) => b.companyId === tenant && inBranch(scope, b.id));
  const runs = branches.flatMap((b) => checklistsFor(db, tenant, b.id, today).map((t) => describeRun(db, t, b.id, today)));
  return {
    openTasks: scope.itOnly ? 0 : tasks.length,
    overdueTasks: scope.itOnly ? 0 : tasks.filter((t) => t.dueDate && t.dueDate < today).length,
    openIncidents: incidents.length,
    highIncidents: incidents.filter((i) => i.severity === "HIGH").length,
    checklists: { total: runs.length, done: runs.filter((r) => r.done === r.total).length, overdue: runs.filter((r) => r.overdue).length },
    runs,
    incidents: incidents.slice(0, 20).map((i) => describeIncident(db, i)),
    tasks: scope.itOnly ? [] : tasks.slice(0, 30).map((t) => describeTask(db, t, today)),
  };
}

/** Ish stoli (Action Center) uchun: kechikkan vazifalar, ochiq hodisalar, tugamagan checklistlar. */
export function opsActions(db: Database, tenant: string, role: Role, userId: string) {
  if (!canAny(role, ["ops.manage", "incidents.it"])) return null;
  return opsSummary(db, tenant, scopeOf(db, role, userId));
}

/* ======================================================= xodim (Mini App / ilova) === */
export function createMiniOpsRouter() {
  const router = Router();
  const me = (db: Database, req: Request) => {
    const e = db.employees.find((x) => x.id === worker(req).employeeId && x.status === "ACTIVE");
    if (!e) throw httpError("Xodim topilmadi.", 404);
    return e;
  };

  router.get(
    "/mini/work",
    route(async (req, res) => {
      const db = await readDb();
      const e = me(db, req);
      const today = tashkentIsoDate();
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const tasks = db.tasks
        .filter((t) => t.companyId === e.companyId && t.assigneeIds.includes(e.id) && (t.status === "TODO" || t.status === "IN_PROGRESS" || (t.status === "DONE" && (t.doneAt || "") >= weekAgo)))
        .map((t) => ({ ...describeTask(db, t, today), assignees: undefined, assigneeIds: undefined }));
      const checklists = checklistsFor(db, e.companyId, e.branchId, today).map((t) => describeRun(db, t, e.branchId, today));
      const incidents = db.incidents.filter((i) => i.reporterEmployeeId === e.id).slice(0, 30).map((i) => describeIncident(db, i));
      res.json({ tasks, checklists, incidents, categories: INCIDENT_CATEGORIES });
    }),
  );

  router.post(
    "/mini/tasks/:id/status",
    route(async (req, res) => {
      const input = z.object({ status: z.enum(["IN_PROGRESS", "DONE"]), note: z.string().trim().max(500).optional(), photo: photoSchema }).parse(req.body);
      const session = worker(req);
      const photoId = input.photo ? await savePhoto(session.companyId, input.photo) : undefined;
      const row = await updateDb((db) => {
        const e = me(db, req);
        const t = db.tasks.find((x) => x.id === req.params.id && x.companyId === e.companyId && x.assigneeIds.includes(e.id));
        if (!t) throw httpError("Vazifa topilmadi.", 404);
        if (t.status === "DONE" || t.status === "CANCELLED") throw httpError(`Vazifa allaqachon «${TASK_STATUS[t.status]}».`, 409);
        if (input.status === "DONE" && t.requirePhoto && !photoId && !t.photoIds.length) throw httpError("Bu vazifa uchun natija rasmini yuklang.", 422);
        const now = new Date().toISOString();
        t.status = input.status;
        if (photoId) t.photoIds.push(photoId);
        if (input.status === "DONE") Object.assign(t, { doneAt: now, doneBy: nameOf(e) });
        t.comments.push({ by: nameOf(e), text: input.note || `Holat: ${TASK_STATUS[input.status]}`, at: now, photoId });
        t.updatedAt = now;
        if (input.status === "DONE") panelNote(db, e.companyId, "Vazifa bajarildi", `${nameOf(e)}: «${t.title}»${photoId ? " (rasm bilan)" : ""}`, `/tasks?id=${t.id}`);
        return describeTask(db, t);
      });
      res.json(row);
    }),
  );
  router.post(
    "/mini/tasks/:id/comment",
    route(async (req, res) => {
      const input = z.object({ text: z.string().trim().min(1).max(1000), photo: photoSchema }).parse(req.body);
      const photoId = input.photo ? await savePhoto(worker(req).companyId, input.photo) : undefined;
      const row = await updateDb((db) => {
        const e = me(db, req);
        const t = db.tasks.find((x) => x.id === req.params.id && x.companyId === e.companyId && x.assigneeIds.includes(e.id));
        if (!t) throw httpError("Vazifa topilmadi.", 404);
        t.comments.push({ by: nameOf(e), text: input.text, at: new Date().toISOString(), photoId });
        t.updatedAt = new Date().toISOString();
        panelNote(db, e.companyId, `Vazifaga izoh: ${t.title}`, `${nameOf(e)}: ${input.text.slice(0, 160)}`, `/tasks?id=${t.id}`);
        return describeTask(db, t);
      });
      res.json(row);
    }),
  );

  router.post(
    "/mini/checklists/:templateId/items/:itemId",
    route(async (req, res) => {
      const input = z.object({ done: z.boolean(), note: z.string().trim().max(300).optional(), photo: photoSchema }).parse(req.body);
      const photoId = input.photo && input.done ? await savePhoto(worker(req).companyId, input.photo) : undefined;
      const row = await updateDb((db) => {
        const e = me(db, req);
        const today = tashkentIsoDate();
        const t = checklistsFor(db, e.companyId, e.branchId, today).find((x) => x.id === req.params.templateId);
        const item = t?.items.find((i) => i.id === req.params.itemId);
        if (!t || !item) throw httpError("Checklist bandi topilmadi.", 404);
        if (input.done && item.requirePhoto && !photoId) throw httpError("Bu band uchun rasm kerak.", 422);
        let run = runOf(db, t, e.branchId, today);
        if (!run) {
          run = { id: randomUUID(), companyId: e.companyId, templateId: t.id, branchId: e.branchId, date: today, items: [] } satisfies ChecklistRun;
          db.checklistRuns.push(run);
        }
        const now = new Date().toISOString();
        run.items = run.items.filter((m) => m.itemId !== item.id);
        if (input.done) run.items.push({ itemId: item.id, done: true, by: nameOf(e), at: now, photoId, note: input.note || undefined });
        const done = t.items.every((i) => run!.items.some((m) => m.itemId === i.id && m.done));
        if (done && !run.completedAt) {
          run.completedAt = now;
          panelNote(db, e.companyId, "Checklist bajarildi", `${db.branches.find((b) => b.id === e.branchId)?.name || ""}: «${t.title}» — oxirgi band ${nameOf(e)}`, "/checklists");
        }
        if (!done) run.completedAt = undefined;
        return describeRun(db, t, e.branchId, today);
      });
      res.json(row);
    }),
  );

  router.post(
    "/mini/incidents",
    route(async (req, res) => {
      const input = z
        .object({ title: z.string().trim().min(3).max(140), description: z.string().trim().max(1500).optional(), category: z.enum(Object.keys(INCIDENT_CATEGORIES) as [Incident["category"], ...Incident["category"][]]), severity: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"), photo: photoSchema })
        .parse(req.body);
      const photoId = input.photo ? await savePhoto(worker(req).companyId, input.photo) : undefined;
      const row = await updateDb((db) => {
        const e = me(db, req);
        const now = new Date().toISOString();
        const value: Incident = {
          id: randomUUID(),
          companyId: e.companyId,
          branchId: e.branchId,
          title: input.title,
          description: input.description || undefined,
          category: input.category,
          severity: input.severity,
          status: "OPEN",
          reporterEmployeeId: e.id,
          reporterName: nameOf(e),
          photoIds: photoId ? [photoId] : [],
          history: [{ at: now, by: nameOf(e), status: "OPEN", note: "Yuborildi" }],
          createdAt: now,
          updatedAt: now,
        };
        db.incidents.unshift(value);
        panelNote(
          db,
          e.companyId,
          `${input.severity === "HIGH" ? "🔴 " : ""}Yangi hodisa: ${INCIDENT_CATEGORIES[value.category]}`,
          `${db.branches.find((b) => b.id === e.branchId)?.name || ""} — ${nameOf(e)}: «${value.title}»`,
          `/incidents?id=${value.id}`,
        );
        db.auditLogs.unshift(audit(e.companyId, nameOf(e), `Hodisa yuborildi: «${value.title}»`, "employee", e.id));
        return describeIncident(db, value);
      });
      res.status(201).json(row);
    }),
  );
  return router;
}

/* ===================================================== fon ishlari === */
/**
 * Har tekshiruvda: muddati o‘tgan checklist (dueTime) — filial xodimlari va rahbarlarga bir martalik xabar;
 * bugun muddati tugaydigan vazifalar — ertalab ijrochilarga eslatma.
 */
export async function runOpsReminders(today = tashkentIsoDate(), clock = tashkentClock()) {
  const db = await readDb();
  const sent = new Set(db.sentGreetings.map((g) => g.key));
  const jobs: { key: string; apply: (db: Database) => void; telegram?: { ids: string[]; text: string; title: string; go: string } }[] = [];
  for (const t of db.checklistTemplates.filter((x) => x.active && x.dueTime && clock > x.dueTime))
    for (const b of db.branches.filter((x) => x.companyId === t.companyId && (!t.branchIds.length || t.branchIds.includes(x.id)))) {
      if (!checklistsFor(db, t.companyId, b.id, today).some((x) => x.id === t.id)) continue;
      const run = describeRun(db, t, b.id, today);
      const key = `checklist:${t.id}:${b.id}:${today}`;
      if (run.done >= run.total || sent.has(key)) continue;
      const staff = db.employees.filter((e) => e.companyId === t.companyId && e.status === "ACTIVE" && e.branchId === b.id && db.attendance.some((a) => a.employeeId === e.id && a.date === today && a.checkIn && !a.checkOut));
      jobs.push({
        key,
        apply: (next) => {
          panelNote(next, t.companyId, "Checklist vaqtida tugamadi", `${b.name}: «${t.title}» — ${run.done}/${run.total} (muddat ${t.dueTime})`, "/checklists");
          for (const e of staff) employeeNote(next, e, "Checklist tugamadi", `«${t.title}» — ${run.done}/${run.total}. Qolgan bandlarni belgilang.`, "checklist");
        },
        telegram: { ids: staff.map((e) => e.id), text: `☑️ «${t.title}» hali tugamadi (${run.done}/${run.total}). Qolgan bandlarni belgilang.`, title: "Checklist", go: "checklist" },
      });
    }
  if (clock >= "09:00")
    for (const t of db.tasks.filter((x) => x.dueDate === today && (x.status === "TODO" || x.status === "IN_PROGRESS"))) {
      const key = `task-due:${t.id}:${today}`;
      if (sent.has(key)) continue;
      jobs.push({
        key,
        apply: (next) => {
          for (const id of t.assigneeIds) {
            const e = next.employees.find((x) => x.id === id && x.status === "ACTIVE");
            if (e) employeeNote(next, e, "Vazifa muddati — bugun", `«${t.title}»`, `tasks_${t.id}`);
          }
        },
        telegram: { ids: t.assigneeIds, text: `⏰ Bugun vazifa muddati: <b>${t.title}</b>`, title: "Vazifa", go: `tasks_${t.id}` },
      });
    }
  if (!jobs.length) return 0;
  const at = new Date().toISOString();
  await updateDb((next) => {
    for (const job of jobs) {
      job.apply(next);
      next.sentGreetings.push({ key: job.key, at });
    }
  });
  for (const job of jobs) if (job.telegram) await pushTelegram(job.telegram.ids, job.telegram.text, job.telegram.title, job.telegram.go);
  return jobs.length;
}
