import { Redirect } from "expo-router";
import { useSession } from "@/lib/session";

export default function Index() {
  const { state, prefs } = useSession();
  if (state === "signedOut") return <Redirect href="/activate" />;
  if (state === "pending") return <Redirect href="/pending" />;
  if (state === "signedIn") return <Redirect href={prefs.onboarded ? "/(tabs)" : "/permissions"} />;
  return null;
}
