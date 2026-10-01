import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { del, post } from "./api";
import { EAS_PROJECT_ID } from "./config";

/*
 * Push xabarnomalar (Expo Push → APNs / FCM). Ruxsat faqat foydalanuvchi tushuntirishni o‘qib,
 * tugmani bosgandan keyin so‘raladi. Token serverda alohida jadvalda, qurilmaga bog‘langan;
 * token o‘zgarsa (rotatsiya) — qayta yuboriladi. Push kalitlari ilovada saqlanmaydi.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

export async function ensureChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Staffora",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 120, 200],
    lightColor: "#2563EB",
  });
}

export type PushState = "granted" | "denied" | "undetermined" | "unavailable";

export async function pushPermission(): Promise<PushState> {
  if (!Device.isDevice) return "unavailable";
  const current = await Notifications.getPermissionsAsync();
  return current.granted ? "granted" : current.canAskAgain ? "undetermined" : "denied";
}

/** Ruxsat so‘raydi (kerak bo‘lsa) va tokenni serverga ro‘yxatdan o‘tkazadi. */
export async function registerPush(ask: boolean): Promise<PushState> {
  if (!Device.isDevice) return "unavailable";
  await ensureChannel();
  let state = await pushPermission();
  if (state === "undetermined" && ask) {
    const answer = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
    state = answer.granted ? "granted" : "denied";
  }
  if (state !== "granted") return state;
  if (!EAS_PROJECT_ID) return "unavailable";
  const token = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
  await post("/mobile/push-token", { token: token.data, platform: Platform.OS === "ios" ? "ios" : "android" });
  return "granted";
}

/** OS push tokenini almashtirsa — yangisini serverga yuboramiz. */
export function watchPushToken() {
  const sub = Notifications.addPushTokenListener(() => {
    void registerPush(false).catch(() => undefined);
  });
  return () => sub.remove();
}

export async function unregisterPush() {
  await del("/mobile/push-token").catch(() => undefined);
}
