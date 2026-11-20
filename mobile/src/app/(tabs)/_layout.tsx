import { Tabs } from "expo-router";
import { FloatingTabBar } from "@/components/FloatingTabBar";
import { Icon, type IconName } from "@/components/ui";
import { ios, useTheme } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { useData } from "@/lib/useData";
import type { HomeData } from "@/lib/types";

/** Ikonka chizgichlari modul darajasida — har qayta chizishda yangi funksiya/komponent yaratilmaydi. */
const icon = (name: IconName, active: IconName) =>
  function TabIcon({ focused, color, size }: { focused: boolean; color: unknown; size?: number }) {
    return <Icon name={focused ? active : name} size={size || 22} color={String(color)} />;
  };
const ICONS = {
  index: icon("home-outline", "home"),
  history: icon("time-outline", "time"),
  requests: icon("file-tray-outline", "file-tray"),
  profile: icon("person-outline", "person"),
  manager: icon("briefcase-outline", "briefcase"),
};
const renderTabBar = (props: unknown) => <FloatingTabBar {...(props as Parameters<typeof FloatingTabBar>[0])} />;

/** Pastki menyu — Mini App bilan bir xil bo‘limlar: Bosh sahifa, Tarix, So‘rovlar, Profil, Rahbar. */
export default function TabsLayout() {
  const { c } = useTheme();
  const tr = useT();
  const { data } = useData<HomeData>("/mini/home", { refetchOnFocus: false });
  const { data: mgr } = useData<{ allowed: boolean }>("/mobile/manager/check", { refetchOnFocus: false, maxAgeMs: 10 * 60_000 });
  return (
    <Tabs
      tabBar={renderTabBar}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: ios ? "#8E8E93" : c.muted,
        tabBarLabelStyle: { fontSize: ios ? 10.5 : 12, fontWeight: ios ? "500" : "600" },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: tr("Bosh sahifa"), tabBarIcon: ICONS.index, tabBarBadge: data?.unreadNotifications || undefined }} />
      <Tabs.Screen name="history" options={{ title: tr("Tarix"), tabBarIcon: ICONS.history }} />
      <Tabs.Screen name="requests" options={{ title: tr("So‘rovlar"), tabBarIcon: ICONS.requests }} />
      <Tabs.Screen name="profile" options={{ title: tr("Profil"), tabBarIcon: ICONS.profile }} />
      <Tabs.Screen name="manager" options={{ title: tr("Rahbar"), tabBarIcon: ICONS.manager, href: mgr?.allowed ? undefined : null }} />
    </Tabs>
  );
}
