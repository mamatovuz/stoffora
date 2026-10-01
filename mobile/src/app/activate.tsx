import * as Application from "expo-application";
import * as Device from "expo-device";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Hint, Icon, haptic } from "@/components/ui";
import { ApiError, errorText } from "@/lib/api";
import { APP_VERSION } from "@/lib/config";
import { useSession } from "@/lib/session";
import { ios, radius, useTheme } from "@/lib/theme";

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
      <ScrollView contentContainerStyle={[st.wrap, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={[st.logo, { backgroundColor: c.accent }]}>
          <Icon name="finger-print" size={40} color="#fff" />
        </View>
        <Text style={[st.title, { color: c.ink }]}>Staffora</Text>
        <Text style={[st.lead, { color: c.muted }]}>Ishga kelish-ketish, oylik va so‘rovlar — endi telefon ilovasida.</Text>

        {signedOutReason && REASONS[signedOutReason] ? <Hint tone="warn" icon="shield-half">{REASONS[signedOutReason]}</Hint> : null}

        <View style={[st.card, { backgroundColor: c.card, borderRadius: radius.card }]}>
          <Text style={{ color: c.ink, fontSize: 17, fontWeight: "600" }}>Ulash kodi</Text>
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
            style={[st.input, { color: c.ink, borderColor: error ? c.danger : c.line, backgroundColor: c.bg }]}
            accessibilityLabel="Ulash kodi"
          />
          {error ? <Text style={{ color: c.danger, fontSize: 13.5 }}>{error}</Text> : null}
          <Button title="Ulash" icon="link" onPress={() => void submit()} busy={busy} disabled={code.length !== 8} big />
        </View>

        <View style={{ gap: 12 }}>
          <Step n={1} text="Telegram’da Staffora Mini App’ni oching." />
          <Step n={2} text="Profil → «Telefon ilovasi» → «Ulash kodini olish»." />
          <Step n={3} text="Kodni shu yerga kiriting. Kod 15 daqiqa amal qiladi va faqat bir marta ishlaydi." />
        </View>
        <Text style={{ color: c.muted, fontSize: 12.5, textAlign: "center", lineHeight: 18 }}>
          Telefon faqat sizga bog‘lanadi. Bir xodimda bitta ishonchli telefon bo‘ladi — yangi telefonga o‘tsangiz, HR tasdiqlaydi.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: `${c.accent}1A`, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: c.accent, fontWeight: "700" }}>{n}</Text>
      </View>
      <Text style={{ flex: 1, color: c.ink, fontSize: 14.5, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 20, gap: 20, flexGrow: 1 },
  logo: { width: 84, height: 84, borderRadius: 24, alignSelf: "center", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 32, fontWeight: "800", textAlign: "center", marginTop: -4 },
  lead: { fontSize: 15.5, textAlign: "center", lineHeight: 22, marginTop: -10 },
  card: { padding: 18, gap: 14 },
  input: { height: 64, borderWidth: 1.5, borderRadius: 14, textAlign: "center", fontSize: 28, fontWeight: "700", letterSpacing: 4, fontFamily: ios ? "Menlo" : "monospace" },
});
