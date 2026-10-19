import { homePage } from "@/lib/permissions";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Check,
  ChevronLeft,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Lock,
  LogIn,
  Mail,
  MessageSquareText,
  Phone,
  RefreshCw,
  Smartphone,
  User,
  UserCheck,
} from "lucide-react";
import { Logo } from "../components/Logo";
import { api, errorText, post } from "../api";
import { useAuth } from "../auth";
import { ErrorBox } from "../components/ui";

type Step = "email" | "phone" | "code" | "done";
type Via = "email" | "phone";
type LoginResult = { redirect: string; requires2fa?: boolean; challengeId?: string; telegram?: string };
type Key = "email" | "password" | "phone";

const RESEND_AFTER = 60;
const digits = (value: string) => value.replace(/\D/g, "");
/** "901234567" / "+998901234567" → "+998 90 123 45 67" */
function formatPhone(value: string) {
  let d = digits(value);
  if (d.startsWith("998")) d = d.slice(3);
  d = d.slice(0, 9);
  return "+998 " + [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(" ");
}
const valid: Record<Key, (v: string) => boolean> = {
  email: (v) => /^\S+@\S+\.\S+$/.test(v.trim()),
  password: (v) => v.length > 0,
  phone: (v) => digits(v).length === 12 && digits(v).startsWith("998"),
};
/** Xato maydonni silkitish (Web Animations API — holat kerak emas). */
function nope(el: Element | null | undefined) {
  el?.animate?.(
    [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(5px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(0)" }],
    { duration: 360, easing: "ease-out" },
  );
}

/** Ichidagi kontent balandligi o‘zgarsa, karta silliq cho‘ziladi yoki qisqaradi. */
function AutoHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="lg-auto" style={{ height }}>
      <div className="lg-stack" ref={inner}>
        {children}
      </div>
    </div>
  );
}

/*
 * Kirish kartasi: email+parol yoki telefon raqam → Telegram’ga 6 xonali kod.
 * Minimal: bitta karta, yorliqlarsiz maydonlar, bosqichlar orasida silliq o‘tish.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, refresh } = useAuth();
  const [needsSetup, setNeedsSetup] = useState(false);
  const [step, setStep] = useState<Step>("email");
  const [via, setVia] = useState<Via>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeState, setCodeState] = useState<"" | "bad" | "good">("");
  const [otpFocus, setOtpFocus] = useState(false);
  const [tried, setTried] = useState<Partial<Record<Key, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; telegram: string } | null>(null);
  const [left, setLeft] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const goRef = useRef<HTMLButtonElement>(null);
  const otpRef = useRef<HTMLLabelElement>(null);
  const fields = useRef<Partial<Record<Key, HTMLDivElement | null>>>({});

  useEffect(() => {
    void api<{ needsSetup: boolean }>("/setup/status")
      .then((status) => setNeedsSetup(status.needsSetup))
      .catch(() => undefined);
  }, []);

  // Qayta yuborish taymeri.
  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);

  // Bosqich almashganda birinchi bo‘sh maydonga fokus.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const target =
        step === "email" ? (valid.email(emailRef.current?.value || "") ? passwordRef : emailRef) : step === "phone" ? phoneRef : step === "code" ? codeRef : null;
      target?.current?.focus({ preventScroll: true });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [step]);

  if (user) return <Navigate to={user.role === "SUPER_ADMIN" ? "/super-admin" : homePage(user.role, user.modules)} replace />;
  if (needsSetup) return <Navigate to="/setup" replace />;

  const inputs: Record<Key, React.RefObject<HTMLInputElement | null>> = { email: emailRef, password: passwordRef, phone: phoneRef };
  const value: Record<Key, string> = { email, password, phone };
  const need: Record<Step, Key[]> = { email: ["email", "password"], phone: ["phone"], code: [], done: [] };
  const ok = (key: Key) => valid[key](value[key]);
  const bad = (key: Key) => Boolean(tried[key]) && !ok(key);
  const ready = step === "code" ? code.length === 6 : step === "done" || need[step].every(ok);

  const switchTo = (next: Via) => {
    if (busy || next === step) return;
    setStep(next);
    setError("");
  };

  const request = (mode: Via) =>
    post<LoginResult>(mode === "phone" ? "/auth/telegram-code" : "/auth/login", mode === "phone" ? { phone } : { email: email.trim(), password });

  async function finish(redirect: string) {
    setStep("done");
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    await refresh();
    const from = (location.state as { from?: { pathname?: string } })?.from?.pathname;
    navigate(from && from !== "/login" ? from : redirect, { replace: true });
  }

  async function next() {
    if (busy || step === "done") return;
    if (!ready) {
      if (step === "code") return nope(otpRef.current);
      setTried((t) => ({ ...t, ...Object.fromEntries(need[step].map((k) => [k, true])) }));
      need[step].filter((k) => !ok(k)).forEach((k) => nope(fields.current[k]));
      return;
    }
    const current = step;
    setBusy(true);
    setError("");
    try {
      if (current === "code") {
        const result = await post<{ redirect: string }>("/auth/login/verify", { challengeId: challenge?.id, code });
        setCodeState("good");
        setBusy(false);
        await finish(result.redirect);
        return;
      }
      const result = await request(current);
      setBusy(false);
      if (result.requires2fa && result.challengeId) {
        setChallenge({ id: result.challengeId, telegram: result.telegram || "Telegram" });
        setVia(current);
        setCode("");
        setCodeState("");
        setLeft(RESEND_AFTER);
        setStep("code");
        return;
      }
      await finish(result.redirect);
    } catch (reason) {
      setBusy(false);
      const message = errorText(reason, current === "code" ? "Kod noto‘g‘ri" : current === "phone" ? "Kod yuborilmadi" : "Kirish amalga oshmadi");
      setError(message);
      if (current !== "code") return need[current].forEach((k) => nope(fields.current[k]));
      setCodeState("bad");
      nope(otpRef.current);
      // Muddati o‘tgan yoki urinishlar tugagan — boshidan.
      if (/muddati|Qaytadan/.test(message)) {
        setStep(via);
        setLeft(0);
        return;
      }
      window.setTimeout(() => {
        setCode("");
        setCodeState("");
        codeRef.current?.focus({ preventScroll: true });
      }, 700);
    }
  }

  async function resend() {
    if (left > 0 || busy || step !== "code") return;
    setError("");
    setCode("");
    setCodeState("");
    setLeft(RESEND_AFTER);
    codeRef.current?.focus({ preventScroll: true });
    try {
      const result = await request(via);
      if (result.challengeId) setChallenge({ id: result.challengeId, telegram: result.telegram || "Telegram" });
    } catch (reason) {
      setError(errorText(reason, "Kod yuborilmadi"));
      setLeft(0);
    }
  }

  const head =
    step === "code"
      ? { Icon: MessageSquareText, title: "Tasdiqlash kodi" }
      : step === "done"
        ? { Icon: UserCheck, title: "Xush kelibsiz" }
        : { Icon: LogIn, title: "Kirish" };
  const goLabel = busy
    ? { email: "Kirilmoqda", phone: "Yuborilmoqda", code: "Tekshirilmoqda", done: "" }[step]
    : { email: "Kirish", phone: "Kod yuborish", code: "Tasdiqlash", done: "" }[step];
  const target = via === "phone" ? phone : challenge && challenge.telegram !== "Telegram" ? challenge.telegram : "";
  const ring = 2 * Math.PI * 8;

  const change = (key: Key, setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(key === "phone" ? formatPhone(e.target.value) : e.target.value);
    if (error) setError("");
  };
  const blur = (key: Key) => () => {
    if (key === "phone" && digits(phone).length <= 3) setPhone("");
    if (value[key]) setTried((t) => ({ ...t, [key]: true }));
  };
  const field = (key: Key, Icon: typeof Mail, input: ReactNode, delay: number, extra?: ReactNode) => (
    <div
      key={key}
      ref={(el) => {
        fields.current[key] = el;
      }}
      className={`lg-field lg-rise${bad(key) ? " bad" : ""}`}
      style={{ "--d": `${delay}ms` } as CSSProperties}
      onPointerDown={(e) => {
        if (!(e.target instanceof HTMLInputElement) && !(e.target as Element).closest?.("button")) {
          e.preventDefault();
          inputs[key].current?.focus();
        }
      }}
    >
      <Icon size={18} className="lg-fic" aria-hidden />
      {input}
      {extra}
    </div>
  );

  return (
    <main className="lg-page" id="main-content">
      <div className="lg-wrap">
        <Logo />
        <form
          className="lg-card"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void next();
          }}
        >
          <AutoHeight>
            <div className="lg-head">
              <head.Icon key={head.title} size={20} className="lg-pop" aria-hidden />
              <h1 key={`t-${head.title}`} className="lg-morph">
                {head.title}
              </h1>
            </div>

            {(step === "email" || step === "phone") && (
              <>
                <div className="lg-seg lg-rise" role="tablist" style={{ "--k": step === "phone" ? 1 : 0 } as CSSProperties}>
                  <i className="lg-sel" aria-hidden />
                  <button type="button" role="tab" aria-selected={step === "email"} className="lg-tab" onClick={() => switchTo("email")}>
                    <KeyRound size={17} aria-hidden /> Email va parol
                  </button>
                  <button type="button" role="tab" aria-selected={step === "phone"} className="lg-tab" onClick={() => switchTo("phone")}>
                    <Smartphone size={17} aria-hidden /> Telefon raqam
                  </button>
                </div>
                {step === "email" ? (
                  <>
                    {field(
                      "email",
                      Mail,
                      <input
                        ref={emailRef}
                        className="lg-input"
                        type="email"
                        inputMode="email"
                        autoComplete="username"
                        spellCheck={false}
                        placeholder="Email"
                        aria-label="Email"
                        value={email}
                        onChange={change("email", setEmail)}
                        onBlur={blur("email")}
                      />,
                      40,
                    )}
                    {field(
                      "password",
                      Lock,
                      <input
                        ref={passwordRef}
                        className="lg-input"
                        type={show ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="Parol"
                        aria-label="Parol"
                        value={password}
                        onChange={change("password", setPassword)}
                        onBlur={blur("password")}
                      />,
                      80,
                      <button
                        type="button"
                        className="lg-eye"
                        aria-label={show ? "Parolni yashirish" : "Parolni ko‘rsatish"}
                        aria-pressed={show}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => setShow(!show)}
                      >
                        {show ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>,
                    )}
                  </>
                ) : (
                  field(
                    "phone",
                    Phone,
                    <input
                      ref={phoneRef}
                      className="lg-input"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="+998 90 123 45 67"
                      aria-label="Telefon raqam"
                      value={phone}
                      onFocus={() => !phone && setPhone("+998 ")}
                      onChange={change("phone", setPhone)}
                      onBlur={blur("phone")}
                    />,
                    40,
                  )
                )}
              </>
            )}

            {step === "code" && (
              <>
                <div className="lg-line lg-rise">
                  <span>Telegram’ga kod yuborildi</span>
                  {target && <b>{target}</b>}
                </div>
                <label ref={otpRef} className={`lg-otp lg-rise ${codeState}${otpFocus ? " foc" : ""}`} style={{ "--d": "40ms" } as CSSProperties}>
                  <span className="lg-cells" aria-hidden>
                    {Array.from({ length: 6 }, (_, i) => (
                      <span key={i} className={`lg-cell${i === Math.min(code.length, 5) ? " cur" : ""}`}>
                        {code[i] && (
                          <b key={code[i]} className="lg-digit">
                            {code[i]}
                          </b>
                        )}
                      </span>
                    ))}
                  </span>
                  <input
                    ref={codeRef}
                    value={code}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    aria-label="6 xonali kod"
                    readOnly={busy}
                    onFocus={() => setOtpFocus(true)}
                    onBlur={() => setOtpFocus(false)}
                    onChange={(e) => {
                      const d = digits(e.target.value).slice(0, 6);
                      setCode(d);
                      setCodeState("");
                      if (error) setError("");
                      // To‘liq kod — o‘zi tasdiqlanadi.
                      if (d.length === 6) window.setTimeout(() => goRef.current?.click(), 160);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="lg-resend lg-rise"
                  style={{ "--d": "80ms" } as CSSProperties}
                  aria-disabled={left > 0}
                  onClick={() => void resend()}
                >
                  {left > 0 ? (
                    <svg className="lg-ring" viewBox="0 0 20 20" aria-hidden>
                      <circle className="trk" cx="10" cy="10" r="8" />
                      <circle className="arc" cx="10" cy="10" r="8" strokeDasharray={ring} strokeDashoffset={ring * (1 - left / RESEND_AFTER)} />
                    </svg>
                  ) : (
                    <RefreshCw size={18} aria-hidden />
                  )}
                  <span>Qayta yuborish</span>
                  {left > 0 && <b>{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}</b>}
                </button>
              </>
            )}

            {step === "done" && (
              <div className="lg-done lg-rise" style={{ "--d": "60ms" } as CSSProperties}>
                <span className="lg-badge">
                  <Check size={26} strokeWidth={2.4} />
                </span>
                <span>Siz tizimga kirdingiz</span>
              </div>
            )}

            {error && (
              <div className="lg-err lg-rise" role="alert" key={error}>
                <AlertCircle size={18} aria-hidden />
                <span>{error}</span>
              </div>
            )}

            {step !== "done" && (
              <div className="lg-foot">
                {step === "code" && (
                  <button
                    type="button"
                    className="lg-btn lg-back"
                    disabled={busy}
                    onClick={() => {
                      setStep(via);
                      setError("");
                      setLeft(0);
                    }}
                  >
                    <ChevronLeft size={18} aria-hidden /> Orqaga
                  </button>
                )}
                <button ref={goRef} className={`lg-btn lg-go${ready || busy ? "" : " off"}`} aria-disabled={!ready || busy}>
                  {busy && <LoaderCircle size={18} className="spin" aria-hidden />}
                  <span key={goLabel} className="lg-morph">
                    {goLabel}
                  </span>
                </button>
              </div>
            )}
          </AutoHeight>
        </form>
        <p className="auth-foot">© {new Date().getFullYear()} Staffora</p>
      </div>
    </main>
  );
}

export function SetupPage() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [status, setStatus] = useState<{
    needsSetup: boolean;
    requiresToken: boolean;
  } | null>(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    companyName: "",
    ownerName: "",
    email: "",
    password: "",
    confirm: "",
    setupToken: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ needsSetup: boolean; requiresToken: boolean }>("/setup/status")
      .then(setStatus)
      .catch((reason) => setError(errorText(reason)));
  }, []);
  if (user) return <Navigate to="/dashboard" replace />;
  if (status && !status.needsSetup) return <Navigate to="/login" replace />;
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (step === 1) {
      setStep(2);
      return;
    }
    if (form.password !== form.confirm) {
      setError("Parollar bir xil emas.");
      return;
    }
    setBusy(true);
    try {
      await post("/setup", {
        companyName: form.companyName,
        ownerName: form.ownerName,
        email: form.email,
        password: form.password,
        setupToken: form.setupToken || undefined,
      });
      await refresh();
      navigate("/dashboard", { replace: true });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout" id="main-content">
      <section className="auth-main">
        <Logo />
        <form className="auth-form" onSubmit={submit}>
          <div className="steps-mini">
            <i className="on" />
            <i className={step === 2 ? "on" : ""} />
          </div>
          <span className="eyebrow">Birinchi sozlash · {step}/2</span>
          <h1>{step === 1 ? "Kompaniyangiz" : "Administrator hisobi"}</h1>
          <p>
            {step === 1
              ? "Staffora’ni ishga tushirish uchun kompaniya ma’lumotlarini kiriting."
              : "Bu hisob bilan boshqaruv paneliga kirasiz. Parolni xavfsiz saqlang."}
          </p>
          {step === 1 ? (
            <>
              <label className="field">
                <span className="label">Kompaniya nomi</span>
                <span className="input-icon">
                  <Building2 size={16} />
                  <input
                    className="input"
                    value={form.companyName}
                    onChange={set("companyName")}
                    placeholder="Masalan: Oila Market MChJ"
                    required
                    minLength={2}
                    autoFocus
                  />
                </span>
              </label>
              <label className="field">
                <span className="label">Rahbar / egasi F.I.Sh.</span>
                <span className="input-icon">
                  <User size={16} />
                  <input
                    className="input"
                    value={form.ownerName}
                    onChange={set("ownerName")}
                    placeholder="Ism Familiya"
                    required
                    minLength={2}
                  />
                </span>
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span className="label">Email</span>
                <span className="input-icon">
                  <Mail size={16} />
                  <input
                    className="input"
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={set("email")}
                    required
                    autoFocus
                  />
                </span>
              </label>
              <div className="form-grid">
                <label className="field">
                  <span className="label">Parol</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={set("password")}
                    minLength={10}
                    required
                  />
                </label>
                <label className="field">
                  <span className="label">Parolni takrorlang</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={form.confirm}
                    onChange={set("confirm")}
                    minLength={10}
                    required
                  />
                </label>
              </div>
              <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
                Kamida 10 belgi. Harf va raqamlarni aralashtiring.
              </p>
              {status?.requiresToken && (
                <label className="field">
                  <span className="label">Sozlash kaliti (SETUP_TOKEN)</span>
                  <input
                    className="input"
                    value={form.setupToken}
                    onChange={set("setupToken")}
                    required
                  />
                </label>
              )}
            </>
          )}
          <ErrorBox message={error} />
          <div className="form-actions" style={{ marginTop: 16 }}>
            {step === 2 && (
              <button type="button" className="btn btn-lg" onClick={() => setStep(1)}>
                Orqaga
              </button>
            )}
            <button
              className="btn btn-primary btn-lg"
              style={{ flex: 1 }}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <ArrowRight size={18} />
              )}
              {step === 1 ? "Davom etish" : busy ? "Yaratilmoqda…" : "Kompaniyani yaratish"}
            </button>
          </div>
        </form>
        <p className="auth-foot">© {new Date().getFullYear()} Staffora</p>
      </section>
    </main>
  );
}
