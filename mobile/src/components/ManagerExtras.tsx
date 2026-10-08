import { router } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { mediaUri } from "@/lib/config";
import { tashkentClock } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { Card, Empty, Group, Icon, haptic } from "./ui";

/*
 * Rahbar paneli — Mini App’dagi bilan bir xil qismlar: ertalabki brifing, so‘nggi belgilar,
 * filial filtri, muammoli trendlar va kunlik davomat chizig‘i.
 */

type Person = { id: string; firstName: string; lastName: string; photoDataUrl?: string };
type Row = { employee: Person; record?: { checkIn?: string; checkOut?: string }; late: boolean };
export type BriefTarget = "NOT_YET" | "ON_LEAVE" | "requests" | "trends" | "FLAGGED" | "LATE";
export type TrendRow = { employeeId: string; name: string; branch?: string; photoDataUrl?: string; alerts: { kind: string; severity: number; text: string }[] };

const openEmployee = (id: string) => router.push({ pathname: "/employee/[id]", params: { id } });

function Avatar({ person, size = 36 }: { person: Pick<Person, "firstName" | "lastName" | "photoDataUrl">; size?: number }) {
  const { c } = useTheme();
  const style = { width: size, height: size, borderRadius: size / 2 };
  if (person.photoDataUrl) return <Image source={{ uri: mediaUri(person.photoDataUrl) }} style={style} />;
  return (
    <View style={[style, { backgroundColor: `${c.accent}1A`, alignItems: "center", justifyContent: "center" }]}>
      <Text style={{ color: c.accent, fontWeight: "700", fontSize: size * 0.33 }}>
        {person.firstName[0] || ""}
        {person.lastName[0] || ""}
      </Text>
    </View>
  );
}

