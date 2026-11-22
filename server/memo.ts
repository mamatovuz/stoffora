import { dataVersion } from "../lib/store";
import { tashkentClock } from "../lib/format";

/*
 * Og‘ir hisoblar (rahbar paneli: umumiy ko‘rinish, analitika, trendlar, tabel) uchun qisqa kesh.
 * Kalit — so‘rov parametrlari + ma’lumot versiyasi + joriy daqiqa: har qanday yozuv (davomat,
 * xodim, ta’til…) versiyani oshiradi va natija darhol qayta hisoblanadi; vaqtga bog‘liq holatlar
 * («hali kelmagan» → «kelmagan») esa keyingi daqiqada yangilanadi. Rahbar paneli bir necha
 * soniyada qayta-qayta ochilganda (fokus, pastga tortish, bir nechta rahbar) server qayta sanamaydi.
 */
const store = new Map<string, unknown>();
const MAX_ENTRIES = 500;

export function memo<T>(scope: string, parts: unknown[], compute: () => T): T {
  const key = `${scope}|${dataVersion()}|${tashkentClock()}|${JSON.stringify(parts)}`;
  if (store.has(key)) return store.get(key) as T;
  const value = compute();
  if (store.size >= MAX_ENTRIES) store.clear();
  store.set(key, value);
  return value;
}

/** Testlar uchun. */
export const clearMemo = () => store.clear();
