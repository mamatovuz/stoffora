import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Badge, Button, Card, Empty, ErrorBox, Group, GroupTitle, Hint, Icon, Loading, Sheet, haptic, type IconName } from "@/components/ui";
import { errorText, post } from "@/lib/api";
import { openFile } from "@/lib/download";
import { dateUz, tashkentIsoDate } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { invalidate, useData } from "@/lib/useData";

type Doc = { id: string; type: string; title: string; expiresAt?: string; createdAt: string; status: "OK" | "SOON" | "EXPIRED" | string };
const TYPES: { key: string; label: string; icon: IconName; color: string; expires: boolean }[] = [
  { key: "PASSPORT", label: "Pasport / ID karta", icon: "id-card", color: "#0A84FF", expires: true },
  { key: "MEDICAL", label: "Tibbiy ma’lumotnoma", icon: "medkit", color: "#FF3B30", expires: true },
  { key: "SANITARY", label: "Sanitariya daftarchasi", icon: "shield-checkmark", color: "#34C759", expires: true },
  { key: "DIPLOMA", label: "Diplom", icon: "school", color: "#AF52DE", expires: false },
  { key: "CONTRACT", label: "Mehnat shartnomasi", icon: "document-text", color: "#FF9500", expires: true },
  { key: "OTHER", label: "Boshqa hujjat", icon: "folder", color: "#8E8E93", expires: false },
];
const typeOf = (key: string) => TYPES.find((t) => t.key === key) || TYPES[TYPES.length - 1];
/** Har bir xodimda bo‘lishi kerak bo‘lgan hujjatlar (yo‘q bo‘lsa — eslatma). */
const ESSENTIAL = ["PASSPORT", "MEDICAL", "SANITARY"];
const daysLeft = (iso: string) => Math.round((Date.parse(iso) - Date.parse(tashkentIsoDate())) / 86_400_000);

/** Hujjatlarim — holat, muddatlar, ko‘rish va ilovadan yuklash. */
export default function Documents() {
  const { c } = useTheme();
  const { data, error, loading, refreshing, reload } = useData<Doc[]>("/mini/documents");
  const [busy, setBusy] = useState<string | null>(null);
  const [upload, setUpload] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  const docs = data || [];
  const expired = docs.filter((d) => d.status === "EXPIRED");
  const soon = docs.filter((d) => d.status === "SOON");
  const missing = ESSENTIAL.filter((t) => !docs.some((d) => d.type === t));
  const open = async (id: string) => {
    setBusy(id);
    try {
      await openFile({ kind: "document", id });
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const groups = TYPES.map((t) => ({ t, list: docs.filter((d) => typeOf(d.type).key === t.key) })).filter((g) => g.list.length);

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reload()} tintColor={c.muted} />}
    >
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      <Card style={st.summary}>
        <Stat value={docs.length} label="hujjat" color={c.ink} />
        <View style={[st.sep, { backgroundColor: c.line }]} />
        <Stat value={soon.length} label="tugayapti" color={soon.length ? c.warn : c.muted} />
        <View style={[st.sep, { backgroundColor: c.line }]} />
        <Stat value={expired.length} label="muddati o‘tgan" color={expired.length ? c.danger : c.muted} />
      </Card>
      {expired.length ? (
        <Hint tone="bad" icon="alert-circle-outline">
          {expired.map((d) => typeOf(d.type).label).join(", ")} — muddati o‘tgan. Yangisini yuklang yoki HR’ga topshiring.
        </Hint>
      ) : soon.length ? (
        <Hint tone="warn" icon="time-outline">
          {soon.map((d) => `${typeOf(d.type).label} (${d.expiresAt ? `${daysLeft(d.expiresAt)} kun` : ""})`).join(", ")} — muddati yaqinda tugaydi.
        </Hint>
      ) : null}
      <Button title="Hujjat yuklash" icon="cloud-upload-outline" onPress={() => setUpload("PASSPORT")} />

      {missing.length ? (
        <>
          <GroupTitle>Yuklanmagan muhim hujjatlar</GroupTitle>
          <Group>
            {missing.map((key, i) => {
              const t = typeOf(key);
              return (
                <Pressable key={key} onPress={() => setUpload(key)} style={({ pressed }) => [st.row, i < missing.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }, pressed && { opacity: 0.6 }]}>
                  <View style={[st.icon, { backgroundColor: `${t.color}18` }]}>
                    <Icon name={t.icon} size={18} color={t.color} />
                  </View>
                  <Text style={{ flex: 1, color: c.ink, fontSize: 15.5 }}>{t.label}</Text>
                  <Text style={{ color: c.accent, fontWeight: "600" }}>Yuklash</Text>
                </Pressable>
              );
            })}
          </Group>
        </>
      ) : null}

      {!docs.length ? (
        <Empty icon="folder-open-outline" title="Hujjatlar yo‘q" text="Pasport, tibbiy ma’lumotnoma, sanitariya daftarchasi va boshqa hujjatlaringizni shu yerda saqlang — HR ham ko‘radi." />
      ) : (
        groups.map(({ t, list }) => (
          <View key={t.key} style={{ gap: 6 }}>
            <GroupTitle>{t.label}</GroupTitle>
            <Group>
              {list.map((d, i) => {
                const left = d.expiresAt ? daysLeft(d.expiresAt) : undefined;
                return (
                  <Pressable key={d.id} onPress={() => void open(d.id)} style={({ pressed }) => [st.row, i < list.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }, pressed && { opacity: 0.6 }]}>
                    <View style={[st.icon, { backgroundColor: `${t.color}18` }]}>
                      <Icon name={t.icon} size={18} color={t.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.ink, fontSize: 15.5, fontWeight: "500" }} numberOfLines={1}>
                        {d.title || t.label}
                      </Text>
                      <Text style={{ color: c.muted, fontSize: 12.5 }}>
                        Yuklangan {dateUz(d.createdAt.slice(0, 10))}
                        {d.expiresAt ? ` · ${dateUz(d.expiresAt)} gacha` : " · muddatsiz"}
                      </Text>
                    </View>
                    {busy === d.id ? (
                      <ActivityIndicator />
                    ) : d.status === "EXPIRED" ? (
                      <Badge text="Muddati o‘tgan" tone="bad" />
                    ) : d.status === "SOON" ? (
                      <Badge text={`${left} kun qoldi`} tone="warn" />
                    ) : d.expiresAt ? (
                      <Badge text="Amal qiladi" tone="ok" />
                    ) : (
                      <Icon name="chevron-forward" size={17} color={c.muted} />
                    )}
                  </Pressable>
                );
              })}
            </Group>
          </View>
        ))
      )}
      <UploadSheet
        type={upload}
        onClose={() => setUpload(null)}
        onSaved={() => {
          setUpload(null);
          haptic.success();
          invalidate("/mini/documents");
          void reload();
        }}
      />
    </ScrollView>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
      <Text style={{ color, fontSize: 24, fontWeight: "700" }}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

