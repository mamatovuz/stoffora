import Constants from "expo-constants";

/** Backend manzili: EXPO_PUBLIC_API_URL (build vaqtida) yoki app.json → extra.apiUrl. */
export const API_URL = String(process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || "").replace(/\/+$/, "");
export const APP_VERSION = Constants.expoConfig?.version || "1.0.0";
export const EAS_PROJECT_ID: string | undefined = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId || undefined;
