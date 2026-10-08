import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Card, ErrorBox, Hint, Loading, Segmented, haptic } from "@/components/ui";
import { errorText, put } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { useData } from "@/lib/useData";
import { disableGeofence, enableGeofence, geofenceEnabled } from "@/lib/geofence";
import type { HomeData } from "@/lib/types";

type Rule = { enabled: boolean; offset: number };
type Prefs = { start: Rule; end: Rule };
const MINUTES = [5, 10, 15, 20, 30, 45, 60];

/**
 * Ish boshlanishi va tugashi haqida eslatma (Verifix’dagi kabi): har biri uchun yoqish,
 * «Avval» / «Keyin» va necha daqiqa. Saqlash — darhol (o‘zgartirilganda).
 */
export default function Reminders() {
  const { c } = useTheme();
  const { data, error, reload } = useData<Prefs>("/mini/reminders", { maxAgeMs: 0 });
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    if (data && !prefs) setPrefs(data);
  }, [data, prefs]);

  const update = async (next: Prefs) => {
    setPrefs(next);
    setSaving(true);
    setSaveError("");
    try {
      setPrefs(await put<Prefs>("/mini/reminders", next));
      haptic.select();
    } catch (e) {
      setSaveError(errorText(e, "Saqlanmadi."));
    } finally {
      setSaving(false);
    }
  };

  if (!prefs) return <View style={{ flex: 1, backgroundColor: c.bg, padding: 16 }}>{error ? <ErrorBox text={error} onRetry={reload} /> : <Loading />}</View>;
  const block = (key: "start" | "end", title: string, sub: string) => {
    const rule = prefs[key];
    const before = rule.offset < 0;
    const minutes = Math.abs(rule.offset) || 10;
    const set = (patch: Partial<Rule>) => void update({ ...prefs, [key]: { ...rule, ...patch } });
    return (
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.ink, fontSize: 16, fontWeight: "600" }}>{title}</Text>
            <Text style={{ color: c.muted, fontSize: 13 }}>{sub}</Text>
          </View>
          <Switch value={rule.enabled} onValueChange={(enabled) => set({ enabled })} />
        </View>
        {rule.enabled ? (
          <>
            <Segmented<"before" | "after">
              value={before ? "before" : "after"}
              onChange={(v) => set({ offset: v === "before" ? -minutes : minutes })}
              options={[
                ["before", "Avval"],
                ["after", "Keyin"],
              ]}
            />
            <View style={st.chips}>
              {MINUTES.map((m) => (
                <Pressable key={m} onPress={() => set({ offset: before ? -m : m })} style={[st.chip, { backgroundColor: minutes === m ? c.accent : c.tint }]}>
                  <Text style={{ color: minutes === m ? "#fff" : c.ink, fontWeight: "600" }}>{m} min</Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ color: c.muted, fontSize: 13 }}>
              {key === "start"
                ? before
                  ? `Ish boshlanishidan ${minutes} daqiqa oldin eslatamiz.`
                  : `Ish boshlanib ${minutes} daqiqa o‘tsa va kelishingiz qayd etilmagan bo‘lsa — eslatamiz.`
                : before
                  ? `Ish tugashidan ${minutes} daqiqa oldin «Ishdan ketdim»ni eslatamiz.`
                  : `Ish tugab ${minutes} daqiqa o‘tsa va ketishingiz belgilanmagan bo‘lsa — eslatamiz.`}
            </Text>
          </>
        ) : null}
      </Card>
    );
  };
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      {block("start", "Ish kunining boshlanishi", "Keldi-ketdi qilishni unutmaslik uchun")}
      {block("end", "Ish kunining tugashi", "Ketishni belgilashni unutmaslik uchun")}
      {saveError ? <Text style={{ color: c.danger }}>{saveError}</Text> : null}
      <Hint icon="notifications-outline">
        Eslatma push-bildirishnoma va Telegram orqali keladi. Dam olish va ta’til kunlari eslatilmaydi.{saving ? " Saqlanmoqda…" : ""}
      </Hint>
      <GeofenceCard />
      <NotifyPrefsCard />
    </ScrollView>
  );
}

const st = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99 },
});

type NotifyPrefs = { categories: { key: string; label: string; enabled: boolean }[]; note: string };

/** Qaysi toifadagi xabarlar telefonga (push / Telegram) kelsin. */
function NotifyPrefsCard() {
  const { c } = useTheme();
  const { data, reload } = useData<NotifyPrefs>("/mini/notify-prefs", { maxAgeMs: 0 });
  const [local, setLocal] = useState<NotifyPrefs | null>(null);
  useEffect(() => {
    if (data) setLocal(data);
  }, [data]);
  if (!local) return null;
  const toggle = async (key: string, enabled: boolean) => {
    haptic.select();
    setLocal({ ...local, categories: local.categories.map((x) => (x.key === key ? { ...x, enabled } : x)) });
    try {
      await put("/mini/notify-prefs", { [key]: enabled });
    } catch {
      void reload();
    }
  };
  return (
    <Card style={{ gap: 4 }}>
      <Text style={{ color: c.ink, fontSize: 16, fontWeight: "600", marginBottom: 6 }}>Bildirishnomalar</Text>
      {local.categories.map((x, i) => (
        <View key={x.key} style={[{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
          <Text style={{ flex: 1, color: c.ink, fontSize: 15 }}>{x.label}</Text>
          <Switch value={x.enabled} onValueChange={(v) => void toggle(x.key, v)} />
        </View>
      ))}
      <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 6 }}>{local.note}</Text>
    </Card>
  );
}

/** Filialga yaqinlashganda «Ishga keldingizmi?» (fon geofence) — ixtiyoriy. */
function GeofenceCard() {
  const { c } = useTheme();
  const home = useData<HomeData>("/mini/home", { refetchOnFocus: false });
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void geofenceEnabled().then(setOn);
  }, []);
  const toggle = async (next: boolean) => {
    if (!home.data) return;
    setBusy(true);
    try {
      if (!next) {
        await disableGeofence();
        setOn(false);
        return;
      }
      const result = await enableGeofence(home.data);
      if (result === "on") {
        haptic.select();
        setOn(true);
      } else if (result === "no-branch") Alert.alert("Filial yo‘q", "Sizga filial biriktirilmagan — HR bilan bog‘laning.");
      else
        Alert.alert(
          "Ruxsat kerak",
          result === "background-denied"
            ? "Sozlamalarda joylashuvga «Har doim» (Always) ruxsatini bering — shunda ilova yopiq bo‘lsa ham filialga kelganingizni eslatadi."
            : "Joylashuvga ruxsat berilmadi.",
          [
            { text: "Bekor", style: "cancel" },
            { text: "Sozlamalar", onPress: () => void Linking.openSettings() },
          ],
        );
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (on === null) return null;
  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.ink, fontSize: 16, fontWeight: "600" }}>Filialga kelganda eslatish</Text>
          <Text style={{ color: c.muted, fontSize: 13 }}>Ilova yopiq bo‘lsa ham «Ishga keldingizmi?» deb so‘raydi</Text>
        </View>
        <Switch value={on} disabled={busy || !home.data} onValueChange={(v) => void toggle(v)} />
      </View>
      <Text style={{ color: c.muted, fontSize: 12.5 }}>
        Telefon faqat filial hududiga kirganingizni sezadi — joylashuvingiz serverga yuborilmaydi. Kuniga bir martadan ko‘p eslatilmaydi, kelish belgilangan kuni eslatilmaydi.
      </Text>
    </Card>
  );
}
