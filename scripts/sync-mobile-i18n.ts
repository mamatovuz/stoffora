import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
 * Mini App ruscha lug‘atini (src/i18n.ts) mobil ilovaga ko‘chiradi: mobile/src/lib/i18n-dict.ts dagi
 * «<mini-app>» belgilari orasidagi qism almashtiriladi. Ilovaga xos so‘zlar — mobile/src/lib/i18n-mobile.ts.
 * Ishga tushirish: npx tsx scripts/sync-mobile-i18n.ts  (tests/mobile-features.test.ts farqni tekshiradi)
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const START = "/* <mini-app> */";
const END = "/* </mini-app> */";

const TRANSLATE = "export function translate(text: string, lang: Lang): string {";

/** src/i18n.ts dan RU … translate funksiyasi oxirigacha (DOM tarjimonisiz), translate → translateRaw. */
export function miniAppSection(source: string) {
  const from = source.indexOf("const RU: Record<string, string> = {");
  const fn = source.indexOf(TRANSLATE);
  const to = fn < 0 ? -1 : source.indexOf("\n}\n", fn);
  if (from < 0 || to < 0) throw new Error("src/i18n.ts tuzilishi o‘zgargan");
  return source.slice(from, to + 2).replace(TRANSLATE, "function translateRaw(text: string, lang: Lang): string {");
}

/** Qator oxirlari (Windows’da CRLF) farq qilmasin — LF bilan ishlab, fayldagi uslubni qaytaramiz. */
export function syncedDict(sourceText: string, dictText: string) {
  const source = sourceText.replace(/\r\n/g, "\n");
  const dict = dictText.replace(/\r\n/g, "\n");
  const a = dict.indexOf(START);
  const b = dict.indexOf(END);
  if (a < 0 || b < 0) throw new Error("i18n-dict.ts da <mini-app> belgilari yo‘q");
  const next = `${dict.slice(0, a + START.length)}\n${miniAppSection(source)}\n${dict.slice(b)}`;
  return dictText.includes("\r\n") ? next.replace(/\n/g, "\r\n") : next;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dictPath = `${root}mobile/src/lib/i18n-dict.ts`;
  const next = syncedDict(readFileSync(`${root}src/i18n.ts`, "utf8"), readFileSync(dictPath, "utf8"));
  writeFileSync(dictPath, next, "utf8");
  console.log("mobile/src/lib/i18n-dict.ts yangilandi");
}
