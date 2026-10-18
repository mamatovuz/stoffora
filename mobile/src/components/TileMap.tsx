import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, Modal, PanResponder, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { Text } from "@/components/T";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line } from "react-native-svg";
import { SERVER_ORIGIN, mediaUri } from "@/lib/config";
import { useTheme } from "@/lib/theme";
import { Icon, haptic, type IconName } from "./ui";

/*
 * Interaktiv xarita — Mini App’dagi TileMap bilan bir xil imkoniyatlar:
 *   • OSM plitkalari (o‘z serverimiz orqali, xato bo‘lsa — to‘g‘ridan OSM);
 *   • surish, ikki barmoq bilan (barmoqlar o‘rtasiga) kattalashtirish, ikki marta bosib yaqinlashtirish;
 *   • +/− · hammasini ko‘rsatish · to‘liq ekran;
 *   • filial radiusi (shtrixli doira), filial pini (keldi/kutilgan belgisi bilan);
 *   • xodim pinlari (rasm, holat rangi), yaqinlashganda — ismlar; tanlangan pin kattaroq;
 *   • bir joyda turganlar — guruh pini (rasmlar va son), bosilsa atrofga yoyiladi;
 *   • bo‘sh joyga bosish — tanlovni bekor qiladi.
 * Google/Apple Maps kaliti kerak emas.
 */

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  /** person — xodim (rasm), branch — filial, me — «siz shu yerdasiz». */
  kind: "person" | "branch" | "me";
  label: string;
  initials?: string;
  photo?: string;
  tone: "ok" | "warn" | "bad" | "info" | "muted";
  /** Filial pinidagi kichik belgi (masalan «12/15»). */
  badge?: string;
};
export type MapCircle = { id: string; lat: number; lng: number; radius: number };

type Props = {
  points: MapPoint[];
  circles?: MapCircle[];
  /** O‘zgarganda — hammasi sig‘adigan holatga qaytadi. */
  fitKey: string;
  height?: number;
  selectedId?: string | null;
  /** Pin bosilganda; bo‘sh joyga bosilganda — null. */
  onPick?: (point: MapPoint | null) => void;
  /** Xarita ustidagi qatlam (masalan tanlangan xodim kartochkasi). */
  children?: ReactNode;
  /** Ixcham (Face ID ekranidagi kichik xarita): to‘liq ekran tugmasi yo‘q. */
  compact?: boolean;
};

const TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL || `${SERVER_ORIGIN}/api/tiles/{z}/{x}/{y}.png`;
const FALLBACK_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE = 256;
const MIN_Z = 3;
const MAX_Z = 19;
const clampZ = (z: number) => Math.max(MIN_Z, Math.min(MAX_Z, z));
/** Shu zoom’dan boshlab xodim ismlari ko‘rinadi. */
const LABEL_ZOOM = 17;

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
    if (maxX - minX <= width - 60 && maxY - minY <= height - 90) return { zoom: z, center: unproject((minX + maxX) / 2, (minY + maxY) / 2, z) };
  }
  return { zoom: MIN_Z, center: { lat: points[0].lat, lng: points[0].lng } };
}

/** Xarita + (kerak bo‘lsa) to‘liq ekran oynasi — ikkalasi bir xil nuqta va tanlov bilan. */
export function TileMap(props: Props) {
  const [full, setFull] = useState(false);
  const { height: screenH } = useWindowDimensions();
  return (
    <>
      <MapCanvas {...props} onFull={props.compact ? undefined : () => setFull(true)} />
      {full ? (
        <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => setFull(false)}>
          <MapCanvas {...props} height={screenH} fullscreen onExitFull={() => setFull(false)} />
        </Modal>
      ) : null}
    </>
  );
}

