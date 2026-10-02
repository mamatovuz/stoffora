import { useCameraPermissions } from "expo-camera";
import * as LocalAuthentication from "expo-local-authentication";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Icon, type IconName } from "@/components/ui";
import { locationPermission } from "@/lib/location";
import { pushPermission, registerPush, type PushState } from "@/lib/push";
import { useSession } from "@/lib/session";
import { ios, radius, useTheme } from "@/lib/theme";

/*
 * Ruxsatlar bilan tanishtiruv: har biri nima uchun kerakligi tushuntiriladi va faqat xodim
 * «Ruxsat berish»ni bosganda so‘raladi. Rad etilsa — ilova ishlayveradi, kerakli joyda yana
 * tushuntiriladi va sozlamalarga yo‘l ko‘rsatiladi. Fon joylashuvi so‘ralmaydi.
 */
type Perm = "granted" | "denied" | "undetermined" | "unavailable";

export default function Permissions() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { setPrefs, prefs } = useSession();
  const [camera, requestCamera] = useCameraPermissions();
  const [location, setLocation] = useState<Perm>("undetermined");
  const [push, setPush] = useState<PushState>("undetermined");
  const [bio, setBio] = useState<{ available: boolean; label: string }>({ available: false, label: "" });

  useEffect(() => {
    void locationPermission(false).then(setLocation);
    void pushPermission().then(setPush);
    void (async () => {
      const [has, enrolled, types] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync(), LocalAuthentication.supportedAuthenticationTypesAsync()]);
      const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      setBio({ available: has && enrolled, label: ios ? (face ? "Face ID" : "Touch ID") : face ? "Yuz bilan ochish" : "Barmoq izi" });
    })();
  }, []);

  const cameraState: Perm = camera?.granted ? "granted" : camera && !camera.canAskAgain ? "denied" : "undetermined";
  const finish = async () => {
    await setPrefs({ onboarded: true });
    router.replace("/(tabs)");
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24, paddingHorizontal: 18, gap: 14 }}>
      <Text style={{ color: c.ink, fontSize: ios ? 32 : 26, fontWeight: "800" }}>Ruxsatlar</Text>
      <Text style={{ color: c.muted, fontSize: 15, lineHeight: 21, marginBottom: 4 }}>
        Staffora faqat kerakli paytda va faqat shu maqsadlar uchun foydalanadi. Istalgan vaqtda telefon sozlamalaridan o‘zgartirishingiz mumkin.
      </Text>

      <PermCard
        icon="camera"
        color="#0A84FF"
        title="Kamera"
        text="Ishga kelish/ketishda yuzingizni tekshirish (Face ID) va filial QR kodini skanerlash uchun. Rasm faqat tekshiruv uchun serverga yuboriladi."
        state={cameraState}
        onAllow={() => void requestCamera()}
      />
      <PermCard
        icon="location"
        color="#34C759"
        title="Joylashuv (faqat ilova ochiqligida)"
        text="Belgilash paytida filial hududida ekaningizni tekshirish uchun. Fonda kuzatilmaydi, hudud hisobini server qiladi."
        state={location}
        onAllow={() => void locationPermission(true).then(setLocation)}
      />
      <PermCard
        icon="notifications"
        color="#FF9500"
        title="Bildirishnomalar"
        text="So‘rovlaringiz javobi, e’lonlar, oylik va avans, smena eslatmalari — Telegram’siz, to‘g‘ridan-to‘g‘ri telefoningizga."
        // Ruxsat berilgan, lekin token xatosi — ruxsat kartasi uchun «yoqilgan» (xato Xavfsizlik ekranida ko‘rinadi).
        state={push === "error" ? "granted" : push}
        onAllow={() => void registerPush(true).then(setPush).catch(() => setPush("denied"))}
      />
      {bio.available ? (
        <PermCard
          icon={ios ? "scan" : "finger-print"}
          color="#8B5CF6"
          title={`${bio.label} bilan qulflash (ixtiyoriy)`}
          text="Ilovani ochishda telefoningiz biometriyasi so‘raladi. Bu davomat Face ID’sidan alohida — ishga kelishda yuz baribir tekshiriladi."
          state={prefs.appLock ? "granted" : "undetermined"}
          allowText="Yoqish"
          onAllow={() =>
            void LocalAuthentication.authenticateAsync({ promptMessage: "Qulfni yoqish" }).then((r) => {
              if (r.success) void setPrefs({ appLock: true });
            })
          }
        />
      ) : null}

      <Button title="Davom etish" onPress={() => void finish()} big style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

function PermCard({ icon, color, title, text, state, onAllow, allowText = "Ruxsat berish" }: { icon: IconName; color: string; title: string; text: string; state: Perm; onAllow: () => void; allowText?: string }) {
  const { c } = useTheme();
  return (
    <View style={[st.card, { backgroundColor: c.card, borderRadius: radius.card }]}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <View style={[st.icon, { backgroundColor: color }]}>
          <Icon name={icon} size={20} color="#fff" />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: c.ink, fontSize: 16, fontWeight: "600" }}>{title}</Text>
          <Text style={{ color: c.muted, fontSize: 13.5, lineHeight: 19 }}>{text}</Text>
        </View>
      </View>
      {state === "granted" ? (
        <View style={st.state}>
          <Icon name="checkmark-circle" size={18} color={c.success} />
          <Text style={{ color: c.success, fontWeight: "600" }}>Yoqilgan</Text>
        </View>
      ) : state === "denied" ? (
        <Button title="Sozlamalarni ochish" tone="soft" icon="settings-outline" onPress={() => void Linking.openSettings()} />
      ) : state === "unavailable" ? (
        <Text style={{ color: c.muted, fontSize: 13 }}>Bu qurilmada mavjud emas (emulyator yoki sozlanmagan).</Text>
      ) : (
        <Button title={allowText} tone="soft" onPress={onAllow} />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: { padding: 16, gap: 14 },
  icon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  state: { flexDirection: "row", gap: 6, alignItems: "center" },
});
