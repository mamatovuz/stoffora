import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { checkLoginInput, passwordProblem } from "../lib/staff-login";
import { credentialOfEmployee, isLoginTaken, normalizeLogin, setEmployeeCredential, splitName, suggestFreeLogin } from "../lib/staff-credentials";
import type { Database, Employee } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";
import { managerAgent, managerUserOf } from "./mobile";

/*
 * Ilovaga kirish (login + parol) — xodim va panel tomoni.
 *
 *   Mini App / mobil ilova (xodim):  GET/POST /mini/account — login bir marta tanlanadi, parol o‘rnatiladi/almashtiriladi.
 *     Telegram Mini App’dan joriy parol so‘ralmaydi (Telegram egasi — isbot; bu «parolni unutdim» ham).
 *     Mobil ilovadan parolni almashtirishda joriy parol majburiy.
 *   Panel (direktor/rahbar):         GET/POST /auth/mobile-login — mobil ilova logini (bir marta); parol — panel paroli.
 *
 * Parol xeshi faqat staffCredentials’da (bcrypt, 12); javoblarda faqat login qaytadi.
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number, code?: string) => Object.assign(new Error(message), { status, code });
const employeeSessionOf = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
const nameOf = (e: Pick<Employee, "firstName" | "lastName">) => `${e.firstName} ${e.lastName}`.trim();

function ownEmployee(db: Database, auth: EmployeeSession) {
  const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId);
  if (!employee || employee.status !== "ACTIVE") throw httpError("Xodim profili faol emas. HR bilan bog‘laning.", 403, "EMPLOYEE_INACTIVE");
  return employee;
}
/** Xodimning o‘zgarmas logini (bor bo‘lsa). */
const fixedLogin = (db: Database, employee: Employee) => credentialOfEmployee(db, employee.id)?.login || (employee.login ? normalizeLogin(employee.login) : undefined);

/* ============================================ Mini App / mobil (xodim) === */
export function createMiniAccountRouter() {
  const router = Router();
  const limit = rateLimit({
    windowMs: 15 * 60_000,
    limit: Number(process.env.MINI_ACCOUNT_RATE_LIMIT) || 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `macc:${employeeSessionOf(req)?.employeeId || req.ip}`,
    message: { code: "RATE_LIMITED", message: "Juda ko‘p urinish. 15 daqiqadan keyin qayta urinib ko‘ring." },
  });

  router.get(
    "/mini/account",
    route(async (req, res) => {
      const auth = employeeSessionOf(req);
      const db = await readDb();
      const employee = ownEmployee(db, auth);
      const login = fixedLogin(db, employee);
      res.json({
        login: login || null,
        suggested: login || suggestFreeLogin(db, employee.firstName, employee.lastName, { employeeId: employee.id }),
        hasPassword: Boolean(credentialOfEmployee(db, employee.id)),
      });
    }),
  );

  router.post(
    "/mini/account",
    limit,
    route(async (req, res) => {
      const auth = employeeSessionOf(req);
      const input = z
        .object({ login: z.string().max(120).optional(), password: z.string().max(200), currentPassword: z.string().max(200).optional() })
        .parse(req.body || {});
      const db = await readDb();
      const employee = ownEmployee(db, auth);
      const credential = credentialOfEmployee(db, employee.id);
      const fixed = fixedLogin(db, employee);
      let login: string;
      if (fixed) {
        // Login bir marta beriladi — boshqasiga almashtirib bo‘lmaydi.
        if (input.login?.trim()) {
          const asked = checkLoginInput(input.login);
          if (!asked.ok || asked.login !== fixed) throw httpError(`Login o‘zgarmaydi: ${fixed}`, 409, "LOGIN_FIXED");
        }
        login = fixed;
      } else {
        const check = checkLoginInput(input.login || "");
        if (!check.ok) throw httpError(check.error, 400, "LOGIN_INVALID");
        if (isLoginTaken(db, check.login, { employeeId: employee.id })) throw httpError(`«${check.login}» band. Boshqa login tanlang.`, 409, "LOGIN_TAKEN");
        login = check.login;
      }
      // Mobil ilovadan parolni almashtirish — joriy parol bilan (telefon qo‘lga tushsa ham parol o‘zgarmasin).
      if (auth.mdid && credential) {
        const ok = input.currentPassword ? await bcrypt.compare(input.currentPassword, credential.passwordHash) : false;
        if (!ok) throw httpError("Joriy parol noto‘g‘ri.", 403, "PASSWORD_WRONG");
      }
      const weak = passwordProblem(input.password);
      if (weak) throw httpError(weak, 400, "PASSWORD_WEAK");
      const passwordHash = await bcrypt.hash(input.password, 12);
      const out = await updateDb((next) => {
        const fresh = ownEmployee(next, auth);
        const current = credentialOfEmployee(next, fresh.id);
        const nowFixed = fixedLogin(next, fresh);
        if (nowFixed && nowFixed !== login) throw httpError(`Login o‘zgarmaydi: ${nowFixed}`, 409, "LOGIN_FIXED");
        if (!current && isLoginTaken(next, login, { employeeId: fresh.id })) throw httpError(`«${login}» band. Boshqa login tanlang.`, 409, "LOGIN_TAKEN");
        setEmployeeCredential(next, fresh, login, passwordHash);
        const now = new Date().toISOString();
        if (current) {
          // Parol almashdi: boshqa telefon sessiyalari yopiladi (joriy sessiya qoladi).
          for (const s of next.mobileSessions) if (s.employeeId === fresh.id && !s.revokedAt && s.id !== auth.msid) Object.assign(s, { revokedAt: now, revokeReason: "Parol almashtirildi" });
          // Xodim rahbar bo‘lsa — boshqa telefonlardan /mobile/manager/session bilan ochilgan panel sessiyalari ham yopiladi.
          const manager = managerUserOf(next, fresh);
          const keep = auth.mdid ? managerAgent(auth.mdid) : undefined;
          if (manager)
            for (const s of next.panelSessions)
              if (s.userId === manager.id && !s.revokedAt && s.userAgent.startsWith(managerAgent("")) && !(keep && s.userAgent.startsWith(keep))) s.revokedAt = now;
        }
        next.auditLogs.unshift(
          audit(fresh.companyId, nameOf(fresh), current ? `Ilova paroli almashtirildi (${auth.mdid ? "mobil ilova" : "Mini App"})` : "Ilovaga kirish logini o‘rnatildi", "employee", fresh.id, undefined, { login }),
        );
        next.notifications.unshift({
          id: randomUUID(),
          companyId: fresh.companyId,
          employeeId: fresh.id,
          title: "Ilovaga kirish",
          body: current ? "Staffora ilovasi paroli almashtirildi. Siz qilmagan bo‘lsangiz — darhol HR’ga xabar bering." : `Ilovaga kirish logini: ${login}. Parolni hech kimga bermang.`,
          type: "SECURITY",
          read: false,
          createdAt: now,
        });
        return { ok: true as const, login };
      });
      res.json(out);
    }),
  );
  return router;
}

