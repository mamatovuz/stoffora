import { useNavigation } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { mediaUri } from "@/lib/config";
import { useTheme } from "@/lib/theme";

/*
 * «Mening ID»: raqamli guvohnoma — 2 daqiqalik imzolangan QR (qo‘riqchi / rahbar skaner qiladi).
 * Mini App bilan bir xil API.
 */

type Badge = { qr: string; expiresAt: string; company: string; employee: { name: string; employeeNo: string; photoDataUrl?: string; position: string; branch: string } };

export default function BadgeScreen() {
  const navigation = useNavigation();
  const { c } = useTheme();
  useLayoutEffect(() => {
    navigation.setOptions({ title: "Mening ID" });
  }, [navigation]);
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <BadgeCard />
    </ScrollView>
  );
}

function BadgeCard() {
  const { c } = useTheme();
  const [b, setB] = useState<Badge | null>(null);
  const [left, setLeft] = useState(0);
  const load = useCallback(() => {
    void api<Badge>("/mini/badge")
      .then(setB)
      .catch(() => setB(null));
  }, []);
  useEffect(load, [load]);
  // QR 2 daqiqa amal qiladi — tugashidan oldin o‘zi yangilanadi (skrinshot ishlamaydi).
  useEffect(() => {
    if (!b) return;
    const tick = () => {
      const s = Math.max(0, Math.round((Date.parse(b.expiresAt) - Date.now()) / 1000));
      setLeft(s);
      if (s <= 5) load();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [b, load]);
  if (!b) return <Loading />;
  return (
    <Card style={{ alignItems: "center", gap: 14, paddingVertical: 20 }}>
      <Text style={{ color: c.muted, fontWeight: "600", fontSize: 13 }}>{b.company}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, alignSelf: "stretch" }}>
        {b.employee.photoDataUrl ? <Image source={{ uri: mediaUri(b.employee.photoDataUrl) }} style={st.photo} /> : <View style={[st.photo, { backgroundColor: c.tint }]} />}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.ink, fontSize: 18, fontWeight: "700" }}>{b.employee.name}</Text>
          <Text style={{ color: c.muted }}>{b.employee.position}</Text>
          <Text style={{ color: c.muted, fontSize: 13 }}>
            {b.employee.branch} · {b.employee.employeeNo}
          </Text>
        </View>
      </View>
      <Image source={{ uri: b.qr }} style={st.qr} />
      <Text style={{ color: c.muted, fontSize: 12.5 }}>QR {left} soniyadan keyin yangilanadi</Text>
    </Card>
  );
}

const st = StyleSheet.create({
  photo: { width: 72, height: 72, borderRadius: 18 },
  qr: { width: 240, height: 240, borderRadius: 16, backgroundColor: "#fff" },
});
