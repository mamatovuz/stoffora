import { router } from "expo-router";
import { go } from "@/lib/nav";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Badge, Button, Card, ErrorBox, GroupTitle, Hint, Icon, Loading, Screen, Sheet, haptic, type IconName } from "@/components/ui";
import { mediaUri } from "@/lib/config";
import { errorText, post } from "@/lib/api";
import { clockDuration, dateLongUz, duration, forwardMinutes, minutesSince, som, tashkentClock, timeAgo } from "@/lib/format";
import { elevation, ios, radius, useTheme } from "@/lib/theme";
import type { HomeData, Notification, Salary, Stats } from "@/lib/types";
import { invalidate, useData } from "@/lib/useData";

function useClock(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export default function Home() {
  const { c } = useTheme();
  const { data, error, loading, refreshing, reload } = useData<HomeData>("/mini/home");
  const stats = useData<Stats>("/mini/stats", { maxAgeMs: 5 * 60_000 });
  const salary = useData<Salary>("/mini/salary", { maxAgeMs: 60_000 });
  const now = useClock();
  const [lateOpen, setLateOpen] = useState(false);

  if (loading && !data)
    return (
      <Screen title="Staffora">
        <Loading />
      </Screen>
    );
  if (!data)
    return (
      <Screen title="Staffora" onRefresh={reload} refreshing={refreshing}>
        <ErrorBox text={error || "Ma’lumot yuklanmadi"} onRetry={reload} />
      </Screen>
    );

  const a = data.attendance;
  const working = Boolean(a?.checkIn && !a.checkOut);
  const finished = Boolean(a?.checkOut);
  const day = data.todayPlan;
  const missingSetup = !data.branch || !data.schedule;
  const openBreak = a?.breaks?.find((b) => !b.end);
  const status = finished
    ? { text: "Ish kuni yakunlandi", color: c.accent }
    : openBreak
      ? { text: "Tanaffusda", color: c.warn }
      : working
        ? { text: a?.lateMinutes ? `Ishdasiz · ${duration(a.lateMinutes)} kech` : "Ishdasiz", color: a?.lateMinutes ? c.warn : c.success }
        : data.todayLeave
          ? { text: "Bugun ta’tildasiz", color: c.violet }
          : !day?.enabled
            ? { text: day?.overridden ? "Dam olish (ko‘chirilgan)" : "Dam olish kuni", color: c.violet }
            : { text: "Hali kelmagansiz", color: c.muted };
  const qr = (data.branch?.attendanceMode || "QR_GPS_FACE") === "QR_GPS_FACE";
  const canNotifyLate = !a?.checkIn && !data.todayLeave && Boolean(day?.enabled) && !missingSetup;
  const streak = stats.data?.streak.current || 0;

  const start = (action: "CHECK_IN" | "CHECK_OUT") => {
    haptic.medium();
    if (!data.employee.faceEnrolledAt) go({ pathname: "/face-enroll", params: { action } });
    else go({ pathname: "/face-check", params: { action } });
  };
  const refresh = () => {
    invalidate("/mini/");
    void reload();
    void stats.reloadSilent();
    void salary.reloadSilent();
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {/* ------------------------------------------------------ sarlavha --- */}
      <View style={st.header}>
        <Pressable onPress={() => go("/(tabs)/profile")} accessibilityLabel="Profil">
          {data.employee.photoDataUrl ? (
            <Image source={{ uri: mediaUri(data.employee.photoDataUrl) }} style={st.avatar} />
          ) : (
            <View style={[st.avatar, { backgroundColor: `${c.accent}1F`, alignItems: "center", justifyContent: "center" }]}>
              <Text style={{ color: c.accent, fontWeight: "700", fontSize: 16 }}>
                {data.employee.firstName[0]}
                {data.employee.lastName[0]}
              </Text>
            </View>
          )}
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: c.muted, fontSize: 13, fontWeight: "500" }} numberOfLines={1}>
            {dateLongUz(now)}
          </Text>
          <Text style={{ color: c.ink, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 }} numberOfLines={1}>
            Salom, {data.employee.firstName}
          </Text>
        </View>
        <Pressable onPress={() => go("/notifications")} hitSlop={10} style={[st.bell, { backgroundColor: c.card }]} accessibilityLabel="Bildirishnomalar">
          <Icon name="notifications-outline" size={21} color={c.ink} />
          {(data.unreadNotifications || 0) > 0 ? (
            <View style={[st.dot, { backgroundColor: c.danger, borderColor: c.bg }]}>
              <Text style={st.dotText}>{Math.min(99, data.unreadNotifications || 0)}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      {/* ------------------------------------------------------ hero --- */}
      <Card style={{ padding: 18 }}>
        <View style={st.statusRow}>
          <View style={[st.statusChip, { backgroundColor: `${status.color}17` }]}>
            <View style={[st.statusDot, { backgroundColor: status.color }]} />
            <Text style={{ color: status.color === c.muted ? c.ink : status.color, fontWeight: "600", fontSize: 13 }}>{status.text}</Text>
          </View>
          <View style={st.meta}>
            <Icon name="location" size={13} color={c.muted} />
            <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
              {data.branch?.name || "Filial yo‘q"}
            </Text>
          </View>
        </View>
        <Text style={[st.clock, { color: c.ink }]}>{tashkentClock(now)}</Text>
        <Text style={{ color: c.muted, fontSize: 14, marginBottom: 16 }}>{day?.enabled ? `Ish vaqti ${day.start} – ${day.end}` : "Bugun dam olish kuni"}</Text>

        <View style={st.times}>
          <View style={[st.timeCell, { backgroundColor: c.tint }]}>
            <Text style={[st.timeLabel, { color: c.muted }]}>Keldi</Text>
            <Text style={[st.timeValue, { color: a?.checkIn ? c.ink : c.muted }]}>{a?.checkIn || "--:--"}</Text>
            <Text style={{ color: a?.checkIn ? (a.lateMinutes ? c.warn : c.success) : c.muted, fontSize: 12, fontWeight: "600" }}>
              {a?.checkIn ? (a.lateMinutes ? `${duration(a.lateMinutes)} kech` : "vaqtida") : "hali yo‘q"}
            </Text>
          </View>
          <View style={[st.timeCell, { backgroundColor: c.tint }]}>
            <Text style={[st.timeLabel, { color: c.muted }]}>{finished ? "Ketdi" : "Ishlangan"}</Text>
            <Text style={[st.timeValue, { color: finished || working ? c.ink : c.muted }]}>
              {finished ? a?.checkOut : working && a?.checkIn ? clockDuration(minutesSince(a.checkIn, now)) : "--:--"}
            </Text>
            <Text style={{ color: finished ? c.success : c.muted, fontSize: 12, fontWeight: "600" }}>
              {finished ? `${clockDuration(a?.workedMinutes || 0)} soat` : working ? "davom etmoqda" : "—"}
            </Text>
          </View>
        </View>

        {working && day?.enabled && a?.checkIn ? <ShiftProgress start={a.checkIn} end={a.scheduledEnd || day.end} now={now} /> : null}

        {missingSetup ? (
          <View style={[st.done, { backgroundColor: c.tint }]}>
            <Icon name="alert-circle" size={18} color={c.warn} />
            <Text style={{ color: c.warn, fontWeight: "500" }}>HR filial va grafikni biriktirishi kerak</Text>
          </View>
        ) : finished ? (
          <View style={[st.done, { backgroundColor: c.tint }]}>
            <Icon name="checkmark-circle" size={18} color={c.success} />
            <Text style={{ color: c.ink, fontWeight: "500" }}>
              {a?.checkIn} – {a?.checkOut} · {duration(a?.workedMinutes || 0)}
            </Text>
          </View>
        ) : data.todayLeave && !working ? (
          <View style={{ gap: 8 }}>
            <View style={[st.done, { backgroundColor: `${c.violet}18` }]}>
              <Text style={{ color: c.violet, fontWeight: "500" }}>Bugun ta’tildasiz — dam oling</Text>
            </View>
            <Pressable onPress={() => start("CHECK_IN")} style={{ alignSelf: "center", padding: 6 }}>
              <Text style={{ color: c.accent, fontWeight: "500" }}>Baribir ishga keldim</Text>
            </Pressable>
          </View>
        ) : (
          <Button
            big
            title={openBreak ? "Avval tanaffusni yakunlang" : working ? "Ishdan ketdim" : "Ishga keldim"}
            icon={working ? "log-out-outline" : "scan-outline"}
            tone={working ? "danger" : "primary"}
            disabled={Boolean(openBreak)}
            onPress={() => start(working ? "CHECK_OUT" : "CHECK_IN")}
          />
        )}
        <View style={st.note}>
          <Icon name="shield-checkmark" size={12} color={c.muted} />
          <Text style={{ color: c.muted, fontSize: 11.5 }}>Face ID · GPS{qr ? " · QR" : ""} · ishonchli telefon</Text>
        </View>
      </Card>

      {!day?.enabled && !a?.checkIn && !data.todayLeave && !missingSetup ? (
        <Hint tone="rest" icon="calendar">
          Bugun dam olish kuningiz — kelmasangiz jarima yo‘q. Ishga kelsangiz, shu oydagi sababsiz kelmagan kun qoplanadi (bo‘lmasa qo‘shimcha ish hisoblanadi).
        </Hint>
      ) : null}

      {canNotifyLate ? (
        data.lateNotice ? (
          <Hint icon="hourglass">
            Rahbaringiz ogohlantirildi: ~{duration(data.lateNotice.minutes)} kechikasiz. «{data.lateNotice.reason}»
          </Hint>
        ) : (
          <Card onPress={() => setLateOpen(true)} style={st.lateCard}>
            <View style={[st.tileIcon, { backgroundColor: `${c.warn}1C` }]}>
              <Icon name="hourglass-outline" size={19} color={c.warn} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.ink, fontWeight: "600", fontSize: 15 }}>Kechikyapsizmi?</Text>
              <Text style={{ color: c.muted, fontSize: 13 }}>Rahbaringizni oldindan ogohlantiring</Text>
            </View>
            <Icon name="chevron-forward" size={17} color={c.muted} />
          </Card>
        )
      ) : null}

      {/* -------------------------------------------------- statistika --- */}
      <GroupTitle>Shu oy</GroupTitle>
      <Card style={st.stats}>
        <Stat value={String(data.month.days)} label="kun keldi" />
        <Stat value={String(data.month.late)} label="kechikish" warn={data.month.late > 0} border />
        {streak > 0 ? (
          <Stat value={String(streak)} label="kun vaqtida" border onPress={() => go("/(tabs)/history")} />
        ) : (
          <Stat value={String(Math.round(data.month.workedMinutes / 60))} label="soat" border />
        )}
      </Card>

      {salary.data?.base ? <SalaryCard data={salary.data} /> : null}

      {/* ----------------------------------------------- tezkor bo‘limlar --- */}
      <GroupTitle>Tezkor bo‘limlar</GroupTitle>
      <Card style={st.quick}>
        <Tile icon="calendar-outline" label="Grafigim" onPress={() => go({ pathname: "/(tabs)/history", params: { view: "schedule" } })} />
        <Tile icon="stats-chart-outline" label="Statistika" onPress={() => go({ pathname: "/(tabs)/history", params: { view: "stats" } })} />
        <Tile icon="finger-print-outline" label="Belgilash" onPress={() => go("/mark-request")} />
        <Tile icon="id-card-outline" label="Mening ID" onPress={() => go("/badge")} />
        <Tile icon="receipt-outline" label="Hisob varaqa" onPress={() => go("/payslips")} />
        <Tile icon="add-circle-outline" label="So‘rov" onPress={() => go({ pathname: "/(tabs)/requests", params: { create: String(Date.now()) } })} />
        <Tile icon="chatbubble-ellipses-outline" label="HR’ga savol" onPress={() => go({ pathname: "/helpdesk", params: { view: "questions" } })} />
        <Tile icon="gift-outline" label="Tug‘ilgan kunlar" onPress={() => go("/birthdays")} />
      </Card>

      {data.month.practiceUntil ? (
        <Hint icon="school-outline">{data.month.practiceUntil.split("-").reverse().join(".")} gacha mashq davri — kechikish va ushlanmalar hisoblanmaydi.</Hint>
      ) : data.month.lateMinutes > 0 ? (
        <Hint tone="warn" icon="alert-circle-outline">
          Bu oy {duration(data.month.lateMinutes)} kechikdingiz{data.month.deduction ? ` · ${data.month.deduction.toLocaleString("ru-RU")} so‘m ushlanadi` : ""}
        </Hint>
      ) : null}
      {!data.employee.faceEnrolledAt && !finished && !missingSetup ? <Hint icon="scan-outline">Birinchi marta Face ID sozlanadi (~15 soniya). Yorug‘ joyda turing.</Hint> : null}

      {data.notifications.some((n) => !n.read) ? (
        <Card style={{ paddingVertical: 6 }} onPress={() => go("/notifications")}>
          <View style={st.notifHead}>
            <Text style={{ color: c.ink, fontWeight: "600", fontSize: 16 }}>Xabarlar</Text>
            {(data.unreadNotifications || 0) > 0 ? <Badge text={String(data.unreadNotifications)} tone="bad" /> : null}
            <View style={{ flex: 1 }} />
            <Icon name="chevron-forward" size={17} color={c.muted} />
          </View>
          {data.notifications.filter((n) => !n.read).slice(0, 2).map((n) => (
            <NotifLine key={n.id} item={n} />
          ))}
        </Card>
      ) : null}

      <LateSheet
        visible={lateOpen}
        start={day?.start || ""}
        onClose={() => setLateOpen(false)}
        onSaved={() => {
          setLateOpen(false);
          haptic.success();
          refresh();
        }}
      />
    </Screen>
  );
}

