import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { applyAppUpdate, Updates } from "@/lib/updates";
import { typo, useTheme } from "@/lib/theme";
import { Icon, haptic } from "./ui";

/** «Yangi versiya tayyor» — yangilanish yuklab olingan bo‘lsa; bosilsa ilova yangi versiyada qayta ochiladi. */
export function UpdateBanner() {
  const { c } = useTheme();
  const { isUpdatePending } = Updates.useUpdates();
  const [busy, setBusy] = useState(false);
  if (!isUpdatePending) return null;
  return (
    <Pressable
      disabled={busy}
      onPress={() => {
        haptic.medium();
        setBusy(true);
        void applyAppUpdate().catch(() => setBusy(false));
      }}
      style={({ pressed }) => [st.wrap, { backgroundColor: `${c.accent}14`, opacity: pressed || busy ? 0.7 : 1 }]}
      accessibilityRole="button"
    >
      <View style={[st.icon, { backgroundColor: c.accent }]}>
        <Icon name="cloud-download-outline" size={18} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[typo.bodyStrong, { color: c.ink }]}>Yangi versiya tayyor</Text>
        <Text style={[typo.sub, { color: c.muted }]}>Bir bosishda yangilanadi — ilova qayta ochiladi</Text>
      </View>
      <Text style={[typo.bodyStrong, { color: c.accent }]}>{busy ? "…" : "Yangilash"}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16 },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
});
