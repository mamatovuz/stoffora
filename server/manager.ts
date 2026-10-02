import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { syncStaffRoles } from "../lib/staff-roles";
import type { PanelSession } from "../lib/types";
import { signSession, type Session } from "./auth";
import { verifyTelegramInitData } from "./telegram";
import { companyBotTokens } from "./company-bots";

/*
 * Rahbar rejimi (Mini App ichida). Panel hisobi Staffora botiga ulangan rahbar
 * (egasi, HR, filial rahbari, moliya) Mini App’ni ochganda Telegram imzosi
 * tekshiriladi va unga panel sessiyasi beriladi. Sessiya «Kirgan qurilmalar»
 * ro‘yxatida «Telegram Mini App» bo‘lib ko‘rinadi va u yerdan bekor qilinadi.
 * Rahbar Mini App’da panelning o‘zi ishlatadigan API’larni chaqiradi — huquqlar,
 * filial chegarasi va audit xuddi paneldagidek ishlaydi.
 */

const MANAGER_ROLES = new Set(["COMPANY_OWNER", "HR_ADMIN", "HR_MANAGER", "BRANCH_MANAGER", "FINANCE"]);

export function createManagerAuthRouter() {
  const router = Router();
  router.post(
    "/telegram/manager-auth",
    rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }),
    (req: Request, res: Response, next: NextFunction) =>
      Promise.resolve(
        (async () => {
          const { initData } = z.object({ initData: z.string().max(8192) }).parse(req.body);
          const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
          const devMode = process.env.TELEGRAM_DEV_MODE === "true" && process.env.NODE_ENV !== "production";
          let telegramId: string | undefined;
          let botCompanyId: string | undefined;
          if (devMode && !initData) telegramId = process.env.TELEGRAM_DEV_MANAGER_ID || undefined;
          else if (initData) {
            // Mini App asosiy Staffora botidan yoki kompaniyaning o‘z botidan ochilgan bo‘lishi mumkin —
            // Telegram ID ikkalasida ham bir xil, imzo esa qaysi botniki bo‘lsa, o‘sha token bilan tekshiriladi.
            const tokens = [...(token ? [{ companyId: undefined, token }] : []), ...companyBotTokens()];
            for (const candidate of tokens) {
              try {
                telegramId = String(verifyTelegramInitData(initData, candidate.token).id);
                botCompanyId = candidate.companyId;
                break;
              } catch {
                telegramId = undefined;
              }
            }
          }
          if (!telegramId) return res.status(204).end();
          // Lavozim/filial orqali berilgan huquqlar — shu Telegram egasi xodim bo‘lgan kompaniyalarda moslanadi.
          const before = await readDb();
          const companies = [...new Set(before.employees.filter((e) => e.telegramId === telegramId && e.status === "ACTIVE").map((e) => e.companyId))];
          if (companies.length) await updateDb((next) => void companies.forEach((id) => syncStaffRoles(next, id)));
          const db = await readDb();
          // Kompaniya boti orqali kirilgan bo‘lsa — faqat shu kompaniyaning rahbari.
          const user = db.users.find(
            (u) => u.telegramId === telegramId && u.companyId && MANAGER_ROLES.has(u.role) && (!botCompanyId || u.companyId === botCompanyId),
          );
          const company = user && db.companies.find((c) => c.id === user.companyId);
          // Rahbar emas — jim qaytamiz, Mini App oddiy xodim rejimida qoladi.
          if (!user || !company || company.status === "SUSPENDED") return res.status(204).end();
          const now = new Date().toISOString();
          const device: PanelSession = {
            id: randomUUID(),
            userId: user.id,
            userAgent: `Telegram Mini App · ${String(req.headers["user-agent"] || "").slice(0, 200)}`,
            ip: String(req.ip || "").replace(/^::ffff:/, ""),
            createdAt: now,
            lastSeenAt: now,
          };
          await updateDb((next) => {
            // Shu foydalanuvchining eski Mini App sessiyalarini yopamiz — ro‘yxat to‘lib ketmasin.
            for (const s of next.panelSessions)
              if (s.userId === user.id && !s.revokedAt && s.userAgent.startsWith("Telegram Mini App")) s.revokedAt = now;
            next.panelSessions.push(device);
            next.auditLogs.unshift(audit(user.companyId!, user.name, "Rahbar Mini App orqali kirdi", "user", user.id));
          });
          const session: Session = {
            sid: device.id,
            userId: user.id,
            companyId: user.companyId,
            name: user.name,
            email: user.email,
            role: user.role,
          };
          res.json({
            token: signSession(session),
            user: { id: user.id, name: user.name, role: user.role, branchIds: user.branchIds || [], photoDataUrl: user.photoDataUrl },
            company: { id: company.id, name: company.name },
          });
        })(),
      ).catch(next),
  );
  return router;
}
