import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Image, Linking, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Badge, Button, Icon, haptic } from "@/components/ui";
import { errorText } from "@/lib/api";
import { mediaUri } from "@/lib/config";
import { mcall } from "@/lib/manager";

/* Rahbar / qo‘riqchi: xodimning raqamli ID QR kodini skanerlab tekshirish (server: imzo, 2 daqiqa, holat). */

type Result = {
  valid: boolean;
  employee: { name: string; employeeNo: string; photoDataUrl?: string; position: string; branch: string };
  today: { checkIn?: string; checkOut?: string } | null;
};

export default function BadgeScan() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const onScan = (e: BarcodeScanningResult) => {
    if (busy.current || result || error) return;
    if (!/^staffora-badge:|\/id\//.test(e.data || "")) return;
    busy.current = true;
    haptic.medium();
    void mcall<Result>(`/badge/verify?token=${encodeURIComponent(e.data)}`)
      .then((r) => {
        r.valid ? haptic.success() : haptic.error();
        setResult(r);
      })
      .catch((reason) => {
        haptic.error();
        setError(errorText(reason));
      })
      .finally(() => (busy.current = false));
  };
  const reset = () => {
    setResult(null);
    setError("");
  };
  if (!permission) return <View style={st.root} />;
  if (!permission.granted)
    return (
      <View style={[st.root, { padding: 24, paddingTop: insets.top + 40, gap: 14 }]}>
        <Text style={st.title}>Kameraga ruxsat kerak</Text>
        {permission.canAskAgain ? <Button title="Ruxsat berish" onPress={() => void requestPermission()} /> : <Button title="Sozlamalar" onPress={() => void Linking.openSettings()} />}
        <Button title="Orqaga" tone="ghost" onPress={() => router.back()} />
      </View>
    );
  return (
    <View style={st.root}>
      {!result && !error ? (
        <>
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onScan} />
          <View style={[st.hint, { top: insets.top + 16 }]}>
            <Text style={st.hintText}>Xodimning «Mening ID» QR kodini ramkaga tuting</Text>
          </View>
          <View style={st.frame} pointerEvents="none" />
        </>
      ) : (
        <View style={[st.result, { paddingTop: insets.top + 40 }]}>
          {error ? (
            <>
              <Icon name="close-circle" size={64} color="#FF453A" />
              <Text style={st.title}>{error}</Text>
            </>
          ) : result ? (
            <>
              {result.employee.photoDataUrl ? <Image source={{ uri: mediaUri(result.employee.photoDataUrl) }} style={st.photo} /> : null}
              <Icon name={result.valid ? "checkmark-circle" : "close-circle"} size={40} color={result.valid ? "#30D158" : "#FF453A"} />
              <Text style={st.title}>{result.employee.name}</Text>
              <Text style={st.sub}>
                {result.employee.position} · {result.employee.branch}
              </Text>
              <Text style={st.sub}>{result.employee.employeeNo}</Text>
              <Badge text={result.valid ? "Faol xodim" : "Faol emas"} tone={result.valid ? "ok" : "bad"} />
              {result.today ? (
                <Text style={st.sub}>
                  Bugun: keldi {result.today.checkIn || "—"}
                  {result.today.checkOut ? `, ketdi ${result.today.checkOut}` : ""}
                </Text>
              ) : null}
            </>
          ) : null}
          <View style={{ alignSelf: "stretch", gap: 10, marginTop: 24 }}>
            <Button title="Yana skanerlash" icon="scan" onPress={reset} />
            <Button title="Yopish" tone="ghost" onPress={() => router.back()} />
          </View>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  hint: { position: "absolute", left: 20, right: 20, alignItems: "center" },
  hintText: { color: "#fff", fontSize: 15, fontWeight: "600", backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, overflow: "hidden" },
  frame: { position: "absolute", alignSelf: "center", top: "30%", width: 240, height: 240, borderWidth: 3, borderColor: "#fff", borderRadius: 24 },
  result: { flex: 1, alignItems: "center", gap: 8, paddingHorizontal: 24 },
  photo: { width: 120, height: 120, borderRadius: 30, marginBottom: 6 },
  title: { color: "#fff", fontSize: 22, fontWeight: "700", textAlign: "center" },
  sub: { color: "#AEAEB2", fontSize: 15, textAlign: "center" },
});
