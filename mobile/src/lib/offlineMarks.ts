import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { ApiError, post } from "./api";
import { invalidate } from "./useData";

/*
 * Internetsiz keldi-ketdi (Mini App’dagi kabi). Aloqa yo‘q joyda (ombor, yerto‘la) yuz kadrlari, GPS va
 * belgilangan vaqt telefonda saqlanadi; aloqa tiklanishi bilan serverga yuboriladi. Server hammasini
 * qayta tekshiradi: yuz profilga mosmi, jonlimi (kadrlar bir xil emasmi), GPS filial hududidami;
 * vaqt telefon soatiga emas, «necha ms oldin» ga qarab hisoblanadi; 12 soatdan eskisi qabul qilinmaydi;
 * har biri «Internetsiz» belgisi bilan HR ko‘rigiga chiqadi.
 * Kadrlar faqat yuborilguncha telefonda turadi — keyin o‘chiriladi.
 */

export type OfflineMark = {
  clientId: string;
  action: "CHECK_IN" | "CHECK_OUT";
  photos: string[];
  latitude: number;
  longitude: number;
  accuracy?: number;
  /** Belgilangan vaqt (telefon soati, ms) — serverga «necha ms oldin» bo‘lib boradi. */
  createdAt: number;
};
export type SyncFailure = { action: OfflineMark["action"]; at: number; message: string };

const MAX_AGE_MS = 12 * 3_600_000;
const MAX_QUEUE = 6;
const store = () => new File(Paths.document, "staffora-offline-marks.json");

let cache: OfflineMark[] | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

function load(): OfflineMark[] {
  if (cache) return cache;
  try {
    const file = store();
    cache = file.exists ? (JSON.parse(file.textSync()) as OfflineMark[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}
function save(list: OfflineMark[]) {
  cache = list;
  try {
    const file = store();
    if (!list.length) {
      if (file.exists) file.delete();
    } else {
      if (!file.exists) file.create();
      file.write(JSON.stringify(list));
    }
  } catch {
    /* xotiraga yozilmasa — navbat ilova ochiq turguncha xotirada */
  }
  emit();
}

export const queuedMarks = () => load();

/** Internet yo‘q paytdagi belgini saqlaydi. */
export function queueMark(input: Omit<OfflineMark, "clientId" | "createdAt">) {
  const mark: OfflineMark = { ...input, clientId: Crypto.randomUUID(), createdAt: Date.now() };
  save([...load(), mark].slice(-MAX_QUEUE));
  return mark;
}

/** Bugun telefonda saqlangan, hali yuborilmagan oxirgi belgi (bosh ekran holati uchun). */
export function pendingToday(action: OfflineMark["action"]) {
  const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
  return load().find((m) => m.action === action && new Date(m.createdAt + 5 * 3_600_000).toISOString().slice(0, 10) === today);
}

let flushing: Promise<{ sent: number; failures: SyncFailure[] }> | null = null;
/**
 * Saqlangan belgilarni yuboradi (eng eskisidan). Server rad etsa — o‘chiriladi va sababi qaytadi;
 * aloqa yo‘q bo‘lsa — navbatda qoladi.
 */
export function flushMarks() {
  flushing ||= (async () => {
    let sent = 0;
    const failures: SyncFailure[] = [];
    for (const mark of [...load()].sort((a, b) => a.createdAt - b.createdAt)) {
      const age = Date.now() - mark.createdAt;
      if (age > MAX_AGE_MS) {
        failures.push({ action: mark.action, at: mark.createdAt, message: "12 soatdan eski belgi qabul qilinmaydi — HR’ga murojaat qiling." });
        save(load().filter((m) => m.clientId !== mark.clientId));
        continue;
      }
      try {
        const { results } = await post<{ results: { clientId: string; ok: boolean; message: string }[] }>(
          "/mini/attendance/offline",
          { items: [{ clientId: mark.clientId, action: mark.action, photos: mark.photos, latitude: mark.latitude, longitude: mark.longitude, accuracy: mark.accuracy, ageMs: Math.max(0, age) }] },
          60_000,
        );
        const result = results.find((r) => r.clientId === mark.clientId);
        if (result?.ok) sent += 1;
        else failures.push({ action: mark.action, at: mark.createdAt, message: result?.message || "Belgi qabul qilinmadi." });
        save(load().filter((m) => m.clientId !== mark.clientId));
      } catch (error) {
        // Aloqa yo‘q / server band — keyinroq. Boshqa xato (masalan, noto‘g‘ri ma’lumot) — belgi o‘chiriladi.
        if (error instanceof ApiError && (error.code === "NETWORK" || error.status === 0 || error.status === 429 || error.status >= 500)) break;
        failures.push({ action: mark.action, at: mark.createdAt, message: error instanceof Error ? error.message : "Belgi qabul qilinmadi." });
        save(load().filter((m) => m.clientId !== mark.clientId));
      }
    }
    if (sent) invalidate("/mini/");
    if (failures.length) lastFailures = [...failures, ...lastFailures].slice(0, 5);
    emit();
    return { sent, failures };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

let lastFailures: SyncFailure[] = [];
/** Oxirgi rad etilgan belgilar (foydalanuvchiga ko‘rsatish uchun) va tozalash. */
export const syncFailures = () => lastFailures;
export function clearSyncFailures() {
  lastFailures = [];
  emit();
}

/** Ilova faol bo‘lganda va har daqiqada (navbat bo‘lsa) avtomatik yuborish. */
export function watchOfflineMarks() {
  const tick = () => {
    if (load().length) void flushMarks();
  };
  tick();
  const timer = setInterval(tick, 60_000);
  const sub = AppState.addEventListener("change", (state) => state === "active" && tick());
  return () => {
    clearInterval(timer);
    sub.remove();
  };
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
let snapshot = { count: 0, failures: lastFailures };
const getSnapshot = () => {
  const count = load().length;
  if (count !== snapshot.count || lastFailures !== snapshot.failures) snapshot = { count, failures: lastFailures };
  return snapshot;
};
/** Bosh ekran: nechta belgi kutmoqda va oxirgi rad etilganlar. */
export function useOfflineMarks() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/* ------------------------------------------------ oxirgi ma’lum filiallar --- */
type KnownBranch = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number; attendanceMode?: "QR_GPS_FACE" | "GPS_FACE" };
const branchesFile = () => new File(Paths.document, "staffora-branches.json");
let knownCache: KnownBranch[] | null = null;

/** Bosh ekran ma’lumoti kelganda — filiallar telefonga yoziladi (internetsiz ochilganda hudud tekshiruvi uchun). */
export function rememberBranches(list: KnownBranch[]) {
  const slim = list.map(({ id, name, latitude, longitude, radiusMeters, attendanceMode }) => ({ id, name, latitude, longitude, radiusMeters, attendanceMode }));
  if (JSON.stringify(slim) === JSON.stringify(knownCache)) return;
  knownCache = slim;
  try {
    const file = branchesFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(slim));
  } catch {
    /* yozilmasa — faqat onlayn rejimda ishlaydi */
  }
}
export function knownBranches(): KnownBranch[] {
  if (knownCache) return knownCache;
  try {
    const file = branchesFile();
    knownCache = file.exists ? (JSON.parse(file.textSync()) as KnownBranch[]) : [];
  } catch {
    knownCache = [];
  }
  return knownCache;
}
