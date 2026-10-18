import * as Application from "expo-application";
import { File, Paths } from "expo-file-system";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import { post } from "./api";
import { API_URL } from "./config";

/*
 * Xatolar jurnali (Sentry o‘rniga — o‘z serverimizda, tashqi hisobsiz): ilova qulasa yoki kutilmagan
 * xato bo‘lsa, panelga yoziladi (Sozlamalar → «Ilova va Mini App xatolari»): qaysi xodim, qaysi
 * telefon (android/ios), qaysi versiya va xato matni + stack.
 * Ilova butunlay qulasa, xabar internetga ulgurmasligi mumkin — shuning uchun avval telefonga
 * yoziladi va keyingi ochilishda yuboriladi.
 */

const MAX_PER_SESSION = 20;
let sent = 0;
const crashFile = () => new File(Paths.document, "staffora-crash.json");

export function appVersion() {
  const native = Application.nativeApplicationVersion || "?";
  const update = !__DEV__ && Updates.isEnabled && !Updates.isEmbeddedLaunch && Updates.updateId ? `+${Updates.updateId.slice(0, 6)}` : "";
  return `${native}${update}`.slice(0, 20);
}

type Entry = { kind: string; message: string; detail?: string };
const describe = (detail: unknown) => (detail instanceof Error ? `${detail.name}: ${detail.message}\n${detail.stack || ""}` : detail === undefined || detail === null ? undefined : String(detail));

async function send(entry: Entry) {
  const body = { kind: entry.kind.slice(0, 40), message: entry.message.slice(0, 500), detail: entry.detail?.slice(0, 2000), platform: `${Platform.OS}-ilova`, version: appVersion() };
  try {
    await post("/mini-log", body, 10_000);
  } catch {
    // Sessiya yo‘q (kirishdan oldin) — tokensiz yuboramiz.
    await fetch(`${API_URL}/mini-log`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
  }
}

/** Xatoni jurnalga yuboradi (sessiyada 20 tagacha — bir xato tsiklda serverni to‘ldirmasin). */
export function reportError(kind: string, message: string, detail?: unknown) {
  if (!message || sent >= MAX_PER_SESSION) return;
  sent += 1;
  void send({ kind, message, detail: describe(detail) });
}

/** Ilova qulaganda — sinxron faylga (keyingi ochilishda yuboriladi). */
function rememberCrash(entry: Entry) {
  try {
    const file = crashFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(entry));
  } catch {
    /* fayl yozilmasa ham ilova o‘z ishini davom ettiradi */
  }
}

/** Oldingi ishga tushishda qulagan bo‘lsa — hozir yuboradi. */
export async function flushCrash() {
  try {
    const file = crashFile();
    if (!file.exists) return;
    const entry = JSON.parse(await file.text()) as Entry;
    file.delete();
    if (entry?.message) await send(entry);
  } catch {
    /* buzilgan fayl — e’tiborsiz */
  }
}

let installed = false;
/** Global JS xatolari (qulash ham) — jurnalga. */
export function installErrorReporting() {
  if (installed) return;
  installed = true;
  const utils = (globalThis as { ErrorUtils?: { getGlobalHandler: () => (error: Error, fatal?: boolean) => void; setGlobalHandler: (handler: (error: Error, fatal?: boolean) => void) => void } }).ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, fatal) => {
    const entry = { kind: fatal ? "crash" : "js", message: error?.message || "Noma’lum xato", detail: describe(error) };
    if (fatal) rememberCrash(entry);
    else reportError(entry.kind, entry.message, error);
    previous(error, fatal);
  });
  void flushCrash();
}
