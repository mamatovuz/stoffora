import { haversineDistance } from "./attendance";
import type { AttendanceFlag } from "./types";

/*
 * Soxta GPS (mock location) belgilarini aniqlash. Keldi-ketdi bloklanmaydi —
 * faqat HR ko‘rib chiqishi uchun belgi qo‘yiladi (yolg‘on signal bo‘lishi mumkin).
 */

export type GpsSample = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  /** Joylashuv qancha oldin olingan (ms). */
  positionAge?: number;
  /** Filialgacha masofa va ruxsat etilgan radius. */
  distance: number;
  radius: number;
  at: number;
};
export type GpsHistory = { latitude: number; longitude: number; at: number }[];

export const FLAG_LABELS: Record<AttendanceFlag, string> = {
  GPS_ACCURACY: "GPS aniqligi g‘ayritabiiy",
  GPS_EXACT_REPEAT: "Koordinata avvalgisi bilan aynan bir xil",
  GPS_TELEPORT: "Imkonsiz tezlikda joy o‘zgargan",
  GPS_EDGE: "Hudud chegarasida (faqat aniqlik hisobiga ichkarida)",
  GPS_STALE: "Eski (keshlangan) joylashuv",
};

const same = (a: number, b: number) => Math.abs(a - b) < 1e-7;

export function gpsFlags(sample: GpsSample, history: GpsHistory): AttendanceFlag[] {
  const flags = new Set<AttendanceFlag>();
  const accuracy = sample.accuracy;
  // Soxta joylashuv ilovalari ko‘pincha 0–2 m aniqlik beradi; bino ichida haqiqiy GPS kamdan-kam 3 m dan yaxshi.
  if (accuracy !== undefined && accuracy < 3) flags.add("GPS_ACCURACY");
  if (sample.positionAge !== undefined && sample.positionAge > 3 * 60_000) flags.add("GPS_STALE");
  if (sample.distance > sample.radius) flags.add("GPS_EDGE");
  for (const past of history) {
    if (same(past.latitude, sample.latitude) && same(past.longitude, sample.longitude)) flags.add("GPS_EXACT_REPEAT");
    const hours = Math.abs(sample.at - past.at) / 3_600_000;
    if (hours > 0 && hours < 12) {
      const km = haversineDistance(past.latitude, past.longitude, sample.latitude, sample.longitude) / 1000;
      // 150 km/soat dan tez (va 2 km dan uzoq) — imkonsiz sakrash.
      if (km > 2 && km / hours > 150) flags.add("GPS_TELEPORT");
    }
  }
  return [...flags];
}
