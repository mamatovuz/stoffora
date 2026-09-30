import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  Briefcase,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Copy,
  GitMerge,
  KeyRound,
  Layers,
  Link2,
  LoaderCircle,
  PlugZap,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Send,
  Settings2,
  ShieldCheck,
  Unplug,
  Users,
  Webhook,
  XCircle,
} from "lucide-react";
import { api, errorText, post, put } from "../api";
import { useApi, usePolling } from "../hooks";
import { Confirm, Empty, ErrorBox, Field, Loading, Modal, Segmented, useToast } from "../components/ui";

/* ---------------------------------------------------------------- turlar --- */
type SyncMode = "IMPORT" | "EXPORT" | "TWO_WAY" | "OFF";
type Entity = "branch" | "department" | "position" | "employee" | "attendance";
type Channel = "staffora" | "telegram" | "bot";
type Category = "attendance" | "leave" | "announcements" | "system" | "payroll";
interface Settings {
  syncModes: Record<Entity, SyncMode>;
  conflictStrategy: "STAFFORA_WINS" | "BOT_WINS" | "LATEST" | "MANUAL";
  applyRemoteDeletes: boolean;
  createInBot: boolean;
  pushAttendance: boolean;
  pollIntervalSeconds: number;
  inviteTtlHours: number;
  miniAppLink?: string;
  routing: Record<Category, Channel[]>;
}
interface Integration {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyHint: string;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  remote?: { companyName?: string; apiName?: string; apiVersion?: string; build?: string; scopes?: string[] };
  settings: Settings;
  webhookActive: boolean;
  webhookUrl?: string;
  lastSyncAt?: string;
  lastPollAt?: string;
  lastWebhookAt?: string;
  lastError?: string;
  lastErrorAt?: string;
  initialSyncDoneAt?: string;
  connectedAt: string;
  connectedBy: string;
  disconnectedAt?: string;
}
interface Counter { total: number; created: number; updated: number; linked: number; skipped: number; failed: number }
interface Job {
  id: string;
  type: "INITIAL" | "MANUAL" | "ACCESS_SEND" | "ANNOUNCEMENT";
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "PARTIAL";
  entities: string[];
  phase?: string;
  progress: number;
  counters: Record<string, Counter>;
  errors: { entity: string; externalId?: string; message: string }[];
  createdBy: string;
  createdAt: string;
  finishedAt?: string;
  deliveries?: { employeeId: string; status: string; error?: string }[];
}
interface Detail {
  integration: Integration;
  stats: { mappings: Record<string, number>; outbox: Record<string, number>; events: Record<string, number>; conflicts: number; running: boolean };
  jobs: Job[];
  staffora: { botUsername?: string; publicUrl: string };
}
interface TestResult {
  baseUrl: string;
  latencyMs: number;
  remote: { companyName?: string; apiName?: string; apiVersion?: string; build?: string; keyName?: string; scopes: string[] };
  missingScopes: string[];
  excessiveScopes: string[];
  features: { label: string; enabled: boolean; missing: string[] }[];
}
interface PreviewRow { entity: string; total: number; create: number; link: number; update: number; skip: number; samples: { externalId: string; name: string; action: string; matchedBy?: string; reason?: string }[] }
interface Counting { startDate?: string; note?: string; updatedAt?: string; updatedBy?: string }

const entityLabels: Record<string, string> = {
  branch: "Filiallar",
  department: "Bo‘limlar",
  position: "Lavozimlar",
  employee: "Xodimlar",
  attendance: "Davomat",
  access: "Havolalar",
};
const entityIcons: Record<string, typeof Users> = { branch: Building2, department: Layers, position: Briefcase, employee: Users, attendance: CalendarCheck };
const modeLabels: Record<SyncMode, string> = { TWO_WAY: "Ikki tomonlama", IMPORT: "Botdan → Staffora", EXPORT: "Staffora → botga", OFF: "O‘chirilgan" };
const actionLabels: Record<string, string> = { created: "Yaratiladi", linked: "Bog‘lanadi", updated: "Yangilanadi", unchanged: "O‘zgarishsiz", skipped: "O‘tkazib yuboriladi", conflict: "Konflikt" };
const matchLabels: Record<string, string> = { mapping: "mapping", external_id: "Staffora ID", telegram_id: "Telegram ID", phone: "telefon", name: "nomi" };

