import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { canAny } from "../lib/permissions";
import { tashkentIsoDate } from "../lib/format";
import type { AnnouncementTarget, Course, CourseAttempt, Database, Employee, KbArticle } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";
import { targetEmployees, targetLabel } from "./integrations/announce";

/*
 * Bilim va o‘qitish:
 *   • Bilimlar bazasi — qoidalar, yo‘riqnomalar, FAQ (auditoriya bo‘yicha), qidiruv, ko‘rishlar soni.
 *   • Kurslar — darslar + test; ball SERVERDA hisoblanadi (to‘g‘ri javoblar xodimga yuborilmaydi),
 *     o‘tish foizi, muddat, majburiy kurslar; natijalar HR’da.
 *   • Raqamli ID (QR badge) — 2 daqiqalik imzolangan QR: qo‘riqchi / rahbar skaner qilib xodimni tekshiradi.
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const panel = (req: Request) => (req as AuthedRequest).session!;
const worker = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
const nameOf = (e?: Employee) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
const badgeSecret = () => `${process.env.JWT_SECRET || "staffora-local-badge-secret-change-me"}:badge`;
export const BADGE_TTL_SECONDS = 120;
const MAX_ATTEMPTS_PER_DAY = 5;

const targetSchema = z.object({ type: z.enum(["ALL", "BRANCHES", "DEPARTMENTS", "POSITIONS", "EMPLOYEES"]), ids: z.array(z.string()).max(5000).default([]) }).default({ type: "ALL", ids: [] });
const inTarget = (db: Database, e: Employee, target: AnnouncementTarget) => targetEmployees(db, e.companyId, target).some((x) => x.id === e.id);

/* ------------------------------------------------------------- kurs holati --- */
export function courseStatus(db: Database, course: Course, employeeId: string, today = tashkentIsoDate()) {
  const attempts = db.courseAttempts.filter((a) => a.courseId === course.id && a.employeeId === employeeId).sort((a, b) => b.at.localeCompare(a.at));
  const passed = attempts.find((a) => a.passed);
  const best = attempts.reduce((m, a) => Math.max(m, a.score), 0);
  const status = passed ? "PASSED" : attempts.length ? "FAILED" : course.dueDate && course.dueDate < today ? "OVERDUE" : "NEW";
  return { status, best, attempts: attempts.length, passedAt: passed?.at, lastAt: attempts[0]?.at };
}
/** Xodim uchun kurs (to‘g‘ri javoblarsiz). */
const publicCourse = (c: Course) => ({ ...c, questions: c.questions.map((q) => ({ id: q.id, q: q.q, options: q.options })) });

