import { useLocalSearchParams } from "expo-router";
import { mediaUri } from "@/lib/config";
import { go } from "@/lib/nav";
import { useEffect, useState } from "react";
import { Alert, Image, Linking, Platform, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { AppLoginGroup } from "@/components/AppLogin";
import { Card, Group, GroupTitle, Loading, Row, Screen } from "@/components/ui";
import type { ManagerSession } from "@/lib/api";
import { WEEKDAYS_SHORT, tashkentIsoDate } from "@/lib/format";
import { ROLE_LABEL, mcall } from "@/lib/manager";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { AccountInfo, HomeData } from "@/lib/types";
import { useData } from "@/lib/useData";

type Section = "directory" | "payslips" | "docs" | "helpdesk" | "certificates" | "feedback" | "birthdays" | "security" | "account";
const ROUTES: Partial<Record<Section, Parameters<typeof go>[0]>> = {
  directory: "/directory",
  payslips: "/payslips",
  docs: "/documents",
  helpdesk: { pathname: "/helpdesk", params: { view: "questions" } },
  certificates: { pathname: "/helpdesk", params: { view: "certificates" } },
  feedback: { pathname: "/helpdesk", params: { view: "feedback" } },
  birthdays: "/birthdays",
  security: "/security",
};

const confirmLogout = (logout: () => Promise<void>) =>
  Alert.alert("Chiqish", "Ilovadan chiqasizmi? Qayta kirish uchun login va parolingiz kerak bo‘ladi.", [
    { text: "Bekor qilish", style: "cancel" },
    { text: "Chiqish", style: "destructive", onPress: () => void logout() },
  ]);

/** Profil — kimligim, ish joyi, grafik, ilovaga kirish (login/parol) va sozlamalar. Bo‘limlar — «Bo‘limlar» tabida. */
export default function Profile() {
  const { session } = useSession();
  const params = useLocalSearchParams<{ section?: Section; t?: string }>();
  useEffect(() => {
    const target = params.section ? ROUTES[params.section] : undefined;
    if (target) go(target);
  }, [params.section]);
  const accountSignal = params.section === "account" ? params.t || "1" : undefined;
  if (session?.mode === "manager") return <ManagerProfile session={session} openSignal={accountSignal} />;
  return <EmployeeProfile openSignal={accountSignal} />;
}

/* ------------------------------------------------------------------ xodim --- */
function EmployeeProfile({ openSignal }: { openSignal?: string }) {
  const { c } = useTheme();
  const { logout } = useSession();
  const { data, refreshing, reload } = useData<HomeData>("/mini/home");
  const account = useData<AccountInfo>("/mini/account", { maxAgeMs: 60_000 });

  if (!data)
    return (
      <Screen title="Profil">
        <Loading />
      </Screen>
    );
  const e = data.employee;
  const today = new Date(`${tashkentIsoDate()}T12:00:00Z`).getUTCDay();
  const openMap = () => {
    if (!data.branch) return;
    const { latitude: lat, longitude: lng } = data.branch;
    const url = Platform.OS === "ios" ? `http://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(data.branch.name)}` : `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(data.branch.name)})`;
    void Linking.openURL(url);
  };
  const refresh = () => {
    void reload();
    void account.reload();
  };
  // Server eski bo‘lsa (/mini/account yo‘q) — bosh sahifadagi login ko‘rsatiladi.
  const info: AccountInfo | null = account.data || (e.login ? { login: e.login, suggested: e.login, hasPassword: true } : null);

  return (
    <Screen title="Profil" refreshing={refreshing} onRefresh={refresh}>
      <Card style={st.head}>
        {e.photoDataUrl ? (
          <Image source={{ uri: mediaUri(e.photoDataUrl) }} style={st.avatar} />
        ) : (
          <View style={[st.avatar, st.initials, { backgroundColor: `${c.accent}22` }]}>
            <Text style={{ color: c.accent, fontSize: 26, fontWeight: "700" }}>
              {e.firstName[0]}
              {e.lastName[0]}
            </Text>
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.ink, fontSize: 20, fontWeight: "700" }}>
            {e.firstName} {e.lastName}
          </Text>
          <Text style={{ color: c.muted, fontSize: 14 }}>{[data.position?.name, data.department?.name].filter(Boolean).join(" · ") || "—"}</Text>
          {e.employeeNo ? <Text style={{ color: c.muted, fontSize: 12.5 }}>Tabel № {e.employeeNo}</Text> : null}
        </View>
      </Card>

      <GroupTitle>Ish joyi</GroupTitle>
      <Group>
        <Row icon="business" label={data.company?.name || "Kompaniya"} />
        <Row icon="location" label={data.branch?.name || "Filial biriktirilmagan"} sub={data.branch?.address} onPress={data.branch ? openMap : undefined} last />
      </Group>

      {data.schedule ? (
        <>
          <GroupTitle>Ish grafigi · {data.schedule.name}</GroupTitle>
          <Card style={st.week}>
            {[1, 2, 3, 4, 5, 6, 0].map((day) => {
              const d = data.schedule!.days.find((x) => x.day === day);
              const personal = Boolean(e.restDays?.includes(day));
              const working = Boolean(d?.enabled) && !personal;
              return (
                <View key={day} style={[st.weekDay, { backgroundColor: working ? `${c.accent}12` : personal ? `${c.violet}18` : c.tint }, day === today && { borderWidth: 1.5, borderColor: c.accent }]}>
                  <Text style={{ color: c.muted, fontSize: 11.5, fontWeight: "600" }}>{WEEKDAYS_SHORT[day]}</Text>
                  <Text style={{ color: working ? c.ink : personal ? c.violet : c.muted, fontSize: 11, fontWeight: "600" }}>{working ? d!.start.replace(/^0/, "").replace(/:00$/, "") : "Dam"}</Text>
                  {working ? <Text style={{ color: c.muted, fontSize: 10 }}>{d!.end.replace(/^0/, "").replace(/:00$/, "")}</Text> : null}
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      <AppLoginGroup mode="employee" account={info} onChanged={() => void account.reload()} openSignal={openSignal} />

      <GroupTitle>Ilova</GroupTitle>
      <Group>
        <Row icon="settings" label="Sozlamalar" sub="Mavzu, til, PIN-kod, bildirishnomalar" onPress={() => go("/security")} />
        <Row icon="log-out-outline" label="Chiqish" danger onPress={() => confirmLogout(logout)} last />
      </Group>
    </Screen>
  );
}

/* --------------------------------------------------------------- direktor --- */
function ManagerProfile({ session, openSignal }: { session: ManagerSession; openSignal?: string }) {
  const { c } = useTheme();
  const { logout } = useSession();
  const { user, company } = session;
  // Login kirishda saqlanadi; eski sessiyada bo‘lmasa — paneldan so‘raladi.
  const [fetched, setFetched] = useState<string | null>(null);
  useEffect(() => {
    if (session.login) return;
    let live = true;
    mcall<{ login: string | null }>("/auth/mobile-login")
      .then((r) => live && setFetched(r.login))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [session.login]);
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || "")
    .join("");

  return (
    <Screen title="Profil">
      <Card style={st.head}>
        {user.photoDataUrl ? (
          <Image source={{ uri: mediaUri(user.photoDataUrl) }} style={st.avatar} />
        ) : (
          <View style={[st.avatar, st.initials, { backgroundColor: `${c.accent}22` }]}>
            <Text style={{ color: c.accent, fontSize: 24, fontWeight: "700" }}>{initials.toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.ink, fontSize: 20, fontWeight: "700" }}>{user.name}</Text>
          <Text style={{ color: c.muted, fontSize: 14 }}>{ROLE_LABEL[user.role] || user.role}</Text>
          <Text style={{ color: c.muted, fontSize: 12.5 }}>{company.name}</Text>
        </View>
      </Card>

      <AppLoginGroup mode="manager" login={session.login || fetched} openSignal={openSignal} />

      <GroupTitle>Ilova</GroupTitle>
      <Group>
        <Row icon="settings" label="Sozlamalar" sub="Mavzu, til, PIN-kod" onPress={() => go("/security")} />
        <Row icon="log-out-outline" label="Chiqish" danger onPress={() => confirmLogout(logout)} last />
      </Group>
    </Screen>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { width: 66, height: 66, borderRadius: 33 },
  initials: { alignItems: "center", justifyContent: "center" },
  week: { flexDirection: "row", gap: 5, padding: 10 },
  weekDay: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 8, borderRadius: 10 },
});
