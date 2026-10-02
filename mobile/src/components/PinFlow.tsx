import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorText } from "@/lib/api";
import { MAX_PIN_ATTEMPTS, checkPin, pinBlocked, removePin, requestPinReset, setPin, verifyPinReset } from "@/lib/pin";
import { ios, useTheme } from "@/lib/theme";
import { PinPad } from "./PinPad";
import { Button, Icon, haptic } from "./ui";

export type PinMode = "unlock" | "set" | "change" | "disable";
type Step = "current" | "new" | "confirm" | "reset";

/**
 * PIN oqimi: ochish, yangi o‘rnatish (2 marta), o‘zgartirish, o‘chirish va
 * «Unutdingizmi?» — Telegram/Mini App’ga keladigan 5 xonali kod orqali yangi PIN.
 */
export function PinFlow({
  mode,
  onDone,
  onCancel,
  biometric,
}: {
  mode: PinMode;
  onDone: () => void;
  onCancel?: () => void;
  /** Ochishda telefon biometriyasi tugmasi (Face ID / barmoq izi). */
  biometric?: { label: string; run: () => void };
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>(mode === "set" ? "new" : "current");
  const [value, setValue] = useState("");
  const [first, setFirst] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [afterReset, setAfterReset] = useState(false);

  useEffect(() => {
    if (mode !== "set") void pinBlocked().then(setBlocked);
  }, [mode]);

  const fail = (text: string) => {
    setError(text);
    setShake((n) => n + 1);
    setValue("");
  };

  const onChange = async (next: string) => {
    setError("");
    setValue(next);
    if (next.length < 4) return;
    if (step === "current") {
      setBusy(true);
      const r = await checkPin(next);
      setBusy(false);
      if (!r.ok) {
        if (r.left === 0) {
          setBlocked(true);
          return fail("PIN bloklandi — «Unutdingizmi?» orqali tiklang");
        }
        return fail(`Noto‘g‘ri PIN · ${r.left} ta urinish qoldi`);
      }
      haptic.success();
      setValue("");
      if (mode === "unlock") return onDone();
      if (mode === "disable") {
        await removePin();
        return onDone();
      }
      return setStep("new");
    }
    if (step === "new") {
      if (/^(\d)\1{3}$/.test(next) || ["1234", "4321", "0123"].includes(next)) return fail("Juda oddiy PIN — boshqasini tanlang");
      setFirst(next);
      setValue("");
      return setStep("confirm");
    }
    if (step === "confirm") {
      if (next !== first) {
        setStep("new");
        setFirst("");
        return fail("PIN mos kelmadi — qaytadan kiriting");
      }
      await setPin(next);
      haptic.success();
      return onDone();
    }
  };

  if (step === "reset")
    return (
      <ResetStep
        onBack={() => setStep("current")}
        onVerified={() => {
          setBlocked(false);
          setAfterReset(true);
          setValue("");
          setStep("new");
        }}
      />
    );

  const title =
    step === "current"
      ? mode === "unlock"
        ? "PIN-kodni kiriting"
        : "Joriy PIN-kod"
      : step === "new"
        ? afterReset || mode === "set"
          ? "Yangi PIN-kod o‘ylang"
          : "Yangi PIN-kod"
        : "PIN-kodni takrorlang";
  const subtitle = step === "current" ? (blocked ? `${MAX_PIN_ATTEMPTS} marta noto‘g‘ri kiritildi` : undefined) : step === "new" ? "4 ta raqam" : undefined;

  return (
    <View style={[st.root, { backgroundColor: c.bg, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
      <View style={st.top}>
        {onCancel ? (
          <Pressable onPress={onCancel} hitSlop={12}>
            <Text style={{ color: c.accent, fontSize: 17 }}>Bekor qilish</Text>
          </Pressable>
        ) : (
          <View />
        )}
      </View>
      <View style={{ alignItems: "center", gap: 18, marginTop: 24 }}>
        <View style={[st.lock, { backgroundColor: `${c.accent}14` }]}>
          <Icon name="lock-closed" size={24} color={c.accent} />
        </View>
        <PinPad
          value={value}
          onChange={(v) => void onChange(v)}
          title={title}
          subtitle={subtitle}
          error={error}
          shake={shake}
          disabled={busy || (step === "current" && blocked)}
          left={
            biometric && step === "current" && !blocked ? (
              <Pressable onPress={biometric.run} hitSlop={10} accessibilityLabel={biometric.label} style={st.bio}>
                <Icon name={ios ? "scan-outline" : "finger-print"} size={30} color={c.accent} />
              </Pressable>
            ) : null
          }
        />
      </View>
      <View style={{ flex: 1 }} />
      {step === "current" ? (
        <Pressable
          onPress={() => {
            setError("");
            setStep("reset");
          }}
          hitSlop={10}
          style={{ alignSelf: "center", padding: 8 }}
        >
          <Text style={{ color: c.accent, fontSize: 15, fontWeight: "500" }}>PIN-kodni unutdingizmi?</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Tiklash: kod so‘rash → 5 xonali kodni kiritish. */
function ResetStep({ onBack, onVerified }: { onBack: () => void; onVerified: () => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [sent, setSent] = useState<null | { telegram: boolean }>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<TextInput>(null);

  const request = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await requestPinReset();
      setSent({ telegram: r.sentToTelegram });
      setTimeout(() => input.current?.focus(), 300);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const verify = async (value: string) => {
    setBusy(true);
    setError("");
    try {
      await verifyPinReset(value);
      haptic.success();
      onVerified();
    } catch (e) {
      haptic.error();
      setCode("");
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={ios ? "padding" : undefined} style={[st.root, { backgroundColor: c.bg, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
      <View style={st.top}>
        <Pressable onPress={onBack} hitSlop={12} style={{ flexDirection: "row", alignItems: "center" }}>
          <Icon name="chevron-back" size={22} color={c.accent} />
          <Text style={{ color: c.accent, fontSize: 17 }}>Orqaga</Text>
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: 24, marginTop: 40, gap: 12, alignItems: "center" }}>
        <View style={[st.lock, { backgroundColor: `${c.accent}14` }]}>
          <Icon name="key-outline" size={24} color={c.accent} />
        </View>
        <Text style={{ color: c.ink, fontSize: 22, fontWeight: "700", textAlign: "center" }}>PIN-kodni tiklash</Text>
        <Text style={{ color: c.muted, fontSize: 15, lineHeight: 21, textAlign: "center" }}>
          {sent
            ? sent.telegram
              ? "5 xonali kod Telegram’dagi Staffora botiga va Mini App bildirishnomalariga yuborildi."
              : "5 xonali kod Mini App → Bildirishnomalar bo‘limiga yuborildi."
            : "Telegram’dagi Staffora botiga va Mini App bildirishnomalariga 5 xonali kod yuboramiz."}
        </Text>
        {sent ? (
          <TextInput
            ref={input}
            value={code}
            onChangeText={(t) => {
              const next = t.replace(/\D/g, "").slice(0, 5);
              setCode(next);
              setError("");
              if (next.length === 5) void verify(next);
            }}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={5}
            placeholder="•••••"
            placeholderTextColor={c.muted}
            style={[st.code, { color: c.ink, backgroundColor: c.card, borderColor: error ? c.danger : "transparent" }]}
          />
        ) : null}
        {error ? <Text style={{ color: c.danger, textAlign: "center" }}>{error}</Text> : null}
        {busy ? <ActivityIndicator color={c.muted} /> : null}
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ paddingHorizontal: 20 }}>
        {sent ? (
          <Pressable onPress={() => void request()} disabled={busy} style={{ alignSelf: "center", padding: 8 }}>
            <Text style={{ color: c.accent, fontSize: 15 }}>Kodni qayta yuborish</Text>
          </Pressable>
        ) : (
          <Button title="Kod yuborish" big busy={busy} onPress={() => void request()} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  top: { height: 44, paddingHorizontal: 16, justifyContent: "center" },
  lock: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  bio: { width: 78, height: 78, alignItems: "center", justifyContent: "center" },
  code: { width: 220, height: 60, borderRadius: 14, borderWidth: 1.5, marginTop: 10, textAlign: "center", fontSize: 28, fontWeight: "600", letterSpacing: 10, paddingHorizontal: 0 },
});
