import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { som, tashkentIsoDate } from "@/lib/format";
import { can, mcall } from "@/lib/manager";
import { typo, useTheme } from "@/lib/theme";
import { LiveFeed } from "./ManagerExtras";
import { Button, Card, Empty, Group, GroupTitle, Icon, Loading, Row, Stats } from "./ui";

/*
 * «Umumiy» — toza ko‘rinish, vazifalar ro‘yxatisiz: bugun (rejada / keldi / kechikdi / kelmadi),
 * so‘nggi kelganlar, filiallar foizi va (huquq bo‘lsa) shu oy pullari. Filial rahbari — o‘z smenasi
 * va ertangi tayyorlik. Moliya (davomat ko‘rmaydi) — shu oy xulosasi. Amallar — «Boshqaruv»da.
 */

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
  tomorrow: { date: string; planned: number; onLeave: number; required?: number; shortage: number };
};
type Finance = { net: number; employees: number; bonus: number; advances: { pendingCount: number; unpaidCount: number }; pendingFines: number };
type FeedRow = Parameters<typeof LiveFeed>[0]["rows"][number];

export function DeskView({
  role,
  rows,
  onOpen,
  onAdmin,
  reloadKey,
}: {
  role: string;
  /** Bugungi davomat qatorlari (so‘nggi kelganlar uchun). */
  rows?: FeedRow[];
  onOpen: (view: string) => void;
  onAdmin: () => void;
  reloadKey: number;
}) {
  const { c } = useTheme();
  const attendance = can(role, "attendance.view");
  const branchManager = role === "BRANCH_MANAGER";
  const finance = !attendance && can(role, "payroll.edit");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [money, setMoney] = useState<Finance | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    const jobs: Promise<unknown>[] = [];
    if (attendance && !branchManager) jobs.push(mcall<Overview>("/workspace/overview").then((r) => live && setOverview(r)));
    if (branchManager) jobs.push(mcall<Shift[]>("/workspace/branch-shift").then((r) => live && setShifts(r)));
    if (finance) jobs.push(mcall<Finance>(`/finance/summary?month=${tashkentIsoDate().slice(0, 7)}`).then((r) => live && setMoney(r)));
    void Promise.allSettled(jobs).then(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [attendance, branchManager, finance, reloadKey]);

  const line = (i: number, total: number) => i < total - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line };
  const nothing = !overview && !shifts?.length && !money && !rows?.length;
  if (nothing && !loaded) return <Loading />;
  if (nothing)
    return (
      <Empty
        icon="grid-outline"
        title="Ishlaringiz «Boshqaruv»da"
        action={<Button title="Boshqaruv" icon="apps-outline" tone="soft" onPress={onAdmin} style={{ alignSelf: "stretch" }} />}
      />
    );

  return (
    <>
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
                [s.today.planned, "rejada", c.ink, "today:ALL"],
                [s.today.came, "keldi", c.success, "today:IN"],
                [s.today.late, "kechikdi", s.today.late ? c.warn : c.ink, "today:LATE"],
                [s.today.absent, "kelmadi", s.today.absent ? c.danger : c.ink, "today:ABSENT"],
              ] as const
            ).map(([value, label, color, target], i) => (
              <View key={label} style={[st.tile, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line }]}>
                <Text style={[typo.stat, { color }]} onPress={() => onOpen(target)} suppressHighlighting>
                  {value}
                </Text>
                <Text style={[typo.caption, { color: c.muted }]}>{label}</Text>
              </View>
            ))}
          </View>
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

      {rows?.length ? <LiveFeed rows={rows} /> : null}

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
                  <View style={{ width: `${Math.min(100, b.rate)}%`, height: "100%", borderRadius: 3, backgroundColor: b.rate >= 90 ? c.success : b.rate >= 70 ? c.warn : c.danger }} />
                </View>
                <Text style={[typo.sub, st.ratio, { color: c.muted }]}>
                  {b.came}/{b.planned}
                </Text>
              </View>
            ))}
          </Group>
        </>
      ) : null}

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

      {money ? (
        <>
          <GroupTitle>Bu oy</GroupTitle>
          <Group>
            <Row icon="cash-outline" label="Ish haqi fondi" value={som(money.net)} />
            <Row icon="people-outline" label="Xodimlar" value={String(money.employees)} />
            <Row icon="gift-outline" label="Bonus" value={som(money.bonus)} />
            <Row icon="wallet-outline" label="Avans so‘rovlari" value={String(money.advances.pendingCount)} onPress={() => onOpen("money")} last />
          </Group>
        </>
      ) : null}
    </>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 50, paddingVertical: 10 },
  tile: { flex: 1, alignItems: "center", gap: 2 },
  meter: { width: 72, height: 6, borderRadius: 3, overflow: "hidden" },
  ratio: { width: 48, textAlign: "right", fontVariant: ["tabular-nums"] },
  tomorrow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12 },
});
