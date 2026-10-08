import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Badge, Card, Empty, ErrorBox, Group, GroupTitle, Icon, Loading, Row, Screen, Segmented, haptic } from "@/components/ui";
import { WEEKDAYS_SHORT, dateLongUz, dateUz, duration, tashkentIsoDate, weekdayShort } from "@/lib/format";
import { radius, useTheme } from "@/lib/theme";
import type { Attendance, HomeData } from "@/lib/types";
import { useData } from "@/lib/useData";
import { api } from "@/lib/api";
import { HistoryCalendar } from "@/components/HistoryCalendar";

type View3 = "calendar" | "schedule" | "stats";
type PlanDay = { date: string; working: boolean; start: string; end: string; overridden: boolean; reason?: string; leave?: string; checkIn?: string; checkOut?: string; lateMinutes: number; workedMinutes: number };
type PlanMonth = { month: string; label: string; days: PlanDay[]; totals: { workdays: number; plannedMinutes: number; leaveDays: number } };
type StatsData = {
  streak: { current: number; best: number; badge: { emoji: string; label: string } | null };
  months: { month: string; label: string; present: number; late: number; lateMinutes: number; workedHours: number; overtimeHours: number; onTimeRate: number | null }[];
  leaderboard: { rank: number; total: number; top: { name: string; rate: number; me: boolean }[] } | null;
};
const LEAVE: Record<string, string> = { VACATION: "Ta’til", SICK: "Kasallik", UNPAID: "O‘z hisobidan", BUSINESS_TRIP: "Xizmat safari", OTHER: "Boshqa" };
const ORDER = [1, 2, 3, 4, 5, 6, 0];

