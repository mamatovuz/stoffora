import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowDown, Bell, BriefcaseBusiness, CheckCircle2, Clock3, Home, LoaderCircle, Plane, RefreshCw, RotateCcw, Send, UserRound, WifiOff } from "lucide-react";
import { ApiError, api, errorText, post, restoreBearerToken, setBearerToken } from "../api";
import { FaceScanner, preloadFaceModels, type FaceCapture } from "../components/FaceScanner";
import { enqueueOffline, isNetworkError, readQueue, restoreQueueBackup, syncOfflineQueue } from "./miniOffline";
import { tashkentClock } from "@/lib/format";
import { haversineDistance } from "@/lib/attendance";
import { parseDeepLink, type DeepLink } from "@/lib/mini";
import type { Attendance } from "@/lib/types";
import stafforaMark from "../assets/staffora-mark.svg";
import { requestManagerAuth, type ManagerAuth, type ManagerView } from "./mini/managerAuth";
import { SalarySheet } from "./MiniMoney";
import { NotificationsSheet } from "./mini/Notifications";
import { clearCached } from "./miniCache";
import { applyPrefs, DEFAULT_PREFS, loadCloudPrefs, readPrefs, savePrefs, type MiniPrefs } from "./miniPrefs";
import { rememberLang, startTranslator, storedLang, type Lang } from "../i18n";
import { MiniHome } from "./mini/Home";
import { AttendanceFlow, getPosition, prefetchPosition, takePrefetchedPosition, type Flow } from "./mini/AttendanceFlow";
import { biometricInfo, disableBiometric, enableBiometric, quickProof, type BioInfo } from "./mini/biometric";
import { PhotoAvatar, usePullToRefresh, type Action, type HomeData, type Tab } from "./mini/shared";
import { forwardMinutes } from "@/lib/shift-time";
import {
  askWriteAccessOnce,
  bindErrorReporting,
  bindViewport,
  confirmNative,
  haptic,
  isMobile,
  kvGet,
  kvSet,
  reportError,
  setWorkEmojiStatus,
  supports,
  tg,
  useBackButton,
  useSettingsButton,
} from "./mini/tg";
import type { ProfileSection } from "./mini/Profile";
import type { HelpdeskView } from "./mini/Helpdesk";
import { disableZoom } from "./mini/noZoom";
import { BirthdaysSheet } from "./mini/Birthdays";
import { FaceCheck } from "./mini/FaceCheck";

// Bo‘limlar kerak bo‘lganda yuklanadi — birinchi ochilish tezroq.
const MiniHistory = lazy(() => import("./mini/History").then((m) => ({ default: m.MiniHistory })));
const MiniRequests = lazy(() => import("./mini/Requests").then((m) => ({ default: m.MiniRequests })));
const MiniProfile = lazy(() => import("./mini/Profile").then((m) => ({ default: m.MiniProfile })));
const ManagerHome = lazy(() => import("./MiniManager").then((m) => ({ default: m.ManagerHome })));
const DirectorySheet = lazy(() => import("./mini/Directory").then((m) => ({ default: m.DirectorySheet })));
const BadgeSheet = lazy(() => import("./mini/Badge").then((m) => ({ default: m.BadgeSheet })));
const HelpdeskSheet = lazy(() => import("./mini/Helpdesk").then((m) => ({ default: m.HelpdeskSheet })));
const Receipt = lazy(() => import("./mini/Receipt").then((m) => ({ default: m.Receipt })));

type AuthError = { message: string; code?: string; botUsername?: string };
type Nav = { tab: Tab; key: number; view?: string; id?: string; section?: ProfileSection };

const EMOJI_KEY = "staffora_work_emoji";
const BIO_OFFER_KEY = "staffora_bio_offer";

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

/** Bot xabaridagi tugma (?go=) yoki t.me havolasi (startapp=go_…) — qaysi bo‘limni ochish. */
function initialLink(): DeepLink | null {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get("go");
    return parseDeepLink(fromQuery || tg()?.initDataUnsafe?.start_param);
  } catch {
    return null;
  }
}

