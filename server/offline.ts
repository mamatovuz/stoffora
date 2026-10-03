import { allowedBranches, branchAt } from "../lib/branches";
import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { calculateAttendance, haversineDistance } from "../lib/attendance";
import { tashkentClock, tashkentIsoDate } from "../lib/format";
import { assertFaceDescriptor, faceMatchThreshold, isReplayedDescriptor, matchFace, verifyIdentity } from "../lib/face";
import { FLAG_LABELS, gpsFlags } from "../lib/gps";
import { dayPlan } from "../lib/schedule";
import { audit, dataIndexes, updateDb } from "../lib/store";
import { isPracticeDay } from "../lib/counting";
import type { Attendance, AttendanceFlag } from "../lib/types";
import type { EmployeeSession } from "./auth";
import { onStafforaAttendance } from "./integrations/hooks";
import { enqueueAttendancePhoto } from "./photo-channel";

/*
 * Internetsiz davomat. Ombor, yerto‘la kabi joylarda aloqa bo‘lmasa, Mini App
 * yuz deskriptori, GPS va belgilangan vaqtni qurilmada saqlaydi va aloqa
 * tiklanganda shu yerga yuboradi. Server hammasini qayta tekshiradi:
 *   - yuz profil bilan solishtiriladi (xuddi onlayn tekshiruvdagidek);
 *   - GPS filial hududida bo‘lishi shart;
 *   - vaqt qurilma soatiga emas, "necha ms oldin" ga qarab server soatidan hisoblanadi;
 *   - 12 soatdan eski yozuv qabul qilinmaydi;
 *   - har bir yozuv "Internetsiz" belgisi bilan HR ko‘rigiga chiqadi.
 */

const MAX_AGE_MS = 12 * 3_600_000;
const GPS_ACCURACY_ALLOWANCE = 35;
const descriptor = z.array(z.number()).length(128);
const itemSchema = z.object({
  clientId: z.string().min(8).max(64),
  action: z.enum(["CHECK_IN", "CHECK_OUT"]),
  descriptor,
  turnDescriptor: descriptor.optional(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).max(100_000).optional(),
  ageMs: z.coerce.number().int().min(0).max(MAX_AGE_MS + 60_000),
  photoDataUrl: z.string().max(600_000).regex(/^data:image\/(jpeg|jpg|webp);base64,/).optional(),
});

type Result = { clientId: string; ok: boolean; message: string; attendance?: Attendance; duplicate?: boolean };
const session = (req: Request) => (req as unknown as { employeeSession?: EmployeeSession }).employeeSession!;

