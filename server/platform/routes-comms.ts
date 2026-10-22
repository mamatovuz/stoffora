import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { z } from "zod";
import { audit, documentFiles, readDb, updateDb } from "../../lib/store";
import type { Database } from "../../lib/types";
import type { PlatformNotification, SupportAttachment, SupportMessage, SupportTicket } from "../../lib/platform/types";
import { platformCan } from "../../lib/platform/permissions";
import type { AuthedRequest } from "../auth";
import { actorOf, asyncRoute, httpError, pageParams, paginate, q, requirePlatform } from "./context";
import { platformAudit } from "./audit";
import { listDeliveries, notifyAdmins, notifyPanelUser, queueNotification, resolveAudience, retryFailedDeliveries } from "./notify";

/*
 * Aloqa: bildirishnomalar markazi va ommaviy xabarlar (qoralama → ko‘rib chiqish → tasdiq → navbat → yetkazish holati),
 * murojaatlar markazi (Support Center) — platforma va kompaniya tomoni.
 * Telegram’da botni boshlamagan foydalanuvchiga majburan yuborilmaydi; navbat tezlik bilan cheklangan.
 */

const audienceSchema = z.object({
  type: z.enum(["ALL", "OWNERS", "LEADERS", "COMPANY", "COMPANIES", "PLAN", "EXPIRING"]),
  companyIds: z.array(z.string()).max(1000).optional(),
  planIds: z.array(z.string()).max(50).optional(),
  days: z.number().int().min(1).max(365).optional(),
  ownersOnly: z.boolean().optional(),
});
const notificationSchema = z.object({
  kind: z.enum(["NOTICE", "BULK"]).default("NOTICE"),
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(2).max(3500),
  audience: audienceSchema,
  channels: z.array(z.enum(["IN_APP", "TELEGRAM"])).min(1).max(2),
});

const attachmentInput = z.object({ name: z.string().trim().min(1).max(160), dataUrl: z.string().min(30).max(2_000_000) });

async function saveAttachments(db: Database, companyId: string, files: z.infer<typeof attachmentInput>[] | undefined): Promise<SupportAttachment[]> {
  if (!files?.length) return [];
  if (files.length > 3) throw httpError("Bir xabarga ko‘pi bilan 3 ta fayl.", 400);
  const maxBytes = Math.min(1.4, Math.max(0.1, db.platformSettings?.uploads?.maxMb ?? 1.4)) * 1024 * 1024;
  const store = await documentFiles();
  const out: SupportAttachment[] = [];
  let total = 0;
  for (const file of files) {
    const match = /^data:([\w/.+-]+);base64,(.+)$/s.exec(file.dataUrl);
    if (!match || !/^(image\/(jpeg|png|webp)|application\/pdf|text\/plain)$/.test(match[1])) throw httpError("Faqat rasm (JPG/PNG/WEBP), PDF yoki TXT fayl.", 400);
    const buffer = Buffer.from(match[2], "base64");
    total += buffer.length;
    if (buffer.length > maxBytes || total > maxBytes) throw httpError(`Fayllar hajmi ${(maxBytes / 1024 / 1024).toFixed(1)} MB dan oshmasin.`, 413);
    const id = `support:${randomUUID()}`;
    await store.putFile(id, companyId, match[1], buffer, new Date().toISOString());
    out.push({ id, name: file.name.replace(/[\\/]/g, "_"), mime: match[1], size: buffer.length });
  }
  return out;
}

async function sendAttachment(res: Response, ticket: SupportTicket, fileId: string, allowInternal: boolean) {
  const message = ticket.messages.find((m) => m.attachments?.some((a) => a.id === fileId));
  if (!message || (message.internal && !allowInternal)) throw httpError("Fayl topilmadi.", 404);
  const meta = message.attachments!.find((a) => a.id === fileId)!;
  const file = await (await documentFiles()).getFile(fileId);
  if (!file) throw httpError("Fayl topilmadi.", 404);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(meta.name)}"`);
  res.type(file.mime).send(Buffer.from(file.data));
}

/** Kompaniyaga ko‘rinadigan murojaat (ichki izohlarsiz). */
const companyView = (t: SupportTicket) => ({ ...t, messages: t.messages.filter((m) => !m.internal), assignedTo: undefined, unreadAdmin: undefined });

