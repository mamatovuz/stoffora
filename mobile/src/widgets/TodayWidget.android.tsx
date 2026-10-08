import { FlexWidget, TextWidget } from "react-native-android-widget";
import type { TodayProps } from "./types";

/*
 * Android bosh ekran vidjeti: bugungi holat va «Ishga keldim / Ishdan ketdim» tugmasi.
 * Tugma ilovani kerakli amal bilan ochadi (staffora://go/checkin).
 */
const today = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);

export function TodayAndroidWidget({ props, dark }: { props: TodayProps | null; dark: boolean }) {
  const fresh = Boolean(props && props.date === today());
  const action = fresh && props ? props.action : "in";
  const status = fresh && props ? props.status : props ? "Yangi kun" : "Ilovani oching";
  const detail = fresh && props?.checkIn ? `Keldi ${props.checkIn}${props.checkOut ? ` · Ketdi ${props.checkOut}` : ""}` : props?.shift || "Staffora";
  const uri = action === "out" ? "staffora://go/checkout" : action === "in" ? "staffora://go/checkin" : "staffora://go/home";
  const label = action === "out" ? "Ishdan ketdim" : action === "in" ? "Ishga keldim" : "Ochish";
  const ink = dark ? "#F1F5F9" : "#0F172A";
  const muted = dark ? "#94A3B8" : "#64748B";
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: "staffora://go/home" }}
      style={{ height: "match_parent", width: "match_parent", flexDirection: "column", justifyContent: "space-between", padding: 14, borderRadius: 20, backgroundColor: dark ? "#181B20" : "#FFFFFF" }}
    >
      <FlexWidget style={{ flexDirection: "column" }}>
        <TextWidget text="Staffora" style={{ fontSize: 12, color: muted }} />
        <TextWidget text={status} style={{ fontSize: 17, fontWeight: "600", color: ink }} maxLines={1} truncate="END" />
        <TextWidget text={detail} style={{ fontSize: 12, color: muted }} maxLines={1} truncate="END" />
      </FlexWidget>
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri }}
        style={{ width: "match_parent", alignItems: "center", paddingVertical: 8, borderRadius: 10, backgroundColor: action === "out" ? "#E5484D" : "#2563EB" }}
      >
        <TextWidget text={label} style={{ fontSize: 14, fontWeight: "600", color: "#FFFFFF" }} />
      </FlexWidget>
    </FlexWidget>
  );
}
