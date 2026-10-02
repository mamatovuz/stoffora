import { router, type Href } from "expo-router";

/*
 * Xavfsiz o‘tish: tez-tez ikki marta bosilganda bir ekran ikki qavat ochilmasin.
 * Tab bo‘limlariga `navigate` (mavjud ekranga qaytadi), boshqalarga `push`.
 */
let last = 0;
export function go(href: Href) {
  const now = Date.now();
  if (now - last < 700) return;
  last = now;
  const path = typeof href === "string" ? href : href.pathname;
  if (String(path).startsWith("/(tabs)")) router.navigate(href);
  else router.push(href);
}
