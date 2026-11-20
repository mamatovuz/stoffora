import { Tabs } from "expo-router";
import { FloatingTabBar } from "@/components/FloatingTabBar";
import { Icon, type IconName } from "@/components/ui";
import { ios, useTheme } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
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
  sections: icon("grid-outline", "grid"),
  profile: icon("person-outline", "person"),
  manager: icon("briefcase-outline", "briefcase"),
};
const renderTabBar = (props: unknown) => <FloatingTabBar {...(props as Parameters<typeof FloatingTabBar>[0])} />;

/**
 * Pastki menyu.
 *   Xodim:    Bosh sahifa · Tarix · Bo‘limlar · Profil · (Rahbar — HR, moliya, filial rahbari)
 *   Direktor: Rahbar · Profil (keldi-ketdi yo‘q, /mini/* chaqirilmaydi)
 * «So‘rovlar» endi alohida ekran (Bo‘limlar → So‘rovlar), pastki menyuda emas.
 */
export default function TabsLayout() {
  const { c } = useTheme();
  const tr = useT();
  const { mode } = useSession();
  const manager = mode === "manager";
  const { data } = useData<HomeData>(manager ? null : "/mini/home", { refetchOnFocus: false });
  const { data: mgr } = useData<{ allowed: boolean }>(manager ? null : "/mobile/manager/check", { refetchOnFocus: false, maxAgeMs: 10 * 60_000 });
  const staffOnly = manager ? null : undefined;
  const managerTab = <Tabs.Screen key="manager" name="manager" options={{ title: tr("Rahbar"), tabBarIcon: ICONS.manager, href: manager || mgr?.allowed ? undefined : null }} />;
  const profileTab = <Tabs.Screen key="profile" name="profile" options={{ title: tr("Profil"), tabBarIcon: ICONS.profile }} />;
  return (
    <Tabs
      tabBar={renderTabBar}
      initialRouteName={manager ? "manager" : "index"}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: ios ? "#8E8E93" : c.muted,
        tabBarLabelStyle: { fontSize: ios ? 10.5 : 12, fontWeight: ios ? "500" : "600" },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: tr("Bosh sahifa"), tabBarIcon: ICONS.index, tabBarBadge: data?.unreadNotifications || undefined, href: staffOnly }} />
      <Tabs.Screen name="history" options={{ title: tr("Tarix"), tabBarIcon: ICONS.history, href: staffOnly }} />
      <Tabs.Screen name="sections" options={{ title: tr("Bo‘limlar"), tabBarIcon: ICONS.sections, href: staffOnly }} />
      {/* Direktorda «Rahbar» birinchi, xodimda — oxirida. */}
      {manager ? [managerTab, profileTab] : [profileTab, managerTab]}
    </Tabs>
  );
}
