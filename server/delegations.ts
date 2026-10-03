import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { tashkentIsoDate } from "../lib/format";
import type { Database, Delegation } from "../lib/types";
import type { AuthedRequest } from "./auth";

/*
 * Vakolatni vaqtincha berish (delegation): masalan direktor 5 kun yo‘q — tasdiqlash vakolatini
 * boshqa mas’ulga beradi. Mas’ul shu muddatda FAQAT tasdiqlash yo‘llarida (Inbox, so‘rov qarorlari,
 * ish haqi jarayoni) beruvchi roli bilan ishlaydi; boshqa bo‘limlarga ta’sir qilmaydi.
 * Har amal auditda «(vakolat: …)» bo‘lib qoladi; muddat tugashi yoki bekor qilinishi bilan o‘chadi.
 */

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req as AuthedRequest, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Vakolat faqat shu yo‘llarda ishlaydi (tasdiqlash va ular uchun kerakli o‘qishlar). */
const APPROVAL_PATHS = [
  /^\/workspace\//,
  /^\/leave\/[^/]+$/,
  /^\/leave$/,
  /^\/attendance-corrections(\/[^/]+\/decide)?$/,
  /^\/shift-swaps(\/[^/]+\/decide)?$/,
  /^\/dayoff-moves(\/[^/]+\/decide)?$/,
  /^\/payroll\/advances(\/[^/]+\/decide)?$/,
  /^\/fines(\/[^/]+\/decide)?$/,
  /^\/attendance\/[^/]+\/overtime$/,
  /^\/overtime$/,
  /^\/mobile\/device-requests(\/[^/]+\/decide)?$/,
  /^\/registrations(\/[^/]+\/(approve|reject))?$/,
  /^\/payroll\/\d{4}-\d{2}\/workflow$/,
];
const ROLE_RANK: Record<string, number> = { COMPANY_OWNER: 5, HR_ADMIN: 4, HR_MANAGER: 4, FINANCE: 3, BRANCH_MANAGER: 2, IT_ADMIN: 1 };

export function activeDelegation(db: Pick<Database, "delegations">, userId: string, today = tashkentIsoDate()) {
  return db.delegations.find((d) => d.toUserId === userId && !d.revokedAt && d.startDate <= today && d.endDate >= today);
}

/** requireAuth’dan keyin: faol vakolat bo‘lsa — tasdiqlash yo‘llarida beruvchi roli bilan. */
export function delegationMiddleware() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const session = (req as AuthedRequest).session;
      if (!session?.userId || !APPROVAL_PATHS.some((p) => p.test(req.path))) return next();
      const db = await readDb();
      const d = activeDelegation(db, session.userId);
      if (d && (ROLE_RANK[d.fromRole] || 0) > (ROLE_RANK[session.role] || 0)) {
        session.role = d.fromRole as typeof session.role;
        session.name = `${session.name} (vakolat: ${d.fromName})`;
        if (d.fromRole === "BRANCH_MANAGER") session.userId = d.fromUserId;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createDelegationRouter() {
  const router = Router();
  router.get(
    "/delegations",
    route(async (req, res) => {
      const db = await readDb();
      const tenant = req.session!.companyId!;
      const today = tashkentIsoDate();
      res.json({
        mine: db.delegations.filter((d) => d.companyId === tenant && (d.fromUserId === req.session!.userId || d.toUserId === req.session!.userId)).map((d) => ({ ...d, active: !d.revokedAt && d.startDate <= today && d.endDate >= today })),
        all: req.session!.role === "COMPANY_OWNER" ? db.delegations.filter((d) => d.companyId === tenant).map((d) => ({ ...d, active: !d.revokedAt && d.startDate <= today && d.endDate >= today })) : undefined,
        // Vakolat berish mumkin bo‘lganlar: shu kompaniyaning boshqa panel foydalanuvchilari.
        candidates: db.users.filter((u) => u.companyId === tenant && u.id !== req.session!.userId && u.role !== "SUPER_ADMIN").map((u) => ({ id: u.id, name: u.name, role: u.role })),
      });
    }),
  );
  router.post(
    "/delegations",
    route(async (req, res) => {
      const input = z.object({ toUserId: z.string().min(1), startDate: dateSchema, endDate: dateSchema, reason: z.string().trim().max(300).optional() }).parse(req.body);
      if (input.endDate < input.startDate) throw httpError("Tugash sanasi boshlanishdan oldin bo‘lmasin.", 422);
      if (Date.parse(input.endDate) - Date.parse(input.startDate) > 60 * 86_400_000) throw httpError("Vakolat ko‘pi bilan 60 kunga beriladi.", 422);
      const row = await updateDb((db) => {
        const tenant = req.session!.companyId!;
        const from = db.users.find((u) => u.id === req.session!.userId);
        const to = db.users.find((u) => u.id === input.toUserId && u.companyId === tenant);
        if (!from || !to) throw httpError("Foydalanuvchi topilmadi.", 404);
        if (db.delegations.some((d) => d.fromUserId === from.id && !d.revokedAt && d.endDate >= tashkentIsoDate())) throw httpError("Sizda faol vakolat bor — avval uni bekor qiling.", 409);
        const value: Delegation = {
          id: randomUUID(),
          companyId: tenant,
          fromUserId: from.id,
          fromName: from.name,
          fromRole: from.role,
          toUserId: to.id,
          toName: to.name,
          startDate: input.startDate,
          endDate: input.endDate,
          reason: input.reason || undefined,
          createdAt: new Date().toISOString(),
        };
        db.delegations.push(value);
        db.notifications.unshift({
          id: randomUUID(),
          companyId: tenant,
          title: "Vakolat berildi",
          body: `${from.name} → ${to.name}: tasdiqlash vakolati ${input.startDate} – ${input.endDate}${value.reason ? ` (${value.reason})` : ""}`,
          type: "SECURITY",
          read: false,
          createdAt: value.createdAt,
        });
        db.auditLogs.unshift(audit(tenant, from.name, `Vakolat berildi: ${to.name} (${input.startDate} – ${input.endDate})`, "user", to.id, undefined, value));
        return value;
      });
      res.status(201).json(row);
    }),
  );
  router.post(
    "/delegations/:id/revoke",
    route(async (req, res) => {
      await updateDb((db) => {
        const d = db.delegations.find((x) => x.id === req.params.id && x.companyId === req.session!.companyId);
        if (!d) throw httpError("Topilmadi.", 404);
        if (d.fromUserId !== req.session!.userId && req.session!.role !== "COMPANY_OWNER") throw httpError("Faqat bergan kishi yoki direktor bekor qiladi.", 403);
        d.revokedAt = new Date().toISOString();
        db.auditLogs.unshift(audit(d.companyId, req.session!.name, `Vakolat bekor qilindi: ${d.toName}`, "user", d.toUserId));
      });
      res.json({ ok: true });
    }),
  );
  return router;
}
