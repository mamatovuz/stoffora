import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchPercent } from "@/lib/face";
import { Check, LoaderCircle, MapPin, Navigation, RotateCcw, ScanFace } from "lucide-react";
import { ApiError, api, errorText, post } from "../../api";
import { capturePhoto, faceQuality, geometry, preloadFaceModels, type FaceCapture } from "../../components/FaceScanner";
import { haversineDistance } from "@/lib/attendance";
import { tashkentClock } from "@/lib/format";
import type { Branch } from "@/lib/types";
import { getPosition, peekPrefetchedPosition } from "./AttendanceFlow";
import { TileMap, type MapPoint } from "./TileMap";
import { haptic, reportError } from "./tg";

/*
 * Kundalik Face ID (ro‘yxatdan o‘tgandan keyin) — ilovadagi bilan bir xil ko‘rinish:
 *   • kamera tepani to‘liq egallaydi (zoom yo‘q); ramka — 4 burchak, yuzni kuzatadi, topilmasa markazda;
 *   • yuz yo‘q / qiyshiq / ramkadan tashqarida / moslik past — ramka QIZIL;
 *   • yuz to‘g‘ri va moslik ≥ 65% — YASHIL; ~0,9 soniya yashil turgach rasm olinadi va tasdiqlanadi.
 * Pastda xarita: filial, ruxsat etilgan radius va xodim turgan joy (GPS aniqligi bilan).
 * Jonli foiz telefonda hisoblanadi (xodimning o‘z namunasi bilan); yakuniy qaror — serverda.
 */

type Reference = { descriptor: number[]; samples: number[][]; threshold: number; passPercent: number };
type Box = { x: number; y: number; width: number; height: number };
type Status = "loading" | "none" | "far" | "near" | "offcenter" | "tilted" | "dark" | "low" | "ok" | "sending" | "done" | "fail";

const HOLD_MS = 900;
const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
const mean = (rows: number[][]) => rows[0].map((_, i) => rows.reduce((s, r) => s + r[i], 0) / rows.length);
// Server bilan bir xil shkala: chegara = 75%, chegaradan oshganda tez tushadi.
const percentOf = (d: number, threshold: number) => matchPercent(d, threshold);

