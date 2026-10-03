import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Alert, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, Card, ErrorBox, Icon, Loading, Segmented, haptic, type IconName } from "@/components/ui";
import { errorText } from "@/lib/api";
import { mediaUri } from "@/lib/config";
import { dateUz, dayTitle, duration, som } from "@/lib/format";
import { can, managerAuth, mcall, type ManagerAuth } from "@/lib/manager";
import { FineSheet } from "@/components/MoneyTools";
import { HistoryCalendar } from "@/components/HistoryCalendar";
import { useTheme } from "@/lib/theme";

/*
 * Xodim profili (rahbar rejimi): HR va rahbar — barcha xodimlar, filial rahbari — faqat o‘z filiali
 * (cheklov serverda: panelning /employees/:id API’si filial doirasini tekshiradi).
 */

type Emp = {
  id: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  employeeNo?: string;
  birthDate?: string;
  gender?: string;
  pinfl?: string;
  phone?: string;
  email?: string;
  address?: string;
  manager?: string;
  departmentId?: string;
  positionId?: string;
  branchId?: string;
  startDate?: string;
  employmentType?: string;
  baseSalary?: number;
  telegramUsername?: string;
  photoDataUrl?: string;
  status: string;
};
type Att = { id: string; date: string; checkIn?: string; checkOut?: string; scheduledStart: string; scheduledEnd: string; lateMinutes: number; earlyLeaveMinutes: number; workedMinutes: number; status: string; verification: string[] };
type Leave = { id: string; type: string; startDate: string; endDate: string; status: string };
type Detail = { employee: Emp; attendance: Att[]; leave: Leave[] };
type Named = { id: string; name: string };
type View3 = "main" | "attendance" | "requests" | "docs" | "history";
type Lifecycle = { onboarding: { steps: { key: string; label: string; done: boolean }[]; done: number; total: number }; timeline: { date: string; text: string }[] };
type EmpDoc = { id: string; type: string; title: string; expiresAt?: string; createdAt: string; status: "OK" | "SOON" | "EXPIRED" };

const LEAVE: Record<string, string> = { VACATION: "Mehnat ta’tili", SICK: "Kasallik", PERMISSION: "Ruxsat", UNPAID: "Haq to‘lanmaydigan", OTHER: "Boshqa" };
const STATUS: Record<string, [string, "warn" | "ok" | "bad" | "muted"]> = {
  PENDING: ["Kutilmoqda", "warn"],
  APPROVED: ["Tasdiqlangan", "ok"],
  REJECTED: ["Rad etilgan", "bad"],
  CANCELLED: ["Bekor qilingan", "muted"],
};
const EMPLOYMENT: Record<string, string> = { FULL_TIME: "To‘liq stavka", PART_TIME: "Yarim stavka", CONTRACT: "Shartnoma" };

