import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";
import { Icon, haptic } from "./ui";

/*
 * iOS uslubidagi PIN klaviaturasi: yuqorida nuqtalar, ostida 3×4 yumaloq tugmalar.
 * Xato bo‘lsa nuqtalar chayqaladi (shake).
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
  /** Pastki chap tugma (masalan, Face ID). */
  left?: ReactNode;
}) {
  const { c } = useTheme();
  const x = useRef(new Animated.Value(0)).current;
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
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  return (
    <View style={st.wrap}>
      <View style={{ alignItems: "center", gap: 6 }}>
        <Text style={[st.title, { color: c.ink }]}>{title}</Text>
        <Text style={[st.sub, { color: error ? c.danger : c.muted }]}>{error || subtitle || " "}</Text>
      </View>
      <Animated.View style={[st.dots, { transform: [{ translateX: x }] }]}>
        {Array.from({ length }, (_, i) => (
          <View key={i} style={[st.dot, { borderColor: error ? c.danger : c.ink }, i < value.length && { backgroundColor: error ? c.danger : c.ink }]} />
        ))}
      </Animated.View>
      <View style={st.grid}>
        {keys.map((k) => (
          <Key key={k} label={k} onPress={() => press(k)} disabled={disabled} />
        ))}
        <View style={st.cell}>{left}</View>
        <Key label="0" onPress={() => press("0")} disabled={disabled} />
        <View style={st.cell}>
          {value ? (
            <Pressable onPress={back} hitSlop={10} style={st.icon} accessibilityLabel="O‘chirish">
              <Icon name="backspace-outline" size={26} color={c.ink} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Key({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { c, dark } = useTheme();
  return (
    <View style={st.cell}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [st.key, { backgroundColor: pressed ? (dark ? "#3A3A3C" : "#D1D1D6") : dark ? "#1C1C1E" : "#E5E5EA" }, disabled && { opacity: 0.4 }]}
        accessibilityLabel={label}
      >
        <Text style={{ color: c.ink, fontSize: 30, fontWeight: "400" }}>{label}</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignItems: "center", gap: 28 },
  title: { fontSize: 21, fontWeight: "600" },
  sub: { fontSize: 14, textAlign: "center", paddingHorizontal: 24 },
  dots: { flexDirection: "row", gap: 22 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5 },
  grid: { width: 290, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 16 },
  cell: { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  key: { width: 78, height: 78, borderRadius: 39, alignItems: "center", justifyContent: "center" },
  icon: { width: 60, height: 60, alignItems: "center", justifyContent: "center" },
});
