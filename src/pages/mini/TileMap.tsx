import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Building2, Layers, LocateFixed, Maximize2, Minimize2, Minus, Plus } from "lucide-react";

/*
 * Yengil xarita (kutubxonasiz): OpenStreetMap asosidagi CARTO plitkalari, Web Mercator.
 * Surish (barmoq/sichqoncha), kattalashtirish (tugmalar, ikki barmoq, g‘ildirak, ikki marta bosish),
 * radius doiralari va avatar-pinlar. Plitkalar yuklanmasa — to‘r fonida ishlashda davom etadi.
 */

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  /** person — xodim (avatar), branch — filial, me — «siz shu yerdasiz» (ko‘k nuqta). */
  kind: "person" | "branch" | "me";
  label: string;
  initials?: string;
  photo?: string;
  tone: "ok" | "warn" | "bad" | "info" | "muted";
  /** Pin ustidagi kichik yozuv (masalan, filialda «12/15»). */
  badge?: string;
  /** GPS aniqligi (m) — tanlanganda doira bo‘lib ko‘rinadi. */
  accuracy?: number;
};
export type MapCircle = { id: string; lat: number; lng: number; radius: number; tone?: "accent" | "warn" };

const TILE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;
const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

function project(lat: number, lng: number, z: number) {
  const size = TILE * 2 ** z;
  const sin = Math.min(0.9999, Math.max(-0.9999, Math.sin((lat * Math.PI) / 180)));
  return { x: ((lng + 180) / 360) * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
}
function unproject(x: number, y: number, z: number) {
  const size = TILE * 2 ** z;
  const lng = (x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng };
}
const metersPerPixel = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** Shu masofadan (px) yaqin xodim pinlari bitta guruhga birlashadi (avatar 38px + yozuv). */
const CLUSTER_PX = 44;
const TONE_RANK: Record<MapPoint["tone"], number> = { bad: 4, warn: 3, muted: 2, info: 1, ok: 0 };

/**
 * Guruh ochilganda a’zolar markaz atrofida joylashadi: 7 tagacha — aylana bo‘ylab,
 * ko‘p bo‘lsa — kungaboqar spirali. Qo‘shnilar orasi ≥ ~64px — rasm va ism bir-birini yopmaydi.
 */
export function spiderOffsets(count: number) {
  if (count <= 7) {
    const radius = Math.max(40, 32 / Math.sin(Math.PI / Math.max(2, count)));
    // 2 kishi — chap/o‘ng; ko‘proq — tepadan boshlab soat yo‘nalishida.
    const start = count === 2 ? Math.PI : -Math.PI / 2;
    return Array.from({ length: count }, (_, i) => {
      const angle = start + (i * 2 * Math.PI) / count;
      return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
    });
  }
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const r = 36 * Math.sqrt(i + 1);
    return { dx: Math.cos(i * golden) * r, dy: Math.sin(i * golden) * r };
  });
}

type Placed = { point: MapPoint; x: number; y: number; spoke?: { x: number; y: number }; compact?: boolean };
type Cluster = { key: string; x: number; y: number; members: MapPoint[]; tone: MapPoint["tone"] };

/**
 * Xarita mavzusi ilovaning haqiqiy fon rangiga qarab tanlanadi (Telegram mavzusi, foydalanuvchi
 * tanlovi). Tizim mavzusiga qaralmaydi — aks holda yorug‘ ilovada qorong‘i xarita chiqardi.
 */
function isDark() {
  const root = document.documentElement;
  if (root.dataset.miniTheme === "dark") return true;
  if (root.dataset.miniTheme === "light") return false;
  const bg = getComputedStyle(document.querySelector(".mini") || document.body).backgroundColor;
  const [r, g, b] = (bg.match(/\d+(\.\d+)?/g) || ["255", "255", "255"]).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
}
/**
 * Plitka manbai: standart — OpenStreetMap (kalitsiz, atributsiya bilan). Ko‘p foydalanuvchili
 * ishlab chiqarishda o‘z xizmatingizni ulang: VITE_MAP_TILE_URL="https://…/{z}/{x}/{y}.png?key=…"
 * (serverda MAP_TILE_ORIGIN ham berilsin — CSP ruxsati uchun). Tungi mavzu CSS filtri bilan.
 */
