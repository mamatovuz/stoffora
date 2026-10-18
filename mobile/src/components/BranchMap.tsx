import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { mediaUri } from "@/lib/config";
import { distanceMeters } from "@/lib/location";
import { typo, useTheme } from "@/lib/theme";
import { TileMap, type MapPoint } from "./TileMap";
import { Card, Empty, Group, Icon, haptic } from "./ui";

/*
 * Rahbar xaritasi — Mini App’dagi BranchMap bilan bir xil:
 *   «Barcha filiallar» — filial pinlari (keldi/kutilgan, rangi davomatga qarab) va eng sust filial
 *   yuqorida turgan reyting ro‘yxati;
 *   bitta filial — radius, xodimlar keldi qilgan joy (rasmli pin), filtrlar (vaqtida, kechikkan,
 *   shubhali, chegarada), pin bosilsa — ma’lumot kartochkasi, pastda masofa bo‘yicha ro‘yxat.
 * Boshqa filialdan kelib shu yerda keldi qilgan xodim shu filialda ko‘rinadi («asosiy: …»).
 */

type Emp = { id: string; firstName: string; lastName: string; photoDataUrl?: string; branchId: string };
export type MapRow = {
  employee: Emp;
  record?: {
    checkIn?: string;
    checkOut?: string;
    latitude?: number;
    longitude?: number;
    flags?: string[];
    flagsReviewedBy?: string;
    marks?: { kind: "IN" | "OUT"; latitude?: number; longitude?: number }[];
  };
  state: string;
  late: boolean;
  /** Bugungi filial (keldi qilgan joy) va boshqa filialda bo‘lsa — asosiy filiali. */
  branchId?: string;
  homeBranch?: string;
};
type Branch = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number; status?: string };
type Filter = "ALL" | "OK" | "LATE" | "FLAG" | "EDGE";

const FLAG_LABELS: Record<string, string> = {
  GPS_ACCURACY: "GPS aniqligi g‘ayritabiiy",
  GPS_EXACT_REPEAT: "Koordinata avvalgisi bilan aynan bir xil",
  GPS_TELEPORT: "Imkonsiz tezlikda joy o‘zgargan",
  GPS_EDGE: "Hudud chegarasida",
  GPS_STALE: "Eski (keshlangan) joylashuv",
  OFFLINE: "Internetsiz belgilangan",
  DEVICE_STILL: "Telefon umuman qimirlamagan",
  DESKTOP: "Kompyuterdan belgilangan",
  MOCK_LOCATION: "Soxta joylashuv (mock GPS)",
};

/** Pin — keldi qilgan joy («Kirish» belgisi); eski yozuvlarda — oxirgi koordinata. */
const spotOf = (record?: MapRow["record"]) => {
  const mark = record?.marks?.find((m) => m.kind === "IN" && typeof m.latitude === "number" && typeof m.longitude === "number");
  if (mark) return { lat: mark.latitude!, lng: mark.longitude! };
  return typeof record?.latitude === "number" && typeof record?.longitude === "number" ? { lat: record.latitude, lng: record.longitude } : null;
};
const flagged = (r: MapRow) => Boolean(r.record?.flags?.length && !r.record.flagsReviewedBy);
const personTone = (r: MapRow): MapPoint["tone"] => (flagged(r) ? "bad" : r.late ? "warn" : r.state === "LEFT" ? "muted" : "ok");
const initials = (e: Emp) => `${e.firstName[0] || ""}${e.lastName[0] || ""}`;

