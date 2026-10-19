import { BlurView } from "expo-blur";
import { useEffect, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Text } from "@/components/T";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ios, useTheme } from "@/lib/theme";
import { haptic } from "./ui";

/*
 * Suzuvchi pastki menyu (Nav Menu): tanlangan bo‘lim to‘q «tabletka»ga aylanib, yozuvi bilan
 * kengayadi, qolganlari — faqat ikonka. Kenglik va rang prujina bilan o‘zgaradi;
 * menyu kontent kengligida, ekran o‘rtasida turadi.
 */

type Route = { key: string; name: string };
type Options = {
  title?: string;
  href?: string | null;
  tabBarBadge?: string | number;
  tabBarItemStyle?: { display?: string } | unknown;
  tabBarIcon?: (p: { focused: boolean; color: string; size: number }) => ReactNode;
  tabBarButton?: unknown;
};
type Props = {
  state: { index: number; routes: Route[] };
  descriptors: Record<string, { options: Options }>;
  navigation: { emit: (e: { type: "tabPress" | "tabLongPress"; target: string; canPreventDefault?: boolean }) => { defaultPrevented?: boolean }; navigate: (name: string) => void };
};

/** Menyu balandligi + pastki bo‘shliq — sahifa kontenti shuncha pastdan joy qoldiradi. */
export const TAB_BAR_SPACE = 96;

const ICON = 22;
const PAD = 6;
/** Ikonka bilan yozuv orasidagi masofa va yozuvdan keyingi o‘ng chekka. */
const LABEL_GAP = 8;
const END_PAD = 16;
const SIDE = 12;

/** "#0F172A" → "rgba(15,23,42,a)" — shaffofdan to‘q rangga silliq o‘tish uchun. */
function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function FloatingTabBar({ state, descriptors, navigation }: Props) {
  const { c, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const visible = state.routes.filter((r) => {
    const o = descriptors[r.key]?.options || {};
    const style = o.tabBarItemStyle as { display?: string } | undefined;
    return o.href !== null && style?.display !== "none";
  });
  const activeKey = state.routes[state.index]?.key;
  const activeIndex = Math.max(0, visible.findIndex((r) => r.key === activeKey));
  const [labels, setLabels] = useState<Record<string, number>>({});

  const n = visible.length;
  const narrow = screen < 400;
  const h = n > 4 ? (narrow ? 44 : 46) : narrow ? 46 : 50;
  const gap = narrow ? 2 : 4;
  // Yozuv ekranga sig‘masa qisqaradi (5 ta bo‘lim + tor ekran).
  const maxLabel = Math.max(48, screen - SIDE * 2 - PAD * 2 - 2 - n * h - (n - 1) * gap - (LABEL_GAP - (h - ICON) / 2) - END_PAD);

  const bottom = Math.max(insets.bottom - 6, 10) + 6;
  const glass = ios ? (dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight") : undefined;
  const radius = h / 2 + PAD;

  return (
    <View pointerEvents="box-none" style={[st.wrap, { bottom }]}>
      {/* Yozuvlar kengligini o‘lchash uchun ko‘rinmas nusxa (tarjima o‘zgarsa ham qayta o‘lchanadi). */}
      <View style={st.measure} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {visible.map((route) => (
          <Text
            key={route.key}
            style={st.label}
            numberOfLines={1}
            onLayout={(e) => {
              const w = Math.ceil(e.nativeEvent.layout.width) + 1;
              setLabels((prev) => (prev[route.key] === w ? prev : { ...prev, [route.key]: w }));
            }}
          >
            {descriptors[route.key].options.title}
          </Text>
        ))}
      </View>
      <View
        style={[
          st.bar,
          { padding: PAD, gap, borderRadius: radius, borderColor: dark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.06)", shadowColor: "#000" },
        ]}
      >
        {/* Shisha qatlam alohida kesiladi — tashqi soya ko‘rinib turadi. */}
        <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }]}>
          {ios ? (
            <BlurView tint={glass} intensity={90} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: dark ? "rgba(28,28,30,0.97)" : "rgba(255,255,255,0.98)" }]} />
          )}
        </View>
        {visible.map((route, i) => {
          const options = descriptors[route.key].options;
          const focused = i === activeIndex;
          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              haptic.select();
              navigation.navigate(route.name);
            }
          };
          return (
            <NavKey
              key={route.key}
              focused={focused}
              title={options.title || ""}
              labelWidth={Math.min(labels[route.key] || 0, maxLabel)}
              size={h}
              ink={c.ink}
              onInk={c.card}
              tint={c.tint}
              badge={options.tabBarBadge}
              badgeColor={c.danger}
              badgeBorder={dark ? "#1C1C1E" : "#fff"}
              icon={options.tabBarIcon}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
            />
          );
        })}
      </View>
    </View>
  );
}

