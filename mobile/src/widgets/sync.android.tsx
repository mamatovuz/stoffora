import * as SecureStore from "expo-secure-store";
import { Appearance } from "react-native";
import { requestWidgetUpdate, type WidgetTaskHandlerProps } from "react-native-android-widget";
import type { HomeData } from "@/lib/types";
import { todayProps } from "./props";
import { TodayAndroidWidget } from "./TodayWidget.android";
import type { TodayProps } from "./types";

export { todayProps };

/*
 * Android: vidjet holati telefonda saqlanadi — tizim vidjetni ilova yopiq paytda ham
 * (har 30 daqiqada, qo‘shilganda, o‘lchami o‘zgarganda) chizadi va shu holatni o‘qiydi.
 */
export const WIDGET_NAME = "Today";
const KEY = "staffora.widget.today.v1";

async function stored(): Promise<TodayProps | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as TodayProps) : null;
  } catch {
    return null;
  }
}
const dark = () => Appearance.getColorScheme() === "dark";

export async function updateTodayWidget(home: HomeData) {
  const props = todayProps(home);
  await SecureStore.setItemAsync(KEY, JSON.stringify(props)).catch(() => undefined);
  await requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => <TodayAndroidWidget props={props} dark={dark()} /> }).catch(() => undefined);
}

/** index.ts’da ro‘yxatdan o‘tkaziladi (registerWidgetTaskHandler). */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetInfo.widgetName !== WIDGET_NAME) return;
  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED":
      props.renderWidget(<TodayAndroidWidget props={await stored()} dark={dark()} />);
      break;
    default:
      break;
  }
}
