import "@/lib/polyfills";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import { Stack, router, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
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

/** Ilova qulfi: yoqilgan bo‘lsa, ochilganda va 1 daqiqadan ko‘p fonda turgandan keyin telefon biometriyasi. */
function AppLock() {
  const { prefs, state } = useSession();
  const { c } = useTheme();
  const [locked, setLocked] = useState(false);
  const leftAt = useRef<number | null>(null);
  const enabled = Boolean(prefs.appLock) && state === "signedIn";

  const unlock = async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Staffora’ni ochish", cancelLabel: "Bekor qilish", disableDeviceFallback: false });
    if (result.success) setLocked(false);
  };
  useEffect(() => {
    if (!enabled) return setLocked(false);
    setLocked(true);
    void unlock();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") leftAt.current = Date.now();
      if (next === "active" && leftAt.current && Date.now() - leftAt.current > 60_000) {
        setLocked(true);
        void unlock();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  if (!locked) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, alignItems: "center", justifyContent: "center", gap: 16, zIndex: 100 }]}>
      <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
        <Icon name="lock-closed" size={32} color="#fff" />
      </View>
      <Text style={{ color: c.ink, fontSize: 20, fontWeight: "700" }}>Staffora qulflangan</Text>
      <Pressable onPress={() => void unlock()} style={{ paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14, backgroundColor: `${c.accent}1A` }}>
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
        <Stack.Screen name="security" options={{ headerShown: true, title: "Xavfsizlik" }} />
        <Stack.Screen name="directory" options={{ headerShown: true, title: "Hamkasblar" }} />
        <Stack.Screen name="payslips" options={{ headerShown: true, title: "Hisob varaqalar" }} />
        <Stack.Screen name="documents" options={{ headerShown: true, title: "Hujjatlarim" }} />
        <Stack.Screen name="helpdesk" options={{ headerShown: true, title: "HR bilan aloqa" }} />
        <Stack.Screen name="birthdays" options={{ headerShown: true, title: "Tug‘ilgan kunlar" }} />
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
