import { Router, type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { readDb } from "../lib/store";
import { tashkentIsoDate } from "../lib/format";
import type { Database, Employee } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";

/*
 * Raqamli ID (QR badge) — 2 daqiqalik imzolangan QR. QR ichida oddiy havola
 * (`<sayt>/id/<token>`): istalgan telefon kamerasi yoki skaner ochsa — xodimning ochiq
 * ma’lumotli ID kartasi chiqadi. Rahbar/qo‘riqchi ilovadagi skaneri ham shu QR’ni o‘qiydi.
 * Ochiq kartada JSHSHIR, pasport, telefon, manzil, maosh kabi shaxsiy ma’lumot yo‘q.
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const panel = (req: Request) => (req as AuthedRequest).session!;
const worker = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
const nameOf = (e?: Employee) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
const badgeSecret = () => `${process.env.JWT_SECRET || "staffora-local-badge-secret-change-me"}:badge`;
export const BADGE_TTL_SECONDS = 120;
const publicOrigin = () =>
  (process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:3000")).replace(/\/+$/, "");
/** QR matni: `staffora-badge:<token>` (eski) yoki `https://…/id/<token>` (yangi). */
export const badgeToken = (text: string) =>
  text
    .trim()
    .replace(/^staffora-badge:/, "")
    .replace(/^.*\/id\//, "")
    .replace(/[?#].*$/, "");
type BadgePayload = { t: string; e: string; c: string };
function readBadge(text: string): BadgePayload {
  try {
    return jwt.verify(badgeToken(text), badgeSecret(), { issuer: "staffora-badge" }) as BadgePayload;
  } catch (reason) {
    throw httpError(reason instanceof jwt.TokenExpiredError ? "QR muddati o‘tgan — xodim ilovada yangisini ochsin." : "Bu Staffora ID QR kodi emas.", 422);
  }
}
const yearsSince = (iso?: string) => {
  if (!iso) return 0;
  const days = (Date.parse(tashkentIsoDate()) - Date.parse(iso.slice(0, 10))) / 86_400_000;
  return Math.max(0, Math.floor(days / 365.25));
};

/* ============================================ ochiq karta (kirishsiz) === */
export function createPublicBadgeRouter() {
  const router = Router();
  router.get(
    "/public/badge/:token",
    route(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const payload = readBadge(String(req.params.token || ""));
      const db = await readDb();
      const e = db.employees.find((x) => x.id === payload.e && x.companyId === payload.c);
      if (!e) throw httpError("Xodim topilmadi.", 404);
      const company = db.companies.find((c) => c.id === e.companyId);
      const today = tashkentIsoDate();
      const a = db.attendance.find((x) => x.employeeId === e.id && x.date === today);
      res.json({
        valid: e.status === "ACTIVE",
        checkedAt: new Date().toISOString(),
        company: { name: company?.name || "" },
        employee: {
          name: [e.lastName, e.firstName, e.middleName].filter(Boolean).join(" "),
          employeeNo: e.employeeNo,
          photoDataUrl: e.photoDataUrl,
          position: db.positions.find((p) => p.id === e.positionId)?.name || "",
          department: db.departments.find((d) => d.id === e.departmentId)?.name || "",
          branch: db.branches.find((b) => b.id === e.branchId)?.name || "",
          startDate: e.startDate,
          years: yearsSince(e.startDate),
          status: e.status,
        },
        today: a?.checkIn ? { checkIn: a.checkIn, checkOut: a.checkOut } : null,
      });
    }),
  );
  return router;
}

/* ================================================================ panel === */
export function createBadgeRouter() {
  const router = Router();
  router.get(
    "/badge/verify",
    route(async (req, res) => {
      const payload = readBadge(String(req.query.token || ""));
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
        url: `${publicOrigin()}/id/${token}`,
        qr: await QRCode.toDataURL(`${publicOrigin()}/id/${token}`, { margin: 1, width: 360, errorCorrectionLevel: "M" }),
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
