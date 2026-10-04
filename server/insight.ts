import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { can, canAny } from "../lib/permissions";
import type { Database, Employee } from "../lib/types";
import type { AuthedRequest } from "./auth";

/*
 * Umumiy qidiruv (Ctrl+K) va tashkiliy tuzilma.
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
  if (canAny(role as never, ["announcements.view", "announcements.create"]))
    for (const a of db.announcements) if (a.companyId === companyId && match(a.title)) hits.push({ kind: "announcement", id: a.id, title: a.title, sub: "E’lon", link: "/announcements" });
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
  return router;
}
