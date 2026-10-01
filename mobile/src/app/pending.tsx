import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Hint, Icon } from "@/components/ui";
import { errorText } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

/** Yangi telefon: HR tasdig‘ini kutish. Holat qurilma imzosi bilan tekshiriladi (har 15 soniyada). */
export default function Pending() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { checkPending, cancelPending } = useSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      const status = await checkPending();
      setError(status === "REJECTED" ? "So‘rov rad etildi." : "");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void check();
    const id = setInterval(() => void check(), 15_000);
    const sub = AppState.addEventListener("change", (s) => s === "active" && void check());
    return () => {
      clearInterval(id);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 60, paddingHorizontal: 20, gap: 18 }}>
      <View style={{ width: 84, height: 84, borderRadius: 26, backgroundColor: `${c.warn}22`, alignSelf: "center", alignItems: "center", justifyContent: "center" }}>
        <Icon name="phone-portrait" size={38} color={c.warn} />
      </View>
      <Text style={{ color: c.ink, fontSize: 24, fontWeight: "700", textAlign: "center" }}>HR tasdig‘i kutilmoqda</Text>
      <Text style={{ color: c.muted, fontSize: 15, textAlign: "center", lineHeight: 22 }}>
        Sizda boshqa faol telefon bor. HR yangi telefonni tasdiqlagach, ilova shu yerda avtomatik ochiladi va eski telefondagi ilova o‘chiriladi.
      </Text>
      {error ? <Hint tone="bad" icon="alert-circle">{error}</Hint> : null}
      <View style={{ alignItems: "center", minHeight: 24 }}>{busy ? <ActivityIndicator color={c.muted} /> : null}</View>
      <Button title="Holatni tekshirish" icon="refresh" tone="soft" onPress={() => void check()} />
      <Button title="Boshqa kod kiritish" tone="ghost" onPress={() => void cancelPending()} />
    </View>
  );
}
