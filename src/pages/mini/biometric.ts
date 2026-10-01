import { ApiError, del, post } from "../../api";
import { reportError, supports, tg } from "./tg";

/*
 * Telefon biometriyasi (Telegram BiometricManager, Bot API 7.2+).
 *
 * Ulash: xodim bir marta Face ID’dan o‘tadi → server tasodifiy qurilma kaliti beradi →
 * kalit Telegram’ning biometrik xotirasiga yoziladi (barmoq izi / yuz bilan himoyalangan).
 * Keyin: barmoq izi → kalit → server 3 daqiqalik yuz-dalil beradi (har N-belgida baribir yuz).
 */

type Manager = NonNullable<TelegramWebApp["BiometricManager"]>;
export type BioInfo = { available: boolean; type: "finger" | "face" | "unknown"; tokenSaved: boolean; accessGranted: boolean };

let ready: Promise<Manager | null> | null = null;
function manager(): Promise<Manager | null> {
  if (!ready)
    ready = new Promise((resolve) => {
      const bm = tg()?.BiometricManager;
      if (!bm || !supports("7.2") || !tg()?.initData) return resolve(null);
      if (bm.isInited) return resolve(bm);
      const timer = window.setTimeout(() => resolve(null), 2500);
      try {
        bm.init(() => {
          window.clearTimeout(timer);
          resolve(bm);
        });
      } catch {
        window.clearTimeout(timer);
        resolve(null);
      }
    });
  return ready;
}

export async function biometricInfo(): Promise<BioInfo> {
  const bm = await manager();
  if (!bm || !bm.isBiometricAvailable) return { available: false, type: "unknown", tokenSaved: false, accessGranted: false };
  return { available: true, type: bm.biometricType, tokenSaved: bm.isBiometricTokenSaved, accessGranted: bm.isAccessGranted };
}

export const biometricLabel = (type: BioInfo["type"]) => (type === "face" ? "Face ID (telefon)" : type === "finger" ? "Barmoq izi" : "Telefon biometriyasi");

/** Face ID’dan keyin chaqiriladi: ruxsat so‘raydi, serverda ro‘yxatdan o‘tkazadi, kalitni saqlaydi. */
export async function enableBiometric(faceProof: string): Promise<boolean> {
  const bm = await manager();
  if (!bm?.isBiometricAvailable) return false;
  const granted = bm.isAccessGranted
    ? true
    : await new Promise<boolean>((resolve) => bm.requestAccess({ reason: "Davomatni tez tasdiqlash uchun" }, (ok) => resolve(ok)));
  if (!granted) return false;
  const label = `${tg()?.platform || "telefon"} · ${bm.biometricType === "face" ? "yuz" : "barmoq izi"}`;
  const { token } = await post<{ token: string }>("/mini/biometric/register", { faceProof, label });
  return new Promise((resolve) => bm.updateBiometricToken(token, (updated) => resolve(updated)));
}

export async function disableBiometric() {
  const bm = await manager();
  if (bm?.isBiometricTokenSaved) await new Promise<void>((resolve) => bm.updateBiometricToken("", () => resolve()));
  await del("/mini/biometric").catch(() => undefined);
}

export type QuickResult = { kind: "proof"; proof: string } | { kind: "face" } | { kind: "cancel" };

/**
 * Barmoq izi bilan tasdiqlash. Server bu safar yuz talab qilsa yoki kalit
 * bekor qilingan bo‘lsa — `face` (oddiy Face ID oqimiga o‘tiladi).
 */
export async function quickProof(reason: string): Promise<QuickResult> {
  const bm = await manager();
  if (!bm?.isBiometricAvailable || !bm.isBiometricTokenSaved) return { kind: "face" };
  const token = await new Promise<string | null>((resolve) =>
    bm.authenticate({ reason }, (ok, value) => resolve(ok && value ? value : null)),
  );
  if (!token) return { kind: "cancel" };
  try {
    const { proof } = await post<{ proof: string }>("/mini/biometric/verify", { token });
    return { kind: "proof", proof };
  } catch (reason) {
    if (reason instanceof ApiError) {
      if (reason.code === "BIOMETRIC_REVOKED" || reason.code === "BIOMETRIC_DISABLED") {
        await new Promise<void>((resolve) => bm.updateBiometricToken("", () => resolve()));
        return { kind: "face" };
      }
      if (reason.status === 428) return { kind: "face" };
    }
    reportError("biometric", reason instanceof Error ? reason.message : "verify failed", reason);
    throw reason;
  }
}

export async function openBiometricSettings() {
  (await manager())?.openSettings();
}
