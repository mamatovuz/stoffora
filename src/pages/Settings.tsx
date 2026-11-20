import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Banknote,
  Building2,
  Camera,
  CheckCircle2,
  Copy,
  KeyRound,
  Laptop,
  LogOut,
  Monitor,
  Save,
  Send,
  ShieldCheck,
  Smartphone,
  Tablet,
  UserRound,
  XCircle,
  Lock,
  PlugZap,
  Bot,
  TabletSmartphone,
  FileBarChart,
} from "lucide-react";
import { CountingStartCard, IntegrationCenter } from "./Integrations";
import { CompanyBotSection } from "./Registrations";
import { FormBuilder } from "./FormBuilder";
import { CountdownConfirm } from "../components/CountdownConfirm";
import { MobileAppsSection } from "../components/MobileAppsSection";
import { ReportDigestSection } from "../components/ReportDigestSection";
import { canAny } from "@/lib/permissions";
import { settingsTabModule } from "@/lib/modules";

/** Har bir tab uchun kerakli ruxsat (bo‘sh — hamma panel foydalanuvchisi). */
const tabPermissions: Partial<Record<Tab, string[]>> = {
  apps: ["employees.view"],
  company: ["settings.manage"],
  payroll: ["payroll.edit"],
  reports: ["settings.manage"],
  channel: ["settings.manage"],
  bot: ["settings.manage"],
  miniapp: ["settings.manage"],
  regbot: ["settings.manage"],
  integrations: ["settings.manage"],
};
import { api, del, errorText, post, put } from "../api";
import { useApi } from "../hooks";
import {
  Avatar,
  Confirm,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  useToast,
} from "../components/ui";
import { roleLabels, useAuth } from "../auth";
import type { Company, PayrollSettings } from "@/lib/types";
import { advanceWindow, calculatePayroll, defaultPayrollSettings } from "@/lib/payroll";
import { dateUz, money, tashkentIsoDate } from "@/lib/format";
import { resizePhoto } from "./Employees";
import { TimeInput } from "../components/TimeInput";
import { LOGIN_SUFFIX, checkLoginInput } from "@/lib/staff-login";

