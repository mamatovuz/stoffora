import "@/lib/polyfills";
import { installErrorReporting, reportError } from "@/lib/report";
import { checkForAppUpdate, watchAppUpdates } from "@/lib/updates";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import { Stack, router, useSegments, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PinFlow } from "@/components/PinFlow";
import { Icon } from "@/components/ui";
import { t, useT } from "@/lib/i18n";
import { routeForGo } from "@/lib/links";
import { registerPush, watchPushToken } from "@/lib/push";
import { watchOfflineMarks } from "@/lib/offlineMarks";
import { SessionProvider, useSession } from "@/lib/session";
import { ios, useTheme } from "@/lib/theme";
import { invalidate } from "@/lib/useData";

const handledPushes = new Set<string>();
// Xatolar jurnali — ilova ishga tushishi bilan (qulashlar ham ushlanadi).
installErrorReporting();

/** Ekran xatosi: oq ekran o‘rniga tushunarli oyna va «Qayta urinish»; xato jurnalga yoziladi. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    reportError("screen", error.message, error);
  }, [error]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 14, backgroundColor: "#F2F3F5" }}>
      <Text style={{ fontSize: 40 }}>⚠️</Text>
      <Text style={{ fontSize: 20, fontWeight: "700", color: "#0F172A", textAlign: "center" }}>Kutilmagan xato</Text>
      <Text style={{ fontSize: 15, color: "#6B7280", textAlign: "center" }}>Xato haqida ma’lumot avtomatik yuborildi. Qayta urinib ko‘ring.</Text>
      <Pressable onPress={() => void retry()} style={{ marginTop: 6, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, backgroundColor: "#2563EB" }}>
        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>Qayta urinish</Text>
      </Pressable>
    </View>
  );
}

function Gate() {
  const { state, prefs } = useSession();
  const segments = useSegments();
  useEffect(() => {
    if (state === "loading") return;
    const top = segments[0] as string | undefined;
    const open = top === "activate" || top === "pending";
    if (state === "signedOut" && top !== "activate") router.replace("/activate");
    else if (state === "pending" && top !== "pending") router.replace("/pending");
    else if (state === "signedIn" && (open || !top)) router.replace(prefs.onboarded ? "/(tabs)" : "/permissions");
  }, [state, segments, prefs.onboarded]);

  // Push: token aylanishi va bildirishnomani bosganda tegishli ekranni ochish.
  useEffect(() => {
    if (state !== "signedIn") return;
    void registerPush(false).catch(() => undefined);
    const stopWatch = watchPushToken();
    // Internetsiz saqlangan belgilar — aloqa tiklanishi bilan avtomatik yuboriladi.
    const stopMarks = watchOfflineMarks();
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      // Har bir push faqat bir marta ochiladi (ilova qayta ochilganda takrorlanmasin).
      const id = response.notification.request.identifier;
      if (handledPushes.has(id)) return;
      handledPushes.add(id);
      invalidate("/mini/");
      const target = routeForGo(response.notification.request.content.data?.go as string | undefined) || "/notifications";
      router.navigate(target);
    };
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    const received = Notifications.addNotificationReceivedListener(() => invalidate("/mini/"));
    return () => {
      stopWatch();
      stopMarks();
      sub.remove();
      received.remove();
    };
  }, [state]);
  return null;
}

/**
 * Ilova qulfi: PIN-kod va/yoki telefon biometriyasi. Ochilganda va 1 daqiqadan ko‘p fonda
 * turgandan keyin so‘raladi. PIN yoqilgan bo‘lsa — biometriya PIN ekranidagi tugma bo‘ladi.
 */
