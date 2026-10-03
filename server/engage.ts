import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { can } from "../lib/permissions";
import { NOTIFY_CATEGORIES, type NotifyCategory } from "../lib/notify-prefs";
import type { Database, Employee } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";
import { sendTelegramMessage } from "./telegram";

/*
 * E’lonlar 2.0 va bildirishnoma sozlamalari:
 *   • e’lon statistikasi — kim o‘qidi, kim «Tanishdim» bosdi, kim qanday javob berdi (filial bo‘yicha);
 *   • o‘qimaganlar / tasdiqlamaganlarga eslatma (ilova + Telegram), soatiga bir martadan ko‘p emas;
 *   • xodim qaysi toifadagi xabarlar telefonga kelishini o‘zi tanlaydi.
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const nameOf = (e?: Employee) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
const REMIND_GAP_MS = 60 * 60_000;

function scopeOf(db: Database, req: Request) {
  const s = (req as AuthedRequest).session!;
  return s.role === "BRANCH_MANAGER" ? new Set(db.users.find((u) => u.id === s.userId)?.branchIds || []) : null;
}

export function announcementStats(db: Database, companyId: string, id: string, scope: Set<string> | null) {
  const a = db.announcements.find((x) => x.id === id && x.companyId === companyId);
  if (!a) throw httpError("E’lon topilmadi.", 404);
  const rows = db.notifications
    .filter((n) => n.announcementId === id && n.employeeId)
    .map((n) => {
      const e = db.employees.find((x) => x.id === n.employeeId);
      return {
        employeeId: n.employeeId!,
        name: nameOf(e),
        branchId: e?.branchId || "",
        branch: db.branches.find((b) => b.id === e?.branchId)?.name || "",
        photoDataUrl: e?.photoDataUrl,
        read: n.read || Boolean(n.ackAt),
        readAt: n.readAt || n.ackAt,
        ackAt: n.ackAt,
        answer: n.answer,
      };
    })
    .filter((r) => !scope || scope.has(r.branchId));
  const answers: Record<string, number> = Object.fromEntries((a.options || []).map((o) => [o, 0]));
  for (const r of rows) if (r.answer) answers[r.answer] = (answers[r.answer] || 0) + 1;
  const byBranch = new Map<string, { branch: string; total: number; read: number; acked: number }>();
  for (const r of rows) {
    const b = byBranch.get(r.branchId) || { branch: r.branch, total: 0, read: 0, acked: 0 };
    b.total += 1;
    if (r.read) b.read += 1;
    if (r.ackAt) b.acked += 1;
    byBranch.set(r.branchId, b);
  }
  return {
    announcement: { id: a.id, title: a.title, message: a.message, audience: a.audience, createdBy: a.createdBy, scheduledAt: a.scheduledAt, ackRequired: Boolean(a.ackRequired), options: a.options, remindedAt: a.remindedAt },
    totals: { recipients: rows.length, read: rows.filter((r) => r.read).length, acked: rows.filter((r) => r.ackAt).length, answered: rows.filter((r) => r.answer).length },
    answers,
    branches: [...byBranch.values()].sort((x, y) => x.branch.localeCompare(y.branch)),
    rows: rows.sort((x, y) => Number(x.read) - Number(y.read) || x.name.localeCompare(y.name)),
  };
}

export function createEngageRouter() {
  const router = Router();
  const permit = (permission: string) => (req: Request, res: Response, next: NextFunction) =>
    can((req as AuthedRequest).session!.role, permission) || (req as AuthedRequest).session!.role === "BRANCH_MANAGER"
      ? next()
      : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });

  router.get(
    "/announcements/:id/stats",
    permit("announcements.view"),
    route(async (req, res) => {
      const db = await readDb();
      res.json(announcementStats(db, (req as AuthedRequest).session!.companyId!, String(req.params.id), scopeOf(db, req)));
    }),
  );

  router.post(
    "/announcements/:id/remind",
    permit("announcements.create"),
    route(async (req, res) => {
      const { who } = z.object({ who: z.enum(["unread", "unacked", "unanswered"]).default("unread") }).parse(req.body);
      const session = (req as AuthedRequest).session!;
      const result = await updateDb((db) => {
        const a = db.announcements.find((x) => x.id === req.params.id && x.companyId === session.companyId);
        if (!a) throw httpError("E’lon topilmadi.", 404);
        if (a.remindedAt && Date.now() - Date.parse(a.remindedAt) < REMIND_GAP_MS) throw httpError("Eslatma yaqinda yuborilgan — 1 soatdan keyin qayta yuboring.", 429);
        const scope = scopeOf(db, req);
        const now = new Date().toISOString();
        const targets = db.notifications.filter((n) => {
          if (n.announcementId !== a.id || !n.employeeId) return false;
          const e = db.employees.find((x) => x.id === n.employeeId && x.status === "ACTIVE");
          if (!e || (scope && !scope.has(e.branchId))) return false;
          return who === "unread" ? !n.read && !n.ackAt : who === "unacked" ? !n.ackAt : !n.answer;
        });
        // Eslatma: o‘sha bildirishnoma «yangi» bo‘lib qaytadi (ro‘yxat tepasida, push qayta ketadi).
        for (const n of targets) {
          n.read = false;
          n.createdAt = now;
          n.pushedAt = undefined;
          n.reminded = (n.reminded || 0) + 1;
        }
        a.remindedAt = now;
        db.auditLogs.unshift(audit(a.companyId, session.name, `E’lon eslatmasi: «${a.title}» — ${targets.length} xodim (${who})`, "announcement", a.id));
        const telegram = targets
          .map((n) => db.employees.find((e) => e.id === n.employeeId))
          .filter((e): e is Employee => Boolean(e?.telegramConnected && e.telegramId && !e.telegramId.startsWith("dev")))
          .map((e) => e.telegramId!);
        return { count: targets.length, telegram, title: a.title, ack: Boolean(a.ackRequired), poll: Boolean(a.options?.length) };
      });
      await Promise.allSettled(
        result.telegram.map((id) =>
          sendTelegramMessage(id, `🔔 Eslatma: <b>${result.title}</b>\n\n${result.poll ? "So‘rovnomaga javob bering." : result.ack ? "E’lon bilan tanishib, «Tanishdim» tugmasini bosing." : "E’lonni o‘qib chiqing."}`, {
            go: "notifs",
            buttonText: result.poll ? "🗳 Javob berish" : result.ack ? "✅ Tanishdim" : "📢 O‘qish",
          }),
        ),
      );
      res.json({ reminded: result.count });
    }),
  );
  return router;
}

/** Xodim: qaysi toifadagi xabarlar telefonga (push / Telegram) kelsin. */
export function createMiniEngageRouter() {
  const router = Router();
  const me = (db: Database, req: Request) => {
    const s = (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
    const e = db.employees.find((x) => x.id === s.employeeId && x.companyId === s.companyId);
    if (!e) throw httpError("Xodim topilmadi.", 404);
    return e;
  };
  router.get(
    "/mini/notify-prefs",
    route(async (req, res) => {
      const db = await readDb();
      const e = me(db, req);
      res.json({
        categories: Object.entries(NOTIFY_CATEGORIES).map(([key, label]) => ({ key, label, enabled: e.notifyPrefs?.[key as NotifyCategory] !== false })),
        note: "O‘chirilgan toifa ilovadagi ro‘yxatda qoladi, faqat telefonga xabar kelmaydi. Xavfsizlik va majburiy tasdiqli e’lonlar har doim keladi.",
      });
    }),
  );
  router.put(
    "/mini/notify-prefs",
    route(async (req, res) => {
      const keys = Object.keys(NOTIFY_CATEGORIES) as [NotifyCategory, ...NotifyCategory[]];
      const input = z.record(z.enum(keys), z.boolean()).parse(req.body);
      const prefs = await updateDb((db) => {
        const e = me(db, req);
        e.notifyPrefs = { ...(e.notifyPrefs || {}), ...input };
        e.updatedAt = new Date().toISOString();
        return e.notifyPrefs;
      });
      res.json({ ok: true, prefs });
    }),
  );
  return router;
}

/** Hujjat ochilganda — kim, qachon, qaysi hujjatni ko‘rgani auditga (HR / rahbar / xodimning o‘zi). */
export function auditDocumentAccess(db: Database, input: { companyId: string; actor: string; documentId: string; employeeId: string; title: string; via: string }) {
  const owner = db.employees.find((e) => e.id === input.employeeId);
  db.auditLogs.unshift(audit(input.companyId, input.actor, `Hujjat ko‘rildi: ${input.title} (${nameOf(owner)}) — ${input.via}`, "employee", input.employeeId, undefined, { documentId: input.documentId }));
}

export const newId = () => randomUUID();
