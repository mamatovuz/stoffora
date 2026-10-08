/*
 * Ilova kirish nuqtasi. Fon vazifalari (geofence) va Android vidjet ishlovchisi router’dan oldin
 * ro‘yxatdan o‘tishi kerak — ilova fonda (ekransiz) uyg‘onganda ham ishlashi uchun.
 */
import { Platform } from "react-native";
import "./src/lib/geofence";

if (Platform.OS === "android") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerWidgetTaskHandler } = require("react-native-android-widget") as typeof import("react-native-android-widget");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { widgetTaskHandler } = require("./src/widgets/sync.android") as typeof import("./src/widgets/sync.android");
  registerWidgetTaskHandler(widgetTaskHandler);
}

import "expo-router/entry";
