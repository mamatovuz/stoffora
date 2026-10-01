import { createHash, randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { audit, dataIndexes, readDb, updateDb } from "../lib/store";
import { can, canAny } from "../lib/permissions";
import { tashkentIsoDate } from "../lib/format";
import { dayPlan } from "../lib/schedule";
import { attendanceStreak, type StreakDay } from "../lib/mini";
import { detectTrends, type TrendAlert, type TrendDay } from "../lib/trends";
import type { Announcement, CertificateRequest, Database, Employee, Ticket } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";
import { notifyEmployee } from "./integrations/hooks";
import { documentInputSchema, documentStatus, saveDocument } from "./documents";
import { sendTelegramMessage } from "./telegram";

/*
 * Xodim ↔ HR aloqasi va rahbar vositalari:
 *   - «HR’ga savol» (yozishma), anonim taklif/shikoyat
 *   - ma’lumotnoma (spravka) so‘rovi → HR fayl yuklaydi → xodim Mini App’dan oladi
 *   - tug‘ilgan kunlar lentasi va tabriklash
 *   - rahbar uchun: xodim kartasi, muammoli trendlar, filialga tezkor e’lon
 */

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const sessionOf = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
const nameOf = (e?: Pick<Employee, "firstName" | "lastName">) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ownerSecret = () => `${process.env.JWT_SECRET || process.env.SESSION_SECRET || "staffora-local"}:ticket-owner`;
/** Anonim murojaat egasi: HR ko‘rmaydigan, faqat server hisoblaydigan xesh. */
const ownerHashOf = (employeeId: string) => createHash("sha256").update(`${ownerSecret()}:${employeeId}`).digest("hex");

export const TICKET_CATEGORIES: Record<string, string> = {
  SALARY: "Ish haqi",
  SCHEDULE: "Grafik va davomat",
  LEAVE: "Ta’til",
  DOCUMENTS: "Hujjatlar",
  CONDITIONS: "Ish sharoiti",
  TEAM: "Jamoa va munosabatlar",
  IDEA: "Taklif / g‘oya",
  OTHER: "Boshqa",
};
export const CERTIFICATE_TYPES: Record<CertificateRequest["type"], string> = {
  WORK: "Ish joyidan ma’lumotnoma",
  SALARY: "Ish haqi haqida ma’lumotnoma",
  NDFL: "Daromad solig‘i (2-NDFL) ma’lumotnomasi",
  VISA: "Viza / elchixona uchun",
  OTHER: "Boshqa ma’lumotnoma",
};

function ownEmployee(db: Database, auth: EmployeeSession) {
  const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId && e.status === "ACTIVE");
  if (!employee) throw httpError("Xodim profili faol emas.", 403);
  return employee;
}
const ownsTicket = (ticket: Ticket, employeeId: string) => (ticket.anonymous ? ticket.ownerHash === ownerHashOf(employeeId) : ticket.employeeId === employeeId);
/** Xodimga ko‘rinadigan ko‘rinish (ichki maydonlarsiz). */
const ticketForEmployee = (t: Ticket) => ({
  id: t.id,
  kind: t.kind,
  anonymous: t.anonymous,
  category: t.category,
  subject: t.subject,
  status: t.status,
  messages: t.messages,
  unread: t.unreadEmployee,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

/** HR’ga (panel bildirishnomasi) va Telegram ulangan HR rahbarlariga xabar. */
async function alertHr(companyId: string, title: string, body: string, telegram: string) {
  await updateDb((db) =>
    void db.notifications.unshift({ id: randomUUID(), companyId, title, body, type: "HELPDESK", read: false, createdAt: new Date().toISOString() }),
  );
  const db = await readDb();
  const hr = db.users.filter((u) => u.companyId === companyId && u.telegramId && ["COMPANY_OWNER", "HR_ADMIN", "HR_MANAGER"].includes(u.role));
  await Promise.allSettled(hr.map((u) => sendTelegramMessage(u.telegramId!, telegram, { buttonText: "📨 Panelda ochish" })));
}

/* ======================================================= Mini App (xodim) === */
export function createMiniHelpdeskRouter() {
  const router = Router();
  const limit = (n: number) =>
    rateLimit({
      windowMs: 60_000,
      limit: n,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => `hd:${sessionOf(req)?.employeeId || req.ip}`,
      message: { message: "Juda ko‘p so‘rov. Birozdan keyin qayta urinib ko‘ring." },
    });

  /* --------------------------------------------- savollar va murojaatlar --- */
  router.get(
    "/mini/tickets",
    route(async (req, res) => {
      const auth = sessionOf(req);
      const db = await readDb();
      ownEmployee(db, auth);
      res.json({
        categories: TICKET_CATEGORIES,
        items: db.tickets
          .filter((t) => t.companyId === auth.companyId && ownsTicket(t, auth.employeeId))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 50)
          .map(ticketForEmployee),
      });
    }),
  );

  router.post(
    "/mini/tickets",
    limit(6),
    route(async (req, res) => {
      const auth = sessionOf(req);
      const input = z
        .object({
          kind: z.enum(["QUESTION", "FEEDBACK"]),
          anonymous: z.boolean().default(false),
          category: z.enum(Object.keys(TICKET_CATEGORIES) as [string, ...string[]]),
          subject: z.string().trim().min(3, "Mavzuni yozing.").max(120),
          text: z.string().trim().min(5, "Xabarni batafsilroq yozing.").max(2000),
        })
        .parse(req.body);
      // Savol (javob kerak) har doim ism bilan; anonimlik faqat taklif/shikoyatda.
      const anonymous = input.kind === "FEEDBACK" && input.anonymous;
      const created = await updateDb((db) => {
        const employee = ownEmployee(db, auth);
        const now = new Date().toISOString();
        const ticket: Ticket = {
          id: randomUUID(),
          companyId: employee.companyId,
          employeeId: anonymous ? undefined : employee.id,
          ownerHash: anonymous ? ownerHashOf(employee.id) : undefined,
          kind: input.kind,
          anonymous,
          category: input.category,
          subject: input.subject,
          branchId: anonymous ? undefined : employee.branchId,
          status: "OPEN",
          messages: [{ id: randomUUID(), from: "EMPLOYEE", author: anonymous ? undefined : nameOf(employee), text: input.text, at: now }],
          unreadEmployee: false,
          unreadHr: true,
          createdAt: now,
          updatedAt: now,
        };
        db.tickets.unshift(ticket);
        // Anonim murojaat auditga ham ismsiz yoziladi.
        db.auditLogs.unshift(audit(employee.companyId, anonymous ? "Anonim xodim" : nameOf(employee), `${input.kind === "QUESTION" ? "HR’ga savol" : "Taklif/shikoyat"}: ${input.subject}`, "ticket", ticket.id));
        return { ticket, employee };
      });
      const who = anonymous ? "Anonim xodim" : nameOf(created.employee);
      const label = input.kind === "QUESTION" ? "Yangi savol" : anonymous ? "Anonim taklif/shikoyat" : "Taklif/shikoyat";
      void alertHr(
        created.ticket.companyId,
        label,
        `${who}: ${input.subject}`,
        `📨 <b>${label}</b>\n${esc(who)} · ${esc(TICKET_CATEGORIES[input.category])}\n\n<b>${esc(input.subject)}</b>\n${esc(input.text.slice(0, 600))}`,
      ).catch(() => undefined);
      res.status(201).json(ticketForEmployee(created.ticket));
    }),
  );

  router.post(
    "/mini/tickets/:id/messages",
    limit(15),
    route(async (req, res) => {
      const auth = sessionOf(req);
      const { text } = z.object({ text: z.string().trim().min(1).max(2000) }).parse(req.body);
      const ticket = await updateDb((db) => {
        const employee = ownEmployee(db, auth);
        const row = db.tickets.find((t) => t.id === req.params.id && t.companyId === auth.companyId && ownsTicket(t, auth.employeeId));
        if (!row) throw httpError("Murojaat topilmadi.", 404);
        if (row.status === "CLOSED") throw httpError("Murojaat yopilgan — yangisini yozing.", 409);
        const now = new Date().toISOString();
        row.messages.push({ id: randomUUID(), from: "EMPLOYEE", author: row.anonymous ? undefined : nameOf(employee), text, at: now });
        row.status = "OPEN";
        row.unreadHr = true;
        row.unreadEmployee = false;
        row.updatedAt = now;
        return { ...row };
      });
      void alertHr(ticket.companyId, "Murojaatga yangi xabar", ticket.subject, `💬 <b>${esc(ticket.subject)}</b>\n${esc(text.slice(0, 600))}`).catch(() => undefined);
      res.json(ticketForEmployee(ticket));
    }),
  );

  router.post(
    "/mini/tickets/:id/read",
    route(async (req, res) => {
      const auth = sessionOf(req);
      await updateDb((db) => {
        const row = db.tickets.find((t) => t.id === req.params.id && t.companyId === auth.companyId && ownsTicket(t, auth.employeeId));
        if (row) row.unreadEmployee = false;
      });
      res.json({ ok: true });
    }),
  );

  router.post(
    "/mini/tickets/:id/close",
    route(async (req, res) => {
      const auth = sessionOf(req);
      await updateDb((db) => {
        const row = db.tickets.find((t) => t.id === req.params.id && t.companyId === auth.companyId && ownsTicket(t, auth.employeeId));
        if (!row) throw httpError("Murojaat topilmadi.", 404);
        row.status = "CLOSED";
        row.updatedAt = new Date().toISOString();
      });
      res.json({ ok: true });
    }),
  );

  /* ----------------------------------------------------- ma’lumotnoma --- */
  router.get(
    "/mini/certificates",
    route(async (req, res) => {
      const auth = sessionOf(req);
      const db = await readDb();
      ownEmployee(db, auth);
      res.json({
        types: CERTIFICATE_TYPES,
        items: db.certificateRequests
          .filter((c) => c.companyId === auth.companyId && c.employeeId === auth.employeeId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 30),
      });
    }),
  );

  router.post(
    "/mini/certificates",
    limit(5),
    route(async (req, res) => {
      const auth = sessionOf(req);
      const input = z
        .object({
          type: z.enum(["WORK", "SALARY", "NDFL", "VISA", "OTHER"]),
          purpose: z.string().trim().min(3, "Qayerga kerakligini yozing.").max(200),
          note: z.string().trim().max(300).optional(),
        })
        .parse(req.body);
      const created = await updateDb((db) => {
        const employee = ownEmployee(db, auth);
        const open = db.certificateRequests.filter((c) => c.employeeId === employee.id && c.status === "PENDING");
        if (open.length >= 3) throw httpError("Sizda 3 ta ko‘rib chiqilayotgan so‘rov bor — tayyor bo‘lishini kuting.", 409);
        const now = new Date().toISOString();
        const row: CertificateRequest = { id: randomUUID(), companyId: employee.companyId, employeeId: employee.id, ...input, status: "PENDING", createdAt: now, updatedAt: now };
        db.certificateRequests.unshift(row);
        db.auditLogs.unshift(audit(employee.companyId, nameOf(employee), `Ma’lumotnoma so‘radi: ${CERTIFICATE_TYPES[input.type]}`, "employee", employee.id));
        return { row, employee };
      });
      void alertHr(
        created.row.companyId,
        "Ma’lumotnoma so‘rovi",
        `${nameOf(created.employee)}: ${CERTIFICATE_TYPES[input.type]} — ${input.purpose}`,
        `📄 <b>Ma’lumotnoma so‘rovi</b>\n${esc(nameOf(created.employee))}\n${esc(CERTIFICATE_TYPES[input.type])}\nQayerga: ${esc(input.purpose)}`,
      ).catch(() => undefined);
      res.status(201).json(created.row);
    }),
  );

  /* --------------------------------------------------- tug‘ilgan kunlar --- */
  router.get(
    "/mini/birthdays",
    route(async (req, res) => {
      const auth = sessionOf(req);
      const db = await readDb();
      const me = ownEmployee(db, auth);
      const today = tashkentIsoDate();
      const year = Number(today.slice(0, 4));
      const rows = db.employees
        .filter((e) => e.companyId === me.companyId && e.status === "ACTIVE" && e.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(e.birthDate))
        .map((e) => {
          // Keyingi tug‘ilgan kun (29-fevral — kabisa bo‘lmagan yilda 28-fevral).
          let next = `${year}-${e.birthDate!.slice(5)}`;
          if (next.endsWith("02-29") && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) next = `${year}-02-28`;
          if (next < today) next = `${year + 1}-${e.birthDate!.slice(5)}`.replace(/-02-29$/, "-02-28");
          const inDays = Math.round((Date.parse(next) - Date.parse(today)) / 86_400_000);
          const congratulated = db.sentGreetings.some((g) => g.key === `congrats:${me.id}:${e.id}:${next.slice(0, 4)}`);
          return {
            id: e.id,
            name: nameOf(e),
            position: db.positions.find((p) => p.id === e.positionId)?.name,
            branch: db.branches.find((b) => b.id === e.branchId)?.name,
            sameBranch: e.branchId === me.branchId,
            photoDataUrl: e.photoDataUrl,
            date: next,
            inDays,
            me: e.id === me.id,
            congratulated,
            canCongratulate: e.id !== me.id && inDays === 0 && Boolean(e.telegramConnected || e.telegramId),
          };
        })
        .filter((r) => r.inDays <= 14)
        .sort((a, b) => a.inDays - b.inDays || Number(b.sameBranch) - Number(a.sameBranch) || a.name.localeCompare(b.name))
        .slice(0, 40);
      res.json(rows);
    }),
  );

  router.post(
    "/mini/birthdays/:id/congrats",
    limit(10),
    route(async (req, res) => {
      const auth = sessionOf(req);
      const { text } = z.object({ text: z.string().trim().max(300).optional() }).parse(req.body || {});
      const today = tashkentIsoDate();
      const result = await updateDb((db) => {
        const me = ownEmployee(db, auth);
        const target = db.employees.find((e) => e.id === req.params.id && e.companyId === me.companyId && e.status === "ACTIVE");
        if (!target || target.id === me.id) throw httpError("Xodim topilmadi.", 404);
        if (target.birthDate?.slice(5) !== today.slice(5) && !(today.endsWith("02-28") && target.birthDate?.endsWith("02-29")))
          throw httpError("Bugun uning tug‘ilgan kuni emas.", 422);
        const key = `congrats:${me.id}:${target.id}:${today.slice(0, 4)}`;
        if (db.sentGreetings.some((g) => g.key === key)) throw httpError("Siz allaqachon tabriklagansiz 🎉", 409);
        db.sentGreetings.push({ key, at: new Date().toISOString() });
        db.notifications.unshift({
          id: randomUUID(),
          companyId: me.companyId,
          employeeId: target.id,
          title: `🎉 ${nameOf(me)} sizni tabrikladi`,
          body: text || "Tug‘ilgan kuningiz muborak! Sog‘lik, baxt va omad tilayman!",
          type: "BIRTHDAY",
          read: false,
          createdAt: new Date().toISOString(),
        });
        return { me, target };
      });
      const db = await readDb();
      const target = db.employees.find((e) => e.id === result.target.id);
      if (target)
        void notifyEmployee(db, target, "hr", `🎉 <b>${esc(nameOf(result.me))}</b> sizni tug‘ilgan kuningiz bilan tabrikladi!\n\n${esc(text || "Sog‘lik, baxt va omad tilayman!")}`, { go: "notifs" }).catch(() => undefined);
      res.json({ ok: true });
    }),
  );

  return router;
}

/* ================================================== Panel (HR / rahbar) === */
export function createHelpdeskRouter() {
  const router = Router();
  const tenantOf = (req: AuthedRequest) => {
    if (!req.session?.companyId) throw httpError("Kompaniya tanlanmagan.", 403);
    return req.session.companyId;
  };
  const hrOnly = (req: Request, res: Response, next: NextFunction) =>
    canAny((req as AuthedRequest).session!.role, ["employees.edit", "leave.approve"]) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  const scopeOf = (req: AuthedRequest, db: Database) =>
    req.session!.role === "BRANCH_MANAGER" ? new Set(db.users.find((u) => u.id === req.session!.userId)?.branchIds || []) : null;

  /* ---------------------------------------------------------- murojaatlar --- */
  router.get(
    "/tickets",
    hrOnly,
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = tenantOf(auth);
      const db = await readDb();
      res.json({
        categories: TICKET_CATEGORIES,
        items: db.tickets
          .filter((t) => t.companyId === tenant)
          .sort((a, b) => Number(b.unreadHr) - Number(a.unreadHr) || b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 300)
          .map(({ ownerHash: _hidden, ...t }) => {
            const employee = t.employeeId ? db.employees.find((e) => e.id === t.employeeId) : undefined;
            return { ...t, employeeName: t.anonymous ? "Anonim" : nameOf(employee), branch: db.branches.find((b) => b.id === t.branchId)?.name };
          }),
      });
    }),
  );

  router.post(
    "/tickets/:id/messages",
    hrOnly,
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = tenantOf(auth);
      const { text, close } = z.object({ text: z.string().trim().min(1).max(2000), close: z.boolean().optional() }).parse(req.body);
      const ticket = await updateDb((db) => {
        const row = db.tickets.find((t) => t.id === req.params.id && t.companyId === tenant);
        if (!row) throw httpError("Murojaat topilmadi.", 404);
        const now = new Date().toISOString();
        row.messages.push({ id: randomUUID(), from: "HR", author: auth.session!.name, text, at: now });
        row.status = close ? "CLOSED" : "ANSWERED";
        row.unreadHr = false;
        row.unreadEmployee = true;
        row.updatedAt = now;
        db.auditLogs.unshift(audit(tenant, auth.session!.name, `Murojaatga javob: ${row.subject}`, "ticket", row.id));
        return { ...row };
      });
      // Anonim murojaat egasini HR bilmaydi — javob faqat Mini App’da ko‘rinadi (Telegram xabari yuborilmaydi).
      if (ticket.employeeId) {
        const db = await readDb();
        const employee = db.employees.find((e) => e.id === ticket.employeeId);
        if (employee) {
          await updateDb((next) =>
            void next.notifications.unshift({
              id: randomUUID(),
              companyId: tenant,
              employeeId: employee.id,
              title: "HR javob berdi",
              body: `${ticket.subject}: ${text.slice(0, 200)}`,
              type: "HELPDESK",
              read: false,
              createdAt: new Date().toISOString(),
              go: `ticket_${ticket.id}`,
            }),
          );
          void notifyEmployee(db, employee, "hr", `💬 <b>HR javob berdi</b>\n${esc(ticket.subject)}\n\n${esc(text.slice(0, 800))}`, { go: `ticket_${ticket.id}`, title: "HR javobi" }).catch(() => undefined);
        }
      }
      res.json(ticket);
    }),
  );

  router.patch(
    "/tickets/:id",
    hrOnly,
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = tenantOf(auth);
      const { status, read } = z.object({ status: z.enum(["OPEN", "ANSWERED", "CLOSED"]).optional(), read: z.boolean().optional() }).parse(req.body);
      const row = await updateDb((db) => {
        const ticket = db.tickets.find((t) => t.id === req.params.id && t.companyId === tenant);
        if (!ticket) throw httpError("Murojaat topilmadi.", 404);
        if (status) ticket.status = status;
        if (read) ticket.unreadHr = false;
        ticket.updatedAt = status ? new Date().toISOString() : ticket.updatedAt;
        return { ...ticket, ownerHash: undefined };
      });
      res.json(row);
    }),
  );

  /* ------------------------------------------------------- ma’lumotnoma --- */
  router.get(
    "/certificates",
    hrOnly,
    route(async (req, res) => {
      const tenant = tenantOf(req as AuthedRequest);
      const db = await readDb();
      res.json({
        types: CERTIFICATE_TYPES,
        items: db.certificateRequests
          .filter((c) => c.companyId === tenant)
          .sort((a, b) => Number(a.status !== "PENDING") - Number(b.status !== "PENDING") || b.createdAt.localeCompare(a.createdAt))
          .slice(0, 300)
          .map((c) => {
            const employee = db.employees.find((e) => e.id === c.employeeId);
            return { ...c, employeeName: nameOf(employee), employeeNo: employee?.employeeNo };
          }),
      });
    }),
  );

  router.post(
    "/certificates/:id/decide",
    hrOnly,
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = tenantOf(auth);
      const input = z
        .object({ ready: z.boolean(), note: z.string().trim().max(300).optional(), dataUrl: documentInputSchema.shape.dataUrl.optional() })
        .parse(req.body);
      const db = await readDb();
      const current = db.certificateRequests.find((c) => c.id === req.params.id && c.companyId === tenant);
      if (!current) throw httpError("So‘rov topilmadi.", 404);
      if (current.status !== "PENDING") throw httpError("So‘rov allaqachon ko‘rib chiqilgan.", 409);
      if (input.ready && !input.dataUrl) throw httpError("Tayyor ma’lumotnoma faylini (PDF yoki rasm) yuklang.", 400);
      const doc = input.ready
        ? await saveDocument(tenant, current.employeeId, { type: "OTHER", title: CERTIFICATE_TYPES[current.type], dataUrl: input.dataUrl! }, auth.session!.name)
        : undefined;
      const row = await updateDb((next) => {
        const item = next.certificateRequests.find((c) => c.id === current.id)!;
        item.status = input.ready ? "READY" : "REJECTED";
        item.documentId = doc?.id;
        item.decidedBy = auth.session!.name;
        item.decidedNote = input.note || undefined;
        item.updatedAt = new Date().toISOString();
        next.notifications.unshift({
          id: randomUUID(),
          companyId: tenant,
          employeeId: item.employeeId,
          title: input.ready ? "Ma’lumotnoma tayyor" : "Ma’lumotnoma so‘rovi rad etildi",
          body: `${CERTIFICATE_TYPES[item.type]}${input.note ? ` — ${input.note}` : ""}`,
          type: "DOCUMENT",
          read: false,
          createdAt: item.updatedAt,
          go: "docs",
        });
        next.auditLogs.unshift(audit(tenant, auth.session!.name, `Ma’lumotnoma ${input.ready ? "tayyorlandi" : "rad etildi"}: ${CERTIFICATE_TYPES[item.type]}`, "employee", item.employeeId));
        return { ...item };
      });
      const fresh = await readDb();
      const employee = fresh.employees.find((e) => e.id === row.employeeId);
      if (employee)
        void notifyEmployee(
          fresh,
          employee,
          "hr",
          input.ready
            ? `📄 <b>Ma’lumotnomangiz tayyor</b>\n${esc(CERTIFICATE_TYPES[row.type])}\nIlovada «Hujjatlarim» bo‘limidan yuklab oling.`
            : `❌ Ma’lumotnoma so‘rovi rad etildi\n${esc(CERTIFICATE_TYPES[row.type])}${input.note ? `\nSabab: ${esc(input.note)}` : ""}`,
          { go: "docs" },
        ).catch(() => undefined);
      res.json(row);
    }),
  );

  /* ---------------------------------------------- rahbar: xodim kartasi --- */
  router.get(
    "/employee-card/:id",
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      if (!can(auth.session!.role, "attendance.view")) return res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
      const tenant = tenantOf(auth);
      const db = await readDb();
      const employee = db.employees.find((e) => e.id === req.params.id && e.companyId === tenant);
      const scope = scopeOf(auth, db);
      if (!employee || (scope && !scope.has(employee.branchId))) throw httpError("Xodim topilmadi.", 404);
      const index = dataIndexes(db);
      const today = tashkentIsoDate();
      const records = new Map((index.attendanceByEmployee.get(employee.id) || []).map((a) => [a.date, a]));
      const leaves = (index.approvedLeaveByEmployee.get(employee.id) || []) as Database["leaveRequests"];
      const days: (StreakDay & TrendDay)[] = [];
      for (let back = 60; back >= 0; back -= 1) {
        const date = tashkentIsoDate(new Date(Date.now() - back * 86_400_000));
        if (date < employee.startDate) continue;
        const record = records.get(date);
        const onLeave = leaves.some((l) => l.startDate <= date && l.endDate >= date);
        days.push({
          date,
          workday: dayPlan(db, employee, date).enabled && !onLeave,
          checkIn: record?.checkIn,
          lateMinutes: record?.lateMinutes,
          earlyLeaveMinutes: record?.earlyLeaveMinutes,
          flagged: Boolean(record?.flags?.length && !record.flagsReviewedBy),
        });
      }
      const month = today.slice(0, 7);
      const monthRows = [...records.values()].filter((a) => a.date.startsWith(month));
      res.json({
        employee: {
          id: employee.id,
          name: nameOf(employee),
          employeeNo: employee.employeeNo,
          phone: employee.phone,
          telegramUsername: employee.telegramUsername,
          photoDataUrl: employee.photoDataUrl,
          startDate: employee.startDate,
          birthDate: employee.birthDate,
          position: db.positions.find((p) => p.id === employee.positionId)?.name,
          department: db.departments.find((d) => d.id === employee.departmentId)?.name,
          branch: db.branches.find((b) => b.id === employee.branchId)?.name,
          faceEnrolled: Boolean(employee.faceEnrolledAt),
          biometric: db.biometricDevices.some((d) => d.employeeId === employee.id && !d.revokedAt),
        },
        month: {
          present: monthRows.filter((a) => a.checkIn).length,
          late: monthRows.filter((a) => a.lateMinutes > 0).length,
          lateMinutes: monthRows.reduce((s, a) => s + a.lateMinutes, 0),
          workedHours: Math.round(monthRows.reduce((s, a) => s + a.workedMinutes, 0) / 60),
          overtimeHours: Math.round(monthRows.reduce((s, a) => s + a.overtimeMinutes, 0) / 60),
          absent: days.filter((d) => d.date.startsWith(month) && d.date < today && d.workday && !d.checkIn).length,
        },
        streak: attendanceStreak(days, today),
        trends: detectTrends(days, today),
        recent: [...records.values()]
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 14)
          .map((a) => ({ id: a.id, date: a.date, checkIn: a.checkIn, checkOut: a.checkOut, lateMinutes: a.lateMinutes, workedMinutes: a.workedMinutes, flags: a.flags, manual: a.verification.includes("MANUAL") })),
        documents: canAny(auth.session!.role, ["employees.view"])
          ? db.documents
              .filter((d) => d.employeeId === employee.id && d.companyId === tenant)
              .map((d) => ({ id: d.id, title: d.title, expiresAt: d.expiresAt, status: documentStatus(d) }))
          : [],
        leaves: leaves
          .filter((l) => l.endDate >= today)
          .slice(0, 5)
          .map((l) => ({ id: l.id, type: l.type, startDate: l.startDate, endDate: l.endDate })),
      });
    }),
  );

  /* ---------------------------------------------- rahbar: muammoli trendlar --- */
  router.get(
    "/trends",
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      if (!can(auth.session!.role, "attendance.view")) return res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
      const tenant = tenantOf(auth);
      const db = await readDb();
      const scope = scopeOf(auth, db);
      const index = dataIndexes(db);
      const today = tashkentIsoDate();
      const dates = Array.from({ length: 29 }, (_, i) => tashkentIsoDate(new Date(Date.now() - (28 - i) * 86_400_000)));
      const rows: { employeeId: string; name: string; branch?: string; photoDataUrl?: string; alerts: TrendAlert[] }[] = [];
      for (const employee of db.employees) {
        if (employee.companyId !== tenant || employee.status !== "ACTIVE" || (scope && !scope.has(employee.branchId))) continue;
        const leaves = (index.approvedLeaveByEmployee.get(employee.id) || []) as Database["leaveRequests"];
        const days: TrendDay[] = dates
          .filter((date) => date >= employee.startDate)
          .map((date) => {
            const record = index.attendanceByKey.get(`${employee.id}|${date}`);
            const onLeave = leaves.some((l) => l.startDate <= date && l.endDate >= date);
            return {
              date,
              workday: dayPlan(db, employee, date).enabled && !onLeave,
              checkIn: record?.checkIn,
              lateMinutes: record?.lateMinutes,
              earlyLeaveMinutes: record?.earlyLeaveMinutes,
              flagged: Boolean(record?.flags?.length && !record.flagsReviewedBy),
            };
          });
        const alerts = detectTrends(days, today);
        if (alerts.length)
          rows.push({ employeeId: employee.id, name: nameOf(employee), branch: db.branches.find((b) => b.id === employee.branchId)?.name, photoDataUrl: employee.photoDataUrl, alerts });
      }
      rows.sort((a, b) => b.alerts[0].severity - a.alerts[0].severity || b.alerts.length - a.alerts.length);
      res.json(rows.slice(0, 50));
    }),
  );

  /* ------------------------------------------- rahbar: filialga tezkor e’lon --- */
  router.post(
    "/quick-announce",
    rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: true, legacyHeaders: false }),
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const role = auth.session!.role;
      const full = can(role, "announcements.create");
      if (!full && role !== "BRANCH_MANAGER") return res.status(403).json({ message: "E’lon yuborish huquqingiz yo‘q." });
      const tenant = tenantOf(auth);
      const input = z
        .object({
          title: z.string().trim().min(3).max(120),
          message: z.string().trim().min(3).max(1500),
          branchIds: z.array(z.string()).max(50).default([]),
          ackRequired: z.boolean().optional(),
          options: z.array(z.string().trim().min(1).max(60)).max(4).optional(),
        })
        .parse(req.body);
      const options = input.options && new Set(input.options).size >= 2 ? [...new Set(input.options)] : undefined;
      const result = await updateDb((db) => {
        const scope = scopeOf(auth, db);
        // Filial rahbari faqat o‘z filiallariga; boshqalar — tanlanganlarga yoki hammaga.
        const branchIds = scope ? (input.branchIds.length ? input.branchIds.filter((id) => scope.has(id)) : [...scope]) : input.branchIds;
        if (scope && !branchIds.length) throw httpError("Sizga filial biriktirilmagan.", 403);
        const recipients = db.employees.filter((e) => e.companyId === tenant && e.status === "ACTIVE" && (!branchIds.length || branchIds.includes(e.branchId)));
        if (!recipients.length) throw httpError("Qabul qiluvchi xodim topilmadi.", 422);
        const now = new Date().toISOString();
        const value: Announcement = {
          id: randomUUID(),
          companyId: tenant,
          title: input.title,
          message: input.message,
          audience: branchIds.length ? db.branches.filter((b) => branchIds.includes(b.id)).map((b) => b.name).join(", ") : "Barcha xodimlar",
          channel: ["STAFFORA", "TELEGRAM"],
          target: branchIds.length ? { type: "BRANCHES", ids: branchIds } : { type: "ALL", ids: [] },
          createdBy: `${auth.session!.name} (Mini App)`,
          scheduledAt: now,
          status: "SENT",
          ackRequired: input.ackRequired || undefined,
          options,
          report: {
            staffora: {
              recipients: recipients.length,
              delivered: recipients.length,
              ...(input.ackRequired ? { acknowledged: 0 } : {}),
              ...(options ? { answers: Object.fromEntries(options.map((o) => [o, 0])) } : {}),
            },
          },
        };
        for (const employee of recipients)
          db.notifications.unshift({
            id: randomUUID(),
            companyId: tenant,
            employeeId: employee.id,
            title: `📢 ${input.title}`,
            body: input.message,
            type: "ANNOUNCEMENT",
            read: false,
            createdAt: now,
            announcementId: value.id,
            ackRequired: value.ackRequired,
            options,
            go: "notifs",
          });
        db.announcements.unshift(value);
        db.auditLogs.unshift(audit(tenant, auth.session!.name, `Tezkor e’lon (Mini App): ${input.title}`, "announcement", value.id, undefined, { recipients: recipients.length }));
        return { value, telegramIds: recipients.filter((e) => e.telegramConnected && e.telegramId && !e.telegramId.startsWith("dev")).map((e) => e.telegramId!) };
      });
      const text = `📢 <b>${esc(input.title)}</b>\n\n${esc(input.message)}${options ? "\n\n🗳 Ilovada javob bering." : input.ackRequired ? "\n\n✅ Ilovada «Tanishdim» tugmasini bosing." : ""}`;
      const sent = await Promise.allSettled(
        result.telegramIds.map((id) => sendTelegramMessage(id, text, { go: "notifs", buttonText: options ? "🗳 Javob berish" : input.ackRequired ? "✅ Tanishdim" : undefined })),
      );
      const delivered = sent.filter((r) => r.status === "fulfilled" && r.value).length;
      await updateDb((db) => {
        const a = db.announcements.find((x) => x.id === result.value.id);
        if (a) a.report = { ...(a.report || {}), telegram: { recipients: result.telegramIds.length, delivered, failed: result.telegramIds.length - delivered } };
      });
      res.status(201).json({ id: result.value.id, recipients: result.value.report?.staffora?.recipients, delivered });
    }),
  );

  return router;
}
