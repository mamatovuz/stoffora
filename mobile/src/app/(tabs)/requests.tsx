import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { DateStrip, addDays } from "@/components/DateStrip";
import { Badge, Button, Card, Empty, ErrorBox, Group, GroupTitle, Hint, Icon, Loading, Screen, Segmented, Sheet, haptic, type IconName } from "@/components/ui";
import { errorText, patch, post } from "@/lib/api";
import { WEEKDAYS, WEEKDAYS_SHORT, dateUz, tashkentIsoDate } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { invalidate, useData } from "@/lib/useData";

type Tab = "leave" | "swap" | "dayoff" | "overtime";
const LEAVE_TYPES: [string, string][] = [
  ["VACATION", "Mehnat ta’tili"],
  ["SICK", "Kasallik"],
  ["PERMISSION", "Ruxsat (javob)"],
  ["UNPAID", "Haq to‘lanmaydigan"],
  ["OTHER", "Boshqa"],
];
const leaveLabel = (t: string) => LEAVE_TYPES.find(([k]) => k === t)?.[1] || t;
const STATUS: Record<string, [string, "warn" | "ok" | "bad" | "muted"]> = {
  PENDING: ["Kutilmoqda", "warn"],
  APPROVED: ["Tasdiqlandi", "ok"],
  REJECTED: ["Rad etildi", "bad"],
  CANCELLED: ["Bekor qilindi", "muted"],
  PENDING_COLLEAGUE: ["Hamkasb javobi", "warn"],
  PENDING_MANAGER: ["Rahbar tasdig‘i", "warn"],
};
const confirm = (title: string, message: string, ok = "Ha") =>
  new Promise<boolean>((resolve) =>
    Alert.alert(title, message, [
      { text: "Yo‘q", style: "cancel", onPress: () => resolve(false) },
      { text: ok, style: "destructive", onPress: () => resolve(true) },
    ]),
  );

/** So‘rovlar — Mini App’dagi «So‘rovlar» bo‘limi: ta’til, smena almashish, dam kuni, qo‘shimcha ish. */
export default function Requests() {
  const params = useLocalSearchParams<{ view?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.view || "leave");
  useEffect(() => {
    if (params.view) setTab(params.view);
  }, [params.view]);
  return (
    <Screen title="So‘rovlar">
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          ["leave", "Ta’til"],
          ["swap", "Smena"],
          ["dayoff", "Dam kuni"],
          ["overtime", "Qo‘shimcha"],
        ]}
      />
      {tab === "leave" ? <LeaveTab /> : tab === "swap" ? <SwapTab /> : tab === "dayoff" ? <DayOffTab /> : <OvertimeTab />}
    </Screen>
  );
}

