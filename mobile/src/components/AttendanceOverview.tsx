import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card, Icon, haptic } from "./ui";
import { Donut } from "./Donut";
import { dateLongUz, tashkentIsoDate } from "@/lib/format";
import { useTheme } from "@/lib/theme";

/*
 * Rahbar / HR — kunlik davomat: halqa diagramma (vaqtida, kechikkan, hali kelmagan, kelmagan,
 * ta’til, dam olish, ish vaqti boshlanmagan) va pastda har bir guruh bo‘yicha xodimlar
 * (5 tadan, «Barchasini ko‘rsatish»). Kunni ‹ › bilan almashtirish mumkin.
 */

export type OverviewRow = { state: "PRACTICE" | "IN" | "LEFT" | "ABSENT" | "ON_LEAVE" | "DAY_OFF" | "NOT_YET" | "UPCOMING"; late: boolean };
type Group = { key: string; label: string; color: string; test: (r: OverviewRow) => boolean };

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function AttendanceOverview<T extends OverviewRow>({ rows, date, onDate, render }: { rows: T[]; date: string; onDate: (date: string) => void; render: (row: T, last: boolean) => ReactNode }) {
  const { c } = useTheme();
  const today = tashkentIsoDate();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups: Group[] = [
    { key: "ontime", label: "o‘z vaqtida kelgan", color: "#22C55E", test: (r) => (r.state === "IN" || r.state === "LEFT" || r.state === "PRACTICE") && !r.late },
    { key: "late", label: "kechikib kelgan", color: "#F59E0B", test: (r) => r.late },
    { key: "notyet", label: "hali kelmagan", color: "#38BDF8", test: (r) => r.state === "NOT_YET" },
    { key: "absent", label: "kelmagan", color: "#EF4444", test: (r) => r.state === "ABSENT" },
    { key: "leave", label: "ta’tilda", color: "#8B5CF6", test: (r) => r.state === "ON_LEAVE" },
    { key: "off", label: "dam olish kuni", color: "#A5C4F3", test: (r) => r.state === "DAY_OFF" },
    { key: "upcoming", label: "ish vaqti boshlanmagan", color: "#8E9AAF", test: (r) => r.state === "UPCOMING" },
  ];
  const buckets = groups.map((g) => ({ ...g, rows: rows.filter(g.test) }));
  const shift = (n: number) => {
    haptic.select();
    onDate(addDays(date, n));
  };
  return (
    <>
      <Card style={{ gap: 14 }}>
        <View style={st.head}>
          <Pressable onPress={() => shift(-1)} hitSlop={10} style={[st.nav, { backgroundColor: c.tint }]}>
            <Icon name="chevron-back" size={18} color={c.ink} />
          </Pressable>
          <View style={{ alignItems: "center" }}>
            <Text style={{ color: c.ink, fontSize: 16, fontWeight: "600" }}>Davomat</Text>
            <Text style={{ color: c.muted, fontSize: 12.5 }}>{date === today ? "Bugun" : dateLongUz(new Date(`${date}T07:00:00Z`))}</Text>
          </View>
          <Pressable onPress={() => shift(1)} disabled={date >= today} hitSlop={10} style={[st.nav, { backgroundColor: c.tint, opacity: date >= today ? 0.35 : 1 }]}>
            <Icon name="chevron-forward" size={18} color={c.ink} />
          </Pressable>
        </View>
        <Donut slices={buckets.map((b) => ({ label: b.label, value: b.rows.length, color: b.color }))} center={String(rows.length)} />
      </Card>
      {buckets
        .filter((b) => b.rows.length)
        .map((b) => {
          const all = open[b.key];
          const list = all ? b.rows : b.rows.slice(0, 5);
          return (
            <Card key={b.key} style={{ gap: 4, paddingHorizontal: 0, paddingBottom: 4 }}>
              <View style={st.groupHead}>
                <View style={[st.dot, { backgroundColor: b.color }]} />
                <Text style={{ color: c.ink, fontWeight: "600", flex: 1 }} numberOfLines={1}>
                  {b.label[0].toUpperCase() + b.label.slice(1)} · {b.rows.length}
                </Text>
                {b.rows.length > 5 ? (
                  <Pressable onPress={() => setOpen({ ...open, [b.key]: !all })} hitSlop={8}>
                    <Text style={{ color: c.accent, fontWeight: "500" }}>{all ? "Yig‘ish" : "Barchasini ko‘rsatish"}</Text>
                  </Pressable>
                ) : null}
              </View>
              {list.map((r, i) => render(r, i === list.length - 1))}
            </Card>
          );
        })}
    </>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  nav: { width: 40, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
