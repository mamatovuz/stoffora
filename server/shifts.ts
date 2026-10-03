import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, dataIndexes, readDb, updateDb } from "../lib/store";
import { canAny } from "../lib/permissions";
import { tashkentIsoDate } from "../lib/format";
import { dayPlan } from "../lib/schedule";
import type { Database, Employee, ShiftTemplate } from "../lib/types";
import type { AuthedRequest } from "./auth";
import { assertMonthOpen } from "./payroll-workflow";

/*
 * Shift Planner: HR yoki filial rahbari kalendarda xodimlarga smena qo‘yadi.
 *   • Smena shablonlari (Kunduzgi 09–18, Kechki 14–22, Tungi 22–07…).
 *   • Katakka smena / dam olish qo‘yish yoki odatiy grafikka qaytarish (scheduleOverrides orqali —
 *     kechikish, kelmaslik, ish haqi shu rejadan hisoblanadi).
 *   • Almashinuv namunalari: 5/2, 6/1, 2/2, 3/3, 1/1 — tanlangan davrga avtomatik.
 * Yopilgan oy kunlariga tegilmaydi. Xodimga «grafigingiz yangilandi» xabari boradi.
 */

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req as AuthedRequest, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana noto‘g‘ri.");
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Vaqt HH:MM bo‘lsin.");
const nameOf = (e: Pick<Employee, "firstName" | "lastName">) => `${e.firstName} ${e.lastName}`.trim();
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dmy = (iso: string) => iso.split("-").reverse().join(".");

export const PATTERNS: Record<string, { work: number; rest: number; label: string }> = {
  "5/2": { work: 5, rest: 2, label: "5 kun ish / 2 kun dam" },
  "6/1": { work: 6, rest: 1, label: "6 kun ish / 1 kun dam" },
  "2/2": { work: 2, rest: 2, label: "2 kun ish / 2 kun dam" },
  "3/3": { work: 3, rest: 3, label: "3 kun ish / 3 kun dam" },
  "1/1": { work: 1, rest: 1, label: "Kun ora (1/1)" },
  "4/2": { work: 4, rest: 2, label: "4 kun ish / 2 kun dam" },
};
export const DEFAULT_TEMPLATES = [
  { name: "Kunduzgi", start: "09:00", end: "18:00", color: "#2563eb" },
  { name: "Ertalabki", start: "08:00", end: "17:00", color: "#0891b2" },
  { name: "Kechki", start: "14:00", end: "22:00", color: "#7c3aed" },
  { name: "Tungi", start: "22:00", end: "07:00", color: "#334155" },
];

const scopeOf = (req: AuthedRequest, db: Database) =>
  req.session!.role === "BRANCH_MANAGER" ? new Set(db.users.find((u) => u.id === req.session!.userId)?.branchIds || []) : null;

function templatesOf(db: Database, companyId: string): ShiftTemplate[] {
  const own = db.shiftTemplates.filter((t) => t.companyId === companyId);
  return own.length ? own : DEFAULT_TEMPLATES.map((t, i) => ({ id: `default-${i}`, companyId, ...t }));
}

/** Bitta katakni o‘rnatadi (updateDb ichida). value: shablon / null (dam olish) / "reset" (odatiy grafik). */
export function setCell(db: Database, employee: Employee, date: string, value: { start: string; end: string; name: string } | null | "reset", actor: string) {
  assertMonthOpen(db, employee.companyId, date);
  db.scheduleOverrides = db.scheduleOverrides.filter((o) => !(o.employeeId === employee.id && o.date === date));
  if (value === "reset") return;
  db.scheduleOverrides.push({
    id: randomUUID(),
    companyId: employee.companyId,
    employeeId: employee.id,
    date,
    working: Boolean(value),
    start: value ? value.start : undefined,
    end: value ? value.end : undefined,
    reason: value ? `Smena rejasi: ${value.name} (${actor})` : `Smena rejasi: dam olish (${actor})`,
  });
}

