import * as Clipboard from "expo-clipboard";
import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Group, GroupTitle, Hint, Icon, Row, Sheet, haptic } from "@/components/ui";
import { API_URL, APP_VERSION } from "@/lib/config";
import { dateUz } from "@/lib/format";
import { lastPushError, pushPermission, registerPush, type PushState } from "@/lib/push";
import { useSession, type Prefs } from "@/lib/session";
import { ios, useTheme } from "@/lib/theme";
import { useData } from "@/lib/useData";
import { go } from "@/lib/nav";

type Me = { device?: { id: string; platform: string; model?: string; status: string; createdAt: string; lastSeenAt?: string }; push: boolean; faceEnrolled: boolean; passPercent: number };
const THEMES: [NonNullable<Prefs["theme"]>, string][] = [
  ["system", "Tizimdagi kabi"],
  ["light", "Yorug‘"],
  ["dark", "Qorong‘i"],
];

/**
 * Sozlamalar (Verifix uslubida guruhlangan): interfeys, xavfsizlik, bildirishnomalar, ishonchli telefon,
 * ilova haqida. Telefon almashtirish faqat HR tasdig‘i bilan; «Chiqish» qurilma bog‘lanishini o‘chirmaydi.
 */
export default function Settings() {
  const { c } = useTheme();
  const { prefs, setPrefs, logout } = useSession();
  const { data } = useData<Me>("/mobile/me", { maxAgeMs: 0 });
  const [push, setPush] = useState<PushState>("undetermined");
  const [bio, setBio] = useState({ available: false, label: ios ? "Face ID" : "Barmoq izi" });
  const [themeOpen, setThemeOpen] = useState(false);
  useEffect(() => {
    // Ruxsat bo‘lsa — tokenni darhol (qayta) ro‘yxatdan o‘tkazamiz va natijani ko‘rsatamiz.
    void pushPermission().then((p) => (p === "granted" ? registerPush(false).then(setPush) : setPush(p)));
    void (async () => {
      const [has, enrolled, types] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync(), LocalAuthentication.supportedAuthenticationTypesAsync()]);
      const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      setBio({ available: has && enrolled, label: ios ? (face ? "Face ID" : "Touch ID") : face ? "Yuz bilan ochish" : "Barmoq izi" });
    })();
  }, []);

  const toggleLock = async (next: boolean) => {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: next ? "Qulfni yoqish" : "Qulfni o‘chirish" });
    if (r.success) await setPrefs({ appLock: next });
  };
  const enablePush = async () => {
    const state = await registerPush(true).catch(() => "error" as const);
    setPush(state);
    if (state === "denied") Linking.openSettings();
  };
  const confirmLogout = () =>
    Alert.alert("Chiqish", "Ilovadan chiqasizmi? Telefon sizga bog‘langanicha qoladi — qayta kirish uchun Mini App’dan yangi kod olasiz.", [
      { text: "Bekor qilish", style: "cancel" },
      { text: "Chiqish", style: "destructive", onPress: () => void logout() },
    ]);
  const copySerial = async () => {
    if (!data?.device) return;
    await Clipboard.setStringAsync(data.device.id);
    haptic.success();
  };

  const d = data?.device;
  const theme = prefs.theme || "system";
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <GroupTitle>Interfeys</GroupTitle>
      <Group>
        <Row icon="color-palette" iconColor="#5856D6" label="Mavzu" value={THEMES.find(([k]) => k === theme)?.[1]} onPress={() => setThemeOpen(true)} />
        <Row icon="language" iconColor="#0A84FF" label="Ilova tili" value="O‘zbekcha" last />
      </Group>

      <GroupTitle>Xavfsizlik</GroupTitle>
      <Group>
        <Row
          icon="keypad"
          iconColor="#0A84FF"
          label="PIN-kod bilan kirish"
          sub={prefs.pinLock ? "Ilovani ochishda 4 xonali PIN so‘raladi" : "Ilovani ochishda 4 xonali PIN"}
          right={<Switch value={Boolean(prefs.pinLock)} onValueChange={(v) => go({ pathname: "/pin", params: { mode: v ? "set" : "disable" } })} />}
        />
        {prefs.pinLock ? <Row icon="refresh" iconColor="#8E8E93" label="PIN-kodni o‘zgartirish" onPress={() => go({ pathname: "/pin", params: { mode: "change" } })} /> : null}
        {prefs.pinLock ? <Row icon="close-circle" iconColor="#FF3B30" label="PIN-kodni olib tashlash" onPress={() => go({ pathname: "/pin", params: { mode: "disable" } })} last={!bio.available} /> : null}
        {bio.available ? (
          <Row icon="finger-print" iconColor="#34C759" label={`${bio.label} bilan kirish`} right={<Switch value={Boolean(prefs.appLock)} onValueChange={(v) => void toggleLock(v)} />} last />
        ) : null}
      </Group>
      <Text style={{ color: c.muted, fontSize: 12.5, paddingHorizontal: 4 }}>
        PIN faqat shu telefonda saqlanadi. Unutsangiz — kirish ekranidagi «PIN-kodni unutdingizmi?» orqali Telegram’ga kelgan kod bilan yangisini o‘rnatasiz.
      </Text>

      <GroupTitle>Bildirishnomalar</GroupTitle>
      <Group>
        <Row
          icon="notifications"
          iconColor="#FF3B30"
          label="Push xabarnomalar"
          value={push === "granted" ? "Yoqilgan" : push === "error" ? "Xato" : push === "unavailable" ? "Mavjud emas" : "O‘chiq"}
          onPress={push === "granted" ? undefined : () => void enablePush()}
        />
        <Row icon="alarm" iconColor="#FF9500" label="Eslatmalar va bildirishnomalar" sub="Ish boshlanishi/oxiri eslatmasi, qaysi xabarlar telefonga kelsin" onPress={() => go("/reminders")} />
        <Row icon="mail-unread" iconColor="#34C759" label="Barcha bildirishnomalar" onPress={() => go("/notifications")} last />
      </Group>
      {push === "error" || (push === "unavailable" && lastPushError) ? <Hint tone="warn" icon="notifications-off-outline">{lastPushError}</Hint> : null}

      <GroupTitle>Ishonchli telefon</GroupTitle>
      <Group>
        <Row icon="phone-portrait" label={d?.model || (d?.platform === "ios" ? "iPhone" : "Android")} value={d?.status === "ACTIVE" ? "Faol" : "—"} />
        <Row icon="calendar" iconColor="#8E8E93" label="Ulangan" value={d ? dateUz(d.createdAt.slice(0, 10)) : "—"} />
        <Row icon="scan" iconColor="#34C759" label="Davomat Face ID" value={data?.faceEnrolled ? "Sozlangan" : "Sozlanmagan"} last />
      </Group>
      <Hint icon="shield-checkmark-outline">
        Har bir xodimda bitta ishonchli telefon. Telefon kaliti qurilmadan chiqmaydi. Yangi telefonga o‘tsangiz, Mini App’dan kod olib yangi telefonda kiriting — HR tasdiqlagach shu telefon o‘chiriladi.
      </Hint>

      <GroupTitle>Ilova haqida</GroupTitle>
      <Group>
        <Row icon="barcode" iconColor="#8E8E93" label="Seriya raqami" sub={d?.id || "—"} right={d ? <Icon name="copy-outline" size={18} color={c.muted} /> : undefined} onPress={d ? () => void copySerial() : undefined} />
        <Row icon="information-circle" iconColor="#8E8E93" label="Versiyasi" value={APP_VERSION} />
        <Row icon="document-lock" iconColor="#0A84FF" label="Maxfiylik siyosati" onPress={() => void Linking.openURL(`${API_URL.replace(/\/api$/, "")}/privacy.html`)} />
        <Row icon="trash-outline" iconColor="#FF3B30" label="Hisobni o‘chirish" onPress={() => void Linking.openURL(`${API_URL.replace(/\/api$/, "")}/delete-account.html`)} last />
      </Group>

      <Group>
        <Row icon="log-out-outline" label="Chiqish" danger onPress={confirmLogout} last />
      </Group>

      <Sheet visible={themeOpen} title="Mavzu" onClose={() => setThemeOpen(false)}>
        <Group>
          {THEMES.map(([key, label], i) => (
            <Pressable
              key={key}
              onPress={() => {
                haptic.select();
                void setPrefs({ theme: key });
                setThemeOpen(false);
              }}
              style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, minHeight: 52, borderBottomWidth: i < THEMES.length - 1 ? 0.5 : 0, borderBottomColor: c.line }}
            >
              <Text style={{ flex: 1, color: c.ink, fontSize: 16 }}>{label}</Text>
              <View>
                <Icon name={theme === key ? "radio-button-on" : "radio-button-off"} size={22} color={theme === key ? c.accent : c.muted} />
              </View>
            </Pressable>
          ))}
        </Group>
      </Sheet>
    </ScrollView>
  );
}
