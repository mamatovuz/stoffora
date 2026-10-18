import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { errorText } from "@/lib/api";
import { mediaUri } from "@/lib/config";
import { duration, tashkentIsoDate } from "@/lib/format";
import { can, mcall, openPanelFile } from "@/lib/manager";
import { typo, useTheme } from "@/lib/theme";
import { AttendanceEditSheet, type EditTarget } from "./AttendanceEditSheet";
import { Card, Empty, ErrorBox, Icon, Loading, haptic } from "./ui";

/*
 * Tabel ilovada (saytdagi «Keldi-ketdi → Tabel» bilan bir xil ma’lumot): barcha xodimlar × oy kunlari.
 * Ism ustuni joyida turadi, kunlar gorizontal suriladi (bugungi kun ko‘rinadigan joyga o‘tadi).
 * Katakda — keldi (yuqorida) va ketdi (pastda), rang — holat. Katak bosilsa — davomatni tuzatish
 * (attendance.edit huquqi bo‘lsa) yoki kun tafsiloti.
 */

type State = "PLANNED" | "ON_TIME" | "LATE" | "IN" | "NO_CHECKOUT" | "ABSENT" | "REST" | "REST_WORKED" | "LEAVE" | "BEFORE_START";
type Cell = { date: string; state: State; in?: string; out?: string; late: number; early: number; worked: number; plan?: string; leave?: string; reason?: string; manual: boolean; recordId?: string; branch?: string };
type Row = {
  employee: { id: string; name: string; employeeNo: string; photo?: string };
  branch: string;
  position: string;
  cells: Cell[];
  totals: { present: number; late: number; lateMinutes: number; absent: number; workedMinutes: number };
};
type Grid = { month: string; label: string; today: string; dates: { date: string; weekday: number; holiday?: string }[]; rows: Row[] };

