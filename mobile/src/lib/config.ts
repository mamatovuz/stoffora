import Constants from "expo-constants";

/** Backend manzili: EXPO_PUBLIC_API_URL (build vaqtida) yoki app.json → extra.apiUrl. */
export const API_URL = String(process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || "").replace(/\/+$/, "");
export const APP_VERSION = Constants.expoConfig?.version || "1.0.0";
export const EAS_PROJECT_ID: string | undefined = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId || undefined;

/** Server manzili (oxiridagi /api’siz) — fayl va rasm havolalari uchun. */
export const SERVER_ORIGIN = API_URL.replace(/\/api$/, "");
/**
 * Rasm manzili: server nisbiy havola (/api/media/…) beradi — brauzer uni o‘zi to‘ldiradi,
 * telefon esa yo‘q. data: yoki to‘liq https havolalar o‘zgarmaydi.
 */
export const mediaUri = (url?: string | null) => (!url ? undefined : url.startsWith("/") ? SERVER_ORIGIN + url : url);
