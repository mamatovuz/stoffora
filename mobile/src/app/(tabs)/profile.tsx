import { router, useLocalSearchParams } from "expo-router";
import { mediaUri } from "@/lib/config";
import { go } from "@/lib/nav";
import { useEffect } from "react";
import { Alert, Image, Linking, Platform, StyleSheet, Text, View } from "react-native";
import { Card, Group, GroupTitle, Loading, Row, Screen } from "@/components/ui";
import { WEEKDAYS_SHORT, tashkentIsoDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { HomeData } from "@/lib/types";
import { useData } from "@/lib/useData";

type Section = "directory" | "payslips" | "docs" | "helpdesk" | "certificates" | "feedback" | "birthdays" | "security";
const ROUTES: Record<Section, Parameters<typeof router.push>[0]> = {
  directory: "/directory",
  payslips: "/payslips",
  docs: "/documents",
  helpdesk: { pathname: "/helpdesk", params: { view: "questions" } },
  certificates: { pathname: "/helpdesk", params: { view: "certificates" } },
  feedback: { pathname: "/helpdesk", params: { view: "feedback" } },
  birthdays: "/birthdays",
  security: "/security",
};

/** Profil — Mini App’dagi kabi: shaxsiy ma’lumot, ish joyi, grafik, hujjatlar, HR bilan aloqa, xavfsizlik. */
export default function Profile() {
  const { c } = useTheme();
  const params = useLocalSearchParams<{ section?: Section }>();
  const { logout } = useSession();
  const { data, refreshing, reload } = useData<HomeData>("/mini/home");
  useEffect(() => {
    if (params.section && ROUTES[params.section]) go(ROUTES[params.section]);
  }, [params.section]);

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
  const confirmLogout = () =>
    Alert.alert("Chiqish", "Ilovadan chiqasizmi? Telefon sizga bog‘langanicha qoladi — qayta kirish uchun yangi kod kerak bo‘ladi.", [
      { text: "Bekor qilish", style: "cancel" },
      { text: "Chiqish", style: "destructive", onPress: () => void logout() },
    ]);

  return (
    <Screen title="Profil" refreshing={refreshing} onRefresh={reload}>
      <Card style={st.head}>
        {e.photoDataUrl ? (
          <Image source={{ uri: mediaUri(e.photoDataUrl) }} style={st.avatar} />
        ) : (
          <View style={[st.avatar, { backgroundColor: `${c.accent}22`, alignItems: "center", justifyContent: "center" }]}>
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
        <Row icon="location" iconColor="#34C759" label={data.branch?.name || "Filial biriktirilmagan"} sub={data.branch?.address} onPress={data.branch ? openMap : undefined} />
        <Row icon="people" iconColor="#5856D6" label="Hamkasblar ma’lumotnomasi" onPress={() => go("/directory")} last />
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

      <GroupTitle>Hujjatlar va pul</GroupTitle>
      <Group>
        <Row icon="wallet" iconColor="#34C759" label="Mening oyligim va avans" onPress={() => go("/salary")} />
        <Row icon="receipt" iconColor="#FF9500" label="Hisob varaqalar" onPress={() => go("/payslips")} />
        <Row icon="folder" iconColor="#0A84FF" label="Hujjatlarim" onPress={() => go("/documents")} last />
      </Group>

      <GroupTitle>Ishlarim</GroupTitle>
      <Group>
        <Row icon="checkbox" iconColor="#5856D6" label="Vazifalar" onPress={() => go({ pathname: "/work", params: { view: "tasks" } })} />
        <Row icon="list" iconColor="#34C759" label="Bugungi checklist" onPress={() => go({ pathname: "/work", params: { view: "checklist" } })} />
        <Row icon="warning" iconColor="#FF9500" label="Muammo haqida xabar berish" onPress={() => go({ pathname: "/work", params: { view: "incidents" } })} last />
      </Group>

      <GroupTitle>O‘qish va ID</GroupTitle>
      <Group>
        <Row icon="school" iconColor="#5856D6" label="Kurslar va testlar" onPress={() => go({ pathname: "/learn", params: { view: "courses" } })} />
        <Row icon="book" iconColor="#FF9500" label="Bilimlar bazasi" onPress={() => go({ pathname: "/learn", params: { view: "kb" } })} />
        <Row icon="id-card" iconColor="#34C759" label="Mening ID (QR guvohnoma)" onPress={() => go({ pathname: "/learn", params: { view: "badge" } })} last />
      </Group>

      <GroupTitle>HR bilan aloqa</GroupTitle>
      <Group>
        <Row icon="chatbubble-ellipses" label="HR’ga savol berish" onPress={() => go({ pathname: "/helpdesk", params: { view: "questions" } })} />
        <Row icon="document-text" iconColor="#5AC8FA" label="Ma’lumotnoma (spravka) so‘rash" onPress={() => go({ pathname: "/helpdesk", params: { view: "certificates" } })} />
        <Row icon="megaphone" iconColor="#FF9500" label="Taklif yoki shikoyat (anonim mumkin)" onPress={() => go({ pathname: "/helpdesk", params: { view: "feedback" } })} />
        <Row icon="gift" iconColor="#FF2D55" label="Tug‘ilgan kunlar" onPress={() => go("/birthdays")} last />
      </Group>

      <GroupTitle>Ilova</GroupTitle>
      <Group>
        <Row icon="settings" iconColor="#8E8E93" label="Sozlamalar" sub="Mavzu, PIN-kod, bildirishnomalar, ilova haqida" onPress={() => go("/security")} />
        <Row icon="notifications" iconColor="#FF3B30" label="Bildirishnomalar" onPress={() => go("/notifications")} />
        <Row icon="log-out-outline" label="Chiqish" danger onPress={confirmLogout} last />
      </Group>
    </Screen>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { width: 66, height: 66, borderRadius: 33 },
  week: { flexDirection: "row", gap: 5, padding: 10 },
  weekDay: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 8, borderRadius: 10 },
});
