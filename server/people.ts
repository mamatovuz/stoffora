import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { can, canAny } from "../lib/permissions";
import { tashkentIsoDate } from "../lib/format";
import { syncStaffRoles } from "../lib/staff-roles";
import type { Database, Employee } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";
import { salarySnapshot } from "./advances";

/*
 * HR asoslari:
 *   • Ta’til balansi — yillik kun (kompaniya qoidasi yoki xodimga alohida), ishlatilgan, kutilayotgan, qolgan.
 *   • Kompaniya kalendari — bayramlar (dam olish kuni → grafikda ish kuni emas) va tadbirlar.
 *   • Offboarding — ishdan bo‘shatishda: telefon va sessiyalar bekor, kelajak smenalari va kutilayotgan
 *     so‘rovlar bekor, panel huquqi o‘chadi, yakuniy hisob-kitob ko‘rsatiladi.
 *   • Onboarding — qo‘lda belgilanadigan qadamlar (IT qurilma berdi, rahbar tanishtirdi, o‘qitish).
 *   • Filialga o‘tkazish — doimiy yoki vaqtinchalik (muddat tugagach avtomatik qaytadi).
 */

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req as AuthedRequest, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana noto‘g‘ri.");
const nameOf = (e?: Pick<Employee, "firstName" | "lastName">) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
const dmy = (iso: string) => iso.split("-").reverse().join(".");
const DEFAULT_ANNUAL = 21;

const scopeOf = (req: AuthedRequest, db: Database) =>
  req.session!.role === "BRANCH_MANAGER" ? new Set(db.users.find((u) => u.id === req.session!.userId)?.branchIds || []) : null;

/* ======================================================== ta’til balansi === */
const overlapDays = (start: string, end: string, from: string, to: string) => {
  const a = start > from ? start : from;
  const b = end < to ? end : to;
  return b < a ? 0 : Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
};

export function leaveBalance(db: Database, employee: Employee, year = Number(tashkentIsoDate().slice(0, 4))) {
  const company = db.companies.find((c) => c.id === employee.companyId);
  const annual = employee.annualLeaveDays ?? company?.leavePolicy?.annualDays ?? DEFAULT_ANNUAL;
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  // Shu yil ishga kirgan bo‘lsa — ishlagan oylariga mutanosib.
  const startYear = Number(employee.startDate?.slice(0, 4) || year);
  const months = startYear === year ? 12 - Number(employee.startDate.slice(5, 7)) + 1 : 12;
  const entitled = startYear > year ? 0 : Math.round((annual * Math.min(12, Math.max(0, months))) / 12);
  const vacations = db.leaveRequests.filter((l) => l.employeeId === employee.id && l.type === "VACATION");
  const used = vacations.filter((l) => l.status === "APPROVED").reduce((s, l) => s + overlapDays(l.startDate, l.endDate, from, to), 0);
  const pending = vacations.filter((l) => l.status === "PENDING").reduce((s, l) => s + overlapDays(l.startDate, l.endDate, from, to), 0);
  return { year, annual, entitled, used, pending, remaining: entitled - used - pending };
}

