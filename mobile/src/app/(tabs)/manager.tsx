import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { mediaUri } from "@/lib/config";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { BranchMap } from "@/components/BranchMap";
import { FineSheet, MoneyView } from "@/components/MoneyTools";
import { DevicesView } from "@/components/DevicesView";
import { DeskView } from "@/components/DeskView";
import { Badge, Button, Card, Empty, ErrorBox, Group, GroupTitle, Hint, Icon, Loading, Screen, Segmented, Sheet, haptic } from "@/components/ui";
import { ApiError, errorText } from "@/lib/api";
import { dateUz, dayTitle, som, tashkentIsoDate, timeAgo } from "@/lib/format";
import { can, managerAuth, mcall, type ManagerAuth } from "@/lib/manager";
import { useTheme } from "@/lib/theme";

type MView = "desk" | "today" | "requests" | "map" | "week" | "money" | "devices";
type Emp = { id: string; firstName: string; lastName: string; photoDataUrl?: string; branchId: string };
type RosterRow = {
  employee: Emp;
  record?: { id: string; checkIn?: string; checkOut?: string; lateMinutes: number; flags?: string[]; latitude?: number; longitude?: number };
  state: "PRACTICE" | "IN" | "LEFT" | "ABSENT" | "ON_LEAVE" | "DAY_OFF" | "NOT_YET" | "UPCOMING";
  late: boolean;
  scheduledStart?: string;
  branch?: string;
};
type Day = { date: string; rows: RosterRow[] };
type Branch = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number };
type DecideSpec = { method: "POST" | "PATCH"; path: string; rejectPath?: string; approve: Record<string, unknown>; reject: Record<string, unknown> };
type InboxItem = {
  kind: "correction" | "leave" | "swap" | "dayoff" | "advance" | "fine" | "overtime" | "device" | "registration";
  id: string;
  label: string;
  title: string;
  sub: string;
  detail?: string;
  urgent: boolean;
  stage?: string;
  employeeId?: string;
  photoDataUrl?: string;
  decide: DecideSpec;
  meta?: { date?: string; time?: string; markKind?: "IN" | "OUT"; branch?: string };
};
type Pending = { spec: DecideSpec; urgent?: boolean; kind: "leave" | "swap" | "dayoff" | "advance" | "overtime" | "mark" | "fine" | "device" | "registration"; id: string; title: string; sub: string; extra?: string; date?: string; employeeId?: string; markKind?: "IN" | "OUT"; time?: string; branch?: string; photo?: string };
type MarkRow = { id: string; employeeId: string; employeeName: string; photoDataUrl?: string; date: string; time: string; kind: "IN" | "OUT"; branchName: string; comment: string };
type LateNotice = { id: string; employeeName: string; minutes: number; reason: string; createdAt: string };
type Analytics = {
  current: { attendanceRate: number; punctuality: number; lateMinutes: number; absent: number; score: number | null };
  previous: { attendanceRate: number; punctuality: number; lateMinutes: number; absent: number; score: number | null };
  punctual: { id: string; name: string; present: number }[];
  latecomers: { id: string; name: string; lateMinutes: number; late: number }[];
  branches: { id: string; name: string; employees: number; attendanceRate: number; punctuality: number; score: number | null }[];
};
type Filter = "ALL" | "IN" | "LATE" | "ABSENT" | "NOT_YET" | "ON_LEAVE";
const LEAVE: Record<string, string> = { VACATION: "Mehnat ta’tili", SICK: "Kasallik", PERMISSION: "Ruxsat", UNPAID: "Haq to‘lanmaydigan", OTHER: "Boshqa" };
const name = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;