let referenceCache: { at: number; value: Reference } | null = null;
async function loadReference(): Promise<Reference | null> {
  if (referenceCache && Date.now() - referenceCache.at < 10 * 60_000) return referenceCache.value;
  try {
    const value = await api<Reference>("/mini/face/reference");
    referenceCache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}
/** Server bilan bir xil mantiq: markaz va eng yaqin ikki namunaning o‘rtachasi. */
function liveDistance(ref: Reference, candidate: number[]) {
  const center = distance(ref.descriptor, candidate);
  const nearest = ref.samples.map((s) => distance(s, candidate)).sort((a, b) => a - b).slice(0, 2);
  const near = nearest.length ? nearest.reduce((s, v) => s + v, 0) / nearest.length : center;
  return Math.min(center, (center + near) / 2);
}

const messages: Record<Status, string> = {
  loading: "Kamera tayyorlanmoqda…",
  none: "Yuzingizni ramkaga joylang",
  far: "Yaqinroq keling",
  near: "Biroz uzoqroq turing",
  offcenter: "Yuzingizni markazga olib keling",
  tilted: "Kameraga to‘g‘ri qarang",
  dark: "Juda qorong‘i — yorug‘likka yuzlaning",
  low: "Yuz tanilmadi",
  ok: "Yuz tanildi — qimirlamang",
  sending: "Tekshirilmoqda…",
  done: "Tasdiqlandi",
  fail: "Yuz mos kelmadi",
};

export function FaceCheck({
  action,
  branch: homeBranch,
  branches,
  onClose,
  onVerified,
  onCapture,
  onOffline,
}: {
  action: "CHECK_IN" | "CHECK_OUT";
  branch: Branch | null;
  /** «Istalgan filialdan» lavozimi — ruxsat etilgan filiallar. */
  branches?: Branch[];
  onClose: () => void;
  onVerified: (proof: string, score: number, photo?: string) => Promise<void> | void;
  onCapture?: (capture: FaceCapture) => void;
  onOffline?: (capture: FaceCapture) => Promise<void> | void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const streamRef = useRef<MediaStream | null>(null);
  const alive = useRef(true);
  const runId = useRef(0);
  const [status, setStatusState] = useState<Status>("loading");
  const [percent, setPercent] = useState<number | null>(null);
  /** Yuz topilmaganda ramkaning joyi (ekranda, piksel). */
  const [rest, setRest] = useState<{ x: number; y: number; size: number } | null>(null);
  // Ramka yuzni kuzatadi: ekrandagi koordinata, piksel. null — markazda.
  const [track, setTrack] = useState<{ x: number; y: number; size: number } | null>(null);
  const [error, setError] = useState("");
  const [pass, setPass] = useState(65);
  const statusRef = useRef<Status>("loading");
  const setStatus = (next: Status) => {
    if (statusRef.current === next) return;
    statusRef.current = next;
    setStatusState(next);
    if (next === "ok") haptic.tap("light");
  };

  /* -------------------------------------------------------- joylashuv --- */
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState("");
  const locate = useCallback(async (fresh = false) => {
    setGpsError("");
    try {
      const position = fresh ? await getPosition(true) : await peekPrefetchedPosition();
      setGps({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: Math.round(position.coords.accuracy) });
    } catch (reason) {
      const code = (reason as GeolocationPositionError)?.code;
      setGpsError(code === 1 ? "Joylashuvga ruxsat berilmagan" : "Joylashuv aniqlanmadi");
    }
  }, []);
  useEffect(() => {
    void locate();
  }, [locate]);
  // Bir nechta filial bo‘lsa — xodim turgan joyga eng mos filial xaritada.
  const branch = useMemo(() => {
    const list = branches?.length ? branches : homeBranch ? [homeBranch] : [];
    if (!list.length) return null;
    if (!gps || list.length === 1) return list[0];
    const slack = Math.min(35, gps.accuracy);
    const outside = (b: Branch) => haversineDistance(gps.lat, gps.lng, b.latitude, b.longitude) - b.radiusMeters - slack;
    return [...list].sort((a, b) => outside(a) - outside(b))[0];
  }, [branches, homeBranch, gps]);
  const gapMeters = gps && branch ? Math.round(haversineDistance(gps.lat, gps.lng, branch.latitude, branch.longitude)) : null;
  const inside = gapMeters !== null && branch ? gapMeters - Math.min(35, gps!.accuracy) <= branch.radiusMeters : null;
  const points = useMemo<MapPoint[]>(
    () => [
      ...(branch ? [{ id: "branch", lat: branch.latitude, lng: branch.longitude, kind: "branch" as const, label: branch.name, tone: "info" as const }] : []),
      ...(gps ? [{ id: "me", lat: gps.lat, lng: gps.lng, kind: "me" as const, label: "Siz", tone: "info" as const, accuracy: gps.accuracy }] : []),
    ],
    [branch, gps],
  );

  /* ---------------------------------------------------- kamera tsikli --- */
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  /** Video sahnani «cover» bilan to‘ldiradi: kadr → ekran masshtabi. */
  const coverOf = (video: HTMLVideoElement) => {
    const cw = video.clientWidth || video.videoWidth;
    const ch = video.clientHeight || video.videoHeight;
    const k = Math.max(cw / video.videoWidth, ch / video.videoHeight);
    return { cw, ch, k, visW: cw / k, visH: ch / k };
  };
  /** Markaziy ramka video kadrida (piksel): ko‘rinib turgan qism ichida, ekrandagi ramka bilan bir xil joy. */
  const frameInVideo = (video: HTMLVideoElement) => {
    const { visW, visH } = coverOf(video);
    const size = Math.min(video.videoWidth * 0.5, visW * 0.72, visH * 0.5);
    return { cx: video.videoWidth / 2, cy: video.videoHeight / 2 - visH * 0.05, size };
  };
  /** Kadr nuqtasi → ekran (old kamera ko‘zgudek — x teskari). */
  const toScreen = (video: HTMLVideoElement, x: number, y: number) => {
    const { cw, ch, k } = coverOf(video);
    return { x: cw / 2 - (x - video.videoWidth / 2) * k, y: ch / 2 + (y - video.videoHeight / 2) * k };
  };
  const layout = useCallback(() => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const f = frameInVideo(video);
    const c = toScreen(video, f.cx, f.cy);
    const size = f.size * coverOf(video).k;
    setRest({ x: c.x - size / 2, y: c.y - size / 2, size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => layout());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [layout]);

  const run = useCallback(async () => {
    const id = ++runId.current;
    const active = () => alive.current && runId.current === id;
    setError("");
    setPercent(null);
    statusRef.current = "loading";
    setStatusState("loading");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Kameraga kirish imkoni yo‘q. Telegram ilovasini yangilang.");
      const [faceapi, stream, reference] = await Promise.all([
        preloadFaceModels(),
        streamRef.current
          ? Promise.resolve(streamRef.current)
          : navigator.mediaDevices
              // 4:3 — old kameraning to‘liq ko‘rish maydoni (kvadrat so‘rov kadrni kesib, yuzni yaqinlashtirardi).
              .getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 }, aspectRatio: { ideal: 4 / 3 }, frameRate: { ideal: 30 } }, audio: false })
              .then(async (value) => {
                // Ba’zi telefonlar old kamerani kattalashtirib ochadi — eng kichik zoom.
                const track = value.getVideoTracks()[0];
                const caps = (track?.getCapabilities?.() || {}) as MediaTrackCapabilities & { zoom?: { min: number } };
                if (caps.zoom) await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min } as MediaTrackConstraintSet] }).catch(() => undefined);
                // Kamera darhol ko‘rinadi — model yuklanishini kutmasdan.
                if (videoRef.current) {
                  videoRef.current.srcObject = value;
                  void videoRef.current.play().catch(() => undefined);
                }
                return value;
              }),
        loadReference(),
      ]);
      if (!active()) return;
      streamRef.current = stream;
      const video = videoRef.current!;
      if (video.srcObject !== stream) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      video.onloadedmetadata = () => layout();
      video.onresize = () => layout();
      layout();
      if (reference) setPass(reference.passPercent);
      const passPercent = reference?.passPercent ?? 65;
      const detector = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 });
      const nextFrame = () =>
        new Promise<void>((resolve) => {
          const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
          if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => resolve());
          else requestAnimationFrame(() => resolve());
        });

      let smooth: number | null = null;
      let holdStart = 0;
      let collected: { descriptor: number[]; quality: number; box: Box }[] = [];
      let frames = 0;
      let failures = 0;
      setStatus("none");
      while (active()) {
        await nextFrame();
        if (!active()) return;
        if (video.readyState < 2) continue;
        frames += 1;
        const face = await faceapi.detectSingleFace(video, detector).withFaceLandmarks(true);
        if (!active()) return;
        const reset = (next: Status) => {
          setStatus(next);
          holdStart = 0;
          collected = [];
        };
        if (!face) {
          setTrack(null);
          smooth = null;
          setPercent(null);
          reset("none");
          continue;
        }
        const box = face.detection.box;
        const side = Math.max(box.width, box.height) * 1.35 * coverOf(video).k;
        const at = toScreen(video, box.x + box.width / 2, box.y + box.height / 2);
        setTrack({ x: at.x - side / 2, y: at.y - side / 2, size: side });
        // Yuz qotirilgan ramka ichida bo‘lishi kerak: markazi yaqin, o‘lchami ramkaga mos.
        const target = frameInVideo(video);
        const faceSize = Math.max(box.width, box.height);
        const dx = (box.x + box.width / 2 - target.cx) / target.size;
        const dy = (box.y + box.height / 2 - target.cy) / target.size;
        if (faceSize < target.size * 0.4) {
          reset("far");
          continue;
        }
        if (faceSize > target.size * 1.02) {
          reset("near");
          continue;
        }
        if (Math.abs(dx) > 0.38 || Math.abs(dy) > 0.4) {
          reset("offcenter");
          continue;
        }
        const g = geometry(face.landmarks.positions);
        const points = face.landmarks.positions;
        // Boshning qiyshayishi (ko‘zlar chizig‘i burchagi) va burilishi.
        const roll = Math.abs(Math.atan2(points[45].y - points[36].y, points[45].x - points[36].x));
        if (Math.abs(g.yaw) > 0.16 || roll > 0.22 || g.pitch < 0.15 || g.pitch > 1.2) {
          reset("tilted");
          continue;
        }
        const q = faceQuality(video, box, canvas.current);
        if (q.light < 50) {
          reset("dark");
          continue;
        }
        // Deskriptor (eng og‘ir qism) — faqat yuz to‘g‘ri joylashganda.
        const [crop] = await faceapi.extractFaces(video, [face.landmarks.align(null, { useDlibAlignment: true })]);
        if (!active() || !crop) continue;
        const raw = await faceapi.computeFaceDescriptor(crop);
        const descriptor = Array.from(Array.isArray(raw) ? raw[0] : raw);
        let current = passPercent;
        if (reference) {
          const pct = percentOf(liveDistance(reference, descriptor), reference.threshold);
          smooth = smooth === null ? pct : Math.round(smooth * 0.55 + pct * 0.45);
          current = smooth;
          setPercent(current);
        }
        if (current < passPercent) {
          reset("low");
          continue;
        }
        setStatus("ok");
        const quality = face.detection.score * Math.min(1, q.sharp / 120) * (1 - Math.min(0.6, Math.abs(g.yaw) * 2));
        collected.push({ descriptor, quality, box: { x: box.x, y: box.y, width: box.width, height: box.height } });
        if (!holdStart) holdStart = performance.now();
        const progress = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
        if (progress < 1 || collected.length < 2) continue;

        /* ---------------------------------------- rasm va tasdiqlash --- */
        // Jonlilik (passiv): kadrlar aynan bir xil bo‘lmasligi kerak — qotgan rasm/yozuv emas.
        const spread = distance(collected[0].descriptor, collected[collected.length - 1].descriptor);
        if (spread < 0.0015) {
          reset("tilted");
          continue;
        }
        const best = collected.reduce((a, b) => (b.quality > a.quality ? b : a));
        const photo = capturePhoto(video, best.box);
        haptic.success();
        setStatus("sending");
        const capture: FaceCapture = { descriptor: mean(collected.slice(-5).map((c) => c.descriptor)), photo };
        onCapture?.(capture);
        if (onOffline && navigator.onLine === false) {
          stopCamera();
          await onOffline(capture);
          return;
        }
        try {
          const result = await post<{ proof: string; score: number }>("/mini/face/verify", {
            descriptor: capture.descriptor,
            // Har bir ushlab turilgan kadr ham — server mediana va 1:N (boshqa xodimlar) bo‘yicha qaror qiladi.
            frames: collected.slice(-5).map((c) => c.descriptor),
            liveness: { challenge: "hold", passed: true, frames },
            photoDataUrl: photo,
            photoQuality: Number(Math.max(0, Math.min(1, best.quality)).toFixed(3)),
          });
          if (!active()) return;
          setPercent(result.score);
          setStatus("done");
          stopCamera();
          await new Promise((r) => setTimeout(r, 420));
          if (active()) await onVerified(result.proof, result.score, photo);
          return;
        } catch (reason) {
          if (reason instanceof ApiError && reason.status === 0 && onOffline) {
            stopCamera();
            await onOffline(capture);
            return;
          }
          failures += 1;
          haptic.error();
          const text = errorText(reason, "Yuz mos kelmadi.");
          if (failures >= 3 || !(reason instanceof ApiError) || ![403, 409].includes(reason.status)) throw new Error(text);
          // Server rad etdi — biroz kutib qayta urinamiz (yorug‘lik, burchak o‘zgarsin).
          setStatus("fail");
          setError(text);
          await new Promise((r) => setTimeout(r, 1300));
          setError("");
          reset("none");
        }
      }
    } catch (reason) {
      if (!alive.current) return;
      const name = reason instanceof DOMException ? reason.name : "";
      const text =
        name === "NotAllowedError"
          ? "Kameraga ruxsat berilmadi. Telefon sozlamalarida Telegram uchun kamerani yoqing."
          : name === "NotReadableError"
            ? "Kamera boshqa ilova tomonidan band."
            : errorText(reason, "Face ID ishlamadi.");
      setError(text);
      statusRef.current = "fail";
      setStatusState("fail");
      reportError("face-check", text, reason);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onVerified, onCapture, onOffline]);

  useEffect(() => {
    alive.current = true;
    void run();
    return () => {
      alive.current = false;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tone = status === "ok" || status === "done" || status === "sending" ? "ok" : status === "loading" ? "idle" : status === "none" ? "idle" : "bad";
  const pill =
    status === "low" || status === "ok" || status === "done"
      ? `${status === "low" ? "Yuz tanilmadi" : status === "done" ? "Tasdiqlandi" : "Yuz tanildi"}${percent !== null ? ` · ${percent}%` : ""}`
      : error || messages[status];
  const failed = status === "fail" && !!error && runId.current > 0;

  const frame = track || rest;
  return (
    <div className={`fc ${tone}`} role="dialog" aria-modal="true" aria-label="Face ID">
      {/* Kamera — tepada to‘liq; yuz turadigan joyda bitta ramka */}
      <div className="fc-stage" ref={stageRef}>
        <video ref={videoRef} muted playsInline autoPlay />
        {frame && (
          <div className={`fc-frame ${tone}`} style={{ width: frame.size, left: frame.x, top: frame.y }} aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </div>
        )}
        {status === "sending" && (
          <div className="fc-busy" aria-hidden>
            <LoaderCircle size={34} className="spin" />
          </div>
        )}
        <header className="fc-top">
          <b>{action === "CHECK_IN" ? "Ishga kelish" : "Ishdan ketish"}</b>
          <small>
            {tashkentClock()} · {branch?.name || "Filial"}
          </small>
        </header>
        <div className="fc-status">
          <div className={`fc-pill ${tone} ${status === "fail" ? "fail" : ""}`} aria-live="polite">
            {status === "done" ? <Check size={15} /> : status === "loading" ? <ScanFace size={15} /> : null}
            {pill}
          </div>
          {status === "low" && percent !== null && <small className="fc-need">Kerak: {pass}% dan yuqori</small>}
        </div>
      </div>

      <section className="fc-panel">
        <div className="fc-map">
          {branch ? (
            <TileMap
              points={points}
              circles={[{ id: "radius", lat: branch.latitude, lng: branch.longitude, radius: branch.radiusMeters }]}
              fitKey={gps ? "gps" : "branch"}
              height={210}
              compact
            >
              <div className={`fc-gps ${gps ? (inside ? "ok" : "bad") : gpsError ? "bad" : ""}`}>
                {gps ? <Navigation size={14} /> : gpsError ? <MapPin size={14} /> : <LoaderCircle size={14} className="spin" />}
                <span>
                  {gps
                    ? inside
                      ? `Filial hududidasiz · ${gapMeters} m · ±${gps.accuracy} m`
                      : `Filialdan ${Math.max(0, (gapMeters || 0) - branch.radiusMeters)} m uzoqdasiz · ±${gps.accuracy} m`
                    : gpsError || "Joylashuv aniqlanmoqda…"}
                </span>
                {(gpsError || inside === false) && (
                  <button onClick={() => void locate(true)} aria-label="Qayta aniqlash">
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>
            </TileMap>
          ) : (
            <div className="fc-nobranch">Filial biriktirilmagan — HR bilan bog‘laning</div>
          )}
        </div>
        <div className="fc-actions">
          <button className="fc-btn ghost" onClick={onClose}>
            Orqaga
          </button>
          {failed && (
            <button className="fc-btn primary" onClick={() => void run()}>
              <RotateCcw size={16} /> Qayta urinish
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
