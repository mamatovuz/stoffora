/** Push’dagi `go` qiymati → ilova ekrani (Mini App deep link’lari bilan bir xil nomlar). */
export function routeForGo(go?: string) {
  switch (go) {
    case "leave":
    case "requests":
      return "/(tabs)/requests" as const;
    case "salary":
      return "/salary" as const;
    case "history":
    case "schedule":
      return "/(tabs)/history" as const;
    case "docs":
    case "profile":
      return "/(tabs)/profile" as const;
    case "manager":
      return "/(tabs)/manager" as const;
    default:
      return "/notifications" as const;
  }
}
