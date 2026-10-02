import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Badge, Button, Empty, ErrorBox, Group, Icon, Loading, Row, Segmented, Sheet, haptic } from "@/components/ui";
import { errorText, post } from "@/lib/api";
import { openFile } from "@/lib/download";
import { timeAgo } from "@/lib/format";
import { ios, useTheme } from "@/lib/theme";
import { useData } from "@/lib/useData";

type View3 = "questions" | "certificates" | "feedback";
type Message = { id: string; from: "EMPLOYEE" | "HR"; author?: string; text: string; at: string };
type Ticket = { id: string; kind: "QUESTION" | "FEEDBACK"; anonymous: boolean; category: string; subject: string; status: "OPEN" | "ANSWERED" | "CLOSED"; messages: Message[]; unread: boolean; createdAt: string; updatedAt: string };
type Cert = { id: string; type: string; purpose: string; note?: string; status: "PENDING" | "READY" | "REJECTED"; documentId?: string; decidedNote?: string; createdAt: string };
const STATUS: Record<string, [string, "warn" | "ok" | "muted" | "bad" | "info"]> = {
  OPEN: ["Javob kutilmoqda", "warn"],
  ANSWERED: ["Javob berildi", "ok"],
  CLOSED: ["Yopilgan", "muted"],
  PENDING: ["Tayyorlanmoqda", "warn"],
  READY: ["Tayyor", "ok"],
  REJECTED: ["Rad etildi", "bad"],
};

/** HR bilan aloqa: savollar, ma’lumotnoma (spravka) va taklif/shikoyat (anonim mumkin). */
export default function Helpdesk() {
  const params = useLocalSearchParams<{ view?: View3 }>();
  const navigation = useNavigation();
  const { c } = useTheme();
  const [view, setView] = useState<View3>(params.view || "questions");
  useLayoutEffect(() => {
    navigation.setOptions({ title: view === "certificates" ? "Ma’lumotnoma" : view === "feedback" ? "Taklif va shikoyat" : "HR’ga savol" });
  }, [navigation, view]);
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <Segmented<View3>
        value={view}
        onChange={setView}
        options={[
          ["questions", "Savollar"],
          ["certificates", "Spravka"],
          ["feedback", "Taklif"],
        ]}
      />
      {view === "certificates" ? <Certificates /> : <Tickets kind={view === "feedback" ? "FEEDBACK" : "QUESTION"} />}
    </ScrollView>
  );
}

function Tickets({ kind }: { kind: "QUESTION" | "FEEDBACK" }) {
  const { c } = useTheme();
  const { data, error, reload } = useData<{ categories: Record<string, string>; items: Ticket[] }>("/mini/tickets");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const items = (data?.items || []).filter((t) => t.kind === kind);
  const open = items.find((t) => t.id === openId) || null;
  return (
    <>
      <Button title={kind === "QUESTION" ? "Savol berish" : "Taklif yoki shikoyat yozish"} icon="create-outline" onPress={() => setCreating(true)} />
      {kind === "FEEDBACK" ? (
        <Text style={{ color: c.muted, fontSize: 13, lineHeight: 18 }}>Anonim yozsangiz, ismingiz HR’ga ko‘rinmaydi — lekin javobni shu yerda o‘qiysiz.</Text>
      ) : null}
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      {!data ? (
        <Loading />
      ) : !items.length ? (
        <Empty icon={kind === "QUESTION" ? "chatbubbles-outline" : "bulb-outline"} title={kind === "QUESTION" ? "Savollar yo‘q" : "Murojaatlar yo‘q"} text={kind === "QUESTION" ? "Ish haqi, grafik, ta’til — HR’ga yozing, javob bildirishnoma bo‘lib keladi." : "G‘oya, taklif yoki muammo haqida yozing."} />
      ) : (
        <Group>
          {items.map((t, i) => (
            <Row
              key={t.id}
              icon={t.unread ? "mail-unread" : "chatbubble-ellipses"}
              iconColor={t.unread ? c.danger : undefined}
              label={t.subject}
              sub={`${data.categories[t.category] || t.category}${t.anonymous ? " · anonim" : ""} · ${timeAgo(t.updatedAt)}`}
              right={<Badge text={STATUS[t.status][0]} tone={STATUS[t.status][1]} />}
              onPress={() => setOpenId(t.id)}
              last={i === items.length - 1}
            />
          ))}
        </Group>
      )}
      {data ? (
        <NewTicket
          visible={creating}
          kind={kind}
          categories={data.categories}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            haptic.success();
            void reload();
          }}
        />
      ) : null}
      <TicketChat ticket={open} onClose={() => setOpenId(null)} onChanged={() => void reload()} />
    </>
  );
}

