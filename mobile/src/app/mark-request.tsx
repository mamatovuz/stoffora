import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DateStrip, addDays } from "@/components/DateStrip";
import { TimePicker } from "@/components/TimePicker";
import { Button, Card, ErrorBox, Icon, Loading, Segmented, haptic } from "@/components/ui";
import { errorText, post } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { invalidate, useData } from "@/lib/useData";

export type MarksData = {
  items: { id: string; date: string; time: string; kind: "IN" | "OUT"; branchName: string; comment: string; status: string; decidedBy?: string; decidedNote?: string }[];
  branches: { id: string; name: string }[];
  canChooseBranch: boolean;
  homeBranchId: string;
  minDate: string;
  today: string;
  now: string;
};

/**
 * Belgilash so‘rovi: kirish yoki chiqishni belgilash esdan chiqqan bo‘lsa — sana, vaqt, Kirish/Chiqish,
 * filial (lavozimda ruxsat bo‘lsa tanlanadi) va izoh. HR tasdiqlasa — davomatga yoziladi.
 */
export default function MarkRequest() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, error, reload } = useData<MarksData>("/mini/corrections", { maxAgeMs: 0 });
  const [kind, setKind] = useState<"IN" | "OUT">("OUT");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [branchId, setBranchId] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState("");

  useEffect(() => {
    if (!data) return;
    setDate((d) => d || data.today);
    setBranchId((b) => b || data.homeBranchId || data.branches[0]?.id || "");
  }, [data]);
  // Oxirgi 31 kun — bugundan orqaga.
  const days = useMemo(() => {
    if (!data) return [];
    const list: string[] = [];
    for (let d = data.today; d >= data.minDate; d = addDays(d, -1)) list.push(d);
    return list;
  }, [data]);
  const max = data && date === data.today ? data.now : undefined;
  useEffect(() => {
    if (max && time > max) setTime("");
  }, [max, time]);
  const valid = Boolean(date && time && branchId && comment.trim().length >= 3);

  const send = async () => {
    setBusy(true);
    setSendError("");
    try {
      await post("/mini/corrections", { date, time, kind, branchId: data?.canChooseBranch ? branchId : undefined, comment: comment.trim() });
      haptic.success();
      invalidate("/mini/corrections");
      router.back();
    } catch (e) {
      haptic.error();
      setSendError(errorText(e, "So‘rov yuborilmadi."));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <View style={{ flex: 1, backgroundColor: c.bg, padding: 16 }}>{error ? <ErrorBox text={error} onRetry={reload} /> : <Loading />}</View>;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Segmented<"IN" | "OUT">
          value={kind}
          onChange={setKind}
          options={[
            ["IN", "Kirish"],
            ["OUT", "Chiqish"],
          ]}
        />
        <Card style={{ gap: 10 }}>
          <Head icon="calendar-outline" text="Sana" />
          <DateStrip value={date} onChange={setDate} dates={days} />
        </Card>
        <Card style={{ gap: 6 }}>
          <Head icon="time-outline" text={kind === "IN" ? "Kirish vaqti" : "Chiqish vaqti"} />
          <TimePicker value={time} onChange={setTime} max={max} />
        </Card>
        <Card style={{ gap: 4, paddingVertical: 12 }}>
          <Head icon="business-outline" text="Filial" />
          {data.canChooseBranch ? (
            data.branches.map((b, i) => (
              <Pressable
                key={b.id}
                onPress={() => {
                  haptic.select();
                  setBranchId(b.id);
                }}
                style={[st.option, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}
              >
                <Text style={{ flex: 1, color: c.ink, fontSize: 16 }}>{b.name}</Text>
                <Icon name={branchId === b.id ? "radio-button-on" : "radio-button-off"} size={22} color={branchId === b.id ? c.accent : c.muted} />
              </Pressable>
            ))
          ) : (
            <Text style={{ color: c.ink, fontSize: 16, paddingVertical: 8 }}>{data.branches.find((b) => b.id === branchId)?.name || "—"}</Text>
          )}
        </Card>
        <Card style={{ gap: 10 }}>
          <Head icon="chatbox-ellipses-outline" text="Izoh" />
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Masalan: kechqurun chiqishni belgilash esimdan chiqibdi"
            placeholderTextColor={c.muted}
            multiline
            maxLength={500}
            style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.bg }]}
          />
        </Card>
        {sendError ? <Text style={{ color: c.danger, fontSize: 14 }}>{sendError}</Text> : null}
      </ScrollView>
      <View style={[st.footer, { paddingBottom: insets.bottom + 10, borderTopColor: c.line, backgroundColor: c.bg }]}>
        <Button title="Yuborish" icon="send" busy={busy} disabled={!valid} onPress={() => void send()} />
      </View>
    </KeyboardAvoidingView>
  );
}

function Head({ icon, text }: { icon: "calendar-outline" | "time-outline" | "business-outline" | "chatbox-ellipses-outline"; text: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Icon name={icon} size={18} color={c.accent} />
      <Text style={{ color: c.ink, fontWeight: "600", fontSize: 15 }}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  option: { flexDirection: "row", alignItems: "center", minHeight: 48 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5, minHeight: 90, textAlignVertical: "top" },
  footer: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
