import { BlurView } from "expo-blur";
import { useEffect, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ios, useTheme } from "@/lib/theme";
import { haptic } from "./ui";

/*
 * Pastki menyu — ekran eni bo‘ylab qotirilgan oddiy panel: har bir bo‘limda ikonka va yozuv,
 * tanlangani ko‘k rangda. Avvalgi suzuvchi «tabletka» kontentni yopib qo‘yardi va bo‘lim nomlari
 * faqat tanlanganda ko‘rinardi — endi hammasi doim o‘qiladi. iOS’da shisha (blur), Android’da oq.
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

/** Panel balandligi (pastki xavfsiz hududsiz) — sahifa kontenti shuncha + insets.bottom joy qoldiradi. */
export const TAB_BAR_SPACE = 56;

const ICON = 24;

export function FloatingTabBar({ state, descriptors, navigation }: Props) {
  const { c, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const visible = state.routes.filter((r) => {
    const o = descriptors[r.key]?.options || {};
    const style = o.tabBarItemStyle as { display?: string } | undefined;
    return o.href !== null && style?.display !== "none";
  });
  const activeKey = state.routes[state.index]?.key;
  const inactive = ios ? "#8E8E93" : c.muted;

  return (
    <View style={[st.bar, { paddingBottom: Math.max(insets.bottom, 8), borderTopColor: c.line }]}>
      {ios ? (
        <BlurView tint={dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"} intensity={100} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: c.card }]} />
      )}
      {visible.map((route) => {
        const options = descriptors[route.key].options;
        const focused = route.key === activeKey;
        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            haptic.select();
            navigation.navigate(route.name);
          }
        };
        return (
          <TabKey
            key={route.key}
            focused={focused}
            title={options.title || ""}
            color={focused ? c.accent : inactive}
            badge={options.tabBarBadge}
            badgeColor={c.danger}
            badgeBorder={c.card}
            icon={options.tabBarIcon}
            onPress={onPress}
            onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
          />
        );
      })}
    </View>
  );
}

function TabKey({
  focused,
  title,
  color,
  badge,
  badgeColor,
  badgeBorder,
  icon,
  onPress,
  onLongPress,
}: {
  focused: boolean;
  title: string;
  color: string;
  badge?: string | number;
  badgeColor: string;
  badgeBorder: string;
  icon?: Options["tabBarIcon"];
  onPress: () => void;
  onLongPress: () => void;
}) {
  // Tanlanganda ikonka yengil «sakraydi» — qaysi bo‘limga o‘tilgani sezilsin.
  const [pop] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!focused) return;
    pop.setValue(0.86);
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, damping: 12, stiffness: 260, mass: 0.6 }).start();
  }, [focused, pop]);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={badge ? `${title}, ${badge}` : title}
      style={({ pressed }) => [st.key, pressed && { opacity: 0.55 }]}
    >
      <Animated.View style={{ transform: [{ scale: pop }] }}>
        {icon?.({ focused, color, size: ICON })}
        {badge ? (
          <View pointerEvents="none" style={[st.badge, { backgroundColor: badgeColor, borderColor: badgeBorder }]}>
            <Text style={st.badgeText}>{String(badge)}</Text>
          </View>
        ) : null}
      </Animated.View>
      <Text style={[st.label, { color, fontWeight: focused ? "600" : "500" }]} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  key: { flex: 1, minHeight: TAB_BAR_SPACE - 8, alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: 2 },
  label: { fontSize: 11, letterSpacing: 0 },
  badge: { position: "absolute", top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});
