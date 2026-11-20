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
/** `liveness: "turn"` — oxirgi kadrda bosh biroz burilgan (server tekis rasmni shu bilan ajratadi). */
export const verifyFaces = (photos: string[], liveness?: "turn") =>
  post<{ proof: string; percent: number; score: number }>("/mobile/face/verify", liveness ? { photos, liveness } : { photos }, 20_000);

/**
 * Kichik 4:3 kadr o‘lchami (masalan 640x480). Avval har kadr kameraning to‘liq o‘lchamida (12+ MP)
 * olinib, keyin kichraytirilardi — bu Android’da har kadrga 0,5–1 soniya qo‘shardi.
 */
export function smallPictureSize(sizes: string[]) {
  const parsed = sizes
    .map((size) => {
      const m = /^(\d+)x(\d+)$/.exec(size);
      return m ? { size, w: Math.max(Number(m[1]), Number(m[2])), h: Math.min(Number(m[1]), Number(m[2])) } : null;
    })
    .filter((p): p is { size: string; w: number; h: number } => Boolean(p && p.h));
  const fit = parsed.filter((p) => Math.abs(p.w / p.h - 4 / 3) < 0.02 && p.w >= 640 && p.w <= 1280).sort((a, b) => a.w - b.w);
  return fit[0]?.size;
}

/** Jonlilik: to‘g‘ri kadrlarga nisbatan bosh shuncha burilishi kerak (server chegarasi — 0.1). */
export const TURN_YAW = 0.15;
export const enrollFaces = (photos: string[]) => post<{ ok: true; proof: string }>("/mobile/face/enroll", { photos }, 30_000);

/**
 * Qotirilgan kvadrat ramka rasm (3:4) koordinatalarida: kengligi rasmning 50%i, balandlik ulushi 0.5·(3/4).
 * Ekranda kamera «cover» bilan to‘ldirilgani uchun ramka shu joyga hisoblab chiziladi (face-check.tsx).
 */
export const FRAME = { cx: 0.5, cy: 0.45, w: 0.5, h: 0.375 };
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
