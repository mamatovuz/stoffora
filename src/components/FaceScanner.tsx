import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  LoaderCircle,
  ScanFace,
  ShieldCheck,
  X,
} from "lucide-react";
import { post } from "../api";

type FaceApi = typeof import("@vladmandic/face-api");

let modelPromise: Promise<FaceApi> | null = null;

async function loadFaceModels() {
  if (!modelPromise) {
    modelPromise = import("@vladmandic/face-api").then(async (faceapi) => {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri("/face-models"),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri("/face-models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/face-models"),
      ]);
      return faceapi;
    });
  }
  return modelPromise;
}

export function FaceScanner({
  enrolled,
  onClose,
  onVerified,
}: {
  enrolled: boolean;
  onClose: () => void;
  onVerified: (proof: string) => Promise<void> | void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const aliveRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("Kamera tayyorlanmoqda…");

  useEffect(() => {
    aliveRef.current = true;
    void (async () => {
      try {
        if (!window.isSecureContext && location.hostname !== "localhost") {
          throw new Error("Face ID kamera uchun HTTPS orqali ochilishi kerak.");
        }
        setMessage("Face ID modeli yuklanmoqda…");
        await loadFaceModels();
        setMessage("Old kameraga qarang");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 720 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (!aliveRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Old kamerani ishga tushirib bo‘lmadi.",
        );
      }
    })();
    return () => {
      aliveRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function scan() {
    const video = videoRef.current;
    if (!video || !ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const faceapi = await loadFaceModels();
      const samples: number[][] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        setMessage(`Yuz tekshirilmoqda ${attempt + 1}/3…`);
        const faces = await faceapi
          .detectAllFaces(
            video,
            new faceapi.TinyFaceDetectorOptions({
              inputSize: 320,
              scoreThreshold: 0.62,
            }),
          )
          .withFaceLandmarks(true)
          .withFaceDescriptors();
        if (faces.length === 0)
          throw new Error(
            "Yuz aniqlanmadi. Yorug‘ joyda kameraga to‘g‘ri qarang.",
          );
        if (faces.length > 1)
          throw new Error("Kadrda faqat bitta odam bo‘lishi kerak.");
        const box = faces[0].detection.box;
        if (box.width < video.videoWidth * 0.22)
          throw new Error("Kameraga biroz yaqinroq turing.");
        samples.push(Array.from(faces[0].descriptor));
        if (attempt < 2) await delay(320);
      }
      const descriptor = averageDescriptors(samples);
      if (!enrolled) {
        setMessage("Face ID birinchi marta saqlanmoqda…");
        await post("/mini/face/enroll", {
          descriptor,
          photoDataUrl: capturePhoto(video),
        });
      }
      setMessage("Profil bilan solishtirilmoqda…");
      const verification = await post<{ proof: string; score: number }>(
        "/mini/face/verify",
        { descriptor },
      );
      setMessage(`Tasdiqlandi · ${verification.score}%`);
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
      await onVerified(verification.proof);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Face ID tasdiqlanmadi.",
      );
      setMessage("Qayta urinishingiz mumkin");
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mini-sheet-layer">
      <button
        className="mini-sheet-backdrop"
        onClick={onClose}
        aria-label="Yopish"
      />
      <section
        className="mini-sheet face-sheet"
        aria-modal="true"
        role="dialog"
      >
        <div className="mini-sheet-head">
          <div>
            <b>{enrolled ? "Face ID tasdig‘i" : "Face ID’ni sozlash"}</b>
            <small>
              {enrolled
                ? "Davomat uchun yuzingizni tasdiqlang"
                : "Birinchi safar yuz namunasi va profil rasmi saqlanadi"}
            </small>
          </div>
          <button onClick={onClose} aria-label="Yopish">
            <X size={20} />
          </button>
        </div>
        <div className="face-camera">
          <video ref={videoRef} muted playsInline />
          <div className="face-guide" aria-hidden="true" />
          <div className={`face-state ${ready ? "ready" : ""}`}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <ScanFace size={18} />
            )}
            {message}
          </div>
        </div>
        {error && <p className="mini-inline-error">{error}</p>}
        <div className="mini-security">
          <ShieldCheck size={18} />
          <span>
            Yuz belgisi serverda profil namunasi bilan solishtiriladi. Mos
            kelmasa davomat tasdiqlanmaydi.
          </span>
        </div>
        <button
          className="mini-primary face-scan-button"
          disabled={!ready || busy}
          onClick={() => void scan()}
        >
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : enrolled ? (
            <CheckCircle2 size={18} />
          ) : (
            <Camera size={18} />
          )}
          {busy
            ? "Tekshirilmoqda…"
            : enrolled
              ? "YUZNI TASDIQLASH"
              : "FACE ID’NI SAQLASH"}
        </button>
        <p className="face-privacy-note">
          Kamera faqat ushbu tekshiruv vaqtida ishlaydi. Face ID xavfsizlikning
          qo‘shimcha qatlami; GPS va dinamik QR ham alohida tekshiriladi.
        </p>
      </section>
    </div>
  );
}

function averageDescriptors(samples: number[][]) {
  return Array.from({ length: 128 }, (_, index) => {
    const value = samples.reduce((sum, sample) => sum + sample[index], 0);
    return value / samples.length;
  });
}

function capturePhoto(video: HTMLVideoElement) {
  const sourceSize = Math.min(video.videoWidth, video.videoHeight);
  const sourceX = (video.videoWidth - sourceSize) / 2;
  const sourceY = (video.videoHeight - sourceSize) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Profil rasmini tayyorlab bo‘lmadi.");
  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  context.drawImage(
    video,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/jpeg", 0.82);
}

const delay = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));
