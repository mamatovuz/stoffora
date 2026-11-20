import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, haptic } from "@/components/ui";
import { errorText } from "@/lib/api";
import { deviceInfo } from "@/lib/device";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

/*
 * Eski ulash kodi — faqat staffora://activate?code=… havolasi orqali (eski Mini App / HR xabarlari).
 * Asosiy kirish endi login va parol (login.tsx); bu ekran ilovada menyudan ochilmaydi.
 */
const clean = (value: string) => value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 8);

export default function Activate() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ code?: string }>();
  const { activate } = useSession();
  const code = clean(params.code || "");
  const [error, setError] = useState("");
  const tried = useRef("");

  useEffect(() => {
    if (code.length !== 8 || tried.current === code) return;
    tried.current = code;
    activate(code, deviceInfo())
      .then(() => haptic.success())
      .catch((reason) => {
        haptic.error();
        setError(errorText(reason, "Faollashtirib bo‘lmadi."));
      });
  }, [code, activate]);

  if (code.length !== 8) return <Redirect href="/login" />;

  return (
    <View style={[st.wrap, { backgroundColor: c.bg, paddingTop: insets.top + 96, paddingBottom: insets.bottom + 24 }]}>
      <Image source={require("../../assets/icon.png")} style={st.logo} />
      <Text style={[st.title, { color: c.ink }]}>{error ? "Kod ishlamadi" : "Ulanmoqda…"}</Text>
      {error ? (
        <>
          <Text style={[st.lead, { color: c.muted }]}>{error}</Text>
          <View style={{ flex: 1 }} />
          <Button title="Login bilan kirish" big onPress={() => router.replace("/login")} />
        </>
      ) : (
        <ActivityIndicator color={c.muted} />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 20, gap: 18 },
  logo: { width: 64, height: 64, borderRadius: 16, alignSelf: "center" },
  title: { fontSize: 24, fontWeight: "700", textAlign: "center" },
  lead: { fontSize: 15, textAlign: "center", lineHeight: 21 },
});