export function createMiniOfflineRouter() {
  const router = Router();
  router.post("/mini/attendance/offline", (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(
      (async () => {
        const { items } = z.object({ items: z.array(itemSchema).min(1).max(6) }).parse(req.body);
        const auth = session(req);
        // Eng eskisidan boshlab (kelish → ketish tartibi buzilmasin).
        const ordered = [...items].sort((a, b) => b.ageMs - a.ageMs);
        const results: Result[] = [];
        const synced: { attendance: Attendance; action: "CHECK_IN" | "CHECK_OUT" }[] = [];
        await updateDb((db) => {
          const employee = db.employees.find((e) => e.id === auth.employeeId && e.companyId === auth.companyId);
          const profile = db.faceProfiles.find((p) => p.employeeId === auth.employeeId && p.companyId === auth.companyId);
          const company = db.companies.find((c) => c.id === auth.companyId);
          for (const item of ordered) {
            const fail = (message: string) => results.push({ clientId: item.clientId, ok: false, message });
            if (!employee || employee.status !== "ACTIVE") {
              fail("Xodim faol emas.");
              continue;
            }
            const already = db.attendance.find((a) => a.employeeId === employee.id && a.offlineIds?.includes(item.clientId));
            if (already) {
              results.push({ clientId: item.clientId, ok: true, duplicate: true, message: "Avval qabul qilingan.", attendance: { ...already } });
              continue;
            }
            if (item.ageMs > MAX_AGE_MS) {
              fail("12 soatdan eski belgi qabul qilinmaydi — HR’ga murojaat qiling.");
              continue;
            }
            if (!profile) {
              fail("Face ID sozlanmagan.");
              continue;
            }
            try {
              assertFaceDescriptor(item.descriptor);
              if (item.turnDescriptor) assertFaceDescriptor(item.turnDescriptor);
            } catch (reason) {
              fail((reason as Error).message);
              continue;
            }
            if (isReplayedDescriptor(profile.lastDescriptor, item.descriptor)) {
              fail("Takroriy yuz ma’lumoti — belgi qabul qilinmadi.");
              continue;
            }
            const front = matchFace(profile, item.descriptor);
            const turned = item.turnDescriptor ? matchFace(profile, item.turnDescriptor, faceMatchThreshold() + 0.06) : undefined;
            const identity = verifyIdentity(profile, [item.descriptor], db.faceProfiles.filter((p) => p.companyId === profile.companyId && p.employeeId !== profile.employeeId));
            if (!front.matched || !identity.matched || (turned && !turned.matched)) {
              fail(identity.reason === "LOOKALIKE" ? "Yuz boshqa xodimga o‘xshab chiqdi — belgi qabul qilinmadi." : "Yuz profildagi Face ID bilan mos kelmadi.");
              continue;
            }
            const allowance = Math.min(GPS_ACCURACY_ALLOWANCE, Math.max(0, item.accuracy || 0));
            // «Istalgan filialdan» lavozimi — belgi qilingan joydagi ruxsat etilgan filial.
            const allowed = allowedBranches(db, employee);
            const spot = branchAt(allowed, item.latitude, item.longitude, allowance);
            const branch = spot.inside?.branch || allowed[0];
            if (!branch) {
              fail("Faol filial biriktirilmagan.");
              continue;
            }
            const distance = haversineDistance(branch.latitude, branch.longitude, item.latitude, item.longitude);
            if (distance - allowance > branch.radiusMeters) {
              fail(`Belgi filial hududidan ${Math.round(distance - branch.radiusMeters)} m tashqarida qilingan.`);
              continue;
            }
            const at = new Date(Date.now() - item.ageMs);
            const date = tashkentIsoDate(at);
            const time = tashkentClock(at);
            const day = dayPlan(db, employee, date);
            const schedule = db.schedules.find((s) => s.id === employee.scheduleId);
            let attendance = db.attendance.find((a) => a.employeeId === employee.id && a.date === date);
            if (item.action === "CHECK_IN") {
              if (attendance?.checkIn) {
                fail(`${date.split("-").reverse().join(".")} kuni kelish allaqachon ${attendance.checkIn} da qayd etilgan.`);
                continue;
              }
              if (!attendance) {
                attendance = {
                  id: randomUUID(),
                  companyId: auth.companyId,
                  employeeId: employee.id,
                  branchId: branch.id,
                  date,
                  scheduledStart: day?.enabled ? day.start : time,
                  scheduledEnd: day?.enabled ? day.end : time,
                  lateMinutes: 0,
                  earlyLeaveMinutes: 0,
                  workedMinutes: 0,
                  overtimeMinutes: 0,
                  status: "ABSENT",
                  verification: [],
                  updatedAt: new Date().toISOString(),
                };
                db.attendance.push(attendance);
              }
              const calculated = calculateAttendance({
                scheduledStart: attendance.scheduledStart,
                scheduledEnd: attendance.scheduledEnd,
                checkIn: time,
                graceMinutes: schedule?.graceMinutes || 0,
              });
              attendance.checkIn = time;
              attendance.lateMinutes = calculated.lateMinutes;
              attendance.status = calculated.status;
              if (!day?.enabled) attendance.note = "Dam olish kunida ishga keldi";
            } else {
              if (!attendance?.checkIn) {
                fail("Avval ishga kelish qayd etilishi kerak.");
                continue;
              }
              if (attendance.checkOut) {
                fail(`Ketish allaqachon ${attendance.checkOut} da qayd etilgan.`);
                continue;
              }
              if (time <= attendance.checkIn) {
                fail("Ketish vaqti kelishdan keyin bo‘lishi kerak.");
                continue;
              }
              attendance.checkOut = time;
              Object.assign(
                attendance,
                calculateAttendance({
                  scheduledStart: attendance.scheduledStart,
                  scheduledEnd: attendance.scheduledEnd,
                  checkIn: attendance.checkIn,
                  checkOut: time,
                  graceMinutes: schedule?.graceMinutes || 0,
                }),
              );
              if (!day?.enabled) {
                attendance.overtimeMinutes = attendance.workedMinutes;
                attendance.earlyLeaveMinutes = 0;
              }
            }
            const history = (dataIndexes(db).attendanceByEmployee.get(employee.id) || [])
              .filter((a) => a.id !== attendance!.id && typeof a.latitude === "number" && typeof a.longitude === "number")
              .slice(-30)
              .map((a) => ({ latitude: a.latitude!, longitude: a.longitude!, at: new Date(a.updatedAt).getTime() }));
            const flags: AttendanceFlag[] = [
              "OFFLINE",
              ...gpsFlags(
                { latitude: item.latitude, longitude: item.longitude, accuracy: item.accuracy, distance, radius: branch.radiusMeters, at: at.getTime() },
                history,
              ),
            ];
            attendance.flags = [...new Set([...(attendance.flags || []), ...flags])];
            attendance.flagsReviewedBy = undefined;
            attendance.offlineIds = [...(attendance.offlineIds || []), item.clientId].slice(-6);
            attendance.verification = [...new Set<Attendance["verification"][number]>([...attendance.verification.filter((v) => v !== "MANUAL"), "FACE", "GPS", "TELEGRAM"])];
            attendance.latitude = item.latitude;
            attendance.longitude = item.longitude;
            attendance.distanceMeters = distance;
            attendance.updatedAt = new Date().toISOString();
            profile.lastDescriptor = item.descriptor;
            profile.lastVerifiedAt = attendance.updatedAt;
            const name = `${employee.firstName} ${employee.lastName}`;
            db.notifications.unshift({
              id: randomUUID(),
              companyId: auth.companyId,
              title: "Internetsiz belgilangan davomat",
              body: `${name}: ${item.action === "CHECK_IN" ? "kelish" : "ketish"} ${time} (${date.split("-").reverse().join(".")}, ${branch.name}) — aloqa tiklangach yuborildi. ${flags.length > 1 ? `Belgilar: ${flags.map((f) => FLAG_LABELS[f]).join(", ")}.` : ""} Davomat sahifasida ko‘rib chiqing.`,
              type: "ATTENDANCE",
              read: false,
              createdAt: attendance.updatedAt,
            });
            if (item.action === "CHECK_IN" && attendance.lateMinutes > 0 && !isPracticeDay(date, company, employee))
              db.notifications.unshift({
                id: randomUUID(),
                companyId: auth.companyId,
                title: "Kechikish",
                body: `${name} ${attendance.lateMinutes} daqiqa kechikib keldi (${time}, ${branch.name}).`,
                type: "ATTENDANCE",
                read: false,
                createdAt: attendance.updatedAt,
              });
            db.auditLogs.unshift(
              audit(auth.companyId, name, `${item.action === "CHECK_IN" ? "Ishga kelish" : "Ishdan ketish"} internetsiz qayd etildi (${time})`, "attendance", attendance.id, undefined, {
                ageMinutes: Math.round(item.ageMs / 60_000),
                distance,
              }),
            );
            enqueueAttendancePhoto(db, { employee, branch, attendance, action: item.action, photoDataUrl: item.photoDataUrl });
            synced.push({ attendance: { ...attendance }, action: item.action });
            results.push({ clientId: item.clientId, ok: true, message: `${item.action === "CHECK_IN" ? "Kelish" : "Ketish"} ${time} da qayd etildi.`, attendance: { ...attendance } });
          }
        });
        for (const row of synced) onStafforaAttendance(auth.companyId, row.attendance, row.action);
        res.json({ results });
      })(),
    ).catch(next),
  );
  return router;
}
