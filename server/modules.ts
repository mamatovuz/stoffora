import type { NextFunction, Request, Response } from "express";
import { readDb } from "../lib/store";
import type { Database } from "../lib/types";
import { apiModule, miniModule, moduleByKey, moduleEnabled, type ModuleKey } from "../lib/modules";
import type { AuthedRequest, EmployeeSession } from "./auth";

/*
 * Modul himoyasi: super admin o‘chirgan funksiyaning API yo‘llari 403 qaytaradi —
 * panel menyusidan yashirish yetarli emas (to‘g‘ridan-to‘g‘ri so‘rov ham to‘xtashi kerak).
 */

/** Kompaniyada modul yoqilganmi (fon ishlari uchun ham). */
export function companyModuleEnabled(db: Database, companyId: string | undefined, key: ModuleKey) {
  if (!companyId) return true;
  return moduleEnabled(db.companies.find((c) => c.id === companyId)?.modules, key);
}

function blocked(res: Response, key: ModuleKey) {
  return res.status(403).json({
    code: "MODULE_DISABLED",
    module: key,
    message: `«${moduleByKey(key)?.label || key}» moduli kompaniyangiz uchun yoqilmagan. Platforma administratoriga murojaat qiling.`,
  });
}

/** Panel API (requireAuth dan keyin). Super admin cheklanmaydi. */
export function moduleGuard() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = (req as AuthedRequest).session;
    if (!session?.companyId || session.role === "SUPER_ADMIN") return next();
    const key = apiModule(req.path);
    if (!key) return next();
    try {
      const db = await readDb();
      return companyModuleEnabled(db, session.companyId, key) ? next() : blocked(res, key);
    } catch (error) {
      next(error);
    }
  };
}

/** Mini App / mobil ilova (/mini/*, requireEmployee dan keyin). */
export function miniModuleGuard() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = (req as Request & { employeeSession?: EmployeeSession }).employeeSession;
    const key = miniModule(req.originalUrl.split("?")[0].replace(/^\/api/, ""));
    if (!session?.companyId || !key) return next();
    try {
      const db = await readDb();
      return companyModuleEnabled(db, session.companyId, key) ? next() : blocked(res, key);
    } catch (error) {
      next(error);
    }
  };
}
