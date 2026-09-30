import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { errorText, post } from "../api";

type FaceApi = typeof import("@vladmandic/face-api");
type Pose = "front" | "side" | "left" | "right";
type Step = { title: string; hint: string; pose: Pose; capture: boolean };

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
const tick = () => window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");

/** Oddiy yaw bahosi: burun uchi ko‘zlar o‘rtasidan qancha siljigan (ko‘zlar oralig‘iga nisbatan). */
function estimateYaw(points: { x: number; y: number }[]) {
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
  return (nose.x - (left.x + right.x) / 2) / eyeDistance;
}

function frameBrightness(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return 128;
  context.drawImage(video, 0, 0, 32, 32);
  const data = context.getImageData(0, 0, 32, 32).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4)
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return sum / (data.length / 4);
}

function capturePhoto(video: HTMLVideoElement) {
  const size = Math.min(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 480;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Profil rasmini tayyorlab bo‘lmadi.");
  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  context.drawImage(
    video,
    (video.videoWidth - size) / 2,
    (video.videoHeight - size) / 2,
    size,
    size,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/jpeg", 0.82);
}

function distance(a: number[], b: number[]) {
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
}
function mean(samples: number[][]) {
  return samples[0].map((_, i) => samples.reduce((s, x) => s + x[i], 0) / samples.length);
}

function buildSteps(enrolled: boolean): Step[] {
  const direction: Pose = Math.random() < 0.5 ? "left" : "right";
  const turn = direction === "left" ? "chapga" : "o‘ngga";
  if (enrolled)
    return [
      { title: "Kameraga to‘g‘ri qarang", hint: "Yuzingizni doira markaziga joylang", pose: "front", capture: true },
      { title: `Boshingizni sekin ${turn} buring`, hint: "Jonli tekshiruv — rasm yoki video emasligini aniqlaymiz", pose: direction, capture: false },
      { title: "Yana to‘g‘ri qarang", hint: "Bir soniya qimirlamang", pose: "front", capture: true },
    ];
  return [
    { title: "Kameraga to‘g‘ri qarang", hint: "Yorug‘ joyda, ko‘zoynak va niqobsiz", pose: "front", capture: true },
    { title: "Boshingizni sal chapga buring", hint: "Yuzni turli burchakdan saqlaymiz", pose: "left", capture: true },
    { title: "Endi sal o‘ngga buring", hint: "Sekin, shoshilmang", pose: "right", capture: true },
    { title: "Yana to‘g‘ri qarang", hint: "Deyarli tayyor", pose: "front", capture: true },
    { title: "Biroz yaqinroq keling", hint: "Oxirgi namuna", pose: "front", capture: true },
  ];
}

export function FaceScanner({
  enrolled,
  onClose,
  onVerified,
}: {
  enrolled: boolean;
  onClose: () => void;
  onVerified: (proof: string, score: number) => Promise<void> | void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const streamRef = useRef<MediaStream | null>(null);
  const aliveRef = useRef(true);
  const runRef = useRef(0);
  const [phase, setPhase] = useState<"loading" | "scanning" | "sending" | "done" | "error">("loading");
  const [steps, setSteps] = useState<Step[]>(() => buildSteps(enrolled));
  const [stepIndex, setStepIndex] = useState(0);
  const [hint, setHint] = useState("Kamera va Face ID modeli tayyorlanmoqda…");
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const run = useCallback(async () => {
    const runId = ++runRef.current;
    const plan = buildSteps(enrolled);
    setSteps(plan);
    setStepIndex(0);
    setError("");
    setOk(false);
    setPhase("loading");
    setHint("Kamera va Face ID modeli tayyorlanmoqda…");
    const active = () => aliveRef.current && runRef.current === runId;
    try {
      if (!window.isSecureContext)
        throw new Error("Face ID uchun sayt HTTPS orqali ochilishi kerak.");
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Qurilmangizda kameraga kirish imkoni yo‘q. Telegram’ni yangilang.");
      const [faceapi, stream] = await Promise.all([
        preloadFaceModels(),
        streamRef.current
          ? Promise.resolve(streamRef.current)
          : navigator.mediaDevices.getUserMedia({
              video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } },
              audio: false,
            }),
      ]);
      if (!active()) return;
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      if (video.srcObject !== stream) {
        video.srcObject = stream;
        await video.play();
      }
      setPhase("scanning");
      const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
      const captureOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.55 });
      const samples: number[][] = [];
      let photo = "";
      let frames = 0;
      let firstSide = 0;
      for (let index = 0; index < plan.length; index += 1) {
        const step = plan[index];
        setStepIndex(index);
        setHint(step.hint);
        let stable = 0;
        const startedAt = Date.now();
        while (active()) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          if (!active()) return;
          if (video.readyState < 2) continue;
          frames += 1;
          const faces = await faceapi.detectAllFaces(video, detectorOptions).withFaceLandmarks(true);
          if (!active()) return;
          const elapsed = Date.now() - startedAt;
          if (faces.length === 0) {
            stable = 0;
            setHint(elapsed > 6000 ? "Yuz ko‘rinmayapti — yorug‘roq joyga o‘ting" : "Yuzingizni doira ichiga joylang");
            continue;
          }
          if (faces.length > 1) {
            stable = 0;
            setHint("Kadrda faqat siz bo‘lishingiz kerak");
            continue;
          }
          const face = faces[0];
          const box = face.detection.box;
          const frame = Math.min(video.videoWidth, video.videoHeight);
          const cx = (box.x + box.width / 2) / video.videoWidth;
          const cy = (box.y + box.height / 2) / video.videoHeight;
          if (box.width < frame * 0.26) {
            stable = 0;
            setHint("Kameraga yaqinroq keling");
            continue;
          }
          if (box.width > frame * 0.85) {
            stable = 0;
            setHint("Biroz uzoqroq turing");
            continue;
          }
          if (Math.abs(cx - 0.5) > 0.2 || Math.abs(cy - 0.5) > 0.22) {
            stable = 0;
            setHint("Yuzingizni markazga olib keling");
            continue;
          }
          if (frames % 8 === 0 && frameBrightness(video, canvasRef.current) < 55) {
            stable = 0;
            setHint("Juda qorong‘i — yorug‘roq joyga o‘ting");
            continue;
          }
          const yaw = estimateYaw(face.landmarks.positions);
          let poseOk = false;
          if (step.pose === "front") poseOk = Math.abs(yaw) < 0.12;
          else if (step.capture) {
            // Ro‘yxatdan o‘tish: birinchi yon — istalgan tomon, ikkinchisi — qarama-qarshi tomon.
            const sideOk = Math.abs(yaw) > 0.14 && Math.abs(yaw) < 0.5;
            poseOk = sideOk && (firstSide === 0 || Math.sign(yaw) === -firstSide);
          } else poseOk = Math.abs(yaw) > 0.2; // jonlilik: harakat bo‘lishi shart
          if (!poseOk) {
            stable = 0;
            setHint(step.pose === "front" ? "To‘g‘ri, kameraga qarang" : step.hint);
            continue;
          }
          stable += 1;
          if (stable < (step.capture ? 3 : 2)) continue;
          if (step.capture) {
            const full = await faceapi
              .detectSingleFace(video, captureOptions)
              .withFaceLandmarks(true)
              .withFaceDescriptor();
            if (!active()) return;
            if (!full || full.detection.score < 0.6) {
              stable = 0;
              continue;
            }
            const descriptor = Array.from(full.descriptor);
            if (samples.length && distance(samples[0], descriptor) > 0.62) {
              throw new Error("Tekshiruv davomida boshqa yuz aniqlandi. Qaytadan boshlang.");
            }
            samples.push(descriptor);
            if (step.pose !== "front" && firstSide === 0) firstSide = Math.sign(yaw);
            if (!photo && step.pose === "front") photo = capturePhoto(video);
          }
          tick();
          break;
        }
        if (!active()) return;
      }
      if (!active()) return;
      setStepIndex(plan.length);
      setPhase("sending");
      setHint(enrolled ? "Profil bilan solishtirilmoqda…" : "Face ID saqlanmoqda…");
      const liveness = { challenge: plan.map((s) => s.pose).join("-"), passed: true, frames };
      const result = enrolled
        ? await post<{ proof: string; score: number }>("/mini/face/verify", {
            descriptor: mean(samples),
            liveness,
          })
        : await post<{ proof: string; score: number }>("/mini/face/enroll", {
            samples,
            photoDataUrl: photo,
            liveness,
          });
      if (!active()) return;
      setOk(true);
      setPhase("done");
      setHint(enrolled ? `Tasdiqlandi · ${result.score}% moslik` : "Face ID saqlandi");
      haptic("success");
      stopCamera();
      await new Promise((resolve) => setTimeout(resolve, 600));
      await onVerified(result.proof, result.score);
    } catch (reason) {
      if (!active()) return;
      const message =
        reason instanceof DOMException && reason.name === "NotAllowedError"
          ? "Kameraga ruxsat berilmadi. Telegram sozlamalarida kameraga ruxsat bering va qayta urinib ko‘ring."
          : reason instanceof DOMException && reason.name === "NotFoundError"
            ? "Old kamera topilmadi."
            : errorText(reason, "Face ID tasdiqlanmadi.");
      setError(message);
      setPhase("error");
      haptic("error");
    }
  }, [enrolled, onVerified]);

  useEffect(() => {
    aliveRef.current = true;
    void run();
    return () => {
      aliveRef.current = false;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = steps.length;
  const progress = phase === "done" ? 1 : Math.min(1, stepIndex / total);
  const circumference = 2 * Math.PI * 48;
  const current = steps[Math.min(stepIndex, total - 1)];
  const arrow =
    phase === "scanning" && current && (current.pose === "left" || current.pose === "right")
      ? current.pose
      : null;

  return (
    <div className="sheet-layer">
      <button className="sheet-backdrop" onClick={onClose} aria-label="Yopish" />
      <section className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-head">
          <div>
            <b>{enrolled ? "Face ID tasdig‘i" : "Face ID’ni sozlash"}</b>
            <small>
              {enrolled
                ? "Davomat uchun yuzingizni tasdiqlang"
                : "Bir martalik: yuzingiz 5 xil burchakdan saqlanadi"}
            </small>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Yopish">
            <X size={18} />
          </button>
        </div>
        <div className="face-stage">
          <video ref={videoRef} muted playsInline autoPlay />
          <svg className={`face-ring ${phase === "error" ? "error" : ok ? "ok" : ""}`} viewBox="0 0 100 100">
            <circle className="track" cx="50" cy="50" r="48" />
            <circle
              className="bar"
              cx="50"
              cy="50"
              r="48"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - (phase === "error" ? 1 : progress))}
            />
          </svg>
          {arrow && (
            <span className={`face-arrow ${arrow}`} aria-hidden="true">
              {arrow === "left" ? <ArrowLeft size={20} /> : <ArrowRight size={20} />}
            </span>
          )}
          {(phase === "loading" || phase === "sending") && (
            <span className="face-check" style={{ color: "#fff" }}>
              <LoaderCircle className="spin" size={34} />
            </span>
          )}
          {phase === "done" && (
            <span className="face-check">
              <CheckCircle2 size={56} />
            </span>
          )}
        </div>
        <div className="face-status" aria-live="polite">
          <b>
            {phase === "error"
              ? "Tasdiqlanmadi"
              : phase === "done"
                ? "Tayyor!"
                : phase === "sending"
                  ? "Tekshirilmoqda…"
                  : phase === "loading"
                    ? "Tayyorlanmoqda…"
                    : current?.title}
          </b>
          <small>{phase === "error" ? error : hint}</small>
        </div>
        {phase === "scanning" && (
          <div className="flow-steps" style={{ ["--steps" as string]: total, marginTop: 12 }}>
            {steps.map((step, index) => (
              <div key={index} className={index < stepIndex ? "done" : index === stepIndex ? "active" : ""}>
                <i />
              </div>
            ))}
          </div>
        )}
        {phase === "error" && (
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <button className="mini-btn" onClick={() => void run()}>
              <RotateCcw size={17} /> Qayta urinish
            </button>
            <button className="mini-btn ghost" onClick={onClose}>
              Bekor qilish
            </button>
          </div>
        )}
        <div className="mini-alert info" style={{ marginTop: 14 }}>
          <ShieldCheck size={18} />
          <span>
            Yuz belgisi serverda profilingiz bilan solishtiriladi. Rasm yoki
            videoni aniqlash uchun bosh harakati so‘raladi.
          </span>
        </div>
      </section>
    </div>
  );
}
