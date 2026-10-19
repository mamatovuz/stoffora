import { Tabs } from "expo-router";
import { FloatingTabBar } from "@/components/FloatingTabBar";
import { Icon, type IconName } from "@/components/ui";
import { ios, useTheme } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { useData } from "@/lib/useData";
import type { HomeData } from "@/lib/types";

/** Pastki menyu — Mini App bilan bir xil bo‘limlar: Bosh sahifa, Tarix, So‘rovlar, Profil, Rahbar. */
export default function TabsLayout() {
  const { c } = useTheme();
  const tr = useT();
  const { data } = useData<HomeData>("/mini/home", { refetchOnFocus: false });
  const { data: mgr } = useData<{ allowed: boolean }>("/mobile/manager/check", { refetchOnFocus: false, maxAgeMs: 10 * 60_000 });
  const icon = (name: IconName, active: IconName) =>
    function TabIcon({ focused, color, size }: { focused: boolean; color: unknown; size?: number }) {
      return <Icon name={focused ? active : name} size={size || 22} color={String(color)} />;
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
      <Tabs.Screen name="index" options={{ title: tr("Bosh sahifa"), tabBarIcon: icon("home-outline", "home"), tabBarBadge: data?.unreadNotifications || undefined }} />
      <Tabs.Screen name="history" options={{ title: tr("Tarix"), tabBarIcon: icon("time-outline", "time") }} />
      <Tabs.Screen name="requests" options={{ title: tr("So‘rovlar"), tabBarIcon: icon("file-tray-outline", "file-tray") }} />
      <Tabs.Screen name="profile" options={{ title: tr("Profil"), tabBarIcon: icon("person-outline", "person") }} />
      <Tabs.Screen name="manager" options={{ title: tr("Rahbar"), tabBarIcon: icon("briefcase-outline", "briefcase"), href: mgr?.allowed ? undefined : null }} />
    </Tabs>
  );
}
