import { useState, type FormEvent } from "react";
import { BriefcaseBusiness, Plus, UsersRound } from "lucide-react";
import { post } from "../../api";
import { useApi } from "../../hooks";
import { Field, Modal, PageHeader, useToast } from "../../components/ui";
import {
  DataTable,
  ErrorState,
  Section,
  Skeleton,
  StatusBadge,
  useAction,
} from "./kit";

type Account = {
  id: string;
  companyId: string;
  companyName: string;
  firstName?: string;
  lastName?: string;
  name: string;
  login?: string;
  role: string;
  shareBps?: number;
  status: string;
  lastLoginAt?: string;
};
type Data = { companies: { id: string; name: string }[]; accounts: Account[] };
const roleLabels: Record<string, string> = {
  FOUNDER: "Founder",
  CO_FOUNDER: "Co-Founder",
  CEO: "CEO",
  INVESTOR: "Investor",
};
export default function CorporateAccounts() {
  const { data, error, reload } = useApi<Data>(
    "/super-admin/corporate/accounts",
  );
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const run = useAction();
  if (error)
    return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton rows={7} />;
  return (
    <>
      <PageHeader
        title="Corporate hisoblar"
        subtitle="Founder, Co-Founder, CEO va Investorlar uchun alohida portal loginlarini boshqarish"
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
            <b>{data.accounts.filter((x) => x.status === "ACTIVE").length}</b>
          </span>
        </div>
      </div>
      <Section>
        <DataTable
          rows={data.accounts}
          rowKey={(x) => x.id}
          columns={[
            {
              key: "name",
              label: "Foydalanuvchi",
              render: (x) => (
                <span className="stack">
                  <b>{x.name}</b>
                  <small>@{x.login}</small>
                </span>
              ),
            },
            {
              key: "company",
              label: "Kompaniya",
              render: (x) => x.companyName,
            },
            {
              key: "role",
              label: "Rol",
              render: (x) => roleLabels[x.role] || x.role,
            },
            {
              key: "share",
              label: "Economic interest",
              render: (x) => <b>{((x.shareBps || 0) / 100).toFixed(2)}%</b>,
            },
            {
              key: "status",
              label: "Holat",
              render: (x) => <StatusBadge value={x.status} />,
            },
            {
              key: "login",
              label: "Oxirgi kirish",
              render: (x) =>
                x.lastLoginAt
                  ? new Date(x.lastLoginAt).toLocaleString("uz-UZ")
                  : "Hali kirmagan",
            },
          ]}
        />
      </Section>
      {open && (
        <Modal
          title="Corporate hisob yaratish"
          subtitle="Kirish ma’lumotlari va iqtisodiy manfaat ulushini belgilang"
          onClose={() => setOpen(false)}
        >
          <AccountForm
            companies={data.companies}
            onSave={async (body) => {
              if (
                await run(
                  () => post("/super-admin/corporate/accounts", body),
                  toast,
                  "Corporate hisob yaratildi",
                )
              ) {
                setOpen(false);
                void reload(true);
              }
            }}
          />
        </Modal>
      )}
    </>
  );
}
function AccountForm({
  companies,
  onSave,
}: {
  companies: Data["companies"];
  onSave: (body: unknown) => Promise<void>;
}) {
  const [form, setForm] = useState({
    companyId: companies[0]?.id || "",
    firstName: "",
    lastName: "",
    login: "",
    password: "",
    role: "INVESTOR",
    share: "0",
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    void onSave({ ...form, shareBps: Math.round(Number(form.share) * 100) });
  }
  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <Field label="Kompaniya">
          <select
            className="input"
            required
            value={form.companyId}
            onChange={(e) => setForm({ ...form, companyId: e.target.value })}
          >
            {companies.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rol">
          <select
            className="input"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {Object.entries(roleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ism">
          <input
            className="input"
            required
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
        </Field>
        <Field label="Familiya">
          <input
            className="input"
            required
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
        </Field>
        <Field label="Login">
          <input
            className="input"
            required
            autoComplete="off"
            placeholder="investor.ali"
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
          />
        </Field>
        <Field label="Vaqtinchalik parol">
          <input
            className="input"
            required
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <Field label="Economic interest (%)">
          <input
            className="input"
            required
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={form.share}
            onChange={(e) => setForm({ ...form, share: e.target.value })}
          />
        </Field>
      </div>
      <div className="notice">
        <b>Huquqiy eslatma:</b> bu foiz iqtisodiy manfaat modelidir; rasmiy
        yuridik egalik faqat tasdiqlangan hujjat bilan belgilanadi.
      </div>
      <div className="form-actions">
        <button className="btn btn-primary">Hisob yaratish</button>
      </div>
    </form>
  );
}
