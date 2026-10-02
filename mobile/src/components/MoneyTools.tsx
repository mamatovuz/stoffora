import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { mediaUri } from "@/lib/config";
import { errorText } from "@/lib/api";
import { som } from "@/lib/format";
import { mcall } from "@/lib/manager";
import { useTheme } from "@/lib/theme";
import { Button, Card, Empty, Group, GroupTitle, Hint, Icon, Loading, Sheet, haptic } from "./ui";

/*
 * Rahbar rejimi — moliya vositalari (mobil):
 *   • Jarima yozish: HR / direktor / moliya — darhol; filial rahbari — taklif (HR tasdiqlaydi).
 *   • «Moliya»: shu oy avans oluvchilar va jarimalar.
 */

type Person = { id: string; firstName: string; lastName: string; photoDataUrl?: string; branchName?: string; baseSalary?: number };
const parse = (v: string) => Number(v.replace(/[^\d]/g, "")) || 0;

export function FineSheet({ visible, direct, onClose, onDone, preset }: { visible: boolean; direct: boolean; onClose: () => void; onDone: (text: string) => void; preset?: Person }) {
  const { c } = useTheme();
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [picked, setPicked] = useState<Person | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!visible || picked) return;
    const timer = setTimeout(() => {
      mcall<Person[]>(`/fines/employees?limit=20&q=${encodeURIComponent(q)}`)
        .then(setPeople)
        .catch((e) => setError(errorText(e)));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, picked, visible]);
  useEffect(() => {
    if (visible && preset) setPicked(preset);
    if (!visible) {
      setPicked(null);
      setAmount("");
      setReason("");
      setError("");
      setQ("");
    }
  }, [visible]);
  const value = parse(amount);
  const save = async () => {
    if (!picked) return;
    setBusy(true);
    setError("");
    try {
      const row = await mcall<{ status: string }>("/fines", { employeeId: picked.id, amount: value, reason: reason.trim() });
      haptic.success();
      onDone(row.status === "APPROVED" ? `${picked.firstName}: ${som(value)} jarima qo‘llandi — xabar yuborildi` : "Taklif HR’ga yuborildi");
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const avatar = (p: Person) =>
    p.photoDataUrl ? (
      <Image source={{ uri: mediaUri(p.photoDataUrl) }} style={st.avatar} />
    ) : (
      <View style={[st.avatar, { backgroundColor: `${c.accent}1A`, alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ color: c.accent, fontWeight: "700", fontSize: 12 }}>
          {p.firstName[0]}
          {p.lastName[0]}
        </Text>
      </View>
    );
  return (
    <Sheet visible={visible} title={direct ? "Jarima yozish" : "Jarima taklif qilish"} subtitle={direct ? "Darhol qo‘llanadi, shu oy oylikdan ushlanadi" : "HR yoki direktor tasdiqlagach qo‘llanadi"} onClose={onClose}>
      {picked ? (
        <View style={[st.picked, { backgroundColor: c.card }]}>
          {avatar(picked)}
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.ink, fontWeight: "600", fontSize: 15.5 }}>
              {picked.firstName} {picked.lastName}
            </Text>
            <Text style={{ color: c.muted, fontSize: 13 }}>
              {picked.branchName}
              {picked.baseSalary ? ` · oylik ${som(picked.baseSalary)}` : ""}
            </Text>
          </View>
          {!preset ? (
            <Pressable onPress={() => setPicked(null)} hitSlop={8}>
              <Text style={{ color: c.accent, fontWeight: "500" }}>O‘zgartirish</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          <View style={[st.search, { backgroundColor: c.card }]}>
            <Icon name="search" size={17} color={c.muted} />
            <TextInput value={q} onChangeText={setQ} placeholder="Xodimni qidirish" placeholderTextColor={c.muted} style={{ flex: 1, color: c.ink, fontSize: 16 }} />
          </View>
          {!people ? (
            <Loading />
          ) : (
            <Group>
              {people.slice(0, 8).map((p, i) => (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    haptic.select();
                    setPicked(p);
                  }}
                  style={({ pressed }) => [st.person, i < Math.min(8, people.length) - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }, pressed && { opacity: 0.6 }]}
                >
                  {avatar(p)}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.ink, fontWeight: "600" }}>
                      {p.firstName} {p.lastName}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 12.5 }}>{p.branchName}</Text>
                  </View>
                </Pressable>
              ))}
            </Group>
          )}
        </>
      )}
      <TextInput
        value={value ? value.toLocaleString("ru-RU") : ""}
        onChangeText={setAmount}
        keyboardType="number-pad"
        placeholder="Summa, so‘m (masalan 300 000)"
        placeholderTextColor={c.muted}
        style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {[50_000, 100_000, 200_000, 300_000, 500_000].map((n) => (
          <Pressable key={n} onPress={() => setAmount(String(n))} style={[st.chip, { backgroundColor: value === n ? c.accent : c.card, borderColor: value === n ? c.accent : c.line }]}>
            <Text style={{ color: value === n ? "#fff" : c.ink, fontWeight: "600" }}>{n / 1000}k</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="Sabab (masalan: kassa kamomadi)"
        placeholderTextColor={c.muted}
        multiline
        maxLength={300}
        style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card, minHeight: 80, textAlignVertical: "top" }]}
      />
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      <Button
        title={direct ? `Qo‘llash${value ? ` · ${som(value)}` : ""}` : "Taklif yuborish"}
        icon="hammer-outline"
        busy={busy}
        disabled={!picked || value < 1000 || reason.trim().length < 3}
        onPress={() => void save()}
      />
    </Sheet>
  );
}