/* ========================================================== offboarding === */
/** Ishdan bo‘shatishda avtomatik qadamlar (updateDb ichida). Natija — bajarilgan ishlar ro‘yxati. */
export function offboard(db: Database, employee: Employee, date: string, actor: string) {
  const now = new Date().toISOString();
  const done: string[] = [];
  // 1. Telefonlar va mobil sessiyalar.
  let devices = 0;
  for (const d of db.mobileDevices)
    if (d.employeeId === employee.id && d.status === "ACTIVE") {
      d.status = "REVOKED";
      d.revokedAt = now;
      d.revokedBy = actor;
      d.revokeReason = "Ishdan bo‘shatildi";
      devices += 1;
    }
  for (const s of db.mobileSessions) if (s.employeeId === employee.id && !s.revokedAt) s.revokedAt = now;
  for (const t of db.mobilePushTokens) if (t.employeeId === employee.id) t.active = false;
  for (const c of db.mobileActivationCodes) if (c.employeeId === employee.id && !c.usedAt && !c.revokedAt) c.revokedAt = now;
  for (const b of db.biometricDevices) if (b.employeeId === employee.id && !b.revokedAt) b.revokedAt = now;
  done.push(devices ? `${devices} ta telefon va barcha sessiyalar bekor qilindi` : "Mobil sessiyalar bekor qilindi");
  // 2. Kelajak smena o‘zgarishlari.
  const before = db.scheduleOverrides.length;
  db.scheduleOverrides = db.scheduleOverrides.filter((o) => !(o.employeeId === employee.id && o.date > date));
  if (before !== db.scheduleOverrides.length) done.push(`${before - db.scheduleOverrides.length} ta kelajak smena o‘zgarishi olib tashlandi`);
  // 3. Kutilayotgan so‘rovlar.
  let cancelled = 0;
  for (const l of db.leaveRequests) if (l.employeeId === employee.id && l.status === "PENDING") (l.status = "CANCELLED"), (cancelled += 1);
  for (const a of db.advanceRequests) if (a.employeeId === employee.id && (a.status === "PENDING" || a.status === "HR_APPROVED")) (a.status = "CANCELLED"), (a.updatedAt = now), (cancelled += 1);
  for (const c of db.attendanceCorrections) if (c.employeeId === employee.id && c.status === "PENDING") (c.status = "CANCELLED"), (c.updatedAt = now), (cancelled += 1);
  for (const m of db.dayOffMoves) if (m.employeeId === employee.id && m.status === "PENDING") (m.status = "CANCELLED"), (m.updatedAt = now), (cancelled += 1);
  for (const s of db.shiftSwaps)
    if ((s.requesterId === employee.id || s.colleagueId === employee.id) && (s.status === "PENDING_COLLEAGUE" || s.status === "PENDING_MANAGER")) (s.status = "CANCELLED"), (s.updatedAt = now), (cancelled += 1);
  for (const r of db.deviceChangeRequests) if (r.employeeId === employee.id && r.status === "PENDING") (r.status = "CANCELLED"), (cancelled += 1);
  if (cancelled) done.push(`${cancelled} ta kutilayotgan so‘rov bekor qilindi`);
  // 4. Vaqtinchalik o‘tkazishlar.
  for (const t of db.branchTransfers) if (t.employeeId === employee.id && (t.status === "PLANNED" || t.status === "ACTIVE")) t.status = "CANCELLED";
  // 5. Filial rahbari bo‘lsa — olib tashlanadi; panel huquqi (avtomatik) o‘chadi.
  for (const b of db.branches) if (b.managerEmployeeIds?.includes(employee.id)) b.managerEmployeeIds = b.managerEmployeeIds.filter((id) => id !== employee.id);
  syncStaffRoles(db, employee.companyId);
  done.push("Panel / rahbar huquqlari o‘chirildi");
  // 6. Qaytarilmagan aktivlar (aktivlar moduli bo‘lsa).
  const assets = db.assets.filter((a) => a.employeeId === employee.id && a.status === "ISSUED");
  return { done, unreturnedAssets: assets.map((a) => ({ id: a.id, name: a.name, code: a.code })) };
}

/* ============================================================== onboarding === */
export const MANUAL_STEPS: Record<string, string> = {
  itDevice: "IT ish qurilmasi / kirish huquqlarini berdi",
  introduced: "Rahbar jamoa va ish joyi bilan tanishtirdi",
  training: "Boshlang‘ich o‘qitish (training) o‘tildi",
};

