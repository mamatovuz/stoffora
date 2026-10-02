import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Badge, Button, Card, Empty, ErrorBox, Group, GroupTitle, Hint, Icon, Loading, Row, Sheet, haptic } from "@/components/ui";
import { errorText, post } from "@/lib/api";
import { dateUz, som, tashkentIsoDate } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { AdvanceRequest, Salary } from "@/lib/types";
import { invalidate, useData } from "@/lib/useData";

/* Karta: tozalash, Luhn va ko‘rinish (server ham xuddi shunday tekshiradi). */
const digits = (v: string) => v.replace(/\D/g, "").slice(0, 16);
const pretty = (v: string) => digits(v).replace(/(\d{4})(?=\d)/g, "$1 ");
const luhn = (v: string) => {
  const d = digits(v);
  let sum = 0;
  for (let i = 0; i < d.length; i += 1) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
    sum += n;
  }
  return d.length === 16 && sum % 10 === 0;
};
const brand = (v: string) => (/^(8600|5614)/.test(v) ? "Uzcard" : /^9860/.test(v) ? "Humo" : /^4/.test(v) ? "Visa" : /^5/.test(v) ? "Mastercard" : "");
const holderOk = (v: string) => /^[\p{L}'‘’ʼ`. -]+$/u.test(v.trim()) && v.trim().split(/\s+/).length >= 2 && v.trim().length >= 5;
const STATUS: Record<AdvanceRequest["status"], [string, "warn" | "info" | "ok" | "bad" | "muted"]> = {
  PENDING: ["HR ko‘rmoqda", "warn"],
  HR_APPROVED: ["Moliyada", "info"],
  APPROVED: ["Tasdiqlandi", "ok"],
  REJECTED: ["Rad etildi", "bad"],
  CANCELLED: ["Bekor qilindi", "muted"],
};

/** «Mening oyligim» — oy davomida real vaqtda; shu yerdan avans so‘raladi (HR → Moliya). */
export default function SalaryScreen() {
  const { c } = useTheme();
  const { data, error, loading, reload } = useData<Salary>("/mini/salary", { maxAgeMs: 0 });
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox text={error || "Ma’lumot yuklanmadi"} onRetry={reload} />;
  const show = (v: number) => (visible ? som(v) : "•••");
  const progress = data.base ? Math.min(100, Math.round((data.earnedToDate / data.base) * 100)) : 0;
  const cancel = (r: AdvanceRequest) =>
    Alert.alert("Avansni bekor qilish", `${som(r.amount)} so‘rovini bekor qilasizmi?`, [
      { text: "Yo‘q", style: "cancel" },
      {
        text: "Bekor qilish",
        style: "destructive",
        onPress: () =>
          void post(`/mini/advances/${r.id}/cancel`, {})
            .then(() => reload())
            .catch((e) => Alert.alert("Xatolik", errorText(e))),
      },
    ]);
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.muted, fontSize: 13 }}>{data.closed ? `${data.label} — yopilgan` : `${data.label} · taxminan qo‘lga`}</Text>
            <Text style={{ color: c.ink, fontSize: 32, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{visible ? som(data.net) : "••• ••• so‘m"}</Text>
          </View>
          <Pressable onPress={() => setVisible((v) => !v)} hitSlop={12} accessibilityLabel={visible ? "Yashirish" : "Ko‘rsatish"}>
            <Icon name={visible ? "eye-off-outline" : "eye-outline"} size={24} color={c.muted} />
          </Pressable>
        </View>
        <View style={[st.bar, { backgroundColor: c.tint }]}>
          <View style={{ width: `${progress}%`, height: "100%", backgroundColor: c.success }} />
        </View>
        <Text style={{ color: c.muted, fontSize: 13 }}>
          Ishlab topildi: {show(data.earnedToDate)} · {data.days}/{data.workingDays} kun
        </Text>
      </Card>

      <GroupTitle>Hisob-kitob</GroupTitle>
      <Group>
        <Row label="Oklad" value={show(data.base)} />
        {data.overtimeAmount ? <Row label="Qo‘shimcha ish" value={`+${show(data.overtimeAmount)}`} /> : null}
        {data.bonus ? <Row label="Mukofot" value={`+${show(data.bonus)}`} /> : null}
        {data.lateDeduction ? <Row label={`Kechikish (${data.lateMinutes} daq)`} value={`−${show(data.lateDeduction)}`} /> : null}
        {data.absenceDeduction ? <Row label={`Kelmagan kunlar (${data.absentDays})`} value={`−${show(data.absenceDeduction)}`} /> : null}
        {data.fine ? <Row label="Jarima" value={`−${show(data.fine)}`} /> : null}
        {data.advance ? <Row label="Avans" value={`−${show(data.advance)}`} /> : null}
        <Row label="Qo‘lga (taxminan)" value={show(data.net)} last />
      </Group>
      {data.compensatedDays ? <Hint tone="ok" icon="checkmark-circle-outline">{data.compensatedDays} ta sababsiz kelmagan kun dam kunida ishlab qoplandi.</Hint> : null}
      {data.pendingOvertimeMinutes ? <Hint icon="timer-outline">{data.pendingOvertimeMinutes} daqiqa qo‘shimcha ish rahbar tasdig‘ini kutmoqda.</Hint> : null}

      {data.limit.enabled ? (
        <>
          <GroupTitle>Avans</GroupTitle>
          <Card style={{ gap: 10 }}>
            <Text style={{ color: c.ink, fontSize: 15 }}>
              Mavjud: <Text style={{ fontWeight: "700" }}>{som(data.limit.available)}</Text>
              <Text style={{ color: c.muted }}> (oylikning {data.limit.percent}%i gacha)</Text>
            </Text>
            {data.limit.closed ? <Text style={{ color: c.muted }}>Bu oy uchun avans yopilgan.</Text> : null}
            <Button title="Avans so‘rash" icon="cash-outline" disabled={data.limit.available < 10_000 || data.limit.closed} onPress={() => setOpen(true)} />
            <Text style={{ color: c.muted, fontSize: 12.5 }}>Avval HR ko‘rib chiqadi, so‘ng moliya bo‘limi to‘laydi.</Text>
          </Card>
        </>
      ) : null}

      {data.requests.length ? (
        <>
          <GroupTitle>Avans so‘rovlari</GroupTitle>
          <Group>
            {data.requests.map((r, i) => (
              <Row
                key={r.id}
                label={som(r.amount)}
                sub={`${dateUz(r.createdAt.slice(0, 10))}${r.payout?.method === "CARD" ? ` · ${r.payout.cardMask || "karta"}` : r.payout?.method === "CASH" ? " · naqd" : ""}${r.decidedNote ? ` · ${r.decidedNote}` : ""}`}
                right={<Badge text={STATUS[r.status][0]} tone={STATUS[r.status][1]} />}
                onPress={r.status === "PENDING" ? () => cancel(r) : undefined}
                last={i === data.requests.length - 1}
              />
            ))}
          </Group>
        </>
      ) : !data.limit.enabled ? (
        <Empty icon="wallet-outline" title="Avans o‘chirilgan" text="Kompaniyangizda mobil avans so‘rash yoqilmagan." />
      ) : null}

      <AdvanceSheet
        visible={open}
        data={data}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          haptic.success();
          invalidate("/mini/salary");
          void reload();
        }}
      />
    </ScrollView>
  );
}