export default function EmployeeProfile() {
  const { c } = useTheme();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [auth, setAuth] = useState<ManagerAuth | null>(null);
  const [data, setData] = useState<Detail | null>(null);
  const [names, setNames] = useState<{ branches: Named[]; departments: Named[]; positions: Named[] }>({ branches: [], departments: [], positions: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View3>("main");
  const [docs, setDocs] = useState<EmpDoc[] | null>(null);
  const [fining, setFining] = useState(false);
  const [life, setLife] = useState<Lifecycle | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, detail, , , branches, departments, positions] = await Promise.all([
        managerAuth(),
        mcall<Detail>(`/employees/${id}`),
        mcall<EmpDoc[]>(`/employees/${id}/documents`).then(setDocs).catch(() => setDocs([])),
        mcall<Lifecycle>(`/workspace/employees/${id}/lifecycle`).then(setLife).catch(() => setLife(null)),
        mcall<Named[]>("/branches").catch(() => []),
        mcall<Named[]>("/departments").catch(() => []),
        mcall<Named[]>("/positions").catch(() => []),
      ]);
      setAuth(a);
      setData(detail);
      setNames({ branches, departments, positions });
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useLayoutEffect(() => {
    navigation.setOptions({ title: "Xodimning profili" });
  }, [navigation]);

  if (!data) return <View style={{ flex: 1, backgroundColor: c.bg, padding: 16 }}>{error ? <ErrorBox text={error} onRetry={load} /> : <Loading />}</View>;
  const e = data.employee;
  const nameOf = (list: Named[], key?: string) => list.find((x) => x.id === key)?.name;
  const today = data.attendance[0];
  const fullName = [e.lastName, e.firstName, e.middleName].filter(Boolean).join(" ");
  // Oklad — faqat HR / moliya (filial rahbariga ko‘rsatilmaydi).
  const canFine = Boolean(auth && (can(auth.user.role, "employees.edit") || can(auth.user.role, "payroll.edit") || auth.user.role === "BRANCH_MANAGER"));
  // Oklad — faqat moliya va direktor (HR va filial rahbari ko‘rmaydi).
  const showSalary = Boolean(auth && can(auth.user.role, "payroll.edit") && e.baseSalary);

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={c.muted} />}
    >
      <Card style={{ alignItems: "center", gap: 10, paddingVertical: 20 }}>
        {e.photoDataUrl ? (
          <Image source={{ uri: mediaUri(e.photoDataUrl) }} style={st.photo} />
        ) : (
          <View style={[st.photo, { backgroundColor: `${c.accent}1A`, alignItems: "center", justifyContent: "center" }]}>
            <Text style={{ color: c.accent, fontSize: 34, fontWeight: "700" }}>
              {e.firstName[0]}
              {e.lastName[0]}
            </Text>
          </View>
        )}
        <Text style={{ color: c.ink, fontSize: 20, fontWeight: "700", textAlign: "center" }}>{fullName}</Text>
        <Text style={{ color: c.muted, fontSize: 14 }}>{[nameOf(names.positions, e.positionId), nameOf(names.branches, e.branchId)].filter(Boolean).join(" · ")}</Text>
        {e.phone ? (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6, alignSelf: "stretch" }}>
            <Action icon="call" label="Qo‘ng‘iroq" color={c.success} onPress={() => void Linking.openURL(`tel:${e.phone!.replace(/[^\d+]/g, "")}`)} />
            <Action icon="copy-outline" label="Nusxa" color={c.accent} onPress={() => void copy(e.phone!)} />
            {canFine ? <Action icon="hammer-outline" label="Jarima" color={c.danger} onPress={() => setFining(true)} /> : null}
            {e.telegramUsername ? <Action icon="paper-plane-outline" label="Telegram" color="#229ED9" onPress={() => void Linking.openURL(`https://t.me/${e.telegramUsername!.replace(/^@/, "")}`)} /> : null}
          </View>
        ) : null}
      </Card>

      {today ? (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: c.muted, fontSize: 13, fontWeight: "600" }}>{dayTitle(today.date)}</Text>
          <View style={{ flexDirection: "row" }}>
            <Big value={today.checkIn || "--:--"} label="kirish" />
            <Big value={today.checkOut || "--:--"} label="chiqish" />
            <Big value={`${today.scheduledStart}–${today.scheduledEnd}`} label="ish jadvali" small />
          </View>
        </Card>
      ) : null}

      <Segmented<View3>
        value={view}
        onChange={setView}
        options={[
          ["main", "Ma’lumotlar"],
          ["attendance", "Taqvim"],
          ["requests", "So‘rovlar"],
          ["docs", `Hujjatlar${docs?.length ? ` · ${docs.length}` : ""}`],
          ["history", "Tarix"],
        ]}
      />

      {view === "main" ? (
        <>
          <Section icon="person-outline" title="Shaxsiy">
            <Field label="Tug‘ilgan kun" value={e.birthDate ? e.birthDate.split("-").reverse().join(".") : undefined} />
            <Field label="Jins" value={e.gender === "MALE" || e.gender === "male" ? "Erkak" : e.gender === "FEMALE" || e.gender === "female" ? "Ayol" : e.gender} />
            <Field label="Rahbar" value={e.manager} last />
          </Section>
          <Section icon="call-outline" title="Kontaktlar">
            <Field label="Telefon" value={e.phone} copy />
            <Field label="E-mail" value={e.email} copy />
            <Field label="Yashash manzili" value={e.address} last />
          </Section>
          <Section icon="briefcase-outline" title="Ish haqida ma’lumotlar">
            <Field label="Bo‘lim" value={nameOf(names.departments, e.departmentId)} />
            <Field label="Filial" value={nameOf(names.branches, e.branchId)} />
            <Field label="Lavozim" value={nameOf(names.positions, e.positionId)} />
            <Field label="Qabul qilingan sana" value={e.startDate ? e.startDate.split("-").reverse().join(".") : undefined} />
            <Field label="Bandlik turi" value={e.employmentType ? EMPLOYMENT[e.employmentType] : undefined} last={!showSalary} />
            {showSalary ? <Field label="Oklad" value={som(e.baseSalary || 0)} last /> : null}
          </Section>
          <Section icon="list-outline" title="Hisob raqamlari">
            <Field label="JShShIR" value={e.pinfl} copy />
            <Field label="Xodim raqami" value={e.employeeNo} copy last />
          </Section>
        </>
      ) : null}

      {view === "attendance" ? <HistoryCalendar fetcher={mcall} base={`/employees/${id}/history`} /> : null}

      {view === "history" ? (
        <>
          {life ? (
            <Section icon="checkmark-done-outline" title={`Onboarding · ${life.onboarding.done}/${life.onboarding.total}`}>
              {life.onboarding.steps.map((st2) => (
                <View key={st2.key} style={{ flexDirection: "row", gap: 8, paddingVertical: 5 }}>
                  <Icon name={st2.done ? "checkmark-circle" : "ellipse-outline"} size={18} color={st2.done ? c.success : c.muted} />
                  <Text style={{ flex: 1, color: st2.done ? c.ink : c.muted, fontSize: 14.5 }}>{st2.label}</Text>
                </View>
              ))}
            </Section>
          ) : null}
          <Section icon="time-outline" title="Xodim tarixi">
            {!life ? <Text style={{ color: c.muted, paddingVertical: 10 }}>Yuklanmoqda…</Text> : null}
            {(life?.timeline || []).map((ev, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 10, paddingVertical: 6 }}>
                <Text style={{ width: 82, color: c.muted, fontVariant: ["tabular-nums"] }}>{ev.date.slice(0, 10).split("-").reverse().join(".")}</Text>
                <Text style={{ flex: 1, color: c.ink, fontSize: 14.5 }}>{ev.text}</Text>
              </View>
            ))}
          </Section>
        </>
      ) : null}

      {view === "docs" ? (
        <Section icon="folder-outline" title="Hujjatlar">
          {!docs ? <Text style={{ color: c.muted, paddingVertical: 10 }}>Yuklanmoqda…</Text> : null}
          {docs && !docs.length ? <Text style={{ color: c.muted, paddingVertical: 10 }}>Hujjat yuklanmagan</Text> : null}
          {(docs || []).map((d, i, list) => (
            <View key={d.id} style={[st.attRow, i < list.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.ink, fontSize: 15, fontWeight: "600" }}>{d.title}</Text>
                <Text style={{ color: c.muted, fontSize: 12.5 }}>
                  Yuklangan {dateUz(d.createdAt.slice(0, 10))}
                  {d.expiresAt ? ` · ${dateUz(d.expiresAt)} gacha` : ""}
                </Text>
              </View>
              {d.expiresAt ? <Badge text={d.status === "EXPIRED" ? "Muddati o‘tgan" : d.status === "SOON" ? "Tugayapti" : "Amal qiladi"} tone={d.status === "EXPIRED" ? "bad" : d.status === "SOON" ? "warn" : "ok"} /> : null}
            </View>
          ))}
          <Text style={{ color: c.muted, fontSize: 12, marginTop: 6 }}>Fayllarni ochish — saytda (xodim profili → Hujjatlar).</Text>
        </Section>
      ) : null}

      {view === "requests" ? (
        <Section icon="document-text-outline" title="Ta’til va yo‘qlik so‘rovlari">
          {!data.leave.length ? <Text style={{ color: c.muted, paddingVertical: 10 }}>So‘rovlar yo‘q</Text> : null}
          {data.leave.slice(0, 20).map((l, i, list) => {
            const [label, tone] = STATUS[l.status] || [l.status, "muted" as const];
            return (
              <View key={l.id} style={[st.attRow, i < list.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.ink, fontSize: 15, fontWeight: "600" }}>{LEAVE[l.type] || l.type}</Text>
                  <Text style={{ color: c.muted, fontSize: 12.5 }}>
                    {dateUz(l.startDate)} – {dateUz(l.endDate)}
                  </Text>
                </View>
                <Badge text={label} tone={tone} />
              </View>
            );
          })}
        </Section>
      ) : null}
      <FineSheet
        visible={fining}
        direct={Boolean(auth && (can(auth.user.role, "employees.edit") || can(auth.user.role, "payroll.edit")))}
        preset={{ id: e.id, firstName: e.firstName, lastName: e.lastName, photoDataUrl: e.photoDataUrl, branchName: nameOf(names.branches, e.branchId), baseSalary: e.baseSalary }}
        onClose={() => setFining(false)}
        onDone={(text) => {
          setFining(false);
          Alert.alert("Tayyor", text);
        }}
      />
    </ScrollView>
  );
}

