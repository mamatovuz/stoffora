import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { Logo } from "../components/Logo";
import { post } from "../api";
import { useAuth } from "../auth";
export function LoginPage() {
  const navigate = useNavigate(),
    { user, refresh } = useAuth();
  const [email, setEmail] = useState("admin@staffora.uz"),
    [password, setPassword] = useState("Staffora2026!"),
    [show, setShow] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  if (user) {
    navigate(user.role === "SUPER_ADMIN" ? "/super-admin" : "/dashboard");
    return null;
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await post<{ redirect: string }>("/auth/login", {
        email,
        password,
      });
      await refresh();
      navigate(result.redirect);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kirish amalga oshmadi");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="login-layout" id="main-content">
      <section className="login-main">
        <Logo />
        <div className="login-form-wrap">
          <p
            style={{
              color: "var(--brand)",
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: ".08em",
            }}
          >
            BOSHQARUV PANELI
          </p>
          <h1
            style={{ fontSize: 32, letterSpacing: "-.04em", margin: "10px 0" }}
          >
            Xush kelibsiz
          </h1>
          <p className="subtle" style={{ lineHeight: 1.6, marginBottom: 28 }}>
            Kompaniyangizdagi xodimlar, davomat va ish jarayonlarini bir joydan
            boshqaring.
          </p>
          <form onSubmit={submit}>
            <div className="field">
              <label className="label">Email manzil</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label className="label">Parol</label>
              <div style={{ position: "relative" }}>
                <input
                  className="input"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{ paddingRight: 42 }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShow(!show)}
                  style={{ position: "absolute", right: 3, top: 2 }}
                >
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
            {error && <p className="field-error">{error}</p>}
            <button
              className="btn btn-primary"
              disabled={loading}
              style={{ width: "100%", height: 44, marginTop: 7 }}
            >
              {loading && <LoaderCircle className="spin" size={18} />}{" "}
              {loading ? "Tekshirilmoqda..." : "Tizimga kirish"}
            </button>
            <div
              style={{
                marginTop: 18,
                padding: 12,
                border: "1px solid var(--line)",
                borderRadius: 7,
                background: "#f8faf9",
                fontSize: 11,
                lineHeight: 1.7,
                color: "var(--muted)",
              }}
            >
              Demo: <b>admin@staffora.uz</b> / <b>Staffora2026!</b>
              <br />
              Super admin: <b>super@staffora.uz</b>
            </div>
          </form>
        </div>
        <p className="subtle" style={{ fontSize: 11 }}>
          © 2026 Staffora. Barcha huquqlar himoyalangan.
        </p>
      </section>
      <section className="login-art">
        <div style={{ maxWidth: 590 }}>
          <span
            style={{
              display: "inline-block",
              padding: "5px 9px",
              background: "rgba(255,255,255,.1)",
              borderRadius: 5,
              fontSize: 11,
            }}
          >
            XODIMLAR BOSHQARUVI
          </span>
          <h2
            style={{
              fontSize: "clamp(34px,4vw,58px)",
              lineHeight: 1.08,
              letterSpacing: "-.05em",
              margin: "22px 0",
            }}
          >
            Ish jarayoni.
            <br />
            Aniq va ishonchli.
          </h2>
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.7,
              color: "#b9d1ca",
              maxWidth: 480,
            }}
          >
            Davomat, xodimlar, filiallar va hisobotlarni biznesingiz o‘sishiga
            mos yagona tizimda boshqaring.
          </p>
        </div>
      </section>
    </main>
  );
}
