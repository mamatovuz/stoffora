import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Home,
  LoaderCircle,
  LogIn,
  LogOut,
  MapPin,
  Navigation,
  Plane,
  QrCode,
  RotateCcw,
  ScanFace,
  Send,
  ShieldCheck,
  UserRound,
  X,
  CalendarCheck,
  CheckCheck,
  Megaphone,
} from "lucide-react";
import { ApiError, api, errorText, patch, post, restoreBearerToken, setBearerToken } from "../api";
import { FaceScanner, preloadFaceModels } from "../components/FaceScanner";
import {
  dateLongUz,
  dateParts,
  dateUz,
  duration,
  monthShortUz,
  tashkentClock,
  tashkentIsoDate,
  tashkentWeekday,
} from "@/lib/format";
import { haversineDistance } from "@/lib/attendance";
import type {
  Attendance,
  Branch,
  Company,
  Department,
  Employee,
  LeaveRequest,
  Notification,
  Position,
  Schedule,
} from "@/lib/types";
import { leaveTypeLabel, weekdayShort, weekOrder } from "../types";
import stafforaMark from "../assets/staffora-mark.svg";

type HomeData = {
  employee: Employee;
  company?: Company;
  branch: Branch | null;
  department: Department | null;
  position: Position | null;
  schedule: Schedule | null;
  attendance?: Attendance;
  todayLeave: LeaveRequest | null;
  month: {
    practiceUntil?: string;
    deduction?: number;
    penaltyMode?: string;
    days: number;
    late: number;
    lateMinutes: number;
    workedMinutes: number;
    overtimeMinutes: number;
  };
  notifications: Notification[];
  unreadNotifications?: number;
};
type Tab = "home" | "history" | "leave" | "profile";
type Action = "CHECK_IN" | "CHECK_OUT";
type AuthError = { message: string; code?: string; botUsername?: string };

const tg = () => window.Telegram?.WebApp;
const haptic = (type: "success" | "error" | "warning") =>
  tg()?.HapticFeedback?.notificationOccurred(type);
const supports = (version: string) => Boolean(tg()?.isVersionAtLeast?.(version));

/*
 * Tezkor ochilish: oxirgi bosh sahifa ma’lumoti qurilmada saqlanadi va Mini App
 * ochilishi bilan darhol ko‘rsatiladi; yangi ma’lumot fonda keladi. Kalit Telegram
 * foydalanuvchi ID si bilan — boshqa hisobga aralashmaydi. Maosh keshga yozilmaydi.
 */
const cacheKey = () => {
  const id = tg()?.initDataUnsafe?.user?.id;
  return id ? `staffora:mini:home:${id}` : "";
};
function readCachedHome(): HomeData | null {
  try {
    const key = cacheKey();
    const raw = key ? localStorage.getItem(key) : null;
    if (!raw) return null;
    const cached = JSON.parse(raw) as { savedAt: number; home: HomeData };
    // Kechagi ma’lumot bugungi holatni noto‘g‘ri ko‘rsatadi — faqat bugungisi.
    if (new Date(cached.savedAt).toDateString() !== new Date().toDateString()) return null;
    return cached.home;
  } catch {
    return null;
  }
}
function writeCachedHome(home: HomeData) {
  try {
    const key = cacheKey();
    if (!key) return;
    const safe = { ...home, employee: { ...home.employee, baseSalary: 0 } };
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), home: safe }));
  } catch {
    /* xotira to‘la yoki bloklangan — muhim emas */
  }
}