/** Hujjat yuklash: turi, (ixtiyoriy) muddati, kamera yoki galereyadan rasm. */
function UploadSheet({ type, onClose, onSaved }: { type: string | null; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const [kind, setKind] = useState("PASSPORT");
  const [title, setTitle] = useState("");
  const [expires, setExpires] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (type && shownFor !== type) {
    setShownFor(type);
    setKind(type);
    setTitle("");
    setExpires("");
    setFile(null);
    setError("");
  }
  const t = typeOf(kind);
  // «29.08.2027» → ISO
  const iso = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(expires.trim());
  const expiresAt = iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : "";
  const pick = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(camera ? "Kameraga ruxsat berilmagan." : "Galereyaga ruxsat berilmagan.");
    const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    const image = await ImageManipulator.manipulate(result.assets[0].uri).resize({ width: 1600 }).renderAsync();
    const saved = await image.saveAsync({ compress: 0.72, format: SaveFormat.JPEG, base64: true });
    if (saved.base64) setFile(`data:image/jpeg;base64,${saved.base64}`);
    setError("");
    haptic.success();
  };
  const save = async () => {
    if (!file) return;
    if (expires.trim() && !expiresAt) return setError("Muddatni kun.oy.yil ko‘rinishida yozing: 29.08.2027");
    setBusy(true);
    setError("");
    try {
      await post("/mini/documents", { type: kind, title: title.trim() || undefined, expiresAt: expiresAt || undefined, dataUrl: file }, 40_000);
      onSaved();
    } catch (e) {
      haptic.error();
      setError(errorText(e, "Yuklanmadi."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={Boolean(type)} title="Hujjat yuklash" subtitle="HR ham ko‘radi; muddati yaqinlashsa eslatma keladi" onClose={onClose}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {TYPES.map((x) => (
          <Pressable key={x.key} onPress={() => setKind(x.key)} style={[st.chip, { borderColor: kind === x.key ? c.accent : c.line, backgroundColor: kind === x.key ? `${c.accent}14` : c.card }]}>
            <Text style={{ color: kind === x.key ? c.accent : c.ink, fontWeight: kind === x.key ? "600" : "400" }}>{x.label}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={title} onChangeText={setTitle} placeholder={`Nomi (ixtiyoriy) — ${t.label}`} placeholderTextColor={c.muted} maxLength={120} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]} />
      {t.expires ? (
        <TextInput value={expires} onChangeText={setExpires} placeholder="Amal qilish muddati (29.08.2027) — ixtiyoriy" placeholderTextColor={c.muted} keyboardType="numbers-and-punctuation" maxLength={10} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]} />
      ) : null}
      {file ? (
        <View style={[st.file, { backgroundColor: `${c.success}14` }]}>
          <Icon name="checkmark-circle" size={20} color={c.success} />
          <Text style={{ flex: 1, color: c.ink }}>Rasm tayyor</Text>
          <Pressable onPress={() => setFile(null)} hitSlop={10}>
            <Icon name="close-circle" size={20} color={c.muted} />
          </Pressable>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="Rasmga olish" icon="camera-outline" tone="soft" onPress={() => void pick(true)} style={{ flex: 1, height: 46 }} />
          <Button title="Galereya" icon="images-outline" tone="soft" onPress={() => void pick(false)} style={{ flex: 1, height: 46 }} />
        </View>
      )}
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      <Button title="Yuklash" icon="cloud-upload-outline" busy={busy} disabled={!file} onPress={() => void save()} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", paddingVertical: 14 },
  sep: { width: StyleSheet.hairlineWidth, height: 32 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5 },
  file: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12 },
});