const ago = (iso?: string) => {
  if (!iso) return "—";
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "hozirgina";
  if (diff < 3600) return `${Math.floor(diff / 60)} daqiqa oldin`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} soat oldin`;
  return new Date(iso).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const dateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const plusDays = (days: number) => {
  const d = new Date(Date.now() + 5 * 3600_000 + days * 86_400_000);
  return d.toISOString().slice(0, 10);
};

async function waitForJob(integrationId: string, jobId: string, onUpdate: (job: Job) => void) {
  for (;;) {
    const job = await api<Job>(`/integrations/${integrationId}/jobs/${jobId}`);
    onUpdate(job);
    if (["DONE", "FAILED", "PARTIAL"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
}

/* ============================================================= asosiy =============== */

export function IntegrationCenter() {
  const { data, loading, error, reload } = useApi<{ items: Integration[]; counting: Counting | null }>("/integrations");
  const [wizard, setWizard] = useState<{ baseUrl?: string } | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const active = data?.items.find((item) => item.status !== "DISCONNECTED");
  const previous = data?.items.find((item) => item.status === "DISCONNECTED");
  return (
    <>
      {active ? (
        <IntegrationDashboard id={active.id} onChanged={() => void reload(true)} />
      ) : (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Integratsiyalar</h2>
              <p>Staffora'ni boshqa tizimlar bilan ulang — ma’lumotlar ikki tomonlama sinxronlanadi</p>
            </div>
          </div>
          <div className="card-body">
            <div className="ic-provider">
              <span className="ic-provider-icon">
                <Bot size={24} />
              </span>
              <div className="ic-provider-text">
                <b>Xodimlar boshqaruv boti</b>
                <small>Gulnora Farm HR bot (REST API v1): filiallar, bo‘limlar, lavozimlar, xodimlar, davomat, e’lonlar va Telegram xabarlari.</small>
                {previous && (
                  <small className="muted">
                    Oldin ulangan: {previous.remote?.companyName || previous.name} · uzilgan {dateTime(previous.disconnectedAt)}. Qayta ulansa, mavjud bog‘lanishlar saqlanadi — dublikat bo‘lmaydi.
                  </small>
                )}
              </div>
              <span className="badge gray">Ulanmagan</span>
              <button className="btn btn-primary" onClick={() => setWizard({ baseUrl: previous?.baseUrl })}>
                <PlugZap size={16} /> {previous ? "Qayta ulash" : "Ulash"}
              </button>
            </div>
          </div>
        </section>
      )}
      {wizard && (
        <ConnectWizard
          initialUrl={wizard.baseUrl}
          counting={data?.counting || null}
          onClose={() => {
            setWizard(null);
            void reload(true);
          }}
        />
      )}
    </>
  );
}

/* --------------------------------------------------------- ulash ustasi --- */

const wizardSteps = ["Ulanish", "Bot ma’lumoti", "Hisoblash sanasi", "Ko‘rib chiqish", "Import", "Natija"];

function ConnectWizard({ initialUrl, counting, onClose }: { initialUrl?: string; counting: Counting | null; onClose: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [baseUrl, setBaseUrl] = useState(initialUrl || "");
  const [apiKey, setApiKey] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const [integrationId, setIntegrationId] = useState("");
  const [webhookNote, setWebhookNote] = useState("");
  const [startDate, setStartDate] = useState(counting?.startDate || plusDays(7));
  const [useCounting, setUseCounting] = useState(true);
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; warnings: string[] } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Xodimlar botini ulash" subtitle="Ma’lumotlar ko‘r-ko‘rona import qilinmaydi — avval ko‘rib chiqasiz" onClose={onClose} size="wide">
      <div className="ic-steps" style={{ ["--steps" as string]: wizardSteps.length }}>
        {wizardSteps.map((label, index) => (
          <div key={label} className={index < step ? "done" : index === step ? "active" : ""}>
            <i>{index < step ? <CheckCircle2 size={14} /> : index + 1}</i>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {step === 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const result = await post<TestResult>("/integrations/test", { baseUrl, apiKey });
              setTest(result);
              setStep(1);
            });
          }}
        >
          <div className="form-grid">
            <Field label="Bot API manzili" hint="Masalan: https://bot-domeni.up.railway.app — /api/v1 avtomatik qo‘shiladi">
              <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" required autoComplete="off" />
            </Field>
            <Field label="API kalit" hint="Bot administratori bergan kalit (gfk_…). Shifrlangan saqlanadi va qayta ko‘rsatilmaydi.">
              <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="gfk_…" required autoComplete="new-password" />
            </Field>
          </div>
          <div className="alert" style={{ marginTop: 4 }}>
            <ShieldCheck size={18} />
            <div>
              <b>Minimal ruxsat tavsiya etiladi</b>
              <p>Kalitga <code>employees:salary</code>, <code>employees:sensitive</code> va <code>admin</code> ruxsatlarini bermang — Staffora ularsiz to‘liq ishlaydi.</p>
            </div>
          </div>
          <ErrorBox message={error} />
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Bekor qilish
            </button>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <PlugZap size={16} />} Ulanishni tekshirish
            </button>
          </div>
        </form>
      )}

      {step === 1 && test && (
        <div className="stack">
          <div className="kv">
            <div>
              <span>Kompaniya</span>
              <b>{test.remote.companyName || "—"}</b>
            </div>
            <div>
              <span>API</span>
              <b>
                {test.remote.apiName} · {test.remote.apiVersion} ({test.remote.build})
              </b>
            </div>
            <div>
              <span>Kalit nomi</span>
              <b>{test.remote.keyName || "—"}</b>
            </div>
            <div>
              <span>Javob tezligi</span>
              <b>{test.latencyMs} ms</b>
            </div>
          </div>
          <div className="ic-features">
            {test.features.map((feature) => (
              <div key={feature.label} className={feature.enabled ? "on" : "off"}>
                {feature.enabled ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                <span>{feature.label}</span>
                {!feature.enabled && <small>kerak: {feature.missing.join(", ")}</small>}
              </div>
            ))}
          </div>
          {test.missingScopes.length > 0 && (
            <div className="alert danger">
              <XCircle size={18} />
              <div>
                <b>Kerakli ruxsatlar yo‘q</b>
                <p>{test.missingScopes.join(", ")} — bot administratoridan kalitga qo‘shishni so‘rang.</p>
              </div>
            </div>
          )}
          {test.excessiveScopes.length > 0 && (
            <div className="alert warn">
              <AlertTriangle size={18} />
              <div>
                <b>Kalitda ortiqcha ruxsatlar bor</b>
                <p>{test.excessiveScopes.join(", ")} — Staffora bularni ishlatmaydi. Xavfsizlik uchun olib tashlangan yangi kalit bering.</p>
              </div>
            </div>
          )}
          <ErrorBox message={error} />
          <div className="form-actions">
            <button className="btn" onClick={() => setStep(0)} disabled={busy}>
              Orqaga
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || test.missingScopes.length > 0}
              onClick={() =>
                void run(async () => {
                  const result = await post<{ integration: Integration; webhook: { registered: boolean; reason?: string } }>("/integrations", { baseUrl, apiKey });
                  setIntegrationId(result.integration.id);
                  setApiKey("");
                  setWebhookNote(result.webhook.registered ? "Webhook ulandi — o‘zgarishlar real vaqtda keladi." : `Webhook ulanmadi: ${result.webhook.reason} O‘zgarishlar lentasi (polling) orqali olinadi.`);
                  toast("Bot ulandi");
                  setStep(2);
                })
              }
            >
              {busy && <LoaderCircle size={16} className="spin" />} Ulash va davom etish
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          {webhookNote && (
            <div className="alert">
              <Webhook size={18} />
              <div>
                <p>{webhookNote}</p>
              </div>
            </div>
          )}
          <div className="ic-callout">
            <CalendarCheck size={20} />
            <div>
              <b>Davomat qachondan hisoblansin?</b>
              <p>
                Import qilingan xodimlar Staffora'da keldi-ketdini endi o‘rganadi. Belgilangan sanagacha — <b>mashq davri</b>: yozuvlar saqlanadi, lekin kechikish, kelmaslik, KPI va oylikdan ushlanmalar hisoblanmaydi.
                Sana kelganda hammasi avtomatik to‘g‘ri hisoblana boshlaydi.
              </p>
            </div>
          </div>
          <label className="setting-row">
            <span>
              <b>Mashq davrini yoqish</b>
              <small>O‘chirilsa, kechikish va ushlanmalar darhol hisoblanadi</small>
            </span>
            <span className="switch">
              <input type="checkbox" checked={useCounting} onChange={(e) => setUseCounting(e.target.checked)} />
              <span />
            </span>
          </label>
          {useCounting && (
            <Field label="Hisoblash boshlanish sanasi" hint="Shu kundan boshlab kechikish va ushlanmalar hisoblanadi">
              <input className="input" type="date" value={startDate} min={plusDays(0)} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
          )}
          <ErrorBox message={error} />
          <div className="form-actions">
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await put("/company/attendance-counting", { startDate: useCounting ? startDate : null, note: "Xodimlar boti integratsiyasi" });
                  setStep(3);
                  const result = await api<{ rows: PreviewRow[]; warnings: string[] }>(`/integrations/${integrationId}/preview`);
                  setPreview(result);
                })
              }
            >
              {busy && <LoaderCircle size={16} className="spin" />} Saqlash va ma’lumotlarni ko‘rish
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          {!preview ? (
            <div className="ic-loading">
              <LoaderCircle size={20} className="spin" /> Bot ma’lumotlari olinmoqda…
            </div>
          ) : (
            <>
              <PreviewTable rows={preview.rows} />
              {preview.warnings.map((warning) => (
                <div key={warning} className="alert warn">
                  <AlertTriangle size={18} />
                  <div>
                    <p>{warning}</p>
                  </div>
                </div>
              ))}
            </>
          )}
          <ErrorBox message={error} />
          <div className="form-actions">
            <button className="btn" onClick={onClose} disabled={busy}>
              Keyinroq
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !preview}
              onClick={() =>
                void run(async () => {
                  const started = await post<Job>(`/integrations/${integrationId}/sync`, { type: "INITIAL" });
                  setJob(started);
                  setStep(4);
                  const final = await waitForJob(integrationId, started.id, setJob);
                  setStep(5);
                  if (final.status === "FAILED") setError(final.errors.at(-1)?.message || "Import muvaffaqiyatsiz");
                })
              }
            >
              <RefreshCw size={16} /> Importni boshlash
            </button>
          </div>
        </div>
      )}

      {step >= 4 && job && (
        <div className="stack">
          <JobProgress job={job} />
          <ErrorBox message={error} />
          {step === 5 && (
            <>
              {job.status !== "FAILED" && (
                <div className="alert success">
                  <CheckCircle2 size={18} />
                  <div>
                    <b>Import tugadi</b>
                    <p>Endi «Xodimlar kirishi» bo‘limidan har bir xodimga Staffora'ga kirish havolasini bot orqali yuborishingiz mumkin.</p>
                  </div>
                </div>
              )}
              <div className="form-actions">
                <button className="btn btn-primary" onClick={onClose}>
                  Tayyor
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="table-wrap ic-table">
      <table className="table">
        <thead>
          <tr>
            <th>Ma’lumot</th>
            <th className="num">Botda topildi</th>
            <th className="num">Yangi</th>
            <th className="num">Bog‘lanadi</th>
            <th className="num">Yangilanadi</th>
            <th className="num">O‘tkaziladi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.entity}>
              <tr className="clickable" onClick={() => setOpen(open === row.entity ? null : row.entity)}>
                <td>
                  <b>{entityLabels[row.entity] || row.entity}</b>
                </td>
                <td className="num">{row.total}</td>
                <td className="num">{row.create || "—"}</td>
                <td className="num">{row.link || "—"}</td>
                <td className="num">{row.update || "—"}</td>
                <td className="num">{row.skip || "—"}</td>
              </tr>
              {open === row.entity && (
                <tr>
                  <td colSpan={6} className="ic-samples">
                    {row.samples.length ? (
                      row.samples.map((sample) => (
                        <div key={sample.externalId}>
                          <span>#{sample.externalId}</span>
                          <b>{sample.name}</b>
                          <em className={`badge ${sample.action === "created" ? "blue" : sample.action === "linked" ? "green" : sample.action === "skipped" ? "gray" : "amber"}`}>
                            {actionLabels[sample.action] || sample.action}
                            {sample.matchedBy ? ` · ${matchLabels[sample.matchedBy] || sample.matchedBy}` : ""}
                          </em>
                          {sample.reason && <small>{sample.reason}</small>}
                        </div>
                      ))
                    ) : (
                      <small className="muted">Yozuv yo‘q</small>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobProgress({ job }: { job: Job }) {
  const entries = Object.entries(job.counters || {});
  return (
    <div className="ic-job">
      <div className="ic-job-head">
        <b>
          {job.status === "RUNNING" || job.status === "QUEUED" ? <LoaderCircle size={15} className="spin" /> : job.status === "FAILED" ? <XCircle size={15} /> : <CheckCircle2 size={15} />}{" "}
          {job.phase || "Navbatda"}
        </b>
        <span>{job.progress}%</span>
      </div>
      <div className="progress">
        <i style={{ width: `${job.progress}%` }} />
      </div>
      {entries.length > 0 && (
        <div className="ic-counters">
          {entries.map(([entity, c]) => (
            <div key={entity}>
              <span>{entityLabels[entity] || entity}</span>
              <b>{c.total}</b>
              <small>
                {c.created ? `+${c.created} yangi ` : ""}
                {c.linked ? `${c.linked} bog‘landi ` : ""}
                {c.updated ? `${c.updated} yangilandi ` : ""}
                {c.skipped ? `${c.skipped} o‘tkazildi ` : ""}
                {c.failed ? <em className="late-text">{c.failed} xato</em> : ""}
                {!c.created && !c.linked && !c.updated && !c.skipped && !c.failed ? "o‘zgarishsiz" : ""}
              </small>
            </div>
          ))}
        </div>
      )}
      {job.errors.length > 0 && (
        <details className="ic-errors">
          <summary>{job.errors.length} ta izoh / xato</summary>
          {job.errors.slice(0, 50).map((err, index) => (
            <div key={index}>
              <span>{entityLabels[err.entity] || err.entity}</span>
              {err.externalId && <code>#{err.externalId}</code>}
              <small>{err.message}</small>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- panel --- */

type DashTab = "access" | "settings" | "conflicts" | "logs" | "history";

function IntegrationDashboard({ id, onChanged }: { id: string; onChanged: () => void }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<Detail>(`/integrations/${id}`);
  const [tab, setTab] = useState<DashTab>("access");
  const [syncOpen, setSyncOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  usePolling(() => void reload(true), data?.stats.running ? 3000 : 20_000);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || "Topilmadi"} />;
  const { integration, stats } = data;
  const failures = (stats.outbox.dead || 0) + (stats.outbox.failed || 0) + (stats.events.failed || 0) + (stats.events.dead || 0);
  const state = stats.running
    ? { label: "Sinxronlanmoqda", tone: "blue", Icon: RefreshCw }
    : integration.status === "ERROR" || (integration.lastError && integration.lastErrorAt && Date.now() - Date.parse(integration.lastErrorAt) < 15 * 60_000)
      ? { label: "Xato", tone: "red", Icon: XCircle }
      : failures || stats.conflicts
        ? { label: "Ogohlantirish", tone: "amber", Icon: AlertTriangle }
        : { label: "Ulangan", tone: "green", Icon: CheckCircle2 };
  const entities: Entity[] = ["branch", "department", "position", "employee", "attendance"];
  return (
    <>
      <section className="card">
        <div className="ic-head">
          <span className="ic-provider-icon">
            <Bot size={24} />
          </span>
          <div className="ic-head-text">
            <h2>{integration.remote?.companyName || integration.name}</h2>
            <p>
              {integration.remote?.apiName || "Xodimlar boshqaruv boti"} · API {integration.remote?.apiVersion || "v1"}
            </p>
          </div>
          <span className={`badge ${state.tone} ic-state`}>
            <state.Icon size={13} className={stats.running ? "spin" : ""} /> {state.label}
          </span>
        </div>
        <div className="ic-meta">
          <div>
            <span>API kalit</span>
            <b>
              <KeyRound size={13} /> {integration.apiKeyHint}••••
            </b>
          </div>
          <div>
            <span>Real vaqt</span>
            <b>
              {integration.webhookActive ? (
                <>
                  <Webhook size={13} /> Webhook faol
                </>
              ) : (
                <>
                  <RefreshCw size={13} /> Polling · {integration.settings.pollIntervalSeconds ? `${Math.round(integration.settings.pollIntervalSeconds / 60) || 1} daq` : "qo‘lda"}
                </>
              )}
            </b>
          </div>
          <div>
            <span>Oxirgi sinxronlash</span>
            <b>{ago(integration.lastSyncAt)}</b>
          </div>
          <div>
            <span>Oxirgi hodisa</span>
            <b>{ago(integration.lastWebhookAt || integration.lastPollAt)}</b>
          </div>
        </div>
        {integration.lastError && state.tone === "red" && (
          <div className="card-body" style={{ paddingTop: 0 }}>
            <div className="alert danger">
              <XCircle size={18} />
              <div>
                <b>Bot bilan aloqada muammo</b>
                <p>{integration.lastError} · Staffora ishlashda davom etadi, navbatdagi amallar bot tiklanganda yuboriladi.</p>
              </div>
            </div>
          </div>
        )}
        <div className="card-foot ic-actions">
          <button className="btn btn-primary" onClick={() => setSyncOpen(true)} disabled={stats.running}>
            <RefreshCw size={15} className={stats.running ? "spin" : ""} /> Hozir sinxronlash
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await post(`/integrations/${id}/poll`, {});
                toast("O‘zgarishlar tekshirildi");
                void reload(true);
              } catch (reason) {
                toast(errorText(reason), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Webhook size={15} /> O‘zgarishlarni tekshirish
          </button>
          <button className="btn" onClick={() => setRotateOpen(true)}>
            <KeyRound size={15} /> Kalitni yangilash
          </button>
          <button className="btn btn-danger" onClick={() => setDisconnectOpen(true)}>
            <Unplug size={15} /> Uzish
          </button>
        </div>
      </section>

      <div className="ic-stats">
        {entities.map((entity) => {
          const Icon = entityIcons[entity];
          return (
            <div key={entity} className="card ic-stat">
              <span>
                <Icon size={15} /> {entityLabels[entity]}
              </span>
              <b>{stats.mappings[entity] || 0}</b>
              <small>
                <CheckCircle2 size={12} /> sinxronlangan
              </small>
            </div>
          );
        })}
        <button className={`card ic-stat ${failures ? "warn" : ""}`} onClick={() => setTab("logs")}>
          <span>
            <AlertTriangle size={15} /> Xatolar
          </span>
          <b>{failures}</b>
          <small>{stats.outbox.pending ? `${stats.outbox.pending} navbatda` : "jurnalni ko‘rish"}</small>
        </button>
        <button className={`card ic-stat ${stats.conflicts ? "warn" : ""}`} onClick={() => setTab("conflicts")}>
          <span>
            <GitMerge size={15} /> Konfliktlar
          </span>
          <b>{stats.conflicts}</b>
          <small>{stats.conflicts ? "ko‘rib chiqish kerak" : "yo‘q"}</small>
        </button>
      </div>

      {!integration.initialSyncDoneAt && (
        <div className="alert warn">
          <AlertTriangle size={18} />
          <div>
            <b>Birinchi import hali bajarilmagan</b>
            <p>«Hozir sinxronlash» tugmasi orqali ma’lumotlarni ko‘rib chiqib import qiling.</p>
          </div>
        </div>
      )}

      <section className="card">
        <div className="ic-tabs">
          <Segmented<DashTab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "access", label: "Xodimlar kirishi" },
              { value: "settings", label: "Sozlamalar" },
              { value: "conflicts", label: "Konfliktlar", count: stats.conflicts || undefined },
              { value: "logs", label: "Jurnal" },
              { value: "history", label: "Tarix" },
            ]}
          />
        </div>
        <div className="card-body">
          {tab === "access" && (
            <AccessPanel
              integrationId={id}
              integration={integration}
              ttlHours={integration.settings.inviteTtlHours}
              botUsername={data.staffora.botUsername}
              publicUrl={data.staffora.publicUrl}
              onSaved={() => void reload(true)}
            />
          )}
          {tab === "settings" && <SettingsPanel integration={integration} onSaved={() => void reload(true)} />}
          {tab === "conflicts" && <ConflictsPanel integrationId={id} onResolved={() => void reload(true)} />}
          {tab === "logs" && <LogsPanel integrationId={id} />}
          {tab === "history" && <HistoryPanel jobs={data.jobs} />}
        </div>
      </section>

      {syncOpen && (
        <SyncModal
          integrationId={id}
          initial={!integration.initialSyncDoneAt}
          onClose={() => {
            setSyncOpen(false);
            void reload(true);
          }}
        />
      )}
      {rotateOpen && <RotateModal integrationId={id} onClose={() => { setRotateOpen(false); void reload(true); }} />}
      {disconnectOpen && (
        <Confirm
          title="Integratsiya uzilsinmi?"
          text="Bot bilan sinxronlash to‘xtaydi. Staffora'dagi xodimlar, davomat va bog‘lanishlar O‘CHIRILMAYDI — qayta ulansangiz dublikatsiz davom etadi."
          confirmLabel="Uzish"
          danger
          onConfirm={async () => {
            await post(`/integrations/${id}/disconnect`, {});
            toast("Integratsiya uzildi, ma’lumotlar saqlandi");
            onChanged();
          }}
          onClose={() => setDisconnectOpen(false)}
        />
      )}
    </>
  );
}

function SyncModal({ integrationId, initial, onClose }: { integrationId: string; initial: boolean; onClose: () => void }) {
  const all: Entity[] = ["branch", "department", "position", "employee", "attendance"];
  const [selected, setSelected] = useState<Entity[]>(all);
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; warnings: string[] } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = (entity: Entity) => setSelected((list) => (list.includes(entity) ? list.filter((x) => x !== entity) : [...list, entity]));
  return (
    <Modal title="Sinxronlash" subtitle="Nimalarni botdan olib Staffora'ga qo‘llash kerak?" onClose={onClose} size="wide">
      {!job ? (
        <div className="stack">
          <div className="ic-checks">
            {all.map((entity) => {
              const Icon = entityIcons[entity];
              return (
                <label key={entity} className={`ic-check ${selected.includes(entity) ? "on" : ""}`}>
                  <input type="checkbox" checked={selected.includes(entity)} onChange={() => toggle(entity)} />
                  <Icon size={16} /> {entityLabels[entity]}
                </label>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Xodimlar tanlansa, ularning filial/bo‘lim/lavozim bog‘lanishlari ham avtomatik moslanadi. Dublikat yaratilmaydi: mapping → Telegram ID → telefon bo‘yicha tekshiriladi.
          </p>
          {preview && <PreviewTable rows={preview.rows.filter((r) => selected.includes(r.entity as Entity))} />}
          <ErrorBox message={error} />
          <div className="form-actions">
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  setPreview(await api(`/integrations/${integrationId}/preview`));
                } catch (reason) {
                  setError(errorText(reason));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <LoaderCircle size={15} className="spin" /> : <ListIcon />} Oldindan ko‘rish
            </button>
            <button
              className="btn btn-primary"
              disabled={!selected.length || busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const started = await post<Job>(`/integrations/${integrationId}/sync`, { entities: selected, type: initial ? "INITIAL" : "MANUAL" });
                  setJob(started);
                  await waitForJob(integrationId, started.id, setJob);
                } catch (reason) {
                  setError(errorText(reason));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw size={15} /> Boshlash
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <JobProgress job={job} />
          <ErrorBox message={error} />
          <div className="form-actions">
            <button className="btn btn-primary" onClick={onClose} disabled={job.status === "RUNNING"}>
              {job.status === "RUNNING" ? "Ishlamoqda…" : "Yopish"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
const ListIcon = () => <ScrollText size={15} />;

function RotateModal({ integrationId, onClose }: { integrationId: string; onClose: () => void }) {
  const toast = useToast();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title="API kalitni yangilash" subtitle="Yangi kalit tekshiriladi, keyin eskisining o‘rniga shifrlab saqlanadi" onClose={onClose} size="narrow">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await post(`/integrations/${integrationId}/rotate-key`, { apiKey });
            toast("Kalit yangilandi");
            onClose();
          } catch (reason) {
            setError(errorText(reason));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Yangi API kalit">
          <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="gfk_…" autoComplete="new-password" required />
        </Field>
        <ErrorBox message={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy && <LoaderCircle size={15} className="spin" />} Tekshirish va saqlash
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------ xodimlar kirishi --- */

interface AccessRow {
  employeeId: string;
  name: string;
  employeeNo: string;
  phone: string;
  inBot: boolean;
  botEmployeeId?: number;
  telegramKnown: boolean;
  connected: boolean;
  invite: { state: "ACTIVE" | "USED" | "REVOKED" | "EXPIRED" | "NONE"; expiresAt: string; sentAt?: string; usedAt?: string; channel?: string } | null;
  delivery: { status: "QUEUED" | "SENT" | "FAILED" | "SKIPPED"; error?: string; updatedAt: string } | null;
}

function accessState(row: AccessRow): { label: string; tone: string; note?: string } {
  if (row.connected) return { label: "Ulangan", tone: "green" };
  if (!row.inBot) return { label: "Botda yo‘q", tone: "gray", note: "Xodim botga bog‘lanmagan" };
  if (row.delivery?.status === "FAILED") return { label: "Yetkazilmadi", tone: "red", note: row.delivery.error };
  if (row.invite?.state === "ACTIVE" && row.delivery?.status === "SENT") return { label: "Havola yetkazildi", tone: "blue", note: `Amal qiladi: ${dateTime(row.invite.expiresAt)}` };
  if (row.invite?.state === "ACTIVE" && row.delivery?.status === "QUEUED") return { label: "Yuborilmoqda", tone: "amber" };
  if (row.invite?.state === "ACTIVE") return { label: "Havola yaratilgan", tone: "blue", note: `Amal qiladi: ${dateTime(row.invite.expiresAt)}` };
  if (row.invite?.state === "EXPIRED") return { label: "Muddati tugagan", tone: "amber" };
  if (row.invite?.state === "REVOKED") return { label: "Bekor qilingan", tone: "gray" };
  return { label: "Yuborilmagan", tone: "gray" };
}

function AccessPanel({
  integrationId,
  integration,
  ttlHours,
  botUsername,
  publicUrl,
  onSaved,
}: {
  integrationId: string;
  integration: Integration;
  ttlHours: number;
  botUsername?: string;
  publicUrl: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<{ botUsername?: string; summary: { total: number; connected: number; inBot: number; pending: number }; rows: AccessRow[] }>(
    `/integrations/${integrationId}/access`,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "connected" | "failed">("all");
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ name: string; link: string; expiresAt: string } | null>(null);
  usePolling(() => void reload(true), 15_000);
  const rows = useMemo(
    () =>
      (data?.rows || []).filter((row) =>
        filter === "all" ? true : filter === "connected" ? row.connected : filter === "failed" ? row.delivery?.status === "FAILED" : !row.connected && row.inBot,
      ),
    [data, filter],
  );
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const send = async (body: { employeeIds?: string[]; all?: boolean; onlyNotConnected?: boolean }) => {
    setBusy(true);
    try {
      const started = await post<Job & { planned: number; skipped: number }>(`/integrations/${integrationId}/access/send`, body);
      toast(`${started.planned} ta xodimga havola yuborilmoqda${started.skipped ? ` (${started.skipped} tasi o‘tkazildi)` : ""}`);
      setJob(started);
      await waitForJob(integrationId, started.id, setJob);
      setSelected([]);
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  };
  const selectable = rows.filter((row) => row.inBot && !row.connected);
  const allSelected = selectable.length > 0 && selectable.every((row) => selected.includes(row.employeeId));
  const direct = integration.settings.miniAppLink;
  const bot = direct || botUsername || data?.botUsername;
  return (
    <div className="stack">
      <DirectLinkCard integration={integration} publicUrl={publicUrl} onSaved={onSaved} />
      {direct ? (
        <div className="ic-callout">
          <CheckCircle2 size={20} />
          <div>
            <b>Bir bosishda kirish yoqilgan</b>
            <p>
              «Hammasiga yuborish» bosilsa, har bir xodimga xodimlar boti orqali <b>{direct}</b> havolasi boradi. Xodim bosadi → Staffora shu botning
              ichida ochiladi → avtomatik kiradi. START ham, kod ham kerak emas.
            </p>
          </div>
        </div>
      ) : (
      <div className="ic-callout">
        <Link2 size={20} />
        <div>
          <b>Xodimni Staffora'ga ulash</b>
          <p>
            Har bir xodimga shaxsiy, bir martalik havola xodimlar boti orqali yuboriladi. Xodim havolani bosadi → {bot ? <b>@{bot}</b> : "Staffora boti"} ochiladi → «START» → profili avtomatik ulanadi.
            Havola {ttlHours % 24 === 0 ? `${ttlHours / 24} kun` : `${ttlHours} soat`} amal qiladi. Botdan import qilingan xodim havolasiz /start bossa ham Telegram ID orqali tanib olinadi.
          </p>
        </div>
      </div>
      )}
      {!bot && (
        <div className="alert warn">
          <AlertTriangle size={18} />
          <div>
            <b>Staffora Telegram boti ishga tushmagan</b>
            <p>Havola yaratish uchun serverda TELEGRAM_BOT_TOKEN sozlangan bo‘lishi kerak (Sozlamalar → Telegram bot).</p>
          </div>
        </div>
      )}
      <div className="ic-summary">
        <div>
          <span>Jami faol</span>
          <b>{data?.summary.total}</b>
        </div>
        <div className="green">
          <span>Ulangan</span>
          <b>{data?.summary.connected}</b>
        </div>
        <div className="blue">
          <span>Havola kutilmoqda</span>
          <b>{data?.summary.pending}</b>
        </div>
        <div>
          <span>Botda bor</span>
          <b>{data?.summary.inBot}</b>
        </div>
      </div>
      {job && (job.status === "RUNNING" || job.status === "QUEUED") && <JobProgress job={job} />}
      <div className="ic-toolbar">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Hammasi" },
            { value: "pending", label: "Ulanmagan" },
            { value: "connected", label: "Ulangan" },
            { value: "failed", label: "Xato" },
          ]}
        />
        <div className="toolbar">
          <button className="btn" disabled={busy || !selected.length || !bot} onClick={() => void send({ employeeIds: selected, onlyNotConnected: true })}>
            <Send size={15} /> Tanlanganlarga ({selected.length})
          </button>
          <button className="btn btn-primary" disabled={busy || !bot} onClick={() => void send({ all: true, onlyNotConnected: true })}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />} Hammasiga yuborish
          </button>
        </div>
      </div>
      {!rows.length ? (
        <Empty icon={Users} title="Xodim yo‘q" text="Bu filtr bo‘yicha xodim topilmadi." />
      ) : (
        <div className="ic-people">
          <div className="ic-people-head">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? [] : selectable.map((row) => row.employeeId))}
                aria-label="Hammasini tanlash"
              />
              <span>{allSelected ? "Tanlovni bekor qilish" : `Ulanmaganlarni tanlash (${selectable.length})`}</span>
            </label>
            <span className="muted">{rows.length} ta xodim</span>
          </div>
          {rows.map((row) => {
            const state = accessState(row);
            const [first, ...rest] = row.name.split(" ");
            const disabled = !row.inBot || row.connected;
            return (
              <div key={row.employeeId} className={`ic-person ${selected.includes(row.employeeId) ? "selected" : ""}`}>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={selected.includes(row.employeeId)}
                  onChange={() => setSelected((list) => (list.includes(row.employeeId) ? list.filter((x) => x !== row.employeeId) : [...list, row.employeeId]))}
                  aria-label={row.name}
                />
                <span className={`ic-avatar ${state.tone}`}>{`${first?.[0] || ""}${rest.join(" ")[0] || ""}`.toUpperCase()}</span>
                <div className="ic-person-main">
                  <b>{row.name}</b>
                  <small>
                    {row.employeeNo}
                    {row.phone ? ` · ${row.phone}` : ""}
                    {row.telegramKnown ? " · Telegram ID bor" : " · Telegram ID yo‘q"}
                  </small>
                </div>
                <div className="ic-person-state">
                  <span className={`badge ${state.tone}`}>{state.label}</span>
                  {state.note && <small>{state.note}</small>}
                </div>
                <div className="ic-person-actions">
                  {!row.connected && (
                    <button
                      className="btn btn-sm"
                      disabled={!bot}
                      title="Shaxsiy havolani yaratish va nusxalash"
                      onClick={async () => {
                        try {
                          const result = await post<{ link: string; expiresAt: string }>(`/integrations/${integrationId}/access/${row.employeeId}/link`, {});
                          setLink({ name: row.name, ...result });
                          void reload(true);
                        } catch (reason) {
                          toast(errorText(reason), "error");
                        }
                      }}
                    >
                      <Link2 size={14} /> Havola
                    </button>
                  )}
                  {row.invite?.state === "ACTIVE" && !row.connected && (
                    <button
                      className="icon-btn"
                      title="Havolani bekor qilish"
                      aria-label="Havolani bekor qilish"
                      onClick={async () => {
                        try {
                          await post(`/employees/${row.employeeId}/access/revoke`, {});
                          toast("Havola bekor qilindi");
                          void reload(true);
                        } catch (reason) {
                          toast(errorText(reason), "error");
                        }
                      }}
                    >
                      <XCircle size={16} />
                    </button>
                  )}
                  {row.connected && <CheckCircle2 size={18} className="ic-ok" />}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {link && (
        <Modal title="Shaxsiy havola" subtitle={link.name} onClose={() => setLink(null)} size="narrow">
          <p className="muted" style={{ marginBottom: 12 }}>
            Havola bir martalik va {dateTime(link.expiresAt)} gacha amal qiladi. Faqat shu xodimga yuboring. Yangi havola yaratilganda eskisi bekor bo‘ladi.
          </p>
          <div className="code-box">
            <code>{link.link}</code>
            <button
              className="btn btn-sm"
              onClick={async () => {
                await navigator.clipboard.writeText(link.link).catch(() => undefined);
                toast("Nusxalandi");
              }}
            >
              <Copy size={14} /> Nusxalash
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ sozlamalar --- */

const frequencyOptions: [number, string][] = [
  [60, "Har daqiqa"],
  [300, "5 daqiqa"],
  [900, "15 daqiqa"],
  [1800, "30 daqiqa"],
  [0, "Faqat qo‘lda"],
];
const ttlOptions: [number, string][] = [
  [24, "1 kun"],
  [72, "3 kun"],
  [168, "7 kun"],
  [336, "14 kun"],
  [720, "30 kun"],
];
const categoryLabels: Record<Category, [string, string]> = {
  attendance: ["Davomat", "Eslatmalar: kelish/ketishni belgilash"],
  leave: ["Ta’til", "So‘rov tasdiqlandi / rad etildi"],
  announcements: ["E’lonlar", "Yangi e’lon uchun standart kanallar"],
  system: ["Tizim", "Xizmat xabarlari"],
  payroll: ["Ish haqi", "Oylik hisob varaqasi (oy yopilganda)"],
};
const channelLabels: Record<Channel, string> = { staffora: "Staffora", telegram: "Staffora boti", bot: "Xodimlar boti" };

function SettingsPanel({ integration, onSaved }: { integration: Integration; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Settings>(integration.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setForm(integration.settings), [integration.settings]);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((f) => ({ ...f, [key]: value }));
  const entities: Entity[] = ["branch", "department", "position", "employee", "attendance"];
  return (
    <div className="stack">
      <CountingStartCard />
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await put(`/integrations/${integration.id}/settings`, form);
            toast("Sozlamalar saqlandi");
            onSaved();
          } catch (reason) {
            setError(errorText(reason));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3 className="form-section-title">
          <Settings2 size={16} /> Sinxronlash yo‘nalishi
        </h3>
        <div className="ic-modes">
          {entities.map((entity) => {
            const Icon = entityIcons[entity];
            return (
              <div key={entity}>
                <span>
                  <Icon size={15} /> {entityLabels[entity]}
                </span>
                <select className="select" value={form.syncModes[entity]} onChange={(e) => set("syncModes", { ...form.syncModes, [entity]: e.target.value as SyncMode })}>
                  {(Object.keys(modeLabels) as SyncMode[]).map((mode) => (
                    <option key={mode} value={mode}>
                      {modeLabels[mode]}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
        <div className="form-grid">
          <Field label="Konflikt bo‘lsa" hint="Bir maydonni ikkala tomon ham o‘zgartirganda">
            <select className="select" value={form.conflictStrategy} onChange={(e) => set("conflictStrategy", e.target.value as Settings["conflictStrategy"])}>
              <option value="MANUAL">Qo‘lda ko‘rib chiqish (tavsiya)</option>
              <option value="STAFFORA_WINS">Staffora ustun</option>
              <option value="BOT_WINS">Bot ustun</option>
              <option value="LATEST">Oxirgi o‘zgarish ustun</option>
            </select>
          </Field>
          <Field label="O‘zgarishlarni tekshirish" hint={integration.webhookActive ? "Webhook faol — o‘zgarishlar real vaqtda keladi, bu zaxira tekshiruv" : "Webhook yo‘q — shu oraliqda botdan so‘raladi"}>
            <select className="select" value={form.pollIntervalSeconds} onChange={(e) => set("pollIntervalSeconds", Number(e.target.value))}>
              {frequencyOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kirish havolasi muddati">
            <select className="select" value={form.inviteTtlHours} onChange={(e) => set("inviteTtlHours", Number(e.target.value))}>
              {ttlOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <Toggle label="Keldi-ketdini botga yuborish" hint="Mini App'da (Face ID + GPS) qayd etilgan kelish/ketish botga ham yoziladi" checked={form.pushAttendance} onChange={(v) => set("pushAttendance", v)} />
          <Toggle label="Bot'dagi o‘chirishlarni qo‘llash" hint="Bot'da ishdan bo‘shatilgan xodim Staffora'da ham «Ishdan bo‘shaganlar»ga o‘tadi (ma’lumot o‘chmaydi)" checked={form.applyRemoteDeletes} onChange={(v) => set("applyRemoteDeletes", v)} />
          <Toggle label="Staffora'da qo‘shilgan xodimni botda yaratish" hint="Faqat Telegram ID si ma’lum xodimlar uchun" checked={form.createInBot} onChange={(v) => set("createInBot", v)} />
        </div>
        <h3 className="form-section-title">
          <Send size={16} /> Bildirishnoma yo‘nalishlari
        </h3>
        <div className="table-wrap ic-table">
          <table className="table ic-matrix">
            <thead>
              <tr>
                <th>Toifa</th>
                {(Object.keys(channelLabels) as Channel[]).map((channel) => (
                  <th key={channel} className="num">
                    {channelLabels[channel]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(categoryLabels) as Category[]).map((category) => (
                <tr key={category}>
                  <td>
                    <b>{categoryLabels[category][0]}</b>
                    <small className="muted block">{categoryLabels[category][1]}</small>
                  </td>
                  {(Object.keys(channelLabels) as Channel[]).map((channel) => (
                    <td key={channel} className="num">
                      <input
                        type="checkbox"
                        checked={form.routing[category].includes(channel)}
                        aria-label={`${categoryLabels[category][0]} — ${channelLabels[channel]}`}
                        onChange={() => {
                          const current = form.routing[category];
                          set("routing", { ...form.routing, [category]: current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel] });
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>
          «Staffora boti» tanlangan, lekin xodim hali ulanmagan bo‘lsa, xabar avtomatik xodimlar boti orqali yetkaziladi.
        </p>
        <ErrorBox message={error} />
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>
            {busy && <LoaderCircle size={15} className="spin" />} Saqlash
          </button>
        </div>
      </form>
      <div className="kv ic-tech">
        <div>
          <span>Bot API</span>
          <b>{integration.baseUrl}</b>
        </div>
        <div>
          <span>Webhook manzili</span>
          <b>{integration.webhookUrl || "—"}</b>
        </div>
        <div>
          <span>Ulagan</span>
          <b>
            {integration.connectedBy} · {dateTime(integration.connectedAt)}
          </b>
        </div>
        <div>
          <span>Ruxsatlar</span>
          <b className="ic-scopes">{integration.remote?.scopes?.join(", ") || "—"}</b>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: ReactNode; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setting-row">
      <span>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
    </label>
  );
}

/** Davomat hisoblash boshlanish sanasi (mashq davri) — kompaniya bo‘yicha. */
export function CountingStartCard() {
  const toast = useToast();
  const { data, reload } = useApi<{ counting: Counting | null }>("/integrations");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setDate(data?.counting?.startDate || ""), [data]);
  const today = plusDays(0);
  const current = data?.counting?.startDate;
  const active = current && current > today;
  return (
    <div className="ic-counting">
      <div className="ic-counting-head">
        <CalendarCheck size={18} />
        <div>
          <b>Davomat hisoblash boshlanish sanasi</b>
          <small>
            {active
              ? `Mashq davri: ${current.split("-").reverse().join(".")} gacha kechikish, kelmaslik va ushlanmalar hisoblanmaydi.`
              : current
                ? `${current.split("-").reverse().join(".")} dan beri hamma kun hisoblanmoqda.`
                : "Belgilanmagan — hamma kun hisoblanadi."}
          </small>
        </div>
        {active && <span className="badge amber">Mashq davri</span>}
      </div>
      <div className="ic-counting-form">
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Boshlanish sanasi" />
        <button
          className="btn btn-primary"
          disabled={busy || date === (current || "")}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await put("/company/attendance-counting", { startDate: date || null });
              toast(date ? "Boshlanish sanasi saqlandi" : "Sana olib tashlandi");
              void reload(true);
            } catch (reason) {
              setError(errorText(reason));
            } finally {
              setBusy(false);
            }
          }}
        >
          Saqlash
        </button>
        {current && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => setDate("")}>
            Tozalash
          </button>
        )}
      </div>
      <ErrorBox message={error} />
    </div>
  );
}

/* ------------------------------------------------------------ konfliktlar --- */

interface ConflictRow {
  id: string;
  entity: string;
  localId: string;
  externalId: string;
  name: string;
  fields: { field: string; local: unknown; remote: unknown }[];
  status: "OPEN" | "RESOLVED";
  resolution?: "STAFFORA" | "BOT";
  resolvedBy?: string;
  createdAt: string;
  resolvedAt?: string;
}
const fieldNames: Record<string, string> = {
  firstName: "Ism",
  lastName: "Familiya",
  middleName: "Otasining ismi",
  phone: "Telefon",
  birthDate: "Tug‘ilgan sana",
  address: "Manzil",
  branchId: "Filial",
  departmentId: "Bo‘lim",
  positionId: "Lavozim",
  status: "Holat",
  name: "Nomi",
  latitude: "Kenglik",
  longitude: "Uzunlik",
  radiusMeters: "Radius",
};
const show = (value: unknown) => (value === undefined || value === null || value === "" ? "—" : String(value));

function ConflictsPanel({ integrationId, onResolved }: { integrationId: string; onResolved: () => void }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<ConflictRow[]>(`/integrations/${integrationId}/conflicts`);
  const [busy, setBusy] = useState("");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const open = (data || []).filter((c) => c.status === "OPEN");
  const resolved = (data || []).filter((c) => c.status === "RESOLVED").slice(0, 20);
  if (!open.length && !resolved.length) return <Empty icon={GitMerge} title="Konflikt yo‘q" text="Bir maydonni ikkala tomon bir vaqtda o‘zgartirsa, shu yerda ko‘rinadi." />;
  const resolve = async (conflict: ConflictRow, use: "STAFFORA" | "BOT") => {
    setBusy(conflict.id);
    try {
      await post(`/integrations/${integrationId}/conflicts/${conflict.id}/resolve`, { use });
      toast(use === "BOT" ? "Bot qiymati qo‘llandi" : "Staffora qiymati botga yuboriladi");
      void reload(true);
      onResolved();
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="stack">
      {open.map((conflict) => (
        <div key={conflict.id} className="ic-conflict">
          <div className="ic-conflict-head">
            <b>
              {entityLabels[conflict.entity]?.replace(/lar$/, "") || conflict.entity}: {conflict.name}
            </b>
            <small>
              bot #{conflict.externalId} · {dateTime(conflict.createdAt)}
            </small>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Maydon</th>
                  <th>Staffora</th>
                  <th>Bot</th>
                </tr>
              </thead>
              <tbody>
                {conflict.fields.map((field) => (
                  <tr key={field.field}>
                    <td>{fieldNames[field.field] || field.field}</td>
                    <td>{show(field.local)}</td>
                    <td>{show(field.remote)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button className="btn" disabled={busy === conflict.id} onClick={() => void resolve(conflict, "STAFFORA")}>
              Staffora qiymati
            </button>
            <button className="btn btn-primary" disabled={busy === conflict.id} onClick={() => void resolve(conflict, "BOT")}>
              Bot qiymati
            </button>
          </div>
        </div>
      ))}
      {resolved.length > 0 && (
        <details className="ic-errors">
          <summary>Hal qilinganlar ({resolved.length})</summary>
          {resolved.map((c) => (
            <div key={c.id}>
              <span>{c.name}</span>
              <small>
                {c.resolution === "BOT" ? "Bot qiymati" : "Staffora qiymati"} · {c.resolvedBy} · {dateTime(c.resolvedAt)}
              </small>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- jurnal --- */

interface LogRow { id: number; level: "info" | "warn" | "error"; action: string; message: string; createdAt: string }
interface EventRow { eventId: string; event: string; via: string; status: string; attempts: number; error?: string; receivedAt: string }
interface OutboxRow { id: number; kind: string; status: string; attempts: number; error?: string; createdAt: string; nextAttemptAt: string }

function LogsPanel({ integrationId }: { integrationId: string }) {
  const toast = useToast();
  const [level, setLevel] = useState<"" | "warn" | "error">("");
  const logs = useApi<LogRow[]>(`/integrations/${integrationId}/logs${level ? `?level=${level}` : ""}`);
  const events = useApi<EventRow[]>(`/integrations/${integrationId}/events`);
  const outbox = useApi<OutboxRow[]>(`/integrations/${integrationId}/outbox`);
  const failedOutbox = (outbox.data || []).filter((row) => ["failed", "dead"].includes(row.status));
  const failedEvents = (events.data || []).filter((row) => ["failed", "dead"].includes(row.status));
  return (
    <div className="stack">
      {(failedOutbox.length > 0 || failedEvents.length > 0) && (
        <div className="ic-failures">
          <b>
            <AlertTriangle size={15} /> Yetkazilmagan amallar
          </b>
          {failedOutbox.map((row) => (
            <div key={`o${row.id}`}>
              <span className={`badge ${row.status === "dead" ? "red" : "amber"}`}>{row.status === "dead" ? "To‘xtatilgan" : "Qayta uriniladi"}</span>
              <code>{row.kind}</code>
              <small>{row.error}</small>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  try {
                    await post(`/integrations/${integrationId}/outbox/${row.id}/retry`, {});
                    toast("Qayta navbatga qo‘yildi");
                    void outbox.reload(true);
                  } catch (reason) {
                    toast(errorText(reason), "error");
                  }
                }}
              >
                <RotateCcw size={13} /> Qayta
              </button>
            </div>
          ))}
          {failedEvents.map((row) => (
            <div key={`e${row.eventId}`}>
              <span className={`badge ${row.status === "dead" ? "red" : "amber"}`}>{row.status === "dead" ? "Dead-letter" : "Qayta uriniladi"}</span>
              <code>{row.event}</code>
              <small>{row.error}</small>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  try {
                    await post(`/integrations/${integrationId}/events/${encodeURIComponent(row.eventId)}/retry`, {});
                    toast("Qayta ishlashga qo‘yildi");
                    void events.reload(true);
                  } catch (reason) {
                    toast(errorText(reason), "error");
                  }
                }}
              >
                <RotateCcw size={13} /> Qayta
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="ic-toolbar">
        <Segmented
          value={level}
          onChange={setLevel}
          options={[
            { value: "", label: "Hammasi" },
            { value: "warn", label: "Ogohlantirish" },
            { value: "error", label: "Xato" },
          ]}
        />
        <button className="btn btn-sm" onClick={() => { void logs.reload(); void events.reload(); void outbox.reload(); }}>
          <RefreshCw size={13} /> Yangilash
        </button>
      </div>
      {logs.loading && !logs.data ? (
        <Loading />
      ) : !logs.data?.length ? (
        <Empty icon={ScrollText} title="Jurnal bo‘sh" text="Integratsiya amallari shu yerda ko‘rinadi." />
      ) : (
        <div className="ic-log">
          {logs.data.map((row) => (
            <div key={row.id} className={row.level}>
              <i />
              <time>{dateTime(row.createdAt)}</time>
              <code>{row.action}</code>
              <span>{row.message}</span>
            </div>
          ))}
        </div>
      )}
      {events.data && events.data.length > 0 && (
        <details className="ic-errors">
          <summary>So‘nggi hodisalar ({events.data.length})</summary>
          {events.data.slice(0, 60).map((row) => (
            <div key={row.eventId}>
              <span>{row.event}</span>
              <code>{row.via}</code>
              <small>
                {row.status} · {dateTime(row.receivedAt)}
                {row.error ? ` · ${row.error}` : ""}
              </small>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function HistoryPanel({ jobs }: { jobs: Job[] }) {
  if (!jobs.length) return <Empty icon={RefreshCw} title="Sinxronlash bo‘lmagan" text="Birinchi importdan keyin tarix shu yerda ko‘rinadi." />;
  const typeLabels: Record<Job["type"], string> = { INITIAL: "Birinchi import", MANUAL: "Qo‘lda sinxronlash", ACCESS_SEND: "Havolalar yuborish", ANNOUNCEMENT: "E’lon" };
  return (
    <div className="stack">
      {jobs.map((job) => (
        <details key={job.id} className="ic-history">
          <summary>
            <span className={`badge ${job.status === "DONE" ? "green" : job.status === "FAILED" ? "red" : job.status === "PARTIAL" ? "amber" : "blue"}`}>{job.status}</span>
            <b>{typeLabels[job.type]}</b>
            <small>
              {job.createdBy} · {dateTime(job.createdAt)}
            </small>
          </summary>
          <JobProgress job={job} />
        </details>
      ))}
    </div>
  );
}

/** Bir bosishda kirish: Staffora Mini App'ini xodimlar botiga ulash (BotFather). */
function DirectLinkCard({ integration, publicUrl, onSaved }: { integration: Integration; publicUrl: string; onSaved: () => void }) {
  const toast = useToast();
  const [link, setLink] = useState(integration.settings.miniAppLink || "");
  const [open, setOpen] = useState(!integration.settings.miniAppLink);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const appUrl = `${publicUrl.replace(/\/+$/, "")}/mini-app`;
  const save = async (value: string) => {
    setBusy(true);
    setError("");
    try {
      await put(`/integrations/${integration.id}/settings`, { miniAppLink: value });
      toast(value ? "Bir bosishda kirish yoqildi" : "O‘chirildi");
      onSaved();
      if (value) setOpen(false);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ic-direct">
      <button className="ic-direct-head" onClick={() => setOpen((v) => !v)}>
        <span className="ic-direct-icon">
          <PlugZap size={18} />
        </span>
        <span>
          <b>Bir bosishda kirish (tavsiya etiladi)</b>
          <small>
            {integration.settings.miniAppLink
              ? `Yoqilgan · ${integration.settings.miniAppLink}`
              : "Staffora xodimlar botining ichida ochiladi — ikkinchi botda START kerak emas"}
          </small>
        </span>
        <span className={`badge ${integration.settings.miniAppLink ? "green" : "amber"}`}>{integration.settings.miniAppLink ? "Yoqilgan" : "Sozlanmagan"}</span>
      </button>
      {open && (
        <div className="ic-direct-body">
          <p className="muted">
            Telegram bot START bosmagan odamga yoza olmaydi, shuning uchun Staffora'ni xodimlar allaqachon ishlatayotgan botga ulaymiz. Bir marta, 2 daqiqa:
          </p>
          <ol className="steps-list">
            <li>
              Telegram'da <b>@BotFather</b> ni oching va <code>/newapp</code> yuboring.
            </li>
            <li>Ro‘yxatdan <b>xodimlar botini</b> (Gulnora Farm HR bot) tanlang.</li>
            <li>Nomi: <b>Staffora</b>, tavsif: «Keldi-ketdi», rasm: istalgan 640×360 rasm, GIF — <code>/empty</code>.</li>
            <li>
              Web App URL so‘ralganda:
              <span className="code-box" style={{ marginTop: 6 }}>
                <code>{appUrl}</code>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(appUrl).catch(() => undefined);
                    toast("Nusxalandi");
                  }}
                >
                  <Copy size={13} /> Nusxalash
                </button>
              </span>
            </li>
            <li>
              Qisqa nom: <b>staffora</b>. BotFather havola beradi: <code>https://t.me/&lt;bot&gt;/staffora</code> — uni pastga qo‘ying.
            </li>
          </ol>
          <div className="ic-counting-form">
            <input className="input" style={{ flex: 1 }} value={link} placeholder="https://t.me/GulnoraFarmBot/staffora" onChange={(e) => setLink(e.target.value)} />
            <button className="btn btn-primary" disabled={busy || !link.trim()} onClick={() => void save(link.trim())}>
              {busy && <LoaderCircle size={15} className="spin" />} Saqlash
            </button>
            {integration.settings.miniAppLink && (
              <button className="btn btn-ghost" disabled={busy} onClick={() => void save("")}>
                O‘chirish
              </button>
            )}
          </div>
          <ErrorBox message={error} />
          <p className="muted" style={{ fontSize: 12.5 }}>
            Xavfsizlik: xodim kim ekanini xodimlar botining serveri Telegram imzosi orqali tasdiqlaydi; Staffora bot tokenini bilmaydi va telefon
            yuborgan ID ga ishonmaydi.
          </p>
        </div>
      )}
    </div>
  );
}
