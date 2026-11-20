import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "./api";

/* Oddiy so‘rov hook’i: xotira keshi (ekranlar orasida tez ochilish), ekran fokusida yangilash. */
const cache = new Map<string, { at: number; value: unknown }>();
/** Ochiq ekranlar: kesh tozalanganda shu yo‘ldagi ma’lumot darhol qayta yuklanadi. */
const live = new Map<string, Set<() => void>>();
export const invalidate = (prefix = "") => {
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
  for (const [path, fns] of live) if (path.startsWith(prefix)) for (const fn of fns) fn();
};
/** Butun keshni tozalash (chiqish / boshqa hisob bilan kirish) — ochiq ekranlar qayta so‘ramaydi. */
export const clearCache = () => cache.clear();

export function useData<T>(path: string | null, options: { refetchOnFocus?: boolean; maxAgeMs?: number } = {}) {
  const { refetchOnFocus = true, maxAgeMs = 30_000 } = options;
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
        const value = await api<T>(path);
        cache.set(path, { at: Date.now(), value });
        if (alive.current) {
          setData(value);
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
