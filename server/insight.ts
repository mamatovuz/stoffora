import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { can, canAny } from "../lib/permissions";
import { tashkentIsoDate } from "../lib/format";
import type { Database, Employee } from "../lib/types";
import type { AuthedRequest } from "./auth";
import { marksOf } from "./history";

/*
 * Umumiy qidiruv (Ctrl+K), tashkiliy tuzilma va kunlik faoliyat lentasi.
 * Hammasi rol va filial chegarasini hurmat qiladi: filial rahbari faqat o‘z filiallarini,
 * moliya — xodimlarni ko‘rmaydi (faqat moliyaviy sahifalar).
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const session = (req: Request) => (req as AuthedRequest).session!;
const nameOf = (e?: Pick<Employee, "firstName" | "lastName">) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’ʼ`']/g, "")
    .replace(/\s+/g, " ")
    .trim();

function scopeOf(db: Database, req: Request) {
  const s = session(req);
  return s.role === "BRANCH_MANAGER" ? new Set(db.users.find((u) => u.id === s.userId)?.branchIds || []) : null;
}

export type SearchHit = { kind: string; id: string; title: string; sub?: string; link: string; photo?: string };

export function searchAll(db: Database, companyId: string, role: string, scope: Set<string> | null, query: string): SearchHit[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const hits: SearchHit[] = [];
  const match = (...parts: (string | undefined)[]) => parts.some((p) => p && norm(p).includes(q));
  const branchName = (id: string) => db.branches.find((b) => b.id === id)?.name || "";
  if (canAny(role as never, ["employees.view", "attendance.view"])) {
    for (const e of db.employees) {
      if (e.companyId !== companyId || (scope && !scope.has(e.branchId))) continue;
      const phone = (e.phone || "").replace(/\D/g, "");
      if (match(nameOf(e), `${e.lastName} ${e.firstName}`, e.middleName, e.employeeNo) || (digits.length >= 4 && phone.includes(digits)))
        hits.push({
          kind: "employee",
          id: e.id,
          title: nameOf(e),
          sub: [db.positions.find((p) => p.id === e.positionId)?.name, branchName(e.branchId), e.status !== "ACTIVE" ? "ishdan ketgan" : ""].filter(Boolean).join(" · "),
          link: `/employees/${e.id}`,
          photo: e.photoDataUrl,
        });
    }
  }
  if (can(role as never, "org.view")) {
    for (const b of db.branches) if (b.companyId === companyId && (!scope || scope.has(b.id)) && match(b.name, b.address)) hits.push({ kind: "branch", id: b.id, title: b.name, sub: b.address, link: "/branches" });
    for (const d of db.departments) if (d.companyId === companyId && match(d.name)) hits.push({ kind: "department", id: d.id, title: d.name, sub: "Bo‘lim", link: "/departments" });
    for (const p of db.positions) if (p.companyId === companyId && match(p.name)) hits.push({ kind: "position", id: p.id, title: p.name, sub: "Lavozim", link: "/positions" });
  }
  for (const a of db.kbArticles) if (a.companyId === companyId && match(a.title, a.category, a.body.slice(0, 400))) hits.push({ kind: "kb", id: a.id, title: a.title, sub: `Bilimlar bazasi · ${a.category}`, link: "/knowledge" });
  if (canAny(role as never, ["announcements.view", "announcements.create"]))
    for (const a of db.announcements) if (a.companyId === companyId && match(a.title)) hits.push({ kind: "announcement", id: a.id, title: a.title, sub: "E’lon", link: "/announcements" });
  if (canAny(role as never, ["ops.manage"])) {
    for (const t of db.tasks) if (t.companyId === companyId && match(t.title)) hits.push({ kind: "task", id: t.id, title: t.title, sub: "Vazifa", link: `/tasks?id=${t.id}` });
  }
  if (canAny(role as never, ["ops.manage", "incidents.it"]))
    for (const i of db.incidents) if (i.companyId === companyId && (!scope || scope.has(i.branchId)) && match(i.title)) hits.push({ kind: "incident", id: i.id, title: i.title, sub: "Hodisa", link: `/incidents?id=${i.id}` });
  if (canAny(role as never, ["learning.manage", "learning.view"]))
    for (const c of db.courses) if (c.companyId === companyId && match(c.title)) hits.push({ kind: "course", id: c.id, title: c.title, sub: "Kurs", link: "/learning" });
  // Avval nomi so‘rov bilan boshlanganlar.
  return hits.sort((a, b) => Number(!norm(a.title).startsWith(q)) - Number(!norm(b.title).startsWith(q))).slice(0, 40);
}

/** Tashkiliy tuzilma: bo‘limlar (ota bo‘lim, rahbar) → lavozimlar → xodimlar; filiallar → rahbarlar. */
export function orgTree(db: Database, companyId: string, scope: Set<string> | null) {
  const staff = db.employees.filter((e) => e.companyId === companyId && e.status === "ACTIVE" && (!scope || scope.has(e.branchId)));
  const person = (e: Employee) => ({ id: e.id, name: nameOf(e), photoDataUrl: e.photoDataUrl, position: db.positions.find((p) => p.id === e.positionId)?.name || "", branch: db.branches.find((b) => b.id === e.branchId)?.name || "" });
  const departments = db.departments
    .filter((d) => d.companyId === companyId)
    .map((d) => {
      const positions = db.positions
        .filter((p) => p.companyId === companyId && p.departmentId === d.id)
        .map((p) => ({ id: p.id, name: p.name, panelRole: p.panelRole, people: staff.filter((e) => e.positionId === p.id).map(person) }));
      const people = staff.filter((e) => e.departmentId === d.id);
      const head = d.headEmployeeId ? db.employees.find((e) => e.id === d.headEmployeeId) : undefined;
      return { id: d.id, name: d.name, parentId: d.parentId || null, head: head ? person(head) : d.manager ? { id: "", name: d.manager, position: "", branch: "" } : null, count: people.length, positions };
    });
  const branches = db.branches
    .filter((b) => b.companyId === companyId && (!scope || scope.has(b.id)))
    .map((b) => ({ id: b.id, name: b.name, count: staff.filter((e) => e.branchId === b.id).length, managers: (b.managerEmployeeIds || []).map((id) => db.employees.find((e) => e.id === id)).filter((e): e is Employee => Boolean(e)).map(person) }));
  const unassigned = staff.filter((e) => !e.departmentId || !db.departments.some((d) => d.id === e.departmentId)).length;
  return { company: db.companies.find((c) => c.id === companyId)?.name || "", total: staff.length, departments, branches, unassigned };
}

