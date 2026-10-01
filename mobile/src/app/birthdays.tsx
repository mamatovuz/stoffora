import { useState } from "react";
import { Alert, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Card, Empty, ErrorBox, Loading, haptic } from "@/components/ui";
import { errorText, post } from "@/lib/api";
import { dateUz } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { useData } from "@/lib/useData";

type Person = { id: string; name: string; position?: string; branch?: string; photoDataUrl?: string; date: string; inDays: number; me: boolean; congratulated: boolean; canCongratulate: boolean };

/** Tug‘ilgan kunlar lentasi (yaqin 14 kun) — bugungilarni tabriklash. */
export default function Birthdays() {
  const { c } = useTheme();
  const { data, error, loading, reload, setData } = useData<Person[]>("/mini/birthdays");
  const [busy, setBusy] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  const congrats = async (p: Person) => {
    setBusy(p.id);
    try {
      await post(`/mini/birthdays/${p.id}/congrats`, {});
      haptic.success();
      setData((rows) => rows?.map((r) => (r.id === p.id ? { ...r, congratulated: true } : r)));
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}>
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      {!data?.length ? <Empty icon="gift-outline" title="Yaqin kunlarda tug‘ilgan kun yo‘q" /> : null}
      {data?.map((p) => (
        <Card key={p.id} style={[st.item, p.inDays === 0 && { borderWidth: 1.5, borderColor: "#FF2D55" }]}>
          {p.photoDataUrl ? <Image source={{ uri: p.photoDataUrl }} style={st.avatar} /> : <View style={[st.avatar, { backgroundColor: "#FF2D5520", alignItems: "center", justifyContent: "center" }]}><Text style={{ fontSize: 22 }}>🎂</Text></View>}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: c.ink, fontWeight: "600", fontSize: 15.5 }}>
              {p.name}
              {p.me ? " (siz)" : ""}
            </Text>
            <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
              {[p.position, p.branch].filter(Boolean).join(" · ")}
            </Text>
            <Text style={{ color: p.inDays === 0 ? "#FF2D55" : c.muted, fontSize: 13, fontWeight: p.inDays === 0 ? "700" : "400" }}>{p.inDays === 0 ? "🎉 Bugun!" : p.inDays === 1 ? "Ertaga" : `${dateUz(p.date)} · ${p.inDays} kundan keyin`}</Text>
          </View>
          {p.canCongratulate ? <Button title={p.congratulated ? "Tabriklandi" : "Tabriklash"} tone={p.congratulated ? "ghost" : "primary"} disabled={p.congratulated} busy={busy === p.id} onPress={() => void congrats(p)} style={{ height: 38, paddingHorizontal: 12 }} /> : null}
        </Card>
      ))}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  item: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
});
