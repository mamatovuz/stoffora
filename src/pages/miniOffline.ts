import { ApiError, post } from "../api";
import type { Attendance } from "@/lib/types";

/*
 * Internetsiz davomat navbati. Aloqa yo‘q paytda belgi (yuz deskriptori, GPS,
 * belgilangan vaqt) qurilmada saqlanadi; aloqa tiklanishi bilan serverga
 * yuboriladi va u yerda to‘liq qayta tekshiriladi. Vaqt qurilma soatiga emas,
 * «qancha vaqt oldin» ga qarab hisoblanadi — soatni o‘zgartirish foyda bermaydi.
 */

export type FaceCapture = {
  descriptor: number[];
  turnDescriptor?: number[];
  photo?: string;
};
export type OfflineItem = {
  clientId: string;
  action: "CHECK_IN" | "CHECK_OUT";
  descriptor: number[];
  turnDescriptor?: number[];
  latitude: number;
  longitude: number;
  accuracy?: number;
  capturedAt: number;
  /** Qurilma yoqilgandan beri o‘tgan vaqt — soat o‘zgartirilganini sezish uchun. */
  perfAt: number;
  photoDataUrl?: string;
};
export type SyncResult = { clientId: string; ok: boolean; message: string; duplicate?: boolean; attendance?: Attendance };

const MAX_AGE = 12 * 3_600_000;
const key = () => {
  const id = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  return `staffora:mini:offline:${id || "local"}`;
};

export function readQueue(): OfflineItem[] {
  try {
    const raw = localStorage.getItem(key());
    const list = raw ? (JSON.parse(raw) as OfflineItem[]) : [];
    return Array.isArray(list) ? list.filter((item) => Date.now() - item.capturedAt < MAX_AGE + 3_600_000) : [];
  } catch {
    return [];
  }
}
function writeQueue(list: OfflineItem[]) {
  try {
    if (list.length) localStorage.setItem(key(), JSON.stringify(list.slice(-6)));
    else localStorage.removeItem(key());
  } catch {
    // Xotira to‘lgan bo‘lsa — rasmsiz saqlab ko‘ramiz.
    try {
      localStorage.setItem(key(), JSON.stringify(list.slice(-6).map((item) => ({ ...item, photoDataUrl: undefined }))));
    } catch {
      /* saqlab bo‘lmadi */
    }
  }
  window.dispatchEvent(new Event("staffora:offline-queue"));
}

export function enqueueOffline(item: Omit<OfflineItem, "clientId" | "capturedAt" | "perfAt">) {
  const list = readQueue();
  // Bir xil amal ikki marta navbatga tushmasin.
  if (list.some((x) => x.action === item.action && Date.now() - x.capturedAt < 10 * 60_000))
    throw new Error(item.action === "CHECK_IN" ? "Kelish allaqachon saqlangan — internet kelishi bilan yuboriladi." : "Ketish allaqachon saqlangan.");
  const value: OfflineItem = {
    ...item,
    clientId: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    capturedAt: Date.now(),
    perfAt: performance.now(),
  };
  writeQueue([...list, value]);
  return value;
}

/** Navbatni yuboradi. Aloqa bo‘lmasa jim chiqadi; har bir yozuv natijasini qaytaradi. */
let syncing: Promise<SyncResult[]> | null = null;
export function syncOfflineQueue(): Promise<SyncResult[]> {
  if (syncing) return syncing;
  syncing = (async () => {
    const list = readQueue();
    if (!list.length) return [];
    const now = Date.now();
    try {
      const { results } = await post<{ results: SyncResult[] }>("/mini/attendance/offline", {
        items: list.map((item) => {
          // Sahifa yopilmagan bo‘lsa — monoton soat aniqroq (qurilma soati o‘zgartirilsa ham).
          const age = performance.now() >= item.perfAt && performance.now() - item.perfAt < MAX_AGE ? performance.now() - item.perfAt : now - item.capturedAt;
          return {
            clientId: item.clientId,
            action: item.action,
            descriptor: item.descriptor,
            turnDescriptor: item.turnDescriptor,
            latitude: item.latitude,
            longitude: item.longitude,
            accuracy: item.accuracy,
            ageMs: Math.max(0, Math.round(age)),
            photoDataUrl: item.photoDataUrl,
          };
        }),
      });
      // Qabul qilingan va rad etilganlar navbatdan olinadi (rad etilganini qayta yuborish foydasiz).
      const done = new Set(results.map((r) => r.clientId));
      writeQueue(readQueue().filter((item) => !done.has(item.clientId)));
      return results;
    } catch (reason) {
      if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500 && reason.status !== 401 && reason.status !== 429) {
        // Ma’lumot yaroqsiz — navbatni tozalaymiz, aks holda abadiy qayta urinadi.
        writeQueue([]);
        return list.map((item) => ({ clientId: item.clientId, ok: false, message: reason.message }));
      }
      return [];
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

export const isNetworkError = (reason: unknown) => reason instanceof ApiError && reason.status === 0;
