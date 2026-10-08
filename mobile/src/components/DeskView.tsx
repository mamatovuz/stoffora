import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { errorText } from "@/lib/api";
import { som } from "@/lib/format";
import { can, mcall } from "@/lib/manager";
import { useTheme } from "@/lib/theme";
import { Card, Empty, ErrorBox, Group, GroupTitle, Icon, Loading, Segmented } from "./ui";

/*
 * Ish stoli (ilova): Action Center — «bugun nima qilishim kerak» (rolga mos), direktor/HR uchun
 * Control Center (bugun, oy pullari, filiallar), filial rahbari uchun smena markazi (bugun + ertaga).
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

export function DeskView({ role, onOpen, reloadKey }: { role: string; onOpen: (view: string) => void; reloadKey: number }) {
  const { c } = useTheme();
  const [actions, setActions] = useState<Action[] | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [error, setError] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  useEffect(() => {
    mcall<{ actions: Action[] }>("/workspace/actions")
      .then((r) => setActions(r.actions))
      .catch((e) => setError(errorText(e)));
    if (can(role, "attendance.view") && role !== "BRANCH_MANAGER") mcall<Overview>("/workspace/overview").then(setOverview).catch(() => undefined);
    if (role === "BRANCH_MANAGER") mcall<Shift[]>("/workspace/branch-shift").then(setShifts).catch(() => undefined);
  }, [role, reloadKey]);

  const list = (actions || []).filter((a) => !onlyProblems || a.level === "red" || a.level === "orange");
  const tile = (value: number | string, label: string, color: string) => (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={{ color, fontSize: 22, fontWeight: "700" }}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 11.5 }}>{label}</Text>
    </View>
  );
  return (
    <>
      {error ? <ErrorBox text={error} /> : null}
      {overview ? (
        <>
          <Card style={{ flexDirection: "row", paddingVertical: 14 }}>
            {tile(overview.today.planned, "rejada", c.ink)}
            {tile(overview.today.came, "keldi", c.success)}
            {tile(overview.today.late, "kechikdi", c.warn)}
            {tile(overview.today.absent, "kelmadi", c.danger)}
          </Card>
          {overview.money ? (
            <Card style={{ gap: 6 }}>
              <Text style={{ color: c.muted, fontSize: 12.5 }}>Bu oy (bugungacha)</Text>
              {(
                [
                  ["Ish haqi", overview.money.net, c.ink],
                  ["Avans", overview.money.advance, c.ink],
                  ["Bonus va overtime", overview.money.bonus + overview.money.overtime, c.success],
                  ["Jarima", overview.money.fine, c.danger],
                ] as const
              ).map(([label, value, color]) => (
                <View key={label} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: c.ink, fontSize: 15 }}>{label}</Text>
                  <Text style={{ color, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{som(value)}</Text>
                </View>
              ))}
            </Card>
          ) : null}
          {overview.branches.length > 1 ? (
            <>
              <GroupTitle>Filiallar — bugun</GroupTitle>
              <Group>
                {overview.branches.slice(0, 8).map((b, i, all) => (
                  <View key={b.id} style={[st.row, i < all.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
                    <Text style={{ flex: 1, color: c.ink, fontWeight: "600" }} numberOfLines={1}>
                      {b.name}
                    </Text>
                    <View style={[st.meter, { backgroundColor: c.tint }]}>
                      <View style={{ width: `${b.rate}%`, height: "100%", borderRadius: 3, backgroundColor: b.rate >= 90 ? c.success : b.rate >= 70 ? c.warn : c.danger }} />
                    </View>
                    <Text style={{ width: 54, textAlign: "right", color: c.muted, fontVariant: ["tabular-nums"] }}>
                      {b.came}/{b.planned}
                    </Text>
                  </View>
                ))}
              </Group>
            </>
          ) : null}
        </>
      ) : null}

      {shifts?.map((s) => (
        <Card key={s.id} style={{ gap: 10 }}>
          <Text style={{ color: c.ink, fontWeight: "700", fontSize: 16 }}>
            {s.name} · bugun {s.window ? `${s.window.start}–${s.window.end}` : ""}
          </Text>
          <View style={{ flexDirection: "row" }}>
            {tile(s.today.planned, "rejada", c.ink)}
            {tile(s.today.came, "keldi", c.success)}
            {tile(s.today.late, "kechikdi", c.warn)}
            {tile(s.today.absent, "kelmagan", c.danger)}
          </View>
          {s.issues.slice(0, 8).map((i) => (
            <Pressable key={`${i.employeeId}:${i.text}`} onPress={() => router.push({ pathname: "/employee/[id]", params: { id: i.employeeId } })}>
              <Text style={{ color: i.tone === "bad" ? c.danger : c.warn, fontSize: 14 }}>
                {i.name} — {i.text}
              </Text>
            </Pressable>
          ))}
          <View style={[st.tomorrow, { backgroundColor: s.tomorrow.shortage ? `${c.danger}14` : `${c.success}14` }]}>
            <Text style={{ color: c.ink, fontWeight: "600" }}>Ertaga</Text>
            <Text style={{ color: c.muted, fontSize: 13.5 }}>
              Rejada {s.tomorrow.planned} xodim{s.tomorrow.required ? ` · kerak ${s.tomorrow.required}` : ""}
              {s.tomorrow.onLeave ? ` · ta’tilda ${s.tomorrow.onLeave}` : ""}
            </Text>
            {s.tomorrow.shortage ? <Text style={{ color: c.danger, fontWeight: "600" }}>{s.tomorrow.shortage} xodim yetishmaydi</Text> : s.tomorrow.required ? <Text style={{ color: c.success }}>Smena tayyor</Text> : null}
          </View>
        </Card>
      ))}

      <GroupTitle>Sizning bugungi ishlaringiz</GroupTitle>
      <Segmented<"all" | "problems">
        value={onlyProblems ? "problems" : "all"}
        onChange={(v) => setOnlyProblems(v === "problems")}
        options={[
          ["all", "Hammasi"],
          ["problems", "Faqat muammolar"],
        ]}
      />
      {!actions ? (
        <Loading />
      ) : !list.length ? (
        <Empty icon="checkmark-done-outline" title="Hammasi joyida" text="Hozircha e’tibor talab qiladigan ish yo‘q." />
      ) : (
        <Group>
          {list.map((a, i) => (
            <Pressable
              key={a.text}
              onPress={() => a.view && onOpen(a.view === "inbox" ? "requests" : a.view)}
              style={({ pressed }) => [st.row, i < list.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }, pressed && { opacity: 0.6 }]}
            >
              <View style={[st.dot, { backgroundColor: DOT[a.level] }]} />
              <Text style={{ color: c.ink, fontSize: 18, fontWeight: "700", minWidth: 30 }}>{a.count}</Text>
              <Text style={{ flex: 1, color: c.ink, fontSize: 14.5 }}>{a.text}</Text>
              {a.view ? <Icon name="chevron-forward" size={16} color={c.muted} /> : null}
            </Pressable>
          ))}
        </Group>
      )}
    </>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  meter: { width: 80, height: 6, borderRadius: 3, overflow: "hidden" },
  tomorrow: { padding: 12, borderRadius: 12, gap: 2 },
});