/* ================================================================ panel === */
export function createLearnRouter() {
  const router = Router();
  const permit = (permissions: string[]) => (req: Request, res: Response, next: NextFunction) =>
    canAny(panel(req).role, permissions) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  const tenant = (req: Request) => panel(req).companyId!;

  /* ---- bilimlar bazasi ---- */
  router.get(
    "/kb",
    route(async (req, res) => {
      const db = await readDb();
      res.json(
        db.kbArticles
          .filter((a) => a.companyId === tenant(req))
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
          .map((a) => ({ ...a, audience: targetLabel(db, a.companyId, a.target) })),
      );
    }),
  );
  const articleInput = z.object({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(5).max(20_000), category: z.string().trim().max(60).default("Umumiy"), target: targetSchema, pinned: z.boolean().default(false) });
  router.post(
    "/kb",
    permit(["kb.manage"]),
    route(async (req, res) => {
      const input = articleInput.parse(req.body);
      const row = await updateDb((db) => {
        const now = new Date().toISOString();
        const value: KbArticle = { id: randomUUID(), companyId: tenant(req), ...input, createdBy: panel(req).name, createdAt: now, updatedAt: now, views: 0 };
        db.kbArticles.push(value);
        db.auditLogs.unshift(audit(value.companyId, panel(req).name, `Bilimlar bazasi: «${value.title}» qo‘shildi`, "company", value.companyId));
        return value;
      });
      res.status(201).json(row);
    }),
  );
  router.put(
    "/kb/:id",
    permit(["kb.manage"]),
    route(async (req, res) => {
      const input = articleInput.parse(req.body);
      const row = await updateDb((db) => {
        const a = db.kbArticles.find((x) => x.id === req.params.id && x.companyId === tenant(req));
        if (!a) throw httpError("Maqola topilmadi.", 404);
        Object.assign(a, input, { updatedAt: new Date().toISOString() });
        return a;
      });
      res.json(row);
    }),
  );
  router.delete(
    "/kb/:id",
    permit(["kb.manage"]),
    route(async (req, res) => {
      await updateDb((db) => {
        db.kbArticles = db.kbArticles.filter((x) => !(x.id === req.params.id && x.companyId === tenant(req)));
      });
      res.json({ ok: true });
    }),
  );

  /* ---- kurslar ---- */
  const courseInput = z.object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(2000).optional(),
    lessons: z.array(z.object({ title: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(20_000) })).max(30).default([]),
    questions: z
      .array(z.object({ id: z.string().optional(), q: z.string().trim().min(3).max(500), options: z.array(z.string().trim().min(1).max(200)).min(2).max(6), correct: z.number().int().min(0) }))
      .min(1)
      .max(50),
    passPercent: z.number().int().min(10).max(100).default(70),
    target: targetSchema,
    dueDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
    required: z.boolean().default(true),
    active: z.boolean().default(true),
  });
  const parseCourse = (body: unknown) => {
    const input = courseInput.parse(body);
    input.questions.forEach((q, i) => {
      if (q.correct >= q.options.length) throw httpError(`${i + 1}-savolda to‘g‘ri javob tanlanmagan.`, 422);
    });
    return input;
  };
  router.get(
    "/courses",
    permit(["learning.manage", "learning.view"]),
    route(async (req, res) => {
      const db = await readDb();
      const today = tashkentIsoDate();
      res.json(
        db.courses
          .filter((c) => c.companyId === tenant(req))
          .map((c) => {
            const people = targetEmployees(db, c.companyId, c.target);
            const statuses = people.map((e) => courseStatus(db, c, e.id, today).status);
            return {
              ...c,
              audience: targetLabel(db, c.companyId, c.target),
              stats: { assigned: people.length, passed: statuses.filter((s) => s === "PASSED").length, failed: statuses.filter((s) => s === "FAILED").length, overdue: statuses.filter((s) => s === "OVERDUE").length },
            };
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    }),
  );
  router.get(
    "/courses/:id/results",
    permit(["learning.manage", "learning.view"]),
    route(async (req, res) => {
      const db = await readDb();
      const c = db.courses.find((x) => x.id === req.params.id && x.companyId === tenant(req));
      if (!c) throw httpError("Kurs topilmadi.", 404);
      const scope = panel(req).role === "BRANCH_MANAGER" ? new Set(db.users.find((u) => u.id === panel(req).userId)?.branchIds || []) : null;
      res.json(
        targetEmployees(db, c.companyId, c.target)
          .filter((e) => !scope || scope.has(e.branchId))
          .map((e) => ({ employeeId: e.id, name: nameOf(e), branch: db.branches.find((b) => b.id === e.branchId)?.name || "", ...courseStatus(db, c, e.id) }))
          .sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name)),
      );
    }),
  );
  router.post(
    "/courses",
    permit(["learning.manage"]),
    route(async (req, res) => {
      const input = parseCourse(req.body);
      const row = await updateDb((db) => {
        const now = new Date().toISOString();
        const value: Course = {
          id: randomUUID(),
          companyId: tenant(req),
          ...input,
          description: input.description || undefined,
          dueDate: input.dueDate || undefined,
          questions: input.questions.map((q) => ({ ...q, id: randomUUID() })),
          createdBy: panel(req).name,
          createdAt: now,
          updatedAt: now,
        };
        db.courses.push(value);
        if (value.active)
          for (const e of targetEmployees(db, value.companyId, value.target))
            db.notifications.unshift({
              id: randomUUID(),
              companyId: value.companyId,
              employeeId: e.id,
              title: value.required ? "Yangi majburiy kurs" : "Yangi kurs",
              body: `${value.title}${value.dueDate ? ` — ${value.dueDate.split("-").reverse().join(".")} gacha` : ""}. Darslarni o‘qib, testni topshiring.`,
              type: "LEARN",
              read: false,
              createdAt: now,
              go: `course_${value.id}`,
            });
        db.auditLogs.unshift(audit(value.companyId, panel(req).name, `Kurs yaratildi: «${value.title}» (${value.questions.length} savol)`, "company", value.companyId));
        return value;
      });
      res.status(201).json(row);
    }),
  );
  router.put(
    "/courses/:id",
    permit(["learning.manage"]),
    route(async (req, res) => {
      const input = parseCourse(req.body);
      const row = await updateDb((db) => {
        const c = db.courses.find((x) => x.id === req.params.id && x.companyId === tenant(req));
        if (!c) throw httpError("Kurs topilmadi.", 404);
        Object.assign(c, input, {
          description: input.description || undefined,
          dueDate: input.dueDate || undefined,
          // Mavjud savol id’lari saqlanadi (eski natijalar ma’nosini yo‘qotmasin).
          questions: input.questions.map((q) => ({ ...q, id: q.id && c.questions.some((x) => x.id === q.id) ? q.id : randomUUID() })),
          updatedAt: new Date().toISOString(),
        });
        return c;
      });
      res.json(row);
    }),
  );
  router.delete(
    "/courses/:id",
    permit(["learning.manage"]),
    route(async (req, res) => {
      await updateDb((db) => {
        const c = db.courses.find((x) => x.id === req.params.id && x.companyId === tenant(req));
        if (!c) throw httpError("Kurs topilmadi.", 404);
        db.courses = db.courses.filter((x) => x.id !== c.id);
        db.courseAttempts = db.courseAttempts.filter((a) => a.courseId !== c.id);
        db.auditLogs.unshift(audit(c.companyId, panel(req).name, `Kurs o‘chirildi: «${c.title}»`, "company", c.companyId));
      });
      res.json({ ok: true });
    }),
  );

  /* ---- QR badge tekshirish (qo‘riqchi / rahbar) ---- */
  router.get(
    "/badge/verify",
    route(async (req, res) => {
      const token = String(req.query.token || "").trim().replace(/^staffora-badge:/, "");
      let payload: { t: string; e: string; c: string };
      try {
        payload = jwt.verify(token, badgeSecret(), { issuer: "staffora-badge" }) as typeof payload;
      } catch (reason) {
        throw httpError(reason instanceof jwt.TokenExpiredError ? "QR muddati o‘tgan — xodim ilovada yangisini ochsin." : "Bu Staffora ID QR kodi emas.", 422);
      }
      const db = await readDb();
      if (payload.c !== panel(req).companyId) throw httpError("Bu xodim boshqa kompaniyada.", 403);
      const e = db.employees.find((x) => x.id === payload.e && x.companyId === payload.c);
      if (!e) throw httpError("Xodim topilmadi.", 404);
      const today = tashkentIsoDate();
      const a = db.attendance.find((x) => x.employeeId === e.id && x.date === today);
      res.json({
        valid: e.status === "ACTIVE",
        employee: {
          id: e.id,
          name: nameOf(e),
          employeeNo: e.employeeNo,
          photoDataUrl: e.photoDataUrl,
          position: db.positions.find((p) => p.id === e.positionId)?.name || "",
          branch: db.branches.find((b) => b.id === e.branchId)?.name || "",
          department: db.departments.find((d) => d.id === e.departmentId)?.name || "",
          status: e.status,
        },
        today: a ? { checkIn: a.checkIn, checkOut: a.checkOut } : null,
      });
    }),
  );
  return router;
}

