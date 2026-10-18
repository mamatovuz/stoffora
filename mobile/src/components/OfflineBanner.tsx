import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { clearSyncFailures, flushMarks, useOfflineMarks } from "@/lib/offlineMarks";
import { typo, useTheme } from "@/lib/theme";
import { Icon, haptic } from "./ui";

/** Bosh ekran: telefonda saqlangan (internetsiz) belgilar va rad etilganlari. */
export function OfflineBanner() {
  const { c } = useTheme();
  const { count, failures } = useOfflineMarks();
  const [busy, setBusy] = useState(false);
  if (!count && !failures.length) return null;
  const send = async () => {
    haptic.tap();
    setBusy(true);
    try {
      const { sent } = await flushMarks();
      if (sent) haptic.success();
      else Alert.alert("Internet yo‘q", "Belgilar telefonda saqlanib turadi va aloqa tiklanishi bilan avtomatik yuboriladi.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      {count ? (
        <View style={[st.wrap, { backgroundColor: `${c.accent}14` }]}>
          <Icon name="cloud-offline-outline" size={22} color={c.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[typo.bodyStrong, { color: c.ink }]}>{count} ta belgi telefonda saqlangan</Text>
            <Text style={[typo.sub, { color: c.muted }]}>Internet tiklanishi bilan avtomatik yuboriladi</Text>
          </View>
          <Pressable onPress={() => void send()} disabled={busy} hitSlop={8} style={({ pressed }) => [st.btn, { backgroundColor: c.accent, opacity: pressed || busy ? 0.6 : 1 }]}>
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>{busy ? "…" : "Yuborish"}</Text>
          </Pressable>
        </View>
      ) : null}
      {failures.map((f) => (
        <View key={`${f.at}:${f.action}`} style={[st.wrap, { backgroundColor: `${c.danger}14` }]}>
          <Icon name="alert-circle" size={22} color={c.danger} />
          <View style={{ flex: 1 }}>
            <Text style={[typo.bodyStrong, { color: c.ink }]}>
              Internetsiz {f.action === "CHECK_IN" ? "kelish" : "ketish"} ({new Date(f.at + 5 * 3_600_000).toISOString().slice(11, 16)}) qabul qilinmadi
            </Text>
            <Text style={[typo.sub, { color: c.muted }]}>{f.message}</Text>
          </View>
          <Pressable onPress={clearSyncFailures} hitSlop={10} accessibilityLabel="Yopish">
            <Icon name="close" size={18} color={c.muted} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16 },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
});