function notifyChanged(db: Database, employees: Employee[], from: string, to: string) {
  const now = new Date().toISOString();
  for (const e of employees)
    db.notifications.unshift({
      id: randomUUID(),
      companyId: e.companyId,
      employeeId: e.id,
      title: "Ish grafigingiz yangilandi",
      body: from === to ? `${dmy(from)} kungi smena o‘zgardi.` : `${dmy(from)} – ${dmy(to)} oralig‘idagi smenalar yangilandi.`,
      type: "ATTENDANCE",
      read: false,
      createdAt: now,
      go: "schedule",
    });
}

export function createShiftRouter() {
  const router = Router();
  const permit = (req: Request, res: Response, next: NextFunction) =>
    canAny((req as AuthedRequest).session!.role, ["attendance.edit"]) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  const employeesFor = (req: AuthedRequest, db: Database, ids?: string[]) => {
    const scope = scopeOf(req, db);
    return db.employees.filter((e) => e.companyId === req.session!.companyId && e.status === "ACTIVE" && (!scope || scope.has(e.branchId)) && (!ids || ids.includes(e.id)));
  };

  router.get(
    "/shift-planner",
    permit,
    route(async (req, res) => {
      const db = await readDb();
      const from = dateSchema.parse(String(req.query.from || tashkentIsoDate()));
      const days = Math.min(42, Math.max(1, Number(req.query.days) || 7));
      const branchId = req.query.branchId ? String(req.query.branchId) : "";
      const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
      const index = dataIndexes(db);
      const employees = employeesFor(req, db)
        .filter((e) => !branchId || e.branchId === branchId)
        .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      res.json({
        dates,
        templates: templatesOf(db, req.session!.companyId!),
        patterns: Object.entries(PATTERNS).map(([key, p]) => ({ key, label: p.label })),
        holidays: db.holidays.filter((h) => h.companyId === req.session!.companyId && h.date >= dates[0] && h.date <= dates[dates.length - 1]).map((h) => ({ date: h.date, title: h.title, dayOff: h.dayOff })),
        rows: employees.map((e) => {
          const leaves = index.approvedLeaveByEmployee.get(e.id) || [];
          return {
            employeeId: e.id,
            name: nameOf(e),
            branch: db.branches.find((b) => b.id === e.branchId)?.name || "",
            position: db.positions.find((p) => p.id === e.positionId)?.name || "",
            cells: dates.map((date) => {
              const plan = dayPlan(db, e, date);
              const leave = leaves.find((l) => l.startDate <= date && l.endDate >= date);
              return { date, working: plan.enabled, start: plan.start, end: plan.end, overridden: plan.overridden, reason: plan.reason, leave: leave?.type };
            }),
          };
        }),
        // Kunlik yig‘indi: rejada nechta xodim.
        coverage: dates.map((date) => ({ date, planned: employees.filter((e) => dayPlan(db, e, date).enabled).length })),
      });
    }),
  );

  router.put(
    "/shift-planner/cell",
    permit,
    route(async (req, res) => {
      const input = z
        .object({ employeeId: z.string().min(1), dates: z.array(dateSchema).min(1).max(62), templateId: z.string().optional(), start: timeSchema.optional(), end: timeSchema.optional(), mode: z.enum(["shift", "off", "reset"]) })
        .parse(req.body);
      await updateDb((db) => {
        const employee = employeesFor(req, db, [input.employeeId])[0];
        if (!employee) throw httpError("Xodim topilmadi.", 404);
        let value: { start: string; end: string; name: string } | null | "reset" = input.mode === "reset" ? "reset" : null;
        if (input.mode === "shift") {
          const t = templatesOf(db, employee.companyId).find((x) => x.id === input.templateId);
          if (t) value = { start: t.start, end: t.end, name: t.name };
          else if (input.start && input.end) value = { start: input.start, end: input.end, name: `${input.start}–${input.end}` };
          else throw httpError("Smenani tanlang.", 422);
        }
        const dates = [...new Set(input.dates)].sort();
        for (const date of dates) setCell(db, employee, date, value, req.session!.name);
        notifyChanged(db, [employee], dates[0], dates[dates.length - 1]);
        db.auditLogs.unshift(
          audit(employee.companyId, req.session!.name, `Smena rejasi: ${nameOf(employee)} — ${dates.map(dmy).join(", ").slice(0, 120)} → ${input.mode === "reset" ? "odatiy grafik" : input.mode === "off" ? "dam olish" : (value as { name: string }).name}`, "employee", employee.id),
        );
      });
      res.json({ ok: true });
    }),
  );

  router.post(
    "/shift-planner/pattern",
    permit,
    route(async (req, res) => {
      const input = z
        .object({
          employeeIds: z.array(z.string()).min(1).max(500),
          from: dateSchema,
          to: dateSchema,
          pattern: z.enum(Object.keys(PATTERNS) as [string, ...string[]]),
          templateId: z.string().min(1),
          /** Namunaning qaysi kunidan boshlanadi (0 — birinchi ish kuni). */
          offset: z.coerce.number().int().min(0).max(30).default(0),
        })
        .parse(req.body);
      if (input.to < input.from) throw httpError("Tugash sanasi boshlanishdan oldin.", 422);
      const span = Math.round((Date.parse(input.to) - Date.parse(input.from)) / 86_400_000) + 1;
      if (span > 93) throw httpError("Ko‘pi bilan 3 oyga reja tuzish mumkin.", 422);
      const p = PATTERNS[input.pattern];
      const changed = await updateDb((db) => {
        const employees = employeesFor(req, db, input.employeeIds);
        if (!employees.length) throw httpError("Xodimlar topilmadi.", 404);
        const t = templatesOf(db, employees[0].companyId).find((x) => x.id === input.templateId);
        if (!t) throw httpError("Smena shablonini tanlang.", 422);
        let cells = 0;
        for (const e of employees)
          for (let i = 0; i < span; i += 1) {
            const date = addDays(input.from, i);
            const cycle = (i + input.offset) % (p.work + p.rest);
            setCell(db, e, date, cycle < p.work ? { start: t.start, end: t.end, name: t.name } : null, req.session!.name);
            cells += 1;
          }
        notifyChanged(db, employees, input.from, input.to);
        db.auditLogs.unshift(audit(employees[0].companyId, req.session!.name, `Smena namunasi ${input.pattern} (${t.name}): ${employees.length} xodim, ${dmy(input.from)} – ${dmy(input.to)}`, "company", employees[0].companyId));
        return cells;
      });
      res.json({ ok: true, cells: changed });
    }),
  );

  router.get(
    "/shift-templates",
    permit,
    route(async (req, res) => {
      const db = await readDb();
      res.json(templatesOf(db, req.session!.companyId!));
    }),
  );
  router.post(
    "/shift-templates",
    permit,
    route(async (req, res) => {
      const input = z.object({ name: z.string().trim().min(2).max(40), start: timeSchema, end: timeSchema, color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#2563eb") }).parse(req.body);
      const row = await updateDb((db) => {
        const tenant = req.session!.companyId!;
        // Birinchi o‘z shabloni qo‘shilganda standartlari ham saqlanadi (yo‘qolib qolmasin).
        if (!db.shiftTemplates.some((t) => t.companyId === tenant)) for (const d of DEFAULT_TEMPLATES) db.shiftTemplates.push({ id: randomUUID(), companyId: tenant, ...d });
        const value = { id: randomUUID(), companyId: tenant, ...input };
        db.shiftTemplates.push(value);
        return value;
      });
      res.status(201).json(row);
    }),
  );
  router.delete(
    "/shift-templates/:id",
    permit,
    route(async (req, res) => {
      await updateDb((db) => {
        db.shiftTemplates = db.shiftTemplates.filter((t) => !(t.id === req.params.id && t.companyId === req.session!.companyId));
      });
      res.json({ ok: true });
    }),
  );
  return router;
}
