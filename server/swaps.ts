import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, readDb, updateDb } from "../lib/store";
import { canAny } from "../lib/permissions";
import { tashkentIsoDate } from "../lib/format";
import { dayPlan } from "../lib/schedule";
import type { Database, Employee, ShiftSwapRequest } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";
import { notifyEmployee } from "./integrations/hooks";

/*
 * Smena almashish:
 *   xodim → hamkasb rozi bo‘ladi → rahbar/HR tasdiqlaydi → grafik o‘zgarishlari
 * Tasdiqlangach ikkala xodimning shu kunlardagi grafigi almashadi va kechikish,
 * kelmaslik, ish haqi hisobi yangi grafik bo‘yicha yuradi.
 */

const dmy = (iso: string) => iso.split("-").reverse().join(".");
const nameOf = (e?: Employee) => (e ? `${e.firstName} ${e.lastName}`.trim() : "—");
type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const session = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;

function describe(db: Database, swap: ShiftSwapRequest) {
  const requester = db.employees.find((e) => e.id === swap.requesterId);
  const colleague = db.employees.find((e) => e.id === swap.colleagueId);
  const give = requester ? dayPlan(db, requester, swap.giveDate) : undefined;
  const take = swap.takeDate && colleague ? dayPlan(db, colleague, swap.takeDate) : undefined;
  return {
    ...swap,
    requesterName: nameOf(requester),
    colleagueName: nameOf(colleague),
    giveShift: give?.enabled ? `${give.start}–${give.end}` : undefined,
    takeShift: take?.enabled ? `${take.start}–${take.end}` : undefined,
    branchId: requester?.branchId,
  };
}

async function notify(db: Database, employeeId: string, text: string, title: string) {
  const employee = db.employees.find((e) => e.id === employeeId && e.status === "ACTIVE");
  if (!employee) return;
  await updateDb((next) =>
    void next.notifications.unshift({
      id: randomUUID(),
      companyId: employee.companyId,
      employeeId: employee.id,
      title,
      body: text.replace(/<[^>]+>/g, ""),
      type: "ATTENDANCE",
      read: false,
      createdAt: new Date().toISOString(),
    }),
  );
  await notifyEmployee(db, employee, "attendance", text, { title, openButton: true }).catch(() => undefined);
}

