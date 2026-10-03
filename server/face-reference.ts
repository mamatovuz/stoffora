import { randomUUID } from "node:crypto";
import { matchFace } from "../lib/face";
import type { Database, Employee } from "../lib/types";
import { describeFace } from "./face-server";

/*
 * Saytda (panelda) yuklangan xodim rasmi — Face ID namunasi.
 * HR 3×4 rasm qo‘ysa, server undan yuz belgilarini hisoblaydi va xodimning Face ID profilini
 * shu rasm bilan almashtiradi. Keldi-ketdi shu namuna bilan solishtiriladi; Face ID kadrlari
 * esa bu rasmni almashtirmaydi (photoSource = "PANEL").
 */

const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });

/** Rasmdan Face ID namunasi (deskriptor). Yuz topilmasa — tushunarli xato. */
export async function referenceFromPhoto(dataUrl: string) {
  const match = /^data:image\/(jpeg|jpg);base64,(.+)$/.exec(dataUrl);
  if (!match) throw httpError("Rasm JPEG formatida bo‘lishi kerak.", 422);
  const face = await describeFace(match[2]);
  if (!face) throw httpError("Rasmda yuz aniq topilmadi. Yuz to‘liq ko‘rinadigan, yorug‘ 3×4 rasm yuklang.", 422);
  if (Math.abs(face.yaw) > 0.3) throw httpError("Rasmda yuz yon tomonga burilgan. To‘g‘ri qaragan 3×4 rasm yuklang.", 422);
  return face.descriptor;
}

/** Profilni sayt rasmi bilan almashtiradi (updateDb ichida chaqiriladi). */
export function applyPanelReference(db: Database, employee: Employee, photoDataUrl: string, descriptor: number[], actor: string) {
  const duplicate = db.faceProfiles.find((p) => p.companyId === employee.companyId && p.employeeId !== employee.id && matchFace(p, descriptor, 0.42).matched);
  if (duplicate) {
    const other = db.employees.find((e) => e.id === duplicate.employeeId);
    throw httpError(`Bu yuz boshqa xodimga (${other ? `${other.firstName} ${other.lastName}` : "boshqa profil"}) biriktirilgan. To‘g‘ri rasmni yuklang.`, 409);
  }
  const now = new Date().toISOString();
  db.faceProfiles = db.faceProfiles.filter((p) => p.employeeId !== employee.id);
  db.faceProfiles.push({ companyId: employee.companyId, employeeId: employee.id, descriptor, samples: [descriptor], source: "PANEL", enrolledAt: now, updatedAt: now });
  employee.photoDataUrl = photoDataUrl;
  employee.photoSource = "PANEL";
  employee.photoUpdatedAt = now;
  employee.photoQuality = undefined;
  employee.faceEnrolledAt = now;
  return { actor, at: now };
}

/** 1:N tekshiruvda boshqa xodimga o‘xshab chiqqan urinish — HR’ga xabar (kim o‘rniga kim). */
export function lookalikeAlert(db: Database, companyId: string, employee: Employee, lookalikeId: string | undefined, channel: string) {
  const other = db.employees.find((e) => e.id === lookalikeId);
  db.notifications.unshift({
    id: randomUUID(),
    companyId,
    title: "Shubhali Face ID urinishi",
    body: `${employee.firstName} ${employee.lastName} hisobidan Face ID — yuz ${other ? `${other.firstName} ${other.lastName}` : "boshqa xodim"}ga o‘xshadi (${channel}). Belgi qabul qilinmadi.`,
    type: "ATTENDANCE",
    read: false,
    createdAt: new Date().toISOString(),
  });
}
