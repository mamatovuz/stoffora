import { File, Paths } from "expo-file-system";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, cachedSession, errorText } from "./api";

/*
 * Oddiy so‘rov hook’i: xotira keshi (ekranlar orasida tez ochilish), ekran fokusida yangilash.
 * Kesh telefonga ham yoziladi (ilova keshi papkasi): ilova qayta ochilganda oxirgi ma’lumot darhol
 * ko‘rinadi, yangisi fonda keladi (stale-while-revalidate) — oq ekran va «Yuklanmoqda…» kutilmaydi.
 * Fayl hisobga bog‘langan (boshqa hisob bilan kirilsa o‘qilmaydi) va chiqishda o‘chiriladi.
 */
const cache = new Map<string, { at: number; value: unknown }>();

/* ------------------------------------------------------- disk keshi --- */
const DISK_VERSION = 1;
/** Juda katta javoblar (masalan, uzun ro‘yxatlar) diskka yozilmaydi — ochilishni sekinlashtirmasin. */
const MAX_ENTRY_CHARS = 400_000;
const MAX_TOTAL_CHARS = 2_000_000;
const MAX_ENTRIES = 60;
type DiskFile = { v: number; owner: string; entries: [string, { at: number; value: unknown }][] };
const diskFile = () => new File(Paths.cache, "staffora-data-cache.json");
/** Kesh egasi: xodim yoki direktor ID si (sessiya yuklangan bo‘lsa). */
function ownerKey() {
  const session = cachedSession();
  if (!session) return null;
  return session.mode === "employee" ? `e:${session.employee.id}` : `m:${session.user.id}`;
}
let hydratedFor: string | null = null;
/** Diskdagi keshni (bir marta, shu hisob uchun) xotiraga o‘qiydi. Sinxron — birinchi render’dayoq ma’lumot bor. */
function hydrate() {
  const owner = ownerKey();
  if (!owner || hydratedFor === owner) return;
  hydratedFor = owner;
  try {
    const file = diskFile();
    if (!file.exists) return;
    const saved = JSON.parse(file.textSync()) as DiskFile;
    if (saved.v !== DISK_VERSION || saved.owner !== owner) return;
    for (const [key, entry] of saved.entries) if (!cache.has(key)) cache.set(key, entry);
  } catch {
    /* buzilgan fayl — e’tiborsiz, keyingi yozuv almashtiradi */
  }
}
let writeTimer: ReturnType<typeof setTimeout> | null = null;
function persistSoon() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const owner = ownerKey();
    if (!owner || hydratedFor !== owner) return;
    try {
      // Eng yangilari birinchi; hajm chegarasi ichida.
      const entries: DiskFile["entries"] = [];
      let total = 0;
      for (const [key, entry] of [...cache.entries()].sort((a, b) => b[1].at - a[1].at)) {
        if (entries.length >= MAX_ENTRIES) break;
        const size = JSON.stringify(entry.value)?.length ?? 0;
        if (size > MAX_ENTRY_CHARS || total + size > MAX_TOTAL_CHARS) continue;
        total += size;
        entries.push([key, entry]);
      }
      const file = diskFile();
      if (!file.exists) file.create();
      file.write(JSON.stringify({ v: DISK_VERSION, owner, entries } satisfies DiskFile));
    } catch {
      /* yozilmasa — kesh faqat xotirada qoladi */
    }
  }, 1_500);
}
/** Ixtiyoriy kalit bo‘yicha keshlash (useData’dan tashqari ekranlar uchun, masalan rahbar paneli). */
export function readCached<T>(key: string): T | undefined {
  hydrate();
  return cache.get(key)?.value as T | undefined;
}
export function writeCached(key: string, value: unknown) {
  cache.set(key, { at: Date.now(), value });
  persistSoon();
}
/** Yo‘ldagi so‘rovlar: bir vaqtda bir nechta ekran bir yo‘lni so‘rasa (masalan /mini/home) — bitta so‘rov. */
const inflight = new Map<string, Promise<unknown>>();
const shared = (path: string) => {
  let request = inflight.get(path);
  if (!request) {
    request = api<unknown>(path).finally(() => {
      if (inflight.get(path) === request) inflight.delete(path);
    });
    inflight.set(path, request);
  }
  return request;
};
/** Ochiq ekranlar: kesh tozalanganda shu yo‘ldagi ma’lumot darhol qayta yuklanadi. */
const live = new Map<string, Set<() => void>>();
export const invalidate = (prefix = "") => {
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
  // O‘zgarishdan oldin boshlangan so‘rov eski javob qaytarishi mumkin — qayta yuklash yangisini boshlaydi.
  for (const key of [...inflight.keys()]) if (key.startsWith(prefix)) inflight.delete(key);
  for (const [path, fns] of live) if (path.startsWith(prefix)) for (const fn of fns) fn();
  persistSoon();
};
/** Butun keshni tozalash (chiqish / boshqa hisob bilan kirish) — ochiq ekranlar qayta so‘ramaydi. */
export const clearCache = () => {
  cache.clear();
  inflight.clear();
  hydratedFor = null;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  try {
    const file = diskFile();
    if (file.exists) file.delete();
  } catch {
    /* fayl yo‘q */
  }
};

export function useData<T>(path: string | null, options: { refetchOnFocus?: boolean; maxAgeMs?: number } = {}) {
  const { refetchOnFocus = true, maxAgeMs = 30_000 } = options;
  hydrate();
  const cached = path ? (cache.get(path)?.value as T | undefined) : undefined;
  const [data, setData] = useState<T | undefined>(cached);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!cached && Boolean(path));
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  /** Yuklash (holat faqat javobdan keyin o‘zgaradi — effekt ichida sinxron setState yo‘q). */
  const load = useCallback(
    async () => {
      if (!path) return;
      try {
        const value = await shared(path);
        cache.set(path, { at: Date.now(), value });
        persistSoon();
        if (alive.current) {
          setData(value as T);
          setError("");
        }
      } catch (reason) {
        if (alive.current) setError(errorText(reason));
      } finally {
        if (alive.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [path],
  );

  // Yo‘l o‘zgarsa (masalan boshqa oy) — keshdagi qiymat shu render’dayoq ko‘rsatiladi (effekt’siz).
  const [shownPath, setShownPath] = useState(path);
  if (shownPath !== path) {
    setShownPath(path);
    const hit = path ? cache.get(path) : undefined;
    if (hit) setData(hit.value as T);
  }

  useEffect(() => {
    if (!path) return;
    const hit = cache.get(path);
    if (!hit || Date.now() - hit.at > maxAgeMs) void load();
  }, [path, load, maxAgeMs]);

  useEffect(() => {
    if (!path) return;
    const fn = () => void load();
    const set = live.get(path) || new Set();
    set.add(fn);
    live.set(path, set);
    return () => {
      set.delete(fn);
      if (!set.size) live.delete(path);
    };
  }, [path, load]);

  useFocusEffect(
    useCallback(() => {
      if (!refetchOnFocus || !path) return;
      const hit = cache.get(path);
      // Kesh tozalangan (invalidate) yoki eskirgan bo‘lsa — ekranga qaytganda yangilanadi.
      if (!hit || Date.now() - hit.at > 5_000) void load();
    }, [refetchOnFocus, path, load]),
  );

  const reload = () => {
    if (path) setRefreshing(true);
    return load();
  };
  return { data, error, loading, refreshing, reload, reloadSilent: load, setData };
}
