import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { audit, readDb, updateDb } from "../../lib/store";
import { createUser } from "../../lib/seed";
import type { Role, User } from "../../lib/types";
import { canOpenPage, pagePermissions } from "../../lib/permissions";
import { canAssignPlatformRole, PLATFORM_PERMISSIONS, PLATFORM_ROLES, platformRoleOf } from "../../lib/platform/permissions";
import { LEADER_ROLES, type PlatformRole } from "../../lib/platform/types";
import { capacityMessage, effectiveLimits } from "../../lib/platform/subscriptions";
import { describeUserAgent } from "../../lib/platform/security";
import { actorOf, assertRecentAuth, asyncRoute, httpError, markReauthenticated, pageParams, paginate, q, requirePlatform } from "./context";
import { platformAudit } from "./audit";
import { recordSecurityEvent } from "./security-events";
import { tempPassword } from "./shared";

/*
 * Global foydalanuvchilar (barcha kompaniyalar panel foydalanuvchilari), rahbarlar, sessiyalar,
 * platforma administratorlari va rollar matritsasi.
 * Xavfsizlik: foydalanuvchini boshqa kompaniyaga ko‘chirib bo‘lmaydi (faqat qo‘shimcha kirish — alohida, auditlangan);
 * SUPER_ADMIN rolini bu yerda berib bo‘lmaydi; Owner huquqlarini oddiy admin bera olmaydi.
 */

const COMPANY_ROLES = ["HR_ADMIN", "HR_MANAGER", "FINANCE", "IT_ADMIN", "BRANCH_MANAGER"] as const;
const recentCutoff = () => new Date(Date.now() - 12 * 3600_000).toISOString();

function userRow(db: Awaited<ReturnType<typeof readDb>>, u: User) {
  const sessions = db.panelSessions.filter((s) => s.userId === u.id && !s.revokedAt);
  const company = db.companies.find((c) => c.id === u.companyId);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    platformRole: u.role === "SUPER_ADMIN" ? platformRoleOf(u.platformRole) : null,
    companyId: u.companyId || null,
    company: company?.name || null,
    companyArchived: Boolean(company?.archive),
    extraCompanyIds: u.extraCompanyIds || [],
    telegramLinked: Boolean(u.telegramId),
    twoFactor: Boolean(u.twoFactorEnabled && u.telegramId),
    blockedAt: u.blockedAt || null,
    blockReason: u.blockReason || null,
    lastLoginAt: u.lastLoginAt || null,
    lastSeenAt: sessions.map((s) => s.lastSeenAt).sort().pop() || null,
    activeSessions: sessions.filter((s) => s.lastSeenAt > recentCutoff()).length,
  };
}

