import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { SERVER_ORIGIN, mediaUri } from "@/lib/config";
import { useTheme } from "@/lib/theme";
import { Icon, haptic } from "./ui";

/*
 * Interaktiv xarita (Mini App’dagi TileMap bilan bir xil): OSM plitkalari (o‘z serverimiz orqali),
 * barmoq bilan surish, ikki barmoq bilan kattalashtirish, +/− tugmalari, filial doiralari va
 * xodimlarning rasmli pinlari. Google/Apple Maps kaliti kerak emas.
 */

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  kind: "person" | "branch" | "me";
  label: string;
  initials?: string;
  photo?: string;
  tone: "ok" | "warn" | "bad" | "info" | "muted";
  badge?: string;
};
export type MapCircle = { id: string; lat: number; lng: number; radius: number };

const TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL || `${SERVER_ORIGIN}/api/tiles/{z}/{x}/{y}.png`;
const FALLBACK_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE = 256;
const MIN_Z = 3;
const MAX_Z = 19;
const clampZ = (z: number) => Math.max(MIN_Z, Math.min(MAX_Z, z));

function project(lat: number, lng: number, z: number) {
  const size = TILE * 2 ** z;
  const sin = Math.min(0.9999, Math.max(-0.9999, Math.sin((lat * Math.PI) / 180)));
  return { x: ((lng + 180) / 360) * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
}
function unproject(x: number, y: number, z: number) {
  const size = TILE * 2 ** z;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng: (x / size) * 360 - 180 };
}
const metersPerPixel = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** Shu masofadan (px) yaqin xodim pinlari bitta guruhga birlashadi. */
const CLUSTER_PX = 42;
const TONE_RANK: Record<MapPoint["tone"], number> = { bad: 4, warn: 3, muted: 2, info: 1, ok: 0 };

/** Ochilgan guruh: 7 tagacha — aylana bo‘ylab, ko‘p bo‘lsa — spiral. Qo‘shnilar orasi ≥ ~60px. */
function spiderOffsets(count: number) {
  if (count <= 7) {
    const radius = Math.max(38, 30 / Math.sin(Math.PI / Math.max(2, count)));
    const start = count === 2 ? Math.PI : -Math.PI / 2;
    return Array.from({ length: count }, (_, i) => {
      const angle = start + (i * 2 * Math.PI) / count;
      return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
    });
  }
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const r = 34 * Math.sqrt(i + 1);
    return { dx: Math.cos(i * golden) * r, dy: Math.sin(i * golden) * r };
  });
}

function fitView(points: { lat: number; lng: number; radius?: number }[], width: number, height: number) {
  if (!points.length) return { zoom: 12, center: { lat: 41.3111, lng: 69.2797 } };
  for (let z = 18; z >= MIN_Z; z -= 1) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      const { x, y } = project(p.lat, p.lng, z);
      const r = (p.radius || 0) / metersPerPixel(p.lat, z);
      minX = Math.min(minX, x - r);
      maxX = Math.max(maxX, x + r);
      minY = Math.min(minY, y - r);
      maxY = Math.max(maxY, y + r);
    }
    if (maxX - minX <= width - 60 && maxY - minY <= height - 80) return { zoom: z, center: unproject((minX + maxX) / 2, (minY + maxY) / 2, z) };
  }
  return { zoom: MIN_Z, center: { lat: points[0].lat, lng: points[0].lng } };
}

