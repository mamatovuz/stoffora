import { useState, type FormEvent } from "react";
import { BriefcaseBusiness, KeyRound, Plus, Scale, UserCheck, UserX, UsersRound } from "lucide-react";
import { api, post } from "../../api";
import { useApi } from "../../hooks";
import { Field, Modal, PageHeader, useToast } from "../../components/ui";
import { DataTable, ErrorState, Section, Skeleton, StatusBadge, dateTime, useAction } from "./kit";

/*
 * Corporate hisoblar — Staffora’ning o‘z ta’sischilari, CEO va investorlari (mijoz kompaniyalarga bog‘lanmaydi).
 * Ular asosiy /login sahifasidan shu login va parol bilan Corporate portalga kiradi.
 */
type Account = {
  id: string;
  firstName?: string;
  lastName?: string;
  name: string;
  email?: string;
  login?: string;
  role: string;
  shareBps?: number;
  status: string;
  lastLoginAt?: string;
  termsAcceptedAt?: string;
};
type Data = { accounts: Account[]; allocatedBps: number; reserveBps: number };
const roleLabels: Record<string, string> = {
  FOUNDER: "Founder",
  CO_FOUNDER: "Co-Founder",
  CEO: "CEO",
  INVESTOR: "Investor",
};
const pct = (bps = 0) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

