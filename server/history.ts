import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { dataIndexes, documentFiles, readDb } from "../lib/store";
import { tashkentClock, tashkentIsoDate } from "../lib/format";
import { dayPlan } from "../lib/schedule";
import { isOvernight } from "../lib/shift-time";
import { can } from "../lib/permissions";
import { countingStartDate } from "../lib/counting";
import type { Attendance, AttendanceMark, Database, Employee } from "../lib/types";
import type { AuthedRequest, EmployeeSession } from "./auth";
import { monthLabel } from "./payroll-routes";

/*
 * Davomat tarixi (Mini App, ilova va rahbar uchun bir xil):
 *   • oy kalendari — har kun rangi (vaqtida / kechikdi / kelmadi / ta’til / dam / hali oldinda);
 *   • oylik statistika (diagramma uchun) — rejadagi va ishlangan soatlar;
 *   • kun tafsiloti — kirish/chiqish, grafik, tanaffus, qaydnoma (har bir belgi: vaqt, filial,
 *     rasm, koordinata, aniqlik) va shu kunga tegishli so‘rovlar.
 * Belgi rasmlari document_files da saqlanadi (62 kun), keyin tozalanadi.
 */

export const MARK_PHOTO_DAYS = 62;
const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const span = (start: string, end: string) => {
  const d = minutesOf(end) - minutesOf(start);
  return d > 0 ? d : d + 1440;
};
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Belgi rasmini saqlaydi (xato bo‘lsa davomat to‘xtamaydi — undefined). */
export async function saveMarkPhoto(companyId: string, dataUrl?: string) {
  if (!dataUrl) return undefined;
  const match = /^data:(image\/(?:jpeg|jpg|webp|png));base64,(.+)$/s.exec(dataUrl);
  if (!match) return undefined;
  try {
    const id = randomUUID();
    await (await documentFiles()).putFile(id, companyId, match[1] === "image/jpg" ? "image/jpeg" : match[1], Buffer.from(match[2], "base64"), new Date().toISOString());
    return id;
  } catch {
    return undefined;
  }
}
/** Saqlanadigan belgi rasmlari (oxirgi 62 kun) — fayllar tozalashda o‘chmasin. */
export function markPhotoIds(db: Database, today = tashkentIsoDate()) {
  const from = addDays(today, -MARK_PHOTO_DAYS);
  return db.attendance.filter((a) => a.date >= from && a.marks?.length).flatMap((a) => a.marks!.map((m) => m.photoId)).filter((id): id is string => Boolean(id));
}

/** Eski yozuvlarda marks yo‘q — kirish/chiqishdan tiklanadi. */
export function marksOf(db: Database, a: Attendance): AttendanceMark[] {
  if (a.marks?.length) return a.marks;
  const branchName = db.branches.find((b) => b.id === a.branchId)?.name || "";
  const manual = a.verification.includes("MANUAL");
  const out: AttendanceMark[] = [];
  if (a.checkIn)
    out.push({ kind: "IN", time: a.checkIn, branchId: a.branchId, branchName, latitude: a.checkOut ? undefined : a.latitude, longitude: a.checkOut ? undefined : a.longitude, distanceMeters: a.checkOut ? undefined : a.distanceMeters, method: manual ? "MANUAL" : "FACE" });
  if (a.checkOut) out.push({ kind: "OUT", time: a.checkOut, branchId: a.branchId, branchName, latitude: a.latitude, longitude: a.longitude, distanceMeters: a.distanceMeters, method: manual ? "MANUAL" : "FACE" });
  return out;
}

