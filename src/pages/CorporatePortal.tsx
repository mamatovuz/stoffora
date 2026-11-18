import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, CircleDollarSign, Download, FileCheck2, Landmark, LogOut, Scale, ShieldCheck, Users } from "lucide-react";
import { api, errorText, post } from "../api";
import { Logo } from "../components/Logo";
import { useApi } from "../hooks";
import { CorporateWorkspace, roleName, type CorporateMe, type CorporateTab } from "./Corporate";

/*
 * Corporate portal (corporate.staffora.uz yoki /corporate-portal) — Staffora ta’sischilari va investorlari.
 * Kirish — asosiy /login orqali (bitta forma); sessiya alohida cookie, kompaniya paneli ruxsatlariga aralashmaydi.
 */
const TABS: { key: CorporateTab; label: string; icon: typeof Users; permission?: string }[] = [
  { key: "overview", label: "Umumiy ko‘rinish", icon: BarChart3 },
  { key: "finance", label: "Moliya", icon: CircleDollarSign, permission: "finance.read" },
  { key: "ownership", label: "Ulushlar", icon: Scale },
  { key: "approvals", label: "Tasdiqlashlar", icon: ShieldCheck },
  { key: "agreements", label: "Kelishuvlar", icon: FileCheck2, permission: "agreements.read" },
  { key: "participants", label: "Ishtirokchilar", icon: Users, permission: "participants.read" },
];

type Session = { participant: { id: string; name: string; role: string } };

export function CorporatePortalApp() {
  const [session, setSession] = useState<Session | null>();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    document.title = "Corporate · Staffora";
    void api<Session>("/corporate-auth/me")
      .then(setSession)
      .catch(() => setSession(null));
  }, []);
  const me = useApi<CorporateMe>(session ? "/corporate/me" : null);
  const tab = (new URLSearchParams(location.search).get("tab") as CorporateTab) || "overview";

  if (session === undefined)
    return (
      <div className="corp-portal-loader">
        <span />
        Corporate portal yuklanmoqda…
      </div>
    );
  if (session === null) return <Navigate to="/login" replace state={{ from: { pathname: location.pathname } }} />;
  const can = (permission?: string) => !permission || Boolean(me.data && (me.data.permissions.includes("*") || me.data.permissions.includes(permission)));
  const tabs = TABS.filter((t) => can(t.permission));
  const name = session.participant.name;
  const first = name.split(/\s+/)[0];
  const open = (key: CorporateTab) => navigate(key === "overview" ? "/corporate-portal" : `/corporate-portal?tab=${key}`);
  const current = tabs.some((t) => t.key === tab) ? tab : "overview";

  return (
    <div className="cp-shell">
      <header className="tn-bar cp-bar">
        <div className="tn-inner">
          <span className="tn-brand cp-brand">
            <Logo />
            <em>Corporate</em>
          </span>
          <nav className="tn-nav cp-nav" aria-label="Corporate bo‘limlari">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" className={`tn-link ${current === key ? "active" : ""}`} aria-current={current === key ? "page" : undefined} onClick={() => open(key)}>
                <Icon size={16} strokeWidth={1.9} aria-hidden />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="tn-actions">
            <span className="cp-user">
              <span className="avatar sm">
                {name
                  .split(/\s+/)
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
              <span className="cp-user-text">
                <b>{name}</b>
                <small>{roleName[session.participant.role] || session.participant.role}</small>
              </span>
            </span>
            <button
              type="button"
              className="tn-icon"
              aria-label="Chiqish"
              title="Chiqish"
              onClick={async () => {
                await post("/corporate-auth/logout", {}).catch(() => undefined);
                window.location.href = "/login";
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </header>
      <main className="tn-main" id="main-content">
        <div className="page tp-page cp-page">
          <header className="tp-head">
            <div>
              <h1>{current === "overview" ? `Xush kelibsiz, ${first}` : tabs.find((t) => t.key === current)?.label || "Corporate"}</h1>
              <p>{current === "overview" ? "Staffora platformasi ko‘rsatkichlari va sizning iqtisodiy manfaatingiz" : "Staffora Corporate Management"}</p>
            </div>
            {can("reports.read") && (
              <div className="tp-head-actions">
                <a className="btn" href="/api/corporate/reports.xlsx">
                  <Download size={15} /> Excel
                </a>
                <a className="btn" href="/api/corporate/reports.pdf" target="_blank" rel="noreferrer">
                  <Download size={15} /> PDF
                </a>
              </div>
            )}
          </header>
          {me.error && <div className="notice error">{me.error}</div>}
          {me.data?.requiredAgreement && <AgreementGate item={me.data.requiredAgreement} onDone={() => void me.reload(true)} />}
          {me.data ? <CorporateWorkspace me={me.data} tab={current} /> : !me.error && <span className="tp-card db-sk-card" style={{ display: "block", height: 320 }} />}
        </div>
      </main>
    </div>
  );
}

function AgreementGate({ item, onDone }: { item: NonNullable<CorporateMe["requiredAgreement"]>; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function accept() {
    setBusy(true);
    setError("");
    try {
      await post("/corporate/agreements/accept", { agreementId: item.agreementId, versionId: item.versionId });
      onDone();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="agreement-gate">
      <Landmark />
      <div>
        <b>Kelishuvni qabul qilish talab qilinadi</b>
        <span>
          {item.title} · v{item.version}. Rozilikdan keyin 48 soat ichida qaytarib olish so‘rovi yuborish mumkin.
        </span>
        {error && <small>{error}</small>}
      </div>
      <a className="btn" href={`/api/corporate/agreements/${item.agreementId}/pdf?versionId=${item.versionId}`} target="_blank" rel="noreferrer">
        O‘qish
      </a>
      <button className="btn btn-primary" disabled={busy} onClick={() => void accept()}>
        {busy ? "Saqlanmoqda…" : "Qabul qilaman"}
      </button>
    </div>
  );
}