export function MiniAppPage() {
  const [notifOpen, setNotifOpen] = useState(false);
  const [authError, setAuthError] = useState<AuthError | null>(null);
  const [home, setHomeState] = useState<HomeData | null>(() => readCachedHome());
  // Keshdan ko‘rsatilgan (hali serverdan tasdiqlanmagan) holat — amallar vaqtincha kutadi.
  const [stale, setStale] = useState(() => home === null ? false : true);
  const setHome = useCallback((next: HomeData) => {
    setHomeState(next);
    setStale(false);
    writeCachedHome(next);
  }, []);
  const [tab, setTab] = useState<Tab>("home");
  const [loading, setLoading] = useState(() => !readCachedHome());
  const [faceAction, setFaceAction] = useState<Action | null>(null);
  const [flow, setFlow] = useState<{ sessionId: string; action: Action; requiresQr: boolean; photo?: string } | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const showToast = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    setToast({ text, tone });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 4500);
  }, []);
  const loadHome = useCallback(async () => {
    setHome(await api<HomeData>("/mini/home"));
  }, [setHome]);

  const authenticate = useCallback(async () => {
    const webApp = tg();
    if (!readCachedHome()) setLoading(true);
    setAuthError(null);
    try {
      const localPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname);
      if (!webApp?.initData && !localPreview) {
        // initData yo‘q, lekin avvalgi token bo‘lsa — undan foydalanamiz.
        if (restoreBearerToken()) {
          await loadHome();
          return;
        }
        throw Object.assign(
          new Error(
            "Mini App Telegram tashqarisida ochildi. Uni botdagi «Staffora» tugmasi orqali oching.",
          ),
          { code: "NO_INIT_DATA" },
        );
      }
      const result = await post<{ token: string; home?: HomeData }>("/telegram/auth", {
        initData: webApp?.initData || "",
      });
      setBearerToken(result.token);
      // Server bosh sahifani auth javobida qaytaradi — alohida so‘rov kerak emas.
      if (result.home) setHome(result.home);
      else await loadHome();
    } catch (reason) {
      setAuthError({
        message: errorText(reason, "Kirish amalga oshmadi."),
        code:
          reason instanceof ApiError
            ? reason.code
            : (reason as { code?: string })?.code,
        botUsername:
          reason instanceof ApiError ? (reason.data?.botUsername as string | undefined) : undefined,
      });
    } finally {
      setLoading(false);
      webApp?.ready();
    }
  }, [loadHome, setHome]);

  useEffect(() => {
    const webApp = tg();
    // Keshdan ko‘rsatilayotgan bo‘lsa, Telegram yuklanish belgisini darhol olib tashlaymiz.
    if (home) webApp?.ready();
    webApp?.expand();
    webApp?.disableVerticalSwipes?.();
    // Telegram 8.0+: telefonlarda to‘liq ekran rejimi.
    const mobile = ["ios", "android", "android_x"].includes(webApp?.platform || "");
    if (mobile && supports("8.0")) {
      try {
        webApp?.requestFullscreen?.();
      } catch {
        /* qo‘llab-quvvatlanmasa oddiy rejimda qoladi */
      }
    }
    if (supports("6.1")) {
      webApp?.setHeaderColor?.("secondary_bg_color");
      webApp?.setBackgroundColor?.("secondary_bg_color");
    }
    document.title = "Staffora";
    void authenticate();
    // Face modellarini oldindan yuklab qo‘yamiz — tugma bosilganda tezroq ochiladi.
    const idle = window.setTimeout(() => void preloadFaceModels().catch(() => undefined), 300);
    return () => window.clearTimeout(idle);
  }, [authenticate]);

  // Ilova qayta ochilganda (fon rejimidan) ma’lumotni yangilaymiz.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && home) void loadHome().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [home, loadHome]);

  // Telegram "Orqaga" tugmasi
  useEffect(() => {
    const back = tg()?.BackButton;
    if (!back || !supports("6.1")) return;
    const handler = () => {
      if (notifOpen) setNotifOpen(false);
      else if (flow) setFlow(null);
      else if (faceAction) setFaceAction(null);
      else setTab("home");
    };
    if (notifOpen || flow || faceAction || tab !== "home") back.show();
    else back.hide();
    back.onClick(handler);
    return () => back.offClick(handler);
  }, [flow, faceAction, tab, notifOpen]);

  if (loading)
    return (
      <div className="mini">
        <div className="mini-splash">
          <img src={stafforaMark} alt="Staffora" />
          <LoaderCircle className="spin" size={24} />
        </div>
      </div>
    );
  if (authError || !home) return <AuthErrorScreen error={authError} onRetry={authenticate} />;

  const onVerified = async (faceProof: string, _score: number, photo?: string) => {
    const action = faceAction!;
    try {
      const session = await post<{ id: string; requiresQr: boolean }>("/mini/attendance/session", {
        action,
        faceProof,
      });
      setFaceAction(null);
      setFlow({ sessionId: session.id, action, requiresQr: session.requiresQr, photo });
    } catch (reason) {
      setFaceAction(null);
      showToast(errorText(reason), "error");
      haptic("error");
    }
    if (!home.employee.faceEnrolledAt) void loadHome();
  };

  return (
    <div className="mini">
      <main className="mini-app">
        <header className="mini-top">
          <PhotoAvatar employee={home.employee} />
          <div>
            <small>{home.company?.name}</small>
            <b>Salom, {home.employee.firstName}!</b>
          </div>
          <button
            className="mini-bell"
            aria-label="Xabarnomalar"
            onClick={() => {
              tg()?.HapticFeedback?.impactOccurred("light");
              setNotifOpen(true);
            }}
          >
            <Bell size={21} />
            {(home.unreadNotifications || 0) > 0 && (
              <span className="mini-badge">{Math.min(99, home.unreadNotifications || 0)}</span>
            )}
          </button>
        </header>
        {tab === "home" && (
          <MiniHome
            data={home}
            onAction={(action) => {
              tg()?.HapticFeedback?.impactOccurred("medium");
              prefetchPosition();
              setFaceAction(action);
            }}
            stale={stale}
            onTab={setTab}
            onNotifications={() => setNotifOpen(true)}
          />
        )}
        {tab === "history" && <MiniHistory home={home} />}
        {tab === "leave" && <MiniLeave onToast={showToast} />}
        {tab === "profile" && <MiniProfile data={home} />}
      </main>
      <nav className="mini-tabbar">
        {(
          [
            ["home", Home, "Asosiy"],
            ["history", Clock3, "Tarix"],
            ["leave", Plane, "Ta’til"],
            ["profile", UserRound, "Profil"],
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => {
              tg()?.HapticFeedback?.selectionChanged?.();
              setTab(key);
            }}
          >
            <Icon size={21} strokeWidth={tab === key ? 2.3 : 1.9} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {faceAction && (
        <FaceScanner
          enrolled={Boolean(home.employee.faceEnrolledAt)}
          onClose={() => setFaceAction(null)}
          onVerified={onVerified}
        />
      )}
      {flow && home.branch && (
        <AttendanceFlow
          flow={flow}
          branch={home.branch}
          onClose={() => setFlow(null)}
          onSuccess={async (message) => {
            setFlow(null);
            showToast(message);
            haptic("success");
            await loadHome();
          }}
        />
      )}
      {notifOpen && (
        <NotificationsSheet
          onClose={() => {
            setNotifOpen(false);
            void loadHome().catch(() => undefined);
          }}
          onChanged={() => void loadHome().catch(() => undefined)}
        />
      )}
      {toast && (
        <button className={`mini-toast ${toast.tone === "error" ? "error" : ""}`} onClick={() => setToast(null)}>
          {toast.tone === "error" ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
          <span>
            <b>{toast.tone === "error" ? "Xatolik" : "Muvaffaqiyatli"}</b>
            <small>{toast.text}</small>
          </span>
        </button>
      )}
    </div>
  );
}

function AuthErrorScreen({ error, onRetry }: { error: AuthError | null; onRetry: () => void }) {
  const notLinked = error?.code === "NOT_LINKED";
  const bot = error?.botUsername;
  return (
    <div className="mini">
      <div className="mini-splash">
        <img src={stafforaMark} alt="Staffora" />
        <h1>{notLinked ? "Hisobingizni ulang" : "Kirib bo‘lmadi"}</h1>
        <p>{error?.message || "Telegram orqali qayta oching."}</p>
        {notLinked && (
          <div className="mini-steps">
            <div>
              <i>1</i>
              <span>Botga qayting va <b>/start</b> bosing</span>
            </div>
            <div>
              <i>2</i>
              <span>
                <b>«📱 Telefon raqamni yuborish»</b> tugmasini bosing
              </span>
            </div>
            <div>
              <i>3</i>
              <span>Raqamingiz HR profilidagi bilan mos kelsa — Mini App’ni qayta oching</span>
            </div>
          </div>
        )}
        <div className="mini-actions">
          {notLinked && bot && tg()?.openTelegramLink && (
            <button
              className="mini-btn"
              onClick={() => {
                tg()?.openTelegramLink?.(`https://t.me/${bot}?start=link`);
                tg()?.close();
              }}
            >
              <Send size={17} /> Botni ochish
            </button>
          )}
          <button className={`mini-btn ${notLinked && bot ? "secondary" : ""}`} onClick={onRetry}>
            <RotateCcw size={17} /> Qayta urinish
          </button>
          {tg()?.initData && (
            <button className="mini-btn ghost" onClick={() => tg()?.close()}>
              Yopish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

const clockDuration = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

function PhotoAvatar({ employee, className }: { employee: Employee; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`mini-avatar ${className || ""}`}>
      {employee.photoDataUrl && !broken ? (
        <img src={employee.photoDataUrl} alt="" onError={() => setBroken(true)} />
      ) : (
        `${employee.firstName[0] || ""}${employee.lastName[0] || ""}`
      )}
    </span>
  );
}

function minutesSince(checkIn: string) {
  const [h, m] = checkIn.split(":").map(Number);
  const [nh, nm] = tashkentClock().split(":").map(Number);
  return Math.max(0, nh * 60 + nm - (h * 60 + m));
}

function MiniHome({
  data,
  stale,
  onAction,
  onNotifications,
}: {
  data: HomeData;
  stale: boolean;
  onAction: (action: Action) => void;
  onTab: (tab: Tab) => void;
  onNotifications: () => void;
}) {
  const now = useClock();
  const a = data.attendance;
  const working = Boolean(a?.checkIn && !a.checkOut);
  const finished = Boolean(a?.checkOut);
  const day = data.schedule?.days.find((d) => d.day === tashkentWeekday());
  const clock = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tashkent",
  });
  const missingSetup = !data.branch || !data.schedule;
  const status = finished
    ? { text: "Ish kuni yakunlandi", tone: "done" }
    : working
      ? { text: a?.lateMinutes ? `Ishdasiz · ${a.lateMinutes} daq kech` : "Ishdasiz", tone: a?.lateMinutes ? "late" : "on" }
      : data.todayLeave
        ? { text: "Bugun ta’tildasiz", tone: "off" }
        : !day?.enabled
          ? { text: "Dam olish kuni", tone: "off" }
          : { text: "Hali kelmagansiz", tone: "idle" };
  const qr = (data.branch?.attendanceMode || "QR_GPS_FACE") === "QR_GPS_FACE";

  return (
    <div className="mini-body mh">
      <section className={`mh-hero ${status.tone}`}>
        <div className="mh-status">
          <span>
            <i />
            {status.text}
          </span>
          <time>{dateLongUz(now)}</time>
        </div>
        <div className="mh-clock">{clock}</div>
        <div className="mh-meta">
          <MapPin size={13} /> {data.branch?.name || "Filial biriktirilmagan"}
          <span>·</span>
          {day?.enabled ? `${day.start}–${day.end}` : "Dam olish"}
        </div>

        <div className="mh-times">
          <div>
            <small>Keldi</small>
            <b className={a?.checkIn ? "" : "empty"}>{a?.checkIn || "--:--"}</b>
            {a?.checkIn && <em className={a.lateMinutes ? "late" : "ok"}>{a.lateMinutes ? `${a.lateMinutes} daq kech` : "vaqtida"}</em>}
          </div>
          <div>
            <small>{finished ? "Ketdi" : "Ishlangan"}</small>
            <b className={finished || working ? "" : "empty"}>
              {finished ? a?.checkOut : working && a?.checkIn ? clockDuration(minutesSince(a.checkIn)) : "--:--"}
            </b>
            {finished && <em className="ok">{clockDuration(a?.workedMinutes || 0)} soat</em>}
          </div>
        </div>

        {working && day?.enabled && a?.checkIn && <ShiftProgress start={a.checkIn} end={day.end} now={now} />}

        {missingSetup ? (
          <div className="mh-done warn">
            <AlertCircle size={17} /> HR filial va grafikni biriktirishi kerak
          </div>
        ) : finished ? (
          <div className="mh-done">
            <CheckCircle2 size={17} /> {a?.checkIn} – {a?.checkOut} · {duration(a?.workedMinutes || 0)}
          </div>
        ) : (
          <button
            className={`mh-action ${working ? "out" : ""}`}
            disabled={stale}
            onClick={() => onAction(working ? "CHECK_OUT" : "CHECK_IN")}
          >
            {stale ? <LoaderCircle size={19} className="spin" /> : working ? <LogOut size={19} /> : <ScanFace size={19} />}
            {stale ? "Yangilanmoqda…" : working ? "Ishdan ketdim" : "Ishga keldim"}
          </button>
        )}
        <div className="mh-note">
          <ShieldCheck size={12} /> Face ID · GPS{qr ? " · QR" : ""}
        </div>
      </section>

      <section className="mh-stats">
        <div>
          <b>{data.month.days}</b>
          <small>kun keldi</small>
        </div>
        <div>
          <b className={data.month.late ? "warn" : ""}>{data.month.late}</b>
          <small>kechikish</small>
        </div>
        <div>
          <b>{Math.round(data.month.workedMinutes / 60)}</b>
          <small>soat</small>
        </div>
      </section>

      {data.month.practiceUntil && (
        <div className="mh-hint info">
          <CalendarCheck size={16} />
          <span>
            {data.month.practiceUntil.split("-").reverse().join(".")} gacha mashq davri — kechikish va ushlanmalar hisoblanmaydi.
          </span>
        </div>
      )}
      {!data.month.practiceUntil && data.month.lateMinutes > 0 && (
        <div className="mh-hint warn">
          <AlertCircle size={16} />
          <span>
            Bu oy {data.month.lateMinutes} daqiqa kechikdingiz
            {data.month.deduction ? ` · ${data.month.deduction.toLocaleString("ru-RU")} so‘m ushlanadi` : ""}
          </span>
        </div>
      )}
      {!data.employee.faceEnrolledAt && !finished && !missingSetup && (
        <div className="mh-hint info">
          <ScanFace size={16} />
          <span>Birinchi marta Face ID sozlanadi (~15 soniya). Yorug‘ joyda turing.</span>
        </div>
      )}

      {data.notifications.length > 0 && (
        <section className="mh-notifs">
          <button className="mh-notifs-head" onClick={onNotifications}>
            <span>
              Xabarlar
              {(data.unreadNotifications || 0) > 0 && <span className="mini-badge inline">{data.unreadNotifications}</span>}
            </span>
            <ChevronRight size={16} />
          </button>
          <div className="mn-list">
            {data.notifications.slice(0, 2).map((item) => (
              <NotifItem key={item.id} item={item} onOpen={onNotifications} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------ attendance flow --- */
type Gps = { lat: number; lng: number; accuracy: number; distance: number };

function getPosition(highAccuracy: boolean) {
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
 * GPS'ni Face ID bilan parallel boshlash: tugma bosilganda joylashuv so‘raladi,
 * Face ID tugaguncha u tayyor bo‘ladi. Natija 60 soniya ichida qayta ishlatiladi.
 */
let gpsPrefetch: { at: number; promise: Promise<GeolocationPosition> } | null = null;
export function prefetchPosition() {
  if (gpsPrefetch && Date.now() - gpsPrefetch.at < 20_000) return;
  const promise = getPosition(true).catch((reason) => {
    if ((reason as GeolocationPositionError)?.code === 1) throw reason;
    return getPosition(false);
  });
  promise.catch(() => undefined);
  gpsPrefetch = { at: Date.now(), promise };
}
async function takePrefetchedPosition() {
  const current = gpsPrefetch;
  gpsPrefetch = null;
  if (!current || Date.now() - current.at > 60_000) return null;
  try {
    return await current.promise;
  } catch {
    return null;
  }
}

function AttendanceFlow({
  flow,
  branch,
  onClose,
  onSuccess,
}: {
  flow: { sessionId: string; action: Action; requiresQr: boolean; photo?: string };
  branch: Branch;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsState, setGpsState] = useState<"loading" | "ok" | "far" | "error">("loading");
  const [gpsError, setGpsError] = useState("");
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const committed = useRef(false);
  const nativeQr = supports("6.4") && Boolean(tg()?.showScanQrPopup);

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
      const value = { lat: latitude, lng: longitude, accuracy: Math.round(accuracy), distance };
      setGps(value);
      setGpsState(distance - Math.min(35, accuracy) > branch.radiusMeters ? "far" : "ok");
    } catch (reason) {
      const code = (reason as GeolocationPositionError)?.code;
      setGpsError(
        code === 1
          ? "Joylashuvga ruxsat berilmagan. Telefon sozlamalarida Telegram uchun joylashuvni yoqing."
          : code === 3
            ? "GPS signal topilmadi. Ochiq joyga chiqib qayta urinib ko‘ring."
            : errorText(reason, "Joylashuv aniqlanmadi."),
      );
      setGpsState("error");
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
        const row = await post<Attendance>("/mini/attendance/commit", {
          sessionId: flow.sessionId,
          qrToken: token || undefined,
          latitude: gps.lat,
          longitude: gps.lng,
          accuracy: gps.accuracy,
          photoDataUrl: flow.photo,
        });
        onSuccess(
          flow.action === "CHECK_IN"
            ? `Ishga kelish ${row.checkIn} da qayd etildi${row.lateMinutes ? ` (${row.lateMinutes} daq kechikish)` : ""}.`
            : `Ketish ${row.checkOut} da qayd etildi. Ishlagan vaqt: ${duration(row.workedMinutes)}.`,
        );
      } catch (reason) {
        committed.current = false;
        setQrToken(null);
        setError(errorText(reason, "Tekshiruv amalga oshmadi."));
        haptic("error");
      } finally {
        setBusy(false);
      }
    },
    [flow, gps, onSuccess],
  );

  // GPS tayyor va QR kerak bo‘lmasa — darhol yuboramiz.
  useEffect(() => {
    if (gpsState === "ok" && !flow.requiresQr && !committed.current && !error) void commit(null);
  }, [gpsState, flow.requiresQr, commit, error]);
  useEffect(() => {
    if (qrToken && gpsState === "ok") void commit(qrToken);
  }, [qrToken, gpsState, commit]);

  const onQr = (text: string) => {
    const value = text.trim();
    if (value.split(".").length !== 3) {
      setError("Bu Staffora davomat QR kodi emas. Filial ekranidagi QR’ni skanerlang.");
      haptic("warning");
      return false;
    }
    setError("");
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
    { label: "Face ID", state: "done" },
    { label: "GPS", state: gpsState === "ok" ? "done" : gpsState === "loading" ? "active" : "" },
    ...(flow.requiresQr
      ? [{ label: "QR", state: qrToken ? "done" : gpsState === "ok" ? "active" : "" }]
      : []),
    { label: "Tasdiq", state: busy ? "active" : "" },
  ];

  return (
    <div className="sheet-layer">
      <button className="sheet-backdrop" onClick={onClose} aria-label="Yopish" />
      <section className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-head">
          <div>
            <b>{flow.action === "CHECK_IN" ? "Ishga kelish" : "Ishdan ketish"}</b>
            <small>Face ID tasdiqlandi ✓ · {branch.name}</small>
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
          <span className="mini-ico">
            {gpsState === "loading" ? <LoaderCircle size={18} className="spin" /> : <Navigation size={18} />}
          </span>
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
            <small>
              {gps
                ? `Masofa: ${gps.distance} m · ruxsat: ${branch.radiusMeters} m · aniqlik ±${gps.accuracy} m`
                : gpsError || "GPS yoqilgan bo‘lsin"}
            </small>
          </span>
          {(gpsState === "far" || gpsState === "error") && (
            <button className="sheet-close" onClick={() => void locate()} aria-label="Qayta aniqlash">
              <RotateCcw size={16} />
            </button>
          )}
        </div>

        {flow.requiresQr && gpsState === "ok" && !busy && (
          <>
            {cameraOpen ? (
              <QrCamera onResult={(text) => onQr(text) && setCameraOpen(false)} />
            ) : null}
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
                <button className="mini-btn ghost" onClick={() => setCameraOpen(true)}>
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
              Davomatni faqat filial hududida belgilash mumkin. Filialga yaqinroq kelib, ↻
              tugmasini bosing.
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
        const detector = window.BarcodeDetector
          ? new window.BarcodeDetector({ formats: ["qr_code"] })
          : null;
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
      } catch {
        setError("Kamerani ochib bo‘lmadi. Telegram’ga kamera ruxsatini bering.");
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

/* -------------------------------------------------------------- history --- */
function MiniHistory({ home }: { home: HomeData }) {
  const [rows, setRows] = useState<Attendance[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void api<Attendance[]>("/mini/attendance")
      .then(setRows)
      .catch((e) => setError(errorText(e)));
  }, []);
  const today = tashkentIsoDate();
  const month = today.slice(0, 7);
  const [year, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
  const byDate = useMemo(() => new Map((rows || []).map((r) => [r.date, r])), [rows]);
  return (
    <div className="mini-body">
      <div className="mini-title">
        <h1>Davomat tarixi</h1>
        <p>{dateLongUz(today).split(" ").slice(1).join(" ")}</p>
      </div>
      <section className="mini-card">
        <div className="mini-cal">
          {weekOrder.map((d) => (
            <span key={d}>{weekdayShort[d]}</span>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <i key={`b${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const date = `${month}-${String(i + 1).padStart(2, "0")}`;
            const row = byDate.get(date);
            const weekday = dateParts(date).weekday;
            const workday = home.schedule?.days.find((d) => d.day === weekday)?.enabled ?? true;
            const tone = row?.checkIn
              ? row.lateMinutes
                ? "late"
                : "present"
              : date < today && workday && date >= home.employee.startDate
                ? "absent"
                : !workday
                  ? "off"
                  : "";
            return (
              <span key={date} className={`mini-cal-day ${tone} ${date === today ? "today" : ""}`}>
                {i + 1}
              </span>
            );
          })}
        </div>
        <div className="mini-legend">
          <span>
            <i style={{ background: "var(--m-success)" }} /> Vaqtida
          </span>
          <span>
            <i style={{ background: "var(--m-warn)" }} /> Kechikkan
          </span>
          <span>
            <i style={{ background: "var(--m-danger)" }} /> Kelmagan
          </span>
        </div>
      </section>
      {error && (
        <div className="mini-alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
      <section className="mini-card">
        {rows === null ? (
          <div className="mini-loader">
            <LoaderCircle className="spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="mini-empty">
            <Clock3 size={28} />
            Hali davomat qaydlari yo‘q
          </div>
        ) : (
          <div className="mini-rows">
            {rows.map((item) => (
              <div className="mini-row" key={item.id}>
                <span className="mini-date">
                  <b>{dateParts(item.date).day}</b>
                  <small>{monthShortUz(item.date)}</small>
                </span>
                <span>
                  <b>
                    {item.checkIn || "—"} → {item.checkOut || "…"}
                  </b>
                  <small>
                    {item.workedMinutes ? duration(item.workedMinutes) : "Ish davom etmoqda"}
                    {item.lateMinutes ? ` · ${item.lateMinutes} daq kech` : ""}
                  </small>
                </span>
                <span className={`mini-chip ${item.lateMinutes ? "warn" : item.checkOut ? "ok" : "info"}`}>
                  {item.lateMinutes ? "Kechikdi" : item.checkOut ? "Vaqtida" : "Ishda"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- leave --- */
function MiniLeave({ onToast }: { onToast: (text: string, tone?: "ok" | "error") => void }) {
  const [rows, setRows] = useState<LeaveRequest[] | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(
    () =>
      api<LeaveRequest[]>("/mini/leave")
        .then(setRows)
        .catch((e) => onToast(errorText(e), "error")),
    [onToast],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const statusChip: Record<string, [string, string]> = {
    PENDING: ["Kutilmoqda", "warn"],
    APPROVED: ["Tasdiqlandi", "ok"],
    REJECTED: ["Rad etildi", "bad"],
    CANCELLED: ["Bekor qilindi", ""],
  };
  return (
    <div className="mini-body">
      <div className="mini-title">
        <h1>Ta’til</h1>
        <p>So‘rov yuboring va holatini kuzating</p>
      </div>
      <button className="mini-btn" onClick={() => setOpen(true)}>
        <CalendarDays size={18} /> Yangi so‘rov
      </button>
      <section className="mini-card">
        {rows === null ? (
          <div className="mini-loader">
            <LoaderCircle className="spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="mini-empty">
            <Plane size={28} />
            Hali so‘rov yubormagansiz
          </div>
        ) : (
          <div className="mini-rows">
            {rows.map((item) => {
              const [label, tone] = statusChip[item.status] || [item.status, ""];
              return (
                <div className="mini-row" key={item.id}>
                  <span className="mini-ico">
                    <Plane size={18} />
                  </span>
                  <span>
                    <b>{leaveTypeLabel[item.type] || item.type}</b>
                    <small>
                      {dateUz(item.startDate)} – {dateUz(item.endDate)}
                    </small>
                    {item.status === "PENDING" && (
                      <button
                        style={{ border: 0, background: "none", padding: "4px 0 0", color: "var(--m-danger)", fontSize: 12.5, textAlign: "left", fontWeight: 600 }}
                        onClick={async () => {
                          try {
                            await patch(`/mini/leave/${item.id}/cancel`);
                            onToast("So‘rov bekor qilindi");
                            void load();
                          } catch (reason) {
                            onToast(errorText(reason), "error");
                          }
                        }}
                      >
                        Bekor qilish
                      </button>
                    )}
                  </span>
                  <span className={`mini-chip ${tone}`}>{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
      {open && (
        <LeaveSheet
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onToast("So‘rov HR’ga yuborildi");
            haptic("success");
            void load();
          }}
        />
      )}
    </div>
  );
}

function LeaveSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const today = tashkentIsoDate();
  const [form, setForm] = useState({ type: "VACATION", startDate: today, endDate: today, reason: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/mini/leave", form);
      onSaved();
    } catch (reason) {
      setError(errorText(reason, "So‘rov yuborilmadi."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sheet-layer">
      <button className="sheet-backdrop" onClick={onClose} aria-label="Yopish" />
      <section className="sheet">
        <div className="sheet-head">
          <div>
            <b>Ta’til so‘rovi</b>
            <small>HR ko‘rib chiqadi, javob Telegram’ga keladi</small>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Yopish">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={save}>
          <label>
            Turi
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {Object.entries(leaveTypeLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid-2">
            <label>
              Boshlanish
              <input
                type="date"
                value={form.startDate}
                onChange={(e) =>
                  setForm({
                    ...form,
                    startDate: e.target.value,
                    endDate: form.endDate < e.target.value ? e.target.value : form.endDate,
                  })
                }
                required
              />
            </label>
            <label>
              Tugash
              <input type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
            </label>
          </div>
          <label>
            Sabab
            <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required minLength={3} placeholder="Qisqacha yozing" />
          </label>
          {error && (
            <div className="mini-alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}
          <button className="mini-btn" disabled={busy}>
            {busy ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}
            {busy ? "Yuborilmoqda…" : "Yuborish"}
          </button>
        </form>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------- profile --- */
function MiniProfile({ data }: { data: HomeData }) {
  const e = data.employee;
  return (
    <div className="mini-body">
      <div className="mini-profile">
        <PhotoAvatar employee={e} />
        <h1>
          {e.firstName} {e.lastName}
        </h1>
        <p>
          {data.position?.name || "—"} · {e.employeeNo}
        </p>
      </div>
      <section className="mini-card mini-kv">
        <div>
          <span>Kompaniya</span>
          <b>{data.company?.name || "—"}</b>
        </div>
        <div>
          <span>Bo‘lim</span>
          <b>{data.department?.name || "—"}</b>
        </div>
        <div>
          <span>Filial</span>
          <b>{data.branch?.name || "—"}</b>
        </div>
        <div>
          <span>Grafik</span>
          <b>{data.schedule?.name || "—"}</b>
        </div>
        <div>
          <span>Ish boshlagan</span>
          <b>{dateUz(e.startDate)}</b>
        </div>
      </section>
      <section className="mini-card mini-kv">
        <div>
          <span>Telefon</span>
          <b>{e.phone}</b>
        </div>
        <div>
          <span>Telegram</span>
          <b>{e.telegramConnected ? "Ulangan ✓" : "Ulanmagan"}</b>
        </div>
        <div>
          <span>Face ID</span>
          <b>{e.faceEnrolledAt ? `Faol · ${dateUz(e.faceEnrolledAt)}` : "Sozlanmagan"}</b>
        </div>
      </section>
      {data.branch && (
        <section className="mini-card">
          <div className="mini-row" style={{ border: 0, padding: 0 }}>
            <span className="mini-ico">
              <Building2 size={18} />
            </span>
            <span>
              <b>{data.branch.name}</b>
              <small>{data.branch.address}</small>
            </span>
          </div>
        </section>
      )}
      <p style={{ textAlign: "center", color: "var(--m-muted)", fontSize: 12 }}>
        Ma’lumotlarni o‘zgartirish uchun HR bo‘limiga murojaat qiling.
      </p>
    </div>
  );
}

function ShiftProgress({ start, end, now }: { start: string; end: string; now: Date }) {
  const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
  const current = toMin(tashkentClock(now));
  const total = Math.max(1, toMin(end) - toMin(start));
  const done = Math.min(total, Math.max(0, current - toMin(start)));
  const left = Math.max(0, toMin(end) - current);
  const percent = Math.round((done / total) * 100);
  return (
    <div className="mini-shift" aria-label={`Ish kuni ${percent}%`}>
      <div className="mini-shift-bar">
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="mini-shift-text">
        <span>{percent}% bajarildi</span>
        <span>{left ? `${Math.floor(left / 60)} soat ${left % 60} daq qoldi` : "Ish vaqti tugadi"}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- xabarnomalar --- */

const notifKinds: Record<string, { icon: typeof Bell; tone: string; label: string }> = {
  ATTENDANCE: { icon: Clock3, tone: "warn", label: "Davomat" },
  LEAVE: { icon: Plane, tone: "blue", label: "Ta’til" },
  ANNOUNCEMENT: { icon: Megaphone, tone: "green", label: "E’lon" },
};
const kindOf = (type: string) => notifKinds[type] || { icon: Bell, tone: "gray", label: "Xabar" };

function relativeTime(iso: string) {
  const diff = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (diff < 1) return "hozir";
  if (diff < 60) return `${diff} daq oldin`;
  const day = tashkentIsoDate(new Date(iso));
  if (day === tashkentIsoDate()) return tashkentClock(new Date(iso));
  return `${dateUz(day)}, ${tashkentClock(new Date(iso))}`;
}
function dayGroup(iso: string) {
  const day = tashkentIsoDate(new Date(iso));
  if (day === tashkentIsoDate()) return "Bugun";
  if (day === tashkentIsoDate(new Date(Date.now() - 86_400_000))) return "Kecha";
  return dateLongUz(day);
}

function NotifItem({ item, onOpen }: { item: Notification; onOpen?: () => void }) {
  const kind = kindOf(item.type);
  const Icon = kind.icon;
  return (
    <button className={`mn-item ${item.read ? "" : "unread"}`} onClick={onOpen}>
      <span className={`mn-icon ${kind.tone}`}>
        <Icon size={17} />
      </span>
      <span className="mn-text">
        <span className="mn-head">
          <b>{item.title.replace(/^📢\s*/, "")}</b>
          <time>{relativeTime(item.createdAt)}</time>
        </span>
        <small>{item.body}</small>
      </span>
      {!item.read && <i className="mn-dot" aria-label="O‘qilmagan" />}
    </button>
  );
}

function NotificationsSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Notification | null>(null);
  useEffect(() => {
    api<{ items: Notification[] }>("/mini/notifications")
      .then((r) => setItems(r.items))
      .catch((reason) => setError(errorText(reason)));
  }, []);
  const markRead = async (ids?: string[]) => {
    setItems((list) => list?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) || null);
    await post("/mini/notifications/read", ids ? { ids } : { all: true }).catch(() => undefined);
    onChanged();
  };
  const unread = items?.filter((n) => !n.read).length || 0;
  const groups = (items || []).reduce<[string, Notification[]][]>((acc, n) => {
    const label = dayGroup(n.createdAt);
    const group = acc.find(([key]) => key === label);
    if (group) group[1].push(n);
    else acc.push([label, [n]]);
    return acc;
  }, []);
  return (
    <div className="sheet-layer">
      <button className="sheet-backdrop" onClick={onClose} aria-label="Yopish" />
      <section className="sheet mn-sheet">
        <div className="sheet-head">
          <div>
            <b>Xabarnomalar</b>
            <small>{unread ? `${unread} ta o‘qilmagan` : "Hammasi o‘qilgan"}</small>
          </div>
          {unread > 0 && (
            <button className="mn-readall" onClick={() => void markRead()}>
              <CheckCheck size={15} /> O‘qildi
            </button>
          )}
          <button className="sheet-close" onClick={onClose} aria-label="Yopish">
            <X size={18} />
          </button>
        </div>
        {error ? (
          <div className="mini-alert warn">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        ) : !items ? (
          <div className="mn-loading">
            <LoaderCircle className="spin" size={22} />
          </div>
        ) : !items.length ? (
          <div className="mini-empty">
            <Bell size={26} />
            <b>Xabarlar yo‘q</b>
            <small>E’lonlar, ta’til javoblari va eslatmalar shu yerda ko‘rinadi.</small>
          </div>
        ) : (
          <div className="mn-scroll">
            {groups.map(([label, rows]) => (
              <div key={label} className="mn-group">
                <div className="mn-day">{label}</div>
                <div className="mn-list">
                  {rows.map((item) => (
                    <NotifItem
                      key={item.id}
                      item={item}
                      onOpen={() => {
                        setOpen(item);
                        if (!item.read) void markRead([item.id]);
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {open && (
          <div className="mn-detail" role="dialog" aria-label={open.title}>
            <button className="mn-back" onClick={() => setOpen(null)}>
              <ChevronRight size={16} style={{ transform: "rotate(180deg)" }} /> Orqaga
            </button>
            <span className={`mn-icon lg ${kindOf(open.type).tone}`}>
              {(() => {
                const Icon = kindOf(open.type).icon;
                return <Icon size={22} />;
              })()}
            </span>
            <small className="mn-kind">
              {kindOf(open.type).label} · {relativeTime(open.createdAt)}
            </small>
            <h2>{open.title.replace(/^📢\s*/, "")}</h2>
            <p>{open.body}</p>
          </div>
        )}
      </section>
    </div>
  );
}
