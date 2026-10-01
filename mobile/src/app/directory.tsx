import { useMemo, useState } from "react";
import { FlatList, Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Empty, ErrorBox, Icon, Loading } from "@/components/ui";
import { radius, useTheme } from "@/lib/theme";
import { useData } from "@/lib/useData";

type Person = { id: string; name: string; position?: string; department?: string; branch?: string; sameBranch?: boolean; username?: string; phone?: string; photoDataUrl?: string };

/** Hamkasblar ma’lumotnomasi — qidiruv, Telegram va qo‘ng‘iroq (kompaniya ruxsat bergan bo‘lsa). */
export default function Directory() {
  const { c } = useTheme();
  const { data, error, loading, reload } = useData<{ rows: Person[]; phones: boolean }>("/mini/directory", { maxAgeMs: 5 * 60_000 });
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.rows || []).filter((p) => !term || [p.name, p.position, p.department, p.branch].some((v) => v?.toLowerCase().includes(term)));
  }, [data, q]);
  if (loading && !data) return <Loading />;
  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}
      data={rows}
      keyExtractor={(p) => p.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: 10, marginBottom: 4 }}>
          <View style={[st.search, { backgroundColor: c.card }]}>
            <Icon name="search" size={17} color={c.muted} />
            <TextInput value={q} onChangeText={setQ} placeholder="Ism, lavozim yoki bo‘lim" placeholderTextColor={c.muted} style={{ flex: 1, color: c.ink, fontSize: 16 }} clearButtonMode="while-editing" />
          </View>
          {error ? <ErrorBox text={error} onRetry={reload} /> : null}
        </View>
      }
      ListEmptyComponent={<Empty icon="people-outline" title="Hech kim topilmadi" />}
      renderItem={({ item: p }) => (
        <View style={[st.item, { backgroundColor: c.card, borderRadius: radius.card }]}>
          {p.photoDataUrl ? (
            <Image source={{ uri: p.photoDataUrl }} style={st.avatar} />
          ) : (
            <View style={[st.avatar, { backgroundColor: `${c.accent}1C`, alignItems: "center", justifyContent: "center" }]}>
              <Text style={{ color: c.accent, fontWeight: "700" }}>{p.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.ink, fontWeight: "600", fontSize: 15.5 }}>{p.name}</Text>
            <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
              {[p.position, p.department, p.sameBranch ? null : p.branch].filter(Boolean).join(" · ")}
            </Text>
          </View>
          {p.username ? (
            <Pressable onPress={() => void Linking.openURL(`https://t.me/${p.username}`)} hitSlop={8} style={[st.action, { backgroundColor: `${c.accent}16` }]} accessibilityLabel="Telegram">
              <Icon name="paper-plane" size={17} color={c.accent} />
            </Pressable>
          ) : null}
          {p.phone ? (
            <Pressable onPress={() => void Linking.openURL(`tel:${p.phone}`)} hitSlop={8} style={[st.action, { backgroundColor: `${c.success}18` }]} accessibilityLabel="Qo‘ng‘iroq">
              <Icon name="call" size={17} color={c.success} />
            </Pressable>
          ) : null}
        </View>
      )}
    />
  );
}

const st = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 42, borderRadius: 12 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  action: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
});
