import { Redirect } from "expo-router";
import { go } from "@/lib/nav";
import { useEffect, useState } from "react";
import { AppState, Image, Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import Svg, { Circle } from "react-native-svg";
import { Button, Card, ErrorBox, Icon, Loading, Screen, haptic } from "@/components/ui";
import { mediaUri } from "@/lib/config";
import { clockDuration, dateLongUz, duration, elapsedMinutes, forwardMinutes, minutesSince, som, tashkentClock } from "@/lib/format";
import { radius, useTheme } from "@/lib/theme";
import type { Attendance, HomeData, Salary } from "@/lib/types";
import { invalidate, useData } from "@/lib/useData";
import { syncGeofence } from "@/lib/geofence";
import { useSession } from "@/lib/session";
import { UpdateBanner } from "@/components/UpdateBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { pendingToday, rememberBranches, useOfflineMarks } from "@/lib/offlineMarks";
import { updateTodayWidget } from "@/widgets/sync";

/**
 * Daqiqa chegarasida yangilanadigan soat. Ekranda faqat soat:daqiqa bor — avval butun bosh sahifa
 * har soniyada qayta chizilardi (sekin telefonlarda aylantirish qotardi). Ilova fondan qaytganda darhol yangilanadi.
 */
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = new Date();
      setNow((prev) => (Math.floor(prev.getTime() / 60_000) === Math.floor(current.getTime() / 60_000) ? prev : current));
      timer = setTimeout(tick, 60_000 - (current.getTime() % 60_000) + 50);
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      clearTimeout(timer);
      tick();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);
  return now;
}

/** Kechikish yopilganmi («Kechikishni ishlab yopish»): qolgan kechikish daqiqalari. */
const lateLeft = (a?: Attendance) => Math.max(0, (a?.lateMinutes || 0) - (a?.lateCoveredMinutes || 0));

/**
 * Bosh sahifa — faqat asosiysi: bugungi holat, «Ishga keldim / Ishdan ketdim» va oylik.
 * Qolgan hammasi «Bo‘limlar»da (Mini App bilan bir xil).
 */
export default function Home() {
  const { mode } = useSession();
  // Direktor rejimida /mini/* chaqirilmaydi — u faqat rahbar panelini ko‘radi.
  if (mode === "manager") return <Redirect href="/(tabs)/manager" />;
  return <EmployeeHome />;
}

