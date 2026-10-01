import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Icon, haptic } from "@/components/ui";
import { ApiError, errorText } from "@/lib/api";
import { FRAME, PLACEMENT_TEXT, enrollFaces, grabFrame, placement, probeFace } from "@/lib/faceCamera";
import { invalidate } from "@/lib/useData";

/*
 * Face ID’ni birinchi marta sozlash (faqat bir marta): to‘g‘ri → biroz bir tomonga → biroz
 * boshqa tomonga → yana to‘g‘ri. Turli burchakdagi namunalar keyingi tekshiruvlarni aniqroq qiladi.
 * Namunalar serverda hisoblanadi; boshqa xodimning yuziga o‘xshasa — rad etiladi.
 */
type Step = { title: string; test: (yaw: number, prev: number[]) => boolean };
const STEPS: Step[] = [
  { title: "Kameraga to‘g‘ri qarang", test: (yaw) => Math.abs(yaw) < 0.12 },
  { title: "Boshingizni biroz chapga buring", test: (yaw) => Math.abs(yaw) > 0.13 && Math.abs(yaw) < 0.45 },
  { title: "Endi biroz o‘ngga buring", test: (yaw, prev) => Math.abs(yaw) > 0.13 && Math.abs(yaw) < 0.45 && Math.sign(yaw) !== Math.sign(prev[1] ?? 0) },
  { title: "Yana to‘g‘ri qarang", test: (yaw) => Math.abs(yaw) < 0.12 },
];

export default function FaceEnroll() {
  const insets = useSafeAreaInsets();
  const { action = "CHECK_IN" } = useLocalSearchParams<{ action?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
  const [hint, setHint] = useState("Kamera tayyorlanmoqda…");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!ready || !permission?.granted) return;
    let stop = false;
    const photos: string[] = [];
    const yaws: number[] = [];
    (async () => {
      let index = 0;
      setStep(0);
      setError("");
      while (!stop && index < STEPS.length) {
        try {
          const photo = await grabFrame(camera.current!);
          const probe = await probeFace(photo);
          if (stop) return;
          const where = placement(probe.face);
          // Burilish bosqichlarida «tilted» kutilgan holat — faqat joylashuv va yorug‘lik tekshiriladi.
          const okPlace = where === "ok" || (where === "tilted" && index > 0 && index < 3);
          if (!probe.face || !okPlace) {
            setHint(PLACEMENT_TEXT[where]);
            continue;
          }
          if (!STEPS[index].test(probe.face.yaw, yaws)) {
            setHint(STEPS[index].title);
            continue;
          }
          photos.push(photo);
          yaws.push(probe.face.yaw);
          // To‘g‘ri qarash bosqichida qo‘shimcha namuna (aniqlik uchun).
          if (index === 0) photos.push(await grabFrame(camera.current!));
          haptic.success();
          index += 1;
          setStep(index);
          setHint(STEPS[index]?.title || "Saqlanmoqda…");
        } catch (reason) {
          if (stop) return;
          if (reason instanceof ApiError && reason.status >= 400 && reason.status !== 429) {
            setError(errorText(reason));
            return;
          }
          await new Promise((r) => setTimeout(r, 600));
        }
      }
      if (stop) return;
      setBusy(true);
      try {
        await enrollFaces(photos.slice(0, 6));
        invalidate("/mini/");
        haptic.success();
        router.replace({ pathname: "/face-check", params: { action } });
      } catch (reason) {
        haptic.error();
        setError(errorText(reason, "Face ID sozlanmadi."));
      } finally {
        setBusy(false);
      }
    })();
    return () => {
      stop = true;
    };
  }, [ready, permission?.granted, run, action]);

  if (!permission) return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  if (!permission.granted)
    return (
      <View style={[st.root, { paddingTop: insets.top + 40, paddingHorizontal: 24, gap: 16, alignItems: "center" }]}>
        <Icon name="camera-outline" size={54} color="#fff" />
        <Text style={{ color: "#fff", fontSize: 22, fontWeight: "700" }}>Kameraga ruxsat kerak</Text>
        {permission.canAskAgain ? <Button title="Ruxsat berish" onPress={() => void requestPermission()} style={{ alignSelf: "stretch" }} /> : <Button title="Sozlamalarni ochish" onPress={() => void Linking.openSettings()} style={{ alignSelf: "stretch" }} />}
        <Button title="Orqaga" tone="ghost" onPress={() => router.back()} style={{ alignSelf: "stretch" }} />
      </View>
    );

  return (
    <View style={[st.root, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 12 }]}>
      <View style={st.top}>
        <Pressable onPress={() => router.back()} style={st.round} hitSlop={8} accessibilityLabel="Orqaga">
          <Icon name="close" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "600" }}>Face ID’ni sozlash</Text>
          <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12.5 }}>Bir marta · ~15 soniya</Text>
        </View>
      </View>
      <View style={st.stage}>
        <View style={st.view}>
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" zoom={0} ratio="4:3" animateShutter={false} onCameraReady={() => setReady(true)} />
          <View style={[st.oval, { width: `${FRAME.w * 100}%`, top: `${(FRAME.cy - FRAME.h / 2) * 100 - 4}%` }]} pointerEvents="none" />
          {busy ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" }]}>
              <ActivityIndicator color="#fff" size="large" />
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ paddingHorizontal: 20, gap: 14 }}>
        <View style={st.dots}>
          {STEPS.map((_, i) => (
            <View key={i} style={[st.dot, { backgroundColor: i < step ? "#30D158" : i === step ? "#fff" : "rgba(255,255,255,0.25)", flex: i === step ? 2 : 1 }]} />
          ))}
        </View>
        <Text style={{ color: "#fff", fontSize: 20, fontWeight: "600", textAlign: "center", minHeight: 52 }}>{error || (busy ? "Saqlanmoqda…" : hint)}</Text>
        {error ? <Button title="Qayta boshlash" icon="refresh" onPress={() => setRun((n) => n + 1)} /> : <Text style={{ color: "#8E8E93", textAlign: "center", fontSize: 13 }}>Yuzingiz ramkada bo‘lsin. Ko‘zoynak va bosh kiyimsiz, yorug‘ joyda.</Text>}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  top: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingBottom: 8 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  view: { width: "100%", maxHeight: "100%", aspectRatio: 3 / 4, borderRadius: 28, overflow: "hidden", backgroundColor: "#111" },
  oval: { position: "absolute", left: `${(1 - FRAME.w) * 50}%`, aspectRatio: 0.8, borderRadius: 999, borderWidth: 3, borderColor: "rgba(255,255,255,0.9)" },
  dots: { flexDirection: "row", gap: 6 },
  dot: { height: 5, borderRadius: 3 },
});