function ListRow({ icon, title, sub, extra, badge, onCancel, last }: { icon: IconName; title: string; sub?: string; extra?: string; badge: string; onCancel?: () => void; last?: boolean }) {
  const { c } = useTheme();
  const [label, tone] = STATUS[badge] || [badge, "muted" as const];
  return (
    <View style={[st.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
      <View style={[st.rowIcon, { backgroundColor: `${c.accent}14` }]}>
        <Icon name={icon} size={18} color={c.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.ink, fontWeight: "600", fontSize: 15 }}>{title}</Text>
        {sub ? <Text style={{ color: c.muted, fontSize: 13 }}>{sub}</Text> : null}
        {extra ? <Text style={{ color: c.muted, fontSize: 13 }}>{extra}</Text> : null}
        {onCancel ? (
          <Pressable onPress={onCancel} hitSlop={8} style={{ marginTop: 4 }}>
            <Text style={{ color: c.danger, fontSize: 13.5, fontWeight: "500" }}>Bekor qilish</Text>
          </Pressable>
        ) : null}
      </View>
      <Badge text={label} tone={tone} />
    </View>
  );
}

/* --------------------------------------------------------------- ta’til --- */
type Leave = { id: string; type: string; startDate: string; endDate: string; status: string; decidedBy?: string; documentId?: string; reason?: string };

function LeaveTab() {
  const { data, error, reload } = useData<Leave[]>("/mini/leave");
  const [open, setOpen] = useState(false);
  const cancel = async (item: Leave) => {
    if (!(await confirm("So‘rovni bekor qilish", `${dateUz(item.startDate)} – ${dateUz(item.endDate)} so‘rovini bekor qilasizmi?`, "Bekor qilish"))) return;
    try {
      await patch(`/mini/leave/${item.id}/cancel`);
      haptic.success();
      void reload();
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    }
  };
  return (
    <>
      <Button title="Yangi so‘rov" icon="add-circle-outline" onPress={() => setOpen(true)} />
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      {!data ? (
        <Loading />
      ) : !data.length ? (
        <Empty icon="airplane-outline" title="Hali so‘rov yubormagansiz" text="Ta’til, kasallik yoki ruxsat so‘rovini yuboring — javob bildirishnoma bo‘lib keladi." />
      ) : (
        <Group>
          {data.map((item, i) => (
            <ListRow
              key={item.id}
              icon="airplane"
              title={`${leaveLabel(item.type)}${item.documentId ? " 📎" : ""}`}
              sub={`${dateUz(item.startDate)} – ${dateUz(item.endDate)}${item.decidedBy && item.status !== "PENDING" ? ` · ${item.decidedBy}` : ""}`}
              badge={item.status}
              onCancel={item.status === "PENDING" ? () => void cancel(item) : undefined}
              last={i === data.length - 1}
            />
          ))}
        </Group>
      )}
      <LeaveSheet
        visible={open}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          haptic.success();
          invalidate("/mini/home");
          void reload();
        }}
      />
    </>
  );
}

function LeaveSheet({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const today = tashkentIsoDate();
  const [type, setType] = useState("VACATION");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1);
  const valid = reason.trim().length >= 3 && end >= start;

  const pick = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(camera ? "Kameraga ruxsat berilmagan." : "Galereyaga ruxsat berilmagan.");
    const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const ctx = ImageManipulator.manipulate(result.assets[0].uri).resize({ width: 1400 });
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
    if (saved.base64) setFile(`data:image/jpeg;base64,${saved.base64}`);
    haptic.success();
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await post("/mini/leave", { type, startDate: start, endDate: end, reason: reason.trim(), attachment: file || undefined }, 40_000);
      setReason("");
      setFile(null);
      onSaved();
    } catch (e) {
      haptic.error();
      setError(errorText(e, "So‘rov yuborilmadi."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} title="Ta’til so‘rovi" subtitle="HR ko‘rib chiqadi, javob bildirishnoma bo‘lib keladi" onClose={onClose}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {LEAVE_TYPES.map(([k, l]) => (
          <Pressable key={k} onPress={() => setType(k)} style={[st.chip, { borderColor: type === k ? c.accent : c.line, backgroundColor: type === k ? `${c.accent}18` : c.card }]}>
            <Text style={{ color: type === k ? c.accent : c.ink, fontWeight: type === k ? "600" : "400" }}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[st.label, { color: c.muted }]}>Boshlanish</Text>
      <DateStrip
        value={start}
        from={type === "SICK" ? addDays(today, -14) : today}
        days={type === "SICK" ? 74 : 120}
        onChange={(d) => {
          setStart(d);
          if (end < d) setEnd(d);
        }}
      />
      <Text style={[st.label, { color: c.muted }]}>Tugash · {days} kun</Text>
      <DateStrip value={end} from={start} days={90} onChange={setEnd} />
      <TextInput value={reason} onChangeText={setReason} placeholder="Sabab — qisqacha yozing" placeholderTextColor={c.muted} multiline style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]} maxLength={1000} />
      {file ? (
        <View style={[st.file, { backgroundColor: c.tint }]}>
          <Icon name="attach" size={18} color={c.accent} />
          <Text style={{ flex: 1, color: c.ink }}>Hujjat rasmi biriktirildi</Text>
          <Pressable onPress={() => setFile(null)} hitSlop={10}>
            <Icon name="close-circle" size={20} color={c.muted} />
          </Pressable>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title={type === "SICK" ? "Varaqani rasmga olish" : "Rasmga olish"} icon="camera-outline" tone="soft" onPress={() => void pick(true)} style={{ flex: 1, height: 44 }} />
          <Button title="Galereya" icon="images-outline" tone="soft" onPress={() => void pick(false)} style={{ flex: 0, paddingHorizontal: 14, height: 44 }} />
        </View>
      )}
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      <Button title={`Yuborish · ${days} kun`} icon="send" busy={busy} disabled={!valid} onPress={() => void save()} />
    </Sheet>
  );
}

