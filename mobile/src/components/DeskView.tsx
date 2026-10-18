import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { errorText } from "@/lib/api";
import { som } from "@/lib/format";
import { can, mcall } from "@/lib/manager";
import { typo, useTheme } from "@/lib/theme";
import { Card, Empty, ErrorBox, Group, GroupTitle, Icon, Loading, Stats } from "./ui";

/*
 * Ish stoli (ilova): Action Center — «bugun nima qilishim kerak» (rolga mos), direktor/HR uchun
 * Control Center (bugun, oy pullari, filiallar), filial rahbari uchun smena markazi (bugun + ertaga).
 * Ko‘rinish minimal: bitta statistika kartasi, muhimlik bo‘yicha saralangan vazifalar, so‘ng tafsilotlar.
 */

type Action = { level: "red" | "orange" | "yellow" | "info"; text: string; count: number; view?: string };
type Overview = {
  today: { employees: number; planned: number; came: number; late: number; absent: number; notYet: number; noCheckout: number };
  money: { net: number; advance: number; bonus: number; fine: number; overtime: number } | null;
  branches: { id: string; name: string; planned: number; came: number; late: number; absent: number; rate: number }[];
};
type Shift = {
  id: string;
  name: string;
  today: { planned: number; came: number; late: number; absent: number; notYet: number; noCheckout: number };
  window: { start: string; end: string } | null;
  issues: { employeeId: string; name: string; text: string; tone: "bad" | "warn" }[];
  tomorrow: { date: string; planned: number; onLeave: number; required?: number; shortage: number };
};
const DOT = { red: "#FF3B30", orange: "#FF9500", yellow: "#FFCC00", info: "#0A84FF" };
const ORDER = { red: 0, orange: 1, yellow: 2, info: 3 };