/** Mini App: so‘rov yuborish, hamkasb javobi, bekor qilish. */
export function createMiniSwapRouter() {
  const router = Router();

  router.get(
    "/mini/swaps",
    route(async (req, res) => {
      const auth = session(req);
      const db = await readDb();
      const me = db.employees.find((e) => e.id === auth.employeeId);
      const swaps = db.shiftSwaps
        .filter((s) => s.companyId === auth.companyId && (s.requesterId === auth.employeeId || s.colleagueId === auth.employeeId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 30)
        .map((s) => ({ ...describe(db, s), incoming: s.colleagueId === auth.employeeId }));
      const colleagues = db.employees
        .filter((e) => e.companyId === auth.companyId && e.status === "ACTIVE" && e.id !== auth.employeeId && e.branchId === me?.branchId)
        .map((e) => ({ id: e.id, name: nameOf(e) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ swaps, colleagues });
    }),
  );

  router.post(
    "/mini/swaps",
    route(async (req, res) => {
      const auth = session(req);
      const input = z
        .object({
          colleagueId: z.string().min(1),
          giveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          takeDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
          reason: z.string().trim().max(200).optional(),
        })
        .parse(req.body);
      const today = tashkentIsoDate();
      const created = await updateDb((db) => {
        const me = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId && e.status === "ACTIVE");
        const colleague = db.employees.find((e) => e.id === input.colleagueId && e.companyId === auth.companyId && e.status === "ACTIVE");
        if (!me || !colleague) throw httpError("Hamkasb topilmadi.", 404);
        if (input.giveDate < today) throw httpError("O‘tgan kunni almashtirib bo‘lmaydi.", 422);
        if (!dayPlan(db, me, input.giveDate).enabled) throw httpError(`${dmy(input.giveDate)} — sizning ish kuningiz emas.`, 422);
        if (dayPlan(db, colleague, input.giveDate).enabled) throw httpError(`${dmy(input.giveDate)} kuni ${colleague.firstName} o‘zi ishlaydi — dam oladigan hamkasbni tanlang.`, 422);
        if (input.takeDate) {
          if (input.takeDate < today) throw httpError("O‘tgan kunni almashtirib bo‘lmaydi.", 422);
          if (!dayPlan(db, colleague, input.takeDate).enabled) throw httpError(`${dmy(input.takeDate)} — ${colleague.firstName}ning ish kuni emas.`, 422);
          if (dayPlan(db, me, input.takeDate).enabled) throw httpError(`${dmy(input.takeDate)} kuni o‘zingiz ishlaysiz.`, 422);
        }
        const busy = db.shiftSwaps.some(
          (s) =>
            s.companyId === auth.companyId &&
            ["PENDING_COLLEAGUE", "PENDING_MANAGER"].includes(s.status) &&
            (s.requesterId === me.id || s.colleagueId === me.id) &&
            (s.giveDate === input.giveDate || s.takeDate === input.giveDate),
        );
        if (busy) throw httpError("Bu kun uchun ko‘rib chiqilayotgan so‘rov bor.", 409);
        const now = new Date().toISOString();
        const swap: ShiftSwapRequest = {
          id: randomUUID(),
          companyId: auth.companyId,
          requesterId: me.id,
          colleagueId: colleague.id,
          giveDate: input.giveDate,
          takeDate: input.takeDate || undefined,
          reason: input.reason || undefined,
          status: "PENDING_COLLEAGUE",
          createdAt: now,
          updatedAt: now,
        };
        db.shiftSwaps.unshift(swap);
        db.auditLogs.unshift(audit(auth.companyId, nameOf(me), `Smena almashish so‘rovi: ${dmy(swap.giveDate)} → ${nameOf(colleague)}`, "employee", me.id));
        return { swap, me, colleague };
      });
      const db = await readDb();
      await notify(
        db,
        created.colleague.id,
        `🔄 <b>Smena almashish so‘rovi</b>\n\n${nameOf(created.me)} ${dmy(created.swap.giveDate)} kungi smenasini sizga bermoqchi${created.swap.takeDate ? `, evaziga ${dmy(created.swap.takeDate)} kuni sizning o‘rningizga ishlaydi` : ""}.${created.swap.reason ? `\nSabab: ${created.swap.reason}` : ""}\n\nStaffora ilovasida «So‘rovlar» bo‘limida javob bering.`,
        "Smena almashish so‘rovi",
      );
      res.status(201).json(describe(db, created.swap));
    }),
  );

  router.post(
    "/mini/swaps/:id/respond",
    route(async (req, res) => {
      const auth = session(req);
      const { accept } = z.object({ accept: z.boolean() }).parse(req.body);
      const swap = await updateDb((db) => {
        const row = db.shiftSwaps.find((s) => s.id === req.params.id && s.companyId === auth.companyId && s.colleagueId === auth.employeeId);
        if (!row) throw httpError("So‘rov topilmadi.", 404);
        if (row.status !== "PENDING_COLLEAGUE") throw httpError("So‘rovga allaqachon javob berilgan.", 409);
        row.status = accept ? "PENDING_MANAGER" : "REJECTED";
        row.updatedAt = new Date().toISOString();
        if (!accept) row.decidedBy = "Hamkasb rad etdi";
        if (accept)
          db.notifications.unshift({
            id: randomUUID(),
            companyId: auth.companyId,
            title: "Smena almashish — tasdiq kutilmoqda",
            body: `${nameOf(db.employees.find((e) => e.id === row.requesterId))} ↔ ${nameOf(db.employees.find((e) => e.id === row.colleagueId))}: ${dmy(row.giveDate)}${row.takeDate ? ` / ${dmy(row.takeDate)}` : ""}. Ta’til va so‘rovlar sahifasida tasdiqlang.`,
            type: "LEAVE",
            read: false,
            createdAt: row.updatedAt,
          });
        return { ...row };
      });
      const db = await readDb();
      await notify(
        db,
        swap.requesterId,
        accept
          ? `✅ Hamkasbingiz ${dmy(swap.giveDate)} kungi smena almashishga rozi bo‘ldi. Endi rahbar tasdiqlashi kerak.`
          : `❌ Hamkasbingiz ${dmy(swap.giveDate)} kungi smena almashishni rad etdi.`,
        accept ? "Hamkasb rozi bo‘ldi" : "Smena almashish rad etildi",
      );
      res.json(describe(db, swap));
    }),
  );

  router.post(
    "/mini/swaps/:id/cancel",
    route(async (req, res) => {
      const auth = session(req);
      await updateDb((db) => {
        const row = db.shiftSwaps.find((s) => s.id === req.params.id && s.companyId === auth.companyId && s.requesterId === auth.employeeId);
        if (!row) throw httpError("So‘rov topilmadi.", 404);
        if (!["PENDING_COLLEAGUE", "PENDING_MANAGER"].includes(row.status)) throw httpError("Bu so‘rovni bekor qilib bo‘lmaydi.", 409);
        row.status = "CANCELLED";
        row.updatedAt = new Date().toISOString();
      });
      res.json({ ok: true });
    }),
  );
  return router;
}

/** Panel: rahbar/HR tasdiqlaydi. */
export function createSwapRouter() {
  const router = Router();
  const permit = (req: Request, res: Response, next: NextFunction) =>
    canAny((req as AuthedRequest).session!.role, ["leave.approve", "attendance.edit"]) ? next() : res.status(403).json({ message: "Bu amal uchun ruxsat yetarli emas." });
  const scopeOf = (req: AuthedRequest, db: Database) => {
    if (req.session!.role !== "BRANCH_MANAGER") return null;
    return new Set(db.users.find((u) => u.id === req.session!.userId)?.branchIds || []);
  };

  router.get(
    "/shift-swaps",
    permit,
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = auth.session!.companyId!;
      const db = await readDb();
      const scope = scopeOf(auth, db);
      const rows = db.shiftSwaps
        .filter((s) => s.companyId === tenant && s.status !== "PENDING_COLLEAGUE")
        .map((s) => describe(db, s))
        .filter((s) => !scope || (s.branchId && scope.has(s.branchId)))
        .slice(0, 200);
      res.json(rows);
    }),
  );

  router.post(
    "/shift-swaps/:id/decide",
    permit,
    route(async (req, res) => {
      const auth = req as AuthedRequest;
      const tenant = auth.session!.companyId!;
      const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
      const swap = await updateDb((db) => {
        const row = db.shiftSwaps.find((s) => s.id === req.params.id && s.companyId === tenant);
        if (!row) throw httpError("So‘rov topilmadi.", 404);
        const scope = scopeOf(auth, db);
        const requester = db.employees.find((e) => e.id === row.requesterId);
        const colleague = db.employees.find((e) => e.id === row.colleagueId);
        if (!requester || !colleague) throw httpError("Xodim topilmadi.", 404);
        if (scope && !scope.has(requester.branchId)) throw httpError("So‘rov topilmadi.", 404);
        if (row.status !== "PENDING_MANAGER") throw httpError("So‘rov tasdiq kutmayapti.", 409);
        row.status = approve ? "APPROVED" : "REJECTED";
        row.decidedBy = auth.session!.name;
        row.updatedAt = new Date().toISOString();
        if (approve) {
          const give = dayPlan(db, requester, row.giveDate);
          const add = (employeeId: string, date: string, working: boolean, start?: string, end?: string) => {
            db.scheduleOverrides = db.scheduleOverrides.filter((o) => !(o.employeeId === employeeId && o.date === date));
            db.scheduleOverrides.push({ id: randomUUID(), companyId: tenant, employeeId, date, working, start, end, reason: "Smena almashish", swapId: row.id });
          };
          add(requester.id, row.giveDate, false);
          add(colleague.id, row.giveDate, true, give.start, give.end);
          if (row.takeDate) {
            const take = dayPlan(db, colleague, row.takeDate);
            add(colleague.id, row.takeDate, false);
            add(requester.id, row.takeDate, true, take.start, take.end);
          }
        }
        db.auditLogs.unshift(
          audit(tenant, auth.session!.name, `Smena almashish ${approve ? "tasdiqlandi" : "rad etildi"}: ${nameOf(requester)} ↔ ${nameOf(colleague)} (${dmy(row.giveDate)}${row.takeDate ? ` / ${dmy(row.takeDate)}` : ""})`, "employee", requester.id),
        );
        return { ...row };
      });
      const db = await readDb();
      const text = approve
        ? `✅ <b>Smena almashish tasdiqlandi</b>\n${dmy(swap.giveDate)}${swap.takeDate ? ` va ${dmy(swap.takeDate)}` : ""} kungi grafik yangilandi.`
        : `❌ Smena almashish (${dmy(swap.giveDate)}) rahbar tomonidan rad etildi.`;
      await notify(db, swap.requesterId, text, approve ? "Smena almashish tasdiqlandi" : "Smena almashish rad etildi");
      await notify(db, swap.colleagueId, text, approve ? "Smena almashish tasdiqlandi" : "Smena almashish rad etildi");
      res.json(describe(db, swap));
    }),
  );
  return router;
}
