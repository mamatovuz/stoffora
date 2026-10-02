import "@/lib/polyfills";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import { Stack, router, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PinFlow } from "@/components/PinFlow";
import { Icon } from "@/components/ui";
import { routeForGo } from "@/lib/links";
import { registerPush, watchPushToken } from "@/lib/push";
import { SessionProvider, useSession } from "@/lib/session";
import { ios, useTheme } from "@/lib/theme";
import { invalidate } from "@/lib/useData";

const handledPushes = new Set<string>();

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
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Staffora’ni ochish", cancelLabel: pin ? "PIN-kod" : "Bekor qilish", disableDeviceFallback: pin });
    if (result.success) setLocked(false);
  };
  const lock = () => {
    setLocked(true);
    if (bio) void biometric();
  };
  useEffect(() => {
    if (!enabled) return setLocked(false);
    lock();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") leftAt.current = Date.now();
      if (next === "active" && leftAt.current && Date.now() - leftAt.current > 60_000) lock();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
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
  const { state } = useSession();
  const { c, dark } = useTheme();
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
          headerBackTitle: "Orqaga",
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="activate" options={{ gestureEnabled: false }} />
        <Stack.Screen name="pending" options={{ gestureEnabled: false }} />
        <Stack.Screen name="permissions" options={{ gestureEnabled: false }} />
        <Stack.Screen name="face-check" options={{ presentation: "fullScreenModal", animation: "fade", contentStyle: { backgroundColor: "#000" } }} />
        <Stack.Screen name="face-enroll" options={{ presentation: "fullScreenModal", contentStyle: { backgroundColor: "#000" } }} />
        <Stack.Screen name="notifications" options={{ headerShown: true, title: "Bildirishnomalar", headerLargeTitle: ios }} />
        <Stack.Screen name="salary" options={{ headerShown: true, title: "Mening oyligim" }} />
        <Stack.Screen name="security" options={{ headerShown: true, title: "Sozlamalar" }} />
        <Stack.Screen name="directory" options={{ headerShown: true, title: "Hamkasblar" }} />
        <Stack.Screen name="payslips" options={{ headerShown: true, title: "Hisob varaqalar" }} />
        <Stack.Screen name="documents" options={{ headerShown: true, title: "Hujjatlarim" }} />
        <Stack.Screen name="helpdesk" options={{ headerShown: true, title: "HR bilan aloqa" }} />
        <Stack.Screen name="pin" options={{ presentation: "modal", gestureEnabled: false }} />
        <Stack.Screen name="birthdays" options={{ headerShown: true, title: "Tug‘ilgan kunlar" }} />
        <Stack.Screen name="mark-request" options={{ headerShown: true, title: "Belgilash so‘rovi" }} />
        <Stack.Screen name="employee/[id]" options={{ headerShown: true, title: "Xodimning profili" }} />
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