/* ------------------------------------------------------ smena almashish --- */
type Swap = { id: string; status: string; giveDate: string; takeDate?: string; reason?: string; requesterName: string; colleagueName: string; giveShift?: string; incoming: boolean };

function SwapTab() {
  const { c } = useTheme();
  const { data, error, reload } = useData<{ swaps: Swap[]; colleagues: { id: string; name: string }[] }>("/mini/swaps");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, path: string, body: object, ask?: string) => {
    if (ask && !(await confirm("Tasdiqlang", ask))) return;
    setBusy(id);
    try {
      await post(`/mini/swaps/${id}/${path}`, body);
      haptic.success();
      void reload();
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const incoming = data?.swaps.filter((s) => s.incoming && s.status === "PENDING_COLLEAGUE") || [];
  const rest = data?.swaps.filter((s) => !(s.incoming && s.status === "PENDING_COLLEAGUE")) || [];
  return (
    <>
      <Button title="Smenani almashtirish" icon="swap-horizontal" onPress={() => setOpen(true)} disabled={!data?.colleagues.length} />
      {data && !data.colleagues.length ? <Text style={{ color: c.muted, fontSize: 13 }}>Filialingizda boshqa xodim yo‘q.</Text> : null}
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      {incoming.map((s) => (
        <Card key={s.id} style={{ gap: 10, borderWidth: 1, borderColor: `${c.warn}55` }}>
          <Text style={{ color: c.warn, fontWeight: "700", fontSize: 13 }}>SIZGA SO‘ROV KELDI</Text>
          <Text style={{ color: c.ink, fontSize: 15, lineHeight: 21 }}>
            <Text style={{ fontWeight: "700" }}>{s.requesterName}</Text> {dateUz(s.giveDate)}
            {s.giveShift ? ` (${s.giveShift})` : ""} kuni o‘rniga ishlashingizni so‘ramoqda
            {s.takeDate ? `, evaziga ${dateUz(s.takeDate)} kuni sizning o‘rningizga chiqadi` : ""}.
          </Text>
          {s.reason ? <Text style={{ color: c.muted }}>«{s.reason}»</Text> : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Roziman" icon="checkmark" busy={busy === s.id} onPress={() => void act(s.id, "respond", { accept: true })} style={{ flex: 1 }} />
            <Button title="Yo‘q" tone="ghost" onPress={() => void act(s.id, "respond", { accept: false }, `${s.requesterName} so‘rovini rad etasizmi?`)} style={{ flex: 0, minWidth: 90 }} />
          </View>
        </Card>
      ))}
      {!data ? (
        <Loading />
      ) : !rest.length ? (
        <Empty icon="swap-horizontal" title="Almashishlar yo‘q" text="Hamkasbingiz bilan smena almashing — u rozi bo‘lgach, rahbar tasdiqlaydi." />
      ) : (
        <Group>
          {rest.map((s, i) => (
            <ListRow
              key={s.id}
              icon="swap-horizontal"
              title={s.incoming ? s.requesterName : s.colleagueName}
              sub={`${dateUz(s.giveDate)} — ${s.incoming ? "siz ishlaysiz" : "hamkasb ishlaydi"}`}
              extra={s.takeDate ? `${dateUz(s.takeDate)} — ${s.incoming ? "hamkasb ishlaydi" : "siz ishlaysiz"}` : undefined}
              badge={s.status}
              onCancel={!s.incoming && ["PENDING_COLLEAGUE", "PENDING_MANAGER"].includes(s.status) ? () => void act(s.id, "cancel", {}, "Smena almashish so‘rovini bekor qilasizmi?") : undefined}
              last={i === rest.length - 1}
            />
          ))}
        </Group>
      )}
      {data ? (
        <SwapSheet
          visible={open}
          colleagues={data.colleagues}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            haptic.success();
            void reload();
          }}
        />
      ) : null}
    </>
  );
}

