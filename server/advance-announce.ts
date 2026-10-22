import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { tashkentIsoDate } from "../lib/format";
import { advanceWindow } from "../lib/payroll";
import { companyModuleEnabled } from "./modules";
import type { Announcement, Database, Employee } from "../lib/types";
import type { AuthedRequest } from "./auth";
import { notifyEmployee } from "./integrations/hooks";
import { closedPeriod, monthLabel } from "./payroll-routes";
import { advanceLimit, isAdvanceFinance, isAdvanceHr } from "./advances";

/*
 * «Avans oluvchilar ro‘yxati» e’loni: HR / moliya bir bosishda (yoki tizim avans oynasi ochilgan kuni
 * soat 09:00 da o‘zi) xodimlarga yuboradi:
 *   • ilovada E’lon bo‘lib (Xabarnomalar, bosh sahifa) — ochilsa «Avans so‘rash» tugmasi;
 *   • Telegram’da (yoki xodimlar botida) — «💰 Avans so‘rash» tugmasi Mini App’ni avans formasida ochadi;
 *   • mobil ilovaga push — bosilsa «Mening oyligim» ekrani avans formasi bilan ochiladi.
 * Faqat oyligi kiritilgan va shu oy hali avans so‘ramagan faol xodimlarga boradi.
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ACTIVE_REQUEST = new Set(["PENDING", "HR_APPROVED", "APPROVED"]);
/** Ikki marta bosilsa ikki xabar ketmasin. */
const RESEND_GUARD_MS = 2 * 60_000;

/** Kimga yuboriladi: faol, oyligi kiritilgan va shu oy hali avans so‘ramagan (yoki so‘rovi rad etilgan) xodimlar. */
export function advanceAudience(db: Database, companyId: string, month: string) {
  const busy = new Set(db.advanceRequests.filter((a) => a.companyId === companyId && a.month === month && ACTIVE_REQUEST.has(a.status)).map((a) => a.employeeId));
  const eligible = db.employees.filter((e) => e.companyId === companyId && e.status === "ACTIVE" && e.baseSalary > 0);
  return { recipients: eligible.filter((e) => !busy.has(e.id)), requested: eligible.filter((e) => busy.has(e.id)).length };
}

/** Yuborib bo‘lmasligi sababi (bo‘lsa). */
export function advanceBlocker(db: Database, companyId: string, month: string) {
  const company = db.companies.find((c) => c.id === companyId);
  if (!company) return "Kompaniya topilmadi.";
  if (!companyModuleEnabled(db, companyId, "advances")) return "Avanslar moduli o‘chirilgan.";
  if (company.payroll?.advanceRequestsEnabled === false) return "Sozlamalarda xodimlarning avans so‘rashi o‘chirilgan.";
  if (closedPeriod(db, companyId, month)) return "Bu oy yopilgan — avans so‘rab bo‘lmaydi.";
  return undefined;
}

/** Standart matn (HR yuborishdan oldin o‘zgartirishi mumkin). */
export function advanceDraft(db: Database, companyId: string, month: string, today = tashkentIsoDate()) {
  const company = db.companies.find((c) => c.id === companyId);
  const name = monthLabel(month).split(" ")[0];
  const window = advanceWindow(company?.payroll, today);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = Math.min(window.from, last);
  const to = Math.min(window.to, last);
  const when = window.always ? "" : from === to ? `So‘rovlar ${from}-${name} kuni qabul qilinadi. ` : `So‘rovlar ${from}–${to}-${name} kunlari qabul qilinadi. `;
  return {
    title: `${name[0].toUpperCase()}${name.slice(1)} oyi uchun avans`,
    message: `Biz ${name} oyi uchun avans oluvchilar ro‘yxatini shakllantiryapmiz. Siz ham avans oluvchilar ro‘yxatida bormisiz?\n\n${when}«Avans so‘rash» tugmasini bosing va kerakli summani kiriting.`,
  };
}

