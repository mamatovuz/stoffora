import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, LoaderCircle, MapPin, Navigation, QrCode, RotateCcw, X } from "lucide-react";
import { errorText, post } from "../../api";
import { isNetworkError } from "../miniOffline";
import { duration } from "@/lib/format";
import { haversineDistance } from "@/lib/attendance";
import type { Attendance, Branch } from "@/lib/types";
import { haptic, platform, reportError, sampleMotion, supports, tg, type MotionSummary } from "./tg";
import type { Action } from "./shared";

/* Davomat: Face ID (yoki biometriya) dan keyin GPS → (QR) → server tasdig‘i. */

type Gps = { lat: number; lng: number; accuracy: number; distance: number; takenAt: number };
export type Flow = { sessionId: string; action: Action; requiresQr: boolean; photo?: string; method: "FACE" | "BIOMETRIC" };

function browserPosition(highAccuracy: boolean) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Qurilma joylashuvni aniqlay olmaydi."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: highAccuracy,
      timeout: highAccuracy ? 15_000 : 10_000,
      maximumAge: highAccuracy ? 0 : 30_000,
    });
  });
}

/**
 * Telegram 8.0+ ning o‘z joylashuv xizmati. Ba’zi telefonlarda brauzer (WebView)
 * joylashuvi bloklangan bo‘ladi, lekin Telegram’ga ruxsat bor — shunda shu ishlaydi.
 */
function telegramPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    const manager = tg()?.LocationManager;
    if (!manager || !supports("8.0")) return reject(new Error("Telegram joylashuvi mavjud emas."));
    const ask = () => {
      if (!manager.isLocationAvailable) return reject(new Error("Qurilma joylashuvni aniqlay olmaydi."));
      manager.getLocation((data) => {
        if (!data) return reject(Object.assign(new Error("Joylashuvga ruxsat berilmagan."), { code: 1 }));
        resolve({
          coords: {
            latitude: data.latitude,
            longitude: data.longitude,
            accuracy: data.horizontal_accuracy ?? 30,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        } as unknown as GeolocationPosition);
      });
    };
    if (manager.isInited) ask();
    else manager.init(ask);
  });
}

/**
 * Avval Telegram’ning o‘z joylashuv xizmati: ruxsat bir marta so‘raladi va Telegram uni
 * eslab qoladi (brauzer joylashuvi esa Telegram ichida har sessiyada qayta so‘raydi).
 * Telegram xizmati bo‘lmasa yoki ishlamasa — brauzer GPS.
 */
export function getPosition(highAccuracy: boolean) {
  const manager = tg()?.LocationManager;
  if (manager && supports("8.0"))
    return telegramPosition().catch((reason) => browserPosition(highAccuracy).catch(() => Promise.reject(reason)));
  return browserPosition(highAccuracy).catch((reason) => telegramPosition().catch(() => Promise.reject(reason)));
}

/**
 * Ruxsat SO‘RAMASDAN joylashuv (geofence uchun): faqat ruxsat allaqachon berilgan bo‘lsa.
 * Aks holda null — foydalanuvchi bezovta qilinmaydi.
 */
export async function quietPosition(): Promise<GeolocationPosition | null> {
  const manager = tg()?.LocationManager;
  if (manager && supports("8.0")) {
    // init ruxsat so‘ramaydi — faqat holatni (berilganmi) o‘qiydi.
    if (!manager.isInited)
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 1500);
        try {
          manager.init(() => resolve());
        } catch {
          resolve();
        }
      });
    if (manager.isAccessGranted) return telegramPosition().catch(() => null);
  }
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (status?.state === "granted") return await browserPosition(false);
  } catch {
    /* permissions API yo‘q */
  }
  return null;
}

/**
 * GPS’ni Face ID bilan parallel boshlash: tugma bosilganda joylashuv so‘raladi,
 * Face ID tugaguncha u tayyor bo‘ladi. Natija 60 soniya ichida qayta ishlatiladi.
 * Shu paytda harakat sensori ham o‘lchanadi (emulyatorni sezish uchun).
 */