function SwapSheet({ visible, colleagues, onClose, onSaved }: { visible: boolean; colleagues: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const today = tashkentIsoDate();
  const [colleagueId, setColleague] = useState("");
  const [give, setGive] = useState(today);
  const [exchange, setExchange] = useState(false);
  const [take, setTake] = useState(addDays(today, 1));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await post("/mini/swaps", { colleagueId, giveDate: give, takeDate: exchange ? take : "", reason: reason.trim() });
      onSaved();
    } catch (e) {
      setError(errorText(e, "So‘rov yuborilmadi."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} title="Smena almashish" subtitle="Hamkasb rozi bo‘lgach, rahbar tasdiqlaydi" onClose={onClose}>
      <Text style={[st.label, { color: c.muted }]}>Hamkasb</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {colleagues.map((p) => (
          <Pressable key={p.id} onPress={() => setColleague(p.id)} style={[st.chip, { borderColor: colleagueId === p.id ? c.accent : c.line, backgroundColor: colleagueId === p.id ? `${c.accent}18` : c.card }]}>
            <Text style={{ color: colleagueId === p.id ? c.accent : c.ink }}>{p.name}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[st.label, { color: c.muted }]}>Men bermoqchi bo‘lgan ish kunim</Text>
      <DateStrip value={give} onChange={setGive} days={45} />
      <Pressable onPress={() => setExchange((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name={exchange ? "checkbox" : "square-outline"} size={22} color={c.accent} />
        <Text style={{ color: c.ink, fontSize: 15 }}>Evaziga uning kunida men ishlayman</Text>
      </Pressable>
      {exchange ? <DateStrip value={take} onChange={setTake} days={45} /> : null}
      <TextInput value={reason} onChangeText={setReason} placeholder="Izoh (ixtiyoriy)" placeholderTextColor={c.muted} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card, minHeight: 46 }]} maxLength={300} />
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      <Button title="So‘rov yuborish" icon="send" busy={busy} disabled={!colleagueId} onPress={() => void save()} />
    </Sheet>
  );
}

/* ------------------------------------------------------------- dam kuni --- */
type Move = { id: string; fromDate: string; toDate: string; fromWeekday: string; toWeekday: string; reason?: string; status: string };
type DayOffData = { items: Move[]; options: { restDays: string[]; workDays: string[]; maxGapDays: number }; restWeekdays: number[] };

function DayOffTab() {
  const { c } = useTheme();
  const { data, error, reload } = useData<DayOffData>("/mini/dayoff-moves");
  const [open, setOpen] = useState(false);
  const rest = data?.restWeekdays || [];
  const cancel = async (m: Move) => {
    if (!(await confirm("Bekor qilish", "Ko‘chirish so‘rovini bekor qilasizmi?"))) return;
    try {
      await post(`/mini/dayoff-moves/${m.id}/cancel`, {});
      void reload();
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    }
  };
  return (
    <>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <View style={[st.rowIcon, { backgroundColor: `${c.violet}1E` }]}>
            <Icon name="cafe" size={19} color={c.violet} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.muted, fontSize: 12.5 }}>Dam olish kunlaringiz</Text>
            <Text style={{ color: c.ink, fontSize: 16, fontWeight: "600" }}>{rest.length ? rest.map((d) => WEEKDAYS[d]).join(", ") : data?.options.restDays.length ? "Grafik bo‘yicha" : "Belgilanmagan"}</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <View key={d} style={[st.week, { backgroundColor: rest.includes(d) ? c.violet : c.tint }]}>
              <Text style={{ color: rest.includes(d) ? "#fff" : c.muted, fontWeight: "600", fontSize: 12 }}>{WEEKDAYS_SHORT[d]}</Text>
            </View>
          ))}
        </View>
      </Card>
      <Button title="Dam kunini ko‘chirish" icon="calendar-outline" onPress={() => setOpen(true)} disabled={!data?.options.restDays.length} />
      {data && !data.options.restDays.length ? <Text style={{ color: c.muted, fontSize: 13 }}>Yaqin 4 haftada ko‘chirish mumkin bo‘lgan dam olish kuni yo‘q.</Text> : null}
      <Hint tone="rest" icon="shield-checkmark-outline">
        Dam kuni kelmasangiz — jarima yo‘q. Ko‘chirish faqat shu hafta uchun. Sababsiz kelmagan kunni shu oydagi dam kuningizda ishlab qoplashingiz mumkin.
      </Hint>
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      {!data ? (
        <Loading />
      ) : !data.items.length ? (
        <Empty icon="calendar-outline" title="Ko‘chirish so‘rovlari yo‘q" text="Masalan: juma o‘rniga shanba dam olmoqchi bo‘lsangiz — so‘rov yuboring." />
      ) : (
        <Group>
          {data.items.map((m, i) => (
            <ListRow
              key={m.id}
              icon="repeat"
              title={`${dateUz(m.fromDate)} → ${dateUz(m.toDate)}`}
              sub={`${m.fromWeekday} ishlaysiz, ${m.toWeekday} dam olasiz${m.reason ? ` · ${m.reason}` : ""}`}
              badge={m.status}
              onCancel={m.status === "PENDING" ? () => void cancel(m) : undefined}
              last={i === data.items.length - 1}
            />
          ))}
        </Group>
      )}
      {data ? (
        <MoveSheet
          visible={open}
          data={data}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            haptic.success();
            void reload();
          }}
        />
      ) : null}
    </>
  );
}

