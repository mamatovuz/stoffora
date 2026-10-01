/*
 * Mini App bo‘limlari uchun xotiradagi kesh: bo‘limga qayta kirilganda oxirgi
 * ma’lumot darhol ko‘rinadi, yangisi fonda keladi (stale-while-revalidate).
 * Faqat shu sessiya xotirasida — qurilmaga yozilmaydi.
 */
const store = new Map<string, { at: number; value: unknown }>();

export function getCached<T>(key: string): T | null {
  return (store.get(key)?.value as T | undefined) ?? null;
}
export function setCached<T>(key: string, value: T) {
  store.set(key, { at: Date.now(), value });
}
export function clearCached(prefix = "") {
  for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key);
}
