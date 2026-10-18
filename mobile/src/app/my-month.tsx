import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { Card, ErrorBox, Group, GroupTitle, Icon, Loading, Row, Screen, haptic } from "@/components/ui";
import { duration, som, tashkentIsoDate } from "@/lib/format";
import { go } from "@/lib/nav";
import { typo, useTheme } from "@/lib/theme";
import type { Salary } from "@/lib/types";
import { useData } from "@/lib/useData";

/*
 * «Mening oyim» — xodimning shu oydagi hamma ko‘rsatkichi bir joyda: kelgan kunlar, vaqtida / kechikkan /
 * kelmagan, ishlangan soat va reja, taxminiy oylik, vaqtida kelish seriyasi va oy kunlari rangli to‘rda.
 * Batafsil — taqvim va «Mening oyligim» ekranlarida.
 */

type Tone = "ontime" | "late" | "absent" | "leave" | "off" | "future" | "working" | "restwork" | "none";
type MonthData = {
  label: string;
  today: string;
  days: { date: string; tone: Tone; checkIn?: string }[];
  stats: { ontime: number; late: number; absent: number; leave: number; remaining: number; plannedMinutes: number; workedMinutes: number; lateMinutes: number; overtimeMinutes: number };
};
type StatsData = { streak: { current: number; best: number; badge: { emoji: string; label: string } | null } };

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEK = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
const BADGES = [5, 10, 20, 30, 60];