function MoveSheet({ visible, data, onClose, onSaved }: { visible: boolean; data: DayOffData; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const [from, setFrom] = useState(data.options.restDays[0] || "");
  const targets = useMemo(() => data.options.workDays.filter((d) => from && Math.abs(Date.parse(d) - Date.parse(from)) / 86_400_000 <= data.options.maxGapDays), [data, from]);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!targets.includes(to)) setTo(targets.find((d) => d > from) || targets[0] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, targets]);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await post("/mini/dayoff-moves", { fromDate: from, toDate: to, reason: reason.trim() || undefined });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} title="Dam kunini ko‘chirish" subtitle="Bir martalik — rahbar tasdiqlaydi" onClose={onClose}>
      <Text style={[st.label, { color: c.muted }]}>1. Qaysi dam kuningizda ishlaysiz?</Text>
      <DateStrip value={from} onChange={setFrom} dates={data.options.restDays.slice(0, 8)} tone={c.violet} />
      <Text style={[st.label, { color: c.muted }]}>2. O‘rniga qaysi kuni dam olasiz?</Text>
      {targets.length ? <DateStrip value={to} onChange={setTo} dates={targets} /> : <Text style={{ color: c.muted }}>Yaqin ish kuni topilmadi.</Text>}
      <TextInput value={reason} onChangeText={setReason} placeholder="Sabab (ixtiyoriy)" placeholderTextColor={c.muted} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card, minHeight: 46 }]} maxLength={200} />
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      <Button title={from && to ? `${dateUz(from)} → ${dateUz(to)}` : "Kunlarni tanlang"} icon="send" busy={busy} disabled={!from || !to} onPress={() => void save()} />
    </Sheet>
  );
}