export function DeskView({ role, onOpen, reloadKey }: { role: string; onOpen: (view: string) => void; reloadKey: number }) {
  const { c } = useTheme();
  const [actions, setActions] = useState<Action[] | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    mcall<{ actions: Action[] }>("/workspace/actions")
      .then((r) => setActions(r.actions))
      .catch((e) => setError(errorText(e)));
    if (can(role, "attendance.view") && role !== "BRANCH_MANAGER") mcall<Overview>("/workspace/overview").then(setOverview).catch(() => undefined);
    if (role === "BRANCH_MANAGER") mcall<Shift[]>("/workspace/branch-shift").then(setShifts).catch(() => undefined);
  }, [role, reloadKey]);

  // Muammolar birinchi: qizil → to‘q sariq → sariq → ma’lumot.
  const list = [...(actions || [])].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const line = (i: number, total: number) => i < total - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line };
  return (
    <>
      {error ? <ErrorBox text={error} /> : null}
      {overview ? (
        <Stats
          title="Bugun"
          items={[
            { value: overview.today.planned, label: "rejada", onPress: () => onOpen("today:ALL") },
            { value: overview.today.came, label: "keldi", color: c.success, onPress: () => onOpen("today:IN") },
            { value: overview.today.late, label: "kechikdi", color: overview.today.late ? c.warn : c.ink, onPress: () => onOpen("today:LATE") },
            { value: overview.today.absent, label: "kelmadi", color: overview.today.absent ? c.danger : c.ink, onPress: () => onOpen("today:ABSENT") },
          ]}
        />
      ) : null}

      {shifts?.map((s) => (
        <Card key={s.id} style={{ gap: 14 }}>
          <View style={{ gap: 2 }}>
            <Text style={[typo.title, { color: c.ink }]}>{s.name}</Text>
            {s.window ? <Text style={[typo.sub, { color: c.muted }]}>Bugungi smena {s.window.start}–{s.window.end}</Text> : null}
          </View>
          <View style={{ flexDirection: "row" }}>
            {(
              [
                [s.today.planned, "rejada", c.ink],
                [s.today.came, "keldi", c.success],
                [s.today.late, "kechikdi", s.today.late ? c.warn : c.ink],
                [s.today.absent, "kelmadi", s.today.absent ? c.danger : c.ink],
              ] as const
            ).map(([value, label, color], i) => (
              <View key={label} style={[st.tile, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line }]}>
                <Text style={[typo.stat, { color }]}>{value}</Text>
                <Text style={[typo.caption, { color: c.muted }]}>{label}</Text>
              </View>
            ))}
          </View>
          {s.issues.length ? (
            <View style={{ gap: 0 }}>
              {s.issues.slice(0, 8).map((issue, i, all) => (
                <Pressable
                  key={`${issue.employeeId}:${issue.text}`}
                  onPress={() => router.push({ pathname: "/employee/[id]", params: { id: issue.employeeId } })}
                  style={({ pressed }) => [st.issue, line(i, all.length), pressed && { opacity: 0.6 }]}
                >
                  <View style={[st.dot, { backgroundColor: issue.tone === "bad" ? c.danger : c.warn }]} />
                  <Text style={[typo.bodyStrong, { color: c.ink, flexShrink: 1 }]} numberOfLines={1}>
                    {issue.name}
                  </Text>
                  <Text style={[typo.sub, { color: c.muted, flex: 1, textAlign: "right" }]} numberOfLines={1}>
                    {issue.text}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={[st.tomorrow, { backgroundColor: c.tint }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[typo.bodyStrong, { color: c.ink }]}>Ertaga</Text>
              <Text style={[typo.sub, { color: c.muted }]}>
                Rejada {s.tomorrow.planned} xodim{s.tomorrow.required ? ` · kerak ${s.tomorrow.required}` : ""}
                {s.tomorrow.onLeave ? ` · ta’tilda ${s.tomorrow.onLeave}` : ""}
              </Text>
            </View>
            {s.tomorrow.shortage ? (
              <Text style={[typo.sub, { color: c.danger, fontWeight: "600" }]}>−{s.tomorrow.shortage} xodim</Text>
            ) : s.tomorrow.required ? (
              <Icon name="checkmark-circle" size={20} color={c.success} />
            ) : null}
          </View>
        </Card>
      ))}

      <GroupTitle>Bugungi vazifalar</GroupTitle>
      {!actions ? (
        <Loading />
      ) : !list.length ? (
        <Empty icon="checkmark-done-outline" title="Hammasi joyida" text="Hozircha e’tibor talab qiladigan ish yo‘q." />
      ) : (
        <Group>
          {list.map((a, i) => (
            <Pressable
              key={a.text}
              disabled={!a.view}
              onPress={() => a.view && onOpen(a.view === "inbox" ? "requests" : a.view)}
              style={({ pressed }) => [st.row, line(i, list.length), pressed && { opacity: 0.6 }]}
            >
              <View style={[st.dot, { backgroundColor: DOT[a.level] }]} />
              <Text style={[typo.body, { flex: 1, color: c.ink }]} numberOfLines={2}>
                {a.text}
              </Text>
              <View style={[st.count, { backgroundColor: a.level === "red" ? `${c.danger}1A` : c.tint }]}>
                <Text style={[typo.bodyStrong, { color: a.level === "red" ? c.danger : c.ink, fontVariant: ["tabular-nums"] }]}>{a.count}</Text>
              </View>
              {a.view ? <Icon name="chevron-forward" size={16} color={c.muted} /> : null}
            </Pressable>
          ))}
        </Group>
      )}

      {overview?.money ? (
        <>
          <GroupTitle>Bu oy (bugungacha)</GroupTitle>
          <Group>
            {(
              [
                ["Ish haqi", overview.money.net, c.ink],
                ["Avans", overview.money.advance, c.ink],
                ["Bonus va qo‘shimcha ish", overview.money.bonus + overview.money.overtime, c.success],
                ["Jarima", overview.money.fine, c.danger],
              ] as const
            ).map(([label, value, color], i) => (
              <View key={label} style={[st.row, line(i, 4)]}>
                <Text style={[typo.body, { flex: 1, color: c.ink }]}>{label}</Text>
                <Text style={[typo.bodyStrong, { color: value ? color : c.muted, fontVariant: ["tabular-nums"] }]}>{som(value)}</Text>
              </View>
            ))}
          </Group>
        </>
      ) : null}

      {overview && overview.branches.length > 1 ? (
        <>
          <GroupTitle>Filiallar — bugun</GroupTitle>
          <Group>
            {overview.branches.slice(0, 8).map((b, i, all) => (
              <View key={b.id} style={[st.row, line(i, all.length)]}>
                <Text style={[typo.body, { flex: 1, color: c.ink }]} numberOfLines={1}>
                  {b.name}
                </Text>
                <View style={[st.meter, { backgroundColor: c.tint }]}>
                  <View style={{ width: `${b.rate}%`, height: "100%", borderRadius: 3, backgroundColor: b.rate >= 90 ? c.success : b.rate >= 70 ? c.warn : c.danger }} />
                </View>
                <Text style={[typo.sub, { width: 48, textAlign: "right", color: c.muted, fontVariant: ["tabular-nums"] }]}>
                  {b.came}/{b.planned}
                </Text>
              </View>
            ))}
          </Group>
        </>
      ) : null}
    </>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 50, paddingVertical: 10 },
  issue: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  tile: { flex: 1, alignItems: "center", gap: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  count: { minWidth: 32, height: 26, paddingHorizontal: 8, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  meter: { width: 72, height: 6, borderRadius: 3, overflow: "hidden" },
  tomorrow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12 },
});