/** Ertalabki brifing: salom, bugungi reja va bosiladigan qisqa xulosalar. */
export function Briefing({
  name,
  stats,
  notices,
  pending,
  trends,
  onOpen,
}: {
  name: string;
  stats: { in: number; late: number; notYet: number; leave: number; expected: number; flagged: number };
  notices: number;
  pending: number;
  trends: number;
  onOpen: (target: BriefTarget) => void;
}) {
  const { c } = useTheme();
  const hour = Number(tashkentClock().slice(0, 2));
  const greet = hour < 12 ? "Xayrli tong" : hour < 18 ? "Xayrli kun" : "Xayrli kech";
  const items = [
    stats.notYet ? { key: "NOT_YET" as const, text: `${stats.notYet} kishi hali kelmadi`, color: c.warn } : null,
    notices ? { key: "NOT_YET" as const, text: `${notices} tasi kechikishini aytdi`, color: c.accent } : null,
    stats.late ? { key: "LATE" as const, text: `${stats.late} kishi kechikdi`, color: c.warn } : null,
    stats.leave ? { key: "ON_LEAVE" as const, text: `${stats.leave} kishi ta’tilda`, color: c.muted } : null,
    pending ? { key: "requests" as const, text: `${pending} ta so‘rov kutmoqda`, color: c.accent } : null,
    trends ? { key: "trends" as const, text: `${trends} xodimda muammoli trend`, color: c.danger } : null,
    stats.flagged ? { key: "FLAGGED" as const, text: `${stats.flagged} ta shubhali belgi`, color: c.danger } : null,
  ].filter(Boolean) as { key: BriefTarget; text: string; color: string }[];
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ color: c.ink, fontSize: 17, fontWeight: "700" }}>
        {greet}, {name.split(" ")[0]}!
      </Text>
      <Text style={{ color: c.muted, fontSize: 14 }}>
        Bugun {stats.expected} kishi ishlashi kerak, {stats.in} kishi keldi.{!items.length ? " Hammasi joyida." : ""}
      </Text>
      {items.length ? (
        <View style={st.chips}>
          {items.map((item) => (
            <Pressable
              key={item.text}
              onPress={() => {
                haptic.select();
                onOpen(item.key);
              }}
              style={({ pressed }) => [st.chip, { backgroundColor: `${item.color}18`, opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={{ color: item.color, fontSize: 13, fontWeight: "600" }}>{item.text}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** So‘nggi 6 ta belgi (kelish/ketish) — gorizontal lenta. */
export function LiveFeed({ rows }: { rows: Row[] }) {
  const { c } = useTheme();
  const events = rows
    .flatMap((r) => [
      ...(r.record?.checkIn ? [{ r, time: r.record.checkIn, kind: "in" as const }] : []),
      ...(r.record?.checkOut ? [{ r, time: r.record.checkOut, kind: "out" as const }] : []),
    ])
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, 6);
  if (!events.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={[st.title, { color: c.muted }]}>SO‘NGGI BELGILAR</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {events.map(({ r, time, kind }) => (
          <Pressable key={`${r.employee.id}:${kind}`} onPress={() => openEmployee(r.employee.id)} style={[st.feed, { backgroundColor: c.card }]}>
            <Avatar person={r.employee} size={34} />
            <Text style={{ color: c.ink, fontWeight: "600", fontSize: 13 }} numberOfLines={1}>
              {r.employee.firstName}
            </Text>
            <Text style={{ color: kind === "in" ? (r.late ? c.warn : c.success) : c.muted, fontSize: 12, fontWeight: "600" }}>
              {kind === "in" ? "Keldi" : "Ketdi"} {time}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** Filial bo‘yicha filtr (bir nechta filial bo‘lsa). */
export function BranchChips({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  const { c } = useTheme();
  if (options.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
      {["", ...options].map((name) => {
        const on = value === name;
        return (
          <Pressable
            key={name || "all"}
            onPress={() => {
              haptic.select();
              onChange(name);
            }}
            style={[st.chip, { backgroundColor: on ? c.accent : c.card }]}
          >
            <Text style={{ color: on ? "#fff" : c.ink, fontSize: 13.5, fontWeight: "600" }}>{name || "Barcha filiallar"}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Oxirgi 4 haftada muammoli qonuniyat (kechikish, kelmaslik, shubhali belgi) — xodimlar. */
export function TrendsList({ rows }: { rows: TrendRow[] | null }) {
  const { c } = useTheme();
  if (!rows) return null;
  if (!rows.length) return <Empty icon="checkmark-done-outline" title="Muammoli trend yo‘q" text="Oxirgi 4 haftada kechikish, kelmaslik yoki shubhali belgilar bo‘yicha qonuniyat topilmadi." />;
  return (
    <Group>
      {rows.map((row, i) => {
        const [firstName, ...rest] = row.name.split(" ");
        return (
          <Pressable
            key={row.employeeId}
            onPress={() => openEmployee(row.employeeId)}
            style={({ pressed }) => [st.row, i < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }, pressed && { opacity: 0.6 }]}
          >
            <Avatar person={{ firstName, lastName: rest.join(" ") || " ", photoDataUrl: row.photoDataUrl }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.ink, fontWeight: "600" }} numberOfLines={1}>
                {row.name}
              </Text>
              {row.alerts.map((a) => (
                <Text key={a.kind} style={{ color: a.severity >= 2 ? c.danger : c.warn, fontSize: 12.5 }}>
                  {a.text}
                </Text>
              ))}
            </View>
            <Icon name="chevron-forward" size={16} color={c.muted} />
          </Pressable>
        );
      })}
    </Group>
  );
}

/** Kunlik davomat: bitta gorizontal chiziq va izoh (Mini App bilan bir xil). */
export function StackBar({ total, slices }: { total: number; slices: { key: string; label: string; value: number; color: string }[] }) {
  const { c } = useTheme();
  const shown = slices.filter((s) => s.value > 0);
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: c.muted, fontSize: 14 }}>
        <Text style={{ color: c.ink, fontSize: 24, fontWeight: "700" }}>{total}</Text> xodim
      </Text>
      <View style={[st.bar, { backgroundColor: c.tint }]}>
        {shown.map((s) => (
          <View key={s.key} style={{ flex: s.value, backgroundColor: s.color }} />
        ))}
      </View>
      <View style={{ gap: 8 }}>
        {shown.map((s) => (
          <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: s.color }} />
            <Text style={{ flex: 1, color: c.ink, fontSize: 14 }}>{s.label[0].toUpperCase() + s.label.slice(1)}</Text>
            <Text style={{ color: c.ink, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{s.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99 },
  title: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, marginLeft: 4 },
  feed: { width: 92, alignItems: "center", gap: 4, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  bar: { flexDirection: "row", gap: 2, height: 10, borderRadius: 5, overflow: "hidden" },
});
