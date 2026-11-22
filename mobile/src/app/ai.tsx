import { router } from "expo-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text as RawText, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, TextInput } from "@/components/T";
import { Icon, haptic, type IconName } from "@/components/ui";
import { errorText } from "@/lib/api";
import { can, managerAuth, mcall, type Role } from "@/lib/manager";
import { ios, radius, typo, useTheme, type Colors } from "@/lib/theme";

/*
 * Staffora AI — rahbar paneli ichida (saytdagi bilan bir xil dvigatel: /api/ai/*).
 * Savol → bazadan javob (karta, jadval). Buyruq («1001 ga bugun 12:00 da chiqish qo‘y», «Chilonzor
 * filialiga xabar yubor», «ishdan bo‘shat») → server amalni tayyorlaydi, shu yerda tasdiqlanadi,
 * keyingina bazaga yoziladi. Huquq, kompaniya va filial chegarasi — serverda.
 */

type Tone = "green" | "amber" | "red" | "blue" | "gray";
type AiCard =
  | { kind: "stats"; title: string; subtitle?: string; items: { label: string; value: string; tone?: Tone }[] }
  | { kind: "table"; title: string; subtitle?: string; columns: string[]; rows: string[][]; more?: number }
  | { kind: "profile"; title: string; subtitle?: string; initials: string; status?: { text: string; tone: Tone }; fields: { label: string; value: string }[]; link?: string };
type Suggestion = { label: string; prompt: string; key?: string };
type Msg = { id: string; role: "USER" | "ASSISTANT"; text: string; card?: AiCard; suggestions?: Suggestion[]; failed?: boolean };
type PendingAction = { id: string; name: string; level: "WRITE" | "SENSITIVE"; summary: string; confirmationToken: string };
type ChatResult = { conversationId: string; message: Msg; pendingAction?: PendingAction | null };
type Status = { enabled: boolean; ready: boolean; canManage: boolean };

let seq = 0;
const localId = () => `local-${Date.now()}-${(seq += 1)}`;

/** Rolga qarab boshlang‘ich misollar (server baribir tekshiradi). */
function starters(role: Role): { icon: IconName; label: string; prompt: string }[] {
  const list: { icon: IconName; label: string; prompt: string; ok: boolean }[] = [
    { icon: "pulse-outline", label: "Bugungi davomat", prompt: "Bugungi davomat", ok: can(role, "attendance.view") },
    { icon: "time-outline", label: "Kim kechikdi?", prompt: "Bugun kechikkanlar", ok: can(role, "attendance.view") },
    { icon: "person-remove-outline", label: "Kim kelmadi?", prompt: "Bugun kelmaganlar", ok: can(role, "attendance.view") },
    { icon: "log-out-outline", label: "Chiqish vaqtini qo‘yish", prompt: "ID 1001 ga bugun 18:00 da chiqish qilib qo‘y", ok: can(role, "attendance.edit") },
    { icon: "megaphone-outline", label: "Filialga xabar", prompt: "Ertaga 9:00 da yig‘ilish bor deb filialga xabar yubor", ok: can(role, "announcements.create") || role === "BRANCH_MANAGER" },
    { icon: "airplane-outline", label: "Ta’til so‘rovlari", prompt: "Kutilayotgan ta’til so‘rovlari", ok: can(role, "leave.approve") },
  ];
  return list.filter((x) => x.ok).slice(0, 5);
}

