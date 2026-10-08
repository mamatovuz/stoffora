import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Badge, Button, Card, Empty, ErrorBox, Group, GroupTitle, Hint, Icon, Loading, Row, Sheet, haptic } from "@/components/ui";
import { errorText, post } from "@/lib/api";
import { dateUz, duration, som, tashkentIsoDate } from "@/lib/format";
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

const shiftMonth = (m: string, d: number) => {
  const x = new Date(`${m}-15T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + d);
  return x.toISOString().slice(0, 7);
};
function MoneyLine({ label, value, tone, head, sub, strong }: { label: string; value: string; tone?: string; head?: boolean; sub?: boolean; strong?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
      <Text style={{ flex: 1, color: sub ? c.muted : c.ink, fontSize: head ? 17 : sub ? 14 : 15.5, fontWeight: head || strong ? "600" : "400" }}>{label}</Text>
      <Text style={{ color: tone || (sub ? c.muted : c.ink), fontSize: head ? 17 : sub ? 14 : 15.5, fontWeight: head || strong ? "600" : "400", fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
}

/** «Mening oyligim» — oy davomida real vaqtda; shu yerdan avans so‘raladi (HR → Moliya). */
export default function SalaryScreen() {
  const { c } = useTheme();
  const current = tashkentIsoDate().slice(0, 7);
  const [month, setMonth] = useState(current);
  const { data, error, loading, reload } = useData<Salary>(`/mini/salary?month=${month}`, { maxAgeMs: 0 });
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
      <View style={st.monthNav}>
        <Pressable onPress={() => (haptic.select(), setMonth(shiftMonth(month, -1)))} hitSlop={10} style={[st.navBtn, { backgroundColor: c.card }]}>
          <Icon name="chevron-back" size={18} color={c.ink} />
        </Pressable>
        <View style={{ alignItems: "center", gap: 4 }}>
          <Text style={{ color: c.ink, fontSize: 18, fontWeight: "600" }}>{data.label}</Text>
          <Badge text={data.stage === "PAID" ? "To‘landi" : data.closed ? "Yopilgan" : "Taxminiy hisob"} tone={data.stage === "PAID" ? "ok" : data.closed ? "info" : "warn"} />
        </View>
        <Pressable onPress={() => (haptic.select(), setMonth(shiftMonth(month, 1)))} disabled={month >= current} hitSlop={10} style={[st.navBtn, { backgroundColor: c.card, opacity: month >= current ? 0.35 : 1 }]}>
          <Icon name="chevron-forward" size={18} color={c.ink} />
        </Pressable>
      </View>

      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Icon name="stats-chart" size={20} color={c.accent} />
          <Text style={{ color: c.ink, fontSize: 15.5, fontWeight: "600", flex: 1 }}>To‘lanishi kerak</Text>
          <Pressable onPress={() => setVisible((v) => !v)} hitSlop={12} accessibilityLabel={visible ? "Yashirish" : "Ko‘rsatish"}>
            <Icon name={visible ? "eye-off-outline" : "eye-outline"} size={22} color={c.muted} />
          </Pressable>
        </View>
        <Text style={{ color: c.ink, fontSize: 30, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{visible ? som(data.payable ?? data.net) : "••• ••• so‘m"}</Text>
        <MoneyLine label="To‘landi" value={show(data.paid ?? data.advance)} />
        <MoneyLine label="Qoldi" value={show(data.remaining ?? data.net)} strong />
        {data.current ? (
          <>
            <View style={[st.bar, { backgroundColor: c.tint }]}>
              <View style={{ width: `${progress}%`, height: "100%", backgroundColor: c.success }} />
            </View>
            <Text style={{ color: c.muted, fontSize: 13 }}>
              Bugungacha ishlab topildi: {show(data.earnedToDate)} · {data.days}/{data.workingDays} kun
            </Text>
          </>
        ) : null}
      </Card>

      <Card style={{ gap: 10 }}>
        <MoneyLine label="Hisoblandi" value={show(data.accrued ?? data.base)} tone={c.success} head />
        <MoneyLine label="+ Maosh (oklad)" value={show(data.base)} sub />
        <MoneyLine label="+ Qo‘shimcha ish" value={show(data.overtimeAmount)} sub />
        <MoneyLine label="+ Mukofot" value={show(data.bonus)} sub />
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginVertical: 4 }} />
        <MoneyLine label="Ushlab qolindi" value={show(data.withheld ?? 0)} tone={c.danger} head />
        <MoneyLine label={`− Kech kelish${data.lateMinutes ? ` (${duration(data.lateMinutes)})` : ""}`} value={show(data.lateDeduction)} sub />
        <MoneyLine label={`− Kelmagan kunlar${data.absentDays ? ` (${data.absentDays})` : ""}`} value={show(data.absenceDeduction)} sub />
        <MoneyLine label="− Jarima" value={show(data.fine)} sub />
        {data.advance ? (
          <>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginVertical: 4 }} />
            <MoneyLine label="Avans (oldindan to‘langan)" value={show(data.advance)} sub />
          </>
        ) : null}
      </Card>

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Icon name="cash-outline" size={20} color={c.accent} />
          <Text style={{ color: c.ink, fontSize: 15.5, fontWeight: "600", flex: 1 }}>Maosh</Text>
          <Text style={{ color: c.muted }}>{data.workingDays} ish kuni</Text>
        </View>
        <MoneyLine label="Oklad (oylik)" value={show(data.base)} />
        <MoneyLine label="1 ish kuni" value={show(data.workingDays ? Math.round(data.base / data.workingDays) : 0)} sub />
      </Card>
      {data.compensatedDays ? <Hint tone="ok" icon="checkmark-circle-outline">{data.compensatedDays} ta sababsiz kelmagan kun dam kunida ishlab qoplandi.</Hint> : null}
      {data.pendingOvertimeMinutes ? <Hint icon="timer-outline">{duration(data.pendingOvertimeMinutes)} qo‘shimcha ish rahbar tasdig‘ini kutmoqda.</Hint> : null}

      {data.current !== false && data.limit.enabled ? (
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
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn: { width: 44, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  amount: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, height: 58, fontSize: 24, fontWeight: "700" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1 },
  method: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
});
