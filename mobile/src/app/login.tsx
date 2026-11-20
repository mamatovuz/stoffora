import { useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, TextInput } from "@/components/T";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Hint, Icon, haptic } from "@/components/ui";
import { ApiError, errorText } from "@/lib/api";
import { deviceInfo } from "@/lib/device";
import { LOGIN_SUFFIX, checkLoginInput, liveLoginProblem } from "@/lib/login";
import { useSession } from "@/lib/session";
import { ios, useTheme } from "@/lib/theme";

/*
 * Kirish: login (faqat nom — «@staffora.uz» avtomatik) + parol. Hamma uchun bir xil: xodim, HR,
 * moliya va direktor. Server qaysi rejim ekanini aytadi (xodim — keldi-ketdi, direktor — faqat rahbar
 * paneli). Telefon kaliti kirishda imzolanadi: parol boshqa telefonda ishlatilsa, bu yerdan chiqiladi.
 */

/** Sessiya nima uchun yopilgani (kirish ekranida bir marta ko‘rsatiladi). */
const REASONS: Record<string, string> = {
  DEVICE_REVOKED: "Hisobingiz boshqa telefonda ochildi. Qayta kiring.",
  SESSION_REUSED: "Xavfsizlik uchun sessiya yopildi. Qayta kiring.",
  SESSION_EXPIRED: "Sessiya muddati tugadi. Qayta kiring.",
  SESSION_INVALID: "Sessiya yaroqsiz. Qayta kiring.",
  EMPLOYEE_INACTIVE: "Profilingiz faol emas. HR bilan bog‘laning.",
  ACCOUNT_BLOCKED: "Hisobingiz bloklangan. Administratorga murojaat qiling.",
  COMPANY_SUSPENDED: "Kompaniya hisobi to‘xtatilgan.",
  NOT_MANAGER: "Bu hisobda rahbar huquqi yo‘q.",
};
/** Server matn yubormagan holatlar uchun. */
const ERRORS: Record<string, string> = {
  LOGIN_FAILED: "Login yoki parol noto‘g‘ri.",
  LOGIN_LOCKED: "Urinishlar juda ko‘p. Birozdan keyin qayta urinib ko‘ring.",
  LOGIN_INVALID: "Login noto‘g‘ri yozilgan.",
  EMPLOYEE_INACTIVE: "Profilingiz faol emas. HR bilan bog‘laning.",
  COMPANY_SUSPENDED: "Kompaniya hisobi to‘xtatilgan.",
  ACCOUNT_BLOCKED: "Hisob bloklangan. Administrator bilan bog‘laning.",
};
const failText = (e: unknown, fallback: string) => (e instanceof ApiError && e.code && ERRORS[e.code] && !e.body?.message ? ERRORS[e.code] : errorText(e, fallback));