type Event = { at: string; kind: string; title: string; sub?: string; employeeId?: string; branchId?: string; tone?: "ok" | "warn" | "bad" | "info" };

/** Kunlik faoliyat lentasi: belgilar, so‘rovlar, qarorlar, vazifalar, hodisalar, e’lonlar va audit. */
export function activityFeed(db: Database, companyId: string, date: string, scope: Set<string> | null, filter: { employeeId?: string; branchId?: string } = {}) {
  const events: Event[] = [];
  const emp = (id?: string) => db.employees.find((e) => e.id === id);
  const inScope = (branchId?: string) => (!scope || (branchId && scope.has(branchId))) && (!filter.branchId || branchId === filter.branchId);
  const okEmp = (id?: string) => !filter.employeeId || id === filter.employeeId;
  const iso = (time: string) => `${date}T${time}:00+05:00`;
  for (const a of db.attendance) {
    if (a.companyId !== companyId || a.date !== date || !inScope(a.branchId) || !okEmp(a.employeeId)) continue;
    const e = emp(a.employeeId);
    for (const m of marksOf(db, a))
      events.push({
        at: new Date(iso(m.time)).toISOString(),
        kind: m.kind === "IN" ? "checkin" : "checkout",
        title: `${nameOf(e)} — ${m.kind === "IN" ? "keldi" : "ketdi"} ${m.time}`,
        sub: [m.branchName, m.kind === "IN" && a.lateMinutes ? `${a.lateMinutes} daq kech` : "", m.method === "MANUAL" ? "qo‘lda" : "", a.flags?.length ? "⚠️ shubhali" : ""].filter(Boolean).join(" · "),
        employeeId: a.employeeId,
        branchId: a.branchId,
        tone: m.kind === "IN" ? (a.lateMinutes ? "warn" : "ok") : "info",
      });
  }
  const sameDay = (at?: string) => Boolean(at) && new Date(Date.parse(at!) + 5 * 3600_000).toISOString().slice(0, 10) === date;
  for (const l of db.leaveRequests) {
    const e = emp(l.employeeId);
    if (l.companyId !== companyId || !e || !inScope(e.branchId) || !okEmp(e.id)) continue;
    if (sameDay(l.createdAt)) events.push({ at: l.createdAt, kind: "request", title: `${nameOf(e)} — ta’til/ruxsat so‘radi`, sub: l.reason, employeeId: e.id, branchId: e.branchId, tone: "info" });
  }
  for (const c of db.attendanceCorrections) {
    const e = emp(c.employeeId);
    if (c.companyId !== companyId || !e || !inScope(e.branchId) || !okEmp(e.id)) continue;
    if (sameDay(c.createdAt)) events.push({ at: c.createdAt, kind: "request", title: `${nameOf(e)} — belgilash so‘rovi (${c.kind === "IN" ? "kirish" : "chiqish"} ${c.time})`, sub: c.comment, employeeId: e.id, branchId: e.branchId, tone: "info" });
    if (c.status !== "PENDING" && sameDay(c.updatedAt)) events.push({ at: c.updatedAt, kind: "decision", title: `Belgilash so‘rovi ${c.status === "APPROVED" ? "tasdiqlandi" : "rad etildi"}: ${nameOf(e)}`, employeeId: e.id, branchId: e.branchId, tone: c.status === "APPROVED" ? "ok" : "bad" });
  }
  for (const t of db.tasks) {
    if (t.companyId !== companyId || (t.branchId && !inScope(t.branchId)) || (filter.employeeId && !t.assigneeIds.includes(filter.employeeId))) continue;
    if (sameDay(t.createdAt)) events.push({ at: t.createdAt, kind: "task", title: `Vazifa berildi: ${t.title}`, sub: t.createdBy, branchId: t.branchId, tone: "info" });
    if (t.doneAt && sameDay(t.doneAt)) events.push({ at: t.doneAt, kind: "task", title: `Vazifa bajarildi: ${t.title}`, sub: t.doneBy, branchId: t.branchId, tone: "ok" });
  }
  for (const i of db.incidents) {
    if (i.companyId !== companyId || !inScope(i.branchId) || (filter.employeeId && i.reporterEmployeeId !== filter.employeeId)) continue;
    for (const h of i.history) if (sameDay(h.at)) events.push({ at: h.at, kind: "incident", title: `Hodisa «${i.title}»: ${h.status === "OPEN" ? "ochildi" : h.status === "IN_PROGRESS" ? "jarayonda" : "hal qilindi"}`, sub: [h.by, h.note].filter(Boolean).join(" — "), branchId: i.branchId, tone: h.status === "RESOLVED" ? "ok" : i.severity === "HIGH" ? "bad" : "warn" });
  }
  if (!filter.employeeId)
    for (const a of db.announcements) if (a.companyId === companyId && sameDay(a.scheduledAt)) events.push({ at: a.scheduledAt, kind: "announcement", title: `E’lon: ${a.title}`, sub: `${a.audience}${a.createdBy ? ` · ${a.createdBy}` : ""}`, tone: "info" });
  // Panel amallari (audit) — filial rahbari uchun faqat o‘z xodimlari bo‘yicha.
  for (const l of db.auditLogs) {
    if (l.companyId !== companyId || !sameDay(l.createdAt)) continue;
    if (/^(Ishga kelish|Ishdan ketish) qayd etildi$/.test(l.action)) continue; // belgilar yuqorida
    const e = l.entity === "employee" || l.entity === "attendance" ? emp(l.entity === "employee" ? l.entityId : db.attendance.find((a) => a.id === l.entityId)?.employeeId) : undefined;
    if (scope && (!e || !scope.has(e.branchId))) continue;
    if (filter.employeeId && e?.id !== filter.employeeId) continue;
    if (filter.branchId && e && e.branchId !== filter.branchId) continue;
    events.push({ at: l.createdAt, kind: "audit", title: l.action, sub: l.actor, employeeId: e?.id, branchId: e?.branchId, tone: "info" });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));
  const counts: Record<string, number> = {};
  for (const ev of events) counts[ev.kind] = (counts[ev.kind] || 0) + 1;
  return { date, counts, events: events.slice(0, 500) };
}

