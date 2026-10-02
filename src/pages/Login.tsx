import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  Lock,
  Mail,
  MapPin,
  Phone,
  QrCode,
  Send,
  ShieldCheck,
  User,
} from "lucide-react";
import { Logo } from "../components/Logo";
import { api, errorText, post } from "../api";
import { useAuth } from "../auth";
import { ErrorBox } from "../components/ui";

function AuthAside() {
  return (
    <section className="auth-aside" aria-hidden="true">
      <Logo />
      <div>
        <h2>
          Keldi-ketdi.
          <br />
          <em>Aniq, halol</em> va tez.
        </h2>
        <p>
          Xodimlar Telegram orqali Face ID, GPS va dinamik QR bilan davomatni
          belgilaydi. Siz esa hammasini bir paneldan real vaqtda ko‘rasiz.
        </p>
      </div>
      <div className="auth-preview">
        <div className="auth-preview-row">
          <i>AS</i>
          <span>
            <b>Aziza S.</b>
            <small>08:54 · Bosh ofis</small>
          </span>
          <em>Vaqtida</em>
        </div>
        <div className="auth-preview-row">
          <i>JK</i>
          <span>
            <b>Jasur K.</b>
            <small>09:12 · Chilonzor</small>
          </span>
          <em className="late">12 daq kech</em>
        </div>
      </div>
      <div className="auth-features">
        <div className="auth-feature">
          <Fingerprint size={20} />
          <span>
            <b>Face ID</b>
            <small>Jonlilik tekshiruvi bilan</small>
          </span>
        </div>
        <div className="auth-feature">
          <MapPin size={20} />
          <span>
            <b>GPS hudud</b>
            <small>Filial radiusi nazorati</small>
          </span>
        </div>
        <div className="auth-feature">
          <QrCode size={20} />
          <span>
            <b>Dinamik QR</b>
            <small>Har 30 soniyada yangilanadi</small>
          </span>
        </div>
        <div className="auth-feature">
          <Send size={20} />
          <span>
            <b>Telegram bot</b>
            <small>Eslatma va bildirishnomalar</small>
          </span>
        </div>
      </div>
    </section>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, refresh } = useAuth();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [challenge, setChallenge] = useState<{ id: string; telegram: string } | null>(null);
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [phone, setPhone] = useState("+998 ");

  useEffect(() => {
    void api<{ needsSetup: boolean }>("/setup/status")
      .then((status) => setNeedsSetup(status.needsSetup))
      .catch(() => undefined);
  }, []);

  if (user)
    return (
      <Navigate
        to={user.role === "SUPER_ADMIN" ? "/super-admin" : "/dashboard"}
        replace
      />
    );
  if (needsSetup) return <Navigate to="/setup" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await post<{
        redirect: string;
        requires2fa?: boolean;
        challengeId?: string;
        telegram?: string;
      }>(mode === "phone" ? "/auth/telegram-code" : "/auth/login", mode === "phone" ? { phone } : { email, password });
      if (result.requires2fa && result.challengeId) {
        setChallenge({ id: result.challengeId, telegram: result.telegram || "Telegram" });
        setCode("");
        return;
      }
      await finish(result.redirect);
    } catch (reason) {
      setError(errorText(reason, "Kirish amalga oshmadi"));
    } finally {
      setLoading(false);
    }
  }

  async function verify(value: string) {
    if (!challenge || value.length !== 6) return;
    setLoading(true);
    setError("");
    try {
      const result = await post<{ redirect: string }>("/auth/login/verify", {
        challengeId: challenge.id,
        code: value,
      });
      await finish(result.redirect);
    } catch (reason) {
      setError(errorText(reason, "Kod tasdiqlanmadi"));
      setCode("");
      if (reason instanceof Error && /muddati|Qaytadan/.test(reason.message)) setChallenge(null);
    } finally {
      setLoading(false);
    }
  }

  async function finish(redirect: string) {
    {
      await refresh();
      const from = (location.state as { from?: { pathname?: string } })?.from
        ?.pathname;
      navigate(from && from !== "/login" ? from : redirect, {
        replace: true,
      });
    }
  }

  return (
    <main className="auth-layout" id="main-content">
      <section className="auth-main">
        <Logo />
        {challenge ? (
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void verify(code);
            }}
          >
            <span className="eyebrow">
              <ShieldCheck size={12} /> 2 bosqichli kirish
            </span>
            <h1>Kodni kiriting</h1>
            <p>
              6 xonali kod <b>{challenge.telegram}</b> ga Staffora bot orqali yuborildi.
              Kod 5 daqiqa amal qiladi.
            </p>
            <CodeInput
              value={code}
              disabled={loading}
              onChange={(value) => {
                setCode(value);
                if (value.length === 6) void verify(value);
              }}
            />
            <ErrorBox message={error} />
            <button className="btn btn-primary btn-lg btn-block" disabled={loading || code.length !== 6} style={{ marginTop: 14 }}>
              {loading ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
              Tasdiqlash
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              style={{ marginTop: 8 }}
              onClick={() => {
                setChallenge(null);
                setError("");
              }}
            >
              Orqaga
            </button>
          </form>
        ) : (
        <form className="auth-form" onSubmit={submit}>
          <span className="eyebrow">
            <Lock size={12} /> Boshqaruv paneli
          </span>
          <h1>Xush kelibsiz</h1>
          <p>Kompaniya hisobingizga kiring.</p>
          <div className="login-mode" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "email"} className={mode === "email" ? "on" : ""} onClick={() => (setMode("email"), setError(""))}>
              <Mail size={15} /> Email va parol
            </button>
            <button type="button" role="tab" aria-selected={mode === "phone"} className={mode === "phone" ? "on" : ""} onClick={() => (setMode("phone"), setError(""))}>
              <Send size={15} /> Telefon + Telegram kod
            </button>
          </div>
          {mode === "phone" ? (
            <>
              <label className="field">
                <span className="label">Telefon raqamingiz</span>
                <span className="input-icon">
                  <Phone size={16} />
                  <input className="input" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required autoFocus placeholder="+998 90 123 45 67" />
                </span>
              </label>
              <p className="hint" style={{ marginTop: -4 }}>
                HR, moliya, IT va filial rahbarlari uchun: lavozimingizga huquq berilgan bo‘lsa, Telegram’ingizga (Staffora boti) 6 xonali kod keladi.
              </p>
            </>
          ) : (
          <>
          <label className="field">
            <span className="label">Email manzil</span>
            <span className="input-icon">
              <Mail size={16} />
              <input
                className="input"
                type="email"
                autoComplete="email"
                placeholder="siz@kompaniya.uz"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </span>
          </label>
          <label className="field">
            <span className="label">Parol</span>
            <span className="input-icon">
              <KeyRound size={16} />
              <input
                className="input"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                className="icon-btn input-suffix"
                aria-label={show ? "Parolni yashirish" : "Parolni ko‘rsatish"}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>
          </>
          )}
          <ErrorBox message={error} />
          <button
            className="btn btn-primary btn-lg btn-block"
            disabled={loading}
            style={{ marginTop: 14 }}
          >
            {loading ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <ArrowRight size={18} />
            )}
            {loading ? "Tekshirilmoqda…" : mode === "phone" ? "Kod yuborish" : "Tizimga kirish"}
          </button>
          <p className="hint" style={{ marginTop: 18 }}>
            Xodimmisiz? Davomat uchun kompaniyangiz Telegram botini oching.
          </p>
        </form>
        )}
        <p className="auth-foot">© {new Date().getFullYear()} Staffora</p>
      </section>
      <AuthAside />
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
      <AuthAside />
    </main>
  );
}

function CodeInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="code-input">
      <input
        value={value}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        disabled={disabled}
        aria-label="Tasdiqlash kodi"
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={i === value.length ? "active" : value[i] ? "filled" : ""}>
          {value[i] || ""}
        </span>
      ))}
    </label>
  );
}