function NewTicket({ visible, kind, categories, onClose, onSaved }: { visible: boolean; kind: "QUESTION" | "FEEDBACK"; categories: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const [category, setCategory] = useState(kind === "FEEDBACK" ? "IDEA" : "SALARY");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setCategory(kind === "FEEDBACK" ? "IDEA" : "SALARY"), [kind]);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await post("/mini/tickets", { kind, category, subject: subject.trim(), text: text.trim(), anonymous: kind === "FEEDBACK" && anonymous });
      setSubject("");
      setText("");
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} title={kind === "QUESTION" ? "HR’ga savol" : "Taklif yoki shikoyat"} subtitle="Javob bildirishnoma bo‘lib keladi" onClose={onClose}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {Object.entries(categories).map(([k, l]) => (
          <Pressable key={k} onPress={() => setCategory(k)} style={[st.chip, { borderColor: category === k ? c.accent : c.line, backgroundColor: category === k ? `${c.accent}18` : c.card }]}>
            <Text style={{ color: category === k ? c.accent : c.ink, fontSize: 13.5 }}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={subject} onChangeText={setSubject} placeholder="Mavzu" placeholderTextColor={c.muted} maxLength={120} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]} />
      <TextInput value={text} onChangeText={setText} placeholder="Batafsil yozing" placeholderTextColor={c.muted} multiline maxLength={2000} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card, minHeight: 110, textAlignVertical: "top" }]} />
      {kind === "FEEDBACK" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Switch value={anonymous} onValueChange={setAnonymous} />
          <Text style={{ color: c.ink, flex: 1 }}>Anonim yuborish</Text>
        </View>
      ) : null}
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      <Button title="Yuborish" icon="send" busy={busy} disabled={subject.trim().length < 3 || text.trim().length < 5} onPress={() => void save()} />
    </Sheet>
  );
}

