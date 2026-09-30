import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(Boolean(url)),
    [error, setError] = useState("");
  const latest = useRef(0);
  const reload = useCallback(
    async (silent = false) => {
      if (!url) return;
      const ticket = ++latest.current;
      if (!silent) setLoading(true);
      setError("");
      try {
        const next = await api<T>(url);
        if (ticket === latest.current) setData(next);
      } catch (e) {
        if (ticket === latest.current)
          setError(e instanceof Error ? e.message : "Xatolik yuz berdi");
      } finally {
        if (ticket === latest.current) setLoading(false);
      }
    },
    [url],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, loading, error, reload, setData };
}

/** Ma’lumotni fon rejimida vaqti-vaqti bilan yangilaydi. */
export function usePolling(callback: () => void, ms: number) {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") saved.current();
    }, ms);
    return () => window.clearInterval(timer);
  }, [ms]);
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

export function useDebounced<T>(value: T, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
