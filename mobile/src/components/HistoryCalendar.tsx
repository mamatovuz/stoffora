import { useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Badge, Card, ErrorBox, Icon, Loading, haptic, type IconName } from "./ui";
import { Donut } from "./Donut";
import { MiniMap } from "./MiniMap";
import { WEEKDAYS_SHORT, dateLongUz, duration, monthUz, tashkentIsoDate } from "@/lib/format";
import { useTheme } from "@/lib/theme";

/*
 * Davomat tarixi (kalendar): kun rangi, tanlangan kun tafsiloti (kirish/chiqish, grafik,
 * tafsilotlar, qaydnoma → rasm va xarita, so‘rovlar) va oylik statistika diagrammasi.
 * Xodimning o‘zi (/mini/history) va rahbar (/employees/:id/history) uchun bir xil.
 */

type Tone = "ontime" | "late" | "absent" | "leave" | "off" | "future" | "working" | "restwork" | "none";
type Day = { date: string; tone: Tone; working: boolean; start: string; end: string; reason?: string; leave?: string; checkIn?: string; checkOut?: string };
type MonthData = { month: string; label: string; today: string; days: Day[]; stats: { ontime: number; late: number; absent: number; leave: number; remaining: number; off: number; plannedMinutes: number; workedMinutes: number; lateMinutes: number; overtimeMinutes: number } };
type Mark = { kind: "IN" | "OUT"; time: string; branchName: string; latitude?: number; longitude?: number; accuracy?: number; distanceMeters?: number; method: string; qr?: boolean; photo?: string; photoExpired?: boolean; branch?: { latitude: number; longitude: number; radius: number } };
type DayData = {
  date: string;
  plan: { working: boolean; start: string; end: string; reason?: string; leave?: string; plannedMinutes: number };
  attendance: { checkIn?: string; checkOut?: string; lateMinutes: number; earlyLeaveMinutes: number; workedMinutes: number; overtimeMinutes: number; note?: string } | null;
  breaks: { start: string; end?: string }[];
  marks: Mark[];
  requests: { id: string; kind: string; detail: string; status: string }[];
};
type Fetch = <T>(path: string) => Promise<T>;

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const LEAVE: Record<string, string> = { VACATION: "Ta’til", SICK: "Kasallik", PERMISSION: "Ruxsat", UNPAID: "O‘z hisobidan", OTHER: "Boshqa" };
const STATUS: Record<string, [string, "warn" | "ok" | "bad" | "muted"]> = { PENDING: ["Kutilmoqda", "warn"], APPROVED: ["Tasdiqlandi", "ok"], REJECTED: ["Rad etildi", "bad"], CANCELLED: ["Bekor", "muted"] };
const shift = (month: string, d: number) => {
  const x = new Date(`${month}-15T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + d);
  return x.toISOString().slice(0, 7);
};
const firstOffset = (month: string) => (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
const hours = (m: number) => (m % 60 ? duration(m) : `${m / 60} soat`);

export function HistoryCalendar({ fetcher, base }: { fetcher: Fetch; base: string }) {
  const { c } = useTheme();
  const today = tashkentIsoDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [data, setData] = useState<MonthData | null>(null);
  const [day, setDay] = useState<DayData | null>(null);
  const [error, setError] = useState("");
  const [mark, setMark] = useState<Mark | null>(null);
  const colors: Record<Tone, string> = { ontime: "#5BA24A", working: "#5BA24A", restwork: c.accent, late: "#E8A03A", absent: "#E5484D", leave: "#8B5CF6", off: `${c.accent}33`, future: c.tint, none: c.tint };

  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    fetcher<MonthData>(`${base}?month=${month}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Xatolik"));
    return () => {
      live = false;
    };
  }, [fetcher, base, month]);
  useEffect(() => {
    let live = true;
    setDay(null);
    fetcher<DayData>(`${base}/day?date=${selected}`)
      .then((d) => live && setDay(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [fetcher, base, selected]);

  const go = (d: number) => {
    haptic.select();
    const next = shift(month, d);
    setMonth(next);
    // Boshqa oyga o‘tilsa — o‘sha oyning (bugun bo‘lsa bugungi, aks holda 1-) kuni.
    setSelected(next === today.slice(0, 7) ? today : `${next}-01`);
  };
  const s = data?.stats;
  return (
    <>
      <Card style={{ gap: 12 }}>
        <View style={st.nav}>
          <Pressable onPress={() => go(-1)} hitSlop={10} style={[st.navBtn, { backgroundColor: c.tint }]}>
            <Icon name="chevron-back" size={18} color={c.ink} />
          </Pressable>
          <Text style={{ color: c.ink, fontSize: 18, fontWeight: "600" }}>{monthUz(month)}</Text>
          <Pressable onPress={() => go(1)} disabled={month >= today.slice(0, 7)} hitSlop={10} style={[st.navBtn, { backgroundColor: c.tint, opacity: month >= today.slice(0, 7) ? 0.35 : 1 }]}>
            <Icon name="chevron-forward" size={18} color={c.ink} />
          </Pressable>
        </View>
        <View style={st.row}>
          {ORDER.map((d) => (
            <Text key={d} style={[st.week, { color: d === 0 ? c.accent : c.muted }]}>
              {WEEKDAYS_SHORT[d]}
            </Text>
          ))}
        </View>
        {error ? <ErrorBox text={error} /> : null}
        {!data ? (
          <Loading />
        ) : (
          <View style={st.grid}>
            {Array.from({ length: firstOffset(month) }, (_, i) => (
              <View key={`b${i}`} style={st.cell} />
            ))}
            {data.days.map((d) => {
              const picked = d.date === selected;
              const solid = ["ontime", "working", "late", "absent", "leave", "restwork"].includes(d.tone);
              const bg = picked ? c.accent : colors[d.tone];
              const fg = picked || solid ? "#fff" : d.tone === "off" ? c.accent : c.ink;
              return (
                <Pressable
                  key={d.date}
                  style={st.cell}
                  onPress={() => {
                    haptic.select();
                    setSelected(d.date);
                  }}
                >
                  <View style={[st.day, { backgroundColor: bg }, d.date === today && !picked && { borderWidth: 1.5, borderColor: c.accent }]}>
                    <Text style={{ color: fg, fontWeight: "700", fontSize: 14.5, fontVariant: ["tabular-nums"] }}>{d.date.slice(8)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={st.legend}>
          {(
            [
              ["Vaqtida", colors.ontime],
              ["Kechikdi", colors.late],
              ["Kelmadi", colors.absent],
              ["Ta’til", colors.leave],
              ["Dam", `${c.accent}55`],
            ] as const
          ).map(([label, color]) => (
            <View key={label} style={st.legendItem}>
              <View style={[st.dot, { backgroundColor: color }]} />
              <Text style={{ color: c.muted, fontSize: 12 }}>{label}</Text>
            </View>
          ))}
        </View>
      </Card>

      {!day ? (
        <Loading />
      ) : (
        <>
          <Text style={{ color: c.muted, fontSize: 13, fontWeight: "600", marginLeft: 4 }}>{dateLongUz(new Date(`${day.date}T07:00:00Z`))}</Text>
          <Card style={{ flexDirection: "row" }}>
            <Big value={day.attendance?.checkIn || "--:--"} label="kirish" />
            <Big value={day.attendance?.checkOut || "--:--"} label="chiqish" />
          </Card>

          <Section icon="stats-chart" title="Ish jadvali">
            <View style={{ flexDirection: "row" }}>
              <Big value={day.plan.leave ? LEAVE[day.plan.leave] || "Ta’til" : day.plan.working ? `${day.plan.start} - ${day.plan.end}` : "Dam olish"} label={day.plan.working ? "ish kuni" : day.plan.reason || "dam olish kuni"} small />
              <Big value={day.breaks.length ? day.breaks.map((b) => `${b.start} - ${b.end || "…"}`).join(", ") : "--:-- - --:--"} label="tanaffus" small />
            </View>
          </Section>

          <Section icon="time-outline" title="Kun tafsilotlari">
            <Line value={hours(day.plan.plannedMinutes)} label="Ish jadvali bo‘yicha" />
            <Line value={hours(day.attendance?.workedMinutes || 0)} label="Ishlangan vaqt" />
            {day.attendance?.lateMinutes ? <Line value={`${duration(day.attendance.lateMinutes)}`} label="Kechikish" tone={c.warn} /> : null}
            {day.attendance?.earlyLeaveMinutes ? <Line value={`${duration(day.attendance.earlyLeaveMinutes)}`} label="Erta ketish" tone={c.warn} /> : null}
            {day.attendance?.overtimeMinutes ? <Line value={hours(day.attendance.overtimeMinutes)} label="Qo‘shimcha ish" tone={c.success} /> : null}
            {!day.attendance && day.plan.working && day.date < today ? <Line value={hours(day.plan.plannedMinutes)} label="Kelmagan (yo‘qlik)" tone={c.danger} /> : null}
          </Section>

          <Section icon="locate" title="Qaydnoma">
            {!day.marks.length ? (
              <Text style={{ color: c.muted, textAlign: "center", paddingVertical: 10 }}>Belgi yo‘q</Text>
            ) : (
              [...day.marks].reverse().map((m, i) => (
                <Pressable key={i} onPress={() => setMark(m)} style={[st.mark, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
                  <Icon name={m.kind === "IN" ? "log-in-outline" : "log-out-outline"} size={24} color={m.kind === "IN" ? colors.ontime : c.danger} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.ink, fontSize: 16 }}>{m.kind === "IN" ? "Kirish" : "Chiqish"}</Text>
                    <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
                      {m.branchName}
                      {m.method === "MANUAL" ? " · qo‘lda" : ""}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 2 }}>
                    <Text style={{ color: c.ink, fontVariant: ["tabular-nums"] }}>{m.time}</Text>
                    <View style={{ flexDirection: "row", gap: 4 }}>
                      {m.photo ? <Icon name="happy-outline" size={13} color={c.muted} /> : null}
                      {m.latitude !== undefined ? <Icon name="location-outline" size={13} color={c.muted} /> : null}
                    </View>
                  </View>
                  <Icon name="chevron-forward" size={16} color={c.muted} />
                </Pressable>
              ))
            )}
          </Section>

          <Section icon="list" title="So‘rovlar">
            {!day.requests.length ? (
              <Text style={{ color: c.muted, textAlign: "center", paddingVertical: 10 }}>So‘rovlar yo‘q</Text>
            ) : (
              day.requests.map((r) => (
                <View key={r.id} style={st.mark}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.ink, fontSize: 15 }}>{r.kind}</Text>
                    {r.detail ? (
                      <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
                        {r.detail}
                      </Text>
                    ) : null}
                  </View>
                  <Badge text={(STATUS[r.status] || [r.status])[0]} tone={(STATUS[r.status] || [r.status, "muted"])[1]} />
                </View>
              ))
            )}
          </Section>
        </>
      )}

      {s ? (
        <Section icon="briefcase" title={`Oylik statistika · ${monthUz(month)}`}>
          <Donut
            slices={[
              { label: "vaqtida", value: s.ontime, color: colors.ontime },
              { label: "kechikdi", value: s.late, color: colors.late },
              { label: "kelmadi", value: s.absent, color: colors.absent },
              { label: "ta’til", value: s.leave, color: colors.leave },
              { label: "qoldi", value: s.remaining, color: "#8E9AAF" },
            ]}
          />
          <View style={{ flexDirection: "row", marginTop: 14 }}>
            <Big value={hours(s.plannedMinutes)} label="rejaga muvofiq" small />
            <Big value={hours(s.workedMinutes)} label="ishlab chiqilgan" small />
          </View>
          {s.lateMinutes || s.overtimeMinutes ? (
            <View style={{ flexDirection: "row", marginTop: 8 }}>
              <Big value={`${duration(s.lateMinutes)}`} label="jami kechikish" small />
              <Big value={hours(s.overtimeMinutes)} label="qo‘shimcha ish" small />
            </View>
          ) : null}
        </Section>
      ) : null}

      <MarkModal mark={mark} date={day?.date || selected} onClose={() => setMark(null)} />
    </>
  );
}

function Section({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Icon name={icon} size={20} color={c.accent} />
        <Text style={{ color: c.ink, fontSize: 15.5, fontWeight: "600" }}>{title}</Text>
      </View>
      {children}
    </Card>
  );
}
function Big({ value, label, small }: { value: string; label: string; small?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: c.ink, fontSize: small ? 17 : 26, fontWeight: small ? "500" : "600", fontVariant: ["tabular-nums"] }} numberOfLines={2}>
        {value}
      </Text>
      <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}
function Line({ value, label, tone }: { value: string; label: string; tone?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 1 }}>
      <Text style={{ color: tone || c.ink, fontSize: 17, fontWeight: "500" }}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

function MarkModal({ mark, date, onClose }: { mark: Mark | null; date: string; onClose: () => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={Boolean(mark)} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {mark ? (
        <View style={{ flex: 1, backgroundColor: c.bg }}>
          <View style={[st.sheetHead, { borderBottomColor: c.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.ink, fontSize: 19, fontWeight: "700" }}>{mark.kind === "IN" ? "Qayd (kirish)" : "Qayd (chiqish)"}</Text>
              <Text style={{ color: c.muted, fontSize: 13.5 }}>
                {mark.time} · {date.split("-").reverse().join(".")}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={[st.close, { backgroundColor: c.tint }]}>
              <Icon name="close" size={20} color={c.ink} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 24 }}>
            <Card style={{ gap: 12, padding: 0, overflow: "hidden" }}>
              <View style={st.cardHead}>
                <Icon name="camera" size={20} color={c.accent} />
                <Text style={{ color: c.ink, fontSize: 15.5, fontWeight: "600" }}>Fotosurat</Text>
              </View>
              {mark.photo ? (
                <Image source={{ uri: mark.photo }} style={{ width: "100%", aspectRatio: 1 }} resizeMode="cover" />
              ) : (
                <Text style={{ color: c.muted, padding: 16, paddingTop: 0 }}>{mark.photoExpired ? "Rasm 62 kundan so‘ng o‘chiriladi." : mark.method === "MANUAL" ? "Qo‘lda belgilangan — rasm yo‘q." : "Rasm saqlanmagan."}</Text>
              )}
            </Card>
            <Card style={{ gap: 12, padding: 0, overflow: "hidden" }}>
              <View style={st.cardHead}>
                <Icon name="location" size={20} color={c.accent} />
                <Text style={{ color: c.ink, fontSize: 15.5, fontWeight: "600" }}>Koordinatalar</Text>
              </View>
              {mark.latitude !== undefined && mark.longitude !== undefined ? (
                <MiniMap
                  branch={mark.branch ? { latitude: mark.branch.latitude, longitude: mark.branch.longitude } : { latitude: mark.latitude, longitude: mark.longitude }}
                  radius={mark.branch?.radius || 30}
                  me={{ latitude: mark.latitude, longitude: mark.longitude, accuracy: mark.accuracy }}
                  height={240}
                />
              ) : (
                <Text style={{ color: c.muted, paddingHorizontal: 16 }}>Koordinata saqlanmagan.</Text>
              )}
              <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 2 }}>
                <Text style={{ color: c.ink, fontSize: 16 }}>{mark.branchName}</Text>
                <Text style={{ color: c.muted, fontSize: 13 }}>
                  {[mark.accuracy !== undefined ? `Aniqlik: ${mark.accuracy} m` : "", mark.distanceMeters !== undefined ? `filialdan ${mark.distanceMeters} m` : "", mark.method === "BIOMETRIC" ? "barmoq izi" : mark.method === "MANUAL" ? "qo‘lda" : "Face ID", mark.qr ? "QR" : ""].filter(Boolean).join(" · ")}
                </Text>
              </View>
            </Card>
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

const st = StyleSheet.create({
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn: { width: 44, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row" },
  week: { width: `${100 / 7}%`, textAlign: "center", fontSize: 12.5, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 3 },
  day: { flex: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  mark: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, paddingBottom: 0 },
});