function TicketChat({ ticket, onClose, onChanged }: { ticket: Ticket | null; onClose: () => void; onChanged: () => void }) {
  const { c } = useTheme();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (ticket?.unread) void post(`/mini/tickets/${ticket.id}/read`, {}).then(onChanged).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id]);
  if (!ticket) return null;
  const send = async () => {
    setBusy(true);
    try {
      await post(`/mini/tickets/${ticket.id}/messages`, { text: text.trim() });
      setText("");
      haptic.success();
      onChanged();
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () =>
    Alert.alert("Murojaatni yopish", "Savolingizga javob oldingizmi?", [
      { text: "Yo‘q", style: "cancel" },
      {
        text: "Yopish",
        onPress: () =>
          void post(`/mini/tickets/${ticket.id}/close`, {})
            .then(() => {
              onChanged();
              onClose();
            })
            .catch((e) => Alert.alert("Xatolik", errorText(e))),
      },
    ]);
  return (
    <Sheet visible title={ticket.subject} subtitle={STATUS[ticket.status][0]} onClose={onClose}>
      <KeyboardAvoidingView behavior={ios ? "padding" : undefined} style={{ gap: 10 }}>
        {ticket.messages.map((m) => {
          const mine = m.from === "EMPLOYEE";
          return (
            <View key={m.id} style={[st.bubble, mine ? { alignSelf: "flex-end", backgroundColor: c.accent } : { alignSelf: "flex-start", backgroundColor: c.card }]}>
              {!mine ? <Text style={{ color: c.accent, fontSize: 12, fontWeight: "600" }}>{m.author || "HR"}</Text> : null}
              <Text style={{ color: mine ? "#fff" : c.ink, fontSize: 15, lineHeight: 20 }}>{m.text}</Text>
              <Text style={{ color: mine ? "rgba(255,255,255,0.75)" : c.muted, fontSize: 11, alignSelf: "flex-end" }}>{timeAgo(m.at)}</Text>
            </View>
          );
        })}
        {ticket.status !== "CLOSED" ? (
          <>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
              <TextInput value={text} onChangeText={setText} placeholder="Xabar yozing" placeholderTextColor={c.muted} multiline maxLength={2000} style={[st.input, { flex: 1, color: c.ink, borderColor: c.line, backgroundColor: c.card }]} />
              <Pressable disabled={!text.trim() || busy} onPress={() => void send()} style={[st.send, { backgroundColor: text.trim() ? c.accent : c.tint }]} accessibilityLabel="Yuborish">
                <Icon name="arrow-up" size={20} color="#fff" />
              </Pressable>
            </View>
            <Pressable onPress={close} style={{ alignSelf: "center", padding: 6 }}>
              <Text style={{ color: c.muted }}>Murojaatni yopish</Text>
            </Pressable>
          </>
        ) : null}
      </KeyboardAvoidingView>
    </Sheet>
  );
}

function Certificates() {
  const { c } = useTheme();
  const { data, error, reload } = useData<{ types: Record<string, string>; items: Cert[] }>("/mini/certificates");
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("WORK");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const save = async () => {
    setBusy(true);
    setFormError("");
    try {
      await post("/mini/certificates", { type, purpose: purpose.trim() });
      setPurpose("");
      setOpen(false);
      haptic.success();
      void reload();
    } catch (e) {
      setFormError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button title="Ma’lumotnoma so‘rash" icon="document-text-outline" onPress={() => setOpen(true)} />
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      {!data ? (
        <Loading />
      ) : !data.items.length ? (
        <Empty icon="document-text-outline" title="So‘rovlar yo‘q" text="Ish joyidan, ish haqi yoki viza uchun ma’lumotnoma so‘rang — HR tayyorlagach shu yerdan yuklab olasiz." />
      ) : (
        <Group>
          {data.items.map((r, i) => (
            <Row
              key={r.id}
              icon="document-text"
              iconColor={r.status === "READY" ? c.success : undefined}
              label={data.types[r.type] || r.type}
              sub={r.decidedNote ? `${r.purpose} · ${r.decidedNote}` : r.purpose}
              right={<Badge text={STATUS[r.status][0]} tone={STATUS[r.status][1]} />}
              onPress={r.status === "READY" && r.documentId ? () => void openFile({ kind: "document", id: r.documentId! }).catch((e) => Alert.alert("Xatolik", errorText(e))) : undefined}
              last={i === data.items.length - 1}
            />
          ))}
        </Group>
      )}
      {data ? (
        <Sheet visible={open} title="Ma’lumotnoma so‘rash" subtitle="HR tayyorlagach bildirishnoma keladi" onClose={() => setOpen(false)}>
          <View style={{ gap: 8 }}>
            {Object.entries(data.types).map(([k, l]) => (
              <Pressable key={k} onPress={() => setType(k)} style={[st.option, { borderColor: type === k ? c.accent : c.line, backgroundColor: type === k ? `${c.accent}12` : c.card }]}>
                <Icon name={type === k ? "radio-button-on" : "radio-button-off"} size={20} color={type === k ? c.accent : c.muted} />
                <Text style={{ color: c.ink, fontSize: 15, flex: 1 }}>{l}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput value={purpose} onChangeText={setPurpose} placeholder="Qayerga kerak? (masalan, bank uchun)" placeholderTextColor={c.muted} maxLength={200} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]} />
          {formError ? <Text style={{ color: c.danger }}>{formError}</Text> : null}
          <Button title="So‘rov yuborish" icon="send" busy={busy} disabled={purpose.trim().length < 3} onPress={() => void save()} />
        </Sheet>
      ) : null}
    </>
  );
}

const st = StyleSheet.create({
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15.5 },
  bubble: { maxWidth: "85%", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, gap: 3 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  option: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
});