type Tone = "ontime" | "late" | "absent" | "leave" | "off" | "future" | "working" | "restwork" | "none";
export function historyMonth(db: Database, employee: Employee, month: string, today = tashkentIsoDate(), clock = tashkentClock()) {
  const index = dataIndexes(db);
  const leaves = (index.approvedLeaveByEmployee.get(employee.id) || []) as Database["leaveRequests"];
  const company = db.companies.find((c) => c.id === employee.companyId);
  const from = [employee.startDate, countingStartDate(company, employee)].filter(Boolean).sort().pop() || employee.startDate;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const stats = { ontime: 0, late: 0, absent: 0, leave: 0, remaining: 0, off: 0, plannedMinutes: 0, workedMinutes: 0, lateMinutes: 0, overtimeMinutes: 0 };
  const days = Array.from({ length: last }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    const plan = dayPlan(db, employee, date);
    const leave = leaves.find((l) => l.startDate <= date && l.endDate >= date);
    const a = index.attendanceByKey.get(`${employee.id}|${date}`);
    const working = plan.enabled && !leave;
    const before = date < (employee.startDate || "0000");
    let tone: Tone;
    // Kechki smena (14:00 → 00:00) ertasi kuni tugash vaqtigacha davom etadi.
    const overnight = isOvernight(plan.start, plan.end);
    const inProgress = date === today || (overnight && date === addDays(today, -1) && clock < plan.end);
    if (a?.checkIn) tone = !plan.enabled ? "restwork" : !a.checkOut && inProgress ? (a.lateMinutes ? "late" : "working") : a.lateMinutes ? "late" : "ontime";
    else if (leave) tone = "leave";
    else if (!plan.enabled) tone = "off";
    else if (before) tone = "none";
    else if (date > today || (date === today && (overnight || clock < plan.end)) || (inProgress && date < today)) tone = "future";
    else tone = date >= from ? "absent" : "none";
    if (working) stats.plannedMinutes += span(plan.start, plan.end);
    if (a) {
      stats.workedMinutes += a.workedMinutes || 0;
      stats.lateMinutes += a.lateMinutes || 0;
      stats.overtimeMinutes += a.overtimeMinutes || 0;
    }
    if (tone === "ontime" || tone === "working" || tone === "restwork") stats.ontime += 1;
    else if (tone === "late") stats.late += 1;
    else if (tone === "absent") stats.absent += 1;
    else if (tone === "leave") stats.leave += 1;
    else if (tone === "future") stats.remaining += 1;
    else if (tone === "off") stats.off += 1;
    return {
      date,
      tone,
      working,
      start: plan.start,
      end: plan.end,
      reason: plan.reason,
      leave: leave?.type,
      checkIn: a?.checkIn,
      checkOut: a?.checkOut,
      lateMinutes: a?.lateMinutes || 0,
      workedMinutes: a?.workedMinutes || 0,
    };
  });
  return { month, label: monthLabel(month), today, days, stats };
}