type Tab = "profile" | "security" | "lock" | "devices" | "apps" | "company" | "payroll" | "reports" | "channel" | "bot" | "miniapp" | "regbot" | "integrations";
const tabs: [Tab, string, typeof UserRound][] = [
  ["profile", "Profil", UserRound],
  ["security", "Xavfsizlik", ShieldCheck],
  ["lock", "Ekran qulfi", Lock],
  ["devices", "Qurilmalar", Laptop],
  ["apps", "Ilovalar", Smartphone],
  ["company", "Kompaniya", Building2],
  ["payroll", "Ish haqi va jarima", Banknote],
  ["reports", "Avtomatik hisobot", FileBarChart],
  ["channel", "Rasm kanali", Camera],
  ["bot", "Telegram bot", Send],
  ["miniapp", "Mini App", TabletSmartphone],
  ["regbot", "Ro‘yxat boti", Bot],
  ["integrations", "Integratsiyalar", PlugZap],
];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  // Rolga ruxsat etilgan va super admin o‘chirmagan (modul) tablar.
  const allowed = tabs.filter(([key]) => {
    const module = settingsTabModule(key);
    if (module && user?.modules?.includes(module)) return false;
    return !tabPermissions[key] || (user ? canAny(user.role, tabPermissions[key]!) : false);
  });
  const requested = (params.get("tab") as Tab) || "profile";
  const tab = allowed.some(([key]) => key === requested) ? requested : "profile";
  return (
    <div className={`page ${tab === "integrations" || tab === "regbot" ? "wide-settings" : "narrow"}`}>
      <PageHeader title="Sozlamalar" subtitle="Profil, xavfsizlik, qurilmalar va kompaniya" />
      <div className="settings-layout">
        <nav className="settings-nav card">
          {allowed.map(([key, label, Icon]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => setParams({ tab: key }, { replace: true })}
            >
              <Icon size={17} /> {label}
            </button>
          ))}
        </nav>
        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          {tab === "profile" && <ProfileSection />}
          {tab === "security" && <SecuritySection />}
          {tab === "devices" && <DevicesSection />}
          {tab === "apps" && <MobileAppsSection />}
          {tab === "company" && (
            <>
              <CompanySection />
              {user?.role === "COMPANY_OWNER" && <DangerZone />}
            </>
          )}
          {tab === "payroll" && (
            <>
              <section className="card">
                <div className="card-body">
                  <CountingStartCard />
                </div>
              </section>
              <PayrollSection />
            </>
          )}
          {tab === "lock" && <ScreenLockSection />}
          {tab === "reports" && <ReportDigestSection />}
          {tab === "channel" && <PhotoChannelSection />}
          {tab === "bot" && <BotSection />}
          {tab === "miniapp" && (
            <>
              <MiniAppSection />
              <ClientLogsSection />
            </>
          )}
          {tab === "integrations" && <IntegrationCenter />}
          {tab === "regbot" && (
            <>
              <CompanyBotSection />
              {/* Anketa — «Arizalar» moduli o‘chirilgan bo‘lsa ko‘rinmaydi. */}
              {!user?.modules?.includes("registrations") && <FormBuilder />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- profil --- */
function ProfileSection() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const [first, last] = (user?.name || "?").split(" ");
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Mening profilim</h2>
          <p>{user?.email} · {user ? roleLabels[user.role] : ""}</p>
        </div>
      </div>
      <div className="card-body">
        <div className="photo-picker">
          <Avatar first={first} last={last} photo={user?.photoDataUrl} size="lg" />
          <div>
            <b>Profil rasmi</b>
            <small>Panel menyusi va yuqori qismida ko‘rinadi</small>
            <label className={`btn btn-sm ${photoBusy ? "disabled" : ""}`}>
              <Camera size={14} /> {photoBusy ? "Yuklanmoqda…" : "Rasm yuklash"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                disabled={photoBusy}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setPhotoBusy(true);
                  try {
                    await put("/profile/photo", { photoDataUrl: await resizePhoto(file) });
                    await refresh();
                    toast("Rasm yangilandi");
                  } catch (reason) {
                    toast(errorText(reason), "error");
                  } finally {
                    setPhotoBusy(false);
                    event.target.value = "";
                  }
                }}
              />
            </label>
          </div>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError("");
            try {
              await put("/profile", { name });
              await refresh();
              toast("Ism familiya saqlandi");
            } catch (reason) {
              setError(errorText(reason));
            } finally {
              setSaving(false);
            }
          }}
        >
          <Field label="Ism familiya" hint="Panelda, hisobotlarda va audit jurnalida shu ism ko‘rinadi">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={80} />
          </Field>
          <ErrorBox message={error} />
          <div className="form-actions">
            <button className="btn btn-primary" disabled={saving || name.trim() === user?.name}>
              <Save size={15} /> {saving ? "Saqlanmoqda…" : "Saqlash"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ xavfsizlik --- */
type Security = {
  telegramLinked: boolean;
  telegramUsername?: string;
  twoFactorEnabled: boolean;
  botUsername?: string;
};
function SecuritySection() {
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, reload } = useApi<Security>("/auth/security");
  const [link, setLink] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [twoFaError, setTwoFaError] = useState("");
  const [busy, setBusy] = useState(false);
  const [unlink, setUnlink] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [passwordError, setPasswordError] = useState("");

  // Havola ochilgandan keyin ulanishni avtomatik tekshiramiz.
  useEffect(() => {
    if (!link || data?.telegramLinked) return;
    const timer = window.setInterval(() => void reload(true), 3000);
    return () => window.clearInterval(timer);
  }, [link, data?.telegramLinked, reload]);
  useEffect(() => {
    if (data?.telegramLinked && link) {
      setLink(null);
      toast("Telegram ulandi");
    }
  }, [data?.telegramLinked, link, toast]);

  if (loading && !data) return <Loading />;
  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>2 bosqichli kirish</h2>
            <p>Paroldan keyin Telegram’ga yuborilgan 6 xonali kod so‘raladi</p>
          </div>
          <span className={`badge ${data?.twoFactorEnabled ? "green" : "gray"}`}>
            {data?.twoFactorEnabled ? "Yoqilgan" : "O‘chirilgan"}
          </span>
        </div>
        <div className="card-body" style={{ display: "grid", gap: 14 }}>
          <div className="connect-card">
            <div className="connect-card-head">
              <span>
                <Send size={19} />
              </span>
              <div>
                <b>1-qadam: Telegram hisobini ulang</b>
                <small>
                  {data?.telegramLinked
                    ? `Ulangan${data.telegramUsername ? ` · @${data.telegramUsername}` : ""}`
                    : "Kodlar shu Telegram hisobga yuboriladi"}
                </small>
              </div>
              {data?.telegramLinked ? (
                <button className="btn btn-sm btn-danger" onClick={() => setUnlink(true)}>
                  Uzish
                </button>
              ) : (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await post<{ link: string }>("/auth/telegram-link");
                      setLink(r.link);
                      window.open(r.link, "_blank", "noopener");
                    } catch (reason) {
                      toast(errorText(reason), "error");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Send size={14} /> Ulash
                </button>
              )}
            </div>
            {link && !data?.telegramLinked && (
              <div className="alert info">
                <Send size={18} />
                <div>
                  <b>Telegram’da «Start» tugmasini bosing</b>
                  <p>
                    Havola ochilmadi?{" "}
                    <a className="link" href={link} target="_blank" rel="noreferrer">
                      Botni ochish
                    </a>{" "}
                    · Havola 10 daqiqa amal qiladi. Ulangach bu sahifa o‘zi yangilanadi.
                  </p>
                </div>
              </div>
            )}
          </div>
          <form
            className="connect-card"
            onSubmit={async (e) => {
              e.preventDefault();
              setTwoFaError("");
              setBusy(true);
              try {
                await put("/auth/two-factor", { enabled: !data?.twoFactorEnabled, password });
                setPassword("");
                toast(data?.twoFactorEnabled ? "2 bosqichli kirish o‘chirildi" : "2 bosqichli kirish yoqildi");
                void reload(true);
              } catch (reason) {
                setTwoFaError(errorText(reason));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="connect-card-head">
              <span className="green">
                <ShieldCheck size={19} />
              </span>
              <div>
                <b>2-qadam: {data?.twoFactorEnabled ? "O‘chirish" : "Yoqish"}</b>
                <small>Tasdiqlash uchun joriy parolingizni kiriting</small>
              </div>
            </div>
            <div className="toolbar">
              <input
                className="input"
                style={{ flex: 1, minWidth: 180 }}
                type="password"
                placeholder="Joriy parol"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!data?.telegramLinked}
                required
              />
              <button
                className={`btn ${data?.twoFactorEnabled ? "btn-danger" : "btn-primary"}`}
                disabled={busy || !data?.telegramLinked}
              >
                {data?.twoFactorEnabled ? "O‘chirish" : "Yoqish"}
              </button>
            </div>
            <ErrorBox message={twoFaError} />
          </form>
        </div>
      </section>

      {user?.companyId && <MobileLoginCard />}

      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setPasswordError("");
          if (passwords.newPassword !== passwords.confirm) {
            setPasswordError("Yangi parollar bir xil emas.");
            return;
          }
          try {
            await put("/auth/password", {
              currentPassword: passwords.currentPassword,
              newPassword: passwords.newPassword,
            });
            setPasswords({ currentPassword: "", newPassword: "", confirm: "" });
            toast("Parol o‘zgartirildi");
          } catch (reason) {
            setPasswordError(errorText(reason));
          }
        }}
      >
        <div className="card-head">
          <h2>Parolni o‘zgartirish</h2>
          <KeyRound size={17} className="faint" />
        </div>
        <div className="card-body">
          <div className="form-grid cols-3">
            <Field label="Joriy parol">
              <input className="input" type="password" autoComplete="current-password" value={passwords.currentPassword} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} required />
            </Field>
            <Field label="Yangi parol">
              <input className="input" type="password" autoComplete="new-password" minLength={10} value={passwords.newPassword} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} required />
            </Field>
            <Field label="Takrorlang">
              <input className="input" type="password" autoComplete="new-password" minLength={10} value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} required />
            </Field>
          </div>
          <ErrorBox message={passwordError} />
          <div className="form-actions">
            <button className="btn">Parolni yangilash</button>
          </div>
        </div>
      </form>
      {unlink && (
        <Confirm
          title="Telegram’ni uzish"
          text="Telegram uzilsa, 2 bosqichli kirish ham o‘chadi."
          confirmLabel="Uzish"
          danger
          onClose={() => setUnlink(false)}
          onConfirm={async () => {
            await del("/auth/telegram-link");
            toast("Telegram uzildi");
            void reload(true);
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------ mobil ilova uchun login --- */
type MobileLogin = { login: string | null; suggested: string };
/** «ozodbek@staffora.uz» → «ozodbek» (maydonda faqat nom yoziladi, domen yonida turadi). */
const loginLocal = (value: string) => {
  const text = (value || "").trim();
  return text.toLowerCase().endsWith(LOGIN_SUFFIX) ? text.slice(0, -LOGIN_SUFFIX.length) : text;
};
function MobileLoginCard() {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<MobileLogin>("/auth/mobile-login");
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (data && !data.login && data.suggested) setValue((current) => current || loginLocal(data.suggested));
  }, [data]);
  const check = checkLoginInput(value);
  const showError = !check.ok && (touched || value.trim() !== "");
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Mobil ilova uchun login</h2>
          <p>Shu login bilan Staffora ilovasida faqat rahbar paneli ochiladi</p>
        </div>
        {data?.login && <span className="dot-text green">Berilgan</span>}
      </div>
      <div className="card-body">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <p className="hint">{error}</p>
        ) : data?.login ? (
          <div className="mlog-done">
            <div className="mlog-value">
              <span>Login</span>
              <b>{data.login}</b>
              <button
                type="button"
                className="icon-btn"
                aria-label="Loginni nusxalash"
                onClick={async () => {
                  await navigator.clipboard.writeText(data.login || "").catch(() => undefined);
                  toast("Nusxalandi");
                }}
              >
                <Copy size={14} />
              </button>
            </div>
            <p className="hint">Parol — panel parolingiz. Login o‘zgarmaydi.</p>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (check.ok) setConfirming(true);
            }}
          >
            <div className="field">
              <label className="label" htmlFor="mobile-login">
                Login
              </label>
              <span className={`mlog-input ${showError ? "invalid" : ""}`}>
                <input
                  id="mobile-login"
                  value={value}
                  placeholder="ozodbek"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={60}
                  aria-invalid={showError}
                  aria-describedby="mobile-login-note"
                  onChange={(e) => setValue(loginLocal(e.target.value))}
                  onBlur={() => setTouched(true)}
                />
                <span className="mlog-suffix">{LOGIN_SUFFIX}</span>
              </span>
              {showError && !check.ok ? (
                <span className="field-error" id="mobile-login-note">
                  {check.error}
                </span>
              ) : (
                <span className="hint" id="mobile-login-note">
                  Parol — panel parolingiz. Login bir marta tanlanadi va keyin o‘zgarmaydi.
                </span>
              )}
            </div>
            <div className="form-actions mlog-actions">
              <button className="btn btn-primary" disabled={!check.ok}>
                <Save size={15} /> Saqlash
              </button>
            </div>
          </form>
        )}
      </div>
      {confirming && check.ok && (
        <Confirm
          title="Login saqlansinmi?"
          text={
            <>
              <b>{check.login}</b> — keyin o‘zgartirib bo‘lmaydi. Ilovaga shu login va panel parolingiz bilan kirasiz.
            </>
          }
          confirmLabel="Saqlash"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await post<{ login: string }>("/auth/mobile-login", { login: check.login });
            toast("Mobil ilova logini saqlandi");
            void reload(true);
          }}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------ qurilmalar --- */
