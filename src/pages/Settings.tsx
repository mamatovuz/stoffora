import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Banknote,
  Building2,
  Camera,
  CheckCircle2,
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
} from "lucide-react";
import { CountingStartCard, IntegrationCenter } from "./Integrations";
import { CompanyBotSection } from "./Registrations";
import { FormBuilder } from "./FormBuilder";
import { canAny } from "@/lib/permissions";

/** Har bir tab uchun kerakli ruxsat (bo‘sh — hamma panel foydalanuvchisi). */
const tabPermissions: Partial<Record<Tab, string[]>> = {
  company: ["settings.manage"],
  payroll: ["settings.manage", "payroll.edit"],
  channel: ["settings.manage"],
  bot: ["settings.manage"],
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
import { calculatePayroll, defaultPayrollSettings } from "@/lib/payroll";
import { dateUz, money } from "@/lib/format";
import { resizePhoto } from "./Employees";

type Tab = "profile" | "security" | "lock" | "devices" | "company" | "payroll" | "channel" | "bot" | "regbot" | "integrations";
const tabs: [Tab, string, typeof UserRound][] = [
  ["profile", "Profil", UserRound],
  ["security", "Xavfsizlik", ShieldCheck],
  ["lock", "Ekran qulfi", Lock],
  ["devices", "Qurilmalar", Laptop],
  ["company", "Kompaniya", Building2],
  ["payroll", "Ish haqi va jarima", Banknote],
  ["channel", "Rasm kanali", Camera],
  ["bot", "Telegram bot", Send],
  ["regbot", "Ro‘yxat boti", Bot],
  ["integrations", "Integratsiyalar", PlugZap],
];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const allowed = tabs.filter(([key]) => !tabPermissions[key] || (user ? canAny(user.role, tabPermissions[key]!) : false));
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
          {tab === "company" && <CompanySection />}
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
          {tab === "channel" && <PhotoChannelSection />}
          {tab === "bot" && <BotSection />}
          {tab === "integrations" && <IntegrationCenter />}
          {tab === "regbot" && (
            <>
              <CompanyBotSection />
              <FormBuilder />
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
  return (
    <form
      className="card"
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
          <h2>Kechikish uchun ushlanma</h2>
          <p>Kechikkan daqiqalar oy davomida yig‘iladi va oylikdan bir marta ushlab qolinadi</p>
        </div>
      </div>
      <div className="card-body">
        <div className="mode-options three" style={{ marginBottom: 16 }}>
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
              className={`mode-option ${form.latePenaltyMode === value ? "active" : ""}`}
              onClick={() => setForm({ ...form, latePenaltyMode: value })}
            >
              <b>{title}</b>
              <small>{text}</small>
            </button>
          ))}
        </div>
        <div className="form-grid">
          {form.latePenaltyMode === "PER_MINUTE" && (
            <Field label="1 daqiqa kechikish uchun (so‘m)">
              <input className="input" type="number" min={0} step={100} value={form.latePenaltyPerMinute} onChange={(e) => setForm({ ...form, latePenaltyPerMinute: Number(e.target.value) })} />
            </Field>
          )}
          {form.latePenaltyMode === "HOURLY" && (
            <Field label="Oylik ish soati" hint="Soatlik stavka = oylik / shu son">
              <input className="input" type="number" min={1} max={400} value={form.monthlyHours} onChange={(e) => setForm({ ...form, monthlyHours: Number(e.target.value) })} />
            </Field>
          )}
          {form.latePenaltyMode !== "NONE" && (
            <Field label="Oyiga jarimasiz daqiqalar" hint="Masalan 15 — oyiga 15 daqiqagacha kechikish kechiriladi">
              <input className="input" type="number" min={0} value={form.freeLateMinutesPerMonth} onChange={(e) => setForm({ ...form, freeLateMinutesPerMonth: Number(e.target.value) })} />
            </Field>
          )}
        </div>
        <label className="checkbox-row" style={{ marginBottom: 16 }}>
          <input type="checkbox" checked={form.overtimePay} onChange={(e) => setForm({ ...form, overtimePay: e.target.checked })} />
          Qo‘shimcha ish vaqti uchun soatlik stavka bo‘yicha qo‘shib to‘lansin
        </label>
        <div className="alert info" style={{ marginBottom: 14 }}>
          <Banknote size={18} />
          <div>
            <b>Namuna hisob</b>
            <p>
              {example.explanation} (Oylik {money(5_000_000)}, 3 marta jami 25 daqiqa kechikish.)
            </p>
          </div>
        </div>
        <p className="hint" style={{ marginBottom: 12 }}>
          Kechikish faqat grafikdagi «kechikish imtiyozi»dan oshgan daqiqalar uchun hisoblanadi. Ushlanma hech qachon
          oylikdan oshmaydi. O‘zgarish joriy va keyingi oylar hisobiga ta’sir qiladi.
        </p>
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
