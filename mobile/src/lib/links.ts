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
    case "home":
    case "checkin":
    case "checkout":
    case "late":
      return "/(tabs)";
    case "notifs":
      return "/notifications";
    case "salary":
    case "advance":
    case "advances":
      return "/salary";
    case "history":
    case "calendar":
      return { pathname: "/(tabs)/history", params: { view: "calendar" } };
    case "schedule":
      return { pathname: "/(tabs)/history", params: { view: "schedule" } };
    case "stats":
      return { pathname: "/(tabs)/history", params: { view: "stats" } };
    case "leave":
    case "requests":
      return { pathname: "/(tabs)/requests", params: { view: "leave" } };
    case "swap":
    case "swaps":
      return { pathname: "/(tabs)/requests", params: { view: "swap" } };
    case "dayoff":
      return { pathname: "/(tabs)/requests", params: { view: "dayoff" } };
    case "overtime":
      return { pathname: "/(tabs)/requests", params: { view: "overtime" } };
    case "marks":
    case "correction":
      return { pathname: "/(tabs)/requests", params: { view: "marks" } };
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
    case "manager":
      return value === "manager_requests" ? { pathname: "/(tabs)/manager", params: { view: "requests", t: String(Date.now()) } } : "/(tabs)/manager";
    default:
      return null;
  }
}