type Device = {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};
function describeDevice(ua: string) {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "Noma’lum qurilma";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /YaBrowser/.test(ua)
        ? "Yandex"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Brauzer";
  const Icon = /iPhone|Android.*Mobile/.test(ua) ? Smartphone : /iPad|Android/.test(ua) ? Tablet : /Windows|Linux/.test(ua) ? Monitor : Laptop;
  return { name: `${browser} · ${os}`, Icon };
}
const time = (value: string) =>
  `${dateUz(value)} ${new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" })}`;

function DevicesSection() {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<Device[]>("/auth/devices");
  const [removing, setRemoving] = useState<Device | "others" | null>(null);
  if (loading && !data) return <Loading />;
  const others = (data || []).filter((d) => !d.current).length;
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Kirgan qurilmalar</h2>
          <p>Panelga hozir kirilgan barcha qurilmalar. Tanimagan qurilmani darhol chiqarib yuboring.</p>
        </div>
        {others > 0 && (
          <button className="btn btn-sm btn-danger" onClick={() => setRemoving("others")}>
            <LogOut size={14} /> Boshqalaridan chiqish
          </button>
        )}
      </div>
      <ErrorBox message={error} />
      <div className="device-list">
        {data?.map((d) => {
          const { name, Icon } = describeDevice(d.userAgent);
          return (
            <div key={d.id} className={`device-row ${d.current ? "current" : ""}`}>
              <span className="device-icon">
                <Icon size={20} />
              </span>
              <span>
                <b>
                  {name}
                  {d.current && <span className="badge green plain" style={{ marginLeft: 8 }}>Shu qurilma</span>}
                </b>
                <small>
                  IP {d.ip || "—"} · Kirgan: {time(d.createdAt)} · Oxirgi faollik: {time(d.lastSeenAt)}
                </small>
              </span>
              <button className="btn btn-sm btn-danger" onClick={() => setRemoving(d)}>
                {d.current ? "Chiqish" : "Chiqarib yuborish"}
              </button>
            </div>
          );
        })}
        {data?.length === 0 && <p className="muted" style={{ padding: 18 }}>Faol qurilma yo‘q.</p>}
      </div>
      {removing && (
        <Confirm
          title={removing === "others" ? "Boshqa qurilmalardan chiqish" : "Qurilmani chiqarib yuborish"}
          text={
            removing === "others"
              ? `${others} ta qurilmadan sessiya yopiladi. Shu qurilmada qolasiz.`
              : removing.current
                ? "Shu qurilmadan chiqasiz."
                : `${describeDevice(removing.userAgent).name} qurilmasi tizimdan chiqariladi va qayta kirishi kerak bo‘ladi.`
          }
          confirmLabel="Chiqarish"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            if (removing === "others") {
              const r = await post<{ count: number }>("/auth/devices/revoke-others");
              toast(`${r.count} ta qurilma chiqarildi`);
              void reload(true);
            } else {
              await del(`/auth/devices/${removing.id}`);
              if (removing.current) {
                await api("/auth/logout", { method: "POST" }).catch(() => undefined);
                window.location.href = "/login";
                return;
              }
              toast("Qurilma chiqarildi");
              void reload(true);
            }
          }}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------- kompaniya --- */
function CompanySection() {
  const toast = useToast();
  const { data, loading, error } = useApi<Company>("/company");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) setName(data.name);
  }, [data]);
  if (loading && !data) return <Loading />;
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          await put("/company", { name, timezone: data?.timezone || "Asia/Tashkent" });
          toast("Kompaniya nomi saqlandi");
        } catch (reason) {
          toast(errorText(reason), "error");
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="card-head">
        <h2>Kompaniya</h2>
        <span className="badge plain green">{data?.plan} tarif</span>
      </div>
      <div className="card-body">
        <div className="form-grid">
          <Field label="Kompaniya nomi">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </Field>
          <Field label="Egasi">
            <input className="input" value={data?.ownerName || ""} disabled />
          </Field>
        </div>
        <p className="hint" style={{ marginBottom: 12 }}>
          Egasining ismini o‘zgartirish uchun egasi o‘z «Profil» bo‘limidan yoki «Panel foydalanuvchilari» sahifasidan foydalaning.
        </p>
        <ErrorBox message={error} />
        <div className="form-actions">
          <button className="btn btn-primary" disabled={saving}>
            <Save size={15} /> Saqlash
          </button>
        </div>
      </div>
    </form>
  );
}

