/*
 * Ilova kirish nuqtasi. Fon vazifasi (geofence) router’dan oldin e’lon qilinadi — ilova fonda
 * (ekransiz) uyg‘onganda ham ishlashi uchun. Android vidjet ishlovchisi ham shu yerda ro‘yxatdan o‘tadi.
 */
import "./src/lib/geofence";
import "expo-router/entry";
import { Platform } from "react-native";

if (Platform.OS === "android") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerWidgetTaskHandler } = require("react-native-android-widget") as typeof import("react-native-android-widget");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { widgetTaskHandler } = require("./src/widgets/sync.android") as typeof import("./src/widgets/sync.android");
  registerWidgetTaskHandler(widgetTaskHandler);
}
