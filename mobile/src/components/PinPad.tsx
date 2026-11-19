import { useEffect, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { useTheme } from "@/lib/theme";
import { Icon, haptic } from "./ui";

/*
 * Minimal PIN klaviaturasi: yuqorida sarlavha va yumshoq nuqtalar, pastda fonsiz katta raqamlar
 * (bosilganda yengil doira). Xato bo‘lsa nuqtalar qizaradi va chayqaladi (shake).
 * `spread` — sarlavha tepada, klaviatura pastda (to‘liq ekranli qulf uchun).
 */
export function PinPad({
  length = 4,
  value,
  onChange,
  title,
  subtitle,
  error,
  shake,
  disabled,
  left,
  spread,
}: {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  title: string;
  subtitle?: string;
  error?: string;
  /** Har o‘zgarganda chayqaladi (xato paytida oshiring). */
  shake?: number;
  disabled?: boolean;
  /** Pastki chap tugma (masalan, Face ID yoki «Chiqish»). */
  left?: ReactNode;
  spread?: boolean;
}) {
  const { c, dark } = useTheme();
  const [x] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!shake) return;
    haptic.error();
    Animated.sequence([10, -10, 8, -8, 4, 0].map((toValue) => Animated.timing(x, { toValue, duration: 45, useNativeDriver: true }))).start();
  }, [shake, x]);

  const press = (digit: string) => {
    if (disabled || value.length >= length) return;
    haptic.select();
    onChange(value + digit);
  };
  const back = () => {
    if (!value) return;
    haptic.select();
    onChange(value.slice(0, -1));
  };
  const empty = dark ? "#3A3A3C" : "#E5E5EA";
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  return (
    <View style={[st.wrap, spread && st.spread]}>
      <View style={{ alignItems: "center", gap: 22 }}>
        <View style={{ alignItems: "center", gap: 6 }}>
          <Text style={[st.title, { color: c.ink }]}>{title}</Text>
          <Text style={[st.sub, { color: error ? c.danger : c.muted }]}>{error || subtitle || " "}</Text>
        </View>
        <Animated.View style={[st.dots, { transform: [{ translateX: x }] }]} accessibilityLabel={`${value.length} / ${length}`}>
          {Array.from({ length }, (_, i) => (
            <View key={i} style={[st.dot, { backgroundColor: i < value.length ? (error ? c.danger : c.ink) : error ? `${c.danger}40` : empty }]} />
          ))}
        </Animated.View>
      </View>
      <View style={st.grid}>
        {keys.map((k) => (
          <Key key={k} label={k} onPress={() => press(k)} disabled={disabled} />
        ))}
        <View style={st.cell}>{left}</View>
        <Key label="0" onPress={() => press("0")} disabled={disabled} />
        <View style={st.cell}>
          {value ? (
            <Pressable onPress={back} hitSlop={10} style={({ pressed }) => [st.icon, pressed && { opacity: 0.5 }]} accessibilityLabel="O‘chirish">
              <Icon name="backspace-outline" size={26} color={c.ink} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Key({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={st.cell}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [st.key, pressed && { backgroundColor: c.tint, transform: [{ scale: 0.94 }] }, disabled && { opacity: 0.35 }]}
        accessibilityRole="keyboardkey"
        accessibilityLabel={label}
      >
        <Text style={[st.digit, { color: c.ink }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignItems: "center", gap: 40 },
  spread: { flex: 1, justifyContent: "space-between" },
  title: { fontSize: 26, fontWeight: "700", letterSpacing: -0.4 },
  sub: { fontSize: 14, textAlign: "center", paddingHorizontal: 24 },
  dots: { flexDirection: "row", gap: 18 },
  dot: { width: 13, height: 13, borderRadius: 7 },
  grid: { width: 300, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 },
  cell: { width: 88, height: 76, alignItems: "center", justifyContent: "center" },
  key: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
  digit: { fontSize: 32, fontWeight: "600", fontVariant: ["tabular-nums"] },
  icon: { width: 60, height: 60, alignItems: "center", justifyContent: "center" },
});
