import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ApiError, errorText, post } from "../api";

/** Internetsiz rejim uchun: tekshiruv natijasi (serverda keyin solishtiriladi). */
export type FaceCapture = { descriptor: number[]; turnDescriptor?: number[]; photo?: string };

type FaceApi = typeof import("@vladmandic/face-api");
type Phase = "intro" | "loading" | "center" | "rotate" | "turn" | "final" | "sending" | "done" | "error";

const TICKS = 60;
const ENROLL_COVERAGE = 0.6;

let modelPromise: Promise<FaceApi> | null = null;
export function preloadFaceModels() {
  if (!modelPromise) {
    modelPromise = import("@vladmandic/face-api")
      .then(async (faceapi) => {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri("/face-models"),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri("/face-models"),
          faceapi.nets.faceRecognitionNet.loadFromUri("/face-models"),
        ]);
        // "Isitish": birinchi hisoblash WebGL shaderlarini tayyorlaydi — shu
        // ishni oldindan qilsak, foydalanuvchi uchun skaner darhol ishlaydi.
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 160;
          canvas.height = 160;
          const context = canvas.getContext("2d");
          if (context) {
            context.fillStyle = "#888";
            context.fillRect(0, 0, 160, 160);
          }
          await faceapi
            .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 160 }))
            .withFaceLandmarks(true)
            .withFaceDescriptor();
          await faceapi.computeFaceDescriptor(canvas);
        } catch {
          /* isitish ixtiyoriy */
        }
        return faceapi;
      })
      .catch((reason) => {
        modelPromise = null;
        throw reason;
      });
  }
  return modelPromise;
}

const haptic = (type: "success" | "error" | "warning") =>
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type);
const tap = () => window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Point = { x: number; y: number };
export function geometry(points: Point[]) {
  const avg = (from: number, to: number) => {
    const slice = points.slice(from, to + 1);
    return {
      x: slice.reduce((s, p) => s + p.x, 0) / slice.length,
      y: slice.reduce((s, p) => s + p.y, 0) / slice.length,
    };
  };
  const left = avg(36, 41);
  const right = avg(42, 47);
  const nose = points[30];
  const eyeDistance = Math.hypot(right.x - left.x, right.y - left.y) || 1;
  const mid = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  return {
    // musbat — xodimning chap tomoniga burilgan (kamera tasvirida o‘ngga)
    yaw: (nose.x - mid.x) / eyeDistance,
    pitch: (nose.y - mid.y) / eyeDistance,
  };
}

function brightness(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  canvas.width = 24;
  canvas.height = 24;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return 128;
  context.drawImage(video, 0, 0, 24, 24);
  const data = context.getImageData(0, 0, 24, 24).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4)
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return sum / (data.length / 4);
}

/**
 * Yuz sohasining yorqinligi va keskinligi (Laplas dispersiyasi, 48×48 da — juda arzon).
 * Qorong‘i/orqadan yoritilgan yoki xira kadrlar deskriptorni buzadi — ular chetlanadi.
 */
export function faceQuality(video: HTMLVideoElement, box: { x: number; y: number; width: number; height: number }, canvas: HTMLCanvasElement) {
  const S = 48;
  canvas.width = S;
  canvas.height = S;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { light: 128, sharp: 100 };
  context.drawImage(video, box.x, box.y, box.width, box.height, 0, 0, S, S);
  const data = context.getImageData(0, 0, S, S).data;
  const gray = new Float32Array(S * S);
  let sum = 0;
  for (let i = 0; i < S * S; i += 1) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    sum += gray[i];
  }
  let lap = 0;
  let lap2 = 0;
  let n = 0;
  for (let y = 1; y < S - 1; y += 1)
    for (let x = 1; x < S - 1; x += 1) {
      const i = y * S + x;
      const v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - S] - gray[i + S];
      lap += v;
      lap2 += v * v;
      n += 1;
    }
  const mean = lap / n;
  return { light: sum / (S * S), sharp: lap2 / n - mean * mean };
}

type Quality = { light: "ok" | "bad" | ""; distance: "ok" | "bad" | ""; center: "ok" | "bad" | "" };

