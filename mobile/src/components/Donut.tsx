import { Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useTheme } from "@/lib/theme";

/*
 * Halqa diagramma + izoh (davomat statistikasi). Bo‘sh qismlar ko‘rsatilmaydi.
 * Qismlar orasida kichik bo‘shliq — yonma-yon ranglar bir-biriga qo‘shilib ketmasin.
 */
export type Slice = { label: string; value: number; color: string };

export function Donut({ slices, size = 150, center }: { slices: Slice[]; size?: number; center?: string }) {
  const { c } = useTheme();
  const shown = slices.filter((s) => s.value > 0);
  const total = shown.reduce((n, s) => n + s.value, 0);
  const stroke = size * 0.2;
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const gap = shown.length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.line} strokeWidth={stroke} fill="none" />
          {total
            ? shown.map((s) => {
                const part = (s.value / total) * len;
                const el = <Circle key={s.label} cx={size / 2} cy={size / 2} r={r} stroke={s.color} strokeWidth={stroke} fill="none" strokeDasharray={`${Math.max(0, part - gap)} ${len}`} strokeDashoffset={-offset} />;
                offset += part;
                return el;
              })
            : null}
        </Svg>
        <Text style={{ color: c.ink, fontSize: size * 0.15, fontWeight: "700" }}>{center ?? total}</Text>
      </View>
      <View style={{ flex: 1, gap: 10 }}>
        {shown.length ? (
          shown.map((s) => (
            <View key={s.label} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.ink, fontSize: 16, fontWeight: "600" }}>
                  {s.value}
                  <Text style={{ color: c.muted, fontSize: 12.5, fontWeight: "400" }}> · {total ? Math.round((s.value / total) * 100) : 0}%</Text>
                </Text>
                <Text style={{ color: c.muted, fontSize: 12.5 }}>{s.label}</Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={{ color: c.muted }}>Ma’lumot yo‘q</Text>
        )}
      </View>
    </View>
  );
}
