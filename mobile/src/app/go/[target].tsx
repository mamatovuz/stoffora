import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { routeForGo } from "@/lib/links";
import { useTheme } from "@/lib/theme";
import type { HomeData } from "@/lib/types";
import { useData } from "@/lib/useData";

/*
 * Tashqi havolalar: staffora://go/<bo‘lim> — bosh ekran vidjeti va bildirishnomalardan.
 * «checkin» / «checkout» — darhol yuz tekshiruvi ochiladi (Face ID sozlanmagan bo‘lsa — sozlash).
 */
export default function GoLink() {
  const { c } = useTheme();
  const { target } = useLocalSearchParams<{ target: string }>();
  const action = target === "checkin" ? "CHECK_IN" : target === "checkout" ? "CHECK_OUT" : null;
  const { data, error } = useData<HomeData>(action ? "/mini/home" : null);
  useEffect(() => {
    if (!action) {
      router.replace(routeForGo(target) || "/(tabs)");
      return;
    }
    if (error) return router.replace("/(tabs)");
    if (!data) return;
    const a = data.attendance;
    // Holat o‘zgargan bo‘lsa (allaqachon kelgan/ketgan) — bosh sahifa.
    const valid = action === "CHECK_IN" ? !a?.checkIn : Boolean(a?.checkIn && !a.checkOut);
    if (!valid || !data.branch) return router.replace("/(tabs)");
    router.replace("/(tabs)");
    router.push({ pathname: data.employee.faceEnrolledAt ? "/face-check" : "/face-enroll", params: { action } });
  }, [action, target, data, error]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }}>
      <ActivityIndicator color={c.muted} />
    </View>
  );
}
