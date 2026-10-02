import { useEffect, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { errorText } from "@/lib/api";
import { mediaUri } from "@/lib/config";
import { dateUz, timeAgo } from "@/lib/format";
import { mcall } from "@/lib/manager";
import { useTheme } from "@/lib/theme";
import { Badge, Button, Card, Empty, Group, GroupTitle, Icon, Loading, haptic } from "./ui";

/*
 * IT / HR — qurilmalar: xodimlarning ulangan telefonlari (bitta xodim — bitta telefon),
 * telefon almashtirish so‘rovlari (tasdiqlash / rad etish) va telefonni o‘chirish.
 * Telefon o‘chirilsa — o‘sha xodim yangi kod bilan qayta ulanadi; boshqa xodim shu telefondan kira oladi.
 */

type Device = { id: string; platform: string; model?: string; appVersion?: string; status: string; createdAt: string; lastSeenAt?: string; push: boolean; employeeName: string; employeeNo?: string; branch?: string; photoDataUrl?: string };
type Request = { id: string; employeeName: string; employeeNo?: string; platform: string; model?: string; createdAt: string; oldDevice?: { model?: string; platform: string } };

export function DevicesView() {
  const { c } = useTheme();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => {
    mcall<{ rows: Device[] }>("/mobile-devices")
      .then((r) => setDevices(r.rows))
      .catch((e) => (setDevices([]), Alert.alert("Xatolik", errorText(e))));
    mcall<Request[]>("/mobile/device-requests?status=PENDING")
      .then(setRequests)
      .catch(() => setRequests([]));
  };
  useEffect(load, []);

  const decide = async (r: Request, approve: boolean) => {
    setBusy(r.id);
    try {
      await mcall(`/mobile/device-requests/${r.id}/decide`, { approve });
      haptic.success();
      load();
    } catch (e) {
      Alert.alert("Xatolik", errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const revoke = (d: Device) =>
    Alert.alert("Telefonni o‘chirish", `${d.employeeName} — ${d.model || d.platform}. Ilovadan chiqariladi; boshqa xodim shu telefonda kira oladi.`, [
      { text: "Bekor qilish", style: "cancel" },
      {
        text: "O‘chirish",
        style: "destructive",
        onPress: async () => {
          setBusy(d.id);
          try {
            await mcall(`/mobile-devices/${d.id}/revoke`, { reason: "IT/HR ilovadan o‘chirdi" });
            haptic.success();
            load();
          } catch (e) {
            Alert.alert("Xatolik", errorText(e));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  const list = (devices || []).filter((d) => `${d.employeeName} ${d.employeeNo || ""} ${d.model || ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const noPush = (devices || []).filter((d) => !d.push).length;
  return (
    <>
      <Card style={{ flexDirection: "row", paddingVertical: 14 }}>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ color: c.ink, fontSize: 22, fontWeight: "700" }}>{devices?.length ?? "…"}</Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>ulangan telefon</Text>
        </View>
        <View style={{ flex: 1, alignItems: "center", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line }}>
          <Text style={{ color: requests.length ? c.warn : c.muted, fontSize: 22, fontWeight: "700" }}>{requests.length}</Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>almashtirish so‘rovi</Text>
        </View>
        <View style={{ flex: 1, alignItems: "center", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line }}>
          <Text style={{ color: noPush ? c.warn : c.muted, fontSize: 22, fontWeight: "700" }}>{noPush}</Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>push o‘chiq</Text>
        </View>
      </Card>

      {requests.length ? <GroupTitle>Telefon almashtirish so‘rovlari</GroupTitle> : null}
      {requests.map((r) => (
        <Card key={r.id} style={{ gap: 8 }}>
          <Text style={{ color: c.ink, fontWeight: "700", fontSize: 15.5 }}>{r.employeeName}</Text>
          <Text style={{ color: c.muted, fontSize: 13.5 }}>
            Yangi: {r.model || r.platform} · {timeAgo(r.createdAt)}
            {r.oldDevice ? `\nEski: ${r.oldDevice.model || r.oldDevice.platform} (tasdiqlansa o‘chiriladi)` : ""}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Rad etish" tone="danger" disabled={busy === r.id} onPress={() => void decide(r, false)} style={{ flex: 1, height: 44 }} />
            <Button title="Tasdiqlash" icon="checkmark" busy={busy === r.id} onPress={() => void decide(r, true)} style={{ flex: 1, height: 44 }} />
          </View>
        </Card>
      ))}

      <View style={[st.search, { backgroundColor: c.card }]}>
        <Icon name="search" size={17} color={c.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Xodim yoki telefon" placeholderTextColor={c.muted} style={{ flex: 1, color: c.ink, fontSize: 16 }} />
      </View>
      {!devices ? (
        <Loading />
      ) : !list.length ? (
        <Empty icon="phone-portrait-outline" title="Ulangan telefon yo‘q" />
      ) : (
        <Group>
          {list.map((d, i) => (
            <View key={d.id} style={[st.row, i < list.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
              {d.photoDataUrl ? (
                <Image source={{ uri: mediaUri(d.photoDataUrl) }} style={st.avatar} />
              ) : (
                <View style={[st.avatar, { backgroundColor: c.tint, alignItems: "center", justifyContent: "center" }]}>
                  <Icon name={d.platform === "ios" ? "logo-apple" : "logo-android"} size={16} color={c.muted} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.ink, fontWeight: "600" }} numberOfLines={1}>
                  {d.employeeName}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12.5 }} numberOfLines={1}>
                  {d.model || d.platform}
                  {d.appVersion ? ` · v${d.appVersion}` : ""} · {d.lastSeenAt ? timeAgo(d.lastSeenAt) : dateUz(d.createdAt.slice(0, 10))}
                </Text>
              </View>
              {!d.push ? <Badge text="push yo‘q" tone="warn" /> : null}
              <Pressable onPress={() => revoke(d)} disabled={busy === d.id} hitSlop={8} accessibilityLabel="Telefonni o‘chirish">
                <Icon name="trash-outline" size={19} color={c.danger} />
              </Pressable>
            </View>
          ))}
        </Group>
      )}
    </>
  );
}

const st = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 44, borderRadius: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
});
