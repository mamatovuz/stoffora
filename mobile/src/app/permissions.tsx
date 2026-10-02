import { useCameraPermissions } from "expo-camera";
import * as LocalAuthentication from "expo-local-authentication";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Icon, type IconName } from "@/components/ui";
import { locationPermission } from "@/lib/location";
import { pushPermission, registerPush, type PushState } from "@/lib/push";
import { useSession } from "@/lib/session";
import { ios, useTheme } from "@/lib/theme";

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
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 56, paddingBottom: insets.bottom + 20, paddingHorizontal: 20, gap: 8 }}>
      <Text style={{ color: c.ink, fontSize: 28, fontWeight: "700", letterSpacing: -0.4 }}>Ruxsatlar</Text>
      <Text style={{ color: c.muted, fontSize: 15, lineHeight: 21, marginBottom: 20 }}>Faqat kerakli paytda ishlatiladi. Keyin sozlamalardan o‘zgartirish mumkin.</Text>
      <View style={[st.list, { backgroundColor: c.card }]}>

      <PermCard
        icon="camera"
        title="Kamera"
        text="Face ID va filial QR kodi uchun"
        state={cameraState}
        onAllow={() => void requestCamera()}
      />
      <PermCard
        icon="location"
        title="Joylashuv"
        text="Faqat belgilash paytida, fonda emas"
        state={location}
        onAllow={() => void locationPermission(true).then(setLocation)}
      />
      <PermCard
        icon="notifications"
        title="Bildirishnomalar"
        text="So‘rov javoblari, e’lonlar, eslatmalar"
        // Ruxsat berilgan, lekin token xatosi — ruxsat kartasi uchun «yoqilgan» (xato Xavfsizlik ekranida ko‘rinadi).
        state={push === "error" ? "granted" : push}
        last={!bio.available}
        onAllow={() => void registerPush(true).then(setPush).catch(() => setPush("denied"))}
      />
      {bio.available ? (
        <PermCard
          icon={ios ? "scan" : "finger-print"}
          title={`${bio.label} bilan qulflash`}
          text="Ixtiyoriy · ilovani ochishda"
          last
          state={prefs.appLock ? "granted" : "undetermined"}
          allowText="Yoqish"
          onAllow={() =>
            void LocalAuthentication.authenticateAsync({ promptMessage: "Qulfni yoqish" }).then((r) => {
              if (r.success) void setPrefs({ appLock: true });
            })
          }
        />
      ) : null}
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      <Button title="Davom etish" onPress={() => void finish()} big />
    </ScrollView>
  );
}

function PermCard({ icon, title, text, state, onAllow, allowText = "Ruxsat", last }: { icon: IconName; title: string; text: string; state: Perm; onAllow: () => void; allowText?: string; last?: boolean }) {
  const { c } = useTheme();
  const action =
    state === "granted" ? (
      <Icon name="checkmark-circle" size={24} color={c.success} />
    ) : state === "unavailable" ? (
      <Text style={{ color: c.muted, fontSize: 13 }}>Yo‘q</Text>
    ) : (
      <Pressable onPress={state === "denied" ? () => void Linking.openSettings() : onAllow} style={({ pressed }) => [st.pill, { backgroundColor: `${c.accent}14` }, pressed && { opacity: 0.6 }]}>
        <Text style={{ color: c.accent, fontWeight: "600", fontSize: 14 }}>{state === "denied" ? "Sozlamalar" : allowText}</Text>
      </Pressable>
    );
  return (
    <View style={st.row}>
      <Icon name={`${icon}-outline` as IconName} size={22} color={c.ink} />
      <View style={[st.body, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.ink, fontSize: 16, fontWeight: "500" }}>{title}</Text>
          <Text style={{ color: c.muted, fontSize: 13 }}>{text}</Text>
        </View>
        {action}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  list: { borderRadius: 16, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingLeft: 16 },
  body: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14, paddingRight: 16 },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99 },
});