async function copy(text: string) {
  await Clipboard.setStringAsync(text);
  haptic.success();
}

function Action({ icon, label, color, onPress }: { icon: IconName; label: string; color: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.action, { backgroundColor: c.tint }, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={20} color={color} />
      <Text style={{ color: c.ink, fontSize: 12 }} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
    </Pressable>
  );
}

function Big({ value, label, small }: { value: string; label: string; small?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: small ? 1.3 : 1 }}>
      <Text style={{ color: c.ink, fontSize: small ? 16 : 24, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 12.5 }}>{label}</Text>
    </View>
  );
}

function Section({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <Card style={{ gap: 2, paddingVertical: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Icon name={icon} size={18} color={c.accent} />
        <Text style={{ color: c.ink, fontWeight: "600", fontSize: 15 }}>{title}</Text>
      </View>
      {children}
    </Card>
  );
}

function Field({ label, value, copy: canCopy, last }: { label: string; value?: string; copy?: boolean; last?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={[st.field, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: value ? c.ink : c.muted, fontSize: 16 }}>{value || "Ko‘rsatilmagan"}</Text>
        <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 1 }}>{label}</Text>
      </View>
      {canCopy && value ? (
        <Pressable onPress={() => void copy(value)} hitSlop={10}>
          <Icon name="copy-outline" size={20} color={c.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  photo: { width: 112, height: 112, borderRadius: 56 },
  // Tugmalar karta kengligiga teng bo‘linadi — 4 ta bo‘lsa ham tashqariga chiqmaydi.
  action: { flex: 1, minWidth: 0, height: 62, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 2 },
  field: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  attRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11 },
});
