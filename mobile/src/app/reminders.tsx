import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Card, ErrorBox, Hint, Loading, Segmented, haptic } from "@/components/ui";
import { errorText, put } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { useData } from "@/lib/useData";

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
    </ScrollView>
  );
}

const st = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99 },
});