function AdvanceSheet({ visible, data, onClose, onSaved }: { visible: boolean; data: Salary; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<"CARD" | "CASH">("CARD");
  const [useSaved, setUseSaved] = useState(Boolean(data.savedCard));
  const [card, setCard] = useState("");
  const [holder, setHolder] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const value = Number(amount.replace(/\D/g, "")) || 0;
  const cardOk = method === "CASH" || useSaved || (luhn(card) && holderOk(holder));
  const valid = value >= 10_000 && value <= data.limit.available && cardOk;
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await post("/mini/advances", {
        amount: value,
        reason: reason.trim() || undefined,
        payout: method === "CASH" ? { method } : useSaved ? { method, useSaved: true } : { method, cardNumber: digits(card), holder: holder.trim(), remember },
      });
      setAmount("");
      setCard("");
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} title="Avans so‘rash" subtitle={`Mavjud: ${som(data.limit.available)} · ${tashkentIsoDate().slice(0, 7)}`} onClose={onClose}>
      <TextInput
        value={value ? value.toLocaleString("ru-RU").replace(/\s/g, " ") : ""}
        onChangeText={setAmount}
        keyboardType="number-pad"
        placeholder="Summa, so‘m"
        placeholderTextColor={c.muted}
        style={[st.amount, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[25, 50, 100].map((p) => {
          const v = Math.floor((data.limit.available * p) / 100 / 10_000) * 10_000;
          return v >= 10_000 ? (
            <Pressable key={p} onPress={() => setAmount(String(v))} style={[st.chip, { borderColor: c.line, backgroundColor: c.card }]}>
              <Text style={{ color: c.ink }}>{p === 100 ? "Hammasi" : `${p}%`}</Text>
            </Pressable>
          ) : null;
        })}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["CARD", "CASH"] as const).map((m) => (
          <Pressable key={m} onPress={() => setMethod(m)} style={[st.method, { borderColor: method === m ? c.accent : c.line, backgroundColor: method === m ? `${c.accent}12` : c.card }]}>
            <Icon name={m === "CARD" ? "card-outline" : "cash-outline"} size={19} color={method === m ? c.accent : c.muted} />
            <Text style={{ color: c.ink, fontWeight: "600" }}>{m === "CARD" ? "Kartaga" : "Naqd"}</Text>
          </Pressable>
        ))}
      </View>
      {method === "CARD" ? (
        <>
          {data.savedCard ? (
            <Pressable onPress={() => setUseSaved((v) => !v)} style={[st.method, { borderColor: useSaved ? c.accent : c.line, backgroundColor: c.card }]}>
              <Icon name={useSaved ? "checkmark-circle" : "ellipse-outline"} size={20} color={useSaved ? c.accent : c.muted} />
              <Text style={{ color: c.ink, flex: 1 }}>
                {data.savedCard.brand} {data.savedCard.mask} · {data.savedCard.holder}
              </Text>
            </Pressable>
          ) : null}
          {!useSaved ? (
            <>
              <TextInput value={pretty(card)} onChangeText={setCard} keyboardType="number-pad" placeholder="Karta raqami (16 ta raqam)" placeholderTextColor={c.muted} maxLength={19} style={[st.input, { color: c.ink, borderColor: card && digits(card).length === 16 && !luhn(card) ? c.danger : c.line, backgroundColor: c.card }]} />
              {digits(card).length >= 4 && brand(digits(card)) ? <Text style={{ color: c.muted, fontSize: 12.5 }}>{brand(digits(card))}</Text> : null}
              {digits(card).length === 16 && !luhn(card) ? <Text style={{ color: c.danger, fontSize: 13 }}>Karta raqami noto‘g‘ri — raqamlarni tekshiring.</Text> : null}
              <TextInput value={holder} onChangeText={setHolder} autoCapitalize="characters" placeholder="Qabul qiluvchi ism-familiyasi" placeholderTextColor={c.muted} maxLength={60} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Switch value={remember} onValueChange={setRemember} />
                <Text style={{ color: c.ink }}>Kartani keyingi safar uchun eslab qolish</Text>
              </View>
            </>
          ) : null}
        </>
      ) : null}
      <TextInput value={reason} onChangeText={setReason} placeholder="Izoh (ixtiyoriy)" placeholderTextColor={c.muted} maxLength={200} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]} />
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      <Button title={value ? `So‘rash · ${som(value)}` : "So‘rash"} icon="send" busy={busy} disabled={!valid} onPress={() => void save()} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  bar: { height: 8, borderRadius: 4, overflow: "hidden" },
  amount: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, height: 58, fontSize: 24, fontWeight: "700" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1 },
  method: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
});