const shiftMonth = (month: string, delta: number) => {
  const d = new Date(`${month}-15T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
};
const firstOffset = (month: string) => (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;

export default function History() {
  const params = useLocalSearchParams<{ view?: View3 }>();
  const [view, setView] = useState<View3>(params.view || "calendar");
  useEffect(() => {
    if (params.view) setView(params.view);
  }, [params.view]);
  return (
    <Screen title={view === "calendar" ? "Taqvim" : view === "schedule" ? "Ish grafigim" : "Statistika"}>
      <Segmented<View3>
        value={view}
        onChange={setView}
        options={[
          ["calendar", "Kalendar"],
          ["schedule", "Grafigim"],
          ["stats", "Statistika"],
        ]}
      />
      {view === "calendar" ? <CalendarView /> : view === "schedule" ? <ScheduleView /> : <StatsView />}
    </Screen>
  );
}

/* ------------------------------------------------------------ kalendar --- */
function CalendarView() {
  return <HistoryCalendar fetcher={api} base="/mini/history" />;
}

/* ------------------------------------------------------------ grafigim --- */
function ScheduleView() {
  const { c } = useTheme();
  const today = tashkentIsoDate();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(current);
  const [selected, setSelected] = useState(today);
  const { data, error, reload } = useData<PlanMonth>(`/mini/schedule?month=${month}`);
  const pick = data?.days.find((d) => d.date === selected);
  const upcoming = (data?.days || []).filter((d) => d.date >= today && (d.working || d.leave || d.overridden)).slice(0, 7);
  const nav = (delta: number) => {
    haptic.select();
    setMonth(shiftMonth(month, delta));
  };
  return (
    <>
      <View style={st.monthNav}>
        <Pressable onPress={() => nav(-1)} disabled={month <= shiftMonth(current, -3)} hitSlop={10} style={[st.navBtn, { backgroundColor: c.card }]}>
          <Icon name="chevron-back" size={18} color={c.accent} />
        </Pressable>
        <Text style={{ color: c.ink, fontWeight: "700", fontSize: 17 }}>{data?.label || month}</Text>
        <Pressable onPress={() => nav(1)} disabled={month >= shiftMonth(current, 2)} hitSlop={10} style={[st.navBtn, { backgroundColor: c.card }]}>
          <Icon name="chevron-forward" size={18} color={c.accent} />
        </Pressable>
      </View>
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      {!data ? (
        <Loading />
      ) : (
        <Card>
          <View style={st.calHead}>
            {ORDER.map((d) => (
              <Text key={d} style={[st.calWeek, { color: c.muted }]}>
                {WEEKDAYS_SHORT[d]}
              </Text>
            ))}
          </View>
          <View style={st.cal}>
            {Array.from({ length: firstOffset(month) }, (_, i) => (
              <View key={`b${i}`} style={st.cell} />
            ))}
            {data.days.map((d) => {
              const bg = d.leave ? `${c.violet}22` : d.overridden ? `${c.warn}22` : d.working ? `${c.accent}14` : "transparent";
              const fg = d.leave ? c.violet : d.overridden ? c.warn : d.working ? c.ink : c.muted;
              const picked = d.date === selected;
              return (
                <Pressable
                  key={d.date}
                  style={st.cell}
                  onPress={() => {
                    haptic.select();
                    setSelected(d.date);
                  }}
                >
                  <View style={[st.day, { backgroundColor: picked ? c.accent : bg }, d.date === today && !picked && { borderWidth: 1.5, borderColor: c.accent }]}>
                    <Text style={{ color: picked ? "#fff" : fg, fontWeight: "600", fontSize: 14 }}>{Number(d.date.slice(8))}</Text>
                    {d.working ? <Text style={{ color: picked ? "#fff" : c.muted, fontSize: 9 }}>{d.start.replace(/:00$/, "")}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Card>
      )}
      {pick ? (
        <Card style={{ gap: 4 }}>
          <Text style={{ color: c.ink, fontWeight: "700", fontSize: 16 }}>{dateLongUz(new Date(`${pick.date}T07:00:00Z`))}</Text>
          <Text style={{ color: c.ink, fontSize: 15 }}>
            {pick.leave
              ? `🏖 ${LEAVE[pick.leave] || "Ta’til"}`
              : pick.working
                ? `🕘 ${pick.start} – ${pick.end}${pick.overridden ? ` · ${pick.reason || "o‘zgartirilgan"}` : ""}`
                : `🌿 Dam olish${pick.overridden ? ` · ${pick.reason || "o‘zgartirilgan"}` : ""}`}
          </Text>
          {pick.checkIn ? (
            <Text style={{ color: c.muted, fontSize: 13.5 }}>
              Keldi {pick.checkIn}
              {pick.checkOut ? ` · ketdi ${pick.checkOut} · ${duration(pick.workedMinutes)}` : ""}
              {pick.lateMinutes ? ` · ${duration(pick.lateMinutes)} kech` : ""}
            </Text>
          ) : null}
        </Card>
      ) : null}
      {data ? (
        <Card style={{ flexDirection: "row", paddingVertical: 12 }}>
          {(
            [
              [data.totals.workdays, "ish kuni"],
              [Math.round(data.totals.plannedMinutes / 60), "reja soat"],
              [data.totals.leaveDays, "ta’til kuni"],
            ] as const
          ).map(([v, l], i) => (
            <View key={l} style={[{ flex: 1, alignItems: "center" }, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line }]}>
              <Text style={{ color: c.ink, fontSize: 22, fontWeight: "700" }}>{v}</Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>{l}</Text>
            </View>
          ))}
        </Card>
      ) : null}
      {month === current && upcoming.length ? (
        <>
          <GroupTitle>Yaqin kunlar</GroupTitle>
          <Group>
            {upcoming.map((d, i) => (
              <Row key={d.date} label={`${d.date === today ? "Bugun" : weekdayShort(d.date)}, ${dateUz(d.date)}`} value={d.leave ? "Ta’til" : d.working ? `${d.start}–${d.end}` : "Dam"} last={i === upcoming.length - 1} />
            ))}
          </Group>
        </>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------- statistika --- */
function StatsView() {
  const { c } = useTheme();
  const { data, error, reload } = useData<StatsData>("/mini/stats");
  if (error) return <ErrorBox text={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const maxHours = Math.max(1, ...data.months.map((m) => m.workedHours));
  const next = [5, 10, 20, 30, 60].find((n) => n > data.streak.current);
  return (
    <>
      <Card style={{ flexDirection: "row", gap: 14, alignItems: "center", backgroundColor: c.card }}>
        <View style={[st.flame, { backgroundColor: `${c.warn}1E` }]}>
          {data.streak.badge?.emoji ? <Text style={{ fontSize: 28 }}>{data.streak.badge.emoji}</Text> : <Icon name="flame" size={28} color={c.warn} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.muted, fontSize: 13 }}>Ketma-ket vaqtida</Text>
          <Text style={{ color: c.ink, fontSize: 26, fontWeight: "800" }}>{data.streak.current} kun</Text>
          <Text style={{ color: c.muted, fontSize: 12.5 }}>
            {data.streak.badge ? `${data.streak.badge.label} · ` : ""}eng yaxshi natija: {data.streak.best} kun
          </Text>
        </View>
      </Card>
      {next ? (
        <View style={{ gap: 6, paddingHorizontal: 4 }}>
          <View style={[st.goal, { backgroundColor: c.tint }]}>
            <View style={{ width: `${Math.round((data.streak.current / next) * 100)}%`, height: "100%", backgroundColor: c.warn, borderRadius: 4 }} />
          </View>
          <Text style={{ color: c.muted, fontSize: 12.5 }}>Keyingi nishongacha {next - data.streak.current} kun vaqtida keling</Text>
        </View>
      ) : null}

      <GroupTitle>Ishlangan soatlar</GroupTitle>
      <Card style={st.chart}>
        {data.months.map((m) => (
          <View key={m.month} style={st.bar}>
            <Text style={{ color: c.muted, fontSize: 11 }}>{m.workedHours}</Text>
            <View style={[st.barTrack, { backgroundColor: c.tint }]}>
              <View style={{ height: `${Math.round((m.workedHours / maxHours) * 100)}%`, backgroundColor: c.accent, borderRadius: radius.tile / 2 }} />
            </View>
            <Text style={{ color: c.muted, fontSize: 11 }}>{m.label.split(" ")[0].slice(0, 3)}</Text>
          </View>
        ))}
      </Card>

      <GroupTitle>Oylar bo‘yicha</GroupTitle>
      <Group>
        {[...data.months].reverse().map((m, i) => (
          <Row
            key={m.month}
            label={m.label}
            value={`${m.present} kun · ${m.onTimeRate === null ? "—" : `${m.onTimeRate}%`}${m.overtimeHours ? ` · +${m.overtimeHours} s` : ""}`}
            last={i === data.months.length - 1}
          />
        ))}
      </Group>

      {data.leaderboard ? (
        <>
          <GroupTitle>Filialda vaqtida kelish (shu oy)</GroupTitle>
          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Icon name="trophy" size={20} color={c.warn} />
              <Text style={{ color: c.ink, fontSize: 15 }}>
                Siz <Text style={{ fontWeight: "700" }}>{data.leaderboard.rank > 0 ? `${data.leaderboard.rank}-o‘rin` : "—"}</Text> / {data.leaderboard.total}
              </Text>
            </View>
            {data.leaderboard.top.map((row, i) => (
              <View key={row.name + i} style={[st.top, row.me && { backgroundColor: `${c.accent}14` }]}>
                <Icon name="medal" size={16} color={["#F5B301", "#A8B0BA", "#C97A40"][i] || c.muted} />
                <Text style={{ flex: 1, color: c.ink }}>{row.me ? `${row.name} (siz)` : row.name}</Text>
                <Text style={{ color: c.ink, fontWeight: "700" }}>{row.rate}%</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}

const st = StyleSheet.create({
  calHead: { flexDirection: "row", marginBottom: 6 },
  calWeek: { width: `${100 / 7}%`, textAlign: "center", fontSize: 12, fontWeight: "600" },
  cal: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2.5 },
  day: { flex: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  restDot: { position: "absolute", bottom: 4, width: 5, height: 5, borderRadius: 3 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  histRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  dateBox: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  flame: { width: 58, height: 58, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  goal: { height: 8, borderRadius: 4, overflow: "hidden" },
  chart: { flexDirection: "row", alignItems: "flex-end", gap: 8, height: 170 },
  bar: { flex: 1, alignItems: "center", gap: 4, height: "100%" },
  barTrack: { flex: 1, width: "70%", borderRadius: 8, justifyContent: "flex-end", overflow: "hidden" },
  top: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10 },
});