export function createUsersRouter() {
  const router = Router();

  router.get(
    "/super-admin/users",
    requirePlatform("users.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const text = q(req, "q").toLowerCase();
      const companyId = q(req, "companyId");
      const role = q(req, "role");
      const status = q(req, "status");
      const scope = q(req, "scope"); // leaders
      let rows = db.users.filter((u) => u.role !== "SUPER_ADMIN").map((u) => userRow(db, u));
      if (scope === "leaders") rows = rows.filter((r) => LEADER_ROLES.includes(r.role));
      if (companyId) rows = rows.filter((r) => r.companyId === companyId || r.extraCompanyIds.includes(companyId));
      if (role) rows = rows.filter((r) => r.role === role);
      if (status === "blocked") rows = rows.filter((r) => r.blockedAt);
      if (status === "active") rows = rows.filter((r) => !r.blockedAt);
      if (status === "online") rows = rows.filter((r) => r.activeSessions > 0);
      if (text) rows = rows.filter((r) => `${r.name} ${r.email} ${r.company || ""}`.toLowerCase().includes(text));
      rows.sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || "") || a.name.localeCompare(b.name));
      const { page, pageSize } = pageParams(req);
      res.json(paginate(rows, page, pageSize));
    }),
  );

  router.get(
    "/super-admin/users/:id",
    requirePlatform("users.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const user = db.users.find((u) => u.id === req.params.id && u.role !== "SUPER_ADMIN");
      if (!user) throw httpError("Foydalanuvchi topilmadi.", 404);
      const pages = Object.keys(pagePermissions).filter((path) => canOpenPage(user.role, path));
      res.json({
        user: userRow(db, user),
        pages,
        branches: (user.branchIds || []).map((id) => db.branches.find((b) => b.id === id)?.name || id),
        extraCompanies: (user.extraCompanyIds || []).map((id) => ({ id, name: db.companies.find((c) => c.id === id)?.name || id })),
        sessions: db.panelSessions
          .filter((s) => s.userId === user.id)
          .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
          .slice(0, 30)
          .map((s) => ({ id: s.id, ...describeUserAgent(s.userAgent), ip: s.ip, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, revokedAt: s.revokedAt || null })),
      });
    }),
  );

  router.patch(
    "/super-admin/users/:id",
    requirePlatform("users.manage"),
    asyncRoute(async (req, res) => {
      const input = z.object({ name: z.string().trim().min(2).max(80).optional(), role: z.enum(COMPANY_ROLES).optional(), branchIds: z.array(z.string()).max(500).optional() }).parse(req.body);
      const actor = actorOf(req);
      const result = await updateDb((db) => {
        const user = db.users.find((u) => u.id === req.params.id && u.role !== "SUPER_ADMIN");
        if (!user || !user.companyId) throw httpError("Foydalanuvchi topilmadi.", 404);
        if (input.role && user.role === "COMPANY_OWNER") throw httpError("Kompaniya egasi rolini o‘zgartirish uchun egalikni boshqaga o‘tkazing.", 409);
        if (input.role === "BRANCH_MANAGER" && user.extraCompanyIds?.length) throw httpError("Filial rahbari faqat bitta kompaniyaga biriktiriladi.", 409);
        const before = { role: user.role, name: user.name, branchIds: user.branchIds };
        if (input.name) user.name = input.name;
        if (input.role) {
          user.role = input.role as Role;
          user.autoRole = undefined;
        }
        if (input.branchIds) user.branchIds = input.branchIds.filter((id) => db.branches.some((b) => b.id === id && b.companyId === user.companyId));
        if (user.role !== "BRANCH_MANAGER") user.branchIds = undefined;
        db.auditLogs.unshift(audit(user.companyId, actor.name, "Platforma: foydalanuvchi o‘zgartirildi", "user", user.id, before, { role: user.role, name: user.name, branchIds: user.branchIds }));
        return { user, before };
      });
      await platformAudit({
        req,
        companyId: result.user.companyId,
        action: input.role && input.role !== result.before.role ? "user.role_change" : "user.update",
        entity: "user",
        entityId: result.user.id,
        summary: `${result.user.email}: ${result.before.role} → ${result.user.role}`,
        details: { before: result.before, after: { role: result.user.role, branchIds: result.user.branchIds } },
        privileged: Boolean(input.role),
      });
      if (input.role && input.role !== result.before.role) void recordSecurityEvent({ type: "ROLE_CHANGED", severity: "MEDIUM", userId: result.user.id, subject: `${result.before.role} → ${result.user.role}`, req });
      res.json(userRow(await readDb(), result.user));
    }),
  );

  const block = (blocked: boolean) =>
    asyncRoute(async (req, res) => {
      const { reason } = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body);
      if (blocked && !reason) throw httpError("Bloklash sababini yozing.", 400);
      const actor = actorOf(req);
      const user = await updateDb((db) => {
        const row = db.users.find((u) => u.id === req.params.id && u.role !== "SUPER_ADMIN");
        if (!row) throw httpError("Foydalanuvchi topilmadi.", 404);
        const now = new Date().toISOString();
        if (blocked) {
          row.blockedAt = now;
          row.blockedBy = actor.name;
          row.blockReason = reason;
          for (const s of db.panelSessions) if (s.userId === row.id && !s.revokedAt) s.revokedAt = now;
        } else {
          row.blockedAt = undefined;
          row.blockedBy = undefined;
          row.blockReason = undefined;
        }
        if (row.companyId) db.auditLogs.unshift(audit(row.companyId, actor.name, blocked ? `Platforma: foydalanuvchi bloklandi (${reason})` : "Platforma: foydalanuvchi blokdan chiqarildi", "user", row.id));
        return row;
      });
      await platformAudit({ req, companyId: user.companyId, action: blocked ? "user.block" : "user.unblock", entity: "user", entityId: user.id, summary: `${user.email}${blocked ? ` bloklandi: ${reason}` : " blokdan chiqarildi"}`, privileged: true });
      if (blocked) void recordSecurityEvent({ type: "USER_BLOCKED", severity: "MEDIUM", userId: user.id, email: user.email, req, detail: reason });
      res.json(userRow(await readDb(), user));
    });
  router.post("/super-admin/users/:id/block", requirePlatform("users.manage"), block(true));
  router.post("/super-admin/users/:id/unblock", requirePlatform("users.manage"), block(false));

  router.post(
    "/super-admin/users/:id/revoke-sessions",
    requirePlatform("sessions.manage"),
    asyncRoute(async (req, res) => {
      const result = await updateDb((db) => {
        const user = db.users.find((u) => u.id === req.params.id);
        if (!user) throw httpError("Foydalanuvchi topilmadi.", 404);
        if (user.role === "SUPER_ADMIN" && user.id !== req.session?.userId && platformRoleOf(user.platformRole) === "OWNER" && actorOf(req).role !== "OWNER")
          throw httpError("Owner sessiyalarini faqat Owner bekor qiladi.", 403);
        const now = new Date().toISOString();
        let count = 0;
        for (const s of db.panelSessions)
          if (s.userId === user.id && !s.revokedAt && s.id !== req.session?.sid) {
            s.revokedAt = now;
            count += 1;
          }
        return { user, count };
      });
      await platformAudit({ req, companyId: result.user.companyId, action: "session.revoke_all", entity: "user", entityId: result.user.id, summary: `${result.user.email}: ${result.count} ta sessiya bekor qilindi` });
      void recordSecurityEvent({ type: "SESSION_REVOKED", severity: "LOW", userId: result.user.id, req, detail: `${result.count} ta sessiya` });
      res.json({ revoked: result.count });
    }),
  );

  /** Bir nechta kompaniyaga kirish (rahbar bir nechta kompaniyani boshqaradi). */
  router.put(
    "/super-admin/users/:id/companies",
    requirePlatform("users.manage"),
    asyncRoute(async (req, res) => {
      const { companyIds } = z.object({ companyIds: z.array(z.string()).max(50) }).parse(req.body);
      const actor = actorOf(req);
      const user = await updateDb((db) => {
        const row = db.users.find((u) => u.id === req.params.id && u.role !== "SUPER_ADMIN");
        if (!row || !row.companyId) throw httpError("Foydalanuvchi topilmadi.", 404);
        if (!["COMPANY_OWNER", "HR_ADMIN", "HR_MANAGER", "FINANCE", "IT_ADMIN"].includes(row.role)) throw httpError("Bu rol uchun qo‘shimcha kompaniya berilmaydi.", 409);
        const unique = [...new Set(companyIds)].filter((id) => id !== row.companyId);
        for (const id of unique) if (!db.companies.some((c) => c.id === id && !c.archive && !c.demo)) throw httpError("Kompaniya topilmadi yoki faol emas.", 404);
        const before = row.extraCompanyIds || [];
        row.extraCompanyIds = unique.length ? unique : undefined;
        for (const id of new Set([...before, ...unique]))
          db.auditLogs.unshift(audit(id, actor.name, unique.includes(id) ? `Platforma: ${row.name} ga qo‘shimcha kirish berildi` : `Platforma: ${row.name} dan kirish olib tashlandi`, "user", row.id));
        return row;
      });
      await platformAudit({ req, companyId: user.companyId, action: "user.companies", entity: "user", entityId: user.id, summary: `${user.email}: qo‘shimcha kompaniyalar — ${(user.extraCompanyIds || []).length} ta`, details: { companyIds: user.extraCompanyIds }, privileged: true });
      res.json(userRow(await readDb(), user));
    }),
  );

  /* --------------------------------------------------------------- rahbarlar --- */
  router.post(
    "/super-admin/companies/:id/leaders",
    requirePlatform("users.manage"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email(), role: z.enum(COMPANY_ROLES), branchIds: z.array(z.string()).max(500).optional() })
        .parse(req.body);
      const actor = actorOf(req);
      const password = tempPassword();
      const user = await createUser({ name: input.name, email: input.email, password, role: input.role, companyId: String(req.params.id) });
      await updateDb((db) => {
        const company = db.companies.find((c) => c.id === req.params.id);
        if (!company || company.archive) throw httpError("Kompaniya topilmadi yoki arxivda.", 404);
        if (db.users.some((u) => u.email === user.email)) throw httpError("Bu email bilan foydalanuvchi mavjud.", 409);
        const plan = company.subscription ? db.subscriptionPlans.find((p) => p.id === company.subscription!.planId) : undefined;
        const limit = effectiveLimits(plan, company.subscription).managers;
        const message = company.subscription ? capacityMessage("managers", limit, db.users.filter((u) => u.companyId === company.id && u.role !== "EMPLOYEE").length) : null;
        if (message) throw httpError(message, 402);
        if (input.role === "BRANCH_MANAGER") user.branchIds = (input.branchIds || []).filter((id) => db.branches.some((b) => b.id === id && b.companyId === company.id));
        db.users.push(user);
        db.auditLogs.unshift(audit(company.id, actor.name, `Platforma: rahbar qo‘shildi (${input.role})`, "user", user.id));
      });
      await platformAudit({ req, companyId: String(req.params.id), action: "user.create", entity: "user", entityId: user.id, summary: `Rahbar qo‘shildi: ${user.email} (${input.role})`, privileged: true });
      res.status(201).json({ id: user.id, email: user.email, password });
    }),
  );

  /** Egalikni boshqa foydalanuvchiga o‘tkazish (oldingi ega — HR administrator bo‘ladi). */
  router.post(
    "/super-admin/companies/:id/owner",
    requirePlatform("users.manage"),
    asyncRoute(async (req, res) => {
      const { userId } = z.object({ userId: z.string().min(1) }).parse(req.body);
      assertRecentAuth(req, await readDb());
      const actor = actorOf(req);
      const result = await updateDb((db) => {
        const company = db.companies.find((c) => c.id === req.params.id);
        if (!company) throw httpError("Kompaniya topilmadi.", 404);
        const next = db.users.find((u) => u.id === userId && u.companyId === company.id && u.role !== "SUPER_ADMIN");
        if (!next) throw httpError("Yangi ega shu kompaniya foydalanuvchisi bo‘lishi kerak.", 404);
        if (next.blockedAt) throw httpError("Bloklangan foydalanuvchiga egalik berilmaydi.", 409);
        const previous = db.users.find((u) => u.companyId === company.id && u.role === "COMPANY_OWNER");
        if (previous?.id === next.id) throw httpError("Bu foydalanuvchi allaqachon ega.", 409);
        if (previous) previous.role = "HR_ADMIN";
        next.role = "COMPANY_OWNER";
        next.branchIds = undefined;
        next.autoRole = undefined;
        company.ownerName = next.name;
        db.auditLogs.unshift(audit(company.id, actor.name, `Platforma: egalik ${previous?.name || "—"} dan ${next.name} ga o‘tkazildi`, "company", company.id));
        return { company, previous, next };
      });
      await platformAudit({ req, companyId: result.company.id, action: "company.owner_transfer", entity: "user", entityId: result.next.id, summary: `Egalik: ${result.previous?.email || "—"} → ${result.next.email}`, privileged: true });
      res.json({ ok: true });
    }),
  );

  /* ---------------------------------------------------------------- sessiyalar --- */
  router.get(
    "/super-admin/sessions",
    requirePlatform("users.read"),
    asyncRoute(async (req, res) => {
      const db = await readDb();
      const kind = q(req, "kind") || "panel";
      const status = q(req, "status") || "active";
      const companyId = q(req, "companyId");
      const text = q(req, "q").toLowerCase();
      const now = new Date().toISOString();
      if (kind === "mobile") {
        const employee = (id: string) => db.employees.find((e) => e.id === id);
        let rows = db.mobileSessions.map((s) => {
          const e = employee(s.employeeId);
          const device = db.mobileDevices.find((d) => d.id === s.deviceId);
          return {
            id: s.id,
            kind: "mobile",
            companyId: s.companyId,
            company: db.companies.find((c) => c.id === s.companyId)?.name || "—",
            who: e ? `${e.lastName} ${e.firstName}` : "—",
            device: device ? `${device.platform === "ios" ? "iOS" : "Android"}${device.model ? ` · ${device.model}` : ""}` : "—",
            createdAt: s.createdAt,
            lastSeenAt: s.lastUsedAt,
            expiresAt: s.expiresAt,
            revokedAt: s.revokedAt || null,
            state: s.revokedAt ? "REVOKED" : s.expiresAt < now ? "EXPIRED" : "ACTIVE",
          };
        });
        if (companyId) rows = rows.filter((r) => r.companyId === companyId);
        if (status !== "all") rows = rows.filter((r) => r.state === status.toUpperCase());
        if (text) rows = rows.filter((r) => `${r.who} ${r.company}`.toLowerCase().includes(text));
        rows.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
        const { page, pageSize } = pageParams(req);
        return res.json(paginate(rows, page, pageSize));
      }
      // Panel sessiyalari: JWT 8–12 soat; oxirgi faollikdan 12 soatdan oshganlar — «muddati o‘tgan».
      const expired = new Date(Date.now() - 12 * 3600_000).toISOString();
      let rows = db.panelSessions.map((s) => {
        const user = db.users.find((u) => u.id === s.userId);
        const ua = describeUserAgent(s.userAgent);
        return {
          id: s.id,
          kind: "panel",
          userId: s.userId,
          companyId: user?.companyId || null,
          company: user?.companyId ? db.companies.find((c) => c.id === user.companyId)?.name || "—" : "Platforma",
          who: user ? `${user.name} · ${user.email}` : "—",
          role: user?.role || null,
          device: ua.label,
          deviceType: ua.device,
          ip: s.ip,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          revokedAt: s.revokedAt || null,
          state: s.revokedAt ? "REVOKED" : s.lastSeenAt < expired ? "EXPIRED" : "ACTIVE",
          current: s.id === req.session?.sid,
        };
      });
      if (companyId) rows = rows.filter((r) => r.companyId === companyId);
      if (q(req, "userId")) rows = rows.filter((r) => r.userId === q(req, "userId"));
      if (status !== "all") rows = rows.filter((r) => r.state === status.toUpperCase());
      if (text) rows = rows.filter((r) => `${r.who} ${r.company} ${r.ip}`.toLowerCase().includes(text));
      rows.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
      const { page, pageSize } = pageParams(req);
      res.json(paginate(rows, page, pageSize));
    }),
  );

  router.post(
    "/super-admin/sessions/:id/revoke",
    requirePlatform("sessions.manage"),
    asyncRoute(async (req, res) => {
      const { kind } = z.object({ kind: z.enum(["panel", "mobile"]) }).parse(req.body);
      const actor = actorOf(req);
      const info = await updateDb((db) => {
        const now = new Date().toISOString();
        if (kind === "panel") {
          const row = db.panelSessions.find((s) => s.id === req.params.id);
          if (!row) throw httpError("Sessiya topilmadi.", 404);
          if (row.id === req.session?.sid) throw httpError("Joriy sessiyangizni bu yerdan bekor qila olmaysiz — «Chiqish» tugmasidan foydalaning.", 409);
          const owner = db.users.find((u) => u.id === row.userId);
          if (owner?.role === "SUPER_ADMIN" && platformRoleOf(owner.platformRole) === "OWNER" && actor.role !== "OWNER") throw httpError("Owner sessiyasini faqat Owner bekor qiladi.", 403);
          row.revokedAt ||= now;
          return { userId: row.userId, companyId: owner?.companyId };
        }
        const row = db.mobileSessions.find((s) => s.id === req.params.id);
        if (!row) throw httpError("Sessiya topilmadi.", 404);
        row.revokedAt ||= now;
        row.revokeReason = `Platforma: ${actor.name}`;
        return { userId: row.employeeId, companyId: row.companyId };
      });
      await platformAudit({ req, companyId: info.companyId, action: "session.revoke", entity: `${kind}_session`, entityId: String(req.params.id), summary: `${kind === "panel" ? "Panel" : "Mobil"} sessiyasi bekor qilindi` });
      void recordSecurityEvent({ type: "SESSION_REVOKED", severity: "LOW", userId: info.userId, req, detail: kind });
      res.json({ ok: true });
    }),
  );

  /* ------------------------------------------------------ platforma administratorlari --- */
  router.get(
    "/super-admin/admins",
    requirePlatform("admins.manage"),
    asyncRoute(async (_req, res) => {
      const db = await readDb();
      res.json(db.users.filter((u) => u.role === "SUPER_ADMIN").map((u) => userRow(db, u)));
    }),
  );

  router.get(
    "/super-admin/admin-roles",
    requirePlatform(),
    asyncRoute(async (_req, res) => {
      res.json({
        permissions: Object.entries(PLATFORM_PERMISSIONS).map(([key, label]) => ({ key, label })),
        roles: Object.entries(PLATFORM_ROLES).map(([key, role]) => ({ key, label: role.label, description: role.description, rank: role.rank, permissions: role.permissions })),
      });
    }),
  );

  router.post(
    "/super-admin/admins",
    requirePlatform("admins.manage"),
    asyncRoute(async (req, res) => {
      const input = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email(), platformRole: z.enum(["OWNER", "ADMIN", "SUPPORT", "FINANCE", "ANALYST"]) }).parse(req.body);
      const db = await readDb();
      assertRecentAuth(req, db);
      const actor = actorOf(req);
      const denied = canAssignPlatformRole({ id: actor.id, platformRole: actor.role }, null, input.platformRole);
      if (denied) throw httpError(denied, 403);
      const password = tempPassword();
      const user = await createUser({ name: input.name, email: input.email, password, role: "SUPER_ADMIN" });
      user.platformRole = input.platformRole;
      await updateDb((next) => {
        if (next.users.some((u) => u.email === user.email)) throw httpError("Bu email bilan foydalanuvchi mavjud.", 409);
        next.users.push(user);
      });
      await platformAudit({ req, action: "admin.create", entity: "admin", entityId: user.id, summary: `Platforma administratori qo‘shildi: ${user.email} (${input.platformRole})`, privileged: true });
      res.status(201).json({ id: user.id, email: user.email, password });
    }),
  );

  router.patch(
    "/super-admin/admins/:id",
    requirePlatform("admins.manage"),
    asyncRoute(async (req, res) => {
      const { platformRole } = z.object({ platformRole: z.enum(["OWNER", "ADMIN", "SUPPORT", "FINANCE", "ANALYST"]) }).parse(req.body);
      assertRecentAuth(req, await readDb());
      const actor = actorOf(req);
      const result = await updateDb((db) => {
        const target = db.users.find((u) => u.id === req.params.id && u.role === "SUPER_ADMIN");
        if (!target) throw httpError("Administrator topilmadi.", 404);
        const denied = canAssignPlatformRole({ id: actor.id, platformRole: actor.role }, target, platformRole as PlatformRole);
        if (denied) throw httpError(denied, 403);
        const before = platformRoleOf(target.platformRole);
        // Kamida bitta Owner qolishi shart.
        if (before === "OWNER" && platformRole !== "OWNER" && db.users.filter((u) => u.role === "SUPER_ADMIN" && !u.blockedAt && platformRoleOf(u.platformRole) === "OWNER").length <= 1)
          throw httpError("Platformada kamida bitta Owner qolishi kerak.", 409);
        target.platformRole = platformRole as PlatformRole;
        return { target, before };
      });
      await platformAudit({ req, action: "admin.role_change", entity: "admin", entityId: result.target.id, summary: `${result.target.email}: ${result.before} → ${platformRole}`, privileged: true });
      void recordSecurityEvent({ type: "ROLE_CHANGED", severity: "HIGH", userId: result.target.id, subject: `${result.before} → ${platformRole}`, req });
      res.json(userRow(await readDb(), result.target));
    }),
  );

  const blockAdmin = (blocked: boolean) =>
    asyncRoute(async (req, res) => {
      const { reason } = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body);
      assertRecentAuth(req, await readDb());
      const actor = actorOf(req);
      const target = await updateDb((db) => {
        const row = db.users.find((u) => u.id === req.params.id && u.role === "SUPER_ADMIN");
        if (!row) throw httpError("Administrator topilmadi.", 404);
        if (row.id === actor.id) throw httpError("O‘zingizni bloklay olmaysiz.", 409);
        const denied = canAssignPlatformRole({ id: actor.id, platformRole: actor.role }, row, platformRoleOf(row.platformRole));
        if (denied && actor.role !== "OWNER") throw httpError(denied, 403);
        if (blocked && platformRoleOf(row.platformRole) === "OWNER" && db.users.filter((u) => u.role === "SUPER_ADMIN" && !u.blockedAt && platformRoleOf(u.platformRole) === "OWNER").length <= 1)
          throw httpError("Oxirgi Owner bloklanmaydi.", 409);
        const now = new Date().toISOString();
        row.blockedAt = blocked ? now : undefined;
        row.blockedBy = blocked ? actor.name : undefined;
        row.blockReason = blocked ? reason : undefined;
        if (blocked) for (const s of db.panelSessions) if (s.userId === row.id && !s.revokedAt) s.revokedAt = now;
        return row;
      });
      await platformAudit({ req, action: blocked ? "admin.block" : "admin.unblock", entity: "admin", entityId: target.id, summary: `${target.email}${blocked ? " bloklandi" : " blokdan chiqarildi"}`, privileged: true });
      res.json(userRow(await readDb(), target));
    });
  router.post("/super-admin/admins/:id/block", requirePlatform("admins.manage"), blockAdmin(true));
  router.post("/super-admin/admins/:id/unblock", requirePlatform("admins.manage"), blockAdmin(false));

  /** Qayta autentifikatsiya: xavfli amallar oldidan parol (10 daqiqa amal qiladi). */
  router.post(
    "/super-admin/reauth",
    requirePlatform(),
    asyncRoute(async (req, res) => {
      const { password } = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
      const user = req.platform!.user;
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        void recordSecurityEvent({ type: "REAUTH_FAILED", severity: "MEDIUM", userId: user.id, email: user.email, req });
        throw httpError("Parol noto‘g‘ri.", 401);
      }
      markReauthenticated(req);
      res.json({ ok: true });
    }),
  );

  return router;
}