/* ------------------------------------------------------- qo‘shimcha ish --- */
type OvertimeRow = { id: string; date: string; checkIn?: string; checkOut?: string; scheduledEnd: string; overtimeMinutes: number; approved?: boolean; note?: string; closed: boolean };
type OvertimeData = { requiresApproval: boolean; paid: boolean; rows: OvertimeRow[] };

function OvertimeTab() {
  const { c } = useTheme();
  const { data, error, reload } = useData<OvertimeData>("/mini/overtime");
  const [editing, setEditing] = useState<OvertimeRow | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const month = tashkentIsoDate().slice(0, 7);
  const total = (data?.rows || []).filter((r) => r.date.startsWith(month)).reduce((s, r) => s + r.overtimeMinutes, 0);
  const saveNote = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await post(`/mini/overtime/${editing.id}/note`, { note: note.trim() });
      haptic.success();
      setEditing(null);
      void reload();
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {data ? (
        <Hint icon="timer-outline">
          Bu oy: {Math.floor(total / 60)} soat {total % 60} daq.{" "}
          {!data.paid ? "Kompaniyada qo‘shimcha ish to‘lanmaydi." : data.requiresApproval ? "Rahbar tasdiqlagani ish haqiga qo‘shiladi — izoh yozib qo‘ying." : "Avtomatik ish haqiga qo‘shiladi."}
        </Hint>
      ) : null}
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      {!data ? (
        <Loading />
      ) : !data.rows.length ? (
        <Empty icon="timer-outline" title="Qo‘shimcha ish qayd etilmagan" />
      ) : (
        <>
          <GroupTitle>Qaydlar</GroupTitle>
          <Group>
            {data.rows.map((r, i) => {
              const state = r.approved === true ? "APPROVED" : r.approved === false ? "REJECTED" : data.requiresApproval ? "PENDING" : "APPROVED";
              const h = Math.floor(r.overtimeMinutes / 60);
              return (
                <View key={r.id}>
                  <ListRow
                    icon="timer"
                    title={`${dateUz(r.date)} · +${h ? `${h} s ` : ""}${r.overtimeMinutes % 60} daq`}
                    sub={`${r.checkIn} → ${r.checkOut || "…"} (grafik ${r.scheduledEnd} gacha)`}
                    extra={r.note ? `«${r.note}»` : undefined}
                    badge={state}
                    last={i === data.rows.length - 1 && !(data.requiresApproval && r.approved === undefined && !r.closed)}
                  />
                  {data.requiresApproval && r.approved === undefined && !r.closed ? (
                    <Pressable
                      onPress={() => {
                        setNote(r.note || "");
                        setEditing(r);
                      }}
                      style={{ paddingLeft: 66, paddingBottom: 10, marginTop: -6 }}
                    >
                      <Text style={{ color: c.accent, fontWeight: "500" }}>{r.note ? "Izohni o‘zgartirish" : "Izoh yozish"}</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </Group>
        </>
      )}
      <Sheet visible={Boolean(editing)} title="Qo‘shimcha ish izohi" subtitle={editing ? `${dateUz(editing.date)} · ${editing.overtimeMinutes} daqiqa` : undefined} onClose={() => setEditing(null)}>
        <TextInput value={note} onChangeText={setNote} placeholder="Masalan: inventarizatsiya, mijoz buyurtmasi" placeholderTextColor={c.muted} multiline maxLength={300} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]} />
        <Button title="Rahbarga yuborish" icon="send" busy={busy} disabled={note.trim().length < 3} onPress={() => void saveNote()} />
      </Sheet>
    </>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 99, borderWidth: 1 },
  label: { fontSize: 13, fontWeight: "600", marginBottom: -4 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5, minHeight: 80, textAlignVertical: "top" },
  file: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12 },
  week: { flex: 1, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
});
