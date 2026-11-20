import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Text, TextInput } from "@/components/T";
import { ApiError, errorText, post } from "@/lib/api";
import { LOGIN_SUFFIX, checkLoginInput, liveLoginProblem, panelPasswordProblem, passwordProblem } from "@/lib/login";
import { mcall } from "@/lib/manager";
import { useTheme } from "@/lib/theme";
import type { AccountInfo } from "@/lib/types";
import { Button, Group, GroupTitle, Icon, Row, Sheet, haptic } from "./ui";

/*
 * Profil → «Ilovaga kirish»: login (o‘zgarmaydi, faqat nusxalash) va parolni almashtirish.
 *   xodim    — POST /mini/account { password, currentPassword } (login yo‘q bo‘lsa — bir marta tanlanadi)
 *   direktor — PUT /auth/password { currentPassword, newPassword } panel tokeni bilan (panel: ≥ 10 belgi)
 */

type Props =
  | { mode: "employee"; account: AccountInfo | null; onChanged: () => void; openSignal?: string }
  | { mode: "manager"; login: string | null; onChanged?: () => void; openSignal?: string };

export function AppLoginGroup(props: Props) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  // Havola (profile?section=account) — oyna ochiladi.
  const [seenSignal, setSeenSignal] = useState(props.openSignal);
  if (seenSignal !== props.openSignal) {
    setSeenSignal(props.openSignal);
    if (props.openSignal) setOpen(true);
  }

  const login = props.mode === "employee" ? props.account?.login || null : props.login;
  const hasPassword = props.mode === "manager" || Boolean(props.account?.hasPassword);
  const ready = props.mode === "manager" || Boolean(props.account);
  const action = !login ? "Login va parol o‘rnatish" : hasPassword ? "Parolni o‘zgartirish" : "Parol o‘rnatish";

  const copy = async () => {
    if (!login) return;
    await Clipboard.setStringAsync(login);
    haptic.success();
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <GroupTitle>Ilovaga kirish</GroupTitle>
      <Group>
        {login ? (
          <Row
            icon="at"
            label={login}
            onPress={() => void copy()}
            right={copied ? <Text style={{ color: c.success, fontSize: 14 }}>Nusxalandi</Text> : <Icon name="copy-outline" size={18} color={c.muted} />}
          />
        ) : null}
        <Row icon="key" label={action} onPress={ready ? () => setOpen(true) : undefined} last />
      </Group>
      {open ? (
        <PasswordSheet
          mode={props.mode}
          needLogin={props.mode === "employee" && !login}
          suggested={props.mode === "employee" ? props.account?.suggested || "" : ""}
          needCurrent={hasPassword}
          onClose={() => setOpen(false)}
          onDone={(text) => {
            setOpen(false);
            haptic.success();
            Alert.alert("Tayyor", text);
            props.onChanged?.();
          }}
        />
      ) : null}
    </>
  );
}