/* =========================================================== o‘tkazishlar === */
/** Kunlik: rejalangan o‘tkazishni boshlaydi, vaqtinchalik muddati tugaganini qaytaradi. updateDb ichida. */
export function applyTransfers(db: Database, today = tashkentIsoDate()) {
  let changed = 0;
  for (const t of db.branchTransfers) {
    const e = db.employees.find((x) => x.id === t.employeeId);
    if (!e || e.status !== "ACTIVE") continue;
    if (t.status === "PLANNED" && t.startDate <= today) {
      e.branchId = t.toBranchId;
      e.updatedAt = new Date().toISOString();
      t.status = t.temporary ? "ACTIVE" : "DONE";
      db.auditLogs.unshift(audit(t.companyId, t.createdBy, `Filialga o‘tkazildi: ${branchName(db, t.fromBranchId)} → ${branchName(db, t.toBranchId)}${t.temporary ? ` (vaqtincha, ${dmy(t.endDate!)} gacha)` : ""}`, "employee", e.id, { branchId: t.fromBranchId }, { branchId: t.toBranchId }));
      changed += 1;
    } else if (t.status === "ACTIVE" && t.temporary && t.endDate && t.endDate < today) {
      e.branchId = t.fromBranchId;
      e.updatedAt = new Date().toISOString();
      t.status = "DONE";
      db.auditLogs.unshift(audit(t.companyId, "Tizim", `Vaqtinchalik o‘tkazish tugadi: ${branchName(db, t.toBranchId)} → ${branchName(db, t.fromBranchId)}`, "employee", e.id, { branchId: t.toBranchId }, { branchId: t.fromBranchId }));
      changed += 1;
    }
  }
  if (changed) for (const companyId of new Set(db.branchTransfers.map((t) => t.companyId))) syncStaffRoles(db, companyId);
  return changed;
}
const branchName = (db: Database, id: string) => db.branches.find((b) => b.id === id)?.name || "—";

