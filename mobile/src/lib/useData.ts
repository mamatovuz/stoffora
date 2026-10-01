import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "./api";

/* Oddiy so‘rov hook’i: xotira keshi (ekranlar orasida tez ochilish), ekran fokusida yangilash. */
const cache = new Map<string, { at: number; value: unknown }>();
export const invalidate = (prefix = "") => {
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
};

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

  const load = useCallback(
    async (mode: "initial" | "refresh" | "silent" = "silent") => {
      if (!path) return;
      if (mode === "refresh") setRefreshing(true);
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

  useEffect(() => {
    if (!path) return;
    const hit = cache.get(path);
    if (hit) setData(hit.value as T);
    if (!hit || Date.now() - hit.at > maxAgeMs) void load(hit ? "silent" : "initial");
  }, [path, load, maxAgeMs]);

  useFocusEffect(
    useCallback(() => {
      if (!refetchOnFocus || !path) return;
      const hit = cache.get(path);
      if (hit && Date.now() - hit.at > 5_000) void load("silent");
    }, [refetchOnFocus, path, load]),
  );

  return { data, error, loading, refreshing, reload: () => load("refresh"), reloadSilent: () => load("silent"), setData };
}
