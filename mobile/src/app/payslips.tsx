import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Card, Empty, ErrorBox, Loading } from "@/components/ui";
import { errorText } from "@/lib/api";
import { openFile } from "@/lib/download";
import { som } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { useData } from "@/lib/useData";

type Line = { base: number; days: number; expectedDays: number; overtimeAmount: number; bonus: number; lateDeduction: number; absenceDeduction: number; fine: number; advance: number; net: number; explanation: string };
type Slip = { month: string; label: string; closedAt: string; line: Line };

/** Hisob varaqalar — yopilgan oylar (raqamlar o‘zgarmaydi), PDF yuklab olish. */
export default function Payslips() {
  const { c } = useTheme();
  const { data, error, loading, reload } = useData<Slip[]>("/mini/payslips");
  const [busy, setBusy] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  const download = async (month: string) => {
    setBusy(month);
    try {
      await openFile({ kind: "payslip", month });
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      {!data?.length ? <Empty icon="receipt-outline" title="Hisob varaqalar yo‘q" text="Oy yopilgach, hisob varaqangiz shu yerda paydo bo‘ladi." /> : null}
      {data?.map((s) => {
        const rows: [string, number, "plus" | "minus" | "base"][] = [
          ["Oklad", s.line.base, "base"],
          ["Qo‘shimcha ish", s.line.overtimeAmount, "plus"],
          ["Mukofot", s.line.bonus, "plus"],
          ["Kechikish ushlanmasi", s.line.lateDeduction, "minus"],
          ["Kelmagan kunlar", s.line.absenceDeduction, "minus"],
          ["Jarima", s.line.fine, "minus"],
          ["Avans", s.line.advance, "minus"],
        ];
        return (
          <Card key={s.month} style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
              <Text style={{ color: c.ink, fontSize: 17, fontWeight: "700" }}>{s.label}</Text>
              <Text style={{ color: c.muted, fontSize: 13 }}>
                {s.line.days}/{s.line.expectedDays} kun
              </Text>
            </View>
            {rows
              .filter(([, v, k]) => k === "base" || v > 0)
              .map(([label, v, k]) => (
                <View key={label} style={st.line}>
                  <Text style={{ color: c.muted, fontSize: 14.5 }}>{label}</Text>
                  <Text style={{ color: k === "minus" ? c.danger : k === "plus" ? c.success : c.ink, fontSize: 14.5, fontVariant: ["tabular-nums"] }}>
                    {k === "minus" ? "−" : k === "plus" ? "+" : ""}
                    {som(v)}
                  </Text>
                </View>
              ))}
            <View style={[st.line, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line, paddingTop: 10 }]}>
              <Text style={{ color: c.ink, fontSize: 16, fontWeight: "600" }}>Qo‘lga</Text>
              <Text style={{ color: c.ink, fontSize: 18, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{som(s.line.net)}</Text>
            </View>
            <Button title="PDF yuklab olish" icon="download-outline" tone="soft" busy={busy === s.month} onPress={() => void download(s.month)} style={{ height: 44 }} />
          </Card>
        );
      })}
    </ScrollView>
  );
}

const st = StyleSheet.create({ line: { flexDirection: "row", justifyContent: "space-between" } });