// Standart — o‘z serverimiz orqali (keshlangan OSM): Telegram ichida ham, sekin tarmoqda ham ishonchli.
const TILE_TEMPLATE = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) || "/api/tiles/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined) || "© OpenStreetMap";
/** Ixtiyoriy sputnik qatlami (masalan MapTiler satellite) — berilsa, qatlam tugmasi chiqadi. */
const SATELLITE_TEMPLATE = import.meta.env.VITE_MAP_TILE_URL_SATELLITE as string | undefined;
const fill = (template: string, z: number, x: number, y: number) => template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
const tileUrl = (z: number, x: number, y: number, satellite = false) => fill(satellite && SATELLITE_TEMPLATE ? SATELLITE_TEMPLATE : TILE_TEMPLATE, z, x, y);

/** Barcha nuqta va doiralarni sig‘diradigan zoom va markaz. */
function fitView(points: { lat: number; lng: number; radius?: number }[], width: number, height: number) {
  if (!points.length) return { zoom: 12, center: { lat: 41.3111, lng: 69.2797 } };
  let best = MIN_ZOOM;
  for (let z = 18; z >= MIN_ZOOM; z -= 1) {
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
    if (maxX - minX <= width - 70 && maxY - minY <= height - 90) {
      best = z;
      const center = unproject((minX + maxX) / 2, (minY + maxY) / 2, z);
      return { zoom: best, center };
    }
  }
  const p = points[0];
  return { zoom: best, center: { lat: p.lat, lng: p.lng } };
}