function Stat({ value, label, warn, border, onPress }: { value: string; label: string; warn?: boolean; border?: boolean; onPress?: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={[{ flex: 1, alignItems: "center", gap: 2, paddingVertical: 4 }, border && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line }]}>
      <Text style={{ color: warn ? c.warn : c.ink, fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function Tile({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => [st.tile, pressed && { opacity: 0.6, transform: [{ scale: 0.95 }] }]}
    >
      <View style={[st.tileIcon, { backgroundColor: `${c.accent}12` }]}>
        <Icon name={icon} size={22} color={c.accent} />
      </View>
      <Text style={{ color: c.ink, fontSize: 11.5, textAlign: "center", fontWeight: "500" }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function SalaryCard({ data }: { data: Salary }) {
  const { c } = useTheme();
  const [visible, setVisible] = useState(false);
  const progress = data.base ? Math.min(100, Math.round((data.earnedToDate / data.base) * 100)) : 0;
  const deductions = data.lateDeduction + data.absenceDeduction + data.fine;
  return (
    <Card onPress={() => go("/salary")} style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={[st.tileIcon, { backgroundColor: `${c.success}1C` }]}>
          <Icon name="wallet" size={19} color={c.success} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.muted, fontSize: 12.5 }}>{data.closed ? `${data.label} — yopilgan` : `${data.label} · taxminan qo‘lga`}</Text>
          <Text style={{ color: c.ink, fontSize: 21, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{visible ? som(data.net) : "••• ••• so‘m"}</Text>
        </View>
        <Pressable
          hitSlop={12}
          onPress={() => {
            haptic.select();
            setVisible((v) => !v);
          }}
          accessibilityLabel={visible ? "Yashirish" : "Ko‘rsatish"}
        >
          <Icon name={visible ? "eye-off-outline" : "eye-outline"} size={21} color={c.muted} />
        </Pressable>
      </View>
      <View style={[st.bar, { backgroundColor: c.tint }]}>
        <View style={{ width: `${progress}%`, height: "100%", backgroundColor: c.success, borderRadius: 3 }} />
      </View>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Text style={{ color: c.muted, fontSize: 12.5 }}>
          {data.days}/{data.workingDays} kun
        </Text>
        {deductions > 0 ? <Text style={{ color: c.warn, fontSize: 12.5 }}>−{visible ? som(deductions) : "•••"} ushlanma</Text> : null}
        {data.limit.enabled && data.limit.available > 0 ? <Text style={{ color: c.success, fontSize: 12.5 }}>Avans mumkin</Text> : null}
        <View style={{ flex: 1 }} />
        <Icon name="chevron-forward" size={16} color={c.muted} />
      </View>
    </Card>
  );
}

function NotifLine({ item }: { item: Notification }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }}>
      <View style={[st.unread, { backgroundColor: item.read ? "transparent" : c.accent }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.ink, fontWeight: item.read ? "500" : "700", fontSize: 14.5 }} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={2}>
          {item.body.replace(/<[^>]+>/g, "")}
        </Text>
      </View>
      <Text style={{ color: c.muted, fontSize: 11.5 }}>{timeAgo(item.createdAt)}</Text>
    </View>
  );
}

/** Ish kuni halqasi: necha foiz o‘tgani va qancha qolgani. */
function ShiftProgress({ start, end, now }: { start: string; end: string; now: Date }) {
  const { c } = useTheme();
  // Kechki smena (14:00 → 00:00) ham: tugash ertasi kunda bo‘lishi mumkin.
  const total = Math.max(1, forwardMinutes(start, end));
  const done = Math.min(total, forwardMinutes(start, tashkentClock(now)));
  const left = total - done;
  const percent = Math.round((done / total) * 100);
  const R = 24;
  const C = 2 * Math.PI * R;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 }}>
      <View>
        <Svg width={58} height={58} viewBox="0 0 58 58">
          <Circle cx={29} cy={29} r={R} stroke={c.tint} strokeWidth={6} fill="none" />
          <Circle cx={29} cy={29} r={R} stroke={c.success} strokeWidth={6} fill="none" strokeDasharray={`${C}`} strokeDashoffset={C * (1 - percent / 100)} strokeLinecap="round" rotation={-90} origin="29, 29" />
        </Svg>
        <Text style={[StyleSheet.absoluteFill, { textAlign: "center", textAlignVertical: "center", lineHeight: 58, color: c.ink, fontWeight: "700", fontSize: 13 }]}>{percent}%</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.ink, fontWeight: "600", fontSize: 15 }}>{left > 0 ? `${clockDuration(left)} qoldi` : "Ish vaqti tugadi"}</Text>
        <Text style={{ color: c.muted, fontSize: 13 }}>
          {start} – {end}
        </Text>
      </View>
    </View>
  );
}

