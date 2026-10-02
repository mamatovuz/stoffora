import { useEffect, useState } from "react";
import { Bot, CheckCircle2, ClipboardList, Copy, LoaderCircle, Send, ShieldCheck, UserPlus, XCircle } from "lucide-react";
import { api, errorText, post, put } from "../api";
import { useApi, usePolling } from "../hooks";
import { Confirm, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Segmented, useToast } from "../components/ui";
import type { RegistrationRequest } from "@/lib/types";
import type { Meta } from "../types";

/* ================================================== arizalar sahifasi === */

type Row = RegistrationRequest & {
  positionName?: string;
  branchName?: string;
  answers?: { id: string; label: string; value: string; field?: string }[];
};
type Status = "PENDING" | "APPROVED" | "REJECTED" | "ALL";

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

export function RegistrationsPage() {
  const toast = useToast();
  const [status, setStatus] = useState<Status>("PENDING");
  const { data, loading, error, reload } = useApi<{ items: Row[]; counts: { PENDING: number; DRAFT: number } }>(`/registrations?status=${status}`);
  const { data: meta } = useApi<Meta>("/meta");
  const [reject, setReject] = useState<Row | null>(null);
  const [fix, setFix] = useState<Row | null>(null);
  const [busy, setBusy] = useState("");
  usePolling(() => void reload(true), 20_000);

  const approve = async (row: Row, overrides: { positionId?: string; branchId?: string } = {}) => {
    setBusy(row.id);
    try {
      await post(`/registrations/${row.id}/approve`, overrides);
      toast(`${row.data.fullName} xodimlar ro‘yxatiga qo‘shildi`);
      setFix(null);
      void reload(true);
    } catch (reason) {
      const message = errorText(reason);
      // Lavozim/filial o‘chirilgan bo‘lsa — tanlash oynasi.
      if (/lavozim|filial/i.test(message)) setFix(row);
      toast(message, "error");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="page narrow">
      <PageHeader
        title="Arizalar"
        subtitle={`Botda anketa to‘ldirgan nomzodlar${data?.counts.DRAFT ? ` · ${data.counts.DRAFT} ta anketa to‘ldirilmoqda` : ""}`}
      />
      <div style={{ marginBottom: 14 }}>
        <Segmented<Status>
          value={status}
          onChange={setStatus}
          options={[
            { value: "PENDING", label: "Kutilmoqda", count: data?.counts.PENDING },
            { value: "APPROVED", label: "Tasdiqlangan" },
            { value: "REJECTED", label: "Rad etilgan" },
            { value: "ALL", label: "Hammasi" },
          ]}
        />
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : !data?.items.length ? (
        <section className="card">
          <Empty
            icon={ClipboardList}
            title={status === "PENDING" ? "Yangi ariza yo‘q" : "Ariza topilmadi"}
            text="Xodimlar kompaniya botida /start bosib anketani to‘ldiradi. Botni Sozlamalar → Ro‘yxat boti bo‘limida ulang."
          />
        </section>
      ) : (
        <div className="reg-list">
          {data.items.map((row) => (
            <article key={row.id} className={`card reg-card ${row.status.toLowerCase()}`}>
              <header className="reg-head">
                <span className="reg-avatar">{(row.data.fullName || "?").split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
                <div>
                  <b>{row.data.fullName || row.telegramName || "Nomsiz"}</b>
                  <small>
                    {row.telegramUsername ? `@${row.telegramUsername} · ` : ""}
                    {when(row.submittedAt || row.createdAt)}
                  </small>
                </div>
                <span className={`badge ${row.status === "PENDING" ? "amber" : row.status === "APPROVED" ? "green" : "red"}`}>
                  {row.status === "PENDING" ? "Kutilmoqda" : row.status === "APPROVED" ? "Tasdiqlangan" : row.status === "REJECTED" ? "Rad etilgan" : row.status}
                </span>
              </header>
              <dl className="reg-grid">
                {(row.answers || []).filter((a) => a.field !== "fullName" && a.field !== "idDocument").map((a) => (
                  <div key={a.id} className={a.value.length > 28 || a.field === "address" ? "wide" : ""}>
                    <dt>{a.label}</dt>
                    <dd>{a.value}</dd>
                  </div>
                ))}
              </dl>
              {row.data.idDocument ? (
                <a className="reg-doc" href={`/api/registrations/${row.id}/document`} target="_blank" rel="noreferrer" title="Kattaroq ochish">
                  {row.data.idDocumentMime === "application/pdf" ? (
                    <span className="reg-doc-pdf">📄 Pasport / ID karta (PDF) — ochish</span>
                  ) : (
                    <img src={`/api/registrations/${row.id}/document`} alt="Pasport / ID karta" loading="lazy" />
                  )}
                  <small>🪪 Pasport / ID karta</small>
                </a>
              ) : null}
              {row.status === "PENDING" ? (
                <footer className="reg-actions">
                  <button className="btn btn-danger" disabled={busy === row.id} onClick={() => setReject(row)}>
                    <XCircle size={15} /> Rad etish
                  </button>
                  <button className="btn btn-primary" disabled={busy === row.id} onClick={() => void approve(row)}>
                    {busy === row.id ? <LoaderCircle size={15} className="spin" /> : <CheckCircle2 size={15} />} Tasdiqlash
                  </button>
                </footer>
              ) : (
                <footer className="reg-decided">
                  {row.status === "APPROVED" ? "✅ Tasdiqladi" : "❌ Rad etdi"}: {row.decidedBy} · {when(row.decidedAt)}
                  {row.rejectReason ? ` · Sabab: ${row.rejectReason}` : ""}
                </footer>
              )}
            </article>
          ))}
        </div>
      )}
      {reject && <RejectModal row={reject} onClose={() => setReject(null)} onDone={() => { setReject(null); void reload(true); }} />}
      {fix && meta && (
        <FixRefsModal
          row={fix}
          meta={meta}
          busy={busy === fix.id}
          onClose={() => setFix(null)}
          onApprove={(overrides) => void approve(fix, overrides)}
        />
      )}
    </div>
  );
}

function RejectModal({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  return (
    <Confirm
      title="Anketani rad etish"
      text={
        <span style={{ display: "grid", gap: 10 }}>
          <span>{row.data.fullName} ga rad javobi bot orqali yuboriladi.</span>
          <textarea className="textarea" rows={3} placeholder="Sabab (ixtiyoriy)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </span>
      }
      confirmLabel="Rad etish"
      danger
      onConfirm={async () => {
        await post(`/registrations/${row.id}/reject`, { reason });
        toast("Rad etildi");
        onDone();
      }}
      onClose={onClose}
    />
  );
}

function FixRefsModal({
  row,
  meta,
  busy,
  onClose,
  onApprove,
}: {
  row: Row;
  meta: Meta;
  busy: boolean;
  onClose: () => void;
  onApprove: (overrides: { positionId?: string; branchId?: string }) => void;
}) {
  const [positionId, setPositionId] = useState(meta.positions.some((p) => p.id === row.data.positionId) ? row.data.positionId || "" : "");
  const [branchId, setBranchId] = useState(meta.branches.some((b) => b.id === row.data.branchId) ? row.data.branchId || "" : "");
  return (
    <Modal title="Lavozim va filialni tanlang" subtitle="Anketadagisi o‘chirilgan" onClose={onClose} size="narrow">
      <Field label="Lavozim">
        <select className="select" value={positionId} onChange={(e) => setPositionId(e.target.value)}>
          <option value="">Tanlang…</option>
          {meta.positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Filial">
        <select className="select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">Tanlang…</option>
          {meta.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button className="btn btn-primary" disabled={busy || !positionId || !branchId} onClick={() => onApprove({ positionId, branchId })}>
          Tasdiqlash
        </button>
      </div>
    </Modal>
  );
}

/* ============================================ Sozlamalar: ro‘yxat boti === */

interface BotInfo {
  enabled: boolean;
  registrationEnabled: boolean;
  approverTelegramIds: string[];
  username?: string;
  tokenHint?: string;
  hasToken: boolean;
  running: boolean;
  status?: "RUNNING" | "ERROR" | "STOPPED";
  mode?: string;
  lastError?: string;
  link?: string;
  registerLink?: string;
  webAppUrl: string;
}

export function CompanyBotSection() {
  const toast = useToast();
  const { data, loading, reload } = useApi<BotInfo>("/company/bot");
  const [token, setToken] = useState("");
  const [approvers, setApprovers] = useState<string[]>([]);
  const [newId, setNewId] = useState("");
  const [registration, setRegistration] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [disconnect, setDisconnect] = useState(false);
  useEffect(() => {
    if (!data) return;
    setApprovers(data.approverTelegramIds);
    setRegistration(data.registrationEnabled);
  }, [data]);
  if (loading && !data) return <Loading />;
  const save = async (body: Record<string, unknown>, message: string) => {
    setBusy(true);
    setError("");
    try {
      await put("/company/bot", body);
      toast(message);
      setToken("");
      void reload(true);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const statusBadge = !data?.hasToken
    ? { label: "Ulanmagan", tone: "gray" }
    : data.status === "ERROR"
      ? { label: "Xato", tone: "red" }
      : data.running
        ? { label: "Ishlayapti", tone: "green" }
        : { label: "O‘chirilgan", tone: "amber" };
  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Ro‘yxat boti</h2>
            <p>Xodimlar kompaniyangiz botida anketa to‘ldiradi, HR tasdiqlaydi — profil avtomatik ochiladi</p>
          </div>
          <span className={`badge ${statusBadge.tone}`}>{statusBadge.label}</span>
        </div>
        <div className="card-body stack">
          {data?.hasToken ? (
            <div className="bot-connected">
              <span className="ic-direct-icon">
                <Bot size={18} />
              </span>
              <div>
                <b>@{data.username}</b>
                <small>
                  Token: {data.tokenHint} · {data.mode === "webhook" ? "webhook" : "polling"}
                </small>
              </div>
              {data.link && (
                <a className="btn btn-sm" href={data.link} target="_blank" rel="noreferrer">
                  Botni ochish
                </a>
              )}
            </div>
          ) : (
            <ol className="steps-list">
              <li>
                Telegram’da <b>@BotFather</b> → <code>/newbot</code> → nom va username bering.
              </li>
              <li>BotFather bergan tokenni (<code>123456789:AA…</code>) pastga qo‘ying.</li>
              <li>HR xodimlar botga /start, keyin <code>/id</code> yuborib o‘z ID sini oladi va shu yerga qo‘shasiz.</li>
            </ol>
          )}
          {data?.status === "ERROR" && data.lastError && (
            <div className="alert warn">
              <XCircle size={18} />
              <div>
                <b>Bot ishga tushmadi</b>
                <p>{data.lastError}</p>
              </div>
            </div>
          )}
          <Field label={data?.hasToken ? "Yangi token (almashtirish uchun)" : "Bot tokeni"} hint="Token shifrlangan saqlanadi va qayta ko‘rsatilmaydi">
            <div className="ic-counting-form">
              <input className="input" style={{ flex: 1 }} type="password" autoComplete="new-password" value={token} placeholder="123456789:AA…" onChange={(e) => setToken(e.target.value)} />
              <button className="btn btn-primary" disabled={busy || !token.trim()} onClick={() => void save({ token: token.trim() }, "Bot ulandi")}>
                {busy ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />} Tekshirish va ulash
              </button>
            </div>
          </Field>
          {data?.hasToken && (
            <>
              <label className="setting-row">
                <span>
                  <b>Botda ro‘yxatdan o‘tish</b>
                  <small>Yangi xodimlar /start bosib anketani to‘ldira oladi</small>
                </span>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={registration}
                    onChange={(e) => {
                      setRegistration(e.target.checked);
                      void save({ registrationEnabled: e.target.checked }, e.target.checked ? "Ro‘yxatdan o‘tish yoqildi" : "O‘chirildi");
                    }}
                  />
                  <span />
                </span>
              </label>
              {data.registerLink && (
                <div>
                  <span className="label">Xodimlarga yuboriladigan havola</span>
                  <div className="code-box" style={{ marginTop: 6 }}>
                    <code>{data.registerLink}</code>
                    <button
                      className="btn btn-sm"
                      onClick={async () => {
                        await navigator.clipboard.writeText(data.registerLink!).catch(() => undefined);
                        toast("Nusxalandi");
                      }}
                    >
                      <Copy size={13} /> Nusxalash
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          <ErrorBox message={error} />
        </div>
      </section>

      {data?.hasToken && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Arizalarni tasdiqlovchilar (HR)</h2>
              <p>Yangi anketa shu Telegram ID larga ✅ / ❌ tugmalari bilan keladi. Panelda «Arizalar» bo‘limida ham ko‘rinadi.</p>
            </div>
          </div>
          <div className="card-body stack">
            <div className="approver-list">
              {approvers.length ? (
                approvers.map((id) => (
                  <span key={id} className="approver">
                    <code>{id}</code>
                    <button
                      className="icon-btn"
                      title="Sinov xabari"
                      aria-label="Sinov xabari"
                      onClick={async () => {
                        try {
                          await post("/company/bot/test", { telegramId: id });
                          toast("Sinov xabari yuborildi");
                        } catch (reason) {
                          toast(errorText(reason), "error");
                        }
                      }}
                    >
                      <Send size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="O‘chirish"
                      onClick={() => {
                        const next = approvers.filter((x) => x !== id);
                        setApprovers(next);
                        void save({ approverTelegramIds: next }, "O‘chirildi");
                      }}
                    >
                      <XCircle size={14} />
                    </button>
                  </span>
                ))
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>
                  Hali HR qo‘shilmagan — arizalar faqat panelda ko‘rinadi.
                </p>
              )}
            </div>
            <div className="ic-counting-form">
              <input className="input" style={{ flex: 1 }} inputMode="numeric" placeholder="Telegram ID (masalan 123456789)" value={newId} onChange={(e) => setNewId(e.target.value.replace(/\D/g, ""))} />
              <button
                className="btn"
                disabled={busy || newId.length < 4 || approvers.includes(newId)}
                onClick={() => {
                  const next = [...approvers, newId];
                  setApprovers(next);
                  setNewId("");
                  void save({ approverTelegramIds: next }, "HR qo‘shildi");
                }}
              >
                <UserPlus size={15} /> Qo‘shish
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12.5 }}>
              ID ni bilish: HR botda <b>/start</b>, so‘ng <b>/id</b> yuboradi. HR botga kamida bir marta /start bosgan bo‘lishi kerak — aks holda Telegram xabar yubortirmaydi.
            </p>
          </div>
        </section>
      )}

      {data?.hasToken && (
        <section className="card card-body">
          <button className="btn btn-danger" onClick={() => setDisconnect(true)}>
            Botni uzish
          </button>
        </section>
      )}
      {disconnect && (
        <Confirm
          title="Bot uzilsinmi?"
          text="Bot to‘xtaydi va token o‘chiriladi. Xodimlar va arizalar saqlanib qoladi."
          confirmLabel="Uzish"
          danger
          onConfirm={async () => {
            await api("/company/bot", { method: "DELETE" });
            toast("Bot uzildi");
            void reload(true);
          }}
          onClose={() => setDisconnect(false)}
        />
      )}
    </>
  );
}
