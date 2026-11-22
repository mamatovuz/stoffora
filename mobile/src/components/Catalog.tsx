import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/T";
import { useTheme } from "@/lib/theme";
import { Icon, haptic, type IconName } from "./ui";

/*
 * «Katalog» ko‘rinishi (Bo‘limlar va Rahbar → Boshqaruv): kichik guruh sarlavhasi, ostida 4 ustunli
 * katakcha — och kulrang yumaloq kvadrat, ichida ko‘k belgi, pastida 2 qatorgacha yozuv.
 * Ortiqcha izoh yo‘q: belgi va nom yetarli.
 */

export type CatalogItem = { key: string; label: string; icon: IconName; badge?: number };
export type CatalogGroup = { title: string; items: CatalogItem[] };

/** Bitta katak. `onOpen` barqaror (useCallback) bo‘lsa — o‘zgarmagan kataklar qayta chizilmaydi. */
const Tile = memo(function Tile({ item, onOpen }: { item: CatalogItem; onOpen: (key: string) => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptic.select();
        onOpen(item.key);
      }}
      accessibilityRole="button"
      accessibilityLabel={item.badge ? `${item.label}, ${item.badge}` : item.label}
      style={st.tile}
    >
      {({ pressed }) => (
        <>
          <View style={[st.box, { backgroundColor: c.tint }, pressed && st.pressed]}>
            <Icon name={item.icon} size={25} color={c.accent} />
            {item.badge ? (
              <View style={[st.badge, { backgroundColor: c.danger, borderColor: c.card }]}>
                <Text style={st.badgeText}>{item.badge > 99 ? "99+" : String(item.badge)}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[st.label, { color: c.ink }]} numberOfLines={2}>
            {item.label}
          </Text>
        </>
      )}
    </Pressable>
  );
});

export function Catalog({ groups, onOpen }: { groups: CatalogGroup[]; onOpen: (key: string) => void }) {
  const { c } = useTheme();
  return (
    <>
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <View key={g.title} style={st.group}>
            <Text style={[st.title, { color: c.ink }]} accessibilityRole="header">
              {g.title}
            </Text>
            <View style={st.grid}>
              {g.items.map((item) => (
                <Tile key={item.key} item={item} onOpen={onOpen} />
              ))}
            </View>
          </View>
        ))}
    </>
  );
}

const st = StyleSheet.create({
  group: { gap: 12 },
  title: { fontSize: 15, fontWeight: "600", marginLeft: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 14 },
  tile: { width: "25%", alignItems: "center", gap: 8, paddingHorizontal: 2 },
  box: { width: 58, height: 58, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.6, transform: [{ scale: 0.95 }] },
  label: { fontSize: 12.5, lineHeight: 16, fontWeight: "500", textAlign: "center" },
  badge: { position: "absolute", top: -5, right: -5, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 10.5, fontWeight: "700" },
});
