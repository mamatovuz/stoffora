import { Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { background, containerBackground, cornerRadius, font, foregroundStyle, padding, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { TodayProps } from "./types";

/*
 * iOS bosh ekran vidjeti: bugungi holat va «Ishga keldim / Ishdan ketdim» tugmasi.
 * Vidjet alohida muhitda ishlaydi — tashqaridagi o‘zgaruvchi va funksiyalarni ishlatmaydi,
 * hamma narsa props orqali keladi. Kun almashsa (eski ma’lumot) — «Yangi kun» ko‘rinadi.
 */
const TodayWidget = (props: TodayProps, environment: WidgetEnvironment) => {
  "widget";
  const day = new Date(environment.date.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
  const fresh = props.date === day;
  const action = fresh ? props.action : "in";
  const status = fresh ? props.status : "Yangi kun";
  const detail = fresh && props.checkIn ? `Keldi ${props.checkIn}${props.checkOut ? ` · Ketdi ${props.checkOut}` : ""}` : props.shift || "Staffora";
  const url = action === "out" ? "staffora://go/checkout" : action === "in" ? "staffora://go/checkin" : "staffora://go/home";
  const label = action === "out" ? "Ishdan ketdim" : action === "in" ? "Ishga keldim" : "Ochish";
  const dark = environment.colorScheme === "dark";
  return (
    <VStack alignment="leading" spacing={4} modifiers={[widgetURL(url), containerBackground(dark ? "#181B20" : "#FFFFFF", "widget")]}>
      <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle({ type: "hierarchical", style: "secondary" })]}>Staffora</Text>
      <Text modifiers={[font({ size: 17, weight: "semibold" })]}>{status}</Text>
      <Text modifiers={[font({ size: 12 }), foregroundStyle({ type: "hierarchical", style: "secondary" })]}>{detail}</Text>
      <Spacer />
      <Text
        modifiers={[
          font({ size: 14, weight: "semibold" }),
          foregroundStyle("#FFFFFF"),
          padding({ horizontal: 12, vertical: 7 }),
          background(action === "out" ? "#E5484D" : "#2563EB"),
          cornerRadius(10),
        ]}
      >
        {label}
      </Text>
    </VStack>
  );
};

export default createWidget<TodayProps>("TodayWidget", TodayWidget);