function AppLock() {
  const { prefs, state } = useSession();
  const [locked, setLocked] = useState(false);
  const leftAt = useRef<number | null>(null);
  const pin = Boolean(prefs.pinLock);
  const bio = Boolean(prefs.appLock);
  const enabled = (pin || bio) && state === "signedIn";

  const biometric = async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: t("Staffora’ni ochish"), cancelLabel: t(pin ? "PIN-kod" : "Bekor qilish"), disableDeviceFallback: pin });
    if (result.success) setLocked(false);
  };
  const lock = () => {
    setLocked(true);
    if (bio) void biometric();
  };
  // Faqat ilova ochilganda (sessiya yuklanib bo‘lgach) qulflanadi — PIN endigina yoqilganda emas.
  const booted = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const lockRef = useRef(lock);
  lockRef.current = lock;
  useEffect(() => {
    if (state === "loading" || booted.current) return;
    booted.current = true;
    if (enabledRef.current) lockRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  useEffect(() => {
    if (!enabled) setLocked(false);
  }, [enabled]);
  // 1 daqiqadan ko‘p fonda turgandan keyin qaytilganda qulflanadi. Vaqt har safar tozalanadi —
  // aks holda kamera, galereya yoki Face ID oynasidan qaytganda ham qayta-qayta qulflanardi.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") leftAt.current = Date.now();
      if (next === "active") {
        const away = leftAt.current ? Date.now() - leftAt.current : 0;
        leftAt.current = null;
        if (enabledRef.current && away > 60_000) lockRef.current();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!locked) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]}>
      {pin ? (
        <PinFlow mode="unlock" onDone={() => setLocked(false)} biometric={bio ? { label: ios ? "Face ID" : "Barmoq izi", run: () => void biometric() } : undefined} />
      ) : (
        <BioLock onUnlock={() => void biometric()} />
      )}
    </View>
  );
}

function BioLock({ onUnlock }: { onUnlock: () => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", gap: 16 }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: `${c.accent}14`, alignItems: "center", justifyContent: "center" }}>
        <Icon name="lock-closed" size={28} color={c.accent} />
      </View>
      <Text style={{ color: c.ink, fontSize: 20, fontWeight: "600" }}>Staffora qulflangan</Text>
      <Pressable onPress={onUnlock} style={{ paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14, backgroundColor: `${c.accent}14` }}>
        <Text style={{ color: c.accent, fontWeight: "600", fontSize: 16 }}>{ios ? "Face ID bilan ochish" : "Barmoq izi bilan ochish"}</Text>
      </Pressable>
    </View>
  );
}

function Shell() {
  const tr = useT();
  const { state } = useSession();
  const { c, dark } = useTheme();
  // Build’siz yangilanishlar: ishga tushganda va fondan qaytganda tekshiriladi.
  useEffect(() => {
    void checkForAppUpdate(true);
    return watchAppUpdates();
  }, []);
  if (state === "loading")
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.muted} />
      </View>
    );
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.bg },
          headerTintColor: c.accent,
          headerStyle: { backgroundColor: c.bg },
          headerTitleStyle: { color: c.ink },
          headerShadowVisible: false,
          headerBackTitle: tr("Orqaga"),
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="activate" options={{ gestureEnabled: false }} />
        <Stack.Screen name="pending" options={{ gestureEnabled: false }} />
        <Stack.Screen name="permissions" options={{ gestureEnabled: false }} />
        <Stack.Screen name="face-check" options={{ presentation: "fullScreenModal", animation: "fade", contentStyle: { backgroundColor: "#000" } }} />
        <Stack.Screen name="face-enroll" options={{ presentation: "fullScreenModal", contentStyle: { backgroundColor: "#000" } }} />
        <Stack.Screen name="notifications" options={{ headerShown: true, title: tr("Bildirishnomalar"), headerLargeTitle: ios }} />
        <Stack.Screen name="salary" options={{ headerShown: true, title: tr("Mening oyligim") }} />
        <Stack.Screen name="my-month" options={{ headerShown: true, title: tr("Mening oyim") }} />
        <Stack.Screen name="security" options={{ headerShown: true, title: tr("Sozlamalar") }} />
        <Stack.Screen name="directory" options={{ headerShown: true, title: tr("Hamkasblar") }} />
        <Stack.Screen name="payslips" options={{ headerShown: true, title: tr("Hisob varaqalar") }} />
        <Stack.Screen name="documents" options={{ headerShown: true, title: tr("Hujjatlarim") }} />
        <Stack.Screen name="helpdesk" options={{ headerShown: true, title: tr("HR bilan aloqa") }} />
        <Stack.Screen name="badge" options={{ headerShown: true, title: tr("Mening ID") }} />
        <Stack.Screen name="badge-scan" options={{ headerShown: false, presentation: "fullScreenModal" }} />
        <Stack.Screen name="pin" options={{ presentation: "modal", gestureEnabled: false }} />
        <Stack.Screen name="birthdays" options={{ headerShown: true, title: tr("Tug‘ilgan kunlar") }} />
        <Stack.Screen name="mark-request" options={{ headerShown: true, title: tr("Belgilash so‘rovi") }} />
        <Stack.Screen name="reminders" options={{ headerShown: true, title: tr("Eslatmalar") }} />
        <Stack.Screen name="employee/[id]" options={{ headerShown: true, title: tr("Xodimning profili") }} />
      </Stack>
      <Gate />
      <AppLock />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
