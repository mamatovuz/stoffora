import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, Lock, LogOut } from "lucide-react";
import { api, errorText, post } from "../api";
import { useAuth } from "../auth";
import { useNow } from "../hooks";
import { dateLongUz } from "@/lib/format";
import { Avatar } from "./ui";
import mark from "../assets/staffora-mark.svg";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"] as const;
const STORAGE_KEY = "staffora_screen_locked";

/**
 * Harakatsizlikda ekranni qulflaydi. Qulf serverda ham belgilanadi —
 * sahifani yangilash yoki boshqa tabda ochish qulfni chetlab o‘tmaydi.
 */
export function ScreenLock({ onUnlock }: { onUnlock: () => void }) {
  const { user } = useAuth();
  const enabled = Boolean(user?.screenLock?.enabled);
  const minutes = user?.screenLock?.minutes || 5;
  const [locked, setLocked] = useState(Boolean(user?.locked));
  const lastActivity = useRef(Date.now());

  const lock = useCallback(async () => {
    setLocked(true);
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    await post("/auth/lock").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (user?.locked) setLocked(true);
  }, [user?.locked]);

  // Server 423 qaytarsa, boshqa tab qulflasa yoki qo‘lda "Qulflash" bosilsa.
  useEffect(() => {
    const onLocked = () => setLocked(true);
    const onLockNow = () => void lock();
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue) setLocked(true);
      if (event.key === STORAGE_KEY && !event.newValue) setLocked(false);
    };
    window.addEventListener("staffora:locked", onLocked);
    window.addEventListener("staffora:lock-now", onLockNow);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("staffora:locked", onLocked);
      window.removeEventListener("staffora:lock-now", onLockNow);
      window.removeEventListener("storage", onStorage);
    };
  }, [lock]);

  // Harakatsizlik taymeri
  useEffect(() => {
    if (!enabled || locked) return;
    lastActivity.current = Date.now();
    const bump = () => {
      lastActivity.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, bump, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= minutes * 60_000) void lock();
    }, 5_000);
    return () => {
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, bump));
      window.clearInterval(timer);
    };
  }, [enabled, locked, minutes, lock]);

  useEffect(() => {
    if (!locked) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [locked]);

  if (!locked || !enabled) return null;
  return (
    <LockOverlay
      onUnlocked={() => {
        setLocked(false);
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
        onUnlock();
      }}
    />
  );
}

function LockOverlay({ onUnlocked }: { onUnlocked: () => void }) {
  const { user } = useAuth();
  const now = useNow(1000);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [first, last] = (user?.name || "?").split(" ");

  useEffect(() => {
    input.current?.focus();
  }, []);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      await post("/auth/unlock", { password });
      setPassword("");
      onUnlocked();
    } catch (reason) {
      setError(errorText(reason, "Parol noto‘g‘ri."));
      setPassword("");
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
    } finally {
      setBusy(false);
      // Input so‘rov davomida o‘chirilgan edi — yoqilgandan keyin fokus qaytariladi.
      window.setTimeout(() => input.current?.focus(), 0);
    }
  }

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Ekran qulflangan">
      <div className="lock-clock">
        <b>
          {now.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Asia/Tashkent",
          })}
        </b>
        <span>
          {dateLongUz(now, true)}
        </span>
      </div>
      <form className={`lock-card ${shake ? "shake" : ""}`} onSubmit={unlock}>
        <img src={mark} alt="" className="lock-mark" />
        <h1>{user?.companyName || "Staffora"}</h1>
        <div className="lock-user">
          <Avatar first={first} last={last} photo={user?.photoDataUrl} size="sm" />
          <span>{user?.name}</span>
        </div>
        <p className="lock-hint">
          <Lock size={13} /> Ekran qulflangan. Davom etish uchun parolni kiriting.
        </p>
        <div className="lock-input">
          <input
            ref={input}
            type="password"
            className="input"
            placeholder="Qulf paroli"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            readOnly={busy}
            aria-label="Qulf paroli"
          />
          <button className="btn btn-primary" disabled={busy || !password} aria-label="Ochish">
            {busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}
            Ochish
          </button>
        </div>
        {error && <p className="field-error">{error}</p>}
        <button
          type="button"
          className="lock-logout"
          onClick={async () => {
            await api("/auth/logout", { method: "POST" }).catch(() => undefined);
            try {
              localStorage.removeItem(STORAGE_KEY);
            } catch {
              /* ignore */
            }
            window.location.href = "/login";
          }}
        >
          <LogOut size={14} /> Tizimdan chiqish
        </button>
      </form>
    </div>
  );
}
