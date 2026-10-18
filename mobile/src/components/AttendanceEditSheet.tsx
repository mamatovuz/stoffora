import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text, TextInput } from "@/components/T";
import { errorText } from "@/lib/api";
import { dateLongUz } from "@/lib/format";
import { typo, useTheme } from "@/lib/theme";
import { Button, Hint, Sheet, haptic } from "./ui";

/*
 * Davomatni qo‘lda tuzatish (rahbar / HR, xodim taqvimidan) — saytdagi bilan bir xil:
 * kelish/ketish vaqti (aniq daqiqa bilan) va sabab. Qayd bo‘lsa — tahrir (PUT), bo‘lmasa — yangi (POST).
 * Kechikish va ishlangan vaqt serverda grafik bo‘yicha qayta hisoblanadi; o‘zgarish audit jurnaliga yoziladi.
 */

export type EditTarget = {
  employeeId: string;
  employeeName: string;
  date: string;
  plan?: string;
  record?: { id: string; checkIn?: string; checkOut?: string };
};
type Save = (path: string, body: unknown, method: "POST" | "PUT") => Promise<unknown>;

/** «905» → «09:05», «1800» → «18:00»; noto‘g‘ri — null. */
export function normalizeClock(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const [h, m] = digits.length <= 2 ? [digits, "0"] : digits.length === 3 ? [digits.slice(0, 1), digits.slice(1)] : [digits.slice(0, 2), digits.slice(2, 4)];
  const hour = Number(h);
  const minute = Number(m);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function ClockField({ label, value, onChange, optional }: { label: string; value: string; onChange: (v: string) => void; optional?: boolean }) {
  const { c } = useTheme();
  const [text, setText] = useState(value);
  const commit = () => {
    if (!text.trim()) return onChange("");
    const clock = normalizeClock(text);
    setText(clock || "");
    onChange(clock || "");
  };
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Text style={[typo.sub, { color: c.muted, fontWeight: "600" }]}>{label}</Text>
      <TextInput
        value={text}
        onChangeText={(v) => {
          // Raqam kiritilgani sari «09:05» ko‘rinishiga keltiriladi.
          const d = v.replace(/\D/g, "").slice(0, 4);
          setText(d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d);
        }}
        onBlur={commit}
        onEndEditing={commit}
        keyboardType="number-pad"
        maxLength={5}
        placeholder={optional ? "—" : "09:00"}
        placeholderTextColor={c.muted}
        style={[st.clock, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
      />
    </View>
  );
}

export function AttendanceEditSheet({ target, save, onClose, onSaved }: { target: EditTarget | null; save: Save; onClose: () => void; onSaved: () => void }) {
  // Har yangi kun/qayd uchun forma boshidan (key bilan qayta yaratiladi).
  if (!target) return null;
  return <EditForm key={`${target.employeeId}:${target.date}:${target.record?.id || "new"}`} target={target} save={save} onClose={onClose} onSaved={onSaved} />;
}

function EditForm({ target, save, onClose, onSaved }: { target: EditTarget; save: Save; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const [checkIn, setCheckIn] = useState(target.record?.checkIn || "");
  const [checkOut, setCheckOut] = useState(target.record?.checkOut || "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(target.record?.id);

  const submit = async () => {
    const inClock = normalizeClock(checkIn);
    const outClock = checkOut ? normalizeClock(checkOut) : "";
    if (!inClock) return setError("Kelish vaqtini kiriting (masalan 09:05).");
    if (outClock === null) return setError("Ketish vaqti noto‘g‘ri.");
    if (reason.trim().length < 3) return setError("Sababni yozing — u audit jurnalida saqlanadi.");
    setBusy(true);
    setError("");
    try {
      const note = `Tuzatildi: ${reason.trim()}`;
      if (editing) await save(`/attendance/${target.record!.id}`, { checkIn: inClock, checkOut: outClock || "", note }, "PUT");
      else await save("/attendance", { employeeId: target.employeeId, date: target.date, checkIn: inClock, checkOut: outClock || "", note }, "POST");
      haptic.success();
      onSaved();
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible title={editing ? "Davomatni tuzatish" : "Davomat kiritish"} subtitle={`${target.employeeName} · ${dateLongUz(new Date(`${target.date}T07:00:00Z`))}`} onClose={onClose}>
      <View style={[st.plan, { backgroundColor: c.tint }]}>
        <Text style={[typo.sub, { color: c.muted }]}>Grafik</Text>
        <Text style={[typo.bodyStrong, { color: c.ink }]}>{target.plan || "Dam olish kuni"}</Text>
        {target.record?.checkIn ? (
          <>
            <Text style={[typo.sub, { color: c.muted, marginLeft: 12 }]}>Hozir</Text>
            <Text style={[typo.bodyStrong, { color: c.ink }]}>
              {target.record.checkIn}–{target.record.checkOut || "…"}
            </Text>
          </>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <ClockField label="Keldi" value={checkIn} onChange={setCheckIn} />
        <ClockField label="Ketdi" value={checkOut} onChange={setCheckOut} optional />
      </View>
      <View style={{ gap: 6 }}>
        <Text style={[typo.sub, { color: c.muted, fontWeight: "600" }]}>Sabab</Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          maxLength={200}
          placeholder="Masalan: Face ID ishlamadi, rahbar tasdiqladi"
          placeholderTextColor={c.muted}
          style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
        />
      </View>
      <Hint icon="time-outline">Kechikish va ishlangan vaqt grafik bo‘yicha qayta hisoblanadi. O‘zgarish (oldin → keyin) audit jurnaliga yoziladi.</Hint>
      {error ? (
        <Hint tone="bad" icon="alert-circle">
          {error}
        </Hint>
      ) : null}
      <Button title={editing ? "Saqlash" : "Kiritish"} icon="checkmark" busy={busy} onPress={() => void submit()} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  plan: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, flexWrap: "wrap" },
  clock: { height: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 22, fontWeight: "700", textAlign: "center", fontVariant: ["tabular-nums"] },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
});
