import { Platform, useColorScheme } from "react-native";

/*
 * Mini App bilan bir xil ranglar va tuzilma. iOS’da — Apple uslubi (guruhlangan ro‘yxatlar,
 * ingichka ajratgichlar, SF shrift, katta sarlavhalar); Android’da — Material uslubiga yaqin
 * (biroz kattaroq radius, soyalar, Roboto).
 */

export const ios = Platform.OS === "ios";

const light = {
  bg: ios ? "#F2F2F7" : "#F2F3F5",
  card: "#FFFFFF",
  ink: "#0F172A",
  muted: ios ? "#8A8A8E" : "#6B7280",
  line: ios ? "rgba(60,60,67,0.18)" : "rgba(15,23,42,0.1)",
  tint: "rgba(15,23,42,0.05)",
  accent: ios ? "#007AFF" : "#2563EB",
  accentInk: "#FFFFFF",
  success: ios ? "#34C759" : "#16A34A",
  warn: ios ? "#FF9500" : "#D97706",
  danger: ios ? "#FF3B30" : "#DC2626",
  violet: "#8B5CF6",
  overlay: "rgba(0,0,0,0.4)",
};
const dark: typeof light = {
  bg: "#000000",
  card: ios ? "#1C1C1E" : "#181B20",
  ink: "#F2F2F7",
  muted: ios ? "#8E8E93" : "#94A3B8",
  line: ios ? "rgba(84,84,88,0.6)" : "rgba(148,163,184,0.18)",
  tint: "rgba(148,163,184,0.12)",
  accent: ios ? "#0A84FF" : "#3B82F6",
  accentInk: "#FFFFFF",
  success: ios ? "#30D158" : "#22C55E",
  warn: ios ? "#FF9F0A" : "#F59E0B",
  danger: ios ? "#FF453A" : "#EF4444",
  violet: "#A78BFA",
  overlay: "rgba(0,0,0,0.6)",
};
export type Colors = typeof light;

export function useTheme() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? dark : light;
  return { c, dark: scheme === "dark" };
}

export const radius = { card: ios ? 16 : 20, button: ios ? 14 : 16, tile: ios ? 14 : 16 };
export const font = {
  family: ios ? undefined : "sans-serif",
  title: ios ? 34 : 26,
};
/** Android kartalariga yengil soya (iOS’da guruhlangan ro‘yxat soyasiz). */
export const elevation = ios ? {} : { elevation: 1, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } };
