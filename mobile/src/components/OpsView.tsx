import { useCallback, useEffect, useState } from "react";
import { Alert, Image, StyleSheet, Text, TextInput, View } from "react-native";
import { errorText } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { dateUz } from "@/lib/format";
import { managerAuth, mcall } from "@/lib/manager";
import { useTheme } from "@/lib/theme";
import { Badge, Button, Card, Empty, Group, GroupTitle, Loading, Row, haptic } from "./ui";

/*
 * Rahbar — «Operatsiya»: bugungi checklistlar (filial bo‘yicha), ochiq hodisalar (rasm bilan;
 * Jarayonga olish / Hal qilindi) va ochiq vazifalar. Huquq va filial chegarasi serverda.
 */

type Run = { templateId: string; title: string; branch: string; branchId: string; done: number; total: number; dueTime?: string; overdue: boolean };
type Incident = { id: string; title: string; branch: string; categoryLabel: string; severity: "LOW" | "MEDIUM" | "HIGH"; status: "OPEN" | "IN_PROGRESS" | "RESOLVED"; reporterName: string; assignee?: string; createdAt: string; description?: string; photoIds: string[] };
type Task = { id: string; title: string; assignees: { name: string }[]; dueDate?: string; status: string; overdue: boolean };
type Summary = { openTasks: number; overdueTasks: number; openIncidents: number; checklists: { total: number; done: number; overdue: number }; runs: Run[]; incidents: Incident[]; tasks: Task[] };

export function OpsView() {
  const { c } = useTheme();
  const [data, setData] = useState<Summary | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(() => {
    mcall<Summary>("/ops/summary")
      .then(setData)
      .catch((e) => Alert.alert("Xatolik", errorText(e)));
  }, []);
  useEffect(() => {
    load();
    void managerAuth()
      .then((a) => setToken(a.token))
      .catch(() => undefined);
  }, [load]);

  const move = async (i: Incident, status: Incident["status"], text?: string) => {
    setBusy(i.id);
    try {
      await mcall(`/incidents/${i.id}/status`, { status, note: text || undefined });
      haptic.success();
      setResolving(null);
      setNote("");
      load();
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <Loading />;
  const stat = (value: string, label: string, bad: boolean) => (
    <Card style={{ flex: 1, gap: 2, padding: 12 }}>
      <Text style={{ color: bad ? c.danger : c.ink, fontSize: 20, fontWeight: "700" }}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 12 }}>{label}</Text>
    </Card>
  );
  return (
    <>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {stat(String(data.openIncidents), "ochiq hodisa", data.openIncidents > 0)}
        {stat(`${data.checklists.done}/${data.checklists.total}`, "checklist", data.checklists.overdue > 0)}
        {stat(String(data.openTasks), data.overdueTasks ? `vazifa · ${data.overdueTasks} kechikdi` : "ochiq vazifa", data.overdueTasks > 0)}
      </View>

      {data.runs.length ? (
        <>
          <GroupTitle>Bugungi checklistlar</GroupTitle>
          <Card style={{ gap: 10 }}>
            {data.runs.map((r) => (
              <View key={`${r.templateId}-${r.branchId}`} style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ color: c.ink, fontWeight: "600", flex: 1 }} numberOfLines={1}>
                    {r.title} · {r.branch}
                  </Text>
                  <Text style={{ color: r.overdue ? c.danger : c.muted, fontSize: 13 }}>
                    {r.done}/{r.total}
                    {r.overdue ? " · kechikdi" : r.dueTime ? ` · ${r.dueTime}` : ""}
                  </Text>
                </View>
                <View style={[st.bar, { backgroundColor: c.line }]}>
                  <View style={{ width: `${r.total ? (r.done / r.total) * 100 : 0}%`, height: "100%", backgroundColor: r.done === r.total ? c.success : c.accent }} />
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <GroupTitle>Hodisalar</GroupTitle>
      {!data.incidents.length ? (
        <Empty icon="checkmark-done-outline" title="Ochiq hodisa yo‘q" />
      ) : (
        data.incidents.map((i) => (
          <Card key={i.id} style={{ gap: 8, borderWidth: i.severity === "HIGH" ? 1 : 0, borderColor: `${c.danger}66` }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.ink, fontSize: 15.5, fontWeight: "700" }}>{i.title}</Text>
                <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 2 }}>
                  {i.branch} · {i.categoryLabel} · {i.reporterName} · {dateUz(i.createdAt.slice(0, 10))}
                  {i.assignee ? ` · → ${i.assignee}` : ""}
                </Text>
              </View>
              <Badge text={i.status === "OPEN" ? "Ochiq" : "Jarayonda"} tone={i.status === "OPEN" ? "bad" : "warn"} />
            </View>
            {i.description ? <Text style={{ color: c.ink, fontSize: 14 }}>{i.description}</Text> : null}
            {token && i.photoIds.length ? (
              <View style={{ flexDirection: "row", gap: 6 }}>
                {i.photoIds.slice(0, 3).map((id) => (
                  <Image key={id} source={{ uri: `${API_URL}/ops/photos/${id}`, headers: { authorization: `Bearer ${token}` } }} style={st.photo} />
                ))}
              </View>
            ) : null}
            {resolving === i.id ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput value={note} onChangeText={setNote} placeholder="Nima qilindi?" placeholderTextColor={c.muted} autoFocus style={[st.input, { color: c.ink, borderColor: c.line }]} />
                <Button title="Saqlash" busy={busy === i.id} disabled={!note.trim()} onPress={() => void move(i, "RESOLVED", note.trim())} style={{ flex: 0, minWidth: 96 }} />
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 8 }}>
                {i.status === "OPEN" ? <Button title="Jarayonga" icon="construct-outline" tone="ghost" busy={busy === i.id} onPress={() => void move(i, "IN_PROGRESS")} style={{ flex: 1 }} /> : null}
                <Button title="Hal qilindi" icon="checkmark" onPress={() => (setResolving(i.id), setNote(""))} style={{ flex: 1 }} />
              </View>
            )}
          </Card>
        ))
      )}

      {data.tasks.length ? (
        <>
          <GroupTitle>Ochiq vazifalar</GroupTitle>
          <Group>
            {data.tasks.map((t, idx) => (
              <Row
                key={t.id}
                icon="checkbox-outline"
                iconColor={t.overdue ? c.danger : undefined}
                label={t.title}
                sub={`${t.assignees.map((a) => a.name).join(", ").slice(0, 60)}${t.dueDate ? ` · ${dateUz(t.dueDate)}` : ""}`}
                right={<Badge text={t.overdue ? "Kechikdi" : t.status === "IN_PROGRESS" ? "Jarayonda" : "Yangi"} tone={t.overdue ? "bad" : "warn"} />}
                last={idx === data.tasks.length - 1}
              />
            ))}
          </Group>
        </>
      ) : null}
    </>
  );
}

const st = StyleSheet.create({
  bar: { height: 6, borderRadius: 3, overflow: "hidden" },
  photo: { width: 84, height: 84, borderRadius: 10 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 },
});
