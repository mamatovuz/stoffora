import { useState } from "react";
import { Link } from "react-router-dom";
import { DatabaseBackup, Download, PlayCircle, ShieldCheck } from "lucide-react";
import { patch, post } from "../../api";
import { useApi, usePolling } from "../../hooks";
import { PageHeader, useToast } from "../../components/ui";
import {
  ConfirmDialog,
  DataTable,
  DetailDrawer,
  ErrorState,
  FilterBar,
  KeyValue,
  Pager,
  PermissionGuard,
  SearchInput,
  Section,
  Select,
  Skeleton,
  StatusBadge,
  ago,
  bytes,
  dateTime,
  downloadFile,
  num,
  useAction,
  usePlatform,
  useServerList,
} from "./kit";
import { ChartCard, TrendLine } from "./charts";

/*
 * Operatsiyalar: monitoring (haqiqiy tekshiruvlar va metrikalar), xatolar markazi, incidentlar,
 * zaxira nusxalar (restore test — production’ga tegmaydi), fon ishlari.
 */

type Check = { key: string; label: string; status: string; detail: string; latencyMs?: number };
type Worker = { name: string; label: string; intervalMs: number; runs: number; failures: number; lastRunAt?: string; lastOkAt?: string; lastError?: string; lastDurationMs?: number; running: boolean };
type Monitoring = {
  health: { overall: string; checks: Check[] };
  minutes: { at: string; requests: number; errors: number; clientErrors: number; p95: number; avg: number }[];
  deployment: { environment: string; service: string | null; deploymentId: string | null; commit: string | null; branch: string | null; region: string | null; startedAt: string; process: { rssMb: number; heapUsedMb: number; heapTotalMb: number; eventLoopLagMs: number; uptimeSeconds: number; node: string } };
  workers: Worker[];
  jobs: Record<string, number>;
  incidents: { id: string; title: string; severity: string; lastSeen: string }[];
  integrations: { railway: boolean; supabase: boolean };
};

function WorkersTable({ workers }: { workers: Worker[] }) {
  return (
    <DataTable
      rows={workers}
      rowKey={(w) => w.name}
      columns={[
        { key: "l", label: "Vazifa", render: (w) => <span className="stack"><b>{w.label}</b><small>har {Math.round(w.intervalMs / 1000)} s</small></span> },
        { key: "s", label: "Holat", render: (w) => (w.running ? <StatusBadge value="RUNNING" /> : w.lastError ? <StatusBadge value="FAILED" /> : w.lastOkAt ? <StatusBadge value="OK" /> : <StatusBadge value="QUEUED" label="Kutilmoqda" />) },
        { key: "r", label: "Oxirgi ishga tushish", render: (w) => `${ago(w.lastRunAt)}${w.lastDurationMs !== undefined ? ` · ${w.lastDurationMs} ms` : ""}` },
        { key: "c", label: "Bajarildi / xato", className: "num", render: (w) => `${w.runs} / ${w.failures}` },
        { key: "e", label: "Oxirgi xato", hideOnMobile: true, render: (w) => <span className="muted">{w.lastError || "—"}</span> },
      ]}
    />
  );
}

