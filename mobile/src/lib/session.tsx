import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, accessToken, activate as activateApi, loadSession, logout as logoutApi, onSignedOut, replacementStatus, type Employee } from "./api";
import { removePin } from "./pin";
import { KEYS, secureGet, secureSet } from "./secure";

export type Prefs = {
  /** Ruxsatlar bilan tanishtiruv ko‘rsatilganmi. */
  onboarded?: boolean;
  /** Ilovani ochishda telefon biometriyasi (Face ID / barmoq izi) bilan qulf. */
  appLock?: boolean;
  /** Ilovaga kirishda 4 xonali PIN-kod (xeshi Keychain/Keystore’da, lib/pin.ts). */
  pinLock?: boolean;
  /** Yangi telefon so‘rovi (HR tasdig‘ini kutish). */
  pendingRequestId?: string;
};
type State = "loading" | "signedOut" | "pending" | "signedIn";
type Ctx = {
  state: State;
  employee: Employee | null;
  prefs: Prefs;
  signedOutReason?: string;
  setPrefs: (patch: Partial<Prefs>) => Promise<void>;
  activate: (code: string, device: Parameters<typeof activateApi>[1]) => Promise<"session" | "pending">;
  checkPending: () => Promise<"PENDING" | "APPROVED" | "REJECTED" | "CANCELLED">;
  cancelPending: () => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("loading");
  const [employee, setEmployee] = useState<Employee | null>(null);
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
      if (stored) {
        setEmployee(stored.employee);
        try {
          await accessToken();
          if (alive) setState("signedIn");
        } catch (error) {
          // Internet yo‘q — sessiya saqlangan, ilova ochiladi (keyin yangilanadi).
          if (alive) setState(error instanceof ApiError && error.status === 401 ? "signedOut" : "signedIn");
        }
      } else setState(savedPrefs?.pendingRequestId ? "pending" : "signedOut");
    })();
    const off = onSignedOut((reason) => {
      // Sessiya tugasa — PIN ham o‘chadi (telefon boshqa xodimga berilishi mumkin).
      void removePin();
      prefsRef.current = { ...prefsRef.current, pinLock: false, appLock: false };
      setPrefsState(prefsRef.current);
      void secureSet(KEYS.prefs, prefsRef.current);
      setEmployee(null);
      setReason(reason);
      setState("signedOut");
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const setPrefs = useCallback(async (patch: Partial<Prefs>) => {
    prefsRef.current = { ...prefsRef.current, ...patch };
    setPrefsState(prefsRef.current);
    await secureSet(KEYS.prefs, prefsRef.current);
  }, []);

  const activate = useCallback<Ctx["activate"]>(
    async (code, device) => {
      const result = await activateApi(code, device);
      if (result.kind === "pending") {
        await setPrefs({ pendingRequestId: result.requestId });
        setState("pending");
        return "pending";
      }
      await setPrefs({ pendingRequestId: undefined });
      setEmployee(result.employee);
      setReason(undefined);
      setState("signedIn");
      return "session";
    },
    [setPrefs],
  );

  const checkPending = useCallback(async () => {
    if (!prefs.pendingRequestId) return "CANCELLED" as const;
    const status = await replacementStatus(prefs.pendingRequestId);
    if (status === "APPROVED") {
      await setPrefs({ pendingRequestId: undefined });
      const stored = await loadSession();
      setEmployee(stored?.employee || null);
      setState("signedIn");
    } else if (status !== "PENDING") {
      await setPrefs({ pendingRequestId: undefined });
      setState("signedOut");
    }
    return status;
  }, [prefs.pendingRequestId, setPrefs]);

  const cancelPending = useCallback(async () => {
    await setPrefs({ pendingRequestId: undefined });
    setState("signedOut");
  }, [setPrefs]);

  const logout = useCallback(async () => {
    await logoutApi();
  }, []);

  const value = useMemo(() => ({ state, employee, prefs, signedOutReason, setPrefs, activate, checkPending, cancelPending, logout }), [state, employee, prefs, signedOutReason, setPrefs, activate, checkPending, cancelPending, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("SessionProvider yo‘q");
  return ctx;
}