function NavKey({
  focused,
  title,
  labelWidth,
  size,
  ink,
  onInk,
  tint,
  badge,
  badgeColor,
  badgeBorder,
  icon,
  onPress,
  onLongPress,
}: {
  focused: boolean;
  title: string;
  labelWidth: number;
  size: number;
  ink: string;
  onInk: string;
  tint: string;
  badge?: string | number;
  badgeColor: string;
  badgeBorder: string;
  icon?: Options["tabBarIcon"];
  onPress: () => void;
  onLongPress: () => void;
}) {
  const [p] = useState(() => new Animated.Value(focused ? 1 : 0));
  useEffect(() => {
    Animated.spring(p, { toValue: focused ? 1 : 0, useNativeDriver: false, damping: 17, stiffness: 230, mass: 0.8 }).start();
  }, [focused, p]);

  const side = (size - ICON) / 2;
  const open = Math.max(size, size + (LABEL_GAP - side) + labelWidth + END_PAD);
  const width = p.interpolate({ inputRange: [0, 1], outputRange: [size, open] });
  const background = p.interpolate({ inputRange: [0, 1], outputRange: [rgba(ink, 0), ink], extrapolate: "clamp" });
  const shown = p.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0, 1], extrapolate: "clamp" });
  const hidden = p.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: "clamp" });
  const slide = p.interpolate({ inputRange: [0, 1], outputRange: [-8, 0], extrapolate: "clamp" });
  const iconOn = p.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" });

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={title}
      hitSlop={4}
      style={({ pressed }) => [{ borderRadius: size / 2, transform: [{ scale: pressed && !focused ? 0.94 : 1 }] }, pressed && !focused && { backgroundColor: tint }]}
    >
      <Animated.View style={[st.key, { width, height: size, borderRadius: size / 2, backgroundColor: background }]}>
        <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={{ opacity: hidden }}>{icon?.({ focused: false, color: ink, size: ICON })}</Animated.View>
          <Animated.View style={[st.iconOver, { opacity: iconOn }]}>
            {icon?.({ focused: true, color: onInk, size: ICON })}
          </Animated.View>
        </View>
        <Animated.View style={{ marginLeft: LABEL_GAP - side, opacity: shown, transform: [{ translateX: slide }] }}>
          <Text style={[st.label, { color: onInk, width: labelWidth }]} numberOfLines={1}>
            {title}
          </Text>
        </Animated.View>
      </Animated.View>
      {badge ? (
        <View pointerEvents="none" style={[st.badge, { top: side - 7, left: side + ICON - 9, backgroundColor: badgeColor, borderColor: badgeBorder }]}>
          <Text style={st.badgeText}>{String(badge)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  wrap: { position: "absolute", left: SIDE, right: SIDE, alignItems: "center" },
  bar: {
    flexDirection: "row",
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
  measure: { position: "absolute", left: 0, top: 0, opacity: 0, alignItems: "flex-start" },
  key: { flexDirection: "row", alignItems: "center", overflow: "hidden" },
  iconOver: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, fontWeight: "600", letterSpacing: -0.1 },
  badge: { position: "absolute", minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});
