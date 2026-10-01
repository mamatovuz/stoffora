import * as Notifications from "expo-notifications";
import { router, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Badge, Button, Empty, ErrorBox, Icon, Loading, haptic, type IconName } from "@/components/ui";
import { errorText, post } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { routeForGo } from "@/lib/links";
import { radius, useTheme } from "@/lib/theme";
import type { Notification } from "@/lib/types";
import { invalidate, useData } from "@/lib/useData";

const TYPE_ICON: Record<string, [IconName, string]> = {
  LEAVE: ["airplane", "#8B5CF6"],
  PAYROLL: ["wallet", "#16A34A"],
  ANNOUNCEMENT: ["megaphone", "#F59E0B"],
  DOCUMENT: ["document-text", "#0EA5E9"],
  SECURITY: ["shield-checkmark", "#EF4444"],
  ATTENDANCE: ["time", "#2563EB"],
};

/** Bildirishnomalar: Mini App’dagi ro‘yxat + e’lonni tasdiqlash / so‘rovnomaga javob. */
export default function NotificationsScreen() {
  const { c } = useTheme();
  const navigation = useNavigation();
  const { data, error, loading, refreshing, reload, setData } = useData<{ items: Notification[]; unread: number }>("/mini/notifications", { maxAgeMs: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const readAll = async () => {
    if (!data?.unread) return;
    setData({ items: data.items.map((n) => ({ ...n, read: true })), unread: 0 });
    await post("/mini/notifications/read", { all: true }).catch(() => undefined);
    invalidate("/mini/home");
    void Notifications.setBadgeCountAsync(0).catch(() => undefined);
  };
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        data?.unread ? (
          <Pressable onPress={() => void readAll()} hitSlop={10}>
            <Text style={{ color: c.accent, fontSize: 16 }}>Hammasini o‘qish</Text>
          </Pressable>
        ) : null,
    });
  });
  useEffect(() => {
    void Notifications.setBadgeCountAsync(data?.unread || 0).catch(() => undefined);
  }, [data?.unread]);

  const open = async (n: Notification) => {
    haptic.select();
    if (!n.read) {
      setData((d) => (d ? { items: d.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)), unread: Math.max(0, d.unread - 1) } : d));
      void post("/mini/notifications/read", { ids: [n.id] }).catch(() => undefined);
      invalidate("/mini/home");
    }
    if (n.go && !n.ackRequired && !n.options?.length) router.push(routeForGo(n.go));
  };
  const ack = async (n: Notification, answer?: string) => {
    setBusy(n.id);
    setActionError("");
    try {
      const row = await post<Notification>(`/mini/notifications/${n.id}/ack`, answer ? { answer } : {});
      haptic.success();
      setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === n.id ? { ...x, ...row } : x)) } : d));
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <Loading />;
  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
      data={data?.items || []}
      keyExtractor={(n) => n.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reload()} tintColor={c.muted} />}
      ListHeaderComponent={error ? <ErrorBox text={error} onRetry={reload} /> : actionError ? <ErrorBox text={actionError} /> : null}
      ListEmptyComponent={<Empty icon="notifications-off-outline" title="Bildirishnomalar yo‘q" text="So‘rov javoblari, e’lonlar va eslatmalar shu yerda paydo bo‘ladi." />}
      renderItem={({ item: n }) => {
        const [icon, color] = TYPE_ICON[n.type] || ["notifications", c.accent];
        return (
          <Pressable onPress={() => void open(n)} style={({ pressed }) => [st.item, { backgroundColor: c.card, borderRadius: radius.card }, pressed && { opacity: 0.75 }]}>
            <View style={[st.icon, { backgroundColor: `${color}1E` }]}>
              <Icon name={icon} size={18} color={color} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {!n.read ? <View style={[st.dot, { backgroundColor: c.accent }]} /> : null}
                <Text style={{ flex: 1, color: c.ink, fontWeight: n.read ? "500" : "700", fontSize: 15 }} numberOfLines={2}>
                  {n.title}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>{timeAgo(n.createdAt)}</Text>
              </View>
              <Text style={{ color: c.muted, fontSize: 14, lineHeight: 19 }}>{n.body.replace(/<[^>]+>/g, "")}</Text>
              {n.options?.length ? (
                n.ackAt ? (
                  <Badge text={`Javobingiz: ${n.answer}`} tone="ok" />
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                    {n.options.map((o) => (
                      <Pressable key={o} disabled={busy === n.id} onPress={() => void ack(n, o)} style={[st.option, { borderColor: c.accent }]}>
                        <Text style={{ color: c.accent, fontWeight: "600" }}>{o}</Text>
                      </Pressable>
                    ))}
                  </View>
                )
              ) : n.ackRequired ? (
                n.ackAt ? (
                  <Badge text="Tanishdim ✓" tone="ok" />
                ) : (
                  <Button title="Tanishdim" icon="checkmark" tone="soft" busy={busy === n.id} onPress={() => void ack(n)} style={{ marginTop: 6, height: 42 }} />
                )
              ) : null}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const st = StyleSheet.create({
  item: { flexDirection: "row", gap: 12, padding: 14 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  option: { borderWidth: 1.5, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 7 },
});
