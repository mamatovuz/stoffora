import { useState } from "react";
import { Bot, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { errorText, post } from "../api";
import { useApi } from "../hooks";
import { ErrorBox, Loading, useToast } from "./ui";
import { money } from "@/lib/format";
import type { Employee } from "@/lib/types";

/*
 * Xodim profili → «Xodimlar boti»: integratsiya orqali bot’dan kelgan qo‘shimcha ma’lumot.
 * Bot API maydon nomlari o‘zgarishi mumkin — noma’lum kalitlar ham tushunarli ko‘rinishda chiqadi.
 */

type BotInfo = {
  connected: boolean;
  linked: boolean;
  externalId?: string;
  syncedAt?: string;
  canMoney: boolean;
  profile: Employee["botProfile"] | null;
};

const labels: Record<string, string> = {
  city: "Shahar",
  region: "Viloyat",
  district: "Tuman",
  marital_status: "Oilaviy holat",
  children: "Farzandlar",
  children_count: "Farzandlar",
  languages: "Tillar",
  computer: "Kompyuter",
  computer_skills: "Kompyuter",
  experience: "Tajriba",
  work_experience: "Tajriba",
  education: "Ma’lumoti",
  hire_type: "Qabul turi",
  admission_type: "Qabul turi",
  previous_salary: "Avvalgi oylik",
  expected_salary: "Kutilgan oylik",
  agreed_salary: "Kelishilgan oylik",
  type: "Turi",
  kind: "Turi",
  status: "Holat",
  start_date: "Boshlangan",
  started_at: "Boshlangan",
  end_date: "Tugaydi",
  ends_at: "Tugaydi",
  days_left: "Qolgan kun",
  salary: "Sinov oyligi",
  amount: "Summa",
  fines: "Jarimalar",
  advances: "Avanslar",
  medicines: "Dorilar",
  kpi: "KPI ushlanma",
  final_amount: "Yakuniy oylik",
  payments: "To‘lovlar",
  raise_requests: "Maosh oshirish so‘rovlari",
  salary_raises: "Maosh oshirish so‘rovlari",
  bonuses: "Bonuslar",
  reason: "Sabab",
  comment: "Izoh",
  note: "Izoh",
  date: "Sana",
  created_at: "Sana",
  period: "Davr",
};
const sourceLabels: Record<string, string> = {
  profile: "profil",
  probation: "sinov muddati",
  application: "ariza (kelishilgan)",
  registration: "ro‘yxatdan o‘tish",
};
const MONEY_KEYS = /amount|salary|sum|fines|advances|medicines|kpi|total|paid/i;

const humanize = (key: string) => labels[key] || key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function show(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Ha" : "Yo‘q";
  if (typeof value === "number") return MONEY_KEYS.test(key) ? money(value) : String(value);
  if (Array.isArray(value)) return value.map((item) => show(key, item)).join(", ");
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${humanize(k)}: ${show(k, v)}`).join(" · ");
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}(T|$)/.test(text) ? text.slice(0, 10).split("-").reverse().join(".") : text;
}

function KV({ data }: { data: Record<string, unknown> }) {
  const rows = Object.entries(data).filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (!rows.length) return <p className="muted">Ma’lumot yo‘q</p>;
  return (
    <dl className="bp-kv">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{humanize(key)}</dt>
          <dd>{show(key, value)}</dd>
        </div>
      ))}
    </dl>
  );
}

const ago = (iso?: string) => (iso ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export function BotProfileTab({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const { data, loading, error, reload } = useApi<BotInfo>(`/employees/${employeeId}/bot`);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return null;
  if (!data.connected || !data.linked)
    return (
      <div className="bp-empty">
        <Bot size={22} />
        <b>{data.connected ? "Xodim botga bog‘lanmagan" : "Xodimlar boti ulanmagan"}</b>
        <p className="muted">
          {data.connected
            ? "Sozlamalar → Integratsiyalar → «Hozir sinxronlash» — xodim telefon yoki Telegram ID bo‘yicha bog‘lanadi."
            : "Sozlamalar → Integratsiyalar bo‘limida xodimlar botini ulang."}
        </p>
      </div>
    );
  const p = data.profile;
  const salary = p?.botSalary;
  return (
    <div className="bp">
      <div className="bp-head">
        <span className="muted">
          Bot ID <b>#{data.externalId}</b> · sinxron {ago(p?.syncedAt || data.syncedAt)}
        </span>
        {canEdit && (
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await post(`/employees/${employeeId}/bot/refresh`, {});
                toast("Botdan yangilandi");
                await reload(true);
              } catch (reason) {
                toast(errorText(reason), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={14} className={busy ? "spin" : ""} /> Botdan yangilash
          </button>
        )}
      </div>

      <section className="bp-section">
        <h4>Asosiy</h4>
        <KV
          data={{
            "Telegram nomi": p?.telegramName,
            "Botdagi rol": p?.role,
            "Botdagi lavozim": p?.position,
            "Bandlik holati": p?.employmentStatus,
            "O‘zi yangilagan": p?.updatedBySelfAt,
          }}
        />
      </section>

      {p?.questionnaire && (
        <section className="bp-section">
          <h4>Anketa</h4>
          <KV data={p.questionnaire} />
        </section>
      )}

      {p?.probation && (
        <section className="bp-section">
          <h4>Sinov muddati</h4>
          <KV data={p.probation} />
        </section>
      )}

      {data.canMoney && (
        <section className="bp-section">
          <h4>Oylik (botda)</h4>
          {salary?.isSet && salary.amount ? (
            <div className="bp-salary">
              <b>{money(salary.amount)}</b>
              <small>
                {salary.text && salary.text !== String(salary.amount) ? `Botda: «${salary.text}» · ` : ""}
                manba: {sourceLabels[salary.source || ""] || salary.source || "profil"}
              </small>
            </div>
          ) : (
            <p className="muted">Botda oylik belgilanmagan — botda «💰 Oylik belgilash» orqali kiriting yoki API kalitga maosh ruxsatini bering.</p>
          )}
          {salary?.currentMonth && (
            <>
              <h5>Joriy oy hisobi</h5>
              <KV data={salary.currentMonth} />
            </>
          )}
          {salary?.questionnaire && <KV data={salary.questionnaire} />}
          <BotFinance employeeId={employeeId} />
        </section>
      )}

      {canEdit && <BotDocuments employeeId={employeeId} />}
    </div>
  );
}

function BotFinance({ employeeId }: { employeeId: string }) {
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const { data, loading, error } = useApi<Record<string, unknown>>(`/employees/${employeeId}/bot/finance?period=${period}`);
  const lists = Object.entries(data || {}).filter(([, value]) => Array.isArray(value)) as [string, Record<string, unknown>[]][];
  const totals = Object.fromEntries(Object.entries(data || {}).filter(([, value]) => !Array.isArray(value) && (typeof value !== "object" || value === null)));
  return (
    <div className="bp-finance">
      <div className="bp-finance-head">
        <h5>Moliya tafsiloti</h5>
        <input className="input" type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <p className="muted">{error}</p>
      ) : (
        <>
          {Object.keys(totals).length > 0 && <KV data={totals} />}
          {lists.map(([key, rows]) => (
            <details key={key} className="bp-list" open={rows.length > 0 && rows.length <= 5}>
              <summary>
                {humanize(key)} <span className="muted">· {rows.length}</span>
              </summary>
              {rows.length ? (
                rows.map((row, index) => (
                  <div key={String(row.id ?? index)}>
                    <span>{show("reason", row.reason ?? row.comment ?? row.note ?? row.title ?? row.type ?? "—")}</span>
                    <span className="muted">{show("date", row.date ?? row.created_at ?? row.period ?? "")}</span>
                    <b className="num">{show("amount", row.amount ?? row.sum ?? row.value ?? "")}</b>
                  </div>
                ))
              ) : (
                <p className="muted">Bu oyda yo‘q</p>
              )}
            </details>
          ))}
          {!lists.length && !Object.keys(totals).length && <p className="muted">Bu oyda yozuv yo‘q</p>}
        </>
      )}
    </div>
  );
}

const DOCS: [string, string][] = [
  ["passport_front", "Pasport (old)"],
  ["passport_back", "Pasport (orqa)"],
  ["diploma", "Diplom"],
  ["photo", "Rasm"],
];

function BotDocuments({ employeeId }: { employeeId: string }) {
  return (
    <section className="bp-section">
      <h4>Botdagi hujjatlar</h4>
      <div className="bp-docs">
        {DOCS.map(([kind, label]) => (
          <a key={kind} className="btn btn-sm" href={`/api/employees/${employeeId}/bot/documents/${kind}`} target="_blank" rel="noreferrer">
            <FileText size={14} /> {label} <ExternalLink size={12} />
          </a>
        ))}
      </div>
      <p className="muted bp-hint">Fayl bot proksi orqali ochiladi. API kalitda «employees:sensitive» ruxsati bo‘lishi kerak; har bir ko‘rish auditga yoziladi.</p>
    </section>
  );
}
