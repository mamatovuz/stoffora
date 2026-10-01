import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { WEEKDAYS_SHORT, dateUz, tashkentIsoDate } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { haptic } from "./ui";

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Kunlar tasmasi (iOS kalendar uslubida) — sanani tanlash uchun, tashqi kutubxonasiz. */
export function DateStrip({
  value,
  onChange,
  from = tashkentIsoDate(),
  days = 60,
  dates,
  tone,
}: {
  value: string;
  onChange: (iso: string) => void;
  from?: string;
  days?: number;
  /** Faqat shu sanalar (masalan, dam kunlari). */
  dates?: string[];
  tone?: string;
}) {
  const { c } = useTheme();
  const list = useMemo(() => dates || Array.from({ length: days }, (_, i) => addDays(from, i)), [dates, from, days]);
  const accent = tone || c.accent;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
      {list.map((iso) => {
        const on = iso === value;
        const wd = new Date(`${iso}T12:00:00Z`).getUTCDay();
        return (
          <Pressable
            key={iso}
            onPress={() => {
              haptic.select();
              onChange(iso);
            }}
            style={[st.day, { backgroundColor: on ? accent : c.card, borderColor: on ? accent : c.line }]}
          >
            <Text style={{ color: on ? "#fff" : wd === 0 || wd === 6 ? c.danger : c.muted, fontSize: 11.5, fontWeight: "600" }}>{WEEKDAYS_SHORT[wd]}</Text>
            <Text style={{ color: on ? "#fff" : c.ink, fontSize: 18, fontWeight: "700" }}>{Number(iso.slice(8))}</Text>
            <Text style={{ color: on ? "rgba(255,255,255,0.85)" : c.muted, fontSize: 10.5 }}>{dateUz(iso).split("-")[1]}</Text>
          </Pressable>
        );
      })}
      <View style={{ width: 4 }} />
    </ScrollView>
  );
}

export { addDays };

const st = StyleSheet.create({
  day: { width: 54, paddingVertical: 8, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", gap: 1 },
});