function PasswordSheet({
  mode,
  needLogin,
  suggested,
  needCurrent,
  onClose,
  onDone,
}: {
  mode: "employee" | "manager";
  needLogin: boolean;
  suggested: string;
  needCurrent: boolean;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const { c } = useTheme();
  const [login, setLogin] = useState(() => suggested.replace(LOGIN_SUFFIX, ""));
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const problem = next ? (mode === "manager" ? panelPasswordProblem(next) : passwordProblem(next)) : null;
  const mismatch = Boolean(repeat) && repeat !== next;
  const loginProblem = needLogin ? liveLoginProblem(login) : null;
  const filled = (!needLogin || login.trim()) && (!needCurrent || current) && next && repeat;

  const save = async () => {
    if (busy) return;
    const check = needLogin ? checkLoginInput(login) : null;
    if (check && !check.ok) return setError(check.error);
    if (problem) return setError(problem);
    if (next !== repeat) return setError("Yangi parollar bir xil emas.");
    if (needCurrent && current === next) return setError("Yangi parol eskisidan farq qilsin.");
    setBusy(true);
    setError("");
    try {
      if (mode === "manager") {
        await mcall("/auth/password", { currentPassword: current, newPassword: next }, "PUT");
        onDone("Parol o‘zgartirildi.");
      } else {
        const result = await post<{ ok: true; login: string }>("/mini/account", {
          password: next,
          ...(needCurrent ? { currentPassword: current } : {}),
          ...(check?.ok ? { login: check.login } : {}),
        });
        onDone(needLogin ? `Login: ${result.login}. Parol saqlandi.` : "Parol o‘zgartirildi.");
      }
    } catch (e) {
      haptic.error();
      setError(e instanceof ApiError && e.code === "PASSWORD_WRONG" && !e.body?.message ? "Joriy parol noto‘g‘ri." : errorText(e, "Saqlanmadi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible title={needLogin ? "Login va parol" : "Parolni o‘zgartirish"} onClose={onClose}>
      {needLogin ? (
        <View style={st.field}>
          <Text style={[st.label, { color: c.muted }]}>Login</Text>
          <View style={[st.input, { backgroundColor: c.card, borderColor: loginProblem ? c.danger : c.line }]}>
            <TextInput
              value={login}
              onChangeText={(text) => {
                setLogin(text.replace(/\s/g, ""));
                setError("");
              }}
              placeholder="ozodbek"
              placeholderTextColor={c.muted}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="username"
              maxLength={60}
              style={[st.text, { color: c.ink }]}
            />
            {!login.includes("@") ? <Text style={[st.suffix, { color: c.muted }]}>{LOGIN_SUFFIX}</Text> : null}
          </View>
          {loginProblem ? <Text style={[st.hint, { color: c.danger }]}>{loginProblem}</Text> : <Text style={[st.hint, { color: c.muted }]}>Login keyin o‘zgarmaydi</Text>}
        </View>
      ) : null}
      {needCurrent ? <PasswordField label="Joriy parol" value={current} onChange={setCurrent} autoComplete="current-password" onEdit={() => setError("")} /> : null}
      <PasswordField label="Yangi parol" value={next} onChange={setNext} autoComplete="new-password" onEdit={() => setError("")} problem={problem} />
      <PasswordField label="Yangi parolni takrorlang" value={repeat} onChange={setRepeat} autoComplete="new-password" onEdit={() => setError("")} problem={mismatch ? "Parollar bir xil emas." : null} />
      {error ? (
        <Text style={{ color: c.danger, fontSize: 14 }} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button title="Saqlash" busy={busy} disabled={!filled || Boolean(problem) || mismatch} onPress={() => void save()} />
    </Sheet>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  onEdit,
  autoComplete,
  problem,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onEdit: () => void;
  autoComplete: "current-password" | "new-password";
  problem?: string | null;
}) {
  const { c } = useTheme();
  const [shown, setShown] = useState(false);
  return (
    <View style={st.field}>
      <Text style={[st.label, { color: c.muted }]}>{label}</Text>
      <View style={[st.input, { backgroundColor: c.card, borderColor: problem ? c.danger : c.line }]}>
        <TextInput
          value={value}
          onChangeText={(text) => {
            onChange(text);
            onEdit();
          }}
          secureTextEntry={!shown}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          textContentType={autoComplete === "new-password" ? "newPassword" : "password"}
          autoComplete={autoComplete}
          maxLength={72}
          accessibilityLabel={label}
          style={[st.text, { color: c.ink }]}
        />
        <Pressable onPress={() => setShown((v) => !v)} hitSlop={10} style={st.eye} accessibilityRole="button" accessibilityLabel={shown ? "Parolni yashirish" : "Parolni ko‘rsatish"}>
          <Icon name={shown ? "eye-off-outline" : "eye-outline"} size={20} color={c.muted} />
        </Pressable>
      </View>
      {problem ? <Text style={[st.hint, { color: c.danger }]}>{problem}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: "600", marginLeft: 2 },
  input: { flexDirection: "row", alignItems: "center", height: 50, borderRadius: 12, borderWidth: 1, paddingLeft: 14, paddingRight: 6 },
  text: { flex: 1, fontSize: 16, height: "100%", paddingVertical: 0 },
  suffix: { fontSize: 16, marginHorizontal: 8 },
  eye: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  hint: { fontSize: 12.5, lineHeight: 17, marginLeft: 2 },
});
