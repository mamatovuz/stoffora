import { Platform, useColorScheme, type TextStyle } from "react-native";

/*
 * Staffora mobil dizayn tokenlari — minimal, tinch va bir xil: iOS va Android’da bitta palitra
 * (sayt bilan bir xil brend ko‘ki), soyasiz tekis kartalar, yumshoq kulrang fon, bitta urg‘u rangi.
 * Holat ranglari (yashil · sariq · qizil · binafsha) faqat kichik nuqta, ikonka yoki raqamda.
 */

export const ios = Platform.OS === "ios";

const light = {
  bg: "#F4F5F7",
  card: "#FFFFFF",
  ink: "#0F172A",
  muted: "#6B7280",
  line: "rgba(15,23,42,0.08)",
  tint: "rgba(15,23,42,0.045)",
  accent: "#2563EB",
  accentInk: "#FFFFFF",
  success: "#16A34A",
  warn: "#D97706",
  danger: "#DC2626",
  violet: "#7C3AED",
  overlay: "rgba(15,23,42,0.36)",
};
const dark: typeof light = {
  bg: "#0B0C0E",
  card: "#16181B",
  ink: "#F3F4F6",
  muted: "#9CA3AF",
  line: "rgba(255,255,255,0.08)",
  tint: "rgba(255,255,255,0.06)",
  accent: "#3B82F6",
  accentInk: "#FFFFFF",
  success: "#22C55E",
  warn: "#F59E0B",
  danger: "#EF4444",
  violet: "#A78BFA",
  overlay: "rgba(0,0,0,0.6)",
};
export type Colors = typeof light;

export function useTheme() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? dark : light;
  return { c, dark: scheme === "dark" };
}

/** Bir xil burchaklar: karta → tugma → katak. */
export const radius = { card: 18, button: 14, tile: 16 };

/**
 * Yagona shrift shkalasi — rahbar paneli va ro‘yxatlar shu o‘lchamlardan foydalanadi
 * (11.5 / 12.5 / 13.5 / 14.5 kabi aralash o‘lchamlar o‘rniga 5 ta daraja).
 */
export const typo: Record<"title" | "body" | "bodyStrong" | "sub" | "caption" | "stat" | "time", TextStyle> = {
  /** Karta sarlavhasi */
  title: { fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  /** Asosiy matn, qator nomi */
  body: { fontSize: 15 },
  bodyStrong: { fontSize: 15, fontWeight: "600" },
  /** Ikkinchi darajali matn (kulrang) */
  sub: { fontSize: 13 },
  /** Raqam ostidagi yozuv, kichik belgi */
  caption: { fontSize: 12, fontWeight: "500" },
  /** Katta raqam (statistika) */
  stat: { fontSize: 24, fontWeight: "700", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  /** Vaqt (09:12) */
  time: { fontSize: 20, fontWeight: "700", letterSpacing: -0.3, fontVariant: ["tabular-nums"] },
};
export const font = {
  family: ios ? undefined : "sans-serif",
  title: 30,
};
/** Kartalar soyasiz (minimal): oq karta kulrang fonda o‘zi ajralib turadi. Eski chaqiruvlar uchun qoldirilgan. */
export const elevation = {};
