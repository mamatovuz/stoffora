import { Appearance } from "react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  accessToken,
  activate as activateApi,
  loadSession,
  login as loginApi,
  logout as logoutApi,
  onSessionSaved,
  onSignedOut,
  replacementStatus,
  type DeviceInfo,
  type Employee,
  type SessionMode,
  type StoredSession,
} from "./api";
import { removePin } from "./pin";
import { KEYS, secureGet, secureSet } from "./secure";
import { clearCache } from "./useData";

export type Prefs = {
  /** Ruxsatlar bilan tanishtiruv ko‘rsatilganmi. */
  onboarded?: boolean;
  /** Ilovani ochishda telefon biometriyasi (Face ID / barmoq izi) bilan qulf. */
  appLock?: boolean;
  /** Ilovaga kirishda 4 xonali PIN-kod (xeshi Keychain/Keystore’da, lib/pin.ts). */
  pinLock?: boolean;
  /** Yangi telefon so‘rovi (HR tasdig‘ini kutish) — faqat eski kod bilan faollashtirishda. */
  pendingRequestId?: string;
  /** Mavzu: tizimdagi kabi (standart), yorug‘ yoki qorong‘i. */
  theme?: "system" | "light" | "dark";
};
/** Ilova mavzusini qo‘llaydi (tizimdagi kabi — «unspecified»). */
export function applyTheme(theme?: Prefs["theme"]) {
  Appearance.setColorScheme(theme === "light" || theme === "dark" ? theme : "unspecified");
}
type State = "loading" | "signedOut" | "pending" | "signedIn";
type Ctx = {
  state: State;
  /** Xodim (keldi-ketdi + bo‘limlar) yoki direktor (faqat rahbar paneli). */
  mode: SessionMode | null;
  session: StoredSession | null;
  /** Xodim rejimida — xodim; direktorda — null. */
  employee: Employee | null;
  prefs: Prefs;
  signedOutReason?: string;
  setPrefs: (patch: Partial<Prefs>) => Promise<void>;
  /** Login + parol (2FA bo‘lsa — avval «2fa», keyin kod bilan qayta). */
  signIn: (login: string, password: string, device: DeviceInfo, code?: string) => Promise<{ kind: "session" } | { kind: "2fa"; message: string }>;
  /** Eski staffora://activate?code=… havolasi. */
  activate: (code: string, device: DeviceInfo) => Promise<"session" | "pending">;
  checkPending: () => Promise<"PENDING" | "APPROVED" | "REJECTED" | "CANCELLED">;
  cancelPending: () => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);
const same = (a: StoredSession | null, b: StoredSession | null) => JSON.stringify(a) === JSON.stringify(b);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("loading");
  const [session, setSession] = useState<StoredSession | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>({});
  const prefsRef = useRef<Prefs>({});
  const [signedOutReason, setReason] = useState<string>();

  useEffect(() => {
    let alive = true;
    (async () => {
      const [stored, savedPrefs] = await Promise.all([loadSession(), secureGet<Prefs>(KEYS.prefs)]);
      if (!alive) return;
      prefsRef.current = savedPrefs || {};
      setPrefsState(prefsRef.current);
      applyTheme(prefsRef.current.theme);
      if (stored) {
        setSession(stored);
        // Ilova darhol ochiladi, token fonda tayyorlanadi (ekranlar o‘sha so‘rovni kutadi — takrorlanmaydi).
        // Server sessiyani rad etsa — refresh() clearSession qiladi → onSignedOut → kirish ekrani.
        setState("signedIn");
        void accessToken().catch(() => undefined);
      } else setState(savedPrefs?.pendingRequestId ? "pending" : "signedOut");
    })();
    // Refresh rol/kompaniya nomini yangilashi mumkin — o‘zgargan bo‘lsagina qayta chiziladi.
    const offSaved = onSessionSaved((next) => setSession((prev) => (same(prev, next) ? prev : next)));
    const off = onSignedOut((reason) => {
      // Sessiya tugasa — PIN ham o‘chadi (telefon boshqa xodimga berilishi mumkin).
      void removePin();
      prefsRef.current = { ...prefsRef.current, pinLock: false, appLock: false };
      setPrefsState(prefsRef.current);
      void secureSet(KEYS.prefs, prefsRef.current);
      // Oldingi foydalanuvchi ma’lumotlari keyingisiga ko‘rinmasin.
      clearCache();
      setSession(null);
      setReason(reason);
      setState("signedOut");
    });
    return () => {
      alive = false;
      offSaved();
      off();
    };
  }, []);

  const setPrefs = useCallback(async (patch: Partial<Prefs>) => {
    if ("theme" in patch) applyTheme(patch.theme);
    prefsRef.current = { ...prefsRef.current, ...patch };
    setPrefsState(prefsRef.current);
    await secureSet(KEYS.prefs, prefsRef.current);
  }, []);

  const signedIn = useCallback(
    async (next: StoredSession) => {
      await setPrefs({ pendingRequestId: undefined });
      clearCache();
      setSession(next);
      setReason(undefined);
      setState("signedIn");
    },
    [setPrefs],
  );

  const signIn = useCallback<Ctx["signIn"]>(
    async (login, password, device, code) => {
      const result = await loginApi(login, password, device, code);
      if (result.kind === "2fa") return result;
      await signedIn(result.session);
      return { kind: "session" };
    },
    [signedIn],
  );

  const activate = useCallback<Ctx["activate"]>(
    async (code, device) => {
      const result = await activateApi(code, device);
      if (result.kind === "pending") {
        await setPrefs({ pendingRequestId: result.requestId });
        setState("pending");
        return "pending";
      }
      await signedIn(result.session);
      return "session";
    },
    [setPrefs, signedIn],
  );

  const checkPending = useCallback(async () => {
    if (!prefs.pendingRequestId) return "CANCELLED" as const;
    const status = await replacementStatus(prefs.pendingRequestId);
    if (status === "APPROVED") {
      const stored = await loadSession();
      if (stored) await signedIn(stored);
      else {
        await setPrefs({ pendingRequestId: undefined });
        setState("signedOut");
      }
    } else if (status !== "PENDING") {
      await setPrefs({ pendingRequestId: undefined });
      setState("signedOut");
    }
    return status;
  }, [prefs.pendingRequestId, setPrefs, signedIn]);

  const cancelPending = useCallback(async () => {
    await setPrefs({ pendingRequestId: undefined });
    setState("signedOut");
  }, [setPrefs]);

  const logout = useCallback(async () => {
    await logoutApi();
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      state,
      mode: session?.mode ?? null,
      session,
      employee: session?.mode === "employee" ? session.employee : null,
      prefs,
      signedOutReason,
      setPrefs,
      signIn,
      activate,
      checkPending,
      cancelPending,
      logout,
    }),
    [state, session, prefs, signedOutReason, setPrefs, signIn, activate, checkPending, cancelPending, logout],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("SessionProvider yo‘q");
  return ctx;
}
