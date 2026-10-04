import { Router, type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { readDb } from "../lib/store";
import { tashkentIsoDate } from "../lib/format";
import type { Database, Employee } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";

/*
 * Raqamli ID (QR badge) — 2 daqiqalik imzolangan QR: qo‘riqchi / rahbar skaner qilib xodimni tekshiradi.
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const panel = (req: Request) => (req as AuthedRequest).session!;
const worker = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
const nameOf = (e?: Employee) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
const badgeSecret = () => `${process.env.JWT_SECRET || "staffora-local-badge-secret-change-me"}:badge`;
export const BADGE_TTL_SECONDS = 120;

/* ================================================================ panel === */
export function createBadgeRouter() {
  const router = Router();
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
export function createMiniBadgeRouter() {
  const router = Router();
  const me = (db: Database, req: Request) => {
    const e = db.employees.find((x) => x.id === worker(req).employeeId && x.companyId === worker(req).companyId && x.status === "ACTIVE");
    if (!e) throw httpError("Xodim topilmadi.", 404);
    return e;
  };

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
