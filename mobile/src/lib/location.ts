import * as Location from "expo-location";

/*
 * Joylashuv faqat amal paytida (ishga keldim/ketdim) va ekranda — fonda kuzatilmaydi.
 * Hudud ichida ekanini SERVER hisoblaydi; ilova faqat koordinata, aniqlik va yoshini yuboradi.
 */

export type Fix = { latitude: number; longitude: number; accuracy: number; positionAge: number; mocked?: boolean };

export async function locationPermission(ask: boolean) {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return "granted" as const;
  if (!ask) return current.canAskAgain ? ("undetermined" as const) : ("denied" as const);
  if (!current.canAskAgain) return "denied" as const;
  const answer = await Location.requestForegroundPermissionsAsync();
  return answer.granted ? ("granted" as const) : ("denied" as const);
}

/** Yuqori aniqlikdagi joriy joylashuv (eski kesh qabul qilinmaydi). */
export async function currentFix(): Promise<Fix> {
  const enabled = await Location.hasServicesEnabledAsync();
  if (!enabled) throw new Error("Telefonda joylashuv (GPS) o‘chirilgan. Sozlamalardan yoqing.");
  const position = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Joylashuv aniqlanmadi. Ochiq joyga chiqib qayta urinib ko‘ring.")), 20_000)),
  ]);
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Math.round(position.coords.accuracy ?? 999),
    positionAge: Math.max(0, Date.now() - position.timestamp),
    mocked: position.mocked,
  };
}

/** Xaritada ko‘rsatish uchun tez (oxirgi ma’lum) joylashuv — yuborilmaydi. */
export async function quickFix(): Promise<Fix | null> {
  const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 }).catch(() => null);
  if (!last) return null;
  return { latitude: last.coords.latitude, longitude: last.coords.longitude, accuracy: Math.round(last.coords.accuracy ?? 999), positionAge: Date.now() - last.timestamp };
}

/** Ikki nuqta orasidagi masofa (metr) — faqat ekranda ko‘rsatish uchun. */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
