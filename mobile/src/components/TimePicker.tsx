import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";
import { haptic } from "./ui";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));
const ITEM = 48;

/** Soat va daqiqa tanlagich (tashqi native modulsiz): ikki gorizontal tasma. `max` — bugun uchun hozirgi vaqt. */
export function TimePicker({ value, onChange, max }: { value: string; onChange: (hhmm: string) => void; max?: string }) {
  const { c } = useTheme();
  const [h, m] = value ? value.split(":") : ["", ""];
  const hours = useRef<ScrollView>(null);
  useEffect(() => {
    const index = HOURS.indexOf(h || "09");
    setTimeout(() => hours.current?.scrollTo({ x: Math.max(0, index - 2) * (ITEM + 8), animated: false }), 50);
    // Faqat birinchi ochilganda — tanlov paytida tasma sakramasin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const allowed = (hh: string, mm: string) => !max || `${hh}:${mm}` <= max;
  const pick = (hh: string, mm: string) => {
    haptic.select();
    // Kelajakdagi vaqt tanlanmaydi — eng yaqin ruxsat etilgan daqiqaga tushiriladi.
    if (!allowed(hh, mm)) mm = MINUTES.filter((x) => allowed(hh, x)).pop() || "00";
    onChange(`${hh}:${mm}`);
  };
  const chip = (label: string, on: boolean, disabled: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      disabled={disabled}
      onPress={onPress}
      style={[st.chip, { backgroundColor: on ? c.accent : c.card, borderColor: on ? c.accent : c.line, opacity: disabled ? 0.35 : 1 }]}
    >
      <Text style={{ color: on ? "#fff" : c.ink, fontSize: 17, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 10 }}>
      <View style={st.display}>
        <Text style={{ color: value ? c.ink : c.muted, fontSize: 40, fontWeight: "700", letterSpacing: -1, fontVariant: ["tabular-nums"] }}>{value || "--:--"}</Text>
      </View>
      <Text style={[st.label, { color: c.muted }]}>Soat</Text>
      <ScrollView ref={hours} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {HOURS.map((hh) => chip(hh, hh === h, !allowed(hh, "00"), () => pick(hh, m || "00")))}
      </ScrollView>
      <Text style={[st.label, { color: c.muted }]}>Daqiqa</Text>
      <View style={st.grid}>{MINUTES.map((mm) => chip(mm, mm === m, !h || !allowed(h, mm), () => pick(h || "09", mm)))}</View>
    </View>
  );
}

const st = StyleSheet.create({
  display: { alignItems: "center", paddingVertical: 4 },
  label: { fontSize: 12.5, fontWeight: "600", marginBottom: -4 },
  chip: { width: ITEM, height: 44, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