let gpsPrefetch: { at: number; promise: Promise<GeolocationPosition> } | null = null;
let motionPrefetch: Promise<MotionSummary | undefined> | null = null;
export function prefetchPosition() {
  if (!motionPrefetch) motionPrefetch = sampleMotion(2000).catch(() => undefined);
  if (gpsPrefetch && Date.now() - gpsPrefetch.at < 20_000) return;
  const promise = getPosition(true).catch((reason) => {
    if ((reason as GeolocationPositionError)?.code === 1) throw reason;
    return getPosition(false);
  });
  promise.catch(() => undefined);
  gpsPrefetch = { at: Date.now(), promise };
}
export async function takePrefetchedPosition() {
  const current = gpsPrefetch;
  gpsPrefetch = null;
  if (!current || Date.now() - current.at > 60_000) return null;
  try {
    return await current.promise;
  } catch {
    return null;
  }
}
async function takeMotion() {
  const current = motionPrefetch;
  motionPrefetch = null;
  return current ? current : sampleMotion(1200);
}

export function AttendanceFlow({
  flow,
  branch,
  onClose,
  onSuccess,
  onOffline,
}: {
  flow: Flow;
  branch: Branch;
  onClose: () => void;
  onSuccess: (row: Attendance, message: string) => void;
  onOffline?: (gps: { lat: number; lng: number; accuracy: number }) => void;
}) {
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsState, setGpsState] = useState<"loading" | "ok" | "far" | "error">("loading");
  const [gpsError, setGpsError] = useState("");
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const committed = useRef(false);
  const motion = useRef<Promise<MotionSummary | undefined> | null>(null);
  const nativeQr = supports("6.4") && Boolean(tg()?.showScanQrPopup);

  useEffect(() => {
    motion.current = takeMotion();
  }, []);

  const locate = useCallback(async () => {
    setGpsState("loading");
    setGpsError("");
    try {
      let position: GeolocationPosition | null = await takePrefetchedPosition();
      if (!position) {
        try {
          position = await getPosition(true);
        } catch (reason) {
          if ((reason as GeolocationPositionError)?.code === 1) throw reason;
          position = await getPosition(false);
        }
      }
      const { latitude, longitude, accuracy } = position.coords;
      const distance = haversineDistance(latitude, longitude, branch.latitude, branch.longitude);
      const value = { lat: latitude, lng: longitude, accuracy: Math.round(accuracy), distance, takenAt: position.timestamp || Date.now() };
      setGps(value);
      try {
        // Joylashuvga ruxsat bor — bosh sahifadagi geofence taklifi shundan keyin ishlaydi.
        localStorage.setItem("staffora:geo-ok", "1");
      } catch {
        /* muhim emas */
      }
      const far = distance - Math.min(35, accuracy) > branch.radiusMeters;
      setGpsState(far ? "far" : "ok");
      if (far) haptic.warning();
    } catch (reason) {
      const code = (reason as GeolocationPositionError)?.code;
      const text =
        code === 1
          ? "Joylashuvga ruxsat berilmagan. Telefon sozlamalarida Telegram uchun joylashuvni yoqing."
          : code === 3
            ? "GPS signal topilmadi. Ochiq joyga chiqib qayta urinib ko‘ring."
            : errorText(reason, "Joylashuv aniqlanmadi.");
      setGpsError(text);
      setGpsState("error");
      haptic.error();
      reportError("gps", text, `code=${code ?? "?"}`);
    }
  }, [branch]);

  useEffect(() => {
    void locate();
  }, [locate]);

  const commit = useCallback(
    async (token: string | null) => {
      if (committed.current || !gps) return;
      committed.current = true;
      setBusy(true);
      setError("");
      try {
        // Sensor o‘lchovi 2 soniyadan oshmaydi; tayyor bo‘lmasa kutmaymiz.
        const motionSummary = await Promise.race([motion.current || Promise.resolve(undefined), new Promise<undefined>((r) => window.setTimeout(() => r(undefined), 800))]);
        const row = await post<Attendance>("/mini/attendance/commit", {
          sessionId: flow.sessionId,
          qrToken: token || undefined,
          latitude: gps.lat,
          longitude: gps.lng,
          accuracy: gps.accuracy,
          positionAge: Math.max(0, Date.now() - gps.takenAt),
          photoDataUrl: flow.photo,
          motion: motionSummary,
          platform: platform(),
        });
        onSuccess(
          row,
          flow.action === "CHECK_IN"
            ? `Ishga kelish ${row.checkIn} da qayd etildi${row.lateMinutes ? ` (${row.lateMinutes} daq kechikish)` : ""}.`
            : `Ketish ${row.checkOut} da qayd etildi. Ishlagan vaqt: ${duration(row.workedMinutes)}.`,
        );
      } catch (reason) {
        committed.current = false;
        if (isNetworkError(reason) && onOffline && flow.method === "FACE") return onOffline({ lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy });
        setQrToken(null);
        setError(errorText(reason, "Tekshiruv amalga oshmadi."));
        haptic.error();
      } finally {
        setBusy(false);
      }
    },
    [flow, gps, onSuccess, onOffline],
  );

  // GPS tayyor va QR kerak bo‘lmasa — darhol yuboramiz.
  useEffect(() => {
    if (gpsState === "ok" && !flow.requiresQr && !committed.current && !error) void commit(null);
  }, [gpsState, flow.requiresQr, commit, error]);
  useEffect(() => {
    if (qrToken && gpsState === "ok") void commit(qrToken);
  }, [qrToken, gpsState, commit]);
  // QR kerak bo‘lsa — Telegram skanerini avtomatik ochamiz (bir bosish kam).
  const autoScanned = useRef(false);
  useEffect(() => {
    if (gpsState === "ok" && flow.requiresQr && nativeQr && !autoScanned.current && !qrToken) {
      autoScanned.current = true;
      scanNative();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsState, flow.requiresQr, nativeQr, qrToken]);

  const onQr = (text: string) => {
    const value = text.trim();
    if (value.split(".").length !== 3) {
      setError("Bu Staffora davomat QR kodi emas. Filial ekranidagi QR’ni skanerlang.");
      haptic.warning();
      return false;
    }
    setError("");
    haptic.tap("medium");
    setQrToken(value);
    return true;
  };

  function scanNative() {
    setError("");
    tg()?.showScanQrPopup?.({ text: `${branch.name} ekranidagi QR kodni skanerlang` }, (text) => {
      const accepted = onQr(text);
      if (accepted) tg()?.closeScanQrPopup?.();
      return accepted;
    });
  }

  const steps = [
    { label: flow.method === "BIOMETRIC" ? "Biometriya" : "Face ID", state: "done" },
    { label: "GPS", state: gpsState === "ok" ? "done" : gpsState === "loading" ? "active" : "" },
    ...(flow.requiresQr ? [{ label: "QR", state: qrToken ? "done" : gpsState === "ok" ? "active" : "" }] : []),
    { label: "Tasdiq", state: busy ? "active" : "" },
  ];
  const mapsUrl = `https://maps.google.com/?q=${branch.latitude},${branch.longitude}`;

  return (
    <div className="sheet-layer">
      <button className="sheet-backdrop" onClick={onClose} aria-label="Yopish" />
      <section className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-head">
          <div>
            <b>{flow.action === "CHECK_IN" ? "Ishga kelish" : "Ishdan ketish"}</b>
            <small>
              {flow.method === "BIOMETRIC" ? "Biometriya" : "Face ID"} tasdiqlandi ✓ · {branch.name}
            </small>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Yopish">
            <X size={18} />
          </button>
        </div>
        <div className="flow-steps" style={{ ["--steps" as string]: steps.length }}>
          {steps.map((step) => (
            <div key={step.label} className={step.state}>
              <i />
              {step.label}
            </div>
          ))}
        </div>

        <div className="gps-card">
          <span className="mini-ico">{gpsState === "loading" ? <LoaderCircle size={18} className="spin" /> : <Navigation size={18} />}</span>
          <span>
            <b>
              {gpsState === "loading"
                ? "Joylashuv aniqlanmoqda…"
                : gpsState === "ok"
                  ? "Siz filial hududidasiz"
                  : gpsState === "far"
                    ? "Filialdan uzoqdasiz"
                    : "Joylashuv aniqlanmadi"}
            </b>
            <small>{gps ? `Masofa: ${gps.distance} m · ruxsat: ${branch.radiusMeters} m · aniqlik ±${gps.accuracy} m` : gpsError || "GPS yoqilgan bo‘lsin"}</small>
          </span>
          {(gpsState === "far" || gpsState === "error") && (
            <button className="sheet-close" onClick={() => void locate()} aria-label="Qayta aniqlash">
              <RotateCcw size={16} />
            </button>
          )}
        </div>

        {flow.requiresQr && gpsState === "ok" && !busy && (
          <>
            {cameraOpen ? <QrCamera onResult={(text) => onQr(text) && setCameraOpen(false)} /> : null}
            <div style={{ display: "grid", gap: 8 }}>
              {nativeQr ? (
                <button className="mini-btn" onClick={scanNative}>
                  <QrCode size={18} /> QR kodni skanerlash
                </button>
              ) : (
                !cameraOpen && (
                  <button className="mini-btn" onClick={() => setCameraOpen(true)}>
                    <QrCode size={18} /> Kamerani ochish
                  </button>
                )
              )}
              {nativeQr && !cameraOpen && (
                <button className="mini-btn soft" onClick={() => setCameraOpen(true)}>
                  Ichki kamera orqali skanerlash
                </button>
              )}
            </div>
          </>
        )}

        {busy && (
          <div className="mini-empty">
            <LoaderCircle className="spin" size={28} />
            Server tekshirmoqda…
          </div>
        )}
        {error && (
          <div className="mini-alert" style={{ marginTop: 12 }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}
        {error && !flow.requiresQr && gpsState === "ok" && !busy && (
          <button className="mini-btn" style={{ marginTop: 10 }} onClick={() => void commit(null)}>
            <RotateCcw size={17} /> Qayta yuborish
          </button>
        )}
        {gpsState === "far" && (
          <div className="mini-alert" style={{ marginTop: 12 }}>
            <MapPin size={18} />
            <span>
              Davomatni faqat filial hududida belgilash mumkin. Filialga yaqinroq kelib, ↻ tugmasini bosing.{" "}
              <a href={mapsUrl} target="_blank" rel="noreferrer">
                Xaritada ko‘rish
              </a>
            </span>
          </div>
        )}
      </section>
    </div>
  );
}

function QrCamera({ onResult }: { onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const done = useRef(false);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;
  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let alive = true;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        });
        if (!alive || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
        const jsQR = detector ? null : (await import("jsqr")).default;
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        timer = window.setInterval(async () => {
          const video = videoRef.current;
          if (!video || done.current || video.readyState < 2) return;
          try {
            let text: string | undefined;
            if (detector) text = (await detector.detect(video))[0]?.rawValue;
            else if (jsQR && context) {
              const size = Math.min(video.videoWidth, video.videoHeight, 720);
              const scale = size / Math.min(video.videoWidth, video.videoHeight);
              canvas.width = Math.round(video.videoWidth * scale);
              canvas.height = Math.round(video.videoHeight * scale);
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              const image = context.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data;
            }
            if (text) {
              done.current = true;
              resultRef.current(text);
              window.setTimeout(() => (done.current = false), 1500);
            }
          } catch {
            /* keyingi kadr */
          }
        }, 300);
      } catch (reason) {
        setError("Kamerani ochib bo‘lmadi. Telegram’ga kamera ruxsatini bering.");
        reportError("camera", "QR kamera ochilmadi", reason);
      }
    })();
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  return (
    <>
      <div className="scan-view">
        <video ref={videoRef} muted playsInline />
        <div className="scan-frame">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      {error && (
        <div className="mini-alert" style={{ marginBottom: 10 }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
    </>
  );
}
