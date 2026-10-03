import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useLayoutEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Badge, Button, Card, Empty, ErrorBox, Group, Icon, Loading, Row, Segmented, Sheet, haptic } from "@/components/ui";
import { errorText, post } from "@/lib/api";
import { dateUz } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { useData } from "@/lib/useData";

/*
 * «Ishlarim»: menga berilgan vazifalar, filialimning bugungi checklisti va men yuborgan muammolar (hodisalar).
 * Mini App bilan bir xil API (/mini/work …).
 */

type WorkView = "tasks" | "checklist" | "incidents";
type Task = { id: string; title: string; description?: string; dueDate?: string; priority: "LOW" | "NORMAL" | "HIGH"; requirePhoto?: boolean; status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED"; createdBy: string; overdue: boolean; comments: { by: string; text: string; at: string }[] };
type Run = { templateId: string; title: string; dueTime?: string; items: { id: string; text: string; requirePhoto?: boolean; done: boolean; by?: string; at?: string }[]; done: number; total: number; overdue: boolean };
type Incident = { id: string; title: string; categoryLabel: string; status: "OPEN" | "IN_PROGRESS" | "RESOLVED"; createdAt: string; history: { note?: string }[] };
type Work = { tasks: Task[]; checklists: Run[]; incidents: Incident[]; categories: Record<string, string> };

const INC: Record<Incident["status"], [string, "bad" | "warn" | "ok"]> = { OPEN: ["Ochiq", "bad"], IN_PROGRESS: ["Jarayonda", "warn"], RESOLVED: ["Hal qilindi", "ok"] };
const clock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" }) : "");

/** Kameradan rasm (siqilgan JPEG dataUrl). Ruxsat yo‘q yoki bekor — null. */
async function takePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("Kamera", "Kameraga ruxsat berilmagan.");
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
  if (result.canceled || !result.assets[0]) return null;
  const image = await ImageManipulator.manipulate(result.assets[0].uri).resize({ width: 1280 }).renderAsync();
  const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
  return saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : null;
}