function MonitoringView() {
  const { data, error, reload } = useApi<Monitoring>("/super-admin/monitoring");
  usePolling(() => void reload(true), 30_000);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton rows={10} />;
  const d = data.deployment;
  const minuteLabel = (m: { at: string }) => m.at.slice(11, 16);
  return (
    <>
      <PageHeader title="Monitoring" subtitle="Haqiqiy tekshiruvlar: shu server jarayoni, baza, Telegram API · har 30 soniyada yangilanadi" actions={<StatusBadge value={data.health.overall} label={`Umumiy: ${data.health.overall}`} />} />
      <div className="sa-grid-2">
        <Section title="Tekshiruvlar">
          <ul className="sa-checks">
            {data.health.checks.map((c) => (
              <li key={c.key}>
                <StatusBadge value={c.status} />
                <span>
                  <b>{c.label}</b>
                  <small>
                    {c.detail}
                    {c.latencyMs !== undefined ? ` · ${c.latencyMs} ms` : ""}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Deploy va jarayon">
          <KeyValue
            items={[
              ["Muhit", d.environment],
              ["Servis", d.service || "—"],
              ["Deploy", d.deploymentId || "—"],
              ["Commit", d.commit ? `${d.commit}${d.branch ? ` (${d.branch})` : ""}` : "—"],
              ["Region", d.region || "—"],
              ["Ishga tushgan", `${dateTime(d.startedAt)} · ${Math.round(d.process.uptimeSeconds / 3600)} soat`],
              ["Xotira (RSS)", `${d.process.rssMb} MB · heap ${d.process.heapUsedMb}/${d.process.heapTotalMb} MB`],
              ["Event loop kechikishi (p99)", `${d.process.eventLoopLagMs} ms`],
              ["Node", d.process.node],
              ["Railway API", data.integrations.railway ? "Token bor (integratsiya keyingi bosqich)" : "Not configured"],
              ["Supabase", data.integrations.supabase ? "Ulangan (DATABASE_URL)" : "Not configured"],
            ]}
          />
          <p className="muted sa-note">CPU va umumiy konteyner RAM’i Railway API orqali ulanmagan — soxta qiymat ko‘rsatilmaydi.</p>
        </Section>
      </div>
      <div className="sa-grid-2">
        <ChartCard title="So‘rovlar (daqiqalik)" subtitle="Oxirgi 60 daqiqa" table={{ headers: ["Daqiqa", "So‘rovlar", "5xx", "4xx"], rows: data.minutes.map((m) => [minuteLabel(m), m.requests, m.errors, m.clientErrors]) }} height={180}>
          <TrendLine data={data.minutes.map((m) => ({ ...m, label: minuteLabel(m) }))} x="label" y="requests" name="So‘rovlar" />
        </ChartCard>
        <ChartCard title="Javob vaqti p95 (ms)" subtitle="Oxirgi 60 daqiqa" table={{ headers: ["Daqiqa", "p95", "o‘rtacha"], rows: data.minutes.map((m) => [minuteLabel(m), m.p95, m.avg]) }} height={180}>
          <TrendLine data={data.minutes.map((m) => ({ ...m, label: minuteLabel(m) }))} x="label" y="p95" name="p95" unit="ms" />
        </ChartCard>
      </div>
      <Section title="Davriy vazifalar" subtitle={`Navbat: ${Object.entries(data.jobs).map(([k, v]) => `${k} ${v}`).join(" · ") || "bo‘sh"}`} actions={<Link className="btn btn-sm" to="/super-admin/jobs">Fon ishlari</Link>}>
        <WorkersTable workers={data.workers} />
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------- xatolar --- */
type ErrorRow = { fingerprint: string; service: string; companyId: string | null; severity: string; message: string; stack: string | null; path: string | null; status: string; note: string | null; firstSeen: string; lastSeen: string; count: number };
function Errors() {
  const [state, setState] = useState({ q: "", status: "", service: "", severity: "", page: 1 });
  const { data, loading, error, reload } = useServerList<ErrorRow, { counts: Record<string, number> }>("/super-admin/errors", { ...state, pageSize: 30 });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Xatolar markazi" subtitle="Bir xil xatolar fingerprint bo‘yicha guruhlanadi; token, parol, email, telefon yashiriladi" />
      {data && (
        <div className="sa-chipline">
          {Object.entries(data.counts).map(([s, n]) => (
            <button key={s} className={`sa-chip ${state.status === s ? "on" : ""}`} onClick={() => setState({ ...state, status: state.status === s ? "" : s, page: 1 })}>
              <StatusBadge value={s} /> <b>{n}</b>
            </button>
          ))}
        </div>
      )}
      <Section>
        <FilterBar>
          <SearchInput value={state.q} onChange={(q) => setState((s) => ({ ...s, q, page: 1 }))} placeholder="Xabar bo‘yicha…" />
          <Select
            label="Servis"
            value={state.service}
            onChange={(service) => setState({ ...state, service, page: 1 })}
            options={[
              ["", "Barcha servislar"],
              ["api", "API"],
              ["mini-app", "Mini App"],
              ["mini-app:android", "Mini App (Android)"],
              ["mini-app:ios", "Mini App (iOS)"],
            ]}
          />
          <Select
            label="Jiddiylik"
            value={state.severity}
            onChange={(severity) => setState({ ...state, severity, page: 1 })}
            options={[
              ["", "Har qanday"],
              ["CRITICAL", "Jiddiy"],
              ["HIGH", "Yuqori"],
              ["MEDIUM", "O‘rta"],
              ["LOW", "Past"],
            ]}
          />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          rowKey={(r) => r.fingerprint}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          onRowClick={(r) => setOpen(r.fingerprint)}
          empty={<p className="muted sa-empty">Xato yo‘q</p>}
          columns={[
            { key: "m", label: "Xato", render: (r) => <span className="stack"><b className="sa-ellipsis">{r.message}</b><small>{r.service}{r.path ? ` · ${r.path}` : ""}</small></span> },
            { key: "c", label: "Soni", className: "num", render: (r) => num(r.count) },
            { key: "sev", label: "Jiddiylik", render: (r) => <StatusBadge value={r.severity} /> },
            { key: "l", label: "Oxirgi", render: (r) => ago(r.lastSeen) },
            { key: "f", label: "Birinchi", hideOnMobile: true, render: (r) => ago(r.firstSeen) },
            { key: "s", label: "Holat", render: (r) => <StatusBadge value={r.status} /> },
          ]}
        />
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setState({ ...state, page })} />}
      </Section>
      {open && <ErrorDrawer fingerprint={open} onClose={() => setOpen(null)} onChanged={() => void reload(true)} />}
    </>
  );
}

function ErrorDrawer({ fingerprint, onClose, onChanged }: { fingerprint: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const run = useAction();
  const { data, reload } = useApi<ErrorRow>(`/super-admin/errors/${fingerprint}`);
  const [note, setNote] = useState("");
  const setStatus = async (status: string) => {
    if (await run(() => patch(`/super-admin/errors/${fingerprint}`, { status, note: note || undefined }), toast, "Holat yangilandi")) {
      void reload(true);
      onChanged();
    }
  };
  return (
    <DetailDrawer title="Xato tafsiloti" subtitle={fingerprint} onClose={onClose} wide>
      {!data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <KeyValue
            items={[
              ["Xabar", data.message],
              ["Servis", data.service],
              ["Yo‘l", data.path || "—"],
              ["Kompaniya", data.companyId ? <Link key="c" to={`/super-admin/companies/${data.companyId}`}>{data.companyId}</Link> : "—"],
              ["Soni", num(data.count)],
              ["Birinchi / oxirgi", `${dateTime(data.firstSeen)} / ${dateTime(data.lastSeen)}`],
              ["Holat", <StatusBadge key="s" value={data.status} />],
              ["Izoh", data.note || "—"],
            ]}
          />
          {data.stack ? <pre className="sa-stack-trace">{data.stack}</pre> : <p className="muted">Stack trace faqat incidentlarni boshqaradigan administratorlarga ko‘rinadi.</p>}
          <PermissionGuard perm="incidents.manage">
            <label className="field">
              <span className="label">Izoh</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="sa-actions-grid">
              {["INVESTIGATING", "RESOLVED", "IGNORED", "NEW"].map((s) => (
                <button key={s} className="btn" disabled={data.status === s} onClick={() => void setStatus(s)}>
                  <StatusBadge value={s} />
                </button>
              ))}
            </div>
          </PermissionGuard>
        </>
      )}
    </DetailDrawer>
  );
}

/* ------------------------------------------------------------- incidentlar --- */
type Incident = { id: string; rule: string; severity: string; title: string; detail: string; status: string; companyId?: string; firstSeen: string; lastSeen: string; count: number; acknowledgedBy?: string; resolvedAt?: string; resolvedBy?: string };
function Incidents() {
  const toast = useToast();
  const run = useAction();
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useServerList<Incident, { rules: Record<string, number> }>("/super-admin/incidents", { status, page, pageSize: 30 });
  return (
    <>
      <PageHeader
        title="Incidentlar"
        subtitle="Qoidalar har daqiqada baholanadi: bitta qoida — bitta ochiq incident (dedupe), holat tiklansa avtomatik yopiladi. Chegara va cooldown — Global sozlamalar."
        actions={
          <PermissionGuard perm="incidents.manage">
            <button className="btn" onClick={() => run(() => post<{ opened: number }>("/super-admin/incidents/evaluate", {}), toast, "Qoidalar tekshirildi").then(() => reload(true))}>
              <PlayCircle size={15} /> Hozir tekshirish
            </button>
          </PermissionGuard>
        }
      />
      <Section>
        <FilterBar>
          <Select
            label="Holat"
            value={status}
            onChange={(v) => (setStatus(v), setPage(1))}
            options={[
              ["open", "Ochiq va qabul qilingan"],
              ["RESOLVED", "Hal qilingan"],
              ["", "Hammasi"],
            ]}
          />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          empty={<p className="muted sa-empty">Incident yo‘q — hammasi joyida</p>}
          columns={[
            { key: "t", label: "Incident", render: (r) => <span className="stack"><b>{r.title}</b><small>{r.detail}</small></span> },
            { key: "s", label: "Jiddiylik", render: (r) => <StatusBadge value={r.severity} /> },
            { key: "c", label: "Takror", className: "num", render: (r) => r.count },
            { key: "l", label: "Oxirgi", render: (r) => ago(r.lastSeen) },
            { key: "st", label: "Holat", render: (r) => <span className="stack"><StatusBadge value={r.status} /><small>{r.resolvedBy || r.acknowledgedBy || ""}</small></span> },
            {
              key: "a",
              label: "",
              render: (r) =>
                r.status !== "RESOLVED" && (
                  <PermissionGuard perm="incidents.manage">
                    <span className="sa-row-actions">
                      {r.status === "OPEN" && (
                        <button className="btn btn-sm" onClick={() => run(() => post(`/super-admin/incidents/${r.id}/ack`, {}), toast, "Qabul qilindi").then(() => reload(true))}>
                          Qabul qilish
                        </button>
                      )}
                      <button className="btn btn-sm" onClick={() => run(() => post(`/super-admin/incidents/${r.id}/resolve`, {}), toast, "Hal qilindi").then(() => reload(true))}>
                        Hal qilindi
                      </button>
                    </span>
                  </PermissionGuard>
                ),
            },
          ]}
        />
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------- zaxiralar --- */
type Backup = { id: string; kind: string; status: string; format: string; startedAt: string; finishedAt?: string; sizeBytes?: number; file?: string; checksum?: string; tables?: Record<string, number>; includes: { media: boolean; files: boolean }; error?: string; verifyStatus?: string; verifiedAt?: string; verifyError?: string; createdBy: string; deletedAt?: string };
function Backups() {
  const toast = useToast();
  const run = useAction();
  const { can } = usePlatform();
  const { data, error, reload } = useApi<{ records: Backup[]; environment: { database: string; managed: string | null; destination: string; volume: boolean }; settings: { scheduleHours?: number; keep?: number; includeMedia?: boolean; includeFiles?: boolean } }>("/super-admin/backups");
  usePolling(() => void reload(true), 15_000);
  const [confirm, setConfirm] = useState(false);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton rows={8} />;
  const last = data.records.find((b) => b.status === "SUCCESS");
  const lastFailed = data.records.find((b) => b.status === "FAILED");
  return (
    <>
      <PageHeader
        title="Zaxira nusxalar"
        subtitle="Real restore productionda avtomatik bajarilmaydi — «Restore test» faqat faylni tekshiradi. Tiklash rejasi: docs/SUPER_ADMIN.md"
        actions={
          can("backups.manage") && (
            <button className="btn btn-primary" onClick={() => setConfirm(true)}>
              <DatabaseBackup size={15} /> Zaxira yaratish
            </button>
          )
        }
      />
      <div className="sa-kpis compact">
        <div className="card stat">
          <div className="stat-top">
            <span>Oxirgi muvaffaqiyatli</span>
          </div>
          <strong>{last ? ago(last.finishedAt || last.startedAt) : "—"}</strong>
          <small>{last ? `${bytes(last.sizeBytes)} · ${last.format}` : "Hali zaxira yo‘q"}</small>
        </div>
        <div className="card stat">
          <div className="stat-top">
            <span>Restore test</span>
          </div>
          <strong>{last?.verifyStatus ? <StatusBadge value={last.verifyStatus} /> : "—"}</strong>
          <small>{last?.verifiedAt ? ago(last.verifiedAt) : "Tekshirilmagan"}</small>
        </div>
        <div className="card stat">
          <div className="stat-top">
            <span>Jadval</span>
          </div>
          <strong>{data.settings.scheduleHours ? `har ${data.settings.scheduleHours} soat` : "O‘chiq"}</strong>
          <small>So‘nggi {data.settings.keep || 5} ta saqlanadi</small>
        </div>
        <div className="card stat">
          <div className="stat-top">
            <span>Saqlash joyi</span>
          </div>
          <strong>{data.environment.database}</strong>
          <small>{data.environment.volume ? "Railway volume (yopiq)" : "Lokal papka (yopiq)"}</small>
        </div>
      </div>
      {data.environment.managed && <p className="sa-banner info">{data.environment.managed}</p>}
      {lastFailed && (!last || lastFailed.startedAt > last.startedAt) && <p className="sa-banner bad">Oxirgi zaxira muvaffaqiyatsiz: {lastFailed.error}</p>}
      <Section title="Tarix">
        <DataTable
          rows={data.records}
          rowKey={(r) => r.id}
          empty={<p className="muted sa-empty">Zaxira yo‘q</p>}
          columns={[
            { key: "t", label: "Vaqt", render: (r) => <span className="stack"><b>{dateTime(r.startedAt)}</b><small>{r.kind === "SCHEDULED" ? "Jadval" : "Qo‘lda"} · {r.createdBy}</small></span> },
            { key: "s", label: "Holat", render: (r) => <span className="stack"><StatusBadge value={r.status} /><small>{r.error || ""}</small></span> },
            { key: "z", label: "Hajm", className: "num", render: (r) => (r.sizeBytes ? bytes(r.sizeBytes) : "—") },
            { key: "i", label: "Tarkibi", hideOnMobile: true, render: (r) => `Yadro, davomat, audit${r.includes.media ? ", rasmlar" : ""}${r.includes.files ? ", hujjatlar" : ""}` },
            { key: "v", label: "Restore test", render: (r) => (r.verifyStatus ? <span className="stack"><StatusBadge value={r.verifyStatus} /><small>{r.verifyError || ago(r.verifiedAt)}</small></span> : "—") },
            {
              key: "a",
              label: "",
              render: (r) =>
                r.status === "SUCCESS" &&
                !r.deletedAt && (
                  <span className="sa-row-actions">
                    <button className="btn btn-sm" onClick={() => run(() => post(`/super-admin/backups/${r.id}/verify`, {}), toast, "Tekshiruv boshlandi")}>
                      <ShieldCheck size={13} /> Tekshirish
                    </button>
                    {can("backups.manage") && (
                      <button className="btn btn-sm" onClick={() => run(() => downloadFile(`/super-admin/backups/${r.id}/download`, r.file || "backup"), toast)}>
                        <Download size={13} /> Yuklab olish
                      </button>
                    )}
                  </span>
                ),
            },
          ]}
        />
      </Section>
      {confirm && (
        <ConfirmDialog
          title="Zaxira nusxa yaratish"
          text="Ma’lumotlar bazasining to‘liq nusxasi server ichidagi yopiq papkaga yoziladi (fon ishi). Ish to‘xtamaydi. Parolingiz so‘ralishi mumkin."
          confirmLabel="Yaratish"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            await run(() => post("/super-admin/backups", {}), toast, "Zaxira yaratish boshlandi");
            void reload(true);
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------- fon ishlari --- */
type Job = { id: string; type: string; status: string; attempts: number; maxAttempts: number; runAt: string; createdAt: string; startedAt: string | null; finishedAt: string | null; createdBy: string | null; error: string | null };
function Jobs() {
  const toast = useToast();
  const run = useAction();
  const [state, setState] = useState({ status: "", type: "", page: 1 });
  const { data, loading, error, reload } = useServerList<Job, { counts: Record<string, number>; workers: Worker[] }>("/super-admin/jobs", { ...state, pageSize: 30 });
  usePolling(() => void reload(true), 15_000);
  return (
    <>
      <PageHeader title="Fon ishlari" subtitle="Navbat bazada (platform_jobs) — qo‘shimcha pullik infratuzilma yo‘q; davriy vazifalar shu server jarayonida" />
      <Section title="Davriy vazifalar">{data ? <WorkersTable workers={data.workers} /> : <Skeleton rows={5} />}</Section>
      <Section title="Navbat">
        <FilterBar>
          <Select
            label="Holat"
            value={state.status}
            onChange={(status) => setState({ ...state, status, page: 1 })}
            options={[
              ["", `Barchasi`],
              ["QUEUED", `Navbatda ${data?.counts.QUEUED || 0}`],
              ["RUNNING", `Bajarilmoqda ${data?.counts.RUNNING || 0}`],
              ["FAILED", `Xato ${data?.counts.FAILED || 0}`],
              ["SUCCEEDED", `Bajarildi ${data?.counts.SUCCEEDED || 0}`],
            ]}
          />
          <Select
            label="Turi"
            value={state.type}
            onChange={(type) => setState({ ...state, type, page: 1 })}
            options={[
              ["", "Barcha turlar"],
              ["EXPORT", "Eksport"],
              ["BACKUP", "Zaxira"],
              ["BACKUP_VERIFY", "Zaxira tekshiruvi"],
            ]}
          />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          empty={<p className="muted sa-empty">Ish yo‘q</p>}
          columns={[
            { key: "t", label: "Ish", render: (r) => <span className="stack"><b>{r.type}</b><small>{r.createdBy || "Tizim"} · {ago(r.createdAt)}</small></span> },
            { key: "s", label: "Holat", render: (r) => <span className="stack"><StatusBadge value={r.status} /><small>{r.error || ""}</small></span> },
            { key: "a", label: "Urinish", className: "num", render: (r) => `${r.attempts}/${r.maxAttempts}` },
            { key: "f", label: "Tugadi", hideOnMobile: true, render: (r) => ago(r.finishedAt) },
            {
              key: "x",
              label: "",
              render: (r) => (
                <PermissionGuard perm="jobs.manage">
                  <span className="sa-row-actions">
                    {(r.status === "FAILED" || r.status === "CANCELLED") && (
                      <button className="btn btn-sm" onClick={() => run(() => post(`/super-admin/jobs/${r.id}/retry`, {}), toast, "Qayta navbatga qo‘yildi").then(() => reload(true))}>
                        Qayta
                      </button>
                    )}
                    {r.status === "QUEUED" && (
                      <button className="btn btn-sm" onClick={() => run(() => post(`/super-admin/jobs/${r.id}/cancel`, {}), toast, "Bekor qilindi").then(() => reload(true))}>
                        Bekor qilish
                      </button>
                    )}
                  </span>
                </PermissionGuard>
              ),
            },
          ]}
        />
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setState({ ...state, page })} />}
      </Section>
    </>
  );
}

export default function OperationsPages({ view }: { view: string }) {
  if (view === "errors") return <Errors />;
  if (view === "incidents") return <Incidents />;
  if (view === "backups") return <Backups />;
  if (view === "jobs") return <Jobs />;
  return <MonitoringView />;
}
