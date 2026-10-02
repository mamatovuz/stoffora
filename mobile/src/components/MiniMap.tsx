import { useState, type ReactNode } from "react";
import { Image, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { SERVER_ORIGIN } from "@/lib/config";
import { distanceMeters } from "@/lib/location";
import { useTheme } from "@/lib/theme";
import { Icon } from "./ui";

/*
 * Yengil xarita (Mini App’dagi TileMap kabi): OpenStreetMap plitkalari, filial radiusi va
 * xodim turgan joy. Google/Apple Maps kaliti kerak emas. Plitka manzili: EXPO_PUBLIC_MAP_TILE_URL.
 */
// Standart — o‘z serverimiz orqali (keshlangan OSM); mobil tarmoqda OSM sekin/bloklangan bo‘lsa ham ishlaydi.
const TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL || `${SERVER_ORIGIN}/api/tiles/{z}/{x}/{y}.png`;
const FALLBACK_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE = 256;

const project = (lat: number, lng: number, z: number) => {
  const scale = TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
};
const metersPerPixel = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

export type MapCenter = { latitude: number; longitude: number };

export function MiniMap({
  branch,
  radius,
  me,
  height = 190,
  children,
}: {
  branch: MapCenter;
  radius: number;
  me?: (MapCenter & { accuracy?: number }) | null;
  height?: number;
  children?: ReactNode;
}) {
  const { c, dark } = useTheme();
  const [width, setWidth] = useState(0);
  // Server plitkasi ochilmasa — to‘g‘ridan-to‘g‘ri OSM’dan.
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  let body: ReactNode = null;
  if (width) {
    const center = me && distanceMeters(branch.latitude, branch.longitude, me.latitude, me.longitude) < 20_000 ? { latitude: (branch.latitude + me.latitude) / 2, longitude: (branch.longitude + me.longitude) / 2 } : branch;
    const gap = me ? distanceMeters(branch.latitude, branch.longitude, me.latitude, me.longitude) : 0;
    const span = Math.max(radius * 2.8, Math.min(gap, 20_000) * 1.5 + 80, 160);
    const z = Math.max(3, Math.min(18, Math.floor(Math.log2((156543.03392 * Math.cos((center.latitude * Math.PI) / 180) * Math.min(width, height)) / span))));
    const origin = project(center.latitude, center.longitude, z);
    const left = origin.x - width / 2;
    const top = origin.y - height / 2;
    const tiles: { key: string; x: number; y: number; uri: string }[] = [];
    const max = 2 ** z;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx += 1)
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty += 1) {
        if (ty < 0 || ty >= max) continue;
        const wx = ((tx % max) + max) % max;
        const key = `${z}/${wx}/${ty}`;
        const template = failed.has(key) ? FALLBACK_URL : TILE_URL;
        tiles.push({ key, x: tx * TILE - left, y: ty * TILE - top, uri: template.replace("{z}", String(z)).replace("{x}", String(wx)).replace("{y}", String(ty)) });
      }
    const at = (p: MapCenter) => {
      const q = project(p.latitude, p.longitude, z);
      return { x: q.x - left, y: q.y - top };
    };
    const b = at(branch);
    const mpp = metersPerPixel(branch.latitude, z);
    const m = me ? at(me) : null;
    body = (
      <>
        {tiles.map((t) => (
          <Image
            key={t.key}
            source={{ uri: t.uri, headers: { "User-Agent": "StafforaMobile/1.0" }, cache: "force-cache" }}
            onError={() => setFailed((prev) => (prev.has(t.key) ? prev : new Set(prev).add(t.key)))}
            style={{ position: "absolute", left: t.x, top: t.y, width: TILE, height: TILE, opacity: dark ? 0.75 : 1 }}
          />
        ))}
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Circle cx={b.x} cy={b.y} r={Math.max(6, radius / mpp)} fill={`${c.accent}22`} stroke={c.accent} strokeWidth={2} />
          {m && me?.accuracy ? <Circle cx={m.x} cy={m.y} r={Math.min(200, me.accuracy / mpp)} fill="rgba(52,199,89,0.14)" /> : null}
          {m ? <Circle cx={m.x} cy={m.y} r={8} fill="#34C759" stroke="#fff" strokeWidth={3} /> : null}
        </Svg>
        <View style={[st.pin, { left: b.x - 15, top: b.y - 34, backgroundColor: c.accent }]}>
          <Icon name="business" size={15} color="#fff" />
        </View>
      </>
    );
  }
  return (
    <View onLayout={onLayout} style={[st.wrap, { height, backgroundColor: dark ? "#1b1f24" : "#e8ecef" }]}>
      {body}
      {children}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { borderRadius: 16, overflow: "hidden", position: "relative" },
  pin: { position: "absolute", width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 2.5, borderColor: "#fff" },
});