function LateSheet({ visible, start, onClose, onSaved }: { visible: boolean; start: string; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const [minutes, setMinutes] = useState(15);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chips = ["Tirbandlik", "Transport", "Sog‘liq", "Oilaviy sabab"];
  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await post("/mini/late-notice", { minutes, reason: reason.trim() });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} title="Kechikish haqida xabar" subtitle={start ? `Ish boshlanishi: ${start}` : undefined} onClose={onClose}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[10, 15, 30, 60].map((m) => (
          <Pressable key={m} onPress={() => setMinutes(m)} style={[st.chip, { borderColor: minutes === m ? c.accent : c.line, backgroundColor: minutes === m ? `${c.accent}18` : c.card }]}>
            <Text style={{ color: minutes === m ? c.accent : c.ink, fontWeight: "600" }}>{m} daq</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {chips.map((t) => (
          <Pressable key={t} onPress={() => setReason(t)} style={[st.chip, { borderColor: c.line, backgroundColor: reason === t ? c.tint : c.card }]}>
            <Text style={{ color: c.ink, fontSize: 13.5 }}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={reason} onChangeText={setReason} placeholder="Sabab" placeholderTextColor={c.muted} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]} maxLength={200} />
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      <Button title="Rahbarni ogohlantirish" icon="send" busy={busy} disabled={reason.trim().length < 3} onPress={() => void send()} />
      <Text style={{ color: c.muted, fontSize: 12.5 }}>Ogohlantirish kechikishni bekor qilmaydi, lekin rahbaringiz vaziyatdan xabardor bo‘ladi.</Text>
    </Sheet>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 4, paddingBottom: 6 },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  bell: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: 2, right: 0, minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 2 },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
  dotText: { color: "#fff", fontSize: 10.5, fontWeight: "700" },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  clock: { fontSize: 56, fontWeight: "700", letterSpacing: -2, marginTop: 16, fontVariant: ["tabular-nums"] },
  meta: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1, maxWidth: "50%" },
  times: { flexDirection: "row", gap: 10, marginBottom: 16 },
  timeCell: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, gap: 2, borderRadius: 14 },
  timeLabel: { fontSize: 12, fontWeight: "500" },
  timeValue: { fontSize: 24, fontWeight: "700", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  done: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 54, borderRadius: radius.button },
  note: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 10 },
  lateCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  stats: { flexDirection: "row", paddingVertical: 12, paddingHorizontal: 4 },
  quick: { flexDirection: "row", flexWrap: "wrap", paddingVertical: 8, paddingHorizontal: 4 },
  tile: { width: "25%", alignItems: "center", gap: 7, paddingVertical: 10 },
  tileIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  bar: { height: 6, borderRadius: 3, overflow: "hidden" },
  notifHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  unread: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5 },
});
