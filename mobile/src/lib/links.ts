import type { Href } from "expo-router";

/**
 * Bildirishnoma / push’dagi `go` qiymati → ilova ekrani (Mini App deep link’lari bilan bir xil nomlar:
 * salary, docs, dayoff, leave_<id>, payslip_<oy>, ticket_<id>, manager_requests …).
 * Noma’lum qiymat — null (hech qayerga o‘tilmaydi; bildirishnomalar sahifasi o‘zini qayta ochmaydi).
 */
export function routeForGo(go?: string | null): Href | null {
  if (!go) return null;
  const value = go.trim().replace(/^go[_-]/, "");
  const [head] = value.split("_");
  switch (head) {
    // Kelish/ketish eslatmasi — darhol yuz tekshiruvi (go/[target] ekrani holatni tekshiradi).
    case "checkin":
      return { pathname: "/go/[target]", params: { target: "checkin" } };
    case "checkout":
      return { pathname: "/go/[target]", params: { target: "checkout" } };
    case "home":
      return "/(tabs)";
    // «Kechikaman» — Bo‘limlar sahifasida (bosh sahifada endi faqat keldi-ketdi va oylik).
    case "late":
      return { pathname: "/(tabs)/sections", params: { late: String(Date.now()) } };
    case "sections":
      return "/(tabs)/sections";
    case "notifs":
      return "/notifications";
    case "salary":
      return "/salary";
    // «Avans so‘rash» xabari — oylik ekrani avans formasi ochiq holda.
    case "advance":
    case "advances":
      return { pathname: "/salary", params: { ask: "1" } };
    case "history":
    case "calendar":
      return { pathname: "/(tabs)/history", params: { view: "calendar" } };
    case "schedule":
      return { pathname: "/(tabs)/history", params: { view: "schedule" } };
    case "stats":
      return { pathname: "/(tabs)/history", params: { view: "stats" } };
    case "leave":
    case "requests":
      return { pathname: "/requests", params: { view: "leave" } };
    case "swap":
    case "swaps":
      return { pathname: "/requests", params: { view: "swap" } };
    case "dayoff":
      return { pathname: "/requests", params: { view: "dayoff" } };
    case "overtime":
      return { pathname: "/requests", params: { view: "overtime" } };
    case "marks":
    case "correction":
      return { pathname: "/requests", params: { view: "marks" } };
    case "docs":
      return "/documents";
    case "badge":
      return "/badge";
    case "payslip":
    case "payslips":
      return "/payslips";
    case "ticket":
    case "helpdesk":
      return { pathname: "/helpdesk", params: { view: "questions" } };
    case "certificate":
    case "certificates":
      return { pathname: "/helpdesk", params: { view: "certificates" } };
    case "birthdays":
      return "/birthdays";
    case "directory":
      return "/directory";
    case "profile":
    case "settings":
      return "/(tabs)/profile";
    // «Ilovaga kirish» — login va parol oynasi ochiq holda.
    case "account":
    case "password":
      return { pathname: "/(tabs)/profile", params: { section: "account", t: String(Date.now()) } };
    case "manager": {
      // manager_requests · manager_today · manager_today_ABSENT / _LATE / _FLAGGED (davomat filtri bilan).
      const [, view, filter] = value.split("_");
      if (view === "requests") return { pathname: "/(tabs)/manager", params: { view: "requests", t: String(Date.now()) } };
      if (view === "today") return { pathname: "/(tabs)/manager", params: { view: "today", filter: filter || "ALL", t: String(Date.now()) } };
      return "/(tabs)/manager";
    }
    default:
      return null;
  }
}