/** Rahbar paneli — Mini App’dagi «Rahbar» bilan bir xil: bugungi holat, so‘rovlar, filial xaritasi, haftalik xulosa. */
export default function Manager() {
  const { c } = useTheme();
  const [auth, setAuth] = useState<ManagerAuth | null>(null);
  const params = useLocalSearchParams<{ view?: MView; t?: string }>();
  const [view, setView] = useState<MView>(params.view || "desk");
  useEffect(() => {
    if (params.view) setView(params.view);
  }, [params.view, params.t]);
  const [day, setDay] = useState<Day | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [notices, setNotices] = useState<LateNotice[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [announcing, setAnnouncing] = useState(false);
  const [fining, setFining] = useState(false);
  const [expiring, setExpiring] = useState<{ id: string; title: string; expiresAt: string; status: string; employeeId: string; employeeName: string; branchName: string }[]>([]);
  const [moneyKey, setMoneyKey] = useState(0);
  const [updatedAt, setUpdatedAt] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const a = await managerAuth();
      setAuth(a);
      const role = a.user.role;
      const canAtt = can(role, "attendance.view");
      const month = tashkentIsoDate().slice(0, 7);
      const safe = <T,>(p: Promise<T>, fallback: T) => p.catch((e) => (e instanceof ApiError && e.status === 403 ? fallback : Promise.reject(e)));
      // Yagona Inbox: barcha tasdiqlashlar (rol va filial chegarasi serverda).
      const [d, inbox, n, b] = await Promise.all([
        canAtt ? safe(mcall<Day>(`/attendance/day?date=${tashkentIsoDate()}`), null) : null,
        mcall<InboxItem[]>("/workspace/inbox").catch(() => [] as InboxItem[]),
        canAtt ? mcall<LateNotice[]>("/late-notices").catch(() => []) : [],
        canAtt ? mcall<Branch[]>("/branches").catch(() => []) : [],
      ]);
      const list: Pending[] = inbox.map((i) => ({
        kind: i.kind === "correction" ? ("mark" as const) : i.kind,
        id: i.id,
        title: i.kind === "correction" ? i.title : `${i.label}: ${i.title}`,
        sub: i.stage ? `${i.sub} · ${i.stage}` : i.sub,
        extra: i.detail,
        urgent: i.urgent,
        date: i.meta?.date,
        employeeId: i.employeeId,
        markKind: i.meta?.markKind,
        time: i.meta?.time,
        branch: i.meta?.branch,
        photo: i.photoDataUrl,
        spec: i.decide,
      }));
      setDay(d);
      setPending(list);
      setNotices(n);
      setBranches(b);
      setError("");
      setUpdatedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" }));
      if (can(role, "employees.view") || can(role, "attendance.view")) void mcall<typeof expiring>("/documents/expiring").then(setExpiring).catch(() => setExpiring([]));
      if (can(role, "dashboard.view")) void mcall<Analytics>(`/analytics?month=${month}`).then(setAnalytics).catch(() => undefined);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "NOT_MANAGER" ? "Rahbar huquqi topilmadi." : errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      timer.current = setInterval(() => void load(), 60_000);
      return () => {
        if (timer.current) clearInterval(timer.current);
      };
    }, [load]),
  );

  const decide = async (item: Pending, approve: boolean) => {
    if (!approve) {
      const ok = await new Promise<boolean>((r) =>
        Alert.alert("Rad etish", `${item.title} — rad etilsinmi?`, [
          { text: "Yo‘q", style: "cancel", onPress: () => r(false) },
          { text: "Rad etish", style: "destructive", onPress: () => r(true) },
        ]),
      );
      if (!ok) return;
    }
    setBusy(item.id);
    try {
      await mcall(!approve && item.spec.rejectPath ? item.spec.rejectPath : item.spec.path, approve ? item.spec.approve : item.spec.reject, item.spec.method);
      haptic.success();
      setPending((list) => list.filter((p) => p.id !== item.id));
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const rows = day?.rows || [];
  const stats = useMemo(() => {
    const expected = rows.filter((r) => !["ON_LEAVE", "DAY_OFF", "UPCOMING"].includes(r.state)).length;
    return {
      expected,
      in: rows.filter((r) => r.state === "IN" || r.state === "LEFT").length,
      late: rows.filter((r) => r.late).length,
      absent: rows.filter((r) => r.state === "ABSENT").length,
      notYet: rows.filter((r) => r.state === "NOT_YET").length,
      leave: rows.filter((r) => r.state === "ON_LEAVE").length,
      flagged: rows.filter((r) => r.record?.flags?.length).length,
    };
  }, [rows]);
  const visible = rows.filter(
    (r) =>
      (filter === "ALL" || (filter === "IN" ? r.state === "IN" || r.state === "LEFT" : filter === "LATE" ? r.late : r.state === filter)) &&
      (!query.trim() || name(r.employee).toLowerCase().includes(query.trim().toLowerCase())),
  );
  const rate = stats.expected ? Math.round((stats.in / stats.expected) * 100) : 0;
  const role = auth?.user.role || "";
  const fineDirectRole = can(role, "employees.edit") || can(role, "payroll.edit");
  const canFine = fineDirectRole || role === "BRANCH_MANAGER";
  // «Moliya» — faqat moliya va direktor (HR moliyani ko‘rmaydi).
  const canMoneyAdvances = can(role, "payroll.edit");
  const canMoney = canMoneyAdvances;
  // Qurilmalar — IT va HR (direktor ham).
  const canDevices = can(role, "devices.manage") || can(role, "employees.edit");
  const canAttendanceView = can(role, "attendance.view");
  // So‘rovlar: davomat/ta’til/avans/jarima bilan ishlaydiganlar (IT — yo‘q).
  const canRequests = canAttendanceView || can(role, "leave.approve") || can(role, "payroll.edit") || can(role, "employees.edit");
  // Davomatni ko‘rmaydigan rol (moliya) — darhol «Moliya».
  const noAttendance = Boolean(auth) && !can(role, "attendance.view");
  useEffect(() => {
    if (noAttendance && (view === "today" || view === "map")) setView(canMoney ? "money" : canDevices && !canRequests ? "devices" : "requests");
  }, [noAttendance, view, canMoney, canDevices]);
  const marks = pending.filter((p) => p.kind === "mark");
  const others = pending.filter((p) => p.kind !== "mark");
  const markDays = [...new Set(marks.map((p) => p.date!))].sort((a, b) => b.localeCompare(a));

  if (!auth && loading)
    return (
      <Screen title="Rahbar">
        <Loading />
      </Screen>
    );
  if (!auth)
    return (
      <Screen title="Rahbar" onRefresh={load}>
        <ErrorBox text={error || "Rahbar rejimi ochilmadi"} onRetry={load} />
      </Screen>
    );

  return (
    <Screen
      title="Rahbar"
      subtitle={`${auth.company.name}${updatedAt ? ` · ${updatedAt}` : ""}`}
      refreshing={loading}
      onRefresh={load}
      right={
        <View style={{ flexDirection: "row", gap: 8 }}>
          {canFine ? (
            <Pressable onPress={() => setFining(true)} style={[st.round, { backgroundColor: c.card }]} accessibilityLabel="Jarima">
              <Icon name="hammer-outline" size={20} color={c.danger} />
            </Pressable>
          ) : null}
          {can(auth.user.role, "announcements.create") || auth.user.role === "BRANCH_MANAGER" ? (
            <Pressable onPress={() => setAnnouncing(true)} style={[st.round, { backgroundColor: c.card }]} accessibilityLabel="Tezkor e’lon">
              <Icon name="megaphone-outline" size={20} color={c.accent} />
            </Pressable>
          ) : null}
        </View>
      }
    >
      <Segmented<MView>
        value={view}
        onChange={setView}
        options={[
          // Faqat rolga tegishli bo‘limlar (moliya va IT uchun bo‘sh «Bugun/Xarita» ko‘rinmaydi).
          ["desk", "Ish stoli"],
          ...(canAttendanceView ? ([["today", "Bugun"]] as [MView, string][]) : []),
          ...(canRequests ? ([["requests", "So‘rovlar", pending.length]] as [MView, string, number][]) : []),
          ...(canAttendanceView ? ([["map", "Xarita"]] as [MView, string][]) : []),
          ...(can(role, "dashboard.view") ? ([["week", "Xulosa"]] as [MView, string][]) : []),
          ...(canMoney ? ([["money", "Moliya"]] as [MView, string][]) : []),
          ...(canDevices ? ([["devices", "Qurilmalar"]] as [MView, string][]) : []),
        ]}
      />
      {error ? <ErrorBox text={error} onRetry={load} /> : null}

      {view === "today" ? (
        !day ? (
          <Empty icon="people-outline" title="Davomatni ko‘rish huquqi yo‘q" />
        ) : (
          <>
            <Card style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                <Text style={{ color: c.ink, fontSize: 34, fontWeight: "700", letterSpacing: -1 }}>{rate}%</Text>
                <Text style={{ color: c.muted }}>
                  ishda: {stats.in}/{stats.expected}
                </Text>
              </View>
              <View style={[st.bar, { backgroundColor: c.tint }]}>
                <View style={{ width: `${rate}%`, height: "100%", backgroundColor: c.success }} />
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(
                  [
                    ["IN", "Ishda", stats.in, c.success],
                    ["LATE", "Kechikdi", stats.late, c.warn],
                    ["ABSENT", "Kelmadi", stats.absent, c.danger],
                    ["NOT_YET", "Hali yo‘q", stats.notYet, c.muted],
                  ] as const
                ).map(([key, label, value, color]) => (
                  <Pressable
                    key={key}
                    onPress={() => {
                      haptic.select();
                      setFilter(filter === key ? "ALL" : key);
                    }}
                    style={[st.tile, { backgroundColor: c.tint, borderColor: filter === key ? c.accent : "transparent" }]}
                  >
                    <Text style={{ color: value ? color : c.muted, fontSize: 22, fontWeight: "700" }}>{value}</Text>
                    <Text style={{ color: c.muted, fontSize: 11.5 }}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </Card>
            {stats.flagged ? <Hint tone="warn" icon="flag-outline">{stats.flagged} ta shubhali belgi (GPS / qurilma / internetsiz) — panelda ko‘rib chiqing.</Hint> : null}
            {notices.length ? (
              <>
                <GroupTitle>Kechikish ogohlantirishlari</GroupTitle>
                <Group>
                  {notices.slice(0, 5).map((n, i) => (
                    <View key={n.id} style={[st.row, i < Math.min(5, notices.length) - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
                      <Icon name="hourglass-outline" size={18} color={c.warn} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: c.ink, fontWeight: "600" }}>
                          {n.employeeName} · ~{n.minutes} daq
                        </Text>
                        <Text style={{ color: c.muted, fontSize: 13 }}>
                          «{n.reason}» · {timeAgo(n.createdAt)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </Group>
              </>
            ) : null}
            <View style={[st.search, { backgroundColor: c.card }]}>
              <Icon name="search" size={17} color={c.muted} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Xodimni qidirish" placeholderTextColor={c.muted} style={{ flex: 1, color: c.ink, fontSize: 16 }} />
            </View>
            {!visible.length ? (
              <Empty icon="people-outline" title="Hech kim yo‘q" />
            ) : (
              <Group>
                {visible.map((r, i) => (
                  <RosterLine key={r.employee.id} row={r} last={i === visible.length - 1} />
                ))}
              </Group>
            )}
          </>
        )
      ) : null}

      {view === "requests" && expiring.length ? (
        <>
          <GroupTitle>Hujjat muddatlari · {expiring.length}</GroupTitle>
          <Group>
            {expiring.slice(0, 6).map((d, i, list) => (
              <Pressable
                key={d.id}
                onPress={() => router.push({ pathname: "/employee/[id]", params: { id: d.employeeId } })}
                style={[st.row, i < list.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}
              >
                <Icon name="document-text-outline" size={18} color={d.status === "EXPIRED" ? c.danger : c.warn} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.ink, fontWeight: "600" }} numberOfLines={1}>
                    {d.employeeName}
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 12.5 }} numberOfLines={1}>
                    {d.title} · {d.branchName}
                  </Text>
                </View>
                <Badge text={d.status === "EXPIRED" ? "O‘tgan" : `${dateUz(d.expiresAt)} gacha`} tone={d.status === "EXPIRED" ? "bad" : "warn"} />
              </Pressable>
            ))}
          </Group>
        </>
      ) : null}
      {view === "requests" ? (
        !pending.length ? (
          <Empty icon="checkmark-done-outline" title="Kutilayotgan so‘rov yo‘q" text="Belgilash, ta’til, smena, dam kuni, avans va qo‘shimcha ish so‘rovlari shu yerda paydo bo‘ladi." />
        ) : (
          <>
            {marks.length ? <GroupTitle>Belgilash so‘rovlari</GroupTitle> : null}
            {markDays.map((date) => (
              <View key={date} style={{ gap: 8 }}>
                <Text style={{ color: c.muted, fontSize: 13, fontWeight: "600", marginLeft: 4 }}>{dayTitle(date)}</Text>
                {marks
                  .filter((p) => p.date === date)
                  .map((p) => (
                    <MarkCard key={p.id} item={p} busy={busy === p.id} onDecide={(ok) => void decide(p, ok)} />
                  ))}
              </View>
            ))}
            {others.length && marks.length ? <GroupTitle>Boshqa so‘rovlar</GroupTitle> : null}
            {others.map((p) => (
              <Card key={`${p.kind}-${p.id}`} style={{ gap: 8 }}>
                <Text style={{ color: c.ink, fontWeight: "700", fontSize: 15.5 }}>{p.title}</Text>
                <Text style={{ color: c.muted, fontSize: 13.5 }}>{p.sub}</Text>
                {p.extra ? <Text style={{ color: c.ink, fontSize: 13.5 }}>«{p.extra}»</Text> : null}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  <Button title="Tasdiqlash" icon="checkmark" busy={busy === p.id} onPress={() => void decide(p, true)} style={{ flex: 1, height: 44 }} />
                  <Button title="Rad" tone="danger" disabled={busy === p.id} onPress={() => void decide(p, false)} style={{ flex: 0, minWidth: 90, height: 44 }} />
                </View>
              </Card>
            ))}
          </>
        )
      ) : null}

      {view === "map" ? <BranchMap rows={rows} branches={branches} /> : null}

      {view === "week" ? (
        !analytics ? (
          <Empty icon="stats-chart-outline" title="Xulosa mavjud emas" text="Bu bo‘lim uchun boshqaruv paneli huquqi kerak." />
        ) : (
          <>
            <Card style={{ flexDirection: "row", paddingVertical: 14 }}>
              {(
                [
                  ["Davomat", analytics.current.attendanceRate, analytics.previous.attendanceRate, "%"],
                  ["Vaqtida", analytics.current.punctuality, analytics.previous.punctuality, "%"],
                  ["Kelmagan", analytics.current.absent, analytics.previous.absent, ""],
                ] as const
              ).map(([label, now, prev, unit], i) => {
                const delta = now - prev;
                const good = label === "Kelmagan" ? delta <= 0 : delta >= 0;
                return (
                  <View key={label} style={[{ flex: 1, alignItems: "center", gap: 2 }, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line }]}>
                    <Text style={{ color: c.ink, fontSize: 22, fontWeight: "800" }}>
                      {now}
                      {unit}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 12 }}>{label}</Text>
                    {delta ? <Text style={{ color: good ? c.success : c.danger, fontSize: 11.5, fontWeight: "600" }}>{`${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)}`}</Text> : null}
                  </View>
                );
              })}
            </Card>
            {analytics.punctual.length ? (
              <>
                <GroupTitle>Eng intizomlilar</GroupTitle>
                <Group>
                  {analytics.punctual.slice(0, 5).map((p, i) => (
                    <View key={p.id} style={[st.row, i < Math.min(5, analytics.punctual.length) - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
                      <Icon name="medal" size={18} color={["#F5B301", "#A8B0BA", "#C97A40"][i] || c.muted} />
                      <Text style={{ flex: 1, color: c.ink }}>{p.name}</Text>
                      <Text style={{ color: c.muted }}>{p.present} kun</Text>
                    </View>
                  ))}
                </Group>
              </>
            ) : null}
            {analytics.latecomers.length ? (
              <>
                <GroupTitle>Ko‘p kechikkanlar</GroupTitle>
                <Group>
                  {analytics.latecomers.slice(0, 5).map((p, i) => (
                    <View key={p.id} style={[st.row, i < Math.min(5, analytics.latecomers.length) - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
                      <Icon name="alarm-outline" size={18} color={c.warn} />
                      <Text style={{ flex: 1, color: c.ink }}>{p.name}</Text>
                      <Text style={{ color: c.warn }}>
                        {p.late} marta · {p.lateMinutes} daq
                      </Text>
                    </View>
                  ))}
                </Group>
              </>
            ) : null}
            {analytics.branches.length > 1 ? (
              <>
                <GroupTitle>Filiallar</GroupTitle>
                <Group>
                  {analytics.branches.map((b, i) => (
                    <View key={b.id} style={[st.row, i < analytics.branches.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
                      <Text style={{ flex: 1, color: c.ink }}>{b.name}</Text>
                      <Text style={{ color: c.muted }}>
                        {b.attendanceRate}% · {b.punctuality}% vaqtida
                      </Text>
                    </View>
                  ))}
                </Group>
              </>
            ) : null}
          </>
        )
      ) : null}

      {view === "desk" && auth ? <DeskView role={auth.user.role} reloadKey={moneyKey + pending.length} onOpen={(v) => setView(v as MView)} /> : null}
      {view === "devices" && canDevices ? <DevicesView /> : null}
      {view === "money" && canMoney ? <MoneyView canAdvances={canMoneyAdvances} canFines={canMoneyAdvances} reloadKey={moneyKey} /> : null}
      <FineSheet
        visible={fining}
        direct={fineDirectRole}
        onClose={() => setFining(false)}
        onDone={(text) => {
          setFining(false);
          Alert.alert("Tayyor", text);
          setMoneyKey((k) => k + 1);
          void load();
        }}
      />
      <AnnounceSheet visible={announcing} branches={branches} onClose={() => setAnnouncing(false)} />
    </Screen>
  );
}

function RosterLine({ row, last }: { row: RosterRow; last: boolean }) {
  const { c } = useTheme();
  const r = row;
  const state: Record<RosterRow["state"], [string, "ok" | "warn" | "bad" | "muted" | "info" | "rest"]> = {
    IN: [r.late ? `${r.record?.checkIn} · ${r.record?.lateMinutes} daq kech` : `${r.record?.checkIn} · ishda`, r.late ? "warn" : "ok"],
    LEFT: [`${r.record?.checkIn}–${r.record?.checkOut}`, "muted"],
    ABSENT: ["Kelmadi", "bad"],
    NOT_YET: [r.scheduledStart ? `${r.scheduledStart} da` : "Hali yo‘q", "info"],
    ON_LEAVE: ["Ta’tilda", "rest"],
    DAY_OFF: ["Dam olish", "muted"],
    UPCOMING: ["Keyinroq", "muted"],
    PRACTICE: ["Mashq davri", "info"],
  };
  const [label, tone] = state[r.state];
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/employee/[id]", params: { id: r.employee.id } })}
      style={({ pressed }) => [st.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }, pressed && { opacity: 0.6 }]}
    >
      {r.employee.photoDataUrl ? (
        <Image source={{ uri: mediaUri(r.employee.photoDataUrl) }} style={st.avatar} />
      ) : (
        <View style={[st.avatar, { backgroundColor: `${c.accent}1A`, alignItems: "center", justifyContent: "center" }]}>
          <Text style={{ color: c.accent, fontWeight: "700", fontSize: 12 }}>
            {r.employee.firstName[0]}
            {r.employee.lastName[0]}
          </Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.ink, fontWeight: "600" }} numberOfLines={1}>
          {name(r.employee)}
          {r.record?.flags?.length ? " ⚑" : ""}
        </Text>
        {r.branch ? <Text style={{ color: c.muted, fontSize: 12 }}>{r.branch}</Text> : null}
      </View>
      <Badge text={label} tone={tone} />
      <Icon name="chevron-forward" size={16} color={c.muted} />
    </Pressable>
  );
}

/** Belgilash so‘rovi kartasi: xodim, Kirish/Chiqish, vaqt, filial, izoh — Rad etish / Qabul qilish. */
function MarkCard({ item, busy, onDecide }: { item: Pending; busy: boolean; onDecide: (approve: boolean) => void }) {
  const { c } = useTheme();
  const tone = item.markKind === "IN" ? c.success : c.danger;
  return (
    <Card style={{ gap: 10 }}>
      <Pressable onPress={() => item.employeeId && router.push({ pathname: "/employee/[id]", params: { id: item.employeeId } })} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {item.photo ? (
          <Image source={{ uri: mediaUri(item.photo) }} style={st.avatar} />
        ) : (
          <View style={[st.avatar, { backgroundColor: `${c.accent}1A`, alignItems: "center", justifyContent: "center" }]}>
            <Icon name="person" size={18} color={c.accent} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.ink, fontWeight: "700", fontSize: 15.5 }} numberOfLines={2}>
            {item.title}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name="business-outline" size={13} color={c.muted} />
            <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
              {item.branch}
            </Text>
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: tone, fontSize: 12, fontWeight: "700" }}>{item.markKind === "IN" ? "KIRISH" : "CHIQISH"}</Text>
          <Text style={{ color: c.ink, fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{item.time}</Text>
        </View>
      </Pressable>
      {item.extra ? <Text style={{ color: c.ink, fontSize: 14, lineHeight: 20 }}>«{item.extra}»</Text> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button title="Rad etish" icon="close" tone="danger" disabled={busy} onPress={() => onDecide(false)} style={{ flex: 1, height: 44 }} />
        <Button title="Qabul qilish" icon="checkmark" busy={busy} onPress={() => onDecide(true)} style={{ flex: 1, height: 44 }} />
      </View>
    </Card>
  );
}

function AnnounceSheet({ visible, branches, onClose }: { visible: boolean; branches: Branch[]; onClose: () => void }) {
  const { c } = useTheme();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [all, setAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const r = await mcall<{ recipients: number; delivered: number }>("/quick-announce", { title: title.trim(), message: message.trim(), branchIds: all ? [] : targets });
      haptic.success();
      Alert.alert("Yuborildi", `${r.recipients} xodimga yuborildi.`);
      setTitle("");
      setMessage("");
      onClose();
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} title="Tezkor e’lon" subtitle="Xodimlarga ilova va Telegram orqali" onClose={onClose}>
      <TextInput value={title} onChangeText={setTitle} placeholder="Sarlavha" placeholderTextColor={c.muted} maxLength={120} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]} />
      <TextInput value={message} onChangeText={setMessage} placeholder="Xabar matni" placeholderTextColor={c.muted} multiline maxLength={1500} style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card, minHeight: 100, textAlignVertical: "top" }]} />
      {branches.length > 1 ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Switch value={all} onValueChange={setAll} />
            <Text style={{ color: c.ink }}>Barcha filiallarga</Text>
          </View>
          {!all ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {branches.map((b) => {
                const on = targets.includes(b.id);
                return (
                  <Pressable key={b.id} onPress={() => setTargets((t) => (on ? t.filter((x) => x !== b.id) : [...t, b.id]))} style={[st.chip, { borderColor: on ? c.accent : c.line, backgroundColor: on ? `${c.accent}18` : c.card }]}>
                    <Text style={{ color: on ? c.accent : c.ink }}>{b.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </>
      ) : null}
      <Button title="Yuborish" icon="send" busy={busy} disabled={title.trim().length < 3 || message.trim().length < 3 || (!all && !targets.length)} onPress={() => void send()} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  round: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  bar: { height: 8, borderRadius: 4, overflow: "hidden" },
  tile: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 42, borderRadius: 12 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1 },
});
