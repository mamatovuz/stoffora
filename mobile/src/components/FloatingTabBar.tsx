import { BlurView } from "expo-blur";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ios, useTheme } from "@/lib/theme";
import { haptic } from "./ui";

/*
 * Suzuvchi pastki menyu (iOS 26 / Telegram / Instagram uslubi): ekran chetiga yopishmaydi,
 * pastdan biroz yuqorida turadigan shishasimon kapsula — bosh barmoq bilan bosish oson.
 * Faol bo‘lim ostida yumshoq «tabletka» siljib boradi.
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

export function FloatingTabBar({ state, descriptors, navigation }: Props) {
  const { c, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const visible = state.routes.filter((r) => {
    const o = descriptors[r.key]?.options || {};
    const style = o.tabBarItemStyle as { display?: string } | undefined;
    return o.href !== null && style?.display !== "none";
  });
  const activeKey = state.routes[state.index]?.key;
  const activeIndex = Math.max(0, visible.findIndex((r) => r.key === activeKey));
  const [width, setWidth] = useState(0);
  const pill = useRef(new Animated.Value(0)).current;
  const itemWidth = visible.length ? (width - 12) / visible.length : 0;

  useEffect(() => {
    Animated.spring(pill, { toValue: activeIndex * itemWidth, useNativeDriver: true, damping: 18, stiffness: 220, mass: 0.7 }).start();
  }, [activeIndex, itemWidth, pill]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const bottom = Math.max(insets.bottom - 6, 10) + 6;
  const glass = ios ? (dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight") : undefined;

  return (
    <View pointerEvents="box-none" style={[st.wrap, { bottom }]}>
      <View onLayout={onLayout} style={[st.bar, { borderColor: dark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.06)", shadowColor: "#000" }]}>
        {/* Shisha qatlam alohida kesiladi — tashqi soya ko‘rinib turadi. */}
        <View style={[StyleSheet.absoluteFill, st.clip]}>
          {ios ? (
            <BlurView tint={glass} intensity={90} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: dark ? "rgba(28,28,30,0.96)" : "rgba(255,255,255,0.97)" }]} />
          )}
        </View>
        {width ? (
          <Animated.View
            style={[
              st.pill,
              { width: itemWidth, backgroundColor: dark ? "rgba(255,255,255,0.12)" : `${c.accent}16`, transform: [{ translateX: pill }] },
            ]}
          />
        ) : null}
        {visible.map((route, i) => {
          const options = descriptors[route.key].options;
          const focused = i === activeIndex;
          const color = focused ? c.accent : dark ? "#A1A1A6" : "#6B7280";
          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              haptic.select();
              navigation.navigate(route.name);
            }
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
              style={st.item}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.title}
              hitSlop={4}
            >
              <View>
                {options.tabBarIcon?.({ focused, color, size: 24 })}
                {options.tabBarBadge ? (
                  <View style={[st.badge, { backgroundColor: c.danger, borderColor: dark ? "#1C1C1E" : "#fff" }]}>
                    <Text style={st.badgeText}>{String(options.tabBarBadge)}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[st.label, { color, fontWeight: focused ? "700" : "500" }]} numberOfLines={1}>
                {options.title}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { position: "absolute", left: 14, right: 14, alignItems: "stretch" },
  bar: {
    flexDirection: "row",
    height: 66,
    padding: 6,
    borderRadius: 33,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
  clip: { borderRadius: 33, overflow: "hidden" },
  pill: { position: "absolute", top: 6, left: 6, bottom: 6, borderRadius: 27 },
  item: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 27 },
  label: { fontSize: 10.5, letterSpacing: 0.1 },
  badge: { position: "absolute", top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});
