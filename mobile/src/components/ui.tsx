import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { type ComponentProps, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { elevation, ios, radius, useTheme } from "@/lib/theme";
import { TAB_BAR_SPACE } from "./FloatingTabBar";

export type IconName = ComponentProps<typeof Ionicons>["name"];
export const Icon = ({ name, size = 20, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) => {
  const { c } = useTheme();
  return <Ionicons name={name} size={size} color={color || c.ink} style={style} />;
};

export const haptic = {
  tap: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
  medium: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined),
  select: () => void Haptics.selectionAsync().catch(() => undefined),
  success: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  warning: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
  error: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined),
};

/** Sahifa: iOS’da katta sarlavha, Android’da ixcham; pastga tortib yangilash. */
export function Screen({
  title,
  subtitle,
  right,
  children,
  refreshing,
  onRefresh,
  scroll = true,
  padded = true,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  padded?: boolean;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const head = title ? (
    <View style={[s.head, { paddingTop: insets.top + (ios ? 6 : 12) }]}>
      <View style={{ flex: 1 }}>
        <Text style={[s.title, { color: c.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={[s.subtitle, { color: c.muted }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  ) : (
    <View style={{ height: insets.top + 8 }} />
  );
  if (!scroll)
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        {head}
        <View style={[{ flex: 1 }, padded && s.pad]}>{children}</View>
      </View>
    );
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={[padded && s.pad, { paddingBottom: insets.bottom + TAB_BAR_SPACE + 12, gap: 12 }]}
      contentInsetAdjustmentBehavior="never"
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={c.muted} colors={[c.accent]} /> : undefined}
    >
      {head}
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const { c } = useTheme();
  const base = [s.card, elevation, { backgroundColor: c.card }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => [base, pressed && { opacity: ios ? 0.7 : 0.92, transform: [{ scale: 0.99 }] }]}
      android_ripple={{ color: c.tint }}
    >
      {children}
    </Pressable>
  );
}

/** Guruh sarlavhasi (iOS: kichik kulrang harflar). */
export function GroupTitle({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <Text style={[s.groupTitle, { color: c.muted }]}>{ios ? String(children).toUpperCase() : children}</Text>;
}

/** iOS «Settings» qatori: belgi, matn, o‘ngda qiymat va «›». */
export function Row({
  icon,
  iconColor,
  label,
  value,
  onPress,
  last,
  danger,
  right,
  sub,
}: {
  icon?: IconName;
  iconColor?: string;
  label: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
  danger?: boolean;
  right?: ReactNode;
  sub?: string;
}) {
  const { c } = useTheme();
  const tint = danger ? c.danger : iconColor || c.accent;
  return (
    <Pressable
      disabled={!onPress}
      onPress={() => {
        haptic.select();
        onPress?.();
      }}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: c.tint }]}
      android_ripple={{ color: c.tint }}
    >
      {icon ? (
        <View style={[s.rowIcon, ios ? { backgroundColor: tint } : { backgroundColor: "transparent" }]}>
          <Icon name={icon} size={ios ? 17 : 22} color={ios ? "#fff" : tint} />
        </View>
      ) : null}
      <View style={[s.rowBody, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.rowLabel, { color: danger ? c.danger : c.ink }]} numberOfLines={1}>
            {label}
          </Text>
          {sub ? (
            <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 1 }} numberOfLines={2}>
              {sub}
            </Text>
          ) : null}
        </View>
        {value ? (
          <Text style={[s.rowValue, { color: c.muted }]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {right}
        {onPress && !right ? <Icon name="chevron-forward" size={17} color={ios ? "#C4C4C7" : c.muted} /> : null}
      </View>
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  icon,
  tone = "primary",
  busy,
  disabled,
  style,
  big,
}: {
  title: string;
  onPress: () => void;
  icon?: IconName;
  tone?: "primary" | "danger" | "ghost" | "soft" | "success";
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  big?: boolean;
}) {
  const { c } = useTheme();
  const bg = tone === "primary" ? c.accent : tone === "success" ? c.success : tone === "danger" ? `${c.danger}1C` : tone === "soft" ? `${c.accent}1A` : "transparent";
  const fg = tone === "primary" || tone === "success" ? c.accentInk : tone === "danger" ? c.danger : c.accent;
  return (
    <Pressable
      disabled={disabled || busy}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: bg, height: big ? 56 : 50, borderRadius: radius.button },
        tone === "ghost" && { borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, backgroundColor: c.card },
        big && (tone === "primary" || tone === "success") && !disabled && { shadowColor: bg, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
        (disabled || busy) && { opacity: 0.55 },
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.85 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={19} color={fg} /> : null}
      <Text style={[s.buttonText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Hint({ icon = "information-circle", tone = "info", children, onPress }: { icon?: IconName; tone?: "info" | "warn" | "ok" | "rest" | "bad"; children: ReactNode; onPress?: () => void }) {
  const { c } = useTheme();
  const color = tone === "warn" ? c.warn : tone === "ok" ? c.success : tone === "rest" ? c.violet : tone === "bad" ? c.danger : c.accent;
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={[s.hint, { backgroundColor: `${color}16` }]}>
      <Icon name={icon} size={18} color={color} />
      <Text style={{ flex: 1, color: c.ink, fontSize: 13.5, lineHeight: 19 }}>{children}</Text>
      {onPress ? <Icon name="chevron-forward" size={16} color={c.muted} /> : null}
    </Pressable>
  );
}

export function Badge({ text, tone = "info" }: { text: string; tone?: "info" | "ok" | "warn" | "bad" | "muted" | "rest" }) {
  const { c } = useTheme();
  const color = tone === "ok" ? c.success : tone === "warn" ? c.warn : tone === "bad" ? c.danger : tone === "muted" ? c.muted : tone === "rest" ? c.violet : c.accent;
  return (
    <View style={[s.badge, { backgroundColor: `${color}1C` }]}>
      <Text style={{ color, fontSize: 12, fontWeight: "600" }}>{text}</Text>
    </View>
  );
}

export function Empty({ icon = "file-tray-outline", title, text, action }: { icon?: IconName; title: string; text?: string; action?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={s.empty}>
      <View style={[s.emptyIcon, { backgroundColor: `${c.accent}14` }]}>
        <Icon name={icon} size={28} color={c.accent} />
      </View>
      <Text style={{ color: c.ink, fontSize: 16, fontWeight: "600", textAlign: "center" }}>{title}</Text>
      {text ? <Text style={{ color: c.muted, fontSize: 13.5, textAlign: "center", lineHeight: 19 }}>{text}</Text> : null}
      {action}
    </View>
  );
}

export function Loading() {
  const { c } = useTheme();
  return (
    <View style={{ paddingVertical: 48, alignItems: "center" }}>
      <ActivityIndicator color={c.muted} />
    </View>
  );
}

export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const { c } = useTheme();
  return (
    <View style={[s.hint, { backgroundColor: `${c.danger}14`, alignItems: "center" }]}>
      <Icon name="alert-circle" size={18} color={c.danger} />
      <Text style={{ flex: 1, color: c.ink, fontSize: 13.5 }}>{text}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={10}>
          <Text style={{ color: c.accent, fontWeight: "600" }}>Qayta</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Pastdan chiquvchi oyna (iOS «sheet» / Android «bottom sheet»). */
export function Sheet({ visible, title, subtitle, onClose, children }: { visible: boolean; title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]} onPress={onClose} accessibilityLabel="Yopish" />
      <View style={[s.sheet, { backgroundColor: ios ? c.bg : c.card, paddingBottom: insets.bottom + 16 }]}>
        <View style={[s.grabber, { backgroundColor: c.line }]} />
        <View style={s.sheetHead}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.ink, fontSize: 18, fontWeight: "700" }}>{title}</Text>
            {subtitle ? <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>{subtitle}</Text> : null}
          </View>
          <Pressable onPress={onClose} hitSlop={12} style={[s.sheetClose, { backgroundColor: c.tint }]} accessibilityLabel="Yopish">
            <Icon name="close" size={18} color={c.muted} />
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Segmentlangan tanlov (iOS UISegmentedControl ko‘rinishi). */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string, number?][]; onChange: (value: T) => void }) {
  const { c } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.seg, { backgroundColor: ios ? "rgba(118,118,128,0.12)" : "transparent" }]}>
      {options.map(([key, label, count]) => {
        const on = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => {
              haptic.select();
              onChange(key);
            }}
            style={[
              s.segItem,
              ios
                ? on && { backgroundColor: c.card, ...elevation, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }
                : { borderRadius: 99, borderWidth: 1, borderColor: on ? c.accent : c.line, backgroundColor: on ? `${c.accent}18` : c.card },
            ]}
          >
            <Text style={{ color: on ? (ios ? c.ink : c.accent) : c.muted, fontWeight: on ? "600" : "500", fontSize: 13.5 }}>
              {label}
              {count ? ` · ${count}` : ""}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export const s = StyleSheet.create({
  pad: { paddingHorizontal: 16 },
  head: { flexDirection: "row", alignItems: "flex-end", gap: 12, paddingBottom: 6 },
  title: { fontSize: ios ? 34 : 26, fontWeight: ios ? "700" : "600", letterSpacing: ios ? 0.2 : 0 },
  subtitle: { fontSize: 14, marginTop: 2 },
  card: { borderRadius: radius.card, padding: 16, overflow: "hidden" },
  groupTitle: { fontSize: ios ? 12.5 : 13.5, fontWeight: ios ? "400" : "600", marginTop: 14, marginBottom: -2, marginLeft: ios ? 16 : 4, letterSpacing: ios ? 0.2 : 0 },
  row: { flexDirection: "row", alignItems: "center", paddingLeft: 16, minHeight: ios ? 46 : 54 },
  rowIcon: { width: 29, height: 29, borderRadius: 7, alignItems: "center", justifyContent: "center", marginRight: 12 },
  rowBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "stretch", paddingRight: 14, paddingVertical: 10 },
  rowLabel: { fontSize: 16 },
  rowValue: { fontSize: 15, maxWidth: "50%" },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 18 },
  buttonText: { fontSize: 16.5, fontWeight: "600" },
  hint: { flexDirection: "row", gap: 10, padding: 13, borderRadius: radius.card, alignItems: "flex-start" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, alignSelf: "flex-start" },
  empty: { alignItems: "center", gap: 10, paddingVertical: 40, paddingHorizontal: 24 },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: ios ? 14 : 24, borderTopRightRadius: ios ? 14 : 24, paddingHorizontal: 16, paddingTop: 8 },
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, marginBottom: 10 },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  sheetClose: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  seg: { flexDirection: "row", gap: ios ? 0 : 8, padding: ios ? 2 : 0, borderRadius: 9 },
  segItem: { paddingHorizontal: 14, paddingVertical: ios ? 7 : 8, borderRadius: 7 },
});

/** Kartada guruhlangan qatorlar (iOS inset grouped). */
export function Group({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <View style={[{ backgroundColor: c.card, borderRadius: radius.card, overflow: "hidden" }, elevation]}>{children}</View>;
}
