import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  LogOut,
  Scale,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, errorText, post } from "../api";
import { Logo } from "../components/Logo";
import { CorporatePage } from "./Corporate";

type Terms = {
  version: string;
  title: string;
  sections: { title: string; text: string }[];
};
type CorporateMe = {
  participant: { id: string; name: string; role: string; shareBps?: number };
  company: { id: string; name: string } | null;
};
const CorporateContext = createContext<CorporateMe | null>(null);
export const useCorporate = () => useContext(CorporateContext);

export function CorporateLoginPage() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [terms, setTerms] = useState<Terms>();
  const [termsOpen, setTermsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    void api<Terms>("/corporate-auth/terms")
      .then(setTerms)
      .catch((e) => setError(errorText(e)));
  }, []);
  const ready = login.trim().length >= 3 && password.length >= 6;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accepted || !terms) return;
    setBusy(true);
    setError("");
    try {
      await post("/corporate-auth/login", {
        login,
        password,
        acceptedTerms: true,
        termsVersion: terms.version,
      });
      navigate("/corporate-portal", { replace: true });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="corp-auth">
      <section className="corp-auth-brand">
        <div className="corp-brand-inner">
          <Logo />
          <span className="corp-auth-badge">
            <BriefcaseBusiness size={15} /> CORPORATE PORTAL
          </span>
          <h1>
            Korporativ boshqaruvning <em>ishonchli markazi.</em>
          </h1>
          <p>
            Founder, Co-Founder, CEO va Investorlar uchun moliya, ulush,
            kelishuv va tasdiqlashlar yagona xavfsiz maydonda.
          </p>
          <div className="corp-auth-benefits">
            <div>
              <ShieldCheck />
              <span>
                <b>Rollar asosida himoya</b>
                <small>
                  Har bir foydalanuvchi faqat o‘z vakolatini ko‘radi.
                </small>
              </span>
            </div>
            <div>
              <Scale />
              <span>
                <b>Huquqiy aniqlik</b>
                <small>Tizim roli va yuridik egalik aniq ajratilgan.</small>
              </span>
            </div>
            <div>
              <CheckCircle2 />
              <span>
                <b>Audit va tasdiqlash</b>
                <small>Muhim qarorlar kuzatiladi va qayd etiladi.</small>
              </span>
            </div>
          </div>
        </div>
      </section>
      <section className="corp-auth-form">
        <form onSubmit={(e) => void submit(e)}>
          <div className="corp-mobile-logo">
            <Logo />
          </div>
          <span className="eyebrow">XUSH KELIBSIZ</span>
          <h2>Corporate hisobingizga kiring</h2>
          <p className="muted">
            Super Admin bergan login va paroldan foydalaning.
          </p>
          <label>
            Login
            <input
              autoFocus
              autoComplete="username"
              value={login}
              onChange={(e) => {
                setLogin(e.target.value);
                setError("");
              }}
              placeholder="masalan: founder.ozodbek"
            />
          </label>
          <label>
            Parol
            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                placeholder="Parolingiz"
              />
              <button
                type="button"
                aria-label={
                  showPassword ? "Parolni yashirish" : "Parolni ko‘rsatish"
                }
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </label>
          {ready && (
            <label className="corp-terms-check">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>
                Men foydalanish{" "}
                <button type="button" onClick={() => setTermsOpen(true)}>
                  shartlari
                </button>
                ni o‘qidim va roziman.
              </span>
            </label>
          )}
          {error && <div className="corp-auth-error">{error}</div>}
          <button
            className="corp-login-button"
            disabled={!ready || !accepted || busy}
          >
            {busy ? (
              "Tekshirilmoqda…"
            ) : (
              <>
                Portalga kirish <ArrowRight />
              </>
            )}
          </button>
          <small className="corp-login-help">
            Kirish ma’lumotlari yo‘qmi? Super Admin bilan bog‘laning.
          </small>
        </form>
      </section>
      {termsOpen && terms && (
        <TermsModal terms={terms} onClose={() => setTermsOpen(false)} />
      )}
    </main>
  );
}

function TermsModal({ terms, onClose }: { terms: Terms; onClose: () => void }) {
  return (
    <div
      className="corp-terms-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="corp-terms-title"
    >
      <div className="corp-terms-modal">
        <header>
          <span>
            <FileText />
          </span>
          <div>
            <h2 id="corp-terms-title">{terms.title}</h2>
            <small>Versiya: {terms.version}</small>
          </div>
          <button onClick={onClose} aria-label="Yopish">
            <X />
          </button>
        </header>
        <div className="corp-terms-body">
          {terms.sections.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </section>
          ))}
        </div>
        <footer>
          <button className="btn btn-primary" onClick={onClose}>
            O‘qidim
          </button>
        </footer>
      </div>
    </div>
  );
}

export function CorporatePortalApp() {
  const [me, setMe] = useState<CorporateMe | null>();
  const location = useLocation();
  useEffect(() => {
    void api<CorporateMe>("/corporate-auth/me")
      .then(setMe)
      .catch(() => setMe(null));
  }, []);
  if (me === undefined)
    return (
      <div className="corp-portal-loader">
        <span />
        Corporate portal yuklanmoqda…
      </div>
    );
  if (me === null)
    return (
      <Navigate
        to="/corporate-login"
        replace
        state={{ from: location.pathname }}
      />
    );
  return (
    <CorporateContext.Provider value={me}>
      <div className="corp-portal-shell">
        <header className="corp-portal-header">
          <Logo />
          <div className="corp-portal-company">
            <small>Kompaniya</small>
            <b>{me.company?.name || "Staffora"}</b>
          </div>
          <span className="corp-role-pill">
            {me.participant.role.replace("_", " ")}
          </span>
          <div className="corp-portal-user">
            <span>
              {me.participant.name
                .split(/\s+/)
                .map((x) => x[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              <b>{me.participant.name}</b>
              <small>
                {me.participant.shareBps !== undefined
                  ? `${(me.participant.shareBps / 100).toFixed(2)}% economic interest`
                  : "Korporativ ishtirokchi"}
              </small>
            </div>
          </div>
          <button
            className="corp-logout"
            onClick={async () => {
              await post("/corporate-auth/logout", {}).catch(() => undefined);
              window.location.href = "/corporate-login";
            }}
          >
            <LogOut /> Chiqish
          </button>
        </header>
        <CorporatePage />
      </div>
    </CorporateContext.Provider>
  );
}