/**
 * Profil rasmi: yuz markazda, atrofida yetarli joy (portret kabi), ko‘zgu holatida.
 * Yuz qutisi berilmasa — kadr markazidan kvadrat.
 */
export function capturePhoto(video: HTMLVideoElement, box?: { x: number; y: number; width: number; height: number }) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  let size = Math.min(vw, vh);
  let sx = (vw - size) / 2;
  let sy = (vh - size) / 2;
  if (box) {
    size = Math.min(vw, vh, box.width * 2.2);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.45;
    sx = Math.max(0, Math.min(vw - size, cx - size / 2));
    sy = Math.max(0, Math.min(vh - size, cy - size / 2));
  }
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Profil rasmini tayyorlab bo‘lmadi.");
  context.translate(512, 0);
  context.scale(-1, 1);
  context.imageSmoothingQuality = "high";
  context.drawImage(video, sx, sy, size, size, 0, 0, 512, 512);
  return canvas.toDataURL("image/jpeg", 0.86);
}

const distance = (a: number[], b: number[]) =>
  Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
const mean = (samples: number[][]) =>
  samples[0].map((_, i) => samples.reduce((s, x) => s + x[i], 0) / samples.length);

/** iOS uslubidagi Face ID belgisi. */
export function FaceIdGlyph({
  state = "idle",
  size = 96,
}: {
  state?: "idle" | "scan" | "ok" | "fail";
  size?: number;
}) {
  return (
    <svg className={`faceid-glyph ${state}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <g className="brackets" fill="none" strokeWidth="6" strokeLinecap="round">
        <path d="M8 30V18a10 10 0 0 1 10-10h12" />
        <path d="M70 8h12a10 10 0 0 1 10 10v12" />
        <path d="M92 70v12a10 10 0 0 1-10 10H70" />
        <path d="M30 92H18A10 10 0 0 1 8 82V70" />
      </g>
      <g className="face" fill="none" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M34 36v7" />
        <path d="M66 36v7" />
        <path d="M51 36v19h-5" />
        <path d="M36 66c8 7 20 7 28 0" />
      </g>
      <path
        className="check"
        d="M28 52l15 15 30-32"
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FaceScanner({
  enrolled,
  onClose,
  onVerified,
  onCapture,
  onOffline,
}: {
  enrolled: boolean;
  onClose: () => void;
  onVerified: (proof: string, score: number, photo?: string) => Promise<void> | void;
  /** Tasdiqlashdan oldin olingan yuz ma’lumoti (keyingi qadamda aloqa uzilsa kerak bo‘ladi). */
  onCapture?: (capture: FaceCapture) => void;
  /** Aloqa yo‘q — belgini qurilmada saqlash uchun. */
  onOffline?: (capture: FaceCapture) => Promise<void> | void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const streamRef = useRef<MediaStream | null>(null);
  const aliveRef = useRef(true);
  const runRef = useRef(0);
  const litRef = useRef<boolean[]>(Array(TICKS).fill(false));
  const [lit, setLit] = useState<boolean[]>(() => Array(TICKS).fill(false));
  const [phase, setPhase] = useState<Phase>(enrolled ? "loading" : "intro");
  const [title, setTitle] = useState("");
  const [hint, setHint] = useState("");
  const [arrow, setArrow] = useState<"left" | "right" | null>(null);
  const [error, setError] = useState("");
  const [score, setScore] = useState(0);
  const [quality, setQualityState] = useState<Quality>({ light: "", distance: "", center: "" });
  const qualityRef = useRef<Quality>(quality);
  /** Holat faqat o‘zgarganda yangilanadi — har kadrda qayta chizish yo‘q (tezroq). */
  const setQuality = (next: Partial<Quality>) => {
    const merged = { ...qualityRef.current, ...next };
    if (merged.light === qualityRef.current.light && merged.distance === qualityRef.current.distance && merged.center === qualityRef.current.center) return;
    qualityRef.current = merged;
    setQualityState(merged);
  };
  const hintRef = useRef("");
  const say = (text: string) => {
    if (hintRef.current === text) return;
    hintRef.current = text;
    setHint(text);
  };
  const startedAtRef = useRef(0);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };
  const light = (predicate: (index: number) => boolean) => {
    let changed = false;
    litRef.current = litRef.current.map((value, index) => {
      if (!value && predicate(index)) {
        changed = true;
        return true;
      }
      return value;
    });
    if (changed) setLit([...litRef.current]);
  };
  const resetTicks = () => {
    litRef.current = Array(TICKS).fill(false);
    setLit([...litRef.current]);
  };
  const fillTo = (fraction: number) => light((i) => i < Math.round(TICKS * fraction));

  const run = useCallback(async () => {
    const runId = ++runRef.current;
    const active = () => aliveRef.current && runRef.current === runId;
    resetTicks();
    setError("");
    setArrow(null);
    setPhase("loading");
    setTitle(enrolled ? "Face ID" : "Tayyorlanmoqda");
    say("Kamera ochilmoqda…");
    setQuality({ light: "", distance: "", center: "" });
    startedAtRef.current = performance.now();
    try {
      if (!window.isSecureContext) throw new Error("Face ID uchun sayt HTTPS orqali ochilishi kerak.");
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Kameraga kirish imkoni yo‘q. Telegram ilovasini yangilang.");
      // Sekin bo‘lsa — nima kutilayotganini aniq aytamiz: kamera ruxsatimi yoki Face ID modeli.
      let cameraReady = Boolean(streamRef.current);
      const slowHint = window.setTimeout(() => {
        if (active()) say(cameraReady ? "Face ID tayyorlanmoqda — bir lahza…" : "Kameraga ruxsat so‘rovini tasdiqlang (Ruxsat berish / Allow)");
      }, 4000);
      const [faceapi, stream] = await Promise.all([
        preloadFaceModels(),
        (streamRef.current
          ? Promise.resolve(streamRef.current)
          : navigator.mediaDevices.getUserMedia({
              video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
              audio: false,
            })
        ).then((value) => {
          cameraReady = true;
          // Kamera darhol ko‘rinadi — model yuklanishini kutmasdan.
          if (videoRef.current && videoRef.current.srcObject !== value) {
            videoRef.current.srcObject = value;
            void videoRef.current.play().catch(() => undefined);
          }
          return value;
        }),
      ]);
      window.clearTimeout(slowHint);
      if (!active()) return;
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      if (video.srcObject !== stream) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      // Kuzatish kadrlari uchun kichik (tez) o‘lcham; deskriptor olinadigan kadrlar uchun aniqroq.
      const fast = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.42 });
      const precise = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
      const samples: number[][] = [];
      let turnDescriptor: number[] | undefined;
      let photo = "";
      let frames = 0;
      let baselinePitch = 0;
      // Kadrlar orasida qat’iy kutish yo‘q — keyingi kadr tayyor bo‘lishi bilan ishlaymiz.
      const nextFrame = () =>
        new Promise<void>((resolve) => {
          const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
          if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => resolve());
          else requestAnimationFrame(() => resolve());
        });

      type Frame = { yaw: number; pitch: number; descriptor?: number[]; score: number; sharp: number; box: { x: number; y: number; width: number; height: number } };
      /** Eng sifatli (to‘g‘ri qaragan, keskin, yorug‘) kadr — profil rasmi shundan. */
      let photoQuality = -1;
      /**
       * Bitta kadr — BITTA hisoblash: aniqlash + nuqtalar (+ kerak bo‘lsa deskriptor).
       * Oldingi versiyada har kadr ikki marta hisoblanardi.
       */
      const inspect = async (withDescriptor = false): Promise<Frame | null> => {
        await nextFrame();
        if (!active() || video.readyState < 2) return null;
        frames += 1;
        // Avval arzon bosqich (aniqlash + nuqtalar). Deskriptor (eng og‘ir qism) faqat
        // yuz to‘g‘ri joylashgan kadrlar uchun hisoblanadi — Face ID sezilarli tezlashadi.
        const face = await faceapi.detectSingleFace(video, withDescriptor ? precise : fast).withFaceLandmarks(true);
        if (!active()) return null;
        if (!face) {
          setQuality({ center: "bad" });
          say("Yuzingizni doira ichiga joylang");
          return null;
        }
        const box = face.detection.box;
        const frame = Math.min(video.videoWidth, video.videoHeight);
        const cx = (box.x + box.width / 2) / video.videoWidth;
        const cy = (box.y + box.height / 2) / video.videoHeight;
        if (box.width < frame * 0.22) {
          setQuality({ distance: "bad" });
          say("Yaqinroq keling");
          return null;
        }
        if (box.width > frame * 0.9) {
          setQuality({ distance: "bad" });
          say("Biroz uzoqroq turing");
          return null;
        }
        setQuality({ distance: "ok" });
        if (Math.abs(cx - 0.5) > 0.24 || Math.abs(cy - 0.5) > 0.26) {
          setQuality({ center: "bad" });
          say("Yuzingizni markazga olib keling");
          return null;
        }
        setQuality({ center: "ok" });
        if (frames % 15 === 0 && brightness(video, canvasRef.current) < 45) {
          setQuality({ light: "bad" });
          say("Juda qorong‘i — yorug‘roq joyga o‘ting");
          return null;
        }
        const g = geometry(face.landmarks.positions);
        let descriptor: number[] | undefined;
        let sharp = 100;
        if (withDescriptor) {
          // Faqat deskriptor olinadigan kadrda: yuz yorug‘ligi va keskinligi.
          const q = faceQuality(video, box, canvasRef.current);
          sharp = q.sharp;
          if (q.light < 55) {
            setQuality({ light: "bad" });
            say("Yuzingiz qorong‘i — yorug‘lik manbaiga yuzlaning");
            return null;
          }
          if (q.light > 235) {
            setQuality({ light: "bad" });
            say("Juda yorqin — to‘g‘ridan tushayotgan yorug‘likdan chetlang");
            return null;
          }
          setQuality({ light: "ok" });
        }
        if (withDescriptor && face.detection.score >= 0.5) {
          const [crop] = await faceapi.extractFaces(video, [face.landmarks.align(null, { useDlibAlignment: true })]);
          if (!active() || !crop) return null;
          const raw = await faceapi.computeFaceDescriptor(crop);
          descriptor = Array.from(Array.isArray(raw) ? raw[0] : raw);
        }
        return { ...g, descriptor, score: face.detection.score, sharp, box: { x: box.x, y: box.y, width: box.width, height: box.height } };
      };
      const accept = (descriptor: number[]) => {
        if (samples.length && distance(samples[0], descriptor) > 0.6)
          throw new Error("Tekshiruv davomida boshqa yuz aniqlandi. Qaytadan boshlang.");
        samples.push(descriptor);
      };
      /**
       * To‘g‘ri qaragan holatda `count` ta eng sifatli namunani oladi: bitta ortiqcha
       * nomzod yig‘iladi va eng xira / boshqalardan eng uzoq (chetga chiqqan) kadr tashlanadi.
       * Sifatli kadr kelmasa — 6 soniyadan keyin borlari bilan davom etadi (eski kameralar).
       */
      const waitFront = async (count: number) => {
        const candidates: { descriptor: number[]; quality: number; pitch: number }[] = [];
        const want = count + 1;
        const started = performance.now();
        while (active() && candidates.length < want) {
          if (candidates.length >= count && performance.now() - started > 6000) break;
          const f = await inspect(true);
          if (!f) continue;
          if (Math.abs(f.yaw) > 0.14 || Math.abs(f.pitch - (candidates[0]?.pitch ?? f.pitch)) > 0.25) {
            say("Kameraga to‘g‘ri qarang");
            continue;
          }
          if (!f.descriptor || f.score < 0.55) continue;
          if (f.sharp < 18 && performance.now() - started < 4000) {
            say("Qimirlamang — tasvir xira");
            continue;
          }
          say("Qimirlamang…");
          // Sifat: aniqlash ishonchi × keskinlik × to‘g‘ri qarash (bosh burilmagan, egilmagan).
          const quality = f.score * Math.min(1, f.sharp / 120) * (1 - Math.min(0.6, Math.abs(f.yaw) * 2 + Math.abs(f.pitch - (candidates[0]?.pitch ?? f.pitch))));
          candidates.push({ descriptor: f.descriptor, quality, pitch: f.pitch });
          // Har safar oldingisidan yaxshiroq kadr bo‘lsa — profil rasmi shu kadrdan.
          if (quality > photoQuality) {
            photoQuality = quality;
            photo = capturePhoto(video, f.box);
          }
        }
        if (!active()) return;
        let chosen = candidates;
        if (candidates.length > count) {
          // Har nomzodning boshqalardan o‘rtacha masofasi — eng chetdagisi (va eng past sifatlisi) tashlanadi.
          const spread = candidates.map((c, i) => candidates.reduce((s, o, j) => (i === j ? s : s + distance(c.descriptor, o.descriptor)), 0) / (candidates.length - 1));
          const worst = spread.map((s, i) => s - candidates[i].quality * 0.05).reduce((w, v, i, list) => (v > list[w] ? i : w), 0);
          chosen = candidates.filter((_, i) => i !== worst).slice(0, count);
        }
        for (const c of chosen) accept(c.descriptor);
        baselinePitch = chosen[chosen.length - 1]?.pitch ?? baselinePitch;
      };

      if (!enrolled) {
        // 1) markaz
        setPhase("center");
        setTitle("Yuzingizni doira ichiga joylang");
        say("Telefonni yuzingiz ro‘parasida ushlang");
        await waitFront(2);
        if (!active()) return;
        tap();
        // 2) doirani to‘ldirish (iPhone Face ID kabi)
        setPhase("rotate");
        setTitle("Boshingizni sekin aylantiring");
        say("Doirani to‘ldirish uchun boshingizni aylana bo‘ylab harakatlantiring");
        const thresholds = [0.18, 0.36, 0.54];
        const startedAt = Date.now();
        while (active()) {
          const coverage = litRef.current.filter(Boolean).length / TICKS;
          const slow = Date.now() - startedAt > 30000;
          if (samples.length >= 4 && (coverage >= ENROLL_COVERAGE || (slow && coverage >= 0.35))) break;
          const next = thresholds[samples.length - 2];
          const wantSample = next !== undefined && coverage >= next;
          const f = await inspect(wantSample);
          if (!f) continue;
          // Ekran (ko‘zgu) koordinatalarida yo‘nalish
          const dx = -f.yaw;
          const dy = (f.pitch - baselinePitch) * 1.6;
          const magnitude = Math.hypot(dx, dy);
          if (magnitude > 0.1) {
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            const center = Math.round((((angle + 90 + 360) % 360) / 360) * TICKS) % TICKS;
            const spread = magnitude > 0.22 ? 4 : 3;
            light((i) => {
              const d = Math.min(Math.abs(i - center), TICKS - Math.abs(i - center));
              return d <= spread;
            });
            say(Date.now() - startedAt > 18000 ? "Boshingizni kattaroq aylana bo‘ylab harakatlantiring" : "Davom eting…");
          }
          if (wantSample && f.descriptor && f.score >= 0.55 && Math.abs(f.yaw) < 0.45 && magnitude > 0.12) {
            accept(f.descriptor);
            tap();
          }
        }
        if (!active()) return;
        light(() => true);
        haptic("success");
        // 3) yakuniy to‘g‘ri namuna
        setPhase("final");
        setTitle("Yana to‘g‘ri qarang");
        say("Oxirgi namuna");
        await waitFront(1);
      } else {
        // Tasdiqlash: 2 ta to‘g‘ri kadr (o‘rtachasi aniqroq) → bosh burish (jonlilik).
        // Burilgan yuz ham serverda profil bilan solishtiriladi — rasm/ekranni almashtirib bo‘lmaydi.
        setPhase("center");
        setTitle("Kameraga qarang");
        say("Yuzingizni oval ichiga joylang");
        await waitFront(2);
        if (!active()) return;
        fillTo(0.5);
        tap();
        const direction = Math.random() < 0.5 ? "left" : "right";
        setPhase("turn");
        setArrow(direction);
        setTitle(direction === "left" ? "Boshingizni chapga buring" : "Boshingizni o‘ngga buring");
        say("Jonli odam ekanini tekshiramiz");
        const turnStarted = Date.now();
        // Kamera tasviri ko‘zgu: xodim chapga bursa yaw musbat bo‘ladi.
        const wanted = direction === "left" ? 1 : -1;
        while (active()) {
          const f = await inspect(true);
          if (!f) continue;
          if (f.yaw * wanted > 0.15 && f.descriptor) {
            if (distance(samples[0], f.descriptor) > 0.66)
              throw new Error("Tekshiruv davomida boshqa yuz aniqlandi. Qaytadan urinib ko‘ring.");
            turnDescriptor = f.descriptor;
            break;
          }
          if (f.yaw * wanted < -0.15) say(direction === "left" ? "Boshqa tomonga — chapga" : "Boshqa tomonga — o‘ngga");
          else if (Date.now() - turnStarted > 6000) say("Boshingizni biroz ko‘proq buring");
          fillTo(0.5 + Math.min(0.45, Math.max(0, f.yaw * wanted) * 3));
        }
        if (!active()) return;
        setArrow(null);
        tap();
      }
      if (!active()) return;
      fillTo(1);
      setPhase("sending");
      setTitle(enrolled ? "Tekshirilmoqda" : "Saqlanmoqda");
      say("");
      const liveness = { challenge: enrolled ? "turn" : "circle", passed: true, frames };
      // Ikki kadrning o‘rtachasi — shovqin kamayadi, moslik aniqroq.
      const capture: FaceCapture = { descriptor: mean(samples), turnDescriptor, photo: photo || undefined };
      if (enrolled) onCapture?.(capture);
      const saveOffline = async () => {
        stopCamera();
        setPhase("done");
        setTitle("Saqlandi");
        say("Internet kelishi bilan yuboriladi");
        haptic("success");
        await sleep(600);
        if (active()) await onOffline!(capture);
      };
      if (enrolled && onOffline && navigator.onLine === false) return void (await saveOffline());
      let result: { proof: string; score: number };
      try {
        result = enrolled
          ? await post<{ proof: string; score: number }>("/mini/face/verify", {
              descriptor: capture.descriptor,
              turnDescriptor,
              liveness,
              // Sifatli kadr bo‘lsa server profil rasmini yangilashi mumkin.
              photoDataUrl: photo || undefined,
              photoQuality: photoQuality > 0 ? Number(photoQuality.toFixed(3)) : undefined,
            })
          : await post<{ proof: string; score: number }>("/mini/face/enroll", {
              samples: samples.slice(0, 8),
              photoDataUrl: photo,
              photoQuality: photoQuality > 0 ? Number(photoQuality.toFixed(3)) : undefined,
              liveness,
            });
      } catch (reason) {
        // Aloqa uzildi — yuz ma’lumoti bilan belgini qurilmada saqlaymiz.
        if (enrolled && onOffline && reason instanceof ApiError && reason.status === 0) return void (await saveOffline());
        throw reason;
      }
      if (!active()) return;
      stopCamera();
      setScore(result.score);
      setElapsed(Math.round((performance.now() - startedAtRef.current) / 100) / 10);
      setPhase("done");
      setTitle(enrolled ? "Tasdiqlandi" : "Face ID sozlandi");
      haptic("success");
      await sleep(enrolled ? 380 : 1100);
      if (!active()) return;
      await onVerified(result.proof, result.score, photo || undefined);
    } catch (reason) {
      if (!active()) return;
      const name = reason instanceof DOMException ? reason.name : "";
      setError(
        name === "NotAllowedError"
          ? "Kameraga ruxsat berilmadi. Telefon sozlamalarida Telegram uchun kamerani yoqing."
          : name === "NotFoundError"
            ? "Old kamera topilmadi."
            : name === "NotReadableError"
              ? "Kamera boshqa ilova tomonidan band. Uni yopib qayta urinib ko‘ring."
              : errorText(reason, "Face ID tasdiqlanmadi."),
      );
      setPhase("error");
      setTitle("Yuz tanilmadi");
      haptic("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrolled, onVerified, onCapture, onOffline]);

  useEffect(() => {
    aliveRef.current = true;
    if (enrolled) void run();
    else void preloadFaceModels().catch(() => undefined);
    return () => {
      aliveRef.current = false;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [elapsed, setElapsed] = useState(0);
  const litCount = lit.filter(Boolean).length;
  const showCamera = !["intro", "done"].includes(phase);
  const glyphState = phase === "done" ? "ok" : phase === "error" ? "fail" : "scan";

  return (
    <div className="faceid" role="dialog" aria-modal="true" aria-label="Face ID">
      <header className="faceid-top">
        <button onClick={onClose}>Bekor qilish</button>
        {!enrolled && phase !== "intro" && phase !== "done" && (
          <span>{Math.round((litCount / TICKS) * 100)}%</span>
        )}
      </header>

      {phase === "intro" ? (
        <div className="faceid-intro">
          <FaceIdGlyph state="idle" size={110} />
          <h1>Face ID’ni sozlash</h1>
          <p>
            Davomat faqat sizning yuzingiz bilan tasdiqlanadi. Buning uchun yuzingizni bir marta
            turli burchaklardan skanerlaymiz.
          </p>
          <ul>
            <li>Yorug‘ joyda turing, ko‘zoynak va niqobni yeching</li>
            <li>Telefonni yuzingiz ro‘parasida ushlang</li>
            <li>Boshingizni sekin aylantirib doirani to‘ldiring</li>
          </ul>
          <div className="faceid-actions">
            <button className="faceid-primary" onClick={() => void run()}>
              Boshlash
            </button>
            <button className="faceid-link" onClick={onClose}>
              Keyinroq
            </button>
          </div>
        </div>
      ) : (
        <div className="faceid-body">
          <div className={`faceid-stage ${phase}`}>
            <svg className="faceid-ticks" viewBox="0 0 200 200" aria-hidden="true">
              {lit.map((on, i) => {
                const angle = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
                const r1 = 91;
                const r2 = on ? 99.5 : 96;
                return (
                  <line
                    key={i}
                    x1={100 + Math.cos(angle) * r1}
                    y1={100 + Math.sin(angle) * r1}
                    x2={100 + Math.cos(angle) * r2}
                    y2={100 + Math.sin(angle) * r2}
                    className={on ? "on" : ""}
                  />
                );
              })}
            </svg>
            <div className="faceid-camera">
              <video ref={videoRef} muted playsInline autoPlay style={{ opacity: showCamera ? 1 : 0 }} />
              {["center", "turn", "final"].includes(phase) && (
                <>
                  {/* Yuz joylashadigan oval yo‘riqnoma va skanerlash chizig‘i */}
                  <svg className={`faceid-guide ${quality.center === "ok" && quality.distance === "ok" ? "ok" : ""}`} viewBox="0 0 100 100" aria-hidden="true">
                    <ellipse cx="50" cy="48" rx="27" ry="35" />
                  </svg>
                  <i className="faceid-scanline" aria-hidden="true" />
                </>
              )}
              {(phase === "loading" || phase === "sending") && (
                <div className="faceid-cover">
                  <FaceIdGlyph state="scan" size={84} />
                </div>
              )}
              {(phase === "done" || phase === "error") && (
                <div className={`faceid-cover ${phase}`}>
                  <FaceIdGlyph state={glyphState} size={96} />
                </div>
              )}
            </div>
            {arrow && (
              <span className={`faceid-arrow ${arrow}`}>
                {arrow === "left" ? <ArrowLeft size={22} /> : <ArrowRight size={22} />}
              </span>
            )}
          </div>
          {/* Bitta aniq ko‘rsatma: nima qilish kerak (yoki natija). */}
          <p className={`faceid-hint ${phase}`} aria-live="polite">
            {phase === "error"
              ? error
              : phase === "done"
                ? enrolled
                  ? `${title} · ${score}%${elapsed ? ` · ${elapsed.toString().replace(".", ",")} s` : ""}`
                  : "Face ID sozlandi — endi davomatni yuzingiz bilan tasdiqlaysiz"
                : phase === "turn" || phase === "rotate"
                  ? title
                  : phase === "sending"
                    ? title
                    : hint || title}
          </p>
          {phase === "error" && (
            <div className="faceid-actions">
              <button className="faceid-primary" onClick={() => void run()}>
                Qayta urinish
              </button>
              <button className="faceid-link" onClick={onClose}>
                Bekor qilish
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