export function TileMap({
  points,
  circles = [],
  selectedId,
  onPick,
  fitKey,
  height = 360,
  compact = false,
  children,
}: {
  points: MapPoint[];
  circles?: MapCircle[];
  selectedId?: string | null;
  onPick?: (point: MapPoint | null) => void;
  /** O‘zgarganda xarita hammasini sig‘diradigan holatga qaytadi. */
  fitKey: string;
  height?: number;
  /** Ixcham boshqaruv (Face ID ekranidagi kichik xarita uchun). */
  compact?: boolean;
  children?: ReactNode;
}) {
  const [full, setFull] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [viewportH, setViewportH] = useState(() => window.innerHeight);
  useEffect(() => {
    if (!full) return;
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [full]);
  const outerHeight = height;
  // eslint-disable-next-line no-param-reassign
  height = full ? viewportH : outerHeight;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [zoom, setZoom] = useState(15);
  const [center, setCenter] = useState({ lat: 41.3111, lng: 69.2797 });
  const [failed, setFailed] = useState(false);
  const [dark, setDark] = useState(isDark);
  // Ochilgan (yoyilgan) guruh — uning birinchi a’zosining id’si.
  const [expanded, setExpanded] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; center: { x: number; y: number }; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))));
    observer.observe(element);
    // Mavzu o‘zgarishi (ilova sozlamasi yoki Telegram) — CSS yangilangach qayta o‘lchaymiz.
    const onTheme = () => window.setTimeout(() => setDark(isDark()), 50);
    window.addEventListener("staffora:mini-theme", onTheme);
    window.Telegram?.WebApp?.onEvent?.("themeChanged", onTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener("staffora:mini-theme", onTheme);
      window.Telegram?.WebApp?.offEvent?.("themeChanged", onTheme);
    };
  }, []);

  const fitTargets = useMemo(
    () => [...points.map((p) => ({ lat: p.lat, lng: p.lng })), ...circles.map((c) => ({ lat: c.lat, lng: c.lng, radius: c.radius * 1.15 }))],
    [points, circles],
  );
  const fit = useCallback(() => {
    const view = fitView(fitTargets, width, height);
    setZoom(view.zoom);
    setCenter(view.center);
    setExpanded(null);
  }, [fitTargets, width, height]);
  // Filial yoki filtr o‘zgarganda — hammasini ko‘rsatamiz (har 60 soniyalik yangilanishda emas).
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, width]);

  const c = project(center.lat, center.lng, zoom);
  const origin = { x: c.x - width / 2, y: c.y - height / 2 };
  const toScreen = (lat: number, lng: number) => {
    const p = project(lat, lng, zoom);
    return { x: p.x - origin.x, y: p.y - origin.y };
  };

  // Ko‘rinadigan plitkalar.
  const tiles = useMemo(() => {
    const count = 2 ** zoom;
    const list: { key: string; left: number; top: number; src: string }[] = [];
    const x0 = Math.floor(origin.x / TILE);
    const y0 = Math.floor(origin.y / TILE);
    const x1 = Math.floor((origin.x + width) / TILE);
    const y1 = Math.floor((origin.y + height) / TILE);
    for (let ty = y0; ty <= y1; ty += 1) {
      if (ty < 0 || ty >= count) continue;
      for (let tx = x0; tx <= x1; tx += 1) {
        const wrapped = ((tx % count) + count) % count;
        list.push({ key: `${satellite ? "s" : "m"}${zoom}/${tx}/${ty}`, left: tx * TILE - origin.x, top: ty * TILE - origin.y, src: tileUrl(zoom, wrapped, ty, satellite) });
      }
    }
    return list;
  }, [zoom, origin.x, origin.y, width, height, satellite]);

  // Bitta plitka yuklanmasa (chekka, vaqtincha xato) — xarita ishlashda davom etadi.
  // Faqat birorta ham plitka yuklanmay, bir nechtasi xato bersa — «sxema» rejimi.
  const tileStats = useRef({ ok: 0, bad: 0 });
  const onTileError = () => {
    tileStats.current.bad += 1;
    if (tileStats.current.ok === 0 && tileStats.current.bad >= 4) setFailed(true);
  };

  const zoomTo = (next: number, anchor?: { x: number; y: number }) => {
    const target = clampZoom(next);
    if (target === zoom) return;
    if (anchor) {
      // Barmoq/sichqoncha ostidagi nuqta joyida qoladi.
      const world = { x: origin.x + anchor.x, y: origin.y + anchor.y };
      const geo = unproject(world.x, world.y, zoom);
      const p = project(geo.lat, geo.lng, target);
      setCenter(unproject(p.x - anchor.x + width / 2, p.y - anchor.y + height / 2, target));
    }
    setZoom(target);
    window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
  };

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const onPointerDown = (event: React.PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    if (pointers.current.size === 1) drag.current = { ...local(event), center: { ...c }, moved: false };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
      drag.current = null;
    }
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, local(event));
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = distance / pinch.current;
      if (ratio > 1.35 || ratio < 0.74) {
        zoomTo(zoom + (ratio > 1 ? 1 : -1), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        pinch.current = distance;
      }
      return;
    }
    const start = drag.current;
    if (!start) return;
    const p = local(event);
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
    if (start.moved) setCenter(unproject(start.center.x - dx, start.center.y - dy, zoom));
  };
  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const start = drag.current;
    if (pointers.current.size === 0) {
      drag.current = null;
      // Bo‘sh joyga oddiy bosish — tanlovni olib tashlaydi va ochilgan guruhni yopadi.
      if (start && !start.moved && (event.target as HTMLElement).classList.contains("tm-hit")) {
        setExpanded(null);
        onPick?.(null);
      }
    }
  };

  // Bir joyda belgilagan xodimlar ustma-ust tushmasligi uchun: yaqin pinlar guruhga birlashadi.
  // Yopiq guruh — bitta pin (2–3 ta rasm va son); bosilsa yoki ichidagi xodim tanlansa —
  // a’zolar atrofga yoyiladi (har biri ismi bilan, haqiqiy joyga ingichka chiziq bilan).
  const { placed, clusters } = useMemo(() => {
    const placed: Placed[] = [];
    const groups: { x: number; y: number; members: MapPoint[] }[] = [];
    for (const p of points) {
      const s = toScreen(p.lat, p.lng);
      if (p.kind !== "person") {
        placed.push({ point: p, ...s });
        continue;
      }
      const near = groups.find((g) => Math.hypot(g.x - s.x, g.y - s.y) < CLUSTER_PX);
      if (!near) {
        groups.push({ x: s.x, y: s.y, members: [p] });
        continue;
      }
      const n = near.members.push(p);
      near.x += (s.x - near.x) / n;
      near.y += (s.y - near.y) / n;
    }
    // Xodimlar aynan filial nuqtasida belgilagan bo‘lsa — filial katta pin emas, kichik markaz nuqtasi
    // bo‘lib qoladi (aks holda xodimlar ostidan chiqib, yozuvlar ustma-ust tushadi).
    for (const p of placed)
      if (p.point.kind === "branch" && groups.some((g) => Math.hypot(g.x - p.x, g.y - p.y) < CLUSTER_PX)) p.compact = true;
    const clusters: Cluster[] = [];
    for (const g of groups) {
      if (g.members.length === 1) {
        placed.push({ point: g.members[0], x: g.x, y: g.y });
        continue;
      }
      const open = g.members.some((m) => m.id === expanded || m.id === selectedId);
      if (open) {
        const offsets = spiderOffsets(g.members.length);
        g.members.forEach((m, i) => placed.push({ point: m, x: g.x + offsets[i].dx, y: g.y + offsets[i].dy, spoke: { x: g.x, y: g.y } }));
        continue;
      }
      const tone = g.members.reduce((worst, m) => (TONE_RANK[m.tone] > TONE_RANK[worst] ? m.tone : worst), g.members[0].tone);
      clusters.push({ key: g.members[0].id, x: g.x, y: g.y, members: g.members, tone });
    }
    return { placed, clusters };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, zoom, origin.x, origin.y, expanded, selectedId]);
  const selected = placed.find((p) => p.point.id === selectedId);
  const showLabels = zoom >= 17;

  return (
    <div
      ref={box}
      className={`tm ${failed ? "tm-nomap" : ""} ${dark && !satellite ? "tm-dark" : ""} ${full ? "tm-full" : ""} ${compact ? "tm-compact" : ""}`}
      style={{ height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={(event) => zoomTo(zoom + (event.deltaY < 0 ? 1 : -1), local(event))}
      onDoubleClick={(event) => zoomTo(zoom + 1, local(event))}
    >
      <div className="tm-tiles tm-hit">
        {!failed &&
          tiles.map((t) => (
            <img
              key={t.key}
              src={t.src}
              alt=""
              draggable={false}
              className="tm-hit"
              style={{ left: t.left, top: t.top }}
              onError={onTileError}
              onLoad={(e) => {
                tileStats.current.ok += 1;
                e.currentTarget.classList.add("on");
              }}
            />
          ))}
      </div>
      <svg className="tm-overlay" width={width} height={height} aria-hidden>
        {circles.map((circle) => {
          const s = toScreen(circle.lat, circle.lng);
          const r = circle.radius / metersPerPixel(circle.lat, zoom);
          // Juda uzoq masshtabda radius nuqtaday bo‘lib qoladi — chizmaymiz (pin o‘zi yetarli).
          if (r < 10) return null;
          return <circle key={circle.id} cx={s.x} cy={s.y} r={r} className={`tm-zone ${circle.tone || "accent"}`} />;
        })}
        {/* Yoyilgan guruh: har bir xodimdan haqiqiy belgilagan joyiga chiziq */}
        {placed
          .filter((p) => p.spoke)
          .map((p) => (
            <line key={`spoke-${p.point.id}`} x1={p.spoke!.x} y1={p.spoke!.y} x2={p.x} y2={p.y} className="tm-spoke" />
          ))}
        {[...new Set(placed.filter((p) => p.spoke).map((p) => `${Math.round(p.spoke!.x)}:${Math.round(p.spoke!.y)}`))].map((key) => {
          const [cx, cy] = key.split(":").map(Number);
          return <circle key={`hub-${key}`} cx={cx} cy={cy} r={4} className="tm-hub" />;
        })}
        {selected?.point.accuracy ? (
          <circle cx={selected.x} cy={selected.y} r={Math.max(6, selected.point.accuracy / metersPerPixel(selected.point.lat, zoom))} className="tm-accuracy" />
        ) : null}
        {/* «Siz shu yerdasiz» — GPS aniqlik doirasi doim ko‘rinadi */}
        {placed
          .filter((p) => p.point.kind === "me" && p.point.accuracy)
          .map((p) => (
            <circle key={`acc-${p.point.id}`} cx={p.x} cy={p.y} r={Math.max(8, p.point.accuracy! / metersPerPixel(p.point.lat, zoom))} className="tm-accuracy me" />
          ))}
      </svg>
      {placed.map(({ point, x, y, spoke, compact }) =>
        x < -40 || y < -40 || x > width + 40 || y > height + 40 ? null : (
          <button
            key={point.id}
            className={`tm-pin ${point.kind} ${point.tone} ${point.id === selectedId ? "on" : ""} ${spoke ? "spread" : ""} ${compact ? "compact" : ""}`}
            title={compact ? point.label : undefined}
            style={{ transform: `translate(${x}px, ${y}px)` }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
              onPick?.(point);
            }}
            aria-label={point.label}
          >
            {point.kind === "me" ? (
              <span className="tm-me" />
            ) : point.kind === "branch" && compact ? (
              <span className="tm-branch-dot" />
            ) : point.kind === "branch" ? (
              <span className="tm-branch-head">
                <Building2 size={16} />
                {point.badge && <em>{point.badge}</em>}
              </span>
            ) : (
              <span className="tm-avatar">{point.photo ? <img src={point.photo} alt="" draggable={false} /> : point.initials}</span>
            )}
            {!compact && (showLabels || spoke || point.kind === "branch" || point.id === selectedId) && <small>{point.label}</small>}
          </button>
        ),
      )}
      {clusters.map((cluster) => {
        const { x, y, members } = cluster;
        if (x < -60 || y < -60 || x > width + 60 || y > height + 60) return null;
        const faces = members.slice(0, 3);
        const stackWidth = 34 + (faces.length - 1) * 18;
        return (
          <button
            key={`cluster-${cluster.key}`}
            className={`tm-pin tm-cluster ${cluster.tone}`}
            style={{ transform: `translate(${x}px, ${y}px)`, marginLeft: -stackWidth / 2 }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
              setExpanded(cluster.key);
            }}
            aria-label={`${members.length} xodim: ${members.map((m) => m.label).join(", ")}`}
            title={members.map((m) => m.label).join(", ")}
          >
            <span className="tm-stack" style={{ width: stackWidth }}>
              {faces.map((m, i) => (
                <span key={m.id} className={`tm-avatar sm ${m.tone}`} style={{ left: i * 18, zIndex: faces.length - i }}>
                  {m.photo ? <img src={m.photo} alt="" draggable={false} /> : m.initials}
                </span>
              ))}
              <em>{members.length}</em>
            </span>
            <small>{members.length} xodim</small>
          </button>
        );
      })}
      <div className="tm-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button onClick={() => zoomTo(zoom + 1)} aria-label="Yaqinlashtirish" disabled={zoom >= MAX_ZOOM}>
          <Plus size={18} />
        </button>
        <button onClick={() => zoomTo(zoom - 1)} aria-label="Uzoqlashtirish" disabled={zoom <= MIN_ZOOM}>
          <Minus size={18} />
        </button>
        <button onClick={fit} aria-label="Hammasini ko‘rsatish">
          <LocateFixed size={17} />
        </button>
        {SATELLITE_TEMPLATE && (
          <button className={satellite ? "on" : ""} onClick={() => setSatellite(!satellite)} aria-label="Xarita / sputnik">
            <Layers size={17} />
          </button>
        )}
        {!compact && (
          <button onClick={() => setFull(!full)} aria-label={full ? "Kichraytirish" : "To‘liq ekran"}>
            {full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
        )}
      </div>
      <span className="tm-attrib">{failed ? "Xarita yuklanmadi — sxema" : TILE_ATTRIBUTION}</span>
      {children}
    </div>
  );
}