function EmployeeHome() {
  const { c } = useTheme();
  const { data, error, loading, refreshing, reload } = useData<HomeData>("/mini/home");
  const salary = useData<Salary>("/mini/salary", { maxAgeMs: 60_000 });
  const now = useMinuteClock();
  // Internetsiz saqlangan belgilar o‘zgarsa — holat yangilanadi.
  useOfflineMarks();
  // Bosh ekran vidjeti va fon geofence — har yangi ma’lumotda.
  useEffect(() => {
    if (!data) return;
    void updateTodayWidget(data).catch(() => undefined);
    void syncGeofence(data).catch(() => undefined);
    // Internetsiz belgilash uchun filiallar telefonga yoziladi.
    rememberBranches(data.branches?.length ? data.branches : data.branch ? [data.branch] : []);
  }, [data]);

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
  // Internetsiz saqlangan (hali yuborilmagan) bugungi belgilar — tugma va vaqt shunga qarab.
  const pendingIn = !a?.checkIn ? pendingToday("CHECK_IN") : undefined;
  const pendingOut = !a?.checkOut ? pendingToday("CHECK_OUT") : undefined;
  const clockOf = (ms: number) => tashkentClock(new Date(ms));
  const inTime = a?.checkIn || (pendingIn ? clockOf(pendingIn.createdAt) : undefined);
  const working = Boolean(inTime && !a?.checkOut && !pendingOut);
  const finished = Boolean(a?.checkOut);
  const day = data.todayPlan;
  const missingSetup = !data.branch || !data.schedule;
  const openBreak = a?.breaks?.find((b) => !b.end);
  const late = lateLeft(a);
  // Kechikkan, lekin kechroq qolib to‘liq yopgan (jarima/ushlanma yo‘q).
  const lateClosed = Boolean(a?.lateMinutes && a.lateCoveredMinutes) && late === 0;
  const status = finished
    ? { text: lateClosed ? "Ish kuni yakunlandi · kechikish yopildi" : "Ish kuni yakunlandi", color: c.accent }
    : openBreak
      ? { text: "Tanaffusda", color: c.warn }
      : working
        ? { text: late ? `Ishdasiz · ${duration(late)} kech` : "Ishdasiz", color: late ? c.warn : c.success }
        : data.todayLeave
          ? { text: "Bugun ta’tildasiz", color: c.violet }
          : !day?.enabled
            ? { text: day?.overridden ? "Dam olish (ko‘chirilgan)" : "Dam olish kuni", color: c.violet }
            : { text: "Hali kelmagansiz", color: c.muted };
  const inNote = a?.checkIn
    ? lateClosed
      ? { text: "Kechikish yopildi", color: c.success }
      : late
        ? { text: `${duration(late)} kech`, color: c.warn }
        : { text: "vaqtida", color: c.success }
    : pendingIn
      ? { text: "telefonda saqlangan", color: c.accent }
      : { text: "hali yo‘q", color: c.muted };

  const start = (action: "CHECK_IN" | "CHECK_OUT") => {
    haptic.medium();
    if (!data.employee.faceEnrolledAt) go({ pathname: "/face-enroll", params: { action } });
    else go({ pathname: "/face-check", params: { action } });
  };
  const refresh = () => {
    invalidate("/mini/");
    void reload();
    void salary.reloadSilent();
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <UpdateBanner />
      <OfflineBanner />
      {/* ------------------------------------------------------ sarlavha --- */}
      <View style={st.header}>
        <Pressable onPress={() => go("/(tabs)/profile")} accessibilityLabel="Profil">
          {data.employee.photoDataUrl ? (
            <Image source={{ uri: mediaUri(data.employee.photoDataUrl) }} style={st.avatar} />
          ) : (
            <View style={[st.avatar, st.initials, { backgroundColor: `${c.accent}1F` }]}>
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
          {/* Holat — rangli nuqta va yozuv (rangli «tabletka» fonsiz). */}
          <View style={st.statusChip}>
            <View style={[st.statusDot, { backgroundColor: status.color }]} />
            <Text style={{ color: c.ink, fontWeight: "600", fontSize: 13, flexShrink: 1 }} numberOfLines={1}>
              {status.text}
            </Text>
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
          <View style={st.timeCell}>
            <Text style={[st.timeLabel, { color: c.muted }]}>Keldi</Text>
            <Text style={[st.timeValue, { color: inTime ? c.ink : c.muted }]}>{inTime || "--:--"}</Text>
            <Text style={{ color: inNote.color, fontSize: 12, fontWeight: "600" }}>{inNote.text}</Text>
          </View>
          <View style={[st.timeCell, { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line, paddingLeft: 16 }]}>
            <Text style={[st.timeLabel, { color: c.muted }]}>{finished ? "Ketdi" : "Ishlangan"}</Text>
            <Text style={[st.timeValue, { color: finished || working ? c.ink : c.muted }]}>
              {finished ? a?.checkOut : working && inTime ? clockDuration(minutesSince(inTime, now)) : "--:--"}
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
        ) : pendingOut ? (
          <View style={[st.done, { backgroundColor: `${c.accent}14` }]}>
            <Icon name="cloud-offline-outline" size={18} color={c.accent} />
            <Text style={{ color: c.ink, fontWeight: "500", flexShrink: 1 }}>Ketish {clockOf(pendingOut.createdAt)} telefonda saqlangan — internet tiklanishi bilan yuboriladi</Text>
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
      </Card>

      {salary.data?.base ? <SalaryCard data={salary.data} /> : null}
    </Screen>
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
        <View style={[st.tileIcon, { backgroundColor: c.tint }]}>
          <Icon name="wallet-outline" size={19} color={c.accent} />
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

/** Ish kuni halqasi: necha foiz o‘tgani va qancha qolgani. */
function ShiftProgress({ start, end, now }: { start: string; end: string; now: Date }) {
  const { c } = useTheme();
  // Kechki smena (14:00 → 00:00) ham: tugash ertasi kunda bo‘lishi mumkin.
  const total = Math.max(1, forwardMinutes(start, end));
  const done = Math.min(total, elapsedMinutes(start, tashkentClock(now)));
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

const st = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 4, paddingBottom: 6 },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  initials: { alignItems: "center", justifyContent: "center" },
  bell: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: 2, right: 0, minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 2 },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },
  dotText: { color: "#fff", fontSize: 10.5, fontWeight: "700" },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  clock: { fontSize: 56, fontWeight: "600", letterSpacing: -2.5, marginTop: 16, fontVariant: ["tabular-nums"] },
  meta: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1, maxWidth: "50%" },
  times: { flexDirection: "row", gap: 16, marginBottom: 18 },
  timeCell: { flex: 1, paddingVertical: 2, gap: 2 },
  timeLabel: { fontSize: 12, fontWeight: "500" },
  timeValue: { fontSize: 24, fontWeight: "700", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  done: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 54, borderRadius: radius.button },
  tileIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  bar: { height: 6, borderRadius: 3, overflow: "hidden" },
});