export function MiniAppPage() {
  const [notifOpen, setNotifOpen] = useState(false);
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [helpdesk, setHelpdesk] = useState<{ view?: HelpdeskView; id?: string } | null>(null);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [birthdaysOpen, setBirthdaysOpen] = useState(false);
  /** Davomat natijasi «cheki»; yopilgach (kerak bo‘lsa) biometriya taklif qilinadi. */
  const [receipt, setReceipt] = useState<{ row: Attendance; action: Action; method: Flow["method"] } | null>(null);
  const afterReceipt = useRef<(() => void) | null>(null);
  const receiptOpen = useRef(false);
  receiptOpen.current = Boolean(receipt);
  const [prefs, setPrefsState] = useState<MiniPrefs>(() => readPrefs() || DEFAULT_PREFS);
  useEffect(() => {
    applyPrefs(prefs);
    window.dispatchEvent(new Event("staffora:mini-theme"));
  }, [prefs]);
  useEffect(() => {
    // Boshqa qurilmada tanlangan ko‘rinish (faqat bu qurilmada hali tanlanmagan bo‘lsa).
    if (!readPrefs()) void loadCloudPrefs().then((cloud) => cloud && setPrefsState(cloud));
  }, []);
  const changePrefs = useCallback((next: MiniPrefs) => {
    setPrefsState(next);
    savePrefs(next);
    haptic.select();
  }, []);
  // Rahbar rejimi: panel hisobi Telegram’ga ulangan bo‘lsa — «Rahbar» bo‘limi.
  const [manager, setManager] = useState<ManagerAuth | null>(null);
  const [managerChecked, setManagerChecked] = useState(false);
  const checkManager = useCallback(async () => {
    const result = await requestManagerAuth(tg()?.initData || "");
    setManager(result);
    setManagerChecked(true);
  }, []);
  useEffect(() => {
    void checkManager();
  }, [checkManager]);
  const [authError, setAuthError] = useState<AuthError | null>(null);
  const [home, setHomeState] = useState<HomeData | null>(() => readCachedHome());
  // Keshdan ko‘rsatilgan (hali serverdan tasdiqlanmagan) holat — amallar vaqtincha kutadi.
  const [stale, setStale] = useState(() => home !== null);
  const setHome = useCallback((next: HomeData) => {
    setHomeState(next);
    setStale(false);
    writeCachedHome(next);
  }, []);
  const [nav, setNav] = useState<Nav>({ tab: "home", key: 0 });
  const setTab = useCallback((tab: Tab) => setNav((current) => ({ tab, key: current.key + 1 })), []);
  const [loading, setLoading] = useState(() => !readCachedHome());
  const [faceAction, setFaceAction] = useState<Action | null>(null);
  /** Biometriyani ulash uchun yuz tekshiruvi (davomatsiz). */
  const [bioEnroll, setBioEnroll] = useState(false);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  // Internetsiz rejim: keshdagi ma’lumot ko‘rsatiladi, belgilar telefonda saqlanadi.
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  const [queued, setQueued] = useState(() => readQueue().length);
  const [bio, setBio] = useState<BioInfo | null>(null);
  const [emojiStatus, setEmojiStatusPref] = useState(false);
  const captureRef = useRef<FaceCapture | null>(null);
  const lastFaceProof = useRef<{ proof: string; at: number } | null>(null);
  const homeRef = useRef<HomeData | null>(home);
  homeRef.current = home;
  const [lang, setLangState] = useState<Lang>(
    () => storedLang() || readCachedHome()?.employee.language || (tg()?.initDataUnsafe?.user?.language_code === "ru" ? "ru" : "uz"),
  );
  useEffect(() => {
    document.documentElement.lang = lang;
    return startTranslator(document.body, lang);
  }, [lang]);
  useEffect(() => {
    // Til boshqa qurilmada tanlangan bo‘lsa — profildagini olamiz.
    if (!storedLang() && home?.employee.language) setLangState(home.employee.language);
  }, [home?.employee.language]);
  const changeLang = useCallback((next: Lang) => {
    rememberLang(next);
    setLangState(next);
    haptic.select();
    void post("/mini/language", { language: next }).catch(() => undefined);
  }, []);

  const showToast = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    setToast({ text, tone });
    if (tone === "error") haptic.error();
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 4500);
  }, []);
  const loadHome = useCallback(async () => {
    setHome(await api<HomeData>("/mini/home"));
  }, [setHome]);
  const refreshBio = useCallback(() => void biometricInfo().then(setBio), []);

  /** Saqlangan internetsiz belgilarni yuboradi va natijani ko‘rsatadi. */
  const flushQueue = useCallback(async () => {
    if (!readQueue().length) return;
    const results = await syncOfflineQueue();
    setQueued(readQueue().length);
    if (!results.length) return;
    const ok = results.filter((r) => r.ok && !r.duplicate);
    const failed = results.filter((r) => !r.ok);
    if (ok.length) {
      showToast(`Internetsiz belgilar yuborildi: ${ok.map((r) => r.message).join(" ")}`);
      haptic.success();
    }
    if (failed.length) showToast(failed.map((r) => r.message).join(" "), "error");
    await loadHome().catch(() => undefined);
  }, [loadHome, showToast]);

  useEffect(() => {
    const onQueue = () => setQueued(readQueue().length);
    const goOffline = () => setOffline(true);
    const goOnline = () => {
      // Aloqa qaytdi: sessiyani yangilaymiz va navbatni yuboramiz.
      void authenticateRef.current?.();
    };
    window.addEventListener("staffora:offline-queue", onQueue);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("staffora:offline-queue", onQueue);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

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
        throw Object.assign(new Error("Mini App Telegram tashqarisida ochildi. Uni botdagi «Staffora» tugmasi orqali oching."), { code: "NO_INIT_DATA" });
      }
      const result = await post<{ token: string; home?: HomeData }>("/telegram/auth", { initData: webApp?.initData || "" });
      setBearerToken(result.token);
      setOffline(false);
      // Server bosh sahifani auth javobida qaytaradi — alohida so‘rov kerak emas.
      if (result.home) setHome(result.home);
      else await loadHome();
      void flushQueue();
      askWriteAccessOnce();
    } catch (reason) {
      if (isNetworkError(reason) && readCachedHome()) {
        // Aloqa yo‘q, lekin bugungi ma’lumot bor — ilova ishlashda davom etadi.
        setOffline(true);
        return;
      }
      const code = reason instanceof ApiError ? reason.code : (reason as { code?: string })?.code;
      if (code !== "NOT_LINKED" && code !== "NO_INIT_DATA") reportError("auth", errorText(reason), code);
      setAuthError({
        message: errorText(reason, "Kirish amalga oshmadi."),
        code,
        botUsername: reason instanceof ApiError ? (reason.data?.botUsername as string | undefined) : undefined,
      });
    } finally {
      setLoading(false);
      webApp?.ready();
    }
  }, [loadHome, setHome, flushQueue]);
  const authenticateRef = useRef<(() => Promise<void>) | null>(null);
  authenticateRef.current = authenticate;

  useEffect(() => {
    const webApp = tg();
    bindErrorReporting();
    // Keshdan ko‘rsatilayotgan bo‘lsa, Telegram yuklanish belgisini darhol olib tashlaymiz.
    if (home) webApp?.ready();
    webApp?.expand();
    webApp?.disableVerticalSwipes?.();
    // Telegram 8.0+: telefonlarda to‘liq ekran rejimi.
    if (isMobile() && supports("8.0")) {
      try {
        webApp?.requestFullscreen?.();
      } catch {
        /* qo‘llab-quvvatlanmasa oddiy rejimda qoladi */
      }
    }
    const unbind = bindViewport();
    const allowZoom = disableZoom();
    document.title = "Staffora";
    // Internetsiz ochilish uchun ilova qobig‘i va Face ID modellarini keshlaymiz.
    if ("serviceWorker" in navigator && (window.isSecureContext || location.hostname === "localhost"))
      navigator.serviceWorker.register("/mini-sw.js").catch(() => undefined);
    void restoreQueueBackup().then(() => setQueued(readQueue().length));
    void authenticate();
    refreshBio();
    void kvGet("cloud", EMOJI_KEY).then((value) => setEmojiStatusPref(value === "1"));
    return () => {
      unbind();
      allowZoom();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticate]);

  /*
   * Face ID modeli (~6 MB, WebGL) faqat kerak bo‘lganda oldindan yuklanadi: bosh sahifada,
   * xodim bugun hali belgilashi kerak bo‘lsa va brauzer bo‘sh turganda. Rahbar xarita ko‘rayotganda
   * yoki ish kuni tugaganda telefon protsessori va GPU’si band qilinmaydi.
   */
  const needsFace = Boolean(home && nav.tab === "home" && home.branch && !home.attendance?.checkOut && !home.todayLeave);
  useEffect(() => {
    if (!needsFace) return;
    const run = () => void preloadFaceModels().catch(() => undefined);
    const idle = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (idle.requestIdleCallback) {
      const handle = idle.requestIdleCallback(run, { timeout: 2500 });
      return () => idle.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(run, 1200);
    return () => window.clearTimeout(timer);
  }, [needsFace]);

  // Ilova qayta ochilganda (fon rejimidan) ma’lumotni yangilaymiz.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && home) void loadHome().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [home, loadHome]);

  // Davomat jarayonida Mini App tasodifan yopilib ketmasin.
  useEffect(() => {
    const webApp = tg();
    if (!supports("6.2")) return;
    if (faceAction || flow || bioEnroll) webApp?.enableClosingConfirmation?.();
    else webApp?.disableClosingConfirmation?.();
  }, [faceAction, flow, bioEnroll]);

  /* ------------------------------------------------------- navigatsiya --- */
  const navigate = useCallback(
    (link: DeepLink) => {
      haptic.select();
      setNotifOpen(false);
      setSalaryOpen(false);
      if (link.tab === "home") {
        setTab("home");
        if (link.action === "salary") setSalaryOpen(true);
        if (link.action === "notifs") setNotifOpen(true);
        return;
      }
      if (link.tab === "badge") {
        setBadgeOpen(true);
        return;
      }
      if (link.tab === "profile" && link.section === "directory") {
        setDirectoryOpen(true);
        return;
      }
      if (link.tab === "profile" && link.section === "helpdesk") {
        setHelpdesk({ id: link.id });
        return;
      }
      if (link.tab === "profile" && link.section === "birthdays") {
        setBirthdaysOpen(true);
        return;
      }
      setNav((current) => ({
        tab: link.tab,
        key: current.key + 1,
        view: "view" in link ? link.view : undefined,
        id: "id" in link ? link.id : undefined,
        section: link.tab === "profile" ? link.section : undefined,
      }));
    },
    [setTab],
  );
  // Bot xabaridagi havola bilan ochilgan bo‘lsa — kerakli bo‘limga (bir marta, kirgandan keyin).
  const pendingLink = useRef<DeepLink | null>(initialLink());
  useEffect(() => {
    const link = pendingLink.current;
    if (!link || (!home && !manager)) return;
    if (link.tab === "manager" && !manager) {
      if (!managerChecked) return;
      pendingLink.current = null;
      return;
    }
    pendingLink.current = null;
    if (link.tab === "home" && (link.action === "checkin" || link.action === "checkout")) {
      const a = home?.attendance;
      const wanted = link.action === "checkin" ? !a?.checkIn : Boolean(a?.checkIn && !a.checkOut);
      if (wanted && home?.branch) window.setTimeout(() => void startAction(link.action === "checkin" ? "CHECK_IN" : "CHECK_OUT"), 400);
      return;
    }
    navigate(link);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home, manager, managerChecked, navigate]);

  // «⋯» → «Sozlamalar»
  useSettingsButton(() => navigate({ tab: "profile", section: "settings" }));

  // Telegram «Orqaga» tugmasi
  const anyOpen = notifOpen || salaryOpen || directoryOpen || Boolean(helpdesk) || badgeOpen || birthdaysOpen || Boolean(receipt) || Boolean(flow) || Boolean(faceAction) || bioEnroll;
  useBackButton(
    anyOpen || nav.tab !== "home"
      ? () => {
          if (notifOpen) setNotifOpen(false);
          else if (salaryOpen) setSalaryOpen(false);
          else if (directoryOpen) setDirectoryOpen(false);
          else if (receipt) closeReceipt();
          else if (helpdesk) setHelpdesk(null);
          else if (badgeOpen) setBadgeOpen(false);
          else if (birthdaysOpen) setBirthdaysOpen(false);
          else if (flow) setFlow(null);
          else if (faceAction) setFaceAction(null);
          else if (bioEnroll) setBioEnroll(false);
          else setTab("home");
        }
      : null,
  );

  /* ---------------------------------------------------------- davomat --- */
  const startSession = useCallback(
    async (action: Action, faceProof: string, method: Flow["method"], photo?: string) => {
      const session = await post<{ id: string; requiresQr: boolean }>("/mini/attendance/session", { action, faceProof });
      setFaceAction(null);
      setFlow({ sessionId: session.id, action, requiresQr: session.requiresQr, photo, method });
    },
    [],
  );

  /** «Ishga keldim / ketdim»: biometriya ulangan bo‘lsa — barmoq izi, bo‘lmasa Face ID. */
  async function startAction(action: Action) {
    const current = homeRef.current;
    if (!current) return;
    haptic.tap("medium");
    prefetchPosition();
    const canQuick = Boolean(current.features?.biometric && current.features.biometricRegistered && bio?.tokenSaved && current.employee.faceEnrolledAt && !offline);
    if (canQuick) {
      try {
        const result = await quickProof(action === "CHECK_IN" ? "Ishga kelishni tasdiqlang" : "Ishdan ketishni tasdiqlang");
        if (result.kind === "cancel") return;
        if (result.kind === "proof") return await startSession(action, result.proof, "BIOMETRIC");
        showToast("Xavfsizlik uchun bu safar yuzingizni tekshiramiz");
        refreshBio();
      } catch (reason) {
        if (isNetworkError(reason)) setOffline(true);
        else return showToast(errorText(reason), "error");
      }
    }
    setFaceAction(action);
  }

  /** Aloqa yo‘q: belgini (yuz + GPS + vaqt) telefonda saqlaydi, ekranni darhol yangilaydi. */
  const saveOffline = async (action: Action, gpsIn?: { lat: number; lng: number; accuracy: number }) => {
    const current = homeRef.current;
    const capture = captureRef.current;
    setFaceAction(null);
    setFlow(null);
    try {
      if (!current?.branch) throw new Error("Filial biriktirilmagan.");
      if (!capture) throw new Error("Face ID ma’lumoti yo‘q — qayta urinib ko‘ring.");
      let gps = gpsIn;
      if (!gps) {
        const position: GeolocationPosition =
          (await takePrefetchedPosition()) ??
          (await getPosition(true).catch((reason) => ((reason as GeolocationPositionError)?.code === 1 ? Promise.reject(reason) : getPosition(false))));
        gps = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: Math.round(position.coords.accuracy) };
      }
      const distance = haversineDistance(gps.lat, gps.lng, current.branch.latitude, current.branch.longitude);
      if (distance - Math.min(35, gps.accuracy) > current.branch.radiusMeters)
        throw new Error(`Siz filial hududidan ${Math.round(distance - current.branch.radiusMeters)} m tashqaridasiz. Filialga yaqinroq keling.`);
      enqueueOffline({
        action,
        descriptor: capture.descriptor,
        turnDescriptor: capture.turnDescriptor,
        latitude: gps.lat,
        longitude: gps.lng,
        accuracy: gps.accuracy,
        photoDataUrl: capture.photo,
      });
      captureRef.current = null;
      setQueued(readQueue().length);
      // Ekranni darhol yangilaymiz (server keyin tasdiqlaydi).
      const time = tashkentClock();
      const base = current.attendance;
      const optimistic: HomeData = {
        ...current,
        attendance:
          action === "CHECK_IN"
            ? ({ ...(base || {}), checkIn: time, lateMinutes: 0, status: "PRESENT", flags: ["OFFLINE"] } as Attendance)
            : ({ ...(base as Attendance), checkOut: time, flags: ["OFFLINE"] } as Attendance),
      };
      setHomeState(optimistic);
      writeCachedHome(optimistic);
      showToast(`Internet yo‘q — ${action === "CHECK_IN" ? "kelish" : "ketish"} ${time} da telefonda saqlandi. Aloqa tiklanishi bilan avtomatik yuboriladi.`);
      haptic.success();
    } catch (reason) {
      const code = (reason as GeolocationPositionError)?.code;
      showToast(code === 1 ? "Joylashuvga ruxsat berilmagan." : errorText(reason, "Belgini saqlab bo‘lmadi."), "error");
    }
  };

  const onVerified = async (faceProof: string, _score: number, photo?: string) => {
    lastFaceProof.current = { proof: faceProof, at: Date.now() };
    if (bioEnroll) {
      setBioEnroll(false);
      try {
        const ok = await enableBiometric(faceProof);
        showToast(ok ? "Biometriya ulandi — endi bir tegishda tasdiqlaysiz" : "Biometriyaga ruxsat berilmadi", ok ? "ok" : "error");
        if (ok) haptic.success();
      } catch (reason) {
        showToast(errorText(reason), "error");
      }
      refreshBio();
      void loadHome().catch(() => undefined);
      return;
    }
    const action = faceAction!;
    try {
      await startSession(action, faceProof, "FACE", photo);
    } catch (reason) {
      if (isNetworkError(reason) && home?.employee.faceEnrolledAt) return void (await saveOffline(action));
      setFaceAction(null);
      showToast(errorText(reason), "error");
    }
    if (!home?.employee.faceEnrolledAt) void loadHome();
  };

  /** Davomat muvaffaqiyatli: emoji-status, biometriya taklifi, ma’lumotni yangilash. */
  function closeReceipt() {
    setReceipt(null);
    const next = afterReceipt.current;
    afterReceipt.current = null;
    if (next) window.setTimeout(next, 250);
  }
  const onAttendanceSuccess = async (row: Attendance, _message: string, method: Flow["method"]) => {
    const action: Action = row.checkOut ? "CHECK_OUT" : "CHECK_IN";
    setFlow(null);
    setReceipt({ row, action, method });
    haptic.success();
    clearCached("stats");
    await loadHome().catch(() => undefined);
    const current = homeRef.current;
    if (row.checkIn && !row.checkOut && emojiStatus && current?.features?.workEmojiId) {
      const end = current.schedule?.days.find((d) => d.enabled && d.end)?.end;
      const minutes = end ? forwardMinutes(row.checkIn, row.scheduledEnd || end) : 480;
      void setWorkEmojiStatus(current.features.workEmojiId, Math.max(30, minutes));
    }
    // Birinchi marta Face ID bilan belgilaganlarga biometriyani taklif qilamiz (ko‘pi bilan 2 marta).
    const info = await biometricInfo();
    const proof = lastFaceProof.current;
    if (method === "FACE" && current?.features?.biometric && info.available && !info.tokenSaved && proof && Date.now() - proof.at < 150_000) {
      const offered = Number((await kvGet("cloud", BIO_OFFER_KEY)) || 0);
      if (offered >= 2) return;
      // Taklif chek yopilgandan keyin chiqadi — ikki oyna ustma-ust tushmasin.
      const offer = () => void offerBiometric(info.type, proof.proof, offered);
      if (receiptOpen.current) afterReceipt.current = offer;
      else offer();
    }
  };

  const offerBiometric = async (type: BioInfo["type"], proof: string, offered: number) => {
    void kvSet("cloud", BIO_OFFER_KEY, String(offered + 1));
    const label = type === "face" ? "telefon yuz tanishi (Face ID)" : "barmoq izi";
    if (!(await confirmNative(`Keyingi safar ${label} bilan 1 soniyada tasdiqlaysizmi? Kamerani ochish shart bo‘lmaydi.`, { title: "Tezroq belgilash", ok: "Yoqish" }))) return;
    try {
      const ok = await enableBiometric(proof);
      showToast(ok ? "Biometriya ulandi" : "Biometriyaga ruxsat berilmadi", ok ? "ok" : "error");
    } catch (reason) {
      showToast(errorText(reason), "error");
    }
    refreshBio();
    void loadHome().catch(() => undefined);
  };

  const refreshAll = useCallback(async () => {
    clearCached("");
    await Promise.all([loadHome().catch(() => undefined), flushQueue()]);
    showToast("Yangilandi");
  }, [loadHome, flushQueue, showToast]);
  const ptr = usePullToRefresh(Boolean(home) && !offline && nav.tab === "home" && !anyOpen, refreshAll);

  if (loading || (!home && !managerChecked))
    return (
      <div className="mini">
        <div className="mini-splash">
          <img src={stafforaMark} alt="Staffora" />
          <LoaderCircle className="spin" size={24} />
        </div>
      </div>
    );

  const toastView = toast && (
    <button className={`mini-toast ${toast.tone === "error" ? "error" : ""}`} onClick={() => setToast(null)}>
      {toast.tone === "error" ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
      <span>
        <b>{toast.tone === "error" ? "Xatolik" : "Muvaffaqiyatli"}</b>
        <small>{toast.text}</small>
      </span>
    </button>
  );
  const fallback = (
    <div className="mini-loader">
      <LoaderCircle className="spin" />
    </div>
  );

  if (authError || !home) {
    // Xodim emas, lekin rahbar — faqat rahbar paneli.
    if (manager)
      return (
        <div className="mini">
          <main className="mini-app">
            <Suspense fallback={fallback}>
              <ManagerHome auth={manager} onToast={showToast} onExpired={() => void checkManager()} initialView={nav.tab === "manager" ? (nav.view as ManagerView) : undefined} key={nav.key} />
            </Suspense>
          </main>
          {toastView}
        </div>
      );
    return <AuthErrorScreen error={authError} onRetry={authenticate} />;
  }

  const quick = home.features?.biometric && home.features.biometricRegistered && bio?.tokenSaved ? (bio.type === "face" ? "face" : "finger") : null;

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
              haptic.tap();
              setNotifOpen(true);
            }}
          >
            <Bell size={21} />
            {(home.unreadNotifications || 0) > 0 && <span className="mini-badge">{Math.min(99, home.unreadNotifications || 0)}</span>}
          </button>
        </header>
        <div className={`ptr ${ptr.ready ? "ready" : ""}`} style={{ height: ptr.refreshing ? 36 : ptr.pull }} aria-hidden>
          {ptr.refreshing ? <LoaderCircle size={20} className="spin" /> : <ArrowDown size={20} />}
        </div>
        {(offline || queued > 0) && (
          <div className={`mini-offline ${offline ? "" : "sync"}`} role="status">
            {offline ? <WifiOff size={16} /> : <RefreshCw size={16} className="spin" />}
            <span>
              <b>{offline ? "Internet yo‘q" : "Yuborilmoqda…"}</b>
              <small>{queued > 0 ? `${queued} ta belgi telefonda saqlangan — aloqa tiklanishi bilan yuboriladi` : "Davomatni belgilashingiz mumkin — telefonda saqlanadi"}</small>
            </span>
            {!offline && queued > 0 && (
              <button onClick={() => void flushQueue()} aria-label="Hozir yuborish">
                <RefreshCw size={15} />
              </button>
            )}
          </div>
        )}
        <Suspense fallback={fallback}>
          {nav.tab === "home" && (
            <MiniHome
              data={home}
              quick={quick}
              onAction={(action) => void startAction(action)}
              stale={stale && !offline}
              offline={offline}
              onSalary={() => setSalaryOpen(true)}
              onNotifications={() => setNotifOpen(true)}
              onNavigate={navigate}
              onRefresh={() => loadHome().catch(() => undefined)}
              onToast={showToast}
              onHelpdesk={(view) => setHelpdesk({ view })}
              onBirthdays={() => setBirthdaysOpen(true)}
            />
          )}
          {nav.tab === "history" && <MiniHistory key={nav.key} home={home} initialView={nav.view as "calendar" | "schedule" | "stats" | undefined} />}
          {nav.tab === "leave" && <MiniRequests key={nav.key} onToast={showToast} initialView={nav.view as "leave" | "marks" | "swap" | "dayoff" | "overtime" | undefined} focusId={nav.id} />}
          {nav.tab === "manager" && manager && (
            <ManagerHome key={nav.key} auth={manager} onToast={showToast} onExpired={() => void checkManager()} initialView={nav.view as ManagerView | undefined} />
          )}
          {nav.tab === "profile" && (
            <MiniProfile
              data={home}
              onToast={showToast}
              lang={lang}
              onLang={changeLang}
              prefs={prefs}
              onPrefs={changePrefs}
              section={nav.section}
              focusId={nav.id}
              bio={bio}
              onBiometric={(enable) => {
                if (enable) {
                  if (!home.employee.faceEnrolledAt) return showToast("Avval Face ID’ni sozlang (birinchi davomatda)", "error");
                  showToast("Yuzingizni bir marta tekshiramiz — keyin biometriya ulanadi");
                  setBioEnroll(true);
                } else
                  void disableBiometric().then(() => {
                    showToast("Biometriya o‘chirildi");
                    refreshBio();
                    void loadHome().catch(() => undefined);
                  });
              }}
              emojiStatus={emojiStatus}
              onEmojiStatus={(enable) => {
                setEmojiStatusPref(enable);
                void kvSet("cloud", EMOJI_KEY, enable ? "1" : "0");
                const webApp = tg();
                if (enable && webApp?.requestEmojiStatusAccess && supports("8.0")) webApp.requestEmojiStatusAccess(() => undefined);
              }}
              onDirectory={() => setDirectoryOpen(true)}
              onBadge={() => setBadgeOpen(true)}
              onHelpdesk={(view) => setHelpdesk({ view })}
              onBirthdays={() => setBirthdaysOpen(true)}
            />
          )}
        </Suspense>
      </main>
      <nav
        className="mini-tabbar"
        style={{ "--n": manager ? 5 : 4, "--i": Math.max(0, ["home", "history", "leave", "profile", "manager"].indexOf(nav.tab)) } as React.CSSProperties}
      >
        {(
          [
            ["home", Home, "Asosiy"],
            ["history", Clock3, "Tarix"],
            ["leave", Plane, "So‘rovlar"],
            ["profile", UserRound, "Profil"],
            ...(manager ? ([["manager", BriefcaseBusiness, "Rahbar"]] as const) : []),
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            className={nav.tab === key ? "active" : ""}
            onClick={() => {
              haptic.select();
              setTab(key);
            }}
          >
            <Icon size={21} strokeWidth={nav.tab === key ? 2.3 : 1.9} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {/* Kundalik belgilash: kamera + ramka (qizil/yashil) + xarita. Birinchi marta va biometriya ulashda — to‘liq skaner. */}
      {faceAction && !bioEnroll && home.employee.faceEnrolledAt && (
        <FaceCheck
          action={faceAction}
          branch={home.branch}
          branches={home.branches}
          onClose={() => setFaceAction(null)}
          onVerified={onVerified}
          onCapture={(capture) => {
            captureRef.current = capture;
          }}
          onOffline={(capture) => {
            captureRef.current = capture;
            return saveOffline(faceAction);
          }}
        />
      )}
      {((faceAction && !home.employee.faceEnrolledAt) || bioEnroll) && (
        <FaceScanner
          enrolled={Boolean(home.employee.faceEnrolledAt)}
          onClose={() => {
            setFaceAction(null);
            setBioEnroll(false);
          }}
          onVerified={onVerified}
          onCapture={(capture) => {
            captureRef.current = capture;
          }}
          onOffline={(capture) => {
            captureRef.current = capture;
            if (bioEnroll) {
              setBioEnroll(false);
              showToast("Biometriyani ulash uchun internet kerak", "error");
              return Promise.resolve();
            }
            return saveOffline(faceAction!);
          }}
        />
      )}
      {flow && home.branch && (
        <AttendanceFlow
          flow={flow}
          branch={home.branch}
          branches={home.branches}
          onClose={() => setFlow(null)}
          onOffline={(gps) => void saveOffline(flow.action, gps)}
          onSuccess={(row, message) => void onAttendanceSuccess(row, message, flow.method)}
        />
      )}
      <Suspense fallback={null}>
        {salaryOpen && <SalarySheet onClose={() => setSalaryOpen(false)} onToast={showToast} />}
        {directoryOpen && <DirectorySheet onClose={() => setDirectoryOpen(false)} />}
        {badgeOpen && <BadgeSheet onClose={() => setBadgeOpen(false)} />}
        {helpdesk && <HelpdeskSheet onClose={() => setHelpdesk(null)} onToast={showToast} initialView={helpdesk.view} focusId={helpdesk.id} />}
        {birthdaysOpen && <BirthdaysSheet onClose={() => setBirthdaysOpen(false)} onToast={showToast} />}
        {receipt && (
          <Receipt
            row={receipt.row}
            action={receipt.action}
            method={receipt.method}
            branch={home.branch?.name}
            name={`${home.employee.firstName} ${home.employee.lastName}`}
            plannedEnd={receipt.row.scheduledEnd}
            onClose={closeReceipt}
          />
        )}
        {notifOpen && (
          <NotificationsSheet
            onClose={() => {
              setNotifOpen(false);
              void loadHome().catch(() => undefined);
            }}
            onChanged={() => void loadHome().catch(() => undefined)}
            onNavigate={navigate}
          />
        )}
      </Suspense>
      {toastView}
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
              <span>
                Botga qayting va <b>/start</b> bosing
              </span>
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
            <button className="mini-btn ghost-neutral" onClick={() => tg()?.close()}>
              Yopish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