export default function AiScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [role, setRole] = useState<Role>("");
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [pending, setPending] = useState<PendingAction>();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<ScrollView>(null);

  const loadStatus = useCallback(
    () =>
      Promise.all([managerAuth(), mcall<Status>("/ai/status")]).then(
        ([auth, st]) => {
          setRole(auth.user.role);
          setStatus(st);
          setStatusError("");
        },
        (e) => setStatusError(errorText(e, "Staffora AI holatini olib bo‘lmadi")),
      ),
    [],
  );
  useEffect(() => {
    Promise.all([managerAuth(), mcall<Status>("/ai/status")]).then(
      ([auth, st]) => {
        setRole(auth.user.role);
        setStatus(st);
      },
      (e) => setStatusError(errorText(e, "Staffora AI holatini olib bo‘lmadi")),
    );
  }, []);

  const scrollDown = () => requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
  const push = (m: Msg) => {
    setMessages((old) => [...old, m]);
    scrollDown();
  };

  async function send(raw = text) {
    const clean = raw.trim();
    if (!clean || busy) return;
    haptic.tap();
    setText("");
    setBusy(true);
    push({ id: localId(), role: "USER", text: clean });
    try {
      const r = await mcall<ChatResult>("/ai/chat", { conversationId, message: clean }, "POST", true, 60_000);
      setConversationId(r.conversationId);
      push(r.message);
      setPending(r.pendingAction || undefined);
      if (r.pendingAction) haptic.warning();
    } catch (e) {
      push({ id: localId(), role: "ASSISTANT", text: errorText(e, "Javob olinmadi. Qayta urinib ko‘ring."), failed: true });
      haptic.error();
    } finally {
      setBusy(false);
      scrollDown();
    }
  }

  async function decide(confirm: boolean) {
    if (!pending || busy) return;
    const run = async () => {
      setBusy(true);
      try {
        if (confirm) {
          const done = await mcall<{ result?: { message?: string } }>(`/ai/actions/${pending.id}/confirm`, { confirmationToken: pending.confirmationToken });
          push({ id: localId(), role: "ASSISTANT", text: `✅ ${done.result?.message || "Bajarildi va bazada tekshirildi."}` });
          haptic.success();
        } else {
          await mcall(`/ai/actions/${pending.id}/cancel`, {});
          push({ id: localId(), role: "ASSISTANT", text: "Bekor qilindi — bazaga hech narsa yozilmadi." });
        }
        setPending(undefined);
      } catch (e) {
        push({ id: localId(), role: "ASSISTANT", text: errorText(e, "Amal bajarilmadi."), failed: true });
        haptic.error();
        // Muddati o‘tgan / bajarib bo‘lmaydigan amal kartasi qolmasin.
        setPending(undefined);
      } finally {
        setBusy(false);
      }
    };
    // Ishdan bo‘shatish, oylik kabi jiddiy amallar — yana bir bor so‘raladi.
    if (confirm && pending.level === "SENSITIVE")
      Alert.alert("Ishonchingiz komilmi?", pending.summary, [
        { text: "Yo‘q", style: "cancel" },
        { text: "Ha, bajarish", style: "destructive", onPress: () => void run() },
      ]);
    else await run();
  }

  function newChat() {
    haptic.select();
    if (pending) void mcall(`/ai/actions/${pending.id}/cancel`, {}).catch(() => undefined);
    setMessages([]);
    setConversationId(undefined);
    setPending(undefined);
    setText("");
  }

  const ready = Boolean(status?.ready);
  const last = messages[messages.length - 1];
  const chips = !busy && !pending && last?.role === "ASSISTANT" ? last.suggestions || [] : [];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {/* Sarlavha — ixcham: orqaga · nom · yangi suhbat */}
      <View style={[st.header, { paddingTop: insets.top + 6, borderBottomColor: c.line }]}>
        <Pressable hitSlop={12} onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/manager"))} style={st.headBtn}>
          <Icon name="chevron-back" size={26} color={c.accent} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="sparkles" size={16} color={c.violet} />
            <Text style={[typo.bodyStrong, { color: c.ink }]}>Staffora AI</Text>
          </View>
          <Text style={[typo.caption, { color: busy ? c.violet : c.muted }]}>{busy ? "o‘ylayapti…" : ready ? "tayyor" : "ulanmoqda"}</Text>
        </View>
        <Pressable hitSlop={12} onPress={newChat} disabled={!messages.length} style={[st.headBtn, { opacity: messages.length ? 1 : 0.3 }]}>
          <Icon name="create-outline" size={23} color={c.accent} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={ios ? "padding" : undefined}>
        <ScrollView
          ref={scroller}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        >
          {!status && !statusError ? (
            <View style={st.center}>
              <ActivityIndicator color={c.muted} />
            </View>
          ) : statusError ? (
            <Notice c={c} icon="cloud-offline-outline" title="Aloqa yo‘q" text={statusError} action="Qayta urinish" onAction={loadStatus} />
          ) : !ready ? (
            <Notice
              c={c}
              icon="sparkles-outline"
              title="Staffora AI yoqilmagan"
              text={status?.canManage ? "Panelda Sozlamalar → Staffora AI bo‘limida API tokenini kiriting va yoqing." : "Administrator Staffora AI ni yoqqanidan keyin shu yerda ishlaydi."}
              action="Tekshirish"
              onAction={loadStatus}
            />
          ) : !messages.length ? (
            <Welcome c={c} items={starters(role)} onPick={(p) => void send(p)} />
          ) : (
            messages.map((m) => <Bubble key={m.id} m={m} c={c} />)
          )}
          {busy ? (
            <View style={[st.bubble, st.left, { backgroundColor: c.card, flexDirection: "row", gap: 8, alignItems: "center" }]}>
              <ActivityIndicator size="small" color={c.violet} />
              <Text style={[typo.sub, { color: c.muted }]}>Bazadan tekshiryapman…</Text>
            </View>
          ) : null}
          {pending ? <ConfirmCard c={c} action={pending} busy={busy} onDecide={(ok) => void decide(ok)} /> : null}
        </ScrollView>

        {chips.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }} style={{ flexGrow: 0 }}>
            {chips.slice(0, 6).map((sug) => (
              <Pressable key={sug.key || sug.prompt} onPress={() => void send(sug.prompt)} style={({ pressed }) => [st.chip, { backgroundColor: c.card, borderColor: c.line, opacity: pressed ? 0.6 : 1 }]}>
                <Text style={[typo.sub, { color: c.ink }]} numberOfLines={1}>
                  {sug.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {/* Yozish maydoni */}
        <View style={[st.composer, { paddingBottom: Math.max(insets.bottom, 10), borderTopColor: c.line, backgroundColor: c.bg }]}>
          <View style={[st.inputWrap, { backgroundColor: c.card, borderColor: c.line }]}>
            <TextInput
              value={text}
              onChangeText={setText}
              editable={ready}
              placeholder={ready ? "Savol yoki buyruq yozing…" : "AI ulanmagan"}
              placeholderTextColor={c.muted}
              multiline
              maxLength={2000}
              style={[typo.body, st.input, { color: c.ink }]}
              onSubmitEditing={() => void send()}
              blurOnSubmit={false}
            />
            <Pressable
              onPress={() => void send()}
              disabled={!ready || busy || !text.trim()}
              style={[st.send, { backgroundColor: text.trim() && ready && !busy ? c.accent : c.tint }]}
              hitSlop={6}
            >
              <Icon name="arrow-up" size={20} color={text.trim() && ready && !busy ? c.accentInk : c.muted} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ------------------------------------------------------------------ bo‘laklar --- */

function Welcome({ c, items, onPick }: { c: Colors; items: { icon: IconName; label: string; prompt: string }[]; onPick: (prompt: string) => void }) {
  return (
    <View style={{ flex: 1, justifyContent: "center", gap: 18, paddingVertical: 24 }}>
      <View style={{ alignItems: "center", gap: 8 }}>
        <View style={[st.orb, { backgroundColor: `${c.violet}1F` }]}>
          <Icon name="sparkles" size={28} color={c.violet} />
        </View>
        <Text style={[typo.title, { color: c.ink }]}>Nima qilay?</Text>
        <Text style={[typo.sub, { color: c.muted, textAlign: "center", maxWidth: 290 }]}>
          So‘rang yoki buyuring — davomat, xodimlar, xabarlar. O‘zgarishlar faqat siz tasdiqlaganingizdan keyin yoziladi.
        </Text>
      </View>
      <View style={{ gap: 8 }}>
        {items.map((it) => (
          <Pressable key={it.label} onPress={() => onPick(it.prompt)} style={({ pressed }) => [st.starter, { backgroundColor: c.card, opacity: pressed ? 0.6 : 1 }]}>
            <Icon name={it.icon} size={19} color={c.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[typo.bodyStrong, { color: c.ink }]}>{it.label}</Text>
              <RawText style={[typo.sub, { color: c.muted }]} numberOfLines={1}>
                {it.prompt}
              </RawText>
            </View>
            <Icon name="arrow-forward" size={16} color={c.muted} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Notice({ c, icon, title, text, action, onAction }: { c: Colors; icon: IconName; title: string; text: string; action: string; onAction: () => void }) {
  return (
    <View style={[st.center, { gap: 10, paddingHorizontal: 24 }]}>
      <Icon name={icon} size={34} color={c.muted} />
      <Text style={[typo.title, { color: c.ink, textAlign: "center" }]}>{title}</Text>
      <Text style={[typo.sub, { color: c.muted, textAlign: "center" }]}>{text}</Text>
      <Pressable onPress={onAction} style={[st.chip, { backgroundColor: `${c.accent}1A`, borderColor: "transparent" }]}>
        <Text style={[typo.bodyStrong, { color: c.accent }]}>{action}</Text>
      </Pressable>
    </View>
  );
}

const Bubble = memo(function Bubble({ m, c }: { m: Msg; c: Colors }) {
  const mine = m.role === "USER";
  return (
    <View style={{ gap: 8, alignItems: mine ? "flex-end" : "flex-start" }}>
      <View style={[st.bubble, mine ? st.right : st.left, { backgroundColor: mine ? c.accent : m.failed ? `${c.danger}14` : c.card }]}>
        <Rich text={m.text} color={mine ? c.accentInk : m.failed ? c.danger : c.ink} />
      </View>
      {m.card ? <CardView card={m.card} c={c} /> : null}
    </View>
  );
});

/** Juda sodda Markdown: **qalin**, «- » ro‘yxat, qatorlar. AI matni tarjima qilinmaydi (RawText). */
function Rich({ text, color }: { text: string; color: string }) {
  const lines = text.split("\n");
  return (
    <View style={{ gap: 3 }}>
      {lines.map((line, i) => {
        const bullet = /^\s*[-•*]\s+/.test(line);
        const body = line.replace(/^\s*[-•*]\s+/, "");
        if (!body.trim()) return <View key={i} style={{ height: 4 }} />;
        return (
          <View key={i} style={{ flexDirection: "row", gap: 6 }}>
            {bullet ? <RawText style={[typo.body, { color, opacity: 0.6 }]}>•</RawText> : null}
            <RawText style={[typo.body, { color, flex: 1, lineHeight: 21 }]} selectable>
              {body.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
                part.startsWith("**") && part.endsWith("**") ? (
                  <RawText key={j} style={{ fontWeight: "700" }}>
                    {part.slice(2, -2)}
                  </RawText>
                ) : (
                  part
                ),
              )}
            </RawText>
          </View>
        );
      })}
    </View>
  );
}

const toneColor = (c: Colors, tone?: Tone) => (tone === "green" ? c.success : tone === "amber" ? c.warn : tone === "red" ? c.danger : tone === "blue" ? c.accent : c.ink);

function CardView({ card, c }: { card: AiCard; c: Colors }) {
  return (
    <View style={[st.card, { backgroundColor: c.card }]}>
      {card.kind !== "profile" ? (
        <View style={{ gap: 2 }}>
          <RawText style={[typo.bodyStrong, { color: c.ink }]}>{card.title}</RawText>
          {card.subtitle ? <RawText style={[typo.caption, { color: c.muted }]}>{card.subtitle}</RawText> : null}
        </View>
      ) : null}
      {card.kind === "stats" ? (
        <View style={st.grid}>
          {card.items.map((it) => (
            <View key={it.label} style={[st.stat, { backgroundColor: c.tint }]}>
              <RawText style={[typo.time, { color: toneColor(c, it.tone) }]}>{it.value}</RawText>
              <RawText style={[typo.caption, { color: c.muted }]} numberOfLines={1}>
                {it.label}
              </RawText>
            </View>
          ))}
        </View>
      ) : card.kind === "table" ? (
        <View>
          {card.rows.slice(0, 12).map((row, i) => (
            <View key={i} style={[st.tr, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
              <RawText style={[typo.bodyStrong, { color: c.ink, flex: 1 }]} numberOfLines={1}>
                {row[0]}
              </RawText>
              <RawText style={[typo.sub, { color: c.muted, maxWidth: "58%", textAlign: "right" }]} numberOfLines={1}>
                {row.slice(1).filter((x) => x && x !== "—").join(" · ")}
              </RawText>
            </View>
          ))}
          {card.rows.length > 12 || card.more ? (
            <RawText style={[typo.caption, { color: c.muted, paddingTop: 6 }]}>+{Math.max(card.rows.length - 12, 0) + (card.more || 0)} ta yana</RawText>
          ) : null}
        </View>
      ) : (
        <Pressable
          disabled={!card.link?.startsWith("/employees/")}
          onPress={() => card.link && router.push({ pathname: "/employee/[id]", params: { id: card.link.split("/").pop()! } })}
          style={{ gap: 10 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={[st.avatar, { backgroundColor: `${c.accent}1A` }]}>
              <RawText style={[typo.bodyStrong, { color: c.accent }]}>{card.initials}</RawText>
            </View>
            <View style={{ flex: 1 }}>
              <RawText style={[typo.bodyStrong, { color: c.ink }]}>{card.title}</RawText>
              {card.subtitle ? <RawText style={[typo.sub, { color: c.muted }]}>{card.subtitle}</RawText> : null}
            </View>
            {card.status ? (
              <View style={[st.pill, { backgroundColor: `${toneColor(c, card.status.tone)}1F` }]}>
                <RawText style={[typo.caption, { color: toneColor(c, card.status.tone) }]}>{card.status.text}</RawText>
              </View>
            ) : null}
          </View>
          {card.fields.slice(0, 8).map((f) => (
            <View key={f.label} style={st.tr}>
              <RawText style={[typo.sub, { color: c.muted }]}>{f.label}</RawText>
              <RawText style={[typo.sub, { color: c.ink, flex: 1, textAlign: "right" }]} numberOfLines={1}>
                {f.value}
              </RawText>
            </View>
          ))}
        </Pressable>
      )}
    </View>
  );
}

function ConfirmCard({ c, action, busy, onDecide }: { c: Colors; action: PendingAction; busy: boolean; onDecide: (ok: boolean) => void }) {
  const serious = action.level === "SENSITIVE";
  const tone = serious ? c.danger : c.accent;
  return (
    <View style={[st.card, { backgroundColor: c.card, borderWidth: 1, borderColor: `${tone}55` }]}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
        <Icon name={serious ? "warning-outline" : "shield-checkmark-outline"} size={20} color={tone} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[typo.caption, { color: tone }]}>{serious ? "Jiddiy amal — tasdiqlang" : "Tasdiqlang"}</Text>
          <RawText style={[typo.body, { color: c.ink, lineHeight: 21 }]}>{action.summary}</RawText>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable disabled={busy} onPress={() => onDecide(false)} style={({ pressed }) => [st.action, { backgroundColor: c.tint, opacity: pressed || busy ? 0.6 : 1 }]}>
          <Text style={[typo.bodyStrong, { color: c.ink }]}>Bekor qilish</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={() => onDecide(true)} style={({ pressed }) => [st.action, { backgroundColor: serious ? c.danger : c.success, opacity: pressed || busy ? 0.6 : 1 }]}>
          <Text style={[typo.bodyStrong, { color: "#fff" }]}>{serious ? "Bajarish" : "Tasdiqlash"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  headBtn: { width: 44, height: 36, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 48 },
  bubble: { maxWidth: "86%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  left: { alignSelf: "flex-start", borderBottomLeftRadius: 6 },
  right: { alignSelf: "flex-end", borderBottomRightRadius: 6 },
  card: { alignSelf: "stretch", padding: 14, gap: 12, borderRadius: radius.card },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexBasis: "47%", flexGrow: 1, borderRadius: radius.tile, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  tr: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  action: { flex: 1, height: 44, borderRadius: radius.button, alignItems: "center", justifyContent: "center" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  starter: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radius.card },
  orb: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  composer: { paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  inputWrap: { flexDirection: "row", alignItems: "flex-end", borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, paddingLeft: 16, paddingRight: 5, paddingVertical: 5 },
  input: { flex: 1, maxHeight: 120, paddingTop: ios ? 8 : 6, paddingBottom: ios ? 8 : 6 },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