export default function Login() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn, signedOutReason } = useSession();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [focus, setFocus] = useState<"login" | "password" | null>(null);
  const [loginError, setLoginError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Direktorda Telegram 2FA: kod bosqichi (login va parol xotirada qoladi — qayta yuborish uchun).
  const [twoFactor, setTwoFactor] = useState<{ login: string; message: string } | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const live = liveLoginProblem(login);
  const shownLoginError = live || loginError;
  const typedDomain = login.includes("@");

  const submit = async () => {
    if (busy) return;
    const check = checkLoginInput(login);
    if (!check.ok) {
      haptic.warning();
      setLoginError(check.error);
      return;
    }
    if (!password) {
      passwordRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await signIn(check.login, password, deviceInfo());
      if (result.kind === "2fa") {
        haptic.tap();
        setTwoFactor({ login: check.login, message: result.message });
        return;
      }
      haptic.success();
    } catch (e) {
      haptic.error();
      setError(failText(e, "Kirib bo‘lmadi."));
      if (e instanceof ApiError && e.code === "LOGIN_FAILED") {
        setPassword("");
        passwordRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  };

  if (twoFactor)
    return (
      <CodeStep
        login={twoFactor.login}
        message={twoFactor.message}
        onBack={() => setTwoFactor(null)}
        onSubmit={(code) => signIn(twoFactor.login, password, deviceInfo(), code)}
        onResend={async () => {
          const result = await signIn(twoFactor.login, password, deviceInfo());
          if (result.kind === "2fa") setTwoFactor({ login: twoFactor.login, message: result.message });
        }}
      />
    );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={ios ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[st.wrap, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 20 }]} keyboardShouldPersistTaps="handled">
        <Image source={require("../../assets/icon.png")} style={st.logo} />
        <Text style={[st.title, { color: c.ink }]}>Staffora’ga kirish</Text>

        {signedOutReason && REASONS[signedOutReason] ? (
          <Hint tone="warn" icon="shield-half-outline">
            {REASONS[signedOutReason]}
          </Hint>
        ) : null}

        <View style={st.field}>
          <Text style={[st.label, { color: c.muted }]}>Login</Text>
          <View style={[st.input, { backgroundColor: c.card, borderColor: shownLoginError ? c.danger : focus === "login" ? c.accent : c.line }]}>
            <TextInput
              value={login}
              onChangeText={(text) => {
                setLogin(text.replace(/\s/g, ""));
                setLoginError("");
                setError("");
              }}
              onFocus={() => setFocus("login")}
              onBlur={() => setFocus(null)}
              placeholder="ozodbek"
              placeholderTextColor={c.muted}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="username"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
              maxLength={60}
              accessibilityLabel="Login"
              style={[st.text, { color: c.ink }]}
            />
            {/* Qotirilgan qo‘shimcha — o‘zgartirib bo‘lmaydi; odam o‘zi «@» yozsa yashiriladi. */}
            {!typedDomain ? (
              <Text style={[st.suffix, { color: c.muted }]} accessibilityElementsHidden importantForAccessibility="no">
                {LOGIN_SUFFIX}
              </Text>
            ) : null}
          </View>
          {shownLoginError ? <Text style={[st.fieldError, { color: c.danger }]}>{shownLoginError}</Text> : null}
        </View>

        <View style={st.field}>
          <Text style={[st.label, { color: c.muted }]}>Parol</Text>
          <View style={[st.input, { backgroundColor: c.card, borderColor: focus === "password" ? c.accent : c.line }]}>
            <TextInput
              ref={passwordRef}
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setError("");
              }}
              onFocus={() => setFocus("password")}
              onBlur={() => setFocus(null)}
              placeholder="Parol"
              placeholderTextColor={c.muted}
              secureTextEntry={!shown}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textContentType="password"
              autoComplete="current-password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              maxLength={72}
              accessibilityLabel="Parol"
              style={[st.text, { color: c.ink }]}
            />
            <Pressable onPress={() => setShown((v) => !v)} hitSlop={10} style={st.eye} accessibilityRole="button" accessibilityLabel={shown ? "Parolni yashirish" : "Parolni ko‘rsatish"}>
              <Icon name={shown ? "eye-off-outline" : "eye-outline"} size={21} color={c.muted} />
            </Pressable>
          </View>
        </View>

        {error ? (
          <Text style={[st.error, { color: c.danger }]} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button title="Kirish" big busy={busy} disabled={!login.trim() || !password} onPress={() => void submit()} />

        <View style={{ flex: 1 }} />
        <Text style={[st.footer, { color: c.muted }]}>Login va parolni ro‘yxatdan o‘tishda botdan yoki Mini App → Profil → Ilovaga kirish bo‘limidan olasiz</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Telegram’ga kelgan 5 xonali kod (direktorda 2FA yoqilgan bo‘lsa). */
function CodeStep({
  login,
  message,
  onBack,
  onSubmit,
  onResend,
}: {
  login: string;
  message: string;
  onBack: () => void;
  onSubmit: (code: string) => Promise<{ kind: "session" } | { kind: "2fa"; message: string }>;
  onResend: () => Promise<void>;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const verify = async (value = code) => {
    if (value.length !== 5 || busy) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const result = await onSubmit(value);
      if (result.kind === "2fa") {
        setCode("");
        setError(result.message);
        return;
      }
      haptic.success();
    } catch (e) {
      haptic.error();
      setCode("");
      setError(failText(e, "Kod tasdiqlanmadi."));
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onResend();
      setCode("");
      setNote("Yangi kod yuborildi.");
    } catch (e) {
      setError(failText(e, "Kod yuborilmadi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={ios ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[st.wrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]} keyboardShouldPersistTaps="handled">
        <Pressable onPress={onBack} hitSlop={12} style={st.back} accessibilityRole="button">
          <Icon name="chevron-back" size={22} color={c.accent} />
          <Text style={{ color: c.accent, fontSize: 17 }}>Orqaga</Text>
        </Pressable>
        <View style={[st.codeIcon, { backgroundColor: `${c.accent}14` }]}>
          <Icon name="shield-checkmark" size={26} color={c.accent} />
        </View>
        <View style={{ gap: 6 }}>
          <Text style={[st.title, { color: c.ink }]}>Tasdiqlash kodi</Text>
          <Text style={[st.lead, { color: c.muted }]}>{message}</Text>
          <Text style={[st.lead, { color: c.muted }]}>{login}</Text>
        </View>
        <TextInput
          value={code}
          onChangeText={(text) => {
            const next = text.replace(/\D/g, "").slice(0, 5);
            setCode(next);
            setError("");
            if (next.length === 5) void verify(next);
          }}
          autoFocus
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={5}
          placeholder="•••••"
          placeholderTextColor={c.muted}
          accessibilityLabel="Tasdiqlash kodi"
          style={[st.code, { color: c.ink, backgroundColor: c.card, borderColor: error ? c.danger : c.line }]}
        />
        {error ? (
          <Text style={[st.error, { color: c.danger }]} accessibilityRole="alert">
            {error}
          </Text>
        ) : note ? (
          <Text style={[st.error, { color: c.success }]}>{note}</Text>
        ) : null}
        <Button title="Tasdiqlash" big busy={busy} disabled={code.length !== 5} onPress={() => void verify()} />
        <Pressable onPress={() => void resend()} disabled={busy} hitSlop={8} style={{ alignSelf: "center", padding: 8 }}>
          <Text style={{ color: c.accent, fontSize: 15 }}>Kodni qayta yuborish</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 20, gap: 18, flexGrow: 1 },
  logo: { width: 64, height: 64, borderRadius: 16, alignSelf: "center" },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center", letterSpacing: -0.3 },
  lead: { fontSize: 15, textAlign: "center", lineHeight: 21 },
  field: { gap: 7 },
  label: { fontSize: 13, fontWeight: "600", marginLeft: 4 },
  input: { flexDirection: "row", alignItems: "center", height: 54, borderRadius: 14, borderWidth: 1, paddingLeft: 16, paddingRight: 8 },
  text: { flex: 1, fontSize: 17, height: "100%", paddingVertical: 0 },
  suffix: { fontSize: 17, marginLeft: 4, marginRight: 8 },
  eye: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  fieldError: { fontSize: 13, lineHeight: 18, marginLeft: 4 },
  error: { fontSize: 14, textAlign: "center", lineHeight: 19 },
  footer: { fontSize: 12.5, textAlign: "center", lineHeight: 18, paddingHorizontal: 12 },
  back: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", height: 44 },
  codeIcon: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 24 },
  code: { height: 62, borderRadius: 14, borderWidth: 1, textAlign: "center", fontSize: 28, fontWeight: "600", letterSpacing: 10, paddingHorizontal: 0 },
});
