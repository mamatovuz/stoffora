import { allowedBranches, branchAt } from "../lib/branches";
import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { calculateAttendance, haversineDistance } from "../lib/attendance";
import { duration, tashkentClock, tashkentIsoDate } from "../lib/format";
import { assertFaceDescriptor, faceMatchThreshold, isReplayedDescriptor, matchFace, verifyIdentity } from "../lib/face";
import { FLAG_LABELS, gpsFlags } from "../lib/gps";
import { dayPlan, minutesSinceCheckIn, shiftDateAt } from "../lib/schedule";
import { audit, dataIndexes, readDb, updateDb } from "../lib/store";
import { alertSuspiciousMark } from "./request-actions";
import { isPracticeDay } from "../lib/counting";
import type { Attendance, AttendanceFlag } from "../lib/types";
import type { EmployeeSession } from "./auth";
import { onStafforaAttendance } from "./integrations/hooks";
import { enqueueAttendancePhoto } from "./photo-channel";
import { describeFace } from "./face-server";

/*
 * Internetsiz davomat. Ombor, yerto‘la kabi joylarda aloqa bo‘lmasa, Mini App
 * yuz deskriptori, GPS va belgilangan vaqtni qurilmada saqlaydi va aloqa
 * tiklanganda shu yerga yuboradi. Server hammasini qayta tekshiradi:
 *   - yuz profil bilan solishtiriladi (xuddi onlayn tekshiruvdagidek);
 *   - GPS filial hududida bo‘lishi shart;
 *   - vaqt qurilma soatiga emas, "necha ms oldin" ga qarab server soatidan hisoblanadi;
 *   - 12 soatdan eski yozuv qabul qilinmaydi;
 *   - har bir yozuv "Internetsiz" belgisi bilan HR ko‘rigiga chiqadi.
 * Mobil ilova yuz deskriptorini hisoblay olmaydi — u 2–3 ta kadr (rasm) yuboradi, deskriptorni
 * server o‘zi chiqaradi va jonlilikni (kadrlar bir xil emasligini) tekshiradi.
 */

const MAX_AGE_MS = 12 * 3_600_000;
const GPS_ACCURACY_ALLOWANCE = 35;
const descriptor = z.array(z.number()).length(128);
const itemSchema = z.object({
  clientId: z.string().min(8).max(64),
  action: z.enum(["CHECK_IN", "CHECK_OUT"]),
  /** Mini App: brauzerda hisoblangan yuz deskriptori. */
  descriptor: descriptor.optional(),
  turnDescriptor: descriptor.optional(),
  /** Mobil ilova: 2–3 ta JPEG kadr (base64) — deskriptorni server hisoblaydi. */
  photos: z.array(z.string().min(100).max(300_000)).min(2).max(3).optional(),
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
        const { items } = z
          .object({ items: z.array(itemSchema.refine((i) => i.descriptor || i.photos, "Yuz ma’lumoti yo‘q.")).min(1).max(6) })
          .parse(req.body);
        const auth = session(req);
        // Mobil ilova kadrlari: deskriptorlar (tranzaksiyadan oldin — yuz tahlili sekin).
        const fromPhotos = new Map<string, { descriptors?: number[][]; error?: string }>();
        for (const item of items) {
          if (item.descriptor || !item.photos) continue;
          try {
            const faces = await Promise.all(item.photos.map((p) => describeFace(p.replace(/^data:image\/\w+;base64,/, ""))));
            if (faces.some((f) => !f)) {
              fromPhotos.set(item.clientId, { error: "Kadrlarda yuz aniq ko‘rinmadi — belgi qabul qilinmadi." });
              continue;
            }
            const descriptors = faces.map((f) => f!.descriptor);
            const spread = Math.max(...descriptors.slice(1).map((d) => Math.sqrt(d.reduce((sum, v, i) => sum + (v - descriptors[0][i]) ** 2, 0))));
            if (spread < 0.002) {
              fromPhotos.set(item.clientId, { error: "Jonli yuz aniqlanmadi (bir xil kadrlar) — belgi qabul qilinmadi." });
              continue;
            }
            fromPhotos.set(item.clientId, { descriptors });
          } catch (reason) {
            // Yuz serveri band / vaqtincha ishlamayapti — so‘rov xato qaytaradi, telefon belgini saqlab, keyin qayta yuboradi.
            if ((reason as { status?: number }).status === 503) throw reason;
            fromPhotos.set(item.clientId, { error: (reason as Error).message || "Yuzni tekshirib bo‘lmadi." });
          }
        }
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
            const computed = fromPhotos.get(item.clientId);
            if (computed?.error) {
              fail(computed.error);
              continue;
            }
            const extra = computed?.descriptors || [];
            if (!item.descriptor) item.descriptor = extra[0];
            if (!item.descriptor) {
              fail("Yuz ma’lumoti yo‘q.");
              continue;
            }
            if (!item.photoDataUrl && item.photos?.length) item.photoDataUrl = item.photos[0].startsWith("data:") ? item.photos[0] : `data:image/jpeg;base64,${item.photos[0]}`;
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
            // Mobil kadrlar bo‘lsa — hammasi tekshiriladi (bitta tasodifiy o‘xshashlik yetmaydi).
            const identity = verifyIdentity(profile, extra.length ? extra : [item.descriptor], db.faceProfiles.filter((p) => p.companyId === profile.companyId && p.employeeId !== profile.employeeId));
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
            const calendarDate = tashkentIsoDate(at);
            const time = tashkentClock(at);
            // Smena boshlangan ish kuni (kechki smenaning yarim tundan keyingi ketishi — kechagi qaydga).
            const date = shiftDateAt(db, employee, calendarDate, time);
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
              attendance.branchId = branch.id;
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
              if (minutesSinceCheckIn(attendance, calendarDate, time) <= 0) {
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
                body: `${name} ${duration(attendance.lateMinutes)} kechikib keldi (${time}, ${branch.name}).`,
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
        // Internetsiz belgida ham GPS bo‘yicha shubha bo‘lsa — rahbarga darhol.
        if (synced.length) {
          const db = await readDb();
          const employee = db.employees.find((e) => e.id === auth.employeeId);
          for (const row of synced) {
            const branch = db.branches.find((b) => b.id === row.attendance.branchId);
            if (employee && branch && row.attendance.flags?.length)
              void alertSuspiciousMark(employee, {
                branchId: branch.id,
                branchName: branch.name,
                date: row.attendance.date,
                time: (row.action === "CHECK_IN" ? row.attendance.checkIn : row.attendance.checkOut) || "",
                action: row.action,
                flags: row.attendance.flags,
              }).catch(() => undefined);
          }
        }
        res.json({ results });
      })(),
    ).catch(next),
  );
  return router;
}
