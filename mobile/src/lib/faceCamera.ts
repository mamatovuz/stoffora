import type { CameraView } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { post } from "./api";

/*
 * Kameradan kadr: kichraytirilgan JPEG (480 px) — tarmoq va server uchun yengil.
 * Kadr telefonda saqlanmaydi (vaqtinchalik fayl), faqat base64 ko‘rinishida serverga boradi.
 */
export async function grabFrame(camera: CameraView, width = 480) {
  const picture = await camera.takePictureAsync({ quality: 0.6, shutterSound: false, exif: false });
  if (!picture?.uri) throw new Error("Kadr olinmadi");
  const context = ImageManipulator.manipulate(picture.uri).resize({ width });
  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: 0.72, format: SaveFormat.JPEG, base64: true });
  context.release();
  image.release();
  if (!result.base64) throw new Error("Kadr olinmadi");
  return result.base64;
}

export type FaceProbe = {
  face: { box: { x: number; y: number; width: number; height: number }; yaw: number; roll: number; light: number; score: number } | null;
  percent: number | null;
  passPercent: number;
  enrolled?: boolean;
};
export const probeFace = (photo: string) => post<FaceProbe>("/mobile/face/check", { photo }, 12_000);
export const verifyFaces = (photos: string[]) => post<{ proof: string; percent: number; score: number }>("/mobile/face/verify", { photos }, 20_000);
export const enrollFaces = (photos: string[]) => post<{ ok: true; proof: string }>("/mobile/face/enroll", { photos }, 30_000);

/**
 * Qotirilgan ramka (ekranda: 3:4 oynaning markazi, kengligining 60%i) rasm koordinatalarida.
 * Rasm ham 3:4, shuning uchun bir xil: kenglik ulushi 0.6, balandlik ulushi 0.6·(3/4)=0.45.
 */
export const FRAME = { cx: 0.5, cy: 0.47, w: 0.6, h: 0.45 };
export type Placement = "ok" | "none" | "far" | "near" | "offcenter" | "tilted" | "dark";

export function placement(face: FaceProbe["face"]): Placement {
  if (!face) return "none";
  const { box } = face;
  const size = Math.max(box.width, box.height * 0.75);
  if (size < FRAME.w * 0.4) return "far";
  if (size > FRAME.w * 1.02) return "near";
  const dx = (box.x + box.width / 2 - FRAME.cx) / FRAME.w;
  const dy = (box.y + box.height / 2 - FRAME.cy) / FRAME.h;
  if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.24) return "offcenter";
  if (Math.abs(face.yaw) > 0.22 || Math.abs(face.roll) > 0.26) return "tilted";
  if (face.light < 50) return "dark";
  return "ok";
}

export const PLACEMENT_TEXT: Record<Placement, string> = {
  ok: "Yuz ramkada",
  none: "Yuzingizni ramkaga olib keling",
  far: "Yaqinroq keling",
  near: "Biroz uzoqroq turing",
  offcenter: "Yuzingizni ramka markaziga olib keling",
  tilted: "Kameraga to‘g‘ri qarang",
  dark: "Juda qorong‘i — yorug‘likka yuzlaning",
};
