import { Redirect } from "expo-router";
import { useSession } from "@/lib/session";

export default function Index() {
  const { state, prefs, mode } = useSession();
  if (state === "signedOut") return <Redirect href="/login" />;
  if (state === "pending") return <Redirect href="/pending" />;
  if (state === "signedIn") return <Redirect href={mode === "manager" ? "/(tabs)/manager" : prefs.onboarded ? "/(tabs)" : "/permissions"} />;
  return null;
}