export function createInsightRouter() {
  const router = Router();
  router.get(
    "/search",
    route(async (req, res) => {
      const db = await readDb();
      const s = session(req);
      res.json(searchAll(db, s.companyId!, s.role, scopeOf(db, req), String(req.query.q || "")));
    }),
  );
  router.get(
    "/org/tree",
    route(async (req, res) => {
      if (!can(session(req).role, "org.view")) throw httpError("Bu amal uchun ruxsat yetarli emas.", 403);
      const db = await readDb();
      res.json(orgTree(db, session(req).companyId!, scopeOf(db, req)));
    }),
  );
  router.put(
    "/org/departments/:id",
    route(async (req, res) => {
      if (!can(session(req).role, "employees.edit")) throw httpError("Bu amal uchun ruxsat yetarli emas.", 403);
      const input = z.object({ parentId: z.string().nullable().optional(), headEmployeeId: z.string().nullable().optional() }).parse(req.body);
      await updateDb((db) => {
        const tenant = session(req).companyId!;
        const d = db.departments.find((x) => x.id === req.params.id && x.companyId === tenant);
        if (!d) throw httpError("Bo‘lim topilmadi.", 404);
        if (input.parentId !== undefined) {
          // Halqa bo‘lmasin: yangi ota — o‘zi yoki uning avlodi bo‘lolmaydi.
          let cursor = input.parentId;
          while (cursor) {
            if (cursor === d.id) throw httpError("Bo‘lim o‘z ichiga joylasha olmaydi.", 422);
            cursor = db.departments.find((x) => x.id === cursor)?.parentId || null;
          }
          if (input.parentId && !db.departments.some((x) => x.id === input.parentId && x.companyId === tenant)) throw httpError("Ota bo‘lim topilmadi.", 404);
          d.parentId = input.parentId || undefined;
        }
        if (input.headEmployeeId !== undefined) {
          const head = input.headEmployeeId ? db.employees.find((e) => e.id === input.headEmployeeId && e.companyId === tenant) : undefined;
          if (input.headEmployeeId && !head) throw httpError("Xodim topilmadi.", 404);
          d.headEmployeeId = head?.id;
          d.manager = head ? nameOf(head) : d.manager;
        }
        db.auditLogs.unshift(audit(tenant, session(req).name, `Tuzilma: «${d.name}» bo‘limi yangilandi`, "company", tenant));
      });
      res.json({ ok: true });
    }),
  );
  router.get(
    "/activity",
    route(async (req, res) => {
      if (!canAny(session(req).role, ["attendance.view", "employees.view", "audit.view"])) throw httpError("Bu amal uchun ruxsat yetarli emas.", 403);
      const db = await readDb();
      const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(String(req.query.date || tashkentIsoDate()));
      res.json(activityFeed(db, session(req).companyId!, date, scopeOf(db, req), { employeeId: req.query.employeeId ? String(req.query.employeeId) : undefined, branchId: req.query.branchId ? String(req.query.branchId) : undefined }));
    }),
  );
  return router;
}