type AdvanceRow = { id: string; employeeName: string; branchName: string; baseSalary: number; amount: number; status: string; method?: string; cardMask?: string; paidAt?: string };
type FineRow = { id: string; employeeName: string; branchName: string; amount: number; reason: string; status: string; createdBy: string; proposedBy?: string };

/** «Moliya» ko‘rinishi: shu oy avans oluvchilar va qo‘llangan jarimalar. */
export function MoneyView({ canAdvances, canFines, reloadKey }: { canAdvances: boolean; canFines: boolean; reloadKey: number }) {
  const { c } = useTheme();
  const [advances, setAdvances] = useState<AdvanceRow[] | null>(null);
  const [fines, setFines] = useState<FineRow[] | null>(null);
  const [summary, setSummary] = useState<{ net: number; employees: number; bonus: number; advances: { pendingCount: number; unpaidCount: number }; pendingFines: number } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const month = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);
    if (canAdvances) mcall<NonNullable<typeof summary>>(`/finance/summary?month=${month}`).then(setSummary).catch(() => undefined);
    if (canAdvances) mcall<{ rows: AdvanceRow[] }>(`/advances/recipients?month=${month}`).then((r) => setAdvances(r.rows)).catch((e) => setError(errorText(e)));
    else setAdvances([]);
    if (canFines) mcall<FineRow[]>(`/fines?month=${month}`).then((r) => setFines(r.filter((f) => f.status === "APPROVED"))).catch((e) => setError(errorText(e)));
    else setFines([]);
  }, [canAdvances, canFines, reloadKey]);
  const advTotal = (advances || []).reduce((s, r) => s + r.amount, 0);
  const fineTotal = (fines || []).reduce((s, r) => s + r.amount, 0);
  return (
    <>
      {error ? <Hint tone="bad" icon="alert-circle-outline">{error}</Hint> : null}
      {summary ? (
        <Card style={{ gap: 4 }}>
          <Text style={{ color: c.muted, fontSize: 12.5 }}>Qo‘lga beriladi · {summary.employees} xodim (bugungacha)</Text>
          <Text style={{ color: c.ink, fontSize: 26, fontWeight: "700", letterSpacing: -0.5 }}>{som(summary.net)}</Text>
          {summary.bonus ? <Text style={{ color: c.success, fontSize: 13 }}>+ {som(summary.bonus)} bonus va mukofot</Text> : null}
        </Card>
      ) : null}
      {summary && (summary.advances.pendingCount || summary.advances.unpaidCount || summary.pendingFines) ? (
        <Hint tone="warn" icon="alert-circle-outline">
          {[
            summary.advances.pendingCount ? `${summary.advances.pendingCount} ta avans so‘rovi kutmoqda` : "",
            summary.advances.unpaidCount ? `${summary.advances.unpaidCount} ta tasdiqlangan avans to‘lanmagan` : "",
            summary.pendingFines ? `${summary.pendingFines} ta jarima taklifi` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </Hint>
      ) : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        {canAdvances ? (
          <Card style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: c.muted, fontSize: 12.5 }}>Avans · {advances?.length ?? "…"} kishi</Text>
            <Text style={{ color: c.ink, fontSize: 19, fontWeight: "700" }}>{som(advTotal)}</Text>
          </Card>
        ) : null}
        {canFines ? (
          <Card style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: c.muted, fontSize: 12.5 }}>Jarimalar · {fines?.length ?? "…"} ta</Text>
            <Text style={{ color: c.danger, fontSize: 19, fontWeight: "700" }}>{som(fineTotal)}</Text>
          </Card>
        ) : null}
      </View>
      {canAdvances ? (
        <>
          <GroupTitle>Avans oluvchilar — shu oy</GroupTitle>
          {!advances ? (
            <Loading />
          ) : !advances.length ? (
            <Empty icon="cash-outline" title="Bu oy avans so‘raganlar yo‘q" />
          ) : (
            <Group>
              {advances.map((r, i) => (
                <View key={r.id} style={[st.row, i < advances.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
                  <Text style={{ width: 24, color: c.muted, fontWeight: "600", textAlign: "center" }}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.ink, fontWeight: "600" }} numberOfLines={1}>
                      {r.employeeName}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 12.5 }} numberOfLines={1}>
                      {r.branchName} · oylik {som(r.baseSalary)}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 12.5 }}>{r.method === "CASH" ? "Naqd" : r.cardMask || "Karta yo‘q"}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: c.ink, fontWeight: "700" }}>{som(r.amount)}</Text>
                    <Text style={{ color: r.paidAt ? c.success : r.status === "APPROVED" ? c.muted : c.warn, fontSize: 12 }}>{r.paidAt ? "To‘landi" : r.status === "APPROVED" ? "Tasdiqlangan" : "Kutilmoqda"}</Text>
                  </View>
                </View>
              ))}
            </Group>
          )}
          <Text style={{ color: c.muted, fontSize: 12.5, paddingHorizontal: 4 }}>Excel (karta raqamlari bilan) — saytda: Moliya → Avans oluvchilar.</Text>
        </>
      ) : null}
      {canFines ? (
        <>
          <GroupTitle>Jarimalar — shu oy</GroupTitle>
          {!fines ? (
            <Loading />
          ) : !fines.length ? (
            <Empty icon="hammer-outline" title="Bu oy jarima yo‘q" />
          ) : (
            <Group>
              {fines.map((r, i) => (
                <View key={r.id} style={[st.row, i < fines.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
                  <Icon name="hammer" size={17} color={c.danger} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.ink, fontWeight: "600" }} numberOfLines={1}>
                      {r.employeeName}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 12.5 }} numberOfLines={2}>
                      {r.branchName} · {r.reason}
                    </Text>
                  </View>
                  <Text style={{ color: c.danger, fontWeight: "700" }}>−{som(r.amount)}</Text>
                </View>
              ))}
            </Group>
          )}
        </>
      ) : null}
    </>
  );
}

const st = StyleSheet.create({
  avatar: { width: 38, height: 38, borderRadius: 19 },
  picked: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 44, borderRadius: 12 },
  person: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
});