/* ---------------------------------------------------- ish haqi / jarima --- */
/** Sozlamalar guruhi: sarlavha, bir qatorli izoh va ichidagi qatorlar. */
function SettingGroup({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="set-group">
      <header>
        <h3>{title}</h3>
        {note && <p>{note}</p>}
      </header>
      <div className="set-group-body">{children}</div>
    </section>
  );
}

/** Yoqish/o‘chirish qatori. `sub` — yuqoridagi sozlamaga bog‘liq (ichkariroq turadi). */
function SwitchRow({
  title,
  text,
  checked,
  onChange,
  sub,
}: {
  title: string;
  text?: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  sub?: boolean;
}) {
  return (
    <label className={`setting-row ${sub ? "sub" : ""}`}>
      <span>
        <b>{title}</b>
        {text && <small>{text}</small>}
      </span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
    </label>
  );
}

function PayrollSection() {
  const toast = useToast();
  const { data, loading } = useApi<Company>("/company");
  const [form, setForm] = useState<PayrollSettings>(defaultPayrollSettings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (data) setForm({ ...defaultPayrollSettings, ...(data.payroll || {}) });
  }, [data]);
  if (loading && !data) return <Loading />;
  const set = (patch: Partial<PayrollSettings>) => setForm((current) => ({ ...current, ...patch }));
  // Namuna: 5 000 000 oylik, 3 kun jami 25 daqiqa kechikish
  const example = calculatePayroll(
    5_000_000,
    [
      { checkIn: "09:10", lateMinutes: 10, workedMinutes: 480, overtimeMinutes: 0 },
      { checkIn: "09:05", lateMinutes: 5, workedMinutes: 480, overtimeMinutes: 0 },
      { checkIn: "09:10", lateMinutes: 10, workedMinutes: 480, overtimeMinutes: 0 },
    ],
    form,
  );
  const advance = form.advanceRequestsEnabled !== false;
  const advanceDays = advanceWindow(form, tashkentIsoDate());
  return (
    <form
      className="card pay-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError("");
        try {
          await put("/company/payroll", form);
          toast("Ish haqi sozlamalari saqlandi");
        } catch (reason) {
          setError(errorText(reason));
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="card-head">
        <div>
          <h2>Ish haqi va jarima</h2>
          <p>Qoidalar joriy va keyingi oylar hisobiga ta’sir qiladi</p>
        </div>
      </div>
      <div className="card-body">
        <SettingGroup title="Kechikish" note="Kechikkan daqiqalar oy davomida yig‘iladi va oylikdan bir marta ushlanadi">
          <div className="mode-options three">
            {(
              [
                ["PER_MINUTE", "Har daqiqa uchun", "Belgilangan summa × kechikkan daqiqa"],
                ["HOURLY", "Soatlik stavka", "Oylik / ish soati × kechikkan vaqt"],
                ["NONE", "Ushlanmasin", "Faqat hisobotda ko‘rinadi"],
              ] as const
            ).map(([value, title, text]) => (
              <button
                type="button"
                key={value}
                aria-pressed={form.latePenaltyMode === value}
                className={`mode-option ${form.latePenaltyMode === value ? "active" : ""}`}
                onClick={() => set({ latePenaltyMode: value })}
              >
                <b>{title}</b>
                <small>{text}</small>
              </button>
            ))}
          </div>
          {form.latePenaltyMode !== "NONE" && (
            <div className="form-grid set-fields">
              {form.latePenaltyMode === "PER_MINUTE" && (
                <Field label="1 daqiqa kechikish uchun (so‘m)">
                  <input className="input" type="number" min={0} step={100} value={form.latePenaltyPerMinute} onChange={(e) => set({ latePenaltyPerMinute: Number(e.target.value) })} />
                </Field>
              )}
              {form.latePenaltyMode === "HOURLY" && (
                <Field label="Oylik ish soati" hint="Soatlik stavka = oylik / shu son">
                  <input className="input" type="number" min={1} max={400} value={form.monthlyHours} onChange={(e) => set({ monthlyHours: Number(e.target.value) })} />
                </Field>
              )}
              <Field label="Oyiga jarimasiz daqiqalar" hint="Masalan 15 — oyiga 15 daqiqagacha kechikish kechiriladi">
                <input className="input" type="number" min={0} value={form.freeLateMinutesPerMonth} onChange={(e) => set({ freeLateMinutesPerMonth: Number(e.target.value) })} />
              </Field>
            </div>
          )}
          <SwitchRow
            title="Kechikishni ishlab yopish"
            text="Kechikkan daqiqalarni ish tugagach qolib ishlasa — o‘sha kungi kechikish yopiladi, jarima va ushlanma bo‘lmaydi. Misol: 30 daq kech keldi → 30 daq ko‘p qoldi → 0 so‘m."
            checked={Boolean(form.lateOffset)}
            onChange={(lateOffset) => set({ lateOffset })}
          />
          <p className="set-example">
            <Banknote size={15} />
            <span>
              <b>Namuna:</b> {example.explanation} (Oylik {money(5_000_000)}, 3 marta jami 25 daqiqa kechikish.)
            </span>
          </p>
        </SettingGroup>

        <SettingGroup title="Qo‘shimcha ish" note="Smena tugagandan keyin qolib ishlangan vaqt">
          <SwitchRow
            title="Qo‘shimcha ish uchun to‘lash"
            text={
              form.overtimePay ? (
                "Smenadan keyin ishlangan soatlar soatlik stavka bo‘yicha oylikka qo‘shiladi"
              ) : (
                <span className="dot-text gray">O‘chiq: smenadan keyin qolish oddiy ish vaqti — to‘lov ham, rahbarga so‘rov ham yo‘q</span>
              )
            }
            checked={form.overtimePay}
            onChange={(overtimePay) => set({ overtimePay })}
          />
          {form.overtimePay && (
            <SwitchRow
              sub
              title="Faqat rahbar tasdiqlagandan keyin to‘lansin"
              text="Rahbar «Ish haqi → Qo‘shimcha ish» oynasida tasdiqlagan soatlargina pul bo‘ladi"
              checked={Boolean(form.overtimeRequiresApproval)}
              onChange={(overtimeRequiresApproval) => set({ overtimeRequiresApproval })}
            />
          )}
          {form.overtimePay && form.overtimeRequiresApproval && (
            <SwitchRow
              sub
              title="Ikki bosqichli tasdiq"
              text="Avval rahbar (filial rahbari yoki HR), keyin moliya. Moliya foydalanuvchisi bo‘lmasa — bitta tasdiq yetarli"
              checked={Boolean(form.overtimeTwoStep)}
              onChange={(overtimeTwoStep) => set({ overtimeTwoStep })}
            />
          )}
        </SettingGroup>

        <SettingGroup title="Avans">
          <SwitchRow
            title="Xodimlar Mini App orqali avans so‘ray oladi"
            text="Tasdiqlangan summa oylikdan avtomatik ushlanadi"
            checked={advance}
            onChange={(advanceRequestsEnabled) => set({ advanceRequestsEnabled })}
          />
          {advance && (
            <SwitchRow
              sub
              title="Avval HR, keyin moliya tasdiqlaydi"
              text="O‘chirilsa — faqat moliya («Ish haqi → Avans so‘rovlari»)"
              checked={form.advanceHrApproval !== false}
              onChange={(advanceHrApproval) => set({ advanceHrApproval })}
            />
          )}
          {advance && (
            <div className="form-grid set-fields sub">
              <Field label="Oyiga avans chegarasi (oylikning %)" hint="Masalan 50 — oylik 4 mln bo‘lsa, ko‘pi bilan 2 mln">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  value={form.advanceMaxPercent ?? 50}
                  onChange={(e) => set({ advanceMaxPercent: Number(e.target.value) })}
                  style={{ maxWidth: 160 }}
                />
              </Field>
              <Field label="So‘rov qabul qilinadigan kunlar" hint={`1 va 31 — oy davomida. Hozir: ${advanceDays.text}.`}>
                <span className="day-range">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={31}
                    value={form.advanceWindowFrom ?? 1}
                    onChange={(e) => set({ advanceWindowFrom: Number(e.target.value) })}
                    aria-label="Boshlanish kuni"
                  />
                  <span>-kunidan</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={31}
                    value={form.advanceWindowTo ?? 31}
                    onChange={(e) => set({ advanceWindowTo: Number(e.target.value) })}
                    aria-label="Tugash kuni"
                  />
                  <span>-kunigacha</span>
                </span>
              </Field>
            </div>
          )}
          {advance && !advanceDays.always && (
            <SwitchRow
              sub
              title="Oyna ochilgan kuni xodimlarga xabar"
              text="Soat 09:00 da ilova, Telegram va telefonga «Avans oluvchilar ro‘yxatini shakllantiryapmiz» xabari boradi"
              checked={form.advanceAnnounce !== false}
              onChange={(advanceAnnounce) => set({ advanceAnnounce })}
            />
          )}
        </SettingGroup>

        <SettingGroup title="Kelmaslik">
          <SwitchRow
            title="Sababsiz kelmagan kun uchun ushlanma"
            text="Kunlik stavka = oylik / oydagi ish kunlari. Ta’til, dam olish va mashq davri hisobga kirmaydi"
            checked={form.absencePenalty === "DAILY"}
            onChange={(on) => set({ absencePenalty: on ? "DAILY" : "NONE" })}
          />
          {form.absencePenalty === "DAILY" && (
            <SwitchRow
              sub
              title="Dam olish kunida ishlab qoplash"
              text="Shu oydagi dam kunida ishlasa — ushlanma olinmaydi (o‘sha kun qo‘shimcha ish sifatida to‘lanmaydi)"
              checked={form.absenceCompensation !== false}
              onChange={(absenceCompensation) => set({ absenceCompensation })}
            />
          )}
        </SettingGroup>

        <SettingGroup title="Tanaffus">
          <SwitchRow
            title="Tanaffusni ish vaqtidan ayirish"
            text="Xodim «Tanaffus» bosgan vaqt (tushlik va h.k.) ishlangan soatga qo‘shilmaydi"
            checked={Boolean(form.deductBreaks)}
            onChange={(deductBreaks) => set({ deductBreaks })}
          />
        </SettingGroup>

        <p className="hint set-foot-hint">
          Kechikish grafikdagi «kechikish imtiyozi»dan oshgan daqiqalar uchun hisoblanadi. Ushlanma hech qachon oylikdan oshmaydi.
        </p>
        <ErrorBox message={error} />
      </div>
      <div className="set-savebar">
        <button className="btn btn-primary" disabled={saving}>
          <Save size={15} /> {saving ? "Saqlanmoqda…" : "Saqlash"}
        </button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------- Mini App --- */
type MiniAppForm = {
  biometricEnabled: boolean;
  faceEvery: number;
  directoryEnabled: boolean;
  directoryPhones: boolean;
  breaksEnabled: boolean;
  leaderboardEnabled: boolean;
  managerDigest: boolean;
  managerReportAt: string;
};
const miniDefaults: MiniAppForm = {
  biometricEnabled: true,
  faceEvery: 5,
  directoryEnabled: true,
  directoryPhones: false,
  breaksEnabled: false,
  leaderboardEnabled: true,
  managerDigest: true,
  managerReportAt: "10:00",
};
function MiniAppSection() {
  const toast = useToast();
  const { data, loading } = useApi<Company>("/company");
  const [form, setForm] = useState<MiniAppForm>(miniDefaults);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (data) setForm({ ...miniDefaults, ...(data.miniApp || {}) } as MiniAppForm);
  }, [data]);
  if (loading && !data) return <Loading />;
  const toggle = (key: keyof MiniAppForm, title: string, text: string) => (
    <label className="setting-row">
      <span>
        <b>{title}</b>
        <small>{text}</small>
      </span>
      <span className="switch">
        <input type="checkbox" checked={Boolean(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
        <span />
      </span>
    </label>
  );
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError("");
        try {
          await put("/company/mini-app", form);
          toast("Mini App sozlamalari saqlandi");
        } catch (reason) {
          setError(errorText(reason));
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="card-head">
        <div>
          <h2>Xodimlar ilovasi (Telegram Mini App)</h2>
          <p>Xavfsizlik va qo‘shimcha imkoniyatlar — o‘zgarish xodimlarda darhol ko‘rinadi</p>
        </div>
      </div>
      <div className="card-body">
        <div className="stack" style={{ gap: 8, marginBottom: 16 }}>
          {toggle(
            "biometricEnabled",
            "Telefon biometriyasi (barmoq izi / Face ID)",
            "Xodim bir marta yuz bilan tasdiqlab, keyin barmoq izi bilan 1 soniyada belgilaydi. O‘chirilsa, barcha ulangan qurilmalar bekor qilinadi.",
          )}
          {form.biometricEnabled && (
            <Field label="Har nechanchi belgida baribir yuz tekshirilsin" hint="Masalan 5 — 4 marta barmoq izi, 5-marta kamera orqali yuz. Shuningdek, 7 kunda kamida bir marta.">
              <input className="input" type="number" min={2} max={50} value={form.faceEvery} onChange={(e) => setForm({ ...form, faceEvery: Number(e.target.value) })} style={{ maxWidth: 160 }} />
            </Field>
          )}
          {toggle("directoryEnabled", "Hamkasblar ma’lumotnomasi", "Xodimlar kompaniyadagi hamkasblarini (ism, lavozim, filial) ko‘radi va Telegram’da yoza oladi")}
          {form.directoryEnabled && toggle("directoryPhones", "Ma’lumotnomada telefon raqamlari", "Yoqilsa, hamkasblar bir-biriga qo‘ng‘iroq qila oladi. Shaxsiy ma’lumot — ehtiyot bo‘ling")}
          {toggle("leaderboardEnabled", "Vaqtida kelish reytingi", "Statistikada filial ichidagi o‘rin va eng intizomli 3 kishi (faqat ism) ko‘rinadi")}
          {toggle("breaksEnabled", "Tanaffus (tushlik) belgilash", "Ish vaqtida «Tanaffus» tugmasi chiqadi. Ma’lumot uchun — ish haqiga ta’sir qilmaydi")}
          {toggle("managerDigest", "Rahbarlarga kunlik davomat xabari", "Ish boshlanib 20 daqiqa o‘tgach — «hali kelmaganlar», belgilangan vaqtda — kim kelmadi va kim kechikdi (Telegram va ilovaga push)")}
          {form.managerDigest && (
            <Field label="Kunlik hisobot vaqti" hint="Rahbar, HR va filial rahbariga «Kelmadi 3: … · Kechikdi 2: …» xabari shu vaqtda boradi">
              <TimeInput className="input" value={form.managerReportAt || "10:00"} onChange={(v) => setForm({ ...form, managerReportAt: v || "10:00" })} style={{ maxWidth: 160 }} required />
            </Field>
          )}
        </div>
        <ErrorBox message={error} />
        <div className="form-actions">
          <button className="btn btn-primary" disabled={saving}>
            <Save size={15} /> {saving ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
      </div>
    </form>
  );
}

type ClientLog = { id: string; kind: string; message: string; detail?: string; platform?: string; version?: string; at: string; employeeName?: string };
const logKinds: Record<string, string> = { gps: "GPS", camera: "Kamera", auth: "Kirish", biometric: "Biometriya", js: "Ilova", promise: "Ilova", crash: "Ilova qulashi", screen: "Ekran xatosi" };
function ClientLogsSection() {
  const { data, loading, error, reload } = useApi<ClientLog[]>("/client-logs");
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Ilova va Mini App xatolari</h2>
          <p>Xodimlarning telefonida yuz bergan muammolar (ilova qulashi, GPS, kamera, kirish) — qaysi telefon va versiya bilan</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => void reload()}>
          Yangilash
        </button>
      </div>
      <div className="card-body">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} />
        ) : !data?.length ? (
          <p className="hint">Xatolar yo‘q — hammasi joyida.</p>
        ) : (
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>Vaqt</th>
                  <th>Xodim</th>
                  <th>Turi</th>
                  <th>Xabar</th>
                  <th>Qurilma</th>
                </tr>
              </thead>
              <tbody>
                {data.slice(0, 100).map((log) => (
                  <tr key={log.id} onClick={() => setOpen(open === log.id ? null : log.id)} style={{ cursor: log.detail ? "pointer" : undefined }}>
                    <td style={{ whiteSpace: "nowrap" }}>{new Date(log.at).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" })}</td>
                    <td>{log.employeeName || "—"}</td>
                    <td>
                      <span className={log.kind === "crash" ? "badge red plain" : undefined}>{logKinds[log.kind] || log.kind}</span>
                    </td>
                    <td>
                      {log.message}
                      {open === log.id && log.detail && <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, margin: "6px 0 0", opacity: 0.75 }}>{log.detail}</pre>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {log.platform || "—"}
                      {log.version ? ` · ${log.version}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- telegram bot --- */
type BotStatus = { state: string; mode?: string; username?: string; error?: string; webAppUrl?: string };
function BotSection() {
  const { data: bot, loading } = useApi<BotStatus>("/telegram/status");
  if (loading && !bot) return <Loading />;
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Telegram bot</h2>
          <p>Xodimlar davomatni shu bot orqali belgilaydi</p>
        </div>
        {bot?.state === "running" ? (
          <span className="badge green live">Ishlayapti</span>
        ) : (
          <span className="badge red">{bot?.state === "disabled" ? "O‘chirilgan" : "Xato"}</span>
        )}
      </div>
      <div className="card-body">
        <div className="kv">
          <div>
            <span>Bot</span>
            <b>
              {bot?.username ? (
                <a className="link" href={`https://t.me/${bot.username}`} target="_blank" rel="noreferrer">
                  <Send size={13} /> @{bot.username}
                </a>
              ) : (
                "—"
              )}
            </b>
          </div>
          <div>
            <span>Rejim</span>
            <b>{bot?.mode === "webhook" ? "Webhook" : bot?.mode === "polling" ? "Polling" : "—"}</b>
          </div>
          <div>
            <span>Mini App manzili</span>
            <b>{bot?.webAppUrl || "—"}</b>
          </div>
        </div>
        {bot?.error && (
          <div className="alert warn" style={{ marginTop: 12 }}>
            <XCircle size={18} />
            <div>
              <b>Muammo</b>
              <p>{bot.error}. Railway Variables’da APP_URL=https://&lt;domen&gt; ni tekshiring.</p>
            </div>
          </div>
        )}
        {bot?.state === "running" && !bot.error && (
          <div className="alert success" style={{ marginTop: 12 }}>
            <CheckCircle2 size={18} />
            <div>
              <b>Xodimlarni ulash</b>
              <p>Xodim botda /start bosib telefon raqamini yuboradi — raqam profilidagi bilan mos kelsa avtomatik ulanadi.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ ekran qulfi --- */
function ScreenLockSection() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const lock = user?.screenLock;
  const [enabled, setEnabled] = useState(Boolean(lock?.enabled));
  const [minutes, setMinutes] = useState(lock?.minutes || 5);
  const [lockPassword, setLockPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const needsNewPassword = enabled && !lock?.hasPassword;
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        if (lockPassword && lockPassword !== confirmPassword) {
          setError("Qulf parollari bir xil emas.");
          return;
        }
        setSaving(true);
        try {
          await put("/auth/screen-lock", {
            enabled,
            minutes,
            lockPassword: lockPassword || undefined,
            accountPassword,
          });
          setLockPassword("");
          setConfirmPassword("");
          setAccountPassword("");
          await refresh();
          toast(enabled ? `Ekran qulfi yoqildi · ${minutes} daqiqa` : "Ekran qulfi o‘chirildi");
        } catch (reason) {
          setError(errorText(reason));
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="card-head">
        <div>
          <h2>Ekran qulfi</h2>
          <p>Kompyuterdan uzoqlashganingizda panel avtomatik qulflanadi — boshqa odam ma’lumotni ko‘ra olmaydi</p>
        </div>
        <span className={`badge ${lock?.enabled ? "green" : "gray"}`}>{lock?.enabled ? "Yoqilgan" : "O‘chirilgan"}</span>
      </div>
      <div className="card-body">
        <label className="setting-row">
          <span>
            <b>Harakatsizlikda qulflash</b>
            <small>Sichqoncha va klaviatura ishlatilmasa ekran xiralashadi va parol so‘raladi</small>
          </span>
          <span className="switch">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span />
          </span>
        </label>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <Field label="Necha daqiqadan keyin qulflansin">
            <select className="select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} disabled={!enabled}>
              {[1, 2, 3, 5, 10, 15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} daqiqa
                </option>
              ))}
            </select>
          </Field>
          <div />
          <Field
            label={lock?.hasPassword ? "Yangi qulf paroli (ixtiyoriy)" : "Qulf paroli"}
            hint="Faqat shu panel uchun, kamida 4 belgi"
          >
            <input className="input" type="password" autoComplete="new-password" minLength={4} value={lockPassword} onChange={(e) => setLockPassword(e.target.value)} required={needsNewPassword} disabled={!enabled} />
          </Field>
          <Field label="Qulf parolini takrorlang">
            <input className="input" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required={Boolean(lockPassword)} disabled={!enabled} />
          </Field>
          <Field label="Hisob parolingiz" hint="O‘zgarishni tasdiqlash uchun" className="span-2">
            <input className="input" type="password" autoComplete="current-password" value={accountPassword} onChange={(e) => setAccountPassword(e.target.value)} required />
          </Field>
        </div>
        <ErrorBox message={error} />
        <div className="form-actions">
          <button className="btn btn-primary" disabled={saving}>
            <Save size={15} /> {saving ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
        {lock?.enabled && (
          <p className="hint" style={{ marginTop: 12 }}>
            Yuqori paneldagi <Lock size={12} style={{ display: "inline", verticalAlign: -2 }} /> tugmasi bilan ekranni darhol
            qulflashingiz mumkin. Qulf serverda ham belgilanadi — sahifani yangilash uni ochmaydi.
          </p>
        )}
      </div>
    </form>
  );
}

/* ------------------------------------------------------------ rasm kanali --- */
type ChannelInfo = {
  settings: { enabled: boolean; chatId: string; chatTitle?: string; retentionDays: number };
  pending: number;
  lastError?: string;
  sent: number;
  botUsername?: string;
};
const retentionOptions: [number, string][] = [
  [3, "3 kundan keyin"],
  [7, "1 haftadan keyin"],
  [14, "2 haftadan keyin"],
  [30, "1 oydan keyin"],
  [60, "2 oydan keyin"],
  [90, "3 oydan keyin"],
  [180, "6 oydan keyin"],
  [0, "O‘chirilmasin"],
];
function PhotoChannelSection() {
  const toast = useToast();
  const { data, loading, reload } = useApi<ChannelInfo>("/company/photo-channel");
  const [enabled, setEnabled] = useState(false);
  const [chatId, setChatId] = useState("");
  const [retention, setRetention] = useState(30);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  useEffect(() => {
    if (!data) return;
    setEnabled(data.settings.enabled);
    setChatId(data.settings.chatId);
    setRetention(data.settings.retentionDays);
  }, [data]);
  if (loading && !data) return <Loading />;
  const bot = data?.botUsername ? `@${data.botUsername}` : "Staffora bot";
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setBusy("save");
        try {
          await put("/company/photo-channel", { enabled, chatId, retentionDays: retention });
          toast(enabled ? "Kanal ulandi — sinov xabari yuborildi" : "Saqlandi");
          void reload(true);
        } catch (reason) {
          setError(errorText(reason));
        } finally {
          setBusy(null);
        }
      }}
    >
      <div className="card-head">
        <div>
          <h2>Keldi-ketdi rasmlari kanali</h2>
          <p>Har bir keldi-ketdida Face ID rasmi vaqti bilan maxfiy Telegram kanalingizga tushadi</p>
        </div>
        <span className={`badge ${data?.settings.enabled ? "green" : "gray"}`}>
          {data?.settings.enabled ? data.settings.chatTitle || "Ulangan" : "O‘chirilgan"}
        </span>
      </div>
      <div className="card-body">
        <ol className="steps-list">
          <li>
            Telegram’da <b>maxfiy (private) kanal</b> yarating.
          </li>
          <li>
            {bot}’ni kanalga <b>administrator</b> qilib qo‘shing: «Xabar joylash» va «Xabarlarni o‘chirish» huquqlari bilan.
          </li>
          <li>
            Kanal ID’sini kiriting (<code>-100…</code>). ID’ni bilish uchun kanaldagi istalgan xabarni{" "}
            <a className="link" href="https://t.me/userinfobot" target="_blank" rel="noreferrer">
              @userinfobot
            </a>{" "}
            ga forward qiling.
          </li>
        </ol>
        <label className="setting-row" style={{ marginTop: 14 }}>
          <span>
            <b>Rasmlarni kanalga yuborish</b>
            <small>Caption’da xodim, keldi/ketdi vaqti, sana, filial va kechikish yoziladi</small>
          </span>
          <span className="switch">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span />
          </span>
        </label>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <Field label="Kanal ID yoki @username">
            <input className="input" value={chatId} placeholder="-1001234567890" onChange={(e) => setChatId(e.target.value)} disabled={!enabled} />
          </Field>
          <Field label="Rasmlarni avtomatik o‘chirish" hint="Kanaldagi eski rasmlar shu muddatdan keyin o‘chiriladi">
            <select className="select" value={retention} onChange={(e) => setRetention(Number(e.target.value))}>
              {retentionOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {data && (data.pending > 0 || data.sent > 0) && (
          <div className="kv" style={{ marginBottom: 12 }}>
            <div>
              <span>Kanaldagi rasmlar</span>
              <b>{data.sent}</b>
            </div>
            <div>
              <span>Navbatda kutayotgan</span>
              <b>{data.pending}</b>
            </div>
          </div>
        )}
        {data?.lastError && (
          <div className="alert warn" style={{ marginBottom: 12 }}>
            <XCircle size={18} />
            <div>
              <b>Oxirgi yuborishda xato</b>
              <p>{data.lastError}. Rasmlar navbatda saqlangan va avtomatik qayta yuboriladi.</p>
            </div>
          </div>
        )}
        <ErrorBox message={error} />
        <div className="form-actions">
          <button
            type="button"
            className="btn"
            disabled={!chatId || busy !== null}
            onClick={async () => {
              setError("");
              setBusy("test");
              try {
                const r = await post<{ title: string; canDelete: boolean }>("/company/photo-channel/test", { chatId });
                toast(`«${r.title}» — sinov xabari yuborildi`);
                if (!r.canDelete)
                  setError("Bot xabarlarni o‘chira olmaydi — avtomatik o‘chirish uchun «Xabarlarni o‘chirish» huquqini bering.");
              } catch (reason) {
                setError(errorText(reason));
              } finally {
                setBusy(null);
              }
            }}
          >
            <Send size={15} /> {busy === "test" ? "Tekshirilmoqda…" : "Sinab ko‘rish"}
          </button>
          <button className="btn btn-primary" disabled={busy !== null}>
            <Save size={15} /> {busy === "save" ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          Server yoki Telegram vaqtincha ishlamasa, rasm serverda navbatda saqlanadi va aloqa tiklanganda yuboriladi —
          caption’dagi vaqt keldi-ketdi bo‘lgan aniq vaqt bo‘lib qoladi.
        </p>
      </div>
    </form>
  );
}

/* ------------------------------------------------------ xavfli zona --- */
function DangerZone() {
  const toast = useToast();
  const { data } = useApi<{ limits?: { used: number } }>("/company");
  const { data: dismissed } = useApi<{ total: number }>("/employees?status=DISMISSED&limit=1");
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const total = (data?.limits?.used || 0) + (dismissed?.total || 0);
  return (
    <section className="card danger-card">
      <div className="card-head">
        <div>
          <h2>Xavfli zona</h2>
          <p>Bu amallarni qaytarib bo‘lmaydi</p>
        </div>
      </div>
      <div className="card-body">
        <div className="pv-danger">
          <div>
            <b>Barcha xodimlarni o‘chirish</b>
            <small>
              {total} ta xodim (ishdan bo‘shaganlar bilan) — profillari, davomati, ta’tillari, Face ID va rasmlari butunlay o‘chadi. Filial, bo‘lim, lavozim
              va grafiklar qoladi.
            </small>
          </div>
          <button className="btn btn-danger-solid" disabled={!total} onClick={() => setOpen(true)}>
            Barcha xodimlarni o‘chirish
          </button>
        </div>
      </div>
      {open && (
        <CountdownConfirm
          title="Barcha xodimlar o‘chirilsinmi?"
          confirmLabel={`Ha, ${total} ta xodimni o‘chirish`}
          onConfirm={async () => {
            if (word.trim().toUpperCase() !== "O‘CHIRISH") throw new Error("Tasdiqlash uchun O‘CHIRISH so‘zini yozing.");
            const result = await post<{ deleted: number }>("/employees/delete-all", { confirm: "O‘CHIRISH" });
            toast(`${result.deleted} ta xodim butunlay o‘chirildi`);
            setWord("");
          }}
          onClose={() => {
            setOpen(false);
            setWord("");
          }}
        >
          <p>
            <b>{total} ta xodim</b> va ularning barcha ma’lumotlari (davomat, ta’til, Face ID, rasmlar) butunlay o‘chadi.
          </p>
          <p className="muted">Xodimlar boti ulangan bo‘lsa, keyingi sinxronlashda xodimlar botdan qayta import qilinishi mumkin.</p>
          <label className="field" style={{ marginTop: 10 }}>
            <span className="label">Tasdiqlash uchun <b>O‘CHIRISH</b> deb yozing</span>
            <input className="input" value={word} onChange={(e) => setWord(e.target.value)} placeholder="O‘CHIRISH" autoComplete="off" />
          </label>
        </CountdownConfirm>
      )}
    </section>
  );
}
