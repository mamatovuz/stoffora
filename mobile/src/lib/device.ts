import * as Application from "expo-application";
import * as Device from "expo-device";
import { Platform } from "react-native";
import type { DeviceInfo } from "./api";
import { APP_VERSION } from "./config";

/** Telefon haqida qisqa ma’lumot — kirishda serverga («Kirgan qurilmalar» ro‘yxati uchun). */
export const deviceInfo = (): DeviceInfo => ({
  platform: Platform.OS === "ios" ? "ios" : "android",
  model: Device.modelName || undefined,
  osVersion: Device.osVersion || undefined,
  appVersion: Application.nativeApplicationVersion || APP_VERSION,
});