export function createCommsRouter() {
  const router = Router();

  /* ------------------------------------------------------ bildirishnomalar --- */
  router.get(
    "/super-admin/notifications",
    requirePlatform("notifications.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const kind = q(req, "kind");
      const status = q(req, "status");
      const rows = db.platformNotifications.filter((n) => (!kind || n.kind === kind) && (!status || n.status === status));
      const { page, pageSize } = pageParams(req);
      res.json(paginate(rows, page, pageSize));
    }),
  );

  router.post(
    "/super-admin/notifications",
    requirePlatform("notifications.send"),
    asyncRoute(async (req, res) => {
      const input = notificationSchema.parse(req.body);
      const actor = actorOf(req);
      const now = new Date().toISOString();
      const row: PlatformNotification = { id: randomUUID(), ...input, status: "DRAFT", createdAt: now, createdBy: actor.name, updatedAt: now };
      await updateDb((db) => {
        db.platformNotifications.unshift(row);
        if (db.platformNotifications.length > 500) db.platformNotifications = db.platformNotifications.filter((n, i) => i < 400 || n.status === "SCHEDULED");
      });
      await platformAudit({ req, action: "notification.draft", entity: "notification", entityId: row.id, summary: `${row.kind === "BULK" ? "Ommaviy xabar" : "Bildirishnoma"} qoralamasi: ${row.title}` });
      res.status(201).json(row);
    }),
  );

  router.patch(
    "/super-admin/notifications/:id",
    requirePlatform("notifications.send"),
    asyncRoute(async (req, res) => {
      const input = notificationSchema.partial().parse(req.body);
      const row = await updateDb((db) => {
        const n = db.platformNotifications.find((x) => x.id === req.params.id);
        if (!n) throw httpError("Bildirishnoma topilmadi.", 404);
        if (!["DRAFT", "SCHEDULED"].includes(n.status)) throw httpError("Yuborilgan xabarni tahrirlab bo‘lmaydi.", 409);
        Object.assign(n, input, { status: "DRAFT", scheduledAt: undefined, updatedAt: new Date().toISOString() });
        return n;
      });
      res.json(row);
    }),
  );

  router.delete(
    "/super-admin/notifications/:id",
    requirePlatform("notifications.send"),
    asyncRoute(async (req, res) => {
      await updateDb((db) => {
        const n = db.platformNotifications.find((x) => x.id === req.params.id);
        if (!n) throw httpError("Bildirishnoma topilmadi.", 404);
        if (n.status !== "DRAFT") throw httpError("Faqat qoralama o‘chiriladi.", 409);
        db.platformNotifications = db.platformNotifications.filter((x) => x.id !== n.id);
      });
      res.json({ ok: true });
    }),
  );

  /** Oldindan ko‘rish: nechta kompaniya va rahbar oladi, Telegram’ga nechtasi yetadi. */
  router.post(
    "/super-admin/notifications/:id/preview",
    requirePlatform("notifications.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const n = db.platformNotifications.find((x) => x.id === req.params.id);
      if (!n) throw httpError("Bildirishnoma topilmadi.", 404);
      const { companies, users } = resolveAudience(db, n.audience);
      const reachable = users.filter((u) => u.telegramId);
      res.json({
        companies: companies.length,
        users: users.length,
        telegramReachable: n.channels.includes("TELEGRAM") ? reachable.length : 0,
        telegramSkipped: n.channels.includes("TELEGRAM") ? users.length - reachable.length : 0,
        inApp: n.channels.includes("IN_APP") ? companies.length : 0,
        sample: companies.slice(0, 8).map((c) => c.name),
      });
    }),
  );

  router.post(
    "/super-admin/notifications/:id/send",
    requirePlatform("notifications.send"),
    asyncRoute(async (req, res) => {
      const input = z.object({ confirm: z.literal(true, { errorMap: () => ({ message: "Yuborishni tasdiqlang." }) }), scheduledAt: z.string().optional() }).parse(req.body);
      const actor = actorOf(req);
      const scheduled = input.scheduledAt ? new Date(input.scheduledAt).toISOString() : undefined;
      if (scheduled && Number.isNaN(Date.parse(scheduled))) throw httpError("Vaqt noto‘g‘ri.", 400);
      // Tezlik cheklovi: bir administrator soatiga ko‘pi bilan 10 ta yuborish.
      const db0 = await readDb();
      const hourAgo = new Date(Date.now() - 3600_000).toISOString();
      if (db0.platformNotifications.filter((n) => n.createdBy === actor.name && n.status !== "DRAFT" && n.updatedAt > hourAgo).length >= 10)
        throw httpError("Soatiga 10 tadan ortiq yuborib bo‘lmaydi. Birozdan keyin urinib ko‘ring.", 429);
      const n = await updateDb((db) => {
        const row = db.platformNotifications.find((x) => x.id === req.params.id);
        if (!row) throw httpError("Bildirishnoma topilmadi.", 404);
        if (!["DRAFT", "SCHEDULED"].includes(row.status)) throw httpError("Bu xabar allaqachon yuborilgan.", 409);
        const later = scheduled && scheduled > new Date(Date.now() + 30_000).toISOString();
        row.status = later ? "SCHEDULED" : "QUEUED";
        row.scheduledAt = later ? scheduled : undefined;
        row.updatedAt = new Date().toISOString();
        return { ...row };
      });
      if (n.status === "QUEUED") await queueNotification(n);
      await platformAudit({ req, action: n.kind === "BULK" ? "bulk.send" : "notification.send", entity: "notification", entityId: n.id, summary: `${n.status === "SCHEDULED" ? `Rejalashtirildi (${n.scheduledAt})` : "Yuborildi"}: ${n.title}`, details: { audience: n.audience, channels: n.channels }, privileged: n.kind === "BULK" });
      res.json((await readDb()).platformNotifications.find((x) => x.id === n.id));
    }),
  );

  router.post(
    "/super-admin/notifications/:id/cancel",
    requirePlatform("notifications.send"),
    asyncRoute(async (req, res) => {
      const n = await updateDb((db) => {
        const row = db.platformNotifications.find((x) => x.id === req.params.id);
        if (!row) throw httpError("Bildirishnoma topilmadi.", 404);
        if (!["SCHEDULED", "QUEUED", "SENDING"].includes(row.status)) throw httpError("Bekor qilib bo‘lmaydi.", 409);
        row.status = "CANCELLED";
        row.updatedAt = new Date().toISOString();
        return row;
      });
      await platformAudit({ req, action: "notification.cancel", entity: "notification", entityId: n.id, summary: `Bekor qilindi: ${n.title}` });
      res.json(n);
    }),
  );

  router.get(
    "/super-admin/notifications/:id/deliveries",
    requirePlatform("notifications.read"),
    asyncRoute(async (req, res) => {
      const { page, pageSize, offset } = pageParams(req);
      res.json({ ...(await listDeliveries(String(req.params.id), q(req, "status") || undefined, pageSize, offset)), page, pageSize });
    }),
  );

  router.post(
    "/super-admin/notifications/:id/retry",
    requirePlatform("notifications.send"),
    asyncRoute(async (req, res) => {
      const count = await retryFailedDeliveries(String(req.params.id));
      await platformAudit({ req, action: "notification.retry", entity: "notification", entityId: String(req.params.id), summary: `${count} ta yetkazish qayta navbatga qo‘yildi` });
      res.json({ retried: count });
    }),
  );

  /* ---------------------------------------------------------- murojaatlar --- */
  router.get(
    "/super-admin/support/tickets",
    requirePlatform("support.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const actor = actorOf(req);
      const status = q(req, "status");
      const priority = q(req, "priority");
      const companyId = q(req, "companyId");
      const assigned = q(req, "assigned");
      const text = q(req, "q").toLowerCase();
      let rows = db.supportTickets.map((t) => ({
        id: t.id,
        number: t.number,
        companyId: t.companyId,
        company: db.companies.find((c) => c.id === t.companyId)?.name || "—",
        subject: t.subject,
        category: t.category || null,
        priority: t.priority,
        status: t.status,
        assignedTo: t.assignedTo || null,
        assignedName: t.assignedName || null,
        createdByName: t.createdByName,
        messages: t.messages.length,
        unread: t.unreadAdmin,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));
      if (status === "open") rows = rows.filter((r) => !["RESOLVED", "CLOSED"].includes(r.status));
      else if (status) rows = rows.filter((r) => r.status === status);
      if (priority) rows = rows.filter((r) => r.priority === priority);
      if (companyId) rows = rows.filter((r) => r.companyId === companyId);
      if (assigned === "me") rows = rows.filter((r) => r.assignedTo === actor.id);
      if (assigned === "none") rows = rows.filter((r) => !r.assignedTo);
      if (text) rows = rows.filter((r) => `${r.number} ${r.subject} ${r.company} ${r.createdByName}`.toLowerCase().includes(text));
      const weight = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as Record<string, number>;
      rows.sort((a, b) => Number(b.unread) - Number(a.unread) || weight[a.priority] - weight[b.priority] || b.updatedAt.localeCompare(a.updatedAt));
      const counts: Record<string, number> = {};
      for (const t of db.supportTickets) counts[t.status] = (counts[t.status] || 0) + 1;
      const { page, pageSize } = pageParams(req);
      res.json({ ...paginate(rows, page, pageSize), counts });
    }),
  );

  router.get(
    "/super-admin/support/admins",
    requirePlatform("support.read"),
    asyncRoute(async (_req, res) => {
      const db = await readDb();
      res.json(db.users.filter((u) => u.role === "SUPER_ADMIN" && !u.blockedAt && platformCan(u.platformRole, "support.manage")).map((u) => ({ id: u.id, name: u.name })));
    }),
  );

  router.get(
    "/super-admin/support/tickets/:id",
    requirePlatform("support.read"),
    asyncRoute(async (req, res) => {
      const ticket = await updateDb((db) => {
        const t = db.supportTickets.find((x) => x.id === req.params.id);
        if (!t) throw httpError("Murojaat topilmadi.", 404);
        t.unreadAdmin = false;
        return t;
      });
      const db = await readDb();
      res.json({ ...ticket, company: db.companies.find((c) => c.id === ticket.companyId)?.name || "—" });
    }),
  );

  router.post(
    "/super-admin/support/tickets/:id/messages",
    requirePlatform("support.manage"),
    asyncRoute(async (req, res) => {
      const input = z.object({ text: z.string().trim().min(1).max(5000), internal: z.boolean().default(false), attachments: z.array(attachmentInput).max(3).optional() }).parse(req.body);
      const actor = actorOf(req);
      const db0 = await readDb();
      const existing = db0.supportTickets.find((t) => t.id === req.params.id);
      if (!existing) throw httpError("Murojaat topilmadi.", 404);
      const attachments = await saveAttachments(db0, existing.companyId, input.attachments);
      const ticket = await updateDb((db) => {
        const t = db.supportTickets.find((x) => x.id === req.params.id)!;
        const message: SupportMessage = { id: randomUUID(), author: "ADMIN", authorName: actor.name, authorId: actor.id, text: input.text, internal: input.internal || undefined, attachments: attachments.length ? attachments : undefined, at: new Date().toISOString() };
        t.messages.push(message);
        if (!input.internal) {
          t.unreadCompany = true;
          if (t.status === "OPEN") t.status = "IN_PROGRESS";
        }
        if (!t.assignedTo) {
          t.assignedTo = actor.id;
          t.assignedName = actor.name;
        }
        t.updatedAt = message.at;
        return t;
      });
      await platformAudit({ req, companyId: ticket.companyId, action: input.internal ? "support.note" : "support.reply", entity: "ticket", entityId: ticket.id, summary: `#${ticket.number}: ${input.internal ? "ichki izoh" : "javob"}` });
      if (!input.internal)
        void notifyPanelUser(await readDb(), ticket.createdById, { key: `ticket:${ticket.id}:${ticket.messages.length}`, title: `Staffora yordam: #${ticket.number}`, body: `«${ticket.subject}» murojaatingizga javob berildi. Panel → Yordam bo‘limida ko‘ring.` });
      res.json(ticket);
    }),
  );

  router.patch(
    "/super-admin/support/tickets/:id",
    requirePlatform("support.manage"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({ status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), assignedTo: z.union([z.string(), z.null()]).optional(), category: z.string().trim().max(60).optional() })
        .parse(req.body);
      const actor = actorOf(req);
      const result = await updateDb((db) => {
        const t = db.supportTickets.find((x) => x.id === req.params.id);
        if (!t) throw httpError("Murojaat topilmadi.", 404);
        const before = { status: t.status, priority: t.priority, assignedTo: t.assignedName };
        const now = new Date().toISOString();
        if (input.assignedTo !== undefined) {
          if (input.assignedTo === null) {
            t.assignedTo = undefined;
            t.assignedName = undefined;
          } else {
            const admin = db.users.find((u) => u.id === input.assignedTo && u.role === "SUPER_ADMIN" && !u.blockedAt && platformCan(u.platformRole, "support.manage"));
            if (!admin) throw httpError("Administrator topilmadi.", 404);
            t.assignedTo = admin.id;
            t.assignedName = admin.name;
          }
        }
        if (input.priority) t.priority = input.priority;
        if (input.category !== undefined) t.category = input.category || undefined;
        if (input.status && input.status !== t.status) {
          t.status = input.status;
          if (input.status === "RESOLVED") t.resolvedAt = now;
          t.messages.push({ id: randomUUID(), author: "SYSTEM", authorName: actor.name, text: `Holat: ${input.status}`, at: now });
          t.unreadCompany = true;
        }
        t.updatedAt = now;
        return { t, before };
      });
      await platformAudit({ req, companyId: result.t.companyId, action: "support.update", entity: "ticket", entityId: result.t.id, summary: `#${result.t.number}: ${JSON.stringify(input)}`, details: { before: result.before } });
      res.json(result.t);
    }),
  );

  router.get(
    "/super-admin/support/attachments/:fileId",
    requirePlatform("support.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const ticket = db.supportTickets.find((t) => t.messages.some((m) => m.attachments?.some((a) => a.id === req.params.fileId)));
      if (!ticket) throw httpError("Fayl topilmadi.", 404);
      await sendAttachment(res, ticket, String(req.params.fileId), true);
    }),
  );

  return router;
}

