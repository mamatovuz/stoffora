import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useState } from "react";
import { Alert, Linking, ScrollView, Switch, Text } from "react-native";
import { Group, GroupTitle, Hint, Row } from "@/components/ui";
import { APP_VERSION } from "@/lib/config";
import { dateUz } from "@/lib/format";
import { pushPermission, registerPush, type PushState } from "@/lib/push";
import { useSession } from "@/lib/session";
import { ios, useTheme } from "@/lib/theme";
import { useData } from "@/lib/useData";

type Me = { device?: { id: string; platform: string; model?: string; status: string; createdAt: string; lastSeenAt?: string }; push: boolean; faceEnrolled: boolean; passPercent: number };

/**
 * Xavfsizlik: ishonchli telefon, ilova qulfi, push. Telefon almashtirish faqat HR tasdig‘i bilan;
 * «Chiqish» qurilma bog‘lanishini o‘chirmaydi.
 */
export default function Security() {
  const { c } = useTheme();
  const { prefs, setPrefs, logout } = useSession();
  const { data } = useData<Me>("/mobile/me", { maxAgeMs: 0 });
  const [push, setPush] = useState<PushState>("undetermined");
  const [bio, setBio] = useState({ available: false, label: ios ? "Face ID" : "Barmoq izi" });
  useEffect(() => {
    void pushPermission().then(setPush);
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
    const state = await registerPush(true).catch(() => "denied" as const);
    setPush(state);
    if (state === "denied") Linking.openSettings();
  };
  const confirmLogout = () =>
    Alert.alert("Chiqish", "Ilovadan chiqasizmi? Telefon sizga bog‘langanicha qoladi — qayta kirish uchun Mini App’dan yangi kod olasiz.", [
      { text: "Bekor qilish", style: "cancel" },
      { text: "Chiqish", style: "destructive", onPress: () => void logout() },
    ]);

  const d = data?.device;
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <GroupTitle>Ishonchli telefon</GroupTitle>
      <Group>
        <Row icon="phone-portrait" label={d?.model || (d?.platform === "ios" ? "iPhone" : "Android")} value={d?.status === "ACTIVE" ? "Faol" : "—"} />
        <Row icon="calendar" iconColor="#8E8E93" label="Ulangan" value={d ? dateUz(d.createdAt.slice(0, 10)) : "—"} />
        <Row icon="scan" iconColor="#34C759" label="Davomat Face ID" value={data?.faceEnrolled ? "Sozlangan" : "Sozlanmagan"} last />
      </Group>
      <Hint icon="shield-checkmark-outline">
        Har bir xodimda bitta ishonchli telefon. Telefon kaliti qurilmadan chiqmaydi. Yangi telefonga o‘tsangiz, Mini App’dan kod olib yangi telefonda kiriting — HR tasdiqlagach shu telefon o‘chiriladi.
      </Hint>

      <GroupTitle>Ilova</GroupTitle>
      <Group>
        {bio.available ? <Row icon="lock-closed" iconColor="#5856D6" label={`${bio.label} bilan qulflash`} right={<Switch value={Boolean(prefs.appLock)} onValueChange={(v) => void toggleLock(v)} />} /> : null}
        <Row
          icon="notifications"
          iconColor="#FF3B30"
          label="Push xabarnomalar"
          value={push === "granted" ? (data?.push ? "Yoqilgan" : "Ruxsat bor") : push === "unavailable" ? "Mavjud emas" : "O‘chiq"}
          onPress={push === "granted" ? undefined : () => void enablePush()}
        />
        <Row icon="information-circle" iconColor="#8E8E93" label="Ilova versiyasi" value={APP_VERSION} last />
      </Group>
      {bio.available ? <Text style={{ color: c.muted, fontSize: 12.5, paddingHorizontal: 4 }}>Ilova qulfi davomat Face ID’sidan alohida: ishga kelishda yuzingiz baribir tekshiriladi.</Text> : null}

      <Group>
        <Row icon="log-out-outline" label="Chiqish" danger onPress={confirmLogout} last />
      </Group>
    </ScrollView>
  );
}