/* ================================================================ panel === */
export function createPeopleRouter() {
  const router = Router();
  const permit = (...permissions: string[]) => (req: Request, res: Response, next: NextFunction) =>
    canAny((req as AuthedRequest).session!.role, permissions) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  const ownEmployee = (req: AuthedRequest, db: Database, id: string) => {
    const e = db.employees.find((x) => x.id === id && x.companyId === req.session!.companyId);
    const scope = scopeOf(req, db);
    if (!e || (scope && !scope.has(e.branchId))) throw httpError("Xodim topilmadi.", 404);
    return e;
  };

  // --- ta’til balansi
  router.get(
    "/employees/:id/leave-balance",
    permit("employees.view", "leave.view"),
    route(async (req, res) => {
      const db = await readDb();
      res.json(leaveBalance(db, ownEmployee(req, db, String(req.params.id))));
    }),
  );
  router.get(
    "/leave-balances",
    permit("leave.view", "employees.edit"),
    route(async (req, res) => {
      const db = await readDb();
      const scope = scopeOf(req, db);
      res.json({
        policy: { annualDays: db.companies.find((c) => c.id === req.session!.companyId)?.leavePolicy?.annualDays ?? DEFAULT_ANNUAL },
        rows: db.employees
          .filter((e) => e.companyId === req.session!.companyId && e.status === "ACTIVE" && (!scope || scope.has(e.branchId)))
          .map((e) => ({ employeeId: e.id, name: nameOf(e), branch: branchName(db, e.branchId), custom: e.annualLeaveDays !== undefined, ...leaveBalance(db, e) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      });
    }),
  );
  router.put(
    "/company/leave-policy",
    permit("employees.edit", "settings.manage"),
    route(async (req, res) => {
      const { annualDays } = z.object({ annualDays: z.coerce.number().int().min(0).max(90) }).parse(req.body);
      await updateDb((db) => {
        const company = db.companies.find((c) => c.id === req.session!.companyId);
        if (!company) throw httpError("Kompaniya topilmadi.", 404);
        company.leavePolicy = { annualDays };
        db.auditLogs.unshift(audit(company.id, req.session!.name, `Yillik ta’til: ${annualDays} kun`, "company", company.id));
      });
      res.json({ annualDays });
    }),
  );
  router.put(
    "/employees/:id/leave-days",
    permit("employees.edit"),
    route(async (req, res) => {
      const { days } = z.object({ days: z.union([z.coerce.number().int().min(0).max(90), z.null()]) }).parse(req.body);
      const out = await updateDb((db) => {
        const e = ownEmployee(req, db, String(req.params.id));
        e.annualLeaveDays = days ?? undefined;
        db.auditLogs.unshift(audit(e.companyId, req.session!.name, `Yillik ta’til (alohida): ${days ?? "kompaniya qoidasi"}`, "employee", e.id));
        return leaveBalance(db, e);
      });
      res.json(out);
    }),
  );

  // --- kalendar
  router.get(
    "/calendar/events",
    route(async (req, res) => {
      const db = await readDb();
      const month = z.string().regex(/^\d{4}-\d{2}$/).parse(String(req.query.month || tashkentIsoDate().slice(0, 7)));
      const tenant = req.session!.companyId!;
      const scope = scopeOf(req, db);
      const from = `${month}-01`;
      const to = `${month}-31`;
      const showLeave = canAny(req.session!.role, ["leave.view", "attendance.view"]);
      res.json({
        holidays: db.holidays.filter((h) => h.companyId === tenant && h.date >= from && h.date <= to).sort((a, b) => a.date.localeCompare(b.date)),
        leaves: showLeave
          ? db.leaveRequests
              .filter((l) => l.companyId === tenant && l.status === "APPROVED" && l.startDate <= to && l.endDate >= from)
              .map((l) => ({ l, e: db.employees.find((x) => x.id === l.employeeId) }))
              .filter(({ e }) => e && (!scope || scope.has(e.branchId)))
              .map(({ l, e }) => ({ id: l.id, employeeId: e!.id, name: nameOf(e), type: l.type, startDate: l.startDate, endDate: l.endDate }))
          : [],
        birthdays: db.employees
          .filter((e) => e.companyId === tenant && e.status === "ACTIVE" && e.birthDate?.slice(5, 7) === month.slice(5) && (!scope || scope.has(e.branchId)))
          .map((e) => ({ employeeId: e.id, name: nameOf(e), date: `${month}-${e.birthDate!.slice(8, 10)}` })),
      });
    }),
  );
  router.post(
    "/holidays",
    permit("employees.edit", "settings.manage"),
    route(async (req, res) => {
      const input = z
        .object({
          date: dateSchema,
          endDate: dateSchema.optional(),
          title: z.string().trim().min(2).max(120),
          kind: z.enum(["HOLIDAY", "EVENT"]).default("HOLIDAY"),
          dayOff: z.boolean().default(true),
          branchIds: z.array(z.string()).max(200).optional(),
        })
        .parse(req.body);
      const end = input.endDate && input.endDate >= input.date ? input.endDate : input.date;
      const created = await updateDb((db) => {
        const tenant = req.session!.companyId!;
        const out = [];
        for (let d = input.date; d <= end; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
          const row = {
            id: randomUUID(),
            companyId: tenant,
            date: d,
            title: input.title,
            kind: input.kind,
            dayOff: input.kind === "HOLIDAY" ? input.dayOff : false,
            branchIds: input.branchIds?.length ? input.branchIds.filter((id) => db.branches.some((b) => b.id === id && b.companyId === tenant)) : undefined,
            createdBy: req.session!.name,
            createdAt: new Date().toISOString(),
          };
          db.holidays.push(row);
          out.push(row);
          if (out.length > 31) break;
        }
        db.auditLogs.unshift(audit(tenant, req.session!.name, `Kalendar: ${input.title} (${dmy(input.date)}${end !== input.date ? ` – ${dmy(end)}` : ""})`, "company", tenant));
        // Xodimlarga e’lon (bayram dam olish kuni bo‘lsa).
        if (input.kind === "HOLIDAY" && input.dayOff)
          for (const e of db.employees.filter((x) => x.companyId === tenant && x.status === "ACTIVE" && (!input.branchIds?.length || input.branchIds.includes(x.branchId))))
            db.notifications.unshift({
              id: randomUUID(),
              companyId: tenant,
              employeeId: e.id,
              title: `🎉 ${input.title}`,
              body: `${dmy(input.date)}${end !== input.date ? ` – ${dmy(end)}` : ""} — dam olish kuni.`,
              type: "ANNOUNCEMENT",
              read: false,
              createdAt: new Date().toISOString(),
              go: "calendar",
            });
        return out;
      });
      res.status(201).json(created);
    }),
  );
  router.delete(
    "/holidays/:id",
    permit("employees.edit", "settings.manage"),
    route(async (req, res) => {
      await updateDb((db) => {
        const row = db.holidays.find((h) => h.id === req.params.id && h.companyId === req.session!.companyId);
        if (!row) throw httpError("Topilmadi.", 404);
        db.holidays = db.holidays.filter((h) => h.id !== row.id);
        db.auditLogs.unshift(audit(row.companyId, req.session!.name, `Kalendardan olib tashlandi: ${row.title} (${dmy(row.date)})`, "company", row.companyId));
      });
      res.json({ ok: true });
    }),
  );

  // --- onboarding (qo‘lda qadamlar)
  router.post(
    "/employees/:id/onboarding",
    permit("employees.edit", "devices.manage"),
    route(async (req, res) => {
      const { key, done } = z.object({ key: z.enum(Object.keys(MANUAL_STEPS) as [string, ...string[]]), done: z.boolean() }).parse(req.body);
      if (key === "itDevice" ? false : !can(req.session!.role, "employees.edit")) throw httpError("Bu qadamni HR belgilaydi.", 403);
      await updateDb((db) => {
        const e = ownEmployee(req, db, String(req.params.id));
        e.onboardingManual = { ...e.onboardingManual, [key]: { done, by: req.session!.name, at: new Date().toISOString() } };
        db.auditLogs.unshift(audit(e.companyId, req.session!.name, `Onboarding: ${MANUAL_STEPS[key]} — ${done ? "bajarildi" : "bekor"}`, "employee", e.id));
      });
      res.json({ ok: true });
    }),
  );

  // --- filialga o‘tkazish
  router.get(
    "/employees/:id/transfers",
    permit("employees.view"),
    route(async (req, res) => {
      const db = await readDb();
      const e = ownEmployee(req, db, String(req.params.id));
      res.json(
        db.branchTransfers
          .filter((t) => t.employeeId === e.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((t) => ({ ...t, from: branchName(db, t.fromBranchId), to: branchName(db, t.toBranchId) })),
      );
    }),
  );
  router.post(
    "/employees/:id/transfer",
    permit("employees.edit"),
    route(async (req, res) => {
      const input = z
        .object({ toBranchId: z.string().min(1), startDate: dateSchema, endDate: dateSchema.optional(), temporary: z.boolean().default(false), reason: z.string().trim().max(300).optional() })
        .parse(req.body);
      if (input.temporary && (!input.endDate || input.endDate < input.startDate)) throw httpError("Vaqtinchalik o‘tkazish uchun tugash sanasini kiriting.", 422);
      const out = await updateDb((db) => {
        const e = ownEmployee(req, db, String(req.params.id));
        if (e.status !== "ACTIVE") throw httpError("Xodim faol emas.", 409);
        if (!db.branches.some((b) => b.id === input.toBranchId && b.companyId === e.companyId)) throw httpError("Filial topilmadi.", 404);
        if (input.toBranchId === e.branchId) throw httpError("Xodim allaqachon shu filialda.", 409);
        if (db.branchTransfers.some((t) => t.employeeId === e.id && (t.status === "PLANNED" || t.status === "ACTIVE"))) throw httpError("Bu xodimda faol o‘tkazish bor — avval uni bekor qiling.", 409);
        const row = {
          id: randomUUID(),
          companyId: e.companyId,
          employeeId: e.id,
          fromBranchId: e.branchId,
          toBranchId: input.toBranchId,
          startDate: input.startDate,
          endDate: input.temporary ? input.endDate : undefined,
          temporary: input.temporary,
          reason: input.reason,
          status: "PLANNED" as const,
          createdBy: req.session!.name,
          createdAt: new Date().toISOString(),
        };
        db.branchTransfers.push(row);
        applyTransfers(db);
        db.notifications.unshift({
          id: randomUUID(),
          companyId: e.companyId,
          employeeId: e.id,
          title: input.temporary ? "Vaqtincha boshqa filialga o‘tkazildingiz" : "Filialingiz o‘zgardi",
          body: `${branchName(db, row.fromBranchId)} → ${branchName(db, row.toBranchId)} · ${dmy(row.startDate)} dan${row.endDate ? ` ${dmy(row.endDate)} gacha` : ""}`,
          type: "ATTENDANCE",
          read: false,
          createdAt: row.createdAt,
          go: "profile",
        });
        return row;
      });
      res.status(201).json(out);
    }),
  );
  router.post(
    "/transfers/:id/cancel",
    permit("employees.edit"),
    route(async (req, res) => {
      await updateDb((db) => {
        const t = db.branchTransfers.find((x) => x.id === req.params.id && x.companyId === req.session!.companyId);
        if (!t) throw httpError("Topilmadi.", 404);
        if (t.status === "ACTIVE") {
          const e = db.employees.find((x) => x.id === t.employeeId);
          if (e) e.branchId = t.fromBranchId;
        } else if (t.status !== "PLANNED") throw httpError("O‘tkazish yakunlangan.", 409);
        t.status = "CANCELLED";
        db.auditLogs.unshift(audit(t.companyId, req.session!.name, "Filialga o‘tkazish bekor qilindi", "employee", t.employeeId));
        syncStaffRoles(db, t.companyId);
      });
      res.json({ ok: true });
    }),
  );

  // --- yakuniy hisob-kitob (offboarding oldidan ko‘rish)
  router.get(
    "/employees/:id/offboarding-preview",
    permit("employees.edit"),
    route(async (req, res) => {
      const db = await readDb();
      const e = ownEmployee(req, db, String(req.params.id));
      const snap = can(req.session!.role, "payroll.view") || req.session!.role === "COMPANY_OWNER" ? salarySnapshot(db, e) : null;
      res.json({
        devices: db.mobileDevices.filter((d) => d.employeeId === e.id && d.status === "ACTIVE").length,
        pending:
          db.leaveRequests.filter((l) => l.employeeId === e.id && l.status === "PENDING").length +
          db.advanceRequests.filter((a) => a.employeeId === e.id && (a.status === "PENDING" || a.status === "HR_APPROVED")).length +
          db.attendanceCorrections.filter((c) => c.employeeId === e.id && c.status === "PENDING").length,
        futureShifts: db.scheduleOverrides.filter((o) => o.employeeId === e.id && o.date > tashkentIsoDate()).length,
        assets: db.assets.filter((a) => a.employeeId === e.id && a.status === "ISSUED").map((a) => ({ id: a.id, name: a.name, code: a.code })),
        leave: leaveBalance(db, e),
        settlement: snap && { earnedToDate: snap.earnedToDate, advance: snap.advance, fine: snap.fine, net: snap.net },
      });
    }),
  );
  return router;
}

/* ============================================================ Mini App === */
export function createMiniPeopleRouter() {
  const router = Router();
  const session = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
  router.get(
    "/mini/leave-balance",
    route(async (req, res) => {
      const auth = session(req);
      const db = await readDb();
      const e = db.employees.find((x) => x.id === auth.employeeId && x.companyId === auth.companyId);
      if (!e) throw httpError("Xodim topilmadi.", 404);
      res.json(leaveBalance(db, e));
    }),
  );
  router.get(
    "/mini/calendar",
    route(async (req, res) => {
      const auth = session(req);
      const db = await readDb();
      const e = db.employees.find((x) => x.id === auth.employeeId && x.companyId === auth.companyId);
      if (!e) throw httpError("Xodim topilmadi.", 404);
      const today = tashkentIsoDate();
      const until = new Date(Date.parse(`${today}T12:00:00Z`) + 120 * 86_400_000).toISOString().slice(0, 10);
      res.json({
        holidays: db.holidays
          .filter((h) => h.companyId === e.companyId && h.date >= today.slice(0, 7) && h.date <= until && (!h.branchIds?.length || h.branchIds.includes(e.branchId)))
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((h) => ({ id: h.id, date: h.date, title: h.title, kind: h.kind, dayOff: h.dayOff })),
      });
    }),
  );
  return router;
}

/* ================================================================ aktivlar === */
export const ASSET_CATEGORIES = ["PHONE", "LAPTOP", "KEY", "UNIFORM", "TOOL", "OTHER"] as const;
export function createAssetRouter() {
  const router = Router();
  const permit = (...permissions: string[]) => (req: Request, res: Response, next: NextFunction) =>
    canAny((req as AuthedRequest).session!.role, permissions) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  const describe = (db: Database, a: Database["assets"][number]) => ({ ...a, employeeName: a.employeeId ? nameOf(db.employees.find((e) => e.id === a.employeeId)) : undefined });
  const find = (req: AuthedRequest, db: Database) => {
    const a = db.assets.find((x) => x.id === req.params.id && x.companyId === req.session!.companyId);
    if (!a) throw httpError("Aktiv topilmadi.", 404);
    return a;
  };
  const log = (a: Database["assets"][number], action: string, by: string, employeeId?: string) => a.history.push({ action, by, at: new Date().toISOString(), employeeId });

  router.get(
    "/assets",
    permit("devices.manage", "employees.edit"),
    route(async (req, res) => {
      const db = await readDb();
      res.json(db.assets.filter((a) => a.companyId === req.session!.companyId).map((a) => describe(db, a)).sort((a, b) => a.name.localeCompare(b.name)));
    }),
  );
  router.get(
    "/employees/:id/assets",
    permit("employees.view", "devices.manage"),
    route(async (req, res) => {
      const db = await readDb();
      const scope = scopeOf(req, db);
      const e = db.employees.find((x) => x.id === req.params.id && x.companyId === req.session!.companyId);
      if (!e || (scope && !scope.has(e.branchId))) throw httpError("Xodim topilmadi.", 404);
      res.json(db.assets.filter((a) => a.employeeId === e.id && a.status === "ISSUED").map((a) => describe(db, a)));
    }),
  );
  router.post(
    "/assets",
    permit("devices.manage", "employees.edit"),
    route(async (req, res) => {
      const input = z
        .object({
          name: z.string().trim().min(2).max(120),
          code: z.string().trim().max(60).optional(),
          category: z.enum(ASSET_CATEGORIES).default("OTHER"),
          quantity: z.coerce.number().int().min(1).max(1000).default(1),
          note: z.string().trim().max(300).optional(),
          employeeId: z.string().optional(),
        })
        .parse(req.body);
      const row = await updateDb((db) => {
        const tenant = req.session!.companyId!;
        if (input.code && db.assets.some((a) => a.companyId === tenant && a.code === input.code)) throw httpError("Bu inventar raqami band.", 409);
        const employee = input.employeeId ? db.employees.find((e) => e.id === input.employeeId && e.companyId === tenant && e.status === "ACTIVE") : undefined;
        if (input.employeeId && !employee) throw httpError("Xodim topilmadi.", 404);
        const now = new Date().toISOString();
        const asset: Database["assets"][number] = {
          id: randomUUID(),
          companyId: tenant,
          name: input.name,
          code: input.code || undefined,
          category: input.category,
          quantity: input.quantity,
          note: input.note || undefined,
          status: employee ? "ISSUED" : "IN_STOCK",
          employeeId: employee?.id,
          issuedAt: employee ? now : undefined,
          history: [],
          createdAt: now,
        };
        log(asset, employee ? `Qo‘shildi va ${nameOf(employee)}ga berildi` : "Omborga qo‘shildi", req.session!.name, employee?.id);
        db.assets.push(asset);
        db.auditLogs.unshift(audit(tenant, req.session!.name, `Aktiv: ${asset.name}${asset.code ? ` #${asset.code}` : ""}${employee ? ` → ${nameOf(employee)}` : ""}`, employee ? "employee" : "company", employee?.id || tenant));
        return describe(db, asset);
      });
      res.status(201).json(row);
    }),
  );
  router.post(
    "/assets/:id/:action",
    permit("devices.manage", "employees.edit"),
    route(async (req, res) => {
      const action = z.enum(["issue", "return", "lost"]).parse(req.params.action);
      const { employeeId, note } = z.object({ employeeId: z.string().optional(), note: z.string().trim().max(300).optional() }).parse(req.body || {});
      const row = await updateDb((db) => {
        const a = find(req, db);
        const now = new Date().toISOString();
        if (action === "issue") {
          const e = db.employees.find((x) => x.id === employeeId && x.companyId === a.companyId && x.status === "ACTIVE");
          if (!e) throw httpError("Xodimni tanlang.", 422);
          if (a.status === "ISSUED") throw httpError("Aktiv allaqachon berilgan — avval qaytarib oling.", 409);
          Object.assign(a, { status: "ISSUED", employeeId: e.id, issuedAt: now, returnedAt: undefined });
          log(a, `${nameOf(e)}ga berildi${note ? ` — ${note}` : ""}`, req.session!.name, e.id);
          db.notifications.unshift({ id: randomUUID(), companyId: a.companyId, employeeId: e.id, title: "Sizga aktiv biriktirildi", body: `${a.name}${a.code ? ` #${a.code}` : ""}`, type: "DOCUMENT", read: false, createdAt: now, go: "profile" });
        } else {
          if (a.status !== "ISSUED") throw httpError("Aktiv hech kimda emas.", 409);
          const holder = a.employeeId;
          Object.assign(a, { status: action === "return" ? "IN_STOCK" : "LOST", employeeId: undefined, returnedAt: now });
          log(a, action === "return" ? `Qaytarib olindi${note ? ` — ${note}` : ""}` : `Yo‘qolgan deb belgilandi${note ? ` — ${note}` : ""}`, req.session!.name, holder);
        }
        db.auditLogs.unshift(audit(a.companyId, req.session!.name, `Aktiv ${a.name}: ${a.history[a.history.length - 1].action}`, "company", a.companyId));
        return describe(db, a);
      });
      res.json(row);
    }),
  );
  router.delete(
    "/assets/:id",
    permit("devices.manage", "employees.edit"),
    route(async (req, res) => {
      await updateDb((db) => {
        const a = find(req, db);
        if (a.status === "ISSUED") throw httpError("Berilgan aktivni o‘chirib bo‘lmaydi — avval qaytarib oling.", 409);
        db.assets = db.assets.filter((x) => x.id !== a.id);
        db.auditLogs.unshift(audit(a.companyId, req.session!.name, `Aktiv o‘chirildi: ${a.name}`, "company", a.companyId));
      });
      res.json({ ok: true });
    }),
  );
  return router;
}