/* =============================================== kompaniya tomoni (panel) === */
type CompanyReq = AuthedRequest;
const tenantOf = (req: CompanyReq) => {
  const s = req.session;
  if (!s?.companyId || s.role === "SUPER_ADMIN" || s.role === "EMPLOYEE") throw httpError("Yordam markazi kompaniya panelida.", 403);
  return s.companyId;
};

/** Kompaniya paneli: platformaga murojaat yuborish va javoblarni ko‘rish (faqat o‘z kompaniyasi). */
export function createCompanySupportRouter() {
  const router = Router();
  /** Platforma yordam aloqalari (global sozlamalardan; maxfiy emas). */
  router.get(
    "/support/contacts",
    asyncRoute(async (req, res) => {
      tenantOf(req);
      const db = await readDb();
      const s = db.platformSettings?.support || {};
      res.json({ platformName: db.platformSettings?.platformName || "Staffora", email: s.email || null, telegram: s.telegram || null, phone: s.phone || null, hours: s.hours || null });
    }),
  );
  router.get(
    "/support/tickets",
    asyncRoute(async (req, res) => {
      const tenant = tenantOf(req);
      const db = await readDb();
      res.json(db.supportTickets.filter((t) => t.companyId === tenant).map(companyView).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    }),
  );
  router.get(
    "/support/tickets/:id",
    asyncRoute(async (req, res) => {
      const tenant = tenantOf(req);
      const preview = Boolean(req.session?.preview);
      const ticket = await updateDb((db) => {
        const t = db.supportTickets.find((x) => x.id === req.params.id && x.companyId === tenant);
        if (!t) throw httpError("Murojaat topilmadi.", 404);
        // Ko‘rish rejimida «o‘qildi» belgilanmaydi.
        if (!preview) t.unreadCompany = false;
        return t;
      });
      res.json(companyView(ticket));
    }),
  );
  router.post(
    "/support/tickets",
    asyncRoute(async (req, res) => {
      const tenant = tenantOf(req);
      const input = z
        .object({ subject: z.string().trim().min(3).max(160), text: z.string().trim().min(5).max(5000), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"), category: z.string().trim().max(60).optional(), attachments: z.array(attachmentInput).max(3).optional() })
        .parse(req.body);
      const db0 = await readDb();
      // Spamdan himoya: kompaniyadan soatiga ko‘pi bilan 10 ta yangi murojaat.
      const hourAgo = new Date(Date.now() - 3600_000).toISOString();
      if (db0.supportTickets.filter((t) => t.companyId === tenant && t.createdAt > hourAgo).length >= 10) throw httpError("Juda ko‘p murojaat. Birozdan keyin urinib ko‘ring.", 429);
      const attachments = await saveAttachments(db0, tenant, input.attachments);
      const session = req.session!;
      const ticket = await updateDb((db) => {
        const now = new Date().toISOString();
        const row: SupportTicket = {
          id: randomUUID(),
          number: db.supportTickets.reduce((m, t) => Math.max(m, t.number), 1000) + 1,
          companyId: tenant,
          createdById: session.userId,
          createdByName: session.name,
          subject: input.subject,
          category: input.category,
          priority: input.priority,
          status: "OPEN",
          messages: [{ id: randomUUID(), author: "COMPANY", authorName: session.name, authorId: session.userId, text: input.text, attachments: attachments.length ? attachments : undefined, at: now }],
          unreadAdmin: true,
          unreadCompany: false,
          createdAt: now,
          updatedAt: now,
        };
        db.supportTickets.unshift(row);
        db.auditLogs.unshift(audit(tenant, session.name, `Platformaga murojaat yuborildi (#${row.number})`, "ticket", row.id));
        return row;
      });
      const company = db0.companies.find((c) => c.id === tenant)?.name || "";
      void notifyAdmins({ key: `ticket:${ticket.id}`, text: `🆘 Yangi murojaat #${ticket.number} (${ticket.priority}) — ${company}: ${ticket.subject}`, permission: "support.read", cooldownMinutes: 1 });
      res.status(201).json(companyView(ticket));
    }),
  );
  router.post(
    "/support/tickets/:id/messages",
    asyncRoute(async (req, res) => {
      const tenant = tenantOf(req);
      const input = z.object({ text: z.string().trim().min(1).max(5000), attachments: z.array(attachmentInput).max(3).optional() }).parse(req.body);
      const db0 = await readDb();
      const existing = db0.supportTickets.find((t) => t.id === req.params.id && t.companyId === tenant);
      if (!existing) throw httpError("Murojaat topilmadi.", 404);
      if (existing.status === "CLOSED") throw httpError("Murojaat yopilgan — yangisini oching.", 409);
      const attachments = await saveAttachments(db0, tenant, input.attachments);
      const session = req.session!;
      const ticket = await updateDb((db) => {
        const t = db.supportTickets.find((x) => x.id === req.params.id && x.companyId === tenant)!;
        const now = new Date().toISOString();
        t.messages.push({ id: randomUUID(), author: "COMPANY", authorName: session.name, authorId: session.userId, text: input.text, attachments: attachments.length ? attachments : undefined, at: now });
        t.unreadAdmin = true;
        if (["WAITING_CUSTOMER", "RESOLVED"].includes(t.status)) t.status = "IN_PROGRESS";
        t.updatedAt = now;
        return t;
      });
      void notifyAdmins({ key: `ticket:${ticket.id}:${ticket.messages.length}`, text: `💬 #${ticket.number}: kompaniya javob yozdi — ${ticket.subject}`, permission: "support.read", cooldownMinutes: 5 });
      res.json(companyView(ticket));
    }),
  );
  router.post(
    "/support/tickets/:id/close",
    asyncRoute(async (req, res) => {
      const tenant = tenantOf(req);
      const ticket = await updateDb((db) => {
        const t = db.supportTickets.find((x) => x.id === req.params.id && x.companyId === tenant);
        if (!t) throw httpError("Murojaat topilmadi.", 404);
        t.status = "CLOSED";
        t.updatedAt = new Date().toISOString();
        t.messages.push({ id: randomUUID(), author: "SYSTEM", authorName: req.session!.name, text: "Kompaniya murojaatni yopdi", at: t.updatedAt });
        return t;
      });
      res.json(companyView(ticket));
    }),
  );
  router.get(
    "/support/attachments/:fileId",
    asyncRoute(async (req, res) => {
      const tenant = tenantOf(req);
      const db = await readDb();
      const ticket = db.supportTickets.find((t) => t.companyId === tenant && t.messages.some((m) => m.attachments?.some((a) => a.id === req.params.fileId)));
      if (!ticket) throw httpError("Fayl topilmadi.", 404);
      await sendAttachment(res, ticket, String(req.params.fileId), false);
    }),
  );
  return router;
}