/* ========================================================= panel (rahbar) === */
export function createPanelMobileLoginRouter() {
  const router = Router();
  const userOf = (db: Database, req: Request) => {
    const session = (req as AuthedRequest).session;
    const user = session && db.users.find((u) => u.id === session.userId);
    if (!user) throw httpError("Foydalanuvchi topilmadi.", 404);
    return user;
  };

  router.get(
    "/auth/mobile-login",
    route(async (req, res) => {
      const db = await readDb();
      const user = userOf(db, req);
      const [first, last] = splitName(user.name);
      res.json({ login: user.mobileLogin || null, suggested: user.mobileLogin || suggestFreeLogin(db, first, last, { userId: user.id }) });
    }),
  );

  router.post(
    "/auth/mobile-login",
    rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { code: "RATE_LIMITED", message: "Juda ko‘p urinish. Bir daqiqadan keyin qayta urinib ko‘ring." } }),
    route(async (req, res) => {
      const session = (req as AuthedRequest).session;
      if (session?.preview) throw httpError("Ko‘rish rejimida o‘zgartirib bo‘lmaydi.", 403, "READ_ONLY_PREVIEW");
      const { login: raw } = z.object({ login: z.string().max(120) }).parse(req.body || {});
      const check = checkLoginInput(raw);
      const out = await updateDb((db) => {
        const user = userOf(db, req);
        if (user.role === "SUPER_ADMIN" || !user.companyId) throw httpError("Bu hisob uchun mobil ilova logini berilmaydi.", 403, "NOT_MANAGER");
        if (user.mobileLogin) {
          if (check.ok && check.login === normalizeLogin(user.mobileLogin)) return { login: user.mobileLogin };
          throw httpError(`Login o‘zgarmaydi: ${user.mobileLogin}`, 409, "LOGIN_FIXED");
        }
        if (!check.ok) throw httpError(check.error, 400, "LOGIN_INVALID");
        if (isLoginTaken(db, check.login, { userId: user.id })) throw httpError(`«${check.login}» band. Boshqa login tanlang.`, 409, "LOGIN_TAKEN");
        user.mobileLogin = check.login;
        db.auditLogs.unshift(audit(user.companyId, user.name, "Mobil ilova logini o‘rnatildi", "user", user.id, undefined, { login: check.login }));
        return { login: check.login };
      });
      res.json(out);
    }),
  );
  return router;
}