export default function MyMonth() {
  const { c } = useTheme();
  const month = tashkentIsoDate().slice(0, 7);
  const history = useData<MonthData>(`/mini/history?month=${month}`);
  const stats = useData<StatsData>("/mini/stats", { maxAgeMs: 5 * 60_000 });
  const salary = useData<Salary>("/mini/salary", { maxAgeMs: 60_000 });
  const [hidden, setHidden] = useState(true);
  const refresh = () => {
    void history.reload();
    void stats.reload();
    void salary.reload();
  };
  if (!history.data && history.loading)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  if (!history.data) return <Screen><ErrorBox text={history.error || "Ma’lumot yuklanmadi"} onRetry={refresh} /></Screen>;

  const m = history.data;
  const s = m.stats;
  const came = s.ontime + s.late;
  const planned = came + s.absent + s.remaining;
  const rate = came + s.absent ? Math.round((s.ontime / (came + s.absent)) * 100) : 100;
  const streak = stats.data?.streak;
  const next = streak ? BADGES.find((n) => n > streak.current) : undefined;
  const color: Record<Tone, string> = { ontime: c.success, working: c.success, restwork: c.accent, late: c.warn, absent: c.danger, leave: c.violet, off: c.tint, future: "transparent", none: "transparent" };
  const offset = m.days.length ? (new Date(`${m.days[0].date}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;

  return (
    <Screen refreshing={history.loading} onRefresh={refresh}>
      {/* --------------------------------------------- asosiy raqamlar --- */}
      <Card style={{ gap: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
          <Text style={[typo.title, { color: c.ink, textTransform: "capitalize" }]}>{m.label}</Text>
          <Text style={[typo.sub, { color: c.muted }]}>
            {came}/{planned} ish kuni
          </Text>
        </View>
        <View style={[st.bar, { backgroundColor: c.tint }]}>
          {(
            [
              [s.ontime, c.success],
              [s.late, c.warn],
              [s.absent, c.danger],
              [s.leave, c.violet],
            ] as const
          )
            .filter(([v]) => v > 0)
            .map(([v, col], i) => (
              <View key={i} style={{ flex: v, backgroundColor: col }} />
            ))}
          {s.remaining > 0 ? <View style={{ flex: s.remaining }} /> : null}
        </View>
        <View style={{ flexDirection: "row" }}>
          {(
            [
              [s.ontime, "vaqtida", c.success],
              [s.late, "kechikdi", s.late ? c.warn : c.ink],
              [s.absent, "kelmadi", s.absent ? c.danger : c.ink],
              [`${rate}%`, "intizom", c.ink],
            ] as const
          ).map(([value, label, col], i) => (
            <View key={label} style={[st.tile, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line }]}>
              <Text style={[typo.stat, { color: col }]}>{value}</Text>
              <Text style={[typo.caption, { color: c.muted }]}>{label}</Text>
            </View>
          ))}
        </View>
      </Card>

      {/* ------------------------------------------------- oy kunlari --- */}
      <Card style={{ gap: 8 }}>
        <View style={st.grid}>
          {ORDER.map((d) => (
            <Text key={d} style={[st.cell, typo.caption, { color: c.muted, textAlign: "center" }]}>
              {WEEK[d]}
            </Text>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <View key={`b${i}`} style={st.cell} />
          ))}
          {m.days.map((d) => {
            const bg = color[d.tone];
            const solid = bg !== "transparent" && d.tone !== "off";
            return (
              <View key={d.date} style={st.cell}>
                <View style={[st.day, { backgroundColor: solid ? `${bg}26` : bg }, d.date === m.today && { borderWidth: 1.5, borderColor: c.accent }]}>
                  <Text style={{ color: solid ? bg : c.muted, fontSize: 12.5, fontWeight: "700" }}>{Number(d.date.slice(8))}</Text>
                </View>
              </View>
            );
          })}
        </View>
        <Pressable onPress={() => (haptic.select(), go("/(tabs)/history"))} style={st.more} hitSlop={6}>
          <Text style={[typo.sub, { color: c.accent, fontWeight: "600" }]}>Batafsil taqvim</Text>
          <Icon name="chevron-forward" size={14} color={c.accent} />
        </Pressable>
      </Card>

      {/* ------------------------------------------------ vaqt va seriya --- */}
      <GroupTitle>Vaqt</GroupTitle>
      <Group>
        <Row icon="time-outline" label="Ishlangan" value={`${duration(s.workedMinutes)} / ${duration(s.plannedMinutes)}`} />
        <Row icon="alarm-outline" iconColor={c.warn} label="Jami kechikish" value={s.lateMinutes ? duration(s.lateMinutes) : "yo‘q"} />
        <Row icon="trending-up-outline" iconColor={c.success} label="Qo‘shimcha ish" value={s.overtimeMinutes ? duration(s.overtimeMinutes) : "—"} last />
      </Group>
      {streak ? (
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Text style={{ fontSize: 30 }}>{streak.badge?.emoji || "🔥"}</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[typo.bodyStrong, { color: c.ink }]}>Ketma-ket vaqtida: {streak.current} kun</Text>
            <Text style={[typo.sub, { color: c.muted }]}>
              Rekord: {streak.best} kun{next ? ` · keyingi nishongacha ${next - streak.current} kun` : ""}
            </Text>
          </View>
        </Card>
      ) : null}

      {/* ------------------------------------------------------- pul --- */}
      {salary.data?.base ? (
        <>
          <GroupTitle>Oylik (taxminiy)</GroupTitle>
          <Card style={{ gap: 10 }} onPress={() => go("/salary")}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={[typo.sub, { color: c.muted }]}>Qo‘lga tegadi (bugungi holat)</Text>
                <Text style={{ color: c.ink, fontSize: 26, fontWeight: "700", letterSpacing: -0.5 }}>{hidden ? "••• ••• so‘m" : som(salary.data.net)}</Text>
              </View>
              <Pressable onPress={() => (haptic.select(), setHidden(!hidden))} hitSlop={12} accessibilityLabel={hidden ? "Ko‘rsatish" : "Yashirish"}>
                <Icon name={hidden ? "eye-outline" : "eye-off-outline"} size={22} color={c.muted} />
              </Pressable>
            </View>
            <Text style={[typo.sub, { color: c.muted }]}>
              Ishlab topildi: {hidden ? "•••" : som(salary.data.earnedToDate)} · {salary.data.days}/{salary.data.workingDays} kun
              {salary.data.advance ? ` · avans ${hidden ? "•••" : som(salary.data.advance)}` : ""}
            </Text>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  bar: { flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", gap: 2 },
  tile: { flex: 1, alignItems: "center", gap: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 3 },
  day: { flex: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  more: { flexDirection: "row", alignItems: "center", alignSelf: "flex-end", gap: 2 },
});
