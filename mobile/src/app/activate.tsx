import * as Application from "expo-application";
import * as Device from "expo-device";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Hint, haptic } from "@/components/ui";
import { ApiError, errorText } from "@/lib/api";
import { APP_VERSION } from "@/lib/config";
import { useSession } from "@/lib/session";
import { ios, useTheme } from "@/lib/theme";

/*
 * Faollashtirish: xodim Mini App (Profil → Telefon ilovasi) yoki HR’dan bir martalik kod oladi.
 * Kod + shu telefonda yaratilgan kalit imzosi bilan server telefonni xodimga bog‘laydi.
 * Telefon raqamini yozish yetarli emas — kod faqat Telegram orqali tasdiqlangan xodimga beriladi.
 */
const clean = (value: string) => value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 8);
const pretty = (value: string) => (value.length > 4 ? `${value.slice(0, 4)}-${value.slice(4)}` : value);

const REASONS: Record<string, string> = {
  DEVICE_REVOKED: "Bu telefon HR tomonidan o‘chirildi yoki boshqa telefon tasdiqlandi. Yangi kod bilan qayta ulang.",
  SESSION_REUSED: "Xavfsizlik uchun sessiya yopildi. Qayta ulang.",
  SESSION_EXPIRED: "Sessiya muddati tugadi. Qayta ulang.",
};

export default function Activate() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ code?: string }>();
  const { activate, signedOutReason } = useSession();
  const [code, setCode] = useState(() => clean(params.code || ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tried = useRef(false);

  const submit = async (value = code) => {
    if (value.length !== 8 || busy) return;
    setBusy(true);
    setError("");
    try {
      await activate(value, {
        platform: Platform.OS === "ios" ? "ios" : "android",
        model: Device.modelName || undefined,
        osVersion: Device.osVersion || undefined,
        appVersion: Application.nativeApplicationVersion || APP_VERSION,
      });
      haptic.success();
    } catch (reason) {
      haptic.error();
      setError(errorText(reason, "Faollashtirib bo‘lmadi."));
      if (reason instanceof ApiError && ["CODE_USED", "CODE_EXPIRED", "CODE_REVOKED", "CODE_LOCKED"].includes(reason.code || "")) setCode("");
    } finally {
      setBusy(false);
    }
  };
  // Havola orqali kelgan kod (staffora://activate?code=…) — avtomatik yuboriladi.
  useEffect(() => {
    if (params.code && !tried.current && clean(params.code).length === 8) {
      tried.current = true;
      void submit(clean(params.code));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={ios ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[st.wrap, { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <Image source={require("../../assets/icon.png")} style={st.logo} />
        <View style={{ gap: 6 }}>
          <Text style={[st.title, { color: c.ink }]}>Staffora’ga kirish</Text>
          <Text style={[st.lead, { color: c.muted }]}>Mini App → Profil → «Telefon ilovasi» bo‘limidan olingan kodni kiriting.</Text>
        </View>

        {signedOutReason && REASONS[signedOutReason] ? <Hint tone="warn" icon="shield-half">{REASONS[signedOutReason]}</Hint> : null}

        <View style={{ gap: 10 }}>
          <TextInput
            value={pretty(code)}
            onChangeText={(text) => {
              setError("");
              const next = clean(text);
              setCode(next);
              if (next.length === 8) void submit(next);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            placeholder="XXXX-XXXX"
            placeholderTextColor={c.muted}
            maxLength={9}
            style={[st.input, { color: c.ink, borderColor: error ? c.danger : "transparent", backgroundColor: c.card }]}
            accessibilityLabel="Ulash kodi"
          />
          {error ? <Text style={{ color: c.danger, fontSize: 13.5, textAlign: "center" }}>{error}</Text> : null}
        </View>
        <Button title="Davom etish" onPress={() => void submit()} busy={busy} disabled={code.length !== 8} big />

        <View style={{ flex: 1 }} />
        <Text style={{ color: c.muted, fontSize: 12.5, textAlign: "center", lineHeight: 18 }}>
          Kod 15 daqiqa amal qiladi va bir marta ishlaydi.{"\n"}Telefon faqat sizga bog‘lanadi.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 20, gap: 20, flexGrow: 1 },
  logo: { width: 64, height: 64, borderRadius: 16, alignSelf: "center" },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center", letterSpacing: -0.3 },
  lead: { fontSize: 15, textAlign: "center", lineHeight: 21 },
  input: { height: 64, borderWidth: 1.5, borderRadius: 14, textAlign: "center", fontSize: 28, fontWeight: "700", letterSpacing: 4, fontFamily: ios ? "Menlo" : "monospace" },
});
