import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView } from "react-native";
import { Badge, Empty, ErrorBox, Group, Loading, Row } from "@/components/ui";
import { errorText } from "@/lib/api";
import { openFile } from "@/lib/download";
import { dateUz } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { useData } from "@/lib/useData";

type Doc = { id: string; type: string; title: string; expiresAt?: string; createdAt: string; status: "VALID" | "EXPIRING" | "EXPIRED" | string };
const TYPE: Record<string, string> = { PASSPORT: "Pasport", DIPLOMA: "Diplom", MEDICAL: "Tibbiy ma’lumotnoma", SANITARY: "Sanitar kitobcha", CONTRACT: "Mehnat shartnomasi", OTHER: "Boshqa" };

/** Hujjatlarim — HR yuklagan hujjatlar, muddati va ko‘rish. */
export default function Documents() {
  const { c } = useTheme();
  const { data, error, loading, reload } = useData<Doc[]>("/mini/documents");
  const [busy, setBusy] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  const open = async (id: string) => {
    setBusy(id);
    try {
      await openFile({ kind: "document", id });
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      {!data?.length ? (
        <Empty icon="folder-open-outline" title="Hujjatlar yo‘q" text="HR yuklagan pasport, diplom, shartnoma va boshqa hujjatlaringiz shu yerda ko‘rinadi." />
      ) : (
        <Group>
          {data.map((d, i) => (
            <Row
              key={d.id}
              icon="document-text"
              iconColor={d.status === "EXPIRED" ? c.danger : d.status === "EXPIRING" ? c.warn : "#0A84FF"}
              label={d.title || TYPE[d.type] || d.type}
              sub={`${TYPE[d.type] || d.type}${d.expiresAt ? ` · ${dateUz(d.expiresAt)} gacha` : ""}`}
              right={busy === d.id ? <ActivityIndicator /> : d.status === "EXPIRED" ? <Badge text="Muddati o‘tgan" tone="bad" /> : d.status === "EXPIRING" ? <Badge text="Tugayapti" tone="warn" /> : undefined}
              onPress={() => void open(d.id)}
              last={i === data.length - 1}
            />
          ))}
        </Group>
      )}
    </ScrollView>
  );
}