export default function WorkScreen() {
  const params = useLocalSearchParams<{ view?: WorkView }>();
  const navigation = useNavigation();
  const { c } = useTheme();
  const [view, setView] = useState<WorkView>(params.view || "tasks");
  const { data, error, reload } = useData<Work>("/mini/work");
  const [busy, setBusy] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  useLayoutEffect(() => {
    navigation.setOptions({ title: "Ishlarim" });
  }, [navigation]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      haptic.success();
      void reload();
    } catch (e) {
      haptic.error();
      Alert.alert("Xatolik", errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const finish = async (t: Task) => {
    let photo: string | null = null;
    if (t.requirePhoto) {
      photo = await takePhoto();
      if (!photo) return;
    }
    await run(t.id, () => post(`/mini/tasks/${t.id}/status`, { status: "DONE", photo: photo || undefined }, 40_000));
  };
  const toggle = async (r: Run, item: Run["items"][number]) => {
    let photo: string | null = null;
    if (!item.done && item.requirePhoto) {
      photo = await takePhoto();
      if (!photo) return;
    }
    await run(`${r.templateId}:${item.id}`, () => post(`/mini/checklists/${r.templateId}/items/${item.id}`, { done: !item.done, photo: photo || undefined }, 40_000));
  };

  const active = (data?.tasks || []).filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
  const done = (data?.tasks || []).filter((t) => t.status === "DONE");
  const left = (data?.checklists || []).reduce((n, r) => n + r.total - r.done, 0);
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <Segmented<WorkView>
        value={view}
        onChange={setView}
        options={[
          ["tasks", "Vazifalar", active.length],
          ["checklist", "Checklist", left],
          ["incidents", "Muammolar"],
        ]}
      />
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      {!data ? (
        <Loading />
      ) : view === "tasks" ? (
        !data.tasks.length ? (
          <Empty icon="checkbox-outline" title="Vazifalar yo‘q" text="Rahbar vazifa bersa — shu yerda va bildirishnomada ko‘rasiz." />
        ) : (
          <>
            {active.map((t) => (
              <Card key={t.id} style={{ gap: 10, borderWidth: t.overdue ? 1 : 0, borderColor: `${c.danger}66` }}>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.ink, fontSize: 16, fontWeight: "700" }}>{t.title}</Text>
                    <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>
                      {t.createdBy}
                      {t.dueDate ? ` · muddat ${dateUz(t.dueDate)}` : ""}
                      {t.overdue ? " · kechikdi" : ""}
                    </Text>
                  </View>
                  <Badge text={t.priority === "HIGH" ? "Muhim" : t.status === "IN_PROGRESS" ? "Jarayonda" : "Yangi"} tone={t.priority === "HIGH" ? "bad" : "warn"} />
                </View>
                {t.description ? <Text style={{ color: c.ink, fontSize: 14.5, lineHeight: 20 }}>{t.description}</Text> : null}
                {t.comments.slice(-2).map((m, i) => (
                  <Text key={i} style={{ color: c.muted, fontSize: 13 }}>
                    <Text style={{ fontWeight: "700" }}>{m.by}:</Text> {m.text}
                  </Text>
                ))}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {t.status === "TODO" ? (
                    <Button title="Boshladim" icon="play" tone="ghost" busy={busy === t.id} onPress={() => void run(t.id, () => post(`/mini/tasks/${t.id}/status`, { status: "IN_PROGRESS" }))} style={{ flex: 1 }} />
                  ) : null}
                  <Button title="Bajarildi" icon={t.requirePhoto ? "camera" : "checkmark"} busy={busy === t.id} onPress={() => void finish(t)} style={{ flex: 1 }} />
                </View>
              </Card>
            ))}
            {done.length ? (
              <Group>
                {done.map((t, i) => (
                  <Row key={t.id} icon="checkmark-circle" iconColor={c.success} label={t.title} sub={t.createdBy} right={<Badge text="Bajarildi" tone="ok" />} last={i === done.length - 1} />
                ))}
              </Group>
            ) : null}
          </>
        )
      ) : view === "checklist" ? (
        !data.checklists.length ? (
          <Empty icon="list-outline" title="Bugun checklist yo‘q" text="Filialingiz uchun kundalik ro‘yxat bo‘lsa — shu yerda chiqadi." />
        ) : (
          data.checklists.map((r) => (
            <Card key={r.templateId} style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                <Text style={{ color: c.ink, fontSize: 16, fontWeight: "700", flex: 1 }}>{r.title}</Text>
                <Text style={{ color: r.overdue ? c.danger : c.muted, fontSize: 13 }}>
                  {r.done}/{r.total}
                  {r.dueTime ? ` · ${r.dueTime} gacha` : ""}
                </Text>
              </View>
              <View style={[st.bar, { backgroundColor: c.line }]}>
                <View style={{ width: `${r.total ? (r.done / r.total) * 100 : 0}%`, height: "100%", backgroundColor: r.done === r.total ? c.success : c.accent }} />
              </View>
              {r.items.map((item) => (
                <Pressable key={item.id} disabled={busy === `${r.templateId}:${item.id}`} onPress={() => void toggle(r, item)} style={[st.item, { borderTopColor: c.line }]}>
                  <Icon name={item.done ? "checkmark-circle" : "ellipse-outline"} size={24} color={item.done ? c.success : c.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.ink, fontSize: 15, textDecorationLine: item.done ? "line-through" : "none" }}>{item.text}</Text>
                    {item.done ? (
                      <Text style={{ color: c.muted, fontSize: 12 }}>
                        {item.by} · {clock(item.at)}
                      </Text>
                    ) : item.requirePhoto ? (
                      <Text style={{ color: c.muted, fontSize: 12 }}>📷 rasm bilan</Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </Card>
          ))
        )
      ) : (
        <>
          <Button title="Muammo haqida xabar berish" icon="warning-outline" onPress={() => setReporting(true)} />
          {!data.incidents.length ? (
            <Empty icon="construct-outline" title="Muammolar yo‘q" text="Jihoz buzildimi, internet yo‘qmi, xavfli holatmi — rasm bilan yuboring, rahbar darhol ko‘radi." />
          ) : (
            <Group>
              {data.incidents.map((i, idx) => {
                const last = i.history[i.history.length - 1];
                return (
                  <Row
                    key={i.id}
                    icon="warning"
                    iconColor={i.status === "RESOLVED" ? c.success : c.warn}
                    label={i.title}
                    sub={`${i.categoryLabel} · ${dateUz(i.createdAt.slice(0, 10))}${i.status !== "OPEN" && last?.note ? ` · ${last.note}` : ""}`}
                    right={<Badge text={INC[i.status][0]} tone={INC[i.status][1]} />}
                    last={idx === data.incidents.length - 1}
                  />
                );
              })}
            </Group>
          )}
        </>
      )}
      {data ? (
        <IncidentSheet
          visible={reporting}
          categories={data.categories}
          onClose={() => setReporting(false)}
          onSaved={() => {
            setReporting(false);
            haptic.success();
            void reload();
          }}
        />
      ) : null}
    </ScrollView>
  );
}

function IncidentSheet({ visible, categories, onClose, onSaved }: { visible: boolean; categories: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("EQUIPMENT");
  const [severity, setSeverity] = useState<"LOW" | "MEDIUM" | "HIGH">("MEDIUM");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await post("/mini/incidents", { title: title.trim(), description: description.trim() || undefined, category, severity, photo: photo || undefined }, 40_000);
      setTitle("");
      setDescription("");
      setPhoto(null);
      onSaved();
    } catch (e) {
      setError(errorText(e, "Yuborilmadi."));
    } finally {
      setBusy(false);
    }
  };
  const chip = (on: boolean) => [st.chip, { borderColor: on ? c.accent : c.line, backgroundColor: on ? `${c.accent}18` : c.card }];
  return (
    <Sheet visible={visible} title="Muammo haqida xabar" subtitle="Rahbar va mas’ullarga darhol boradi" onClose={onClose}>
      <TextInput value={title} onChangeText={setTitle} placeholder="Nima bo‘ldi? (masalan: kassa printeri ishlamayapti)" placeholderTextColor={c.muted} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]} maxLength={140} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {Object.entries(categories).map(([k, v]) => (
          <Pressable key={k} onPress={() => setCategory(k)} style={chip(category === k)}>
            <Text style={{ color: category === k ? c.accent : c.ink, fontSize: 13 }}>{v}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(
          [
            ["LOW", "Past"],
            ["MEDIUM", "O‘rta"],
            ["HIGH", "Jiddiy"],
          ] as const
        ).map(([k, v]) => (
          <Pressable key={k} onPress={() => setSeverity(k)} style={[chip(severity === k), { flex: 1, alignItems: "center" }]}>
            <Text style={{ color: severity === k ? (k === "HIGH" ? c.danger : c.accent) : c.ink }}>{v}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={description} onChangeText={setDescription} placeholder="Tafsilot (ixtiyoriy)" placeholderTextColor={c.muted} multiline style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card, minHeight: 80, textAlignVertical: "top" }]} maxLength={1500} />
      <Button title={photo ? "Rasm olindi ✓ (qayta olish)" : "Rasm olish"} icon="camera-outline" tone="ghost" onPress={() => void takePhoto().then((p) => p && setPhoto(p))} />
      {photo ? <Image source={{ uri: photo }} style={{ width: "100%", height: 180, borderRadius: 12 }} resizeMode="cover" /> : null}
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      <Button title="Yuborish" icon="send" busy={busy} disabled={title.trim().length < 3} onPress={() => void save()} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  bar: { height: 6, borderRadius: 3, overflow: "hidden", marginVertical: 6 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5 },
});