export function BranchMap({ rows, branches }: { rows: MapRow[]; branches: Branch[] }) {
  const { c } = useTheme();
  const active = useMemo(() => branches.filter((b) => b.status !== "INACTIVE" && (b.latitude || b.longitude)), [branches]);
  const [focus, setFocus] = useState(active.length === 1 ? active[0].id : "ALL");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (focus !== "ALL" && !active.some((b) => b.id === focus)) setFocus(active.length === 1 ? active[0].id : "ALL");
    else if (focus === "ALL" && active.length === 1) setFocus(active[0].id);
  }, [active, focus]);
  if (!active.length) return <Empty icon="map-outline" title="Filiallar koordinatasi kiritilmagan" text="Saytda: Tashkilot → Filiallar → tahrirlash — xarita shundan keyin chiqadi." />;

  // Xodim keldi qilgan filialda ko‘rinadi (hali kelmagan — o‘z filialida).
  const byBranch = (id: string) => rows.filter((r) => (r.branchId || r.employee.branchId) === id);
  const stat = (list: MapRow[]) => ({
    in: list.filter((r) => r.state === "IN" || r.state === "LEFT").length,
    expected: list.filter((r) => !["DAY_OFF", "ON_LEAVE", "UPCOMING"].includes(r.state)).length,
    late: list.filter((r) => r.late).length,
    flagged: list.filter(flagged).length,
  });
  const branch = active.find((b) => b.id === focus);
  const chips =
    active.length > 1 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
        {[{ id: "ALL", name: "Barcha filiallar" }, ...active].map((b) => {
          const on = focus === b.id;
          return (
            <Pressable
              key={b.id}
              onPress={() => {
                haptic.select();
                setFocus(b.id);
                setSelected(null);
                setFilter("ALL");
              }}
              style={[st.chip, { backgroundColor: on ? c.ink : c.card }]}
            >
              <Text style={[typo.sub, { color: on ? c.card : c.ink, fontWeight: "600" }]}>{b.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    ) : null;

  /* ---------------------------------------------- barcha filiallar --- */
  if (!branch) {
    const points: MapPoint[] = active.map((b) => {
      const s = stat(byBranch(b.id));
      const rate = s.expected ? s.in / s.expected : 1;
      return { id: b.id, lat: b.latitude, lng: b.longitude, kind: "branch", label: b.name, badge: `${s.in}/${s.expected}`, tone: s.flagged ? "bad" : rate >= 0.9 ? "ok" : rate >= 0.7 ? "warn" : "bad" };
    });
    const ranked = active
      .map((b) => ({ b, s: stat(byBranch(b.id)) }))
      .sort((x, y) => (x.s.expected ? x.s.in / x.s.expected : 1) - (y.s.expected ? y.s.in / y.s.expected : 1));
    return (
      <>
        {chips}
        <TileMap
          points={points}
          circles={active.map((b) => ({ id: b.id, lat: b.latitude, lng: b.longitude, radius: b.radiusMeters }))}
          fitKey="ALL"
          height={380}
          onPick={(p) => {
            if (!p) return;
            setFocus(p.id);
            setFilter("ALL");
          }}
        />
        <Group>
          {ranked.map(({ b, s }, i) => {
            const rate = s.expected ? Math.round((s.in / s.expected) * 100) : 100;
            const color = rate >= 90 ? c.success : rate >= 70 ? c.warn : c.danger;
            return (
              <Pressable
                key={b.id}
                onPress={() => {
                  haptic.select();
                  setFocus(b.id);
                }}
                style={({ pressed }) => [st.row, i < ranked.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }, pressed && { opacity: 0.6 }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[typo.bodyStrong, { color: c.ink }]} numberOfLines={1}>
                    {b.name}
                  </Text>
                  <Text style={[typo.sub, { color: c.muted }]} numberOfLines={1}>
                    {s.in}/{s.expected} keldi{s.late ? ` · ${s.late} kechikdi` : ""}
                    {s.flagged ? ` · ⚠ ${s.flagged}` : ""}
                  </Text>
                </View>
                <View style={[st.meter, { backgroundColor: c.tint }]}>
                  <View style={{ width: `${rate}%`, height: "100%", borderRadius: 4, backgroundColor: color }} />
                </View>
                <Text style={[typo.bodyStrong, { width: 46, textAlign: "right", color: c.ink, fontVariant: ["tabular-nums"] }]}>{rate}%</Text>
              </Pressable>
            );
          })}
        </Group>
      </>
    );
  }

  /* ---------------------------------------------------- bitta filial --- */
  const list = byBranch(branch.id);
  const located = list
    .map((r) => ({ r, spot: spotOf(r.record) }))
    .filter((p): p is { r: MapRow; spot: { lat: number; lng: number } } => Boolean(p.spot))
    .map(({ r, spot }) => ({ r, spot, distance: Math.round(distanceMeters(branch.latitude, branch.longitude, spot.lat, spot.lng)) }));
  const counts = {
    ok: located.filter((p) => !p.r.late && !flagged(p.r)).length,
    late: located.filter((p) => p.r.late).length,
    flag: located.filter((p) => flagged(p.r)).length,
    edge: located.filter((p) => p.distance > branch.radiusMeters).length,
  };
  const visible = located.filter(({ r, distance }) =>
    filter === "ALL" ? true : filter === "OK" ? !r.late && !flagged(r) : filter === "LATE" ? r.late : filter === "FLAG" ? flagged(r) : distance > branch.radiusMeters,
  );
  const points: MapPoint[] = [
    { id: `branch:${branch.id}`, lat: branch.latitude, lng: branch.longitude, kind: "branch", label: branch.name, tone: "info" },
    ...visible.map(({ r, spot }) => ({
      id: r.employee.id,
      lat: spot.lat,
      lng: spot.lng,
      kind: "person" as const,
      label: r.employee.firstName,
      initials: initials(r.employee),
      photo: r.employee.photoDataUrl,
      tone: personTone(r),
    })),
  ];
  const pick = located.find((p) => p.r.employee.id === selected);
  const s = stat(list);
  const notMarked = list.filter((r) => r.state === "NOT_YET" || r.state === "ABSENT").length;
  const toneColor = (t: MapPoint["tone"]) => ({ ok: c.success, warn: c.warn, bad: c.danger, info: c.accent, muted: c.muted })[t];
  const filters: [Filter, string, number, string][] = [
    ["ALL", "Hammasi", located.length, c.accent],
    ["OK", "Vaqtida", counts.ok, c.success],
    ["LATE", "Kechikkan", counts.late, c.warn],
    ["FLAG", "Shubhali", counts.flag, c.danger],
    ["EDGE", "Chegarada", counts.edge, c.warn],
  ];

  return (
    <>
      {chips}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0 }}>
        {filters.map(([key, label, count, color]) => {
          const on = filter === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => {
                haptic.select();
                setFilter(key);
                setSelected(null);
              }}
              style={[st.filter, { backgroundColor: on ? `${color}1F` : c.card, borderColor: on ? color : "transparent" }]}
            >
              <Text style={[typo.sub, { color: key === "ALL" && !on ? c.ink : color, fontWeight: "600" }]}>
                {label} {count}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <TileMap
        points={points}
        circles={[{ id: branch.id, lat: branch.latitude, lng: branch.longitude, radius: branch.radiusMeters }]}
        fitKey={`${branch.id}:${filter}`}
        height={380}
        selectedId={selected}
        onPick={(p) => setSelected(p && p.kind === "person" ? p.id : null)}
      >
        {pick ? (
          <View style={[st.card, { backgroundColor: c.card }]}>
            {pick.r.employee.photoDataUrl ? (
              <Image source={{ uri: mediaUri(pick.r.employee.photoDataUrl) }} style={[st.cardAvatar, { borderColor: toneColor(personTone(pick.r)) }]} />
            ) : (
              <View style={[st.cardAvatar, { borderColor: toneColor(personTone(pick.r)), backgroundColor: c.tint, alignItems: "center", justifyContent: "center" }]}>
                <Text style={{ color: c.ink, fontWeight: "700" }}>{initials(pick.r.employee)}</Text>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <Text style={[typo.bodyStrong, { color: c.ink }]} numberOfLines={1}>
                {pick.r.employee.firstName} {pick.r.employee.lastName}
              </Text>
              <Text style={[typo.sub, { color: c.muted }]} numberOfLines={1}>
                {pick.r.record?.checkIn ? `Keldi ${pick.r.record.checkIn}` : ""}
                {pick.r.record?.checkOut ? ` · ketdi ${pick.r.record.checkOut}` : ""} · {pick.distance} m{pick.distance > branch.radiusMeters ? " (chegarada)" : ""}
              </Text>
              {pick.r.homeBranch ? (
                <Text style={[typo.sub, { color: c.muted }]} numberOfLines={1}>
                  {branch.name}da keldi · asosiy: {pick.r.homeBranch}
                </Text>
              ) : null}
              {flagged(pick.r) ? (
                <Text style={[typo.sub, { color: c.danger }]} numberOfLines={2}>
                  ⚠ {pick.r.record!.flags!.map((f) => FLAG_LABELS[f] || f).join(", ")}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => router.push({ pathname: "/employee/[id]", params: { id: pick.r.employee.id } })} style={[st.cardBtn, { backgroundColor: c.accent }]} hitSlop={6}>
              <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Profil</Text>
            </Pressable>
          </View>
        ) : null}
      </TileMap>
      <Card style={{ flexDirection: "row", paddingVertical: 12, paddingHorizontal: 4 }}>
        {(
          [
            [s.in, "keldi"],
            [notMarked, "belgilamagan"],
            [`${branch.radiusMeters} m`, "radius"],
          ] as const
        ).map(([value, label], i) => (
          <View key={label} style={[{ flex: 1, alignItems: "center", gap: 2 }, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line }]}>
            <Text style={[typo.time, { color: c.ink }]}>{value}</Text>
            <Text style={[typo.caption, { color: c.muted }]}>{label}</Text>
          </View>
        ))}
      </Card>
      {!visible.length ? (
        <Empty icon="location-outline" title={located.length ? "Bu filtrda hech kim yo‘q" : "Bugun bu filialda belgilagan xodim yo‘q"} />
      ) : (
        <Group>
          {[...visible]
            .sort((a, b) => b.distance - a.distance)
            .map(({ r, distance }, i, all) => {
              const outside = distance > branch.radiusMeters;
              const on = selected === r.employee.id;
              return (
                <Pressable
                  key={r.employee.id}
                  onPress={() => {
                    haptic.select();
                    setSelected(on ? null : r.employee.id);
                  }}
                  onLongPress={() => router.push({ pathname: "/employee/[id]", params: { id: r.employee.id } })}
                  style={[st.row, i < all.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }, on && { backgroundColor: c.tint }]}
                >
                  <View style={[st.dot, { backgroundColor: toneColor(personTone(r)) }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[typo.bodyStrong, { color: c.ink }]} numberOfLines={1}>
                      {r.employee.firstName} {r.employee.lastName}
                    </Text>
                    <Text style={[typo.sub, { color: c.muted }]} numberOfLines={1}>
                      {r.record?.checkIn || "—"}
                      {r.record?.checkOut ? ` – ${r.record.checkOut}` : ""}
                      {r.late ? " · kechikdi" : ""}
                      {r.homeBranch ? ` · asosiy: ${r.homeBranch}` : ""}
                    </Text>
                  </View>
                  <Text style={[typo.bodyStrong, { color: outside ? c.warn : c.muted, fontVariant: ["tabular-nums"] }]}>
                    {distance} m{flagged(r) ? " ⚠" : ""}
                  </Text>
                  <Icon name={on ? "radio-button-on" : "chevron-forward"} size={16} color={on ? c.accent : c.muted} />
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
  filter: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10, minHeight: 56 },
  meter: { width: 70, height: 7, borderRadius: 4, overflow: "hidden" },
  dot: { width: 9, height: 9, borderRadius: 5 },
  card: {
    position: "absolute",
    left: 10,
    right: 58,
    top: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 16,
    zIndex: 9,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  cardAvatar: { width: 42, height: 42, borderRadius: 21, borderWidth: 2.5 },
  cardBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
});
