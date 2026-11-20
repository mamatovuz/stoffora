import { Redirect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Catalog, type CatalogGroup } from "@/components/Catalog";
import { TAB_BAR_SPACE } from "@/components/FloatingTabBar";
import { LateSheet } from "@/components/LateSheet";
import { haptic } from "@/components/ui";
import { duration } from "@/lib/format";
import { go } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { HomeData } from "@/lib/types";
import { invalidate, useData } from "@/lib/useData";

/*
 * Bo‘limlar — barcha ekranlar bitta «katalog»da (Mini App bilan bir xil guruhlar). Bosh sahifada faqat
 * keldi-ketdi va oylik qoladi. Kompaniya o‘chirgan bo‘limlar (modul, sozlama) ko‘rinmaydi.
 */

type Features = HomeData["features"];

function groupsFor(features: Features, unread: number): CatalogGroup[] {
  const off = features?.modules || [];
  const on = (module: string) => !off.includes(module);
  const when = <T,>(ok: boolean, item: T) => (ok ? [item] : []);
  return [
    {
      title: "Davomat",
      items: [
        { key: "my-month", label: "Mening oyim", icon: "pie-chart" },
        { key: "schedule", label: "Ish grafigi", icon: "calendar" },
        { key: "stats", label: "Statistika", icon: "stats-chart" },
        ...when(on("attendanceRequests"), { key: "mark", label: "Belgilash so‘rovi", icon: "finger-print" as const }),
        { key: "late", label: "Kechikaman", icon: "hourglass" },
      ],
    },
    {
      title: "So‘rovlar",
      items: [
        { key: "new-request", label: "So‘rov yaratish", icon: "add-circle" },
        ...when(on("leave"), { key: "leave", label: "Ta’til", icon: "airplane" as const }),
        // Kompaniyada qo‘shimcha ish to‘lanmasa — bu bo‘lim yo‘q.
        ...when(features?.overtime !== false, { key: "overtime", label: "Qo‘shimcha ish", icon: "timer" as const }),
        ...when(features?.advances !== false && on("advances"), { key: "advance", label: "Avans", icon: "cash" as const }),
      ],
    },
    {
      title: "Moliya",
      items: [
        { key: "salary", label: "Oylik", icon: "wallet" },
        ...when(on("payroll"), { key: "payslips", label: "Hisob varaqalar", icon: "receipt" as const }),
      ],
    },
    {
      title: "Boshqa",
      items: [
        { key: "notifications", label: "Xabarlar", icon: "notifications", badge: unread || undefined },
        ...when(features?.directory !== false, { key: "directory", label: "Hamkasblar", icon: "people" as const }),
        { key: "badge", label: "Mening ID", icon: "id-card" },
        { key: "birthdays", label: "Tug‘ilgan kunlar", icon: "gift" },
        ...when(on("helpdesk"), { key: "helpdesk", label: "HR’ga savol", icon: "chatbubble-ellipses" as const }),
        { key: "documents", label: "Hujjatlar", icon: "folder" },
        { key: "reminders", label: "Eslatmalar", icon: "alarm" },
      ],
    },
  ];
}

/** Oddiy o‘tishlar (kalit → ekran). «late» — shu sahifadagi oyna. */
const ROUTES: Record<string, Parameters<typeof go>[0] | (() => Parameters<typeof go>[0])> = {
  "my-month": "/my-month",
  schedule: { pathname: "/(tabs)/history", params: { view: "schedule" } },
  stats: { pathname: "/(tabs)/history", params: { view: "stats" } },
  mark: "/mark-request",
  "new-request": () => ({ pathname: "/requests", params: { create: String(Date.now()) } }),
  leave: { pathname: "/requests", params: { view: "leave" } },
  overtime: { pathname: "/requests", params: { view: "overtime" } },
  advance: { pathname: "/salary", params: { ask: "1" } },
  salary: "/salary",
  payslips: "/payslips",
  notifications: "/notifications",
  directory: "/directory",
  badge: "/badge",
  birthdays: "/birthdays",
  helpdesk: { pathname: "/helpdesk", params: { view: "questions" } },
  documents: "/documents",
  reminders: "/reminders",
};

export default function Sections() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { mode } = useSession();
  const params = useLocalSearchParams<{ late?: string }>();
  const manager = mode === "manager";
  const { data, refreshing, reload } = useData<HomeData>(manager ? null : "/mini/home", { refetchOnFocus: false });
  const [lateOpen, setLateOpen] = useState(false);
  // «Kechikaman» eslatmasidan (push → sections?late=…) kelinsa — oyna ochiladi.
  const [seenLate, setSeenLate] = useState(params.late);
  if (seenLate !== params.late) {
    setSeenLate(params.late);
    if (params.late) setLateOpen(true);
  }

  const groups = useMemo(() => groupsFor(data?.features, data?.unreadNotifications || 0), [data?.features, data?.unreadNotifications]);

  const open = useCallback(
    (key: string) => {
      if (key !== "late") {
        const target = ROUTES[key];
        if (target) go(typeof target === "function" ? target() : target);
        return;
      }
      const a = data?.attendance;
      const day = data?.todayPlan;
      if (data?.lateNotice) {
        Alert.alert("Rahbaringiz ogohlantirilgan", `~${duration(data.lateNotice.minutes)} kechikasiz. «${data.lateNotice.reason}»`);
        return;
      }
      if (a?.checkIn) return void Alert.alert("Kechikaman", "Bugun allaqachon ishga kelgansiz.");
      if (data?.todayLeave || !day?.enabled) return void Alert.alert("Kechikaman", "Bugun ish kuni emas.");
      if (data && (!data.branch || !data.schedule)) return void Alert.alert("Kechikaman", "HR filial va grafikni biriktirishi kerak.");
      setLateOpen(true);
    },
    [data],
  );

  if (manager) return <Redirect href="/(tabs)/manager" />;

  return (
    <View style={[st.root, { backgroundColor: c.card }]}>
      <View style={[st.header, { paddingTop: insets.top + 10 }]}>
        <Text style={[st.headerTitle, { color: c.ink }]} accessibilityRole="header">
          Bo‘limlar
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={[st.body, { paddingBottom: insets.bottom + TAB_BAR_SPACE + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reload()} tintColor={c.muted} colors={[c.accent]} />}
      >
        <Catalog groups={groups} onOpen={open} />
      </ScrollView>
      <LateSheet
        visible={lateOpen}
        start={data?.todayPlan?.start || ""}
        onClose={() => setLateOpen(false)}
        onSaved={() => {
          setLateOpen(false);
          haptic.success();
          invalidate("/mini/home");
        }}
      />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  header: { alignItems: "center", paddingBottom: 12 },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  body: { paddingHorizontal: 12, paddingTop: 8, gap: 28 },
});
