import { Tabs } from "expo-router";
import { FloatingTabBar } from "@/components/FloatingTabBar";
import { Icon, type IconName } from "@/components/ui";
import { ios, useTheme } from "@/lib/theme";
import { useData } from "@/lib/useData";
import type { HomeData } from "@/lib/types";

/** Pastki menyu — Mini App bilan bir xil bo‘limlar: Bosh sahifa, Tarix, So‘rovlar, Profil, Rahbar. */
export default function TabsLayout() {
  const { c } = useTheme();
  const { data } = useData<HomeData>("/mini/home", { refetchOnFocus: false });
  const { data: mgr } = useData<{ allowed: boolean }>("/mobile/manager/check", { refetchOnFocus: false, maxAgeMs: 10 * 60_000 });
  const icon = (name: IconName, active: IconName) =>
    function TabIcon({ focused, color }: { focused: boolean; color: unknown }) {
      return <Icon name={focused ? active : name} size={ios ? 25 : 23} color={String(color)} />;
    };
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...(props as unknown as Parameters<typeof FloatingTabBar>[0])} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: ios ? "#8E8E93" : c.muted,
        tabBarLabelStyle: { fontSize: ios ? 10.5 : 12, fontWeight: ios ? "500" : "600" },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Bosh sahifa", tabBarIcon: icon("home-outline", "home"), tabBarBadge: data?.unreadNotifications || undefined }} />
      <Tabs.Screen name="history" options={{ title: "Tarix", tabBarIcon: icon("calendar-outline", "calendar") }} />
      <Tabs.Screen name="requests" options={{ title: "So‘rovlar", tabBarIcon: icon("document-text-outline", "document-text") }} />
      <Tabs.Screen name="profile" options={{ title: "Profil", tabBarIcon: icon("person-circle-outline", "person-circle") }} />
      <Tabs.Screen name="manager" options={{ title: "Rahbar", tabBarIcon: icon("briefcase-outline", "briefcase"), href: mgr?.allowed ? undefined : null }} />
    </Tabs>
  );
}