/* ============================================================ xodim === */
export function createMiniLearnRouter() {
  const router = Router();
  const me = (db: Database, req: Request) => {
    const e = db.employees.find((x) => x.id === worker(req).employeeId && x.companyId === worker(req).companyId && x.status === "ACTIVE");
    if (!e) throw httpError("Xodim topilmadi.", 404);
    return e;
  };

  router.get(
    "/mini/kb",
    route(async (req, res) => {
      const db = await readDb();
      const e = me(db, req);
      const q = String(req.query.q || "").trim().toLowerCase();
      res.json(
        db.kbArticles
          .filter((a) => a.companyId === e.companyId && inTarget(db, e, a.target))
          .filter((a) => !q || `${a.title} ${a.body} ${a.category}`.toLowerCase().includes(q))
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
          .map((a) => ({ id: a.id, title: a.title, category: a.category, pinned: a.pinned, updatedAt: a.updatedAt, excerpt: a.body.slice(0, 140) })),
      );
    }),
  );
  router.get(
    "/mini/kb/:id",
    route(async (req, res) => {
      const row = await updateDb((db) => {
        const e = me(db, req);
        const a = db.kbArticles.find((x) => x.id === req.params.id && x.companyId === e.companyId && inTarget(db, e, x.target));
        if (!a) throw httpError("Maqola topilmadi.", 404);
        a.views = (a.views || 0) + 1;
        return { id: a.id, title: a.title, body: a.body, category: a.category, updatedAt: a.updatedAt };
      });
      res.json(row);
    }),
  );

  router.get(
    "/mini/courses",
    route(async (req, res) => {
      const db = await readDb();
      const e = me(db, req);
      res.json(
        db.courses
          .filter((c) => c.companyId === e.companyId && c.active && inTarget(db, e, c.target))
          .map((c) => ({ id: c.id, title: c.title, description: c.description, lessons: c.lessons.length, questions: c.questions.length, passPercent: c.passPercent, dueDate: c.dueDate, required: c.required, ...courseStatus(db, c, e.id) }))
          .sort((a, b) => Number(a.status === "PASSED") - Number(b.status === "PASSED") || (a.dueDate || "9999").localeCompare(b.dueDate || "9999")),
      );
    }),
  );
  router.get(
    "/mini/courses/:id",
    route(async (req, res) => {
      const db = await readDb();
      const e = me(db, req);
      const c = db.courses.find((x) => x.id === req.params.id && x.companyId === e.companyId && x.active && inTarget(db, e, x.target));
      if (!c) throw httpError("Kurs topilmadi.", 404);
      res.json({ ...publicCourse(c), ...courseStatus(db, c, e.id) });
    }),
  );
  router.post(
    "/mini/courses/:id/attempt",
    route(async (req, res) => {
      const { answers } = z.object({ answers: z.array(z.number().int().min(-1).max(10)).max(50) }).parse(req.body);
      const result = await updateDb((db) => {
        const e = me(db, req);
        const c = db.courses.find((x) => x.id === req.params.id && x.companyId === e.companyId && x.active && inTarget(db, e, x.target));
        if (!c) throw httpError("Kurs topilmadi.", 404);
        if (answers.length !== c.questions.length) throw httpError("Barcha savollarga javob bering.", 422);
        const today = tashkentIsoDate();
        const todays = db.courseAttempts.filter((a) => a.courseId === c.id && a.employeeId === e.id && a.at.slice(0, 10) === today).length;
        if (todays >= MAX_ATTEMPTS_PER_DAY) throw httpError(`Bugun ${MAX_ATTEMPTS_PER_DAY} marta urinildi — ertaga qayta topshiring.`, 429);
        // Ball faqat serverda: to‘g‘ri javoblar xodimga yuborilmaydi.
        const wrong = c.questions.map((q, i) => (answers[i] === q.correct ? -1 : i)).filter((i) => i >= 0);
        const score = Math.round(((c.questions.length - wrong.length) / c.questions.length) * 100);
        const passed = score >= c.passPercent;
        const attempt: CourseAttempt = { id: randomUUID(), companyId: e.companyId, courseId: c.id, employeeId: e.id, score, passed, answers, at: new Date().toISOString() };
        db.courseAttempts.push(attempt);
        if (passed && !db.courseAttempts.some((a) => a.id !== attempt.id && a.courseId === c.id && a.employeeId === e.id && a.passed))
          db.auditLogs.unshift(audit(e.companyId, nameOf(e), `Kurs topshirildi: «${c.title}» — ${score}%`, "employee", e.id));
        return { score, passed, passPercent: c.passPercent, wrong: wrong.map((i) => i + 1), total: c.questions.length };
      });
      res.json(result);
    }),
  );

  /** Raqamli ID: 2 daqiqalik QR (skrinshot uzoq ishlamaydi). */
  router.get(
    "/mini/badge",
    route(async (req, res) => {
      const db = await readDb();
      const e = me(db, req);
      const token = jwt.sign({ t: "BADGE", e: e.id, c: e.companyId }, badgeSecret(), { expiresIn: BADGE_TTL_SECONDS, issuer: "staffora-badge" });
      res.setHeader("Cache-Control", "no-store");
      res.json({
        token,
        qr: await QRCode.toDataURL(`staffora-badge:${token}`, { margin: 1, width: 360, errorCorrectionLevel: "M" }),
        expiresAt: new Date(Date.now() + BADGE_TTL_SECONDS * 1000).toISOString(),
        company: db.companies.find((c) => c.id === e.companyId)?.name || "",
        employee: {
          name: nameOf(e),
          employeeNo: e.employeeNo,
          photoDataUrl: e.photoDataUrl,
          position: db.positions.find((p) => p.id === e.positionId)?.name || "",
          branch: db.branches.find((b) => b.id === e.branchId)?.name || "",
          startDate: e.startDate,
        },
      });
    }),
  );
  return router;
}

