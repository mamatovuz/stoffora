import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { distanceMeters } from "@/lib/location";
import { useTheme } from "@/lib/theme";
import { TileMap, type MapPoint } from "./TileMap";
import { Empty, Group, haptic } from "./ui";

/*
 * Rahbar xaritasi (Mini App’dagi BranchMap bilan bir xil):
 *   «Barchasi» — filiallar pin’lari (keldi/kutilgan) va reyting ro‘yxati;
 *   bitta filial — radius, xodimlarning belgilagan joyi (rasmli pin) va masofasi.
 */

type Emp = { id: string; firstName: string; lastName: string; photoDataUrl?: string; branchId: string };
export type MapRow = {
  employee: Emp;
  record?: { checkIn?: string; checkOut?: string; latitude?: number; longitude?: number; flags?: string[] };
  state: string;
  late: boolean;
};
type Branch = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number; status?: string };

export function BranchMap({ rows, branches }: { rows: MapRow[]; branches: Branch[] }) {
  const { c } = useTheme();
  const active = useMemo(() => branches.filter((b) => b.status !== "INACTIVE" && (b.latitude || b.longitude)), [branches]);
  const [focus, setFocus] = useState(active.length === 1 ? active[0].id : "ALL");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (focus !== "ALL" && !active.some((b) => b.id === focus)) setFocus("ALL");
  }, [active, focus]);
  if (!active.length) return <Empty icon="map-outline" title="Filiallar koordinatasi kiritilmagan" />;

  const byBranch = (id: string) => rows.filter((r) => r.employee.branchId === id);
  const stat = (list: MapRow[]) => ({
    in: list.filter((r) => r.state === "IN" || r.state === "LEFT").length,
    expected: list.filter((r) => !["DAY_OFF", "ON_LEAVE", "UPCOMING"].includes(r.state)).length,
    late: list.filter((r) => r.late).length,
  });
  const branch = active.find((b) => b.id === focus);
  const chips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {[{ id: "ALL", name: "Barcha filiallar" }, ...active].map((b) => (
        <Pressable
          key={b.id}
          onPress={() => {
            haptic.select();
            setFocus(b.id);
            setSelected(null);
          }}
          style={[st.chip, { backgroundColor: focus === b.id ? c.accent : c.card }]}
        >
          <Text style={{ color: focus === b.id ? "#fff" : c.ink, fontWeight: "600", fontSize: 13.5 }}>{b.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  if (!branch) {
    const points: MapPoint[] = active.map((b) => {
      const s = stat(byBranch(b.id));
      const rate = s.expected ? s.in / s.expected : 1;
      return { id: b.id, lat: b.latitude, lng: b.longitude, kind: "branch", label: b.name, badge: `${s.in}/${s.expected}`, tone: rate >= 0.9 ? "ok" : rate >= 0.7 ? "warn" : "bad" };
    });
    return (
      <>
        {chips}
        <TileMap points={points} circles={active.map((b) => ({ id: b.id, lat: b.latitude, lng: b.longitude, radius: b.radiusMeters }))} fitKey="ALL" onPick={(p) => setFocus(p.id)} />
        <Group>
          {active
            .map((b) => ({ b, s: stat(byBranch(b.id)) }))
            .sort((x, y) => (x.s.expected ? x.s.in / x.s.expected : 1) - (y.s.expected ? y.s.in / y.s.expected : 1))
            .map(({ b, s }, i, list) => {
              const rate = s.expected ? Math.round((s.in / s.expected) * 100) : 100;
              const color = rate >= 90 ? c.success : rate >= 70 ? c.warn : c.danger;
              return (
                <Pressable key={b.id} onPress={() => setFocus(b.id)} style={[st.row, i < list.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.ink, fontWeight: "600" }}>{b.name}</Text>
                    <Text style={{ color: c.muted, fontSize: 12.5 }}>
                      {s.in}/{s.expected} keldi{s.late ? ` · ${s.late} kechikdi` : ""}
                    </Text>
                  </View>
                  <View style={[st.meter, { backgroundColor: c.tint }]}>
                    <View style={{ width: `${rate}%`, height: "100%", backgroundColor: color, borderRadius: 3 }} />
                  </View>
                  <Text style={{ color: c.ink, fontWeight: "700", width: 42, textAlign: "right" }}>{rate}%</Text>
                </Pressable>
              );
            })}
        </Group>
      </>
    );
  }

  const list = byBranch(branch.id);
  const located = list
    .filter((r) => typeof r.record?.latitude === "number" && typeof r.record?.longitude === "number")
    .map((r) => ({ r, distance: Math.round(distanceMeters(branch.latitude, branch.longitude, r.record!.latitude!, r.record!.longitude!)) }));
  const points: MapPoint[] = [
    { id: branch.id, lat: branch.latitude, lng: branch.longitude, kind: "branch", label: branch.name, tone: "info" },
    ...located.map(({ r, distance }) => ({
      id: r.employee.id,
      lat: r.record!.latitude!,
      lng: r.record!.longitude!,
      kind: "person" as const,
      label: `${r.employee.firstName} ${r.employee.lastName}`,
      initials: `${r.employee.firstName[0] || ""}${r.employee.lastName[0] || ""}`,
      photo: r.employee.photoDataUrl,
      tone: r.record?.flags?.length || distance > branch.radiusMeters ? ("bad" as const) : r.late ? ("warn" as const) : ("ok" as const),
    })),
  ];
  const s = stat(list);
  return (
    <>
      {chips}
      <TileMap points={points} circles={[{ id: branch.id, lat: branch.latitude, lng: branch.longitude, radius: branch.radiusMeters }]} fitKey={branch.id} selectedId={selected} onPick={(p) => p.kind === "person" && setSelected(p.id)} />
      <Text style={{ color: c.muted, fontSize: 13, paddingHorizontal: 4 }}>
        {s.in}/{s.expected} keldi · radius {branch.radiusMeters} m · pin — belgilagan joyi
      </Text>
      {!located.length ? (
        <Empty icon="location-outline" title="Bugun bu filialda belgilagan xodim yo‘q" />
      ) : (
        <Group>
          {located
            .sort((a, b) => b.distance - a.distance)
            .map(({ r, distance }, i) => {
              const outside = distance > branch.radiusMeters;
              return (
                <Pressable
                  key={r.employee.id}
                  onPress={() => {
                    setSelected(r.employee.id);
                    router.push({ pathname: "/employee/[id]", params: { id: r.employee.id } });
                  }}
                  style={[st.row, i < located.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }, selected === r.employee.id && { backgroundColor: c.tint }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.ink, fontWeight: "600" }}>
                      {r.employee.firstName} {r.employee.lastName}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 12.5 }}>
                      {r.record?.checkIn || "—"}
                      {r.record?.checkOut ? ` – ${r.record.checkOut}` : ""}
                      {r.late ? " · kechikdi" : ""}
                    </Text>
                  </View>
                  <Text style={{ color: outside ? c.danger : c.muted, fontWeight: "600", fontSize: 13 }}>{distance} m</Text>
                </Pressable>
              );
            })}
        </Group>
      )}
    </>
  );
}

const st = StyleSheet.create({
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  meter: { width: 70, height: 6, borderRadius: 3, overflow: "hidden" },
});