const DAY_W = 50;
const ROW_H = 48;
const NAME_W = 132;
const WEEKDAY = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
const shiftMonth = (month: string, delta: number) => {
  const d = new Date(`${month}-15T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
};

export function TimesheetGrid({ role }: { role: string }) {
  const { c } = useTheme();
  // Joriy oy (Toshkent) — bir marta, birinchi chizishda.
  const [current] = useState(() => tashkentIsoDate().slice(0, 7));
  const [month, setMonth] = useState(current);
  const [data, setData] = useState<Grid | null>(null);
  const [error, setError] = useState("");
  const [branch, setBranch] = useState("");
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const scroll = useRef<ScrollView>(null);
  const canEdit = can(role, "attendance.edit");

  useEffect(() => {
    let live = true;
    mcall<Grid>(`/attendance/grid?month=${month}`)
      .then((g) => {
        if (!live) return;
        setData(g);
        setError("");
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [month, version]);

  const tone = (s: State) =>
    ({ ON_TIME: c.success, IN: c.success, REST_WORKED: c.success, LATE: c.warn, NO_CHECKOUT: c.accent, ABSENT: c.danger, LEAVE: c.violet, REST: c.muted, PLANNED: c.muted, BEFORE_START: c.muted })[s];
  const shown = data?.month === month ? data : null;
  const branches = useMemo(() => [...new Set((shown?.rows || []).map((r) => r.branch).filter(Boolean))], [shown]);
  const rows = (shown?.rows || []).filter((r) => !branch || r.branch === branch);
  const todayIndex = shown ? shown.dates.findIndex((d) => d.date === shown.today) : -1;

  const open = (row: Row, cell: Cell) => {
    haptic.select();
    if (canEdit && shown && cell.date <= shown.today && cell.state !== "BEFORE_START") {
      setEditing({
        employeeId: row.employee.id,
        employeeName: row.employee.name,
        date: cell.date,
        plan: cell.plan,
        record: cell.recordId ? { id: cell.recordId, checkIn: cell.in, checkOut: cell.out } : undefined,
      });
      return;
    }
    Alert.alert(
      `${row.employee.name} · ${Number(cell.date.slice(8))}-kun`,
      [
        cell.plan ? `Grafik: ${cell.plan}` : "Dam olish kuni",
        cell.in ? `Keldi ${cell.in}${cell.out ? ` · ketdi ${cell.out}` : ""}` : "",
        cell.late ? `Kechikdi: ${duration(cell.late)}` : "",
        cell.worked ? `Ishladi: ${duration(cell.worked)}` : "",
        cell.branch ? `Filial: ${cell.branch}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  };

  return (
    <>
      <View style={st.monthBar}>
        <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={10} style={[st.nav, { backgroundColor: c.card }]} accessibilityLabel="Oldingi oy">
          <Icon name="chevron-back" size={18} color={c.accent} />
        </Pressable>
        <Text style={[typo.title, { color: c.ink, textTransform: "capitalize" }]}>{shown?.label || month}</Text>
        <Pressable onPress={() => setMonth(shiftMonth(month, 1))} disabled={month >= current} hitSlop={10} style={[st.nav, { backgroundColor: c.card, opacity: month >= current ? 0.35 : 1 }]} accessibilityLabel="Keyingi oy">
          <Icon name="chevron-forward" size={18} color={c.accent} />
        </Pressable>
      </View>
      {branches.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
          {["", ...branches].map((b) => (
            <Pressable key={b || "all"} onPress={() => (haptic.select(), setBranch(b))} style={[st.chip, { backgroundColor: branch === b ? c.ink : c.card }]}>
              <Text style={[typo.sub, { color: branch === b ? c.card : c.ink, fontWeight: "600" }]}>{b || "Barcha filiallar"}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {error ? <ErrorBox text={error} onRetry={() => setVersion((v) => v + 1)} /> : null}
      {!shown && !error ? (
        <Loading />
      ) : shown && !rows.length ? (
        <Empty icon="calendar-outline" title="Xodim yo‘q" />
      ) : shown ? (
        <Card style={{ padding: 0 }}>
          <View style={{ flexDirection: "row" }}>
            {/* Ism ustuni — joyida turadi */}
            <View style={{ width: NAME_W, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.line }}>
              <View style={[st.head, { paddingHorizontal: 12, alignItems: "flex-start", backgroundColor: c.tint }]}>
                <Text style={[typo.caption, { color: c.muted }]}>Xodim</Text>
              </View>
              {rows.map((row) => (
                <View key={row.employee.id} style={[st.nameRow, { borderTopColor: c.line }]}>
                  {row.employee.photo ? (
                    <Image source={{ uri: mediaUri(row.employee.photo) }} style={st.avatar} />
                  ) : (
                    <View style={[st.avatar, { backgroundColor: `${c.accent}1A`, alignItems: "center", justifyContent: "center" }]}>
                      <Text style={{ color: c.accent, fontSize: 10, fontWeight: "700" }}>{row.employee.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</Text>
                    </View>
                  )}
                  <Text style={[typo.sub, { flex: 1, color: c.ink, fontWeight: "600" }]} numberOfLines={2}>
                    {row.employee.name}
                  </Text>
                </View>
              ))}
            </View>
            {/* Kunlar — gorizontal */}
            <ScrollView
              ref={scroll}
              horizontal
              showsHorizontalScrollIndicator={false}
              onLayout={() => {
                if (todayIndex > 3) setTimeout(() => scroll.current?.scrollTo({ x: (todayIndex - 3) * DAY_W, animated: false }), 0);
              }}
            >
              <View>
                <View style={{ flexDirection: "row", backgroundColor: c.tint }}>
                  {shown.dates.map((d) => {
                    const off = d.weekday === 0 || Boolean(d.holiday);
                    const today = d.date === shown.today;
                    return (
                      <View key={d.date} style={[st.head, { width: DAY_W }, today && { backgroundColor: `${c.accent}22` }]}>
                        <Text style={{ color: today ? c.accent : off ? c.danger : c.ink, fontSize: 13, fontWeight: "700" }}>{Number(d.date.slice(8))}</Text>
                        <Text style={{ color: off ? c.danger : c.muted, fontSize: 10 }}>{WEEKDAY[d.weekday]}</Text>
                      </View>
                    );
                  })}
                  {["Keldi", "Kech", "Kelm.", "Soat"].map((h) => (
                    <View key={h} style={[st.head, { width: 52 }]}>
                      <Text style={[typo.caption, { color: c.muted }]}>{h}</Text>
                    </View>
                  ))}
                </View>
                {rows.map((row) => (
                  <View key={row.employee.id} style={{ flexDirection: "row" }}>
                    {row.cells.map((cell) => {
                      const color = tone(cell.state);
                      const filled = cell.state !== "PLANNED" && cell.state !== "BEFORE_START" && cell.state !== "REST";
                      return (
                        <Pressable
                          key={cell.date}
                          onPress={() => open(row, cell)}
                          style={({ pressed }) => [
                            st.cell,
                            { borderTopColor: c.line, borderLeftColor: c.line, backgroundColor: filled ? `${color}1F` : cell.state === "REST" ? c.tint : "transparent" },
                            cell.date === shown.today && { borderLeftColor: c.accent, borderLeftWidth: 1.5 },
                            pressed && { opacity: 0.6 },
                          ]}
                          accessibilityLabel={`${row.employee.name}, ${Number(cell.date.slice(8))}-kun`}
                        >
                          {cell.in ? (
                            <>
                              <Text style={[st.time, { color }]}>{cell.in}</Text>
                              <Text style={[st.time, { color: c.muted }]}>{cell.out || (cell.state === "IN" ? "…" : "—")}</Text>
                            </>
                          ) : cell.state === "ABSENT" ? (
                            <Text style={{ color, fontWeight: "700" }}>✕</Text>
                          ) : cell.state === "LEAVE" ? (
                            <Text style={{ color, fontWeight: "700" }}>T</Text>
                          ) : null}
                          {cell.manual ? <Text style={[st.mark, { color: c.accent, top: 1 }]}>✎</Text> : null}
                          {cell.branch ? <Text style={[st.mark, { color: c.violet, bottom: 1 }]}>↗</Text> : null}
                        </Pressable>
                      );
                    })}
                    {(
                      [
                        [row.totals.present, c.ink],
                        [row.totals.late, row.totals.late ? c.warn : c.muted],
                        [row.totals.absent, row.totals.absent ? c.danger : c.muted],
                        [Math.round(row.totals.workedMinutes / 60), c.ink],
                      ] as const
                    ).map(([value, color], i) => (
                      <View key={i} style={[st.cell, { width: 52, borderTopColor: c.line, borderLeftColor: c.line }]}>
                        <Text style={{ color, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{value || "—"}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </Card>
      ) : null}
      <View style={st.legend}>
        {(
          [
            [c.success, "Vaqtida"],
            [c.warn, "Kechikdi"],
            [c.accent, "Ketish yo‘q"],
            [c.danger, "Kelmadi ✕"],
            [c.violet, "Ta’til T"],
          ] as const
        ).map(([color, label]) => (
          <View key={label} style={st.legendItem}>
            <View style={[st.legendDot, { backgroundColor: color }]} />
            <Text style={[typo.caption, { color: c.muted }]}>{label}</Text>
          </View>
        ))}
        <Text style={[typo.caption, { color: c.muted }]}>✎ tuzatilgan · ↗ boshqa filial</Text>
      </View>
      <Pressable
        onPress={() => void openPanelFile(`/attendance/grid.xlsx?month=${month}`).catch((e) => Alert.alert("Xatolik", errorText(e)))}
        style={({ pressed }) => [st.excel, { backgroundColor: c.card, opacity: pressed ? 0.6 : 1 }]}
      >
        <Icon name="document-text-outline" size={18} color={c.accent} />
        <Text style={[typo.bodyStrong, { color: c.accent }]}>Excel’da ochish</Text>
      </Pressable>
      {canEdit ? (
        <AttendanceEditSheet
          target={editing}
          save={(path, body, method) => mcall(path, body, method)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setVersion((v) => v + 1);
          }}
        />
      ) : null}
    </>
  );
}

const st = StyleSheet.create({
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  nav: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99 },
  head: { height: 42, alignItems: "center", justifyContent: "center" },
  nameRow: { height: ROW_H, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, borderTopWidth: StyleSheet.hairlineWidth },
  avatar: { width: 26, height: 26, borderRadius: 13 },
  cell: { width: DAY_W, height: ROW_H, alignItems: "center", justifyContent: "center", borderTopWidth: StyleSheet.hairlineWidth, borderLeftWidth: StyleSheet.hairlineWidth },
  time: { fontSize: 11, fontWeight: "600", fontVariant: ["tabular-nums"] },
  mark: { position: "absolute", right: 3, fontSize: 9, fontWeight: "700" },
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, paddingHorizontal: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  excel: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 14 },
});