export function TileMap({
  points,
  circles = [],
  fitKey,
  height = 340,
  selectedId,
  onPick,
  children,
}: {
  points: MapPoint[];
  circles?: MapCircle[];
  /** O‘zgarganda — hammasi sig‘adigan holatga qaytadi. */
  fitKey: string;
  height?: number;
  selectedId?: string | null;
  onPick?: (point: MapPoint) => void;
  children?: ReactNode;
}) {
  const { c, dark } = useTheme();
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(14);
  const [center, setCenter] = useState({ lat: 41.3111, lng: 69.2797 });
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  // Ochilgan (yoyilgan) guruh — birinchi a’zosining id’si.
  const [expanded, setExpanded] = useState<string | null>(null);
  const state = useRef({ zoom, center });
  state.current = { zoom, center };
  const gesture = useRef<{ x: number; y: number; dist?: number; zoom: number; center: { lat: number; lng: number } } | null>(null);

  const targets = useMemo(() => [...points.map((p) => ({ lat: p.lat, lng: p.lng })), ...circles.map((ci) => ({ lat: ci.lat, lng: ci.lng, radius: ci.radius * 1.15 }))], [points, circles]);
  const fit = () => {
    if (!width) return;
    const view = fitView(targets, width, height);
    setZoom(view.zoom);
    setCenter(view.center);
    setExpanded(null);
  };
  useEffect(fit, [fitKey, width]); // eslint-disable-line react-hooks/exhaustive-deps

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4 || g.numberActiveTouches > 1,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const t = e.nativeEvent.touches;
          gesture.current = {
            x: t[0]?.pageX || 0,
            y: t[0]?.pageY || 0,
            dist: t.length > 1 ? Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY) : undefined,
            zoom: state.current.zoom,
            center: state.current.center,
          };
        },
        onPanResponderMove: (e) => {
          const g = gesture.current;
          const t = e.nativeEvent.touches;
          if (!g || !t.length) return;
          if (t.length > 1) {
            const dist = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
            if (!g.dist) g.dist = dist;
            const next = clampZ(Math.round(g.zoom + Math.log2(dist / g.dist)));
            if (next !== state.current.zoom) setZoom(next);
            return;
          }
          const z = state.current.zoom;
          const start = project(g.center.lat, g.center.lng, z);
          const p = unproject(start.x - (t[0].pageX - g.x), start.y - (t[0].pageY - g.y), z);
          setCenter(p);
        },
        onPanResponderRelease: () => {
          gesture.current = null;
        },
      }),
    [],
  );

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const zoomBy = (d: number) => {
    haptic.select();
    setZoom((z) => clampZ(z + d));
  };

  let body: ReactNode = null;
  if (width) {
    const o = project(center.lat, center.lng, zoom);
    const left = o.x - width / 2;
    const top = o.y - height / 2;
    const max = 2 ** zoom;
    const tiles: { key: string; x: number; y: number; uri: string }[] = [];
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx += 1)
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty += 1) {
        if (ty < 0 || ty >= max) continue;
        const wx = ((tx % max) + max) % max;
        const key = `${zoom}/${wx}/${ty}`;
        const template = failed.has(key) ? FALLBACK_URL : TILE_URL;
        tiles.push({ key, x: tx * TILE - left, y: ty * TILE - top, uri: template.replace("{z}", String(zoom)).replace("{x}", String(wx)).replace("{y}", String(ty)) });
      }
    const at = (lat: number, lng: number) => {
      const q = project(lat, lng, zoom);
      return { x: q.x - left, y: q.y - top };
    };
    const tone = (t: MapPoint["tone"]) => ({ ok: c.success, warn: c.warn, bad: c.danger, info: c.accent, muted: c.muted })[t];
    // Bir joyda belgilaganlar ustma-ust tushmasin: yaqin xodimlar guruhga birlashadi;
    // guruh bosilsa (yoki ichidagi xodim tanlansa) — atrofga yoyiladi, haqiqiy joyga chiziq bilan.
    const singles: { pt: MapPoint; x: number; y: number; hub?: { x: number; y: number } }[] = [];
    const groups: { x: number; y: number; members: MapPoint[] }[] = [];
    for (const pt of points) {
      const p = at(pt.lat, pt.lng);
      if (pt.kind !== "person") {
        singles.push({ pt, ...p });
        continue;
      }
      const near = groups.find((g) => Math.hypot(g.x - p.x, g.y - p.y) < CLUSTER_PX);
      if (!near) {
        groups.push({ x: p.x, y: p.y, members: [pt] });
        continue;
      }
      const n = near.members.push(pt);
      near.x += (p.x - near.x) / n;
      near.y += (p.y - near.y) / n;
    }
    const clusters: { key: string; x: number; y: number; members: MapPoint[]; tone: MapPoint["tone"] }[] = [];
    for (const g of groups) {
      if (g.members.length === 1) singles.push({ pt: g.members[0], x: g.x, y: g.y });
      else if (g.members.some((m) => m.id === expanded || m.id === selectedId)) {
        const offsets = spiderOffsets(g.members.length);
        g.members.forEach((m, i) => singles.push({ pt: m, x: g.x + offsets[i].dx, y: g.y + offsets[i].dy, hub: { x: g.x, y: g.y } }));
      } else
        clusters.push({
          key: g.members[0].id,
          x: g.x,
          y: g.y,
          members: g.members,
          tone: g.members.reduce((worst, m) => (TONE_RANK[m.tone] > TONE_RANK[worst] ? m.tone : worst), g.members[0].tone),
        });
    }
    const hubs = [...new Map(singles.filter((x) => x.hub).map((x) => [`${Math.round(x.hub!.x)}:${Math.round(x.hub!.y)}`, x.hub!])).values()];
    body = (
      <>
        {/* Bo‘sh joyga bosish — ochilgan guruhni yopadi */}
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setExpanded(null)} accessible={false}>
          {tiles.map((t) => (
            <Image
              key={t.key}
              source={{ uri: t.uri, headers: { "User-Agent": "StafforaMobile/1.0" }, cache: "force-cache" }}
              onError={() => setFailed((prev) => (prev.has(t.key) ? prev : new Set(prev).add(t.key)))}
              style={{ position: "absolute", left: t.x, top: t.y, width: TILE, height: TILE, opacity: dark ? 0.72 : 1 }}
            />
          ))}
        </Pressable>
        <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
          {circles.map((ci) => {
            const p = at(ci.lat, ci.lng);
            return <Circle key={ci.id} cx={p.x} cy={p.y} r={Math.max(6, ci.radius / metersPerPixel(ci.lat, zoom))} fill={`${c.accent}1F`} stroke={c.accent} strokeWidth={1.5} />;
          })}
          {singles
            .filter((x) => x.hub)
            .map((x) => (
              <Line key={`spoke-${x.pt.id}`} x1={x.hub!.x} y1={x.hub!.y} x2={x.x} y2={x.y} stroke={c.ink} strokeOpacity={0.45} strokeWidth={1.5} />
            ))}
          {hubs.map((h) => (
            <Circle key={`hub-${h.x}:${h.y}`} cx={h.x} cy={h.y} r={4} fill={c.ink} fillOpacity={0.7} stroke={c.card} strokeWidth={2} />
          ))}
        </Svg>
        {singles.map(({ pt, x, y, hub }) => {
          const p = { x, y };
          if (p.x < -40 || p.y < -40 || p.x > width + 40 || p.y > height + 40) return null;
          const color = tone(pt.tone);
          const selected = selectedId === pt.id;
          if (pt.kind === "me")
            return <View key={pt.id} pointerEvents="none" style={[st.me, { left: p.x - 9, top: p.y - 9 }]} />;
          if (pt.kind === "branch")
            return (
              <Pressable key={pt.id} onPress={() => onPick?.(pt)} style={[st.branchPin, { left: p.x - 17, top: p.y - 40 }]} hitSlop={8}>
                <View style={[st.branchHead, { backgroundColor: color }]}>
                  <Icon name="business" size={15} color="#fff" />
                </View>
                {pt.badge ? (
                  <View style={[st.badge, { backgroundColor: c.card }]}>
                    <Text style={{ color: c.ink, fontSize: 11, fontWeight: "700" }}>{pt.badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          return (
            <View key={pt.id} style={{ position: "absolute", left: p.x - 18, top: p.y - 18, alignItems: "center", width: 36, zIndex: hub || selected ? 3 : 1 }}>
              <Pressable onPress={() => onPick?.(pt)} hitSlop={6} style={[st.person, { borderColor: color, transform: [{ scale: selected ? 1.18 : 1 }] }]}>
                {pt.photo ? (
                  <Image source={{ uri: mediaUri(pt.photo) }} style={st.personImg} />
                ) : (
                  <View style={[st.personImg, { backgroundColor: c.card, alignItems: "center", justifyContent: "center" }]}>
                    <Text style={{ color: c.ink, fontSize: 11, fontWeight: "700" }}>{pt.initials}</Text>
                  </View>
                )}
              </Pressable>
              {hub || selected ? (
                <View pointerEvents="none" style={[st.label, { backgroundColor: c.card }]}>
                  <Text style={{ color: c.ink, fontSize: 11, fontWeight: "600" }} numberOfLines={1}>
                    {pt.label}
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })}
        {clusters.map((g) => {
          if (g.x < -60 || g.y < -60 || g.x > width + 60 || g.y > height + 60) return null;
          const faces = g.members.slice(0, 3);
          const w = 32 + (faces.length - 1) * 16;
          return (
            <Pressable
              key={`cluster-${g.key}`}
              onPress={() => {
                haptic.select();
                setExpanded(g.key);
              }}
              hitSlop={8}
              accessibilityLabel={`${g.members.length} xodim`}
              style={{ position: "absolute", left: g.x - w / 2, top: g.y - 16, width: w, height: 32, zIndex: 2 }}
            >
              {faces.map((m, i) => (
                <View key={m.id} style={[st.stackFace, { left: i * 16, zIndex: faces.length - i, borderColor: tone(m.tone === "info" ? "ok" : m.tone) }]}>
                  {m.photo ? (
                    <Image source={{ uri: mediaUri(m.photo) }} style={st.personImg} />
                  ) : (
                    <View style={[st.personImg, { backgroundColor: c.card, alignItems: "center", justifyContent: "center" }]}>
                      <Text style={{ color: c.ink, fontSize: 10, fontWeight: "700" }}>{m.initials}</Text>
                    </View>
                  )}
                </View>
              ))}
              <View style={[st.count, { backgroundColor: c.ink, borderColor: c.card }]}>
                <Text style={{ color: c.card, fontSize: 11, fontWeight: "700" }}>{g.members.length}</Text>
              </View>
            </Pressable>
          );
        })}
      </>
    );
  }
  return (
    <View onLayout={onLayout} style={[st.wrap, { height, backgroundColor: dark ? "#1b1f24" : "#e8ecef" }]} {...responder.panHandlers}>
      {body}
      <View style={st.controls}>
        <Ctl icon="add" onPress={() => zoomBy(1)} />
        <Ctl icon="remove" onPress={() => zoomBy(-1)} />
        <Ctl icon="scan-outline" onPress={() => (haptic.select(), fit())} />
      </View>
      <Text style={[st.attribution, { color: c.muted }]}>© OpenStreetMap</Text>
      {children}
    </View>
  );
}

function Ctl({ icon, onPress }: { icon: "add" | "remove" | "scan-outline"; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={4} style={({ pressed }) => [st.ctl, { backgroundColor: c.card, opacity: pressed ? 0.6 : 1 }]}>
      <Icon name={icon} size={18} color={c.ink} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  wrap: { borderRadius: 16, overflow: "hidden", position: "relative" },
  controls: { position: "absolute", right: 10, top: 10, gap: 6 },
  ctl: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  attribution: { position: "absolute", left: 8, bottom: 4, fontSize: 9.5 },
  me: { position: "absolute", width: 18, height: 18, borderRadius: 9, backgroundColor: "#34C759", borderWidth: 3, borderColor: "#fff" },
  branchPin: { position: "absolute", alignItems: "center", width: 34 },
  branchHead: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 2.5, borderColor: "#fff" },
  badge: { marginTop: 2, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, minWidth: 34, alignItems: "center" },
  person: { width: 36, height: 36, borderRadius: 18, borderWidth: 2.5, overflow: "hidden", backgroundColor: "#fff" },
  label: { marginTop: 3, maxWidth: 96, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, alignSelf: "center", minWidth: 36, alignItems: "center" },
  stackFace: { position: "absolute", top: 0, width: 32, height: 32, borderRadius: 16, borderWidth: 2.5, overflow: "hidden", backgroundColor: "#fff" },
  count: { position: "absolute", top: -8, right: -10, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  personImg: { width: "100%", height: "100%" },
});