export async function sendAdvanceAnnouncement(input: { companyId: string; month: string; title: string; message: string; actor: string; auto?: boolean; today?: string }) {
  const today = input.today || tashkentIsoDate();
  const created = await updateDb((db) => {
    const blocker = advanceBlocker(db, input.companyId, input.month);
    if (blocker) throw httpError(blocker, 422);
    const recent = db.announcements.find((a) => a.companyId === input.companyId && a.kind === "ADVANCE" && Date.now() - Date.parse(a.scheduledAt) < RESEND_GUARD_MS);
    if (recent) throw httpError("Avans xabari hozirgina yuborildi — bir necha daqiqadan keyin qayta urinib ko‘ring.", 409);
    const { recipients } = advanceAudience(db, input.companyId, input.month);
    if (!recipients.length) throw httpError("Xabar yuboriladigan xodim yo‘q: hammasi avans so‘ragan yoki oyligi kiritilmagan.", 422);
    const now = new Date().toISOString();
    const announcement: Announcement = {
      id: randomUUID(),
      companyId: input.companyId,
      title: input.title,
      message: input.message,
      audience: `Avans oluvchilar ro‘yxati · ${recipients.length} xodim`,
      channel: ["STAFFORA", "TELEGRAM"],
      target: { type: "EMPLOYEES", ids: recipients.map((e) => e.id) },
      createdBy: input.actor,
      scheduledAt: now,
      status: "SENT",
      kind: "ADVANCE",
      month: input.month,
      auto: input.auto || undefined,
      report: { staffora: { recipients: recipients.length, delivered: recipients.length } },
    };
    // Har bir xodimga — o‘z chegarasi bilan (qancha so‘rash mumkinligini darhol ko‘radi).
    const extra = new Map<string, string>();
    for (const employee of recipients) {
      const limit = advanceLimit(db, employee, input.month, today);
      const note = limit.available >= 10_000 ? `\n\nSizning chegarangiz: ${som(limit.available)}.` : "";
      extra.set(employee.id, note);
      db.notifications.unshift({
        id: randomUUID(),
        companyId: input.companyId,
        employeeId: employee.id,
        title: `📢 ${input.title}`,
        body: `${input.message}${note}`,
        type: "ANNOUNCEMENT",
        read: false,
        createdAt: now,
        announcementId: announcement.id,
        go: "advance",
      });
    }
    db.announcements.unshift(announcement);
    db.auditLogs.unshift(
      audit(input.companyId, input.actor, `Avans e’loni yuborildi: ${input.title}`, "announcement", announcement.id, undefined, { recipients: recipients.length, auto: Boolean(input.auto) }),
    );
    return { announcement, recipients: recipients.map((e) => ({ ...e })) as Employee[], extra };
  });
  // Telegram / xodimlar boti — tugma Mini App’ni avans formasida ochadi. Ilovaga push — dispetcher (go: advance).
  const db = await readDb();
  const results = await Promise.allSettled(
    created.recipients.map((employee) =>
      notifyEmployee(db, employee, "payroll", `📢 <b>${esc(input.title)}</b>\n\n${esc(input.message)}${esc(created.extra.get(employee.id) || "")}`, { title: input.title, go: "advance" }),
    ),
  );
  const delivered = results.filter((r) => r.status === "fulfilled" && r.value.length > 0).length;
  await updateDb((next) => {
    const row = next.announcements.find((a) => a.id === created.announcement.id);
    if (row) row.report = { ...(row.report || {}), telegram: { recipients: created.recipients.length, delivered, failed: created.recipients.length - delivered } };
  });
  return { id: created.announcement.id, recipients: created.recipients.length, telegram: delivered };
}

/**
 * Avtomatik: avans oynasi (masalan 20–25) ochilgan kuni soat 09:00 dan keyin bir marta.
 * Server o‘sha kuni ishlamagan bo‘lsa — oyna ochiq turgan keyingi kunda. Oyna ochilgandan keyin
 * qo‘lda yuborilgan bo‘lsa — takrorlanmaydi. «Oy davomida» (1–31) rejimida avtomatik yuborilmaydi.
 */
export async function runAdvanceAnnouncements(today = tashkentIsoDate()) {
  const db = await readDb();
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let sent = 0;
  for (const company of db.companies) {
    if (company.status === "SUSPENDED" || !company.payroll || company.payroll.advanceAnnounce === false) continue;
    const window = advanceWindow(company.payroll, today);
    if (window.always || !window.open || advanceBlocker(db, company.id, month)) continue;
    const opened = `${month}-${String(Math.min(window.from, last)).padStart(2, "0")}`;
    if (db.announcements.some((a) => a.companyId === company.id && a.kind === "ADVANCE" && a.month === month && tashkentIsoDate(a.scheduledAt) >= opened)) continue;
    if (!advanceAudience(db, company.id, month).recipients.length) continue;
    const draft = advanceDraft(db, company.id, month, today);
    try {
      await sendAdvanceAnnouncement({ companyId: company.id, month, ...draft, actor: "Staffora (avtomatik)", auto: true, today });
      sent += 1;
    } catch (error) {
      console.error("Avans e’loni yuborilmadi", company.id, (error as Error).message);
    }
  }
  return sent;
}

export function createAdvanceAnnounceRouter() {
  const router = Router();
  const permit = (req: Request, res: Response, next: NextFunction) => {
    const role = (req as AuthedRequest).session!.role;
    return isAdvanceFinance(role) || isAdvanceHr(role) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  };

  /** Yuborishdan oldin: kimga ketadi, standart matn, oyna va oxirgi yuborilgan e’lon. */
  router.get(
    "/payroll/advances/announce",
    permit,
    route(async (req, res) => {
      const tenant = (req as AuthedRequest).session!.companyId!;
      const db = await readDb();
      const today = tashkentIsoDate();
      const month = today.slice(0, 7);
      const company = db.companies.find((c) => c.id === tenant);
      const { recipients, requested } = advanceAudience(db, tenant, month);
      const last = db.announcements.find((a) => a.companyId === tenant && a.kind === "ADVANCE" && a.month === month);
      res.json({
        month,
        label: monthLabel(month),
        ...advanceDraft(db, tenant, month, today),
        recipients: recipients.length,
        withTelegram: recipients.filter((e) => e.telegramConnected && e.telegramId && !e.telegramId.startsWith("dev")).length,
        requested,
        window: advanceWindow(company?.payroll, today),
        auto: company?.payroll?.advanceAnnounce !== false,
        blocker: advanceBlocker(db, tenant, month),
        last: last ? { at: last.scheduledAt, by: last.createdBy, recipients: last.report?.staffora?.recipients || 0, auto: Boolean(last.auto) } : null,
      });
    }),
  );

  router.post(
    "/payroll/advances/announce",
    permit,
    rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false }),
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const input = z
        .object({
          title: z.string().trim().min(3, "Sarlavha juda qisqa.").max(120),
          message: z.string().trim().min(10, "Matn juda qisqa.").max(1500),
        })
        .parse(req.body);
      const result = await sendAdvanceAnnouncement({ companyId: auth.session!.companyId!, month: tashkentIsoDate().slice(0, 7), ...input, actor: auth.session!.name });
      res.status(201).json(result);
    }),
  );
  return router;
}