function MapCanvas({
  points,
  circles = [],
  fitKey,
  height = 340,
  selectedId,
  onPick,
  children,
  compact,
  fullscreen,
  onFull,
  onExitFull,
}: Props & { fullscreen?: boolean; onFull?: () => void; onExitFull?: () => void }) {
  const { c, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(14);
  const [center, setCenter] = useState({ lat: 41.3111, lng: 69.2797 });
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  // Ochilgan (yoyilgan) guruh — birinchi a’zosining id’si.
  const [expanded, setExpanded] = useState<string | null>(null);
  const state = useRef({ zoom, center, width, height });
  // Imo-ishora (PanResponder) har doim oxirgi holatni o‘qiydi.
  useLayoutEffect(() => {
    state.current = { zoom, center, width, height };
  });
  const gesture = useRef<{ x: number; y: number; dist?: number; mid?: { x: number; y: number }; zoom: number; center: { lat: number; lng: number } } | null>(null);
  const lastTap = useRef(0);
  // Xaritaning ekrandagi joyi: barmoq (pageX/Y) → xarita ichidagi nuqta. Touch qaysi bola
  // elementga (plitka, pin) tushganidan qat’i nazar, kattalashtirish aynan barmoq ostida bo‘ladi.
  const box = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const measure = () => box.current?.measureInWindow((x, y) => (origin.current = { x, y }));

  const targets = useMemo(() => [...points.map((p) => ({ lat: p.lat, lng: p.lng })), ...circles.map((ci) => ({ lat: ci.lat, lng: ci.lng, radius: ci.radius * 1.15 }))], [points, circles]);
  const fit = () => {
    if (!width) return;
    const view = fitView(targets, width, height);
    setZoom(view.zoom);
    setCenter(view.center);
    setExpanded(null);
  };
  useEffect(fit, [fitKey, width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  /** `anchor` (xarita ichidagi px) ostidagi nuqta joyida qolgan holda zoom o‘zgaradi. */
  const zoomAt = (next: number, anchor?: { x: number; y: number }, from = state.current) => {
    const target = clampZ(next);
    if (target === from.zoom) return;
    if (anchor) {
      const o = project(from.center.lat, from.center.lng, from.zoom);
      const world = { x: o.x - from.width / 2 + anchor.x, y: o.y - from.height / 2 + anchor.y };
      const geo = unproject(world.x, world.y, from.zoom);
      const p = project(geo.lat, geo.lng, target);
      setCenter(unproject(p.x - anchor.x + from.width / 2, p.y - anchor.y + from.height / 2, target));
    }
    setZoom(target);
    haptic.select();
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4 || g.numberActiveTouches > 1,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          measure();
          const t = e.nativeEvent.touches;
          const two = t.length > 1;
          gesture.current = {
            x: t[0]?.pageX || 0,
            y: t[0]?.pageY || 0,
            dist: two ? Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY) : undefined,
            mid: two ? { x: (t[0].pageX + t[1].pageX) / 2 - origin.current.x, y: (t[0].pageY + t[1].pageY) / 2 - origin.current.y } : undefined,
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
            if (!g.dist) {
              g.dist = dist;
              g.mid = { x: (t[0].pageX + t[1].pageX) / 2 - origin.current.x, y: (t[0].pageY + t[1].pageY) / 2 - origin.current.y };
            }
            const next = clampZ(Math.round(g.zoom + Math.log2(dist / g.dist)));
            if (next !== state.current.zoom) zoomAt(next, g.mid, { ...state.current, zoom: g.zoom, center: g.center });
            return;
          }
          const z = state.current.zoom;
          if (z !== g.zoom) {
            // Pinch’dan keyin bitta barmoq qolsa — yangi boshlang‘ich nuqtadan suriladi.
            g.zoom = z;
            g.center = state.current.center;
            g.x = t[0].pageX;
            g.y = t[0].pageY;
          }
          const start = project(g.center.lat, g.center.lng, z);
          setCenter(unproject(start.x - (t[0].pageX - g.x), start.y - (t[0].pageY - g.y), z));
        },
        onPanResponderRelease: () => {
          gesture.current = null;
        },
      }),
    [],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(Math.round(e.nativeEvent.layout.width));
    measure();
  };
  const tone = (t: MapPoint["tone"]) => ({ ok: c.success, warn: c.warn, bad: c.danger, info: c.accent, muted: c.muted })[t];

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
    // Bir joyda belgilaganlar ustma-ust tushmasin: yaqin xodimlar guruhga birlashadi;
    // guruh bosilsa (yoki ichidagi xodim tanlansa) — atrofga yoyiladi, haqiqiy joyga chiziq bilan.
    const singles: { pt: MapPoint; x: number; y: number; hub?: { x: number; y: number }; compactBranch?: boolean }[] = [];
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
    // Xodimlar aynan filial nuqtasida bo‘lsa — filial kichik markaz belgisi bo‘lib qoladi.
    for (const s of singles) if (s.pt.kind === "branch" && groups.some((g) => Math.hypot(g.x - s.x, g.y - s.y) < CLUSTER_PX)) s.compactBranch = true;
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
    const offscreen = (x: number, y: number, pad = 60) => x < -pad || y < -pad || x > width + pad || y > height + pad;
    body = (
      <>
        {/* Bo‘sh joyga bosish — tanlovni bekor qiladi; tez ikki marta — yaqinlashtiradi. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          accessible={false}
          onPressIn={measure}
          onPress={(e) => {
            const now = Date.now();
            if (now - lastTap.current < 300) {
              lastTap.current = 0;
              zoomAt(zoom + 1, { x: e.nativeEvent.pageX - origin.current.x, y: e.nativeEvent.pageY - origin.current.y });
              return;
            }
            lastTap.current = now;
            setExpanded(null);
            onPick?.(null);
          }}
        >
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
            const r = ci.radius / metersPerPixel(ci.lat, zoom);
            // Juda uzoqdan radius nuqtaday bo‘lib qoladi — chizmaymiz (pin o‘zi yetarli).
            if (r < 10) return null;
            return <Circle key={ci.id} cx={p.x} cy={p.y} r={r} fill={`${c.accent}22`} stroke={c.accent} strokeWidth={2} strokeDasharray="6 5" />;
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
        {singles.map(({ pt, x, y, hub, compactBranch }) => {
          if (offscreen(x, y)) return null;
          const color = tone(pt.tone);
          const selected = selectedId === pt.id;
          if (pt.kind === "me") return <View key={pt.id} pointerEvents="none" style={[st.me, { left: x - 9, top: y - 9 }]} />;
          if (pt.kind === "branch") {
            if (compactBranch)
              return (
                <Pressable key={pt.id} onPress={() => onPick?.(pt)} hitSlop={10} style={[st.branchDot, { left: x - 7, top: y - 7, backgroundColor: c.accent, borderColor: c.card }]} accessibilityLabel={pt.label} />
              );
            return (
              <Pressable key={pt.id} onPress={() => onPick?.(pt)} hitSlop={8} style={[st.branchPin, { left: x - 60, top: y - 20 }]} accessibilityLabel={pt.label}>
                <View style={[st.branchHead, { backgroundColor: color }]}>
                  <Icon name="business" size={18} color="#fff" />
                  {pt.badge ? (
                    <View style={[st.badge, { backgroundColor: c.card }]}>
                      <Text style={{ color: c.ink, fontSize: 11, fontWeight: "700" }}>{pt.badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Label text={pt.label} />
              </Pressable>
            );
          }
          const showLabel = Boolean(hub) || selected || zoom >= LABEL_ZOOM;
          return (
            <View key={pt.id} style={{ position: "absolute", left: x - 60, top: y - 19, width: 120, alignItems: "center", zIndex: selected ? 5 : hub ? 3 : 1 }} pointerEvents="box-none">
              <Pressable
                onPress={() => {
                  haptic.select();
                  onPick?.(pt);
                }}
                hitSlop={6}
                accessibilityLabel={pt.label}
                style={[
                  st.person,
                  { borderColor: color, borderWidth: selected ? 3.5 : 2.5, transform: [{ scale: selected ? 1.18 : 1 }] },
                  selected && { shadowColor: color, shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
                ]}
              >
                {pt.photo ? (
                  <Image source={{ uri: mediaUri(pt.photo) }} style={st.personImg} />
                ) : (
                  <View style={[st.personImg, { backgroundColor: c.card, alignItems: "center", justifyContent: "center" }]}>
                    <Text style={{ color: c.ink, fontSize: 12, fontWeight: "700" }}>{pt.initials}</Text>
                  </View>
                )}
              </Pressable>
              {showLabel ? <Label text={pt.label} /> : null}
            </View>
          );
        })}
        {clusters.map((g) => {
          if (offscreen(g.x, g.y)) return null;
          const faces = g.members.slice(0, 3);
          const w = 34 + (faces.length - 1) * 17;
          return (
            <Pressable
              key={`cluster-${g.key}`}
              onPress={() => {
                haptic.select();
                setExpanded(g.key);
              }}
              hitSlop={8}
              accessibilityLabel={`${g.members.length} xodim: ${g.members.map((m) => m.label).join(", ")}`}
              style={{ position: "absolute", left: g.x - w / 2, top: g.y - 17, width: w, height: 34, zIndex: 2 }}
            >
              {faces.map((m, i) => (
                <View key={m.id} style={[st.stackFace, { left: i * 17, zIndex: faces.length - i, borderColor: tone(m.tone === "info" ? "ok" : m.tone) }]}>
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

  const top = fullscreen ? insets.top + 10 : 10;
  return (
    <View
      ref={box}
      onLayout={onLayout}
      style={[st.wrap, { height, backgroundColor: dark ? "#1b1f24" : "#e8ecef" }, fullscreen && { borderRadius: 0 }]}
      {...responder.panHandlers}
    >
      {body}
      <View style={[st.controls, { top }, compact && { gap: 4 }]}>
        <Ctl icon="add" small={compact} onPress={() => zoomAt(zoom + 1)} disabled={zoom >= MAX_Z} label="Yaqinlashtirish" />
        <Ctl icon="remove" small={compact} onPress={() => zoomAt(zoom - 1)} disabled={zoom <= MIN_Z} label="Uzoqlashtirish" />
        <Ctl icon="locate-outline" small={compact} onPress={() => (haptic.select(), fit())} label="Hammasini ko‘rsatish" />
        {fullscreen ? (
          <Ctl icon="contract-outline" onPress={() => onExitFull?.()} label="Kichraytirish" />
        ) : onFull ? (
          <Ctl icon="expand-outline" onPress={onFull} label="To‘liq ekran" />
        ) : null}
      </View>
      {compact ? null : <Text style={[st.attribution, { color: c.muted, backgroundColor: `${c.card}CC`, bottom: fullscreen ? insets.bottom + 6 : 6 }]}>© OpenStreetMap</Text>}
      {fullscreen ? <View style={{ position: "absolute", left: 0, right: 0, top: insets.top, bottom: insets.bottom }} pointerEvents="box-none">{children}</View> : children}
    </View>
  );
}

function Label({ text }: { text: string }) {
  const { c } = useTheme();
  return (
    <View pointerEvents="none" style={[st.label, { backgroundColor: c.card }]}>
      <Text style={{ color: c.ink, fontSize: 11, fontWeight: "600" }} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function Ctl({ icon, onPress, disabled, label, small }: { icon: IconName; onPress: () => void; disabled?: boolean; label: string; small?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityLabel={label}
      style={({ pressed }) => [st.ctl, small && st.ctlSmall, { backgroundColor: c.card, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} size={small ? 16 : 18} color={c.ink} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  wrap: { borderRadius: 16, overflow: "hidden", position: "relative" },
  controls: { position: "absolute", right: 10, gap: 6, zIndex: 10 },
  ctl: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  ctlSmall: { width: 34, height: 34, borderRadius: 10 },
  attribution: { position: "absolute", left: 8, fontSize: 9.5, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, overflow: "hidden" },
  me: { position: "absolute", width: 18, height: 18, borderRadius: 9, backgroundColor: "#2563EB", borderWidth: 3, borderColor: "#fff", zIndex: 6 },
  branchPin: { position: "absolute", alignItems: "center", width: 120, zIndex: 1 },
  branchHead: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  branchDot: { position: "absolute", width: 14, height: 14, borderRadius: 4, borderWidth: 2, zIndex: 1 },
  badge: { position: "absolute", top: -9, right: -16, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 9, minWidth: 30, alignItems: "center" },
  person: { width: 38, height: 38, borderRadius: 19, overflow: "hidden", backgroundColor: "#fff" },
  personImg: { width: "100%", height: "100%" },
  label: { marginTop: 4, maxWidth: 110, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 9, alignSelf: "center", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  stackFace: { position: "absolute", top: 0, width: 34, height: 34, borderRadius: 17, borderWidth: 2.5, overflow: "hidden", backgroundColor: "#fff" },
  count: { position: "absolute", top: -8, right: -10, minWidth: 21, height: 21, paddingHorizontal: 5, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
