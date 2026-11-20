import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text, TextInput } from "@/components/T";
import { errorText, post } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { Button, Sheet } from "./ui";

const MINUTES = [10, 15, 30, 60];
const REASONS = ["Tirbandlik", "Transport", "Sog‘liq", "Oilaviy sabab"];

/** «Kechikaman» — rahbarni oldindan ogohlantirish (Bo‘limlar → Davomat). */
export function LateSheet({ visible, start, onClose, onSaved }: { visible: boolean; start: string; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const [minutes, setMinutes] = useState(15);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await post("/mini/late-notice", { minutes, reason: reason.trim() });
      setReason("");
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} title="Kechikish haqida xabar" subtitle={start ? `Ish boshlanishi: ${start}` : undefined} onClose={onClose}>
      <View style={st.row}>
        {MINUTES.map((m) => (
          <Pressable key={m} onPress={() => setMinutes(m)} style={[st.chip, { borderColor: minutes === m ? c.accent : c.line, backgroundColor: minutes === m ? `${c.accent}18` : c.card }]}>
            <Text style={{ color: minutes === m ? c.accent : c.ink, fontWeight: "600" }}>{m} daq</Text>
          </Pressable>
        ))}
      </View>
      <View style={[st.row, { flexWrap: "wrap" }]}>
        {REASONS.map((t) => (
          <Pressable key={t} onPress={() => setReason(t)} style={[st.chip, { borderColor: c.line, backgroundColor: reason === t ? c.tint : c.card }]}>
            <Text style={{ color: c.ink, fontSize: 13.5 }}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={reason} onChangeText={setReason} placeholder="Sabab" placeholderTextColor={c.muted} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]} maxLength={200} />
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      <Button title="Rahbarni ogohlantirish" icon="send" busy={busy} disabled={reason.trim().length < 3} onPress={() => void send()} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5 },
});
