import { accessToken, api, errorText } from "./api";
import { SERVER_ORIGIN } from "./config";
import { signDevice } from "./deviceKey";
import { KEYS, secureGet } from "./secure";
import { updateInfo } from "./updates";

/*
 * Tezlik tekshiruvi (Sozlamalar → Ilova haqida → «Tarmoq tekshiruvi»). Ilova sekin bo‘lsa, qaysi bosqich
 * sekinligini raqam bilan ko‘rsatadi: kalit o‘qish, imzo (P-256, JS’da), sof tarmoq (/health),
 * token yangilash va oddiy so‘rovlar. Oxirida — JS oqimining eng uzun bloklanishi.
 */
export async function runDiagnostics(employee: boolean): Promise<string> {
  const lines: string[] = [];
  let last = Date.now();
  let worstStall = 0;
  const ticker = setInterval(() => {
    const now = Date.now();
    worstStall = Math.max(worstStall, now - last - 50);
    last = now;
  }, 50);
  const step = async (label: string, fn: () => Promise<unknown>) => {
    const started = Date.now();
    try {
      await fn();
      lines.push(`${label}: ${Date.now() - started} ms`);
    } catch (error) {
      lines.push(`${label}: XATO, ${Date.now() - started} ms (${errorText(error)})`);
    }
  };
  try {
    await step("Kalit o‘qish", () => secureGet(KEYS.session));
    await step("Imzo 1", () => signDevice("staffora:diagnostics:1"));
    await step("Imzo 2", () => signDevice("staffora:diagnostics:2"));
    for (const n of [1, 2, 3]) await step(`Server ${n}`, () => fetch(`${SERVER_ORIGIN}/health`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.text()));
    await step("Token yangilash", () => accessToken(true));
    if (employee) {
      await step("Bildirishnomalar", () => api("/mini/notifications"));
      await step("Bosh sahifa", () => api("/mini/home"));
    }
  } finally {
    clearInterval(ticker);
  }
  lines.push(`JS bloklanishi (eng uzun): ${Math.max(0, worstStall)} ms`);
  lines.push(`Yangilanish: ${updateInfo()}`);
  return lines.join("\n");
}
