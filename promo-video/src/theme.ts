import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";

// Geist is the typeface the Staffora product itself ships with.
export const SANS = loadGeist("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin", "latin-ext"],
}).fontFamily;

export const MONO = loadGeistMono("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
}).fontFamily;

// Colour tokens mirror the product's light theme (src/styles.css in the app).
export const C = {
  bg: "#F5F7FA",
  stage: "#EAEEF4",
  surface: "#FFFFFF",
  surface2: "#F8FAFC",
  line: "#E2E8F0",
  lineSoft: "#EEF2F6",
  lineStrong: "#CBD5E1",
  ink: "#0F172A",
  ink2: "#334155",
  muted: "#64748B",
  faint: "#94A3B8",

  brand: "#2563EB",
  brandSoft: "#EFF4FF",
  brandLine: "#CFE0FB",
  brandTint: "#BFD3FB",

  ok: "#22A05A",
  okText: "#15803D",
  okBg: "#ECFDF3",
  late: "#E5962B",
  lateText: "#B45309",
  lateBg: "#FFF7E6",
  bad: "#E5484D",
  badText: "#DC2626",
  badBg: "#FEF2F2",
  leave: "#8B5CF6",
  leaveText: "#6D28D9",
  leaveBg: "#F3EEFF",
  wait: "#CBD5E1",
  waitText: "#64748B",
  waitBg: "#F1F5F9",

  // opening / reveal (deep ink world)
  dark: "#090D14",
  darkSurface: "#111722",
  darkRaised: "#161D2A",
  darkLine: "#1E2734",
  darkText: "#E8ECF2",
  darkMuted: "#7D8899",
  darkFaint: "#4A5566",
} as const;

export const W = 1080;
export const H = 1920;
export const MARGIN = 72;
export const CONTENT = W - MARGIN * 2; // 936