export default function CorporateAccounts() {
  const { data, error, reload } = useApi<Data>("/super-admin/corporate/accounts");
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState<Account | null>(null);
  const toast = useToast();
  const run = useAction();
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton rows={7} />;
  const active = data.accounts.filter((x) => x.status === "ACTIVE");
  async function setStatus(account: Account, status: "ACTIVE" | "DISABLED") {
    const done = await run(
      () => api(`/super-admin/corporate/accounts/${account.id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
      toast,
      status === "ACTIVE" ? "Hisob faollashtirildi" : "Hisob bloklandi",
    );
    if (done) void reload(true);
  }
  return (
    <>
      <PageHeader
        title="Corporate hisoblar"
        subtitle="Staffora ta’sischilari, CEO va investorlari. Ular asosiy kirish sahifasidan shu login bilan Corporate portalga kiradi."
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={15} /> Hisob yaratish
          </button>
        }
      />
      <div className="sa-kpis">
        <div className="sa-kpi">
          <UsersRound />
          <span>
            <small>Jami hisoblar</small>
            <b>{data.accounts.length}</b>
          </span>
        </div>
        <div className="sa-kpi">
          <BriefcaseBusiness />
          <span>
            <small>Faol hisoblar</small>
            <b>{active.length}</b>
          </span>
        </div>
        <div className="sa-kpi">
          <Scale />
          <span>
            <small>Taqsimlangan ulush</small>
            <b>{pct(data.allocatedBps)}</b>
          </span>
        </div>
        <div className="sa-kpi">
          <Scale />
          <span>
            <small>Development reserve</small>
            <b>{pct(data.reserveBps)}</b>
          </span>
        </div>
      </div>
      <Section>
        <DataTable
          rows={data.accounts}
          rowKey={(x) => x.id}
          empty="Hali corporate hisob yo‘q — «Hisob yaratish» tugmasini bosing."
          columns={[
            {
              key: "name",
              label: "Foydalanuvchi",
              render: (x) => (
                <span className="stack">
                  <b>{x.name}</b>
                  <small>
                    @{x.login}
                    {x.email ? ` · ${x.email}` : ""}
                  </small>
                </span>
              ),
            },
            { key: "role", label: "Rol", render: (x) => roleLabels[x.role] || x.role },
            { key: "share", label: "Iqtisodiy manfaat", render: (x) => <b>{pct(x.shareBps)}</b> },
            { key: "terms", label: "Shartlar", render: (x) => (x.termsAcceptedAt ? `Qabul qilingan · ${dateTime(x.termsAcceptedAt)}` : "Birinchi kirishda") },
            { key: "status", label: "Holat", render: (x) => <StatusBadge value={x.status} /> },
            { key: "login", label: "Oxirgi kirish", render: (x) => (x.lastLoginAt ? dateTime(x.lastLoginAt) : "Hali kirmagan") },
            {
              key: "actions",
              label: "",
              render: (x) => (
                <span className="sa-row-actions">
                  <button className="btn btn-sm" onClick={() => setPassword(x)} title="Parolni almashtirish">
                    <KeyRound size={14} /> Parol
                  </button>
                  {x.status === "ACTIVE" ? (
                    <button className="btn btn-sm" onClick={() => void setStatus(x, "DISABLED")} title="Bloklash">
                      <UserX size={14} /> Bloklash
                    </button>
                  ) : (
                    <button className="btn btn-sm" onClick={() => void setStatus(x, "ACTIVE")} title="Faollashtirish">
                      <UserCheck size={14} /> Faollashtirish
                    </button>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Section>
      {open && (
        <Modal title="Corporate hisob yaratish" subtitle="Kirish ma’lumotlari va iqtisodiy manfaat ulushi" onClose={() => setOpen(false)}>
          <AccountForm
            freeBps={data.reserveBps}
            onSave={async (body) => {
              if (await run(() => post("/super-admin/corporate/accounts", body), toast, "Corporate hisob yaratildi")) {
                setOpen(false);
                void reload(true);
              }
            }}
          />
        </Modal>
      )}
      {password && (
        <Modal title="Parolni almashtirish" subtitle={`${password.name} · @${password.login}`} onClose={() => setPassword(null)}>
          <PasswordForm
            onSave={async (value) => {
              const done = await run(() => api(`/super-admin/corporate/accounts/${password.id}`, { method: "PATCH", body: JSON.stringify({ password: value }) }), toast, "Parol yangilandi");
              if (done) setPassword(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}

function AccountForm({ freeBps, onSave }: { freeBps: number; onSave: (body: unknown) => Promise<void> }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", login: "", password: "", role: "INVESTOR", share: "0" });
  const [busy, setBusy] = useState(false);
  const shareBps = Math.round(Number(form.share || 0) * 100);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave({ ...form, login: form.login.trim(), email: form.email.trim(), shareBps });
    } finally {
      setBusy(false);
    }
  }
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });
  return (
    <form onSubmit={(e) => void submit(e)}>
      <div className="form-grid">
        <Field label="Ism">
          <input className="input" required minLength={2} value={form.firstName} onChange={set("firstName")} />
        </Field>
        <Field label="Familiya">
          <input className="input" required minLength={2} value={form.lastName} onChange={set("lastName")} />
        </Field>
        <Field label="Rol">
          <select className="input" value={form.role} onChange={set("role")}>
            {Object.entries(roleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Email (ixtiyoriy)">
          <input className="input" type="email" value={form.email} onChange={set("email")} placeholder="investor@example.com" />
        </Field>
        <Field label="Login">
          <input className="input" required autoComplete="off" minLength={3} pattern="[a-zA-Z0-9._@\-]+" placeholder="investor.ali" value={form.login} onChange={set("login")} />
        </Field>
        <Field label="Vaqtinchalik parol">
          <input className="input" required type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={set("password")} />
        </Field>
        <Field label={`Iqtisodiy manfaat (%) · bo‘sh ${pct(freeBps)}`}>
          <input className="input" required type="number" min="0" max={freeBps / 100} step="0.01" value={form.share} onChange={set("share")} />
        </Field>
      </div>
      <div className="notice">
        <b>Eslatma:</b> foiz — kelishilgan foyda taqsimoti; qolgan qism avtomatik «Staffora Development Reserve»ga tushadi. Rasmiy yuridik egalik faqat tasdiqlangan hujjat bilan
        belgilanadi. Hisob egasi birinchi kirishda portal shartlarini qabul qiladi.
      </div>
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy || shareBps > freeBps}>
          {busy ? "Yaratilmoqda…" : "Hisob yaratish"}
        </button>
      </div>
    </form>
  );
}

function PasswordForm({ onSave }: { onSave: (password: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(value);
      }}
    >
      <Field label="Yangi parol (kamida 8 belgi)">
        <input className="input" required type="password" autoComplete="new-password" minLength={8} value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <div className="form-actions">
        <button className="btn btn-primary">Saqlash</button>
      </div>
    </form>
  );
}