export async function historyDay(db: Database, employee: Employee, date: string, today = tashkentIsoDate()) {
  const index = dataIndexes(db);
  const plan = dayPlan(db, employee, date);
  const leave = ((index.approvedLeaveByEmployee.get(employee.id) || []) as Database["leaveRequests"]).find((l) => l.startDate <= date && l.endDate >= date);
  const a = index.attendanceByKey.get(`${employee.id}|${date}`);
  const keepPhotos = date >= addDays(today, -MARK_PHOTO_DAYS);
  const files = await documentFiles();
  const marks = await Promise.all(
    (a ? marksOf(db, a) : []).map(async (m) => {
      let photo: string | undefined;
      if (m.photoId && keepPhotos) {
        const file = await files.getFile(m.photoId).catch(() => undefined);
        if (file) photo = `data:${file.mime};base64,${Buffer.from(file.data).toString("base64")}`;
      }
      const b = db.branches.find((x) => x.id === m.branchId);
      return { ...m, photoId: undefined, photo, photoExpired: Boolean(m.photoId && !keepPhotos), branch: b ? { latitude: b.latitude, longitude: b.longitude, radius: b.radiusMeters } : undefined };
    }),
  );
  const breaks = (a?.breaks || []).map((b) => ({ start: b.start, end: b.end }));
  const requests = [
    ...db.attendanceCorrections
      .filter((c) => c.employeeId === employee.id && c.date === date)
      .map((c) => ({ id: c.id, kind: "Belgilash so‘rovi", detail: `${c.kind === "IN" ? "Kirish" : "Chiqish"} ${c.time}`, status: c.status })),
    ...db.leaveRequests
      .filter((l) => l.employeeId === employee.id && l.startDate <= date && l.endDate >= date)
      .map((l) => ({ id: l.id, kind: "Ta’til / ruxsat", detail: l.reason, status: l.status })),
    ...db.shiftSwaps
      .filter((s) => (s.requesterId === employee.id || s.colleagueId === employee.id) && (s.giveDate === date || s.takeDate === date))
      .map((s) => ({ id: s.id, kind: "Smena almashish", detail: s.reason || "", status: s.status })),
  ];
  return {
    date,
    plan: { working: plan.enabled && !leave, start: plan.start, end: plan.end, reason: plan.reason, leave: leave?.type, plannedMinutes: plan.enabled && !leave ? span(plan.start, plan.end) : 0 },
    attendance: a
      ? {
          checkIn: a.checkIn,
          checkOut: a.checkOut,
          lateMinutes: a.lateMinutes,
          earlyLeaveMinutes: a.earlyLeaveMinutes,
          workedMinutes: a.workedMinutes,
          overtimeMinutes: a.overtimeMinutes,
          status: a.status,
          note: a.note,
        }
      : null,
    breaks,
    marks,
    requests,
  };
}

const monthParam = (req: Request) => {
  const month = String(req.query.month || tashkentIsoDate().slice(0, 7));
  if (!MONTH.test(month)) throw httpError("Oy YYYY-MM ko‘rinishida bo‘lsin.", 400);
  return month;
};
const dateParam = (req: Request) => z.string().regex(DATE, "Sana noto‘g‘ri.").parse(String(req.query.date || tashkentIsoDate()));

/** Xodim (Mini App / ilova). */
export function createMiniHistoryRouter() {
  const router = Router();
  const me = (db: Database, req: Request) => {
    const s = (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;
    const e = db.employees.find((x) => x.id === s.employeeId && x.companyId === s.companyId);
    if (!e) throw httpError("Xodim topilmadi.", 404);
    return e;
  };
  router.get(
    "/mini/history",
    route(async (req, res) => {
      const db = await readDb();
      res.json(historyMonth(db, me(db, req), monthParam(req)));
    }),
  );
  router.get(
    "/mini/history/day",
    route(async (req, res) => {
      const db = await readDb();
      res.json(await historyDay(db, me(db, req), dateParam(req)));
    }),
  );
  return router;
}

/** HR / filial rahbari — xodimning tarixi (kalendar va kun tafsiloti). */
export function createHistoryRouter() {
  const router = Router();
  const target = (db: Database, req: Request) => {
    const session = (req as AuthedRequest).session!;
    if (!can(session.role, "employees.view") && !can(session.role, "attendance.view")) throw httpError("Bu amal uchun ruxsat yetarli emas.", 403);
    const e = db.employees.find((x) => x.id === req.params.id && x.companyId === session.companyId);
    const scope = session.role === "BRANCH_MANAGER" ? db.users.find((u) => u.id === session.userId)?.branchIds || [] : null;
    if (!e || (scope && !scope.includes(e.branchId))) throw httpError("Xodim topilmadi.", 404);
    return e;
  };
  router.get(
    "/employees/:id/history",
    route(async (req, res) => {
      const db = await readDb();
      res.json(historyMonth(db, target(db, req), monthParam(req)));
    }),
  );
  router.get(
    "/employees/:id/history/day",
    route(async (req, res) => {
      const db = await readDb();
      res.json(await historyDay(db, target(db, req), dateParam(req)));
    }),
  );
  return router;
}
