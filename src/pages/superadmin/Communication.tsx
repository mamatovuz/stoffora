import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Lock, Paperclip, Plus, Send } from "lucide-react";
import { del, patch, post } from "../../api";
import { useApi } from "../../hooks";
import { Field, Modal, PageHeader, useToast } from "../../components/ui";
import {
  ConfirmDialog,
  DataTable,
  DetailDrawer,
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
  readFileAsDataUrl,
  useAction,
  usePlatform,
  useServerList,
} from "./kit";

/*
 * Aloqa: bildirishnomalar va ommaviy xabarlar (qoralama → ko‘rib chiqish → tasdiq → navbat → holat),
 * murojaatlar markazi (javob, ichki izoh, biriktirma, mas’ul, holat), saytdagi demo so‘rovlari.
 */

type Audience = { type: "ALL" | "OWNERS" | "LEADERS" | "COMPANY" | "COMPANIES" | "PLAN" | "EXPIRING"; companyIds?: string[]; planIds?: string[]; days?: number; ownersOnly?: boolean };
type Note = { id: string; kind: "NOTICE" | "BULK"; title: string; body: string; audience: Audience; channels: ("IN_APP" | "TELEGRAM")[]; status: string; scheduledAt?: string; sentAt?: string; stats?: { total: number; sent: number; failed: number; skipped: number; pending: number }; createdAt: string; createdBy: string; updatedAt: string };
const AUDIENCE: Record<Audience["type"], string> = {
  ALL: "Barcha kompaniyalar (rahbarlar)",
  OWNERS: "Faqat kompaniya egalari",
  LEADERS: "Barcha rahbarlar",
  COMPANY: "Bitta kompaniya",
  COMPANIES: "Bir nechta kompaniya",
  PLAN: "Tarif bo‘yicha",
  EXPIRING: "Tarif muddati tugayotganlar",
};
const audienceText = (a: Audience) => `${AUDIENCE[a.type]}${a.companyIds?.length ? ` (${a.companyIds.length})` : ""}${a.planIds?.length ? ` (${a.planIds.length} tarif)` : ""}${a.type === "EXPIRING" ? ` · ${a.days || 7} kun` : ""}${a.ownersOnly ? " · faqat egalar" : ""}`;

function NotificationsView({ kind }: { kind: "NOTICE" | "BULK" }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const { data, loading, error, reload } = useServerList<Note>("/super-admin/notifications", { kind, status, page, pageSize: 25 });
  const [compose, setCompose] = useState<Note | "new" | null>(null);
  const [open, setOpen] = useState<Note | null>(null);
  const bulk = kind === "BULK";
  return (
    <>
      <PageHeader
        title={bulk ? "Ommaviy xabarlar" : "Bildirishnomalar"}
        subtitle={bulk ? "Telegram orqali — faqat botni boshlagan rahbarlarga, navbat va tezlik cheklovi bilan" : "Kompaniya paneliga (ilova ichida) va/yoki Telegram’ga"}
        actions={
          <PermissionGuard perm="notifications.send">
            <button className="btn btn-primary" onClick={() => setCompose("new")}>
              <Plus size={15} /> {bulk ? "Xabar" : "Bildirishnoma"}
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
              ["", "Barchasi"],
              ["DRAFT", "Qoralama"],
              ["SCHEDULED", "Rejalashtirilgan"],
              ["SENDING", "Yuborilmoqda"],
              ["SENT", "Yuborildi"],
              ["PARTIAL", "Qisman"],
              ["FAILED", "Xato"],
              ["CANCELLED", "Bekor"],
            ]}
          />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          onRowClick={(r) => (r.status === "DRAFT" ? setCompose(r) : setOpen(r))}
          empty={<p className="muted sa-empty">Hozircha xabar yo‘q</p>}
          columns={[
            { key: "t", label: "Xabar", render: (r) => <span className="stack"><b>{r.title}</b><small>{audienceText(r.audience)}</small></span> },
            { key: "c", label: "Kanal", render: (r) => r.channels.map((c) => (c === "IN_APP" ? "Panel" : "Telegram")).join(" + ") },
            { key: "s", label: "Holat", render: (r) => <StatusBadge value={r.status} /> },
            { key: "d", label: "Yetkazish", render: (r) => (r.stats ? `${r.stats.sent}/${r.stats.total}${r.stats.failed ? ` · ${r.stats.failed} xato` : ""}${r.stats.skipped ? ` · ${r.stats.skipped} o‘tkazildi` : ""}` : "—") },
            { key: "w", label: "Vaqt", render: (r) => (r.scheduledAt ? `⏰ ${dateTime(r.scheduledAt)}` : ago(r.sentAt || r.updatedAt)) },
          ]}
        />
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Section>
      {compose && <Compose kind={kind} note={compose === "new" ? null : compose} onClose={() => setCompose(null)} onChanged={() => void reload(true)} />}
      {open && <DeliveryDrawer note={open} onClose={() => setOpen(null)} onChanged={() => void reload(true)} />}
    </>
  );
}

function Compose({ kind, note, onClose, onChanged }: { kind: "NOTICE" | "BULK"; note: Note | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const run = useAction();
  const { data: companies } = useApi<{ rows: { id: string; name: string }[] }>("/super-admin/companies?pageSize=200");
  const { data: plans } = useApi<{ id: string; name: string }[]>("/super-admin/plans");
  const [form, setForm] = useState({
    title: note?.title || "",
    body: note?.body || "",
    audience: note?.audience || ({ type: "OWNERS" } as Audience),
    channels: note?.channels || (kind === "BULK" ? ["TELEGRAM"] : ["IN_APP"]),
  });
  const [saved, setSaved] = useState<Note | null>(note);
  const [preview, setPreview] = useState<{ companies: number; users: number; telegramReachable: number; telegramSkipped: number; inApp: number; sample: string[] } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const a = form.audience;
  const setAudience = (patchA: Partial<Audience>) => {
    setForm({ ...form, audience: { ...a, ...patchA } });
    setPreview(null);
  };
  const saveDraft = async () => {
    const body = { kind, ...form };
    const result = await run(() => (saved ? patch<Note>(`/super-admin/notifications/${saved.id}`, body) : post<Note>("/super-admin/notifications", body)), toast);
    if (result) {
      setSaved(result);
      onChanged();
      const p = await run(() => post<NonNullable<typeof preview>>(`/super-admin/notifications/${result.id}/preview`, {}), toast);
      if (p) setPreview(p);
    }
  };
  return (
    <Modal title={kind === "BULK" ? "Ommaviy xabar" : "Bildirishnoma"} subtitle="1) Qoralama va ko‘rib chiqish → 2) Tasdiqlash va yuborish" onClose={onClose} size="wide">
      <div className="form-grid">
        <Field label="Sarlavha">
          <input className="input" value={form.title} onChange={(e) => (setForm({ ...form, title: e.target.value }), setPreview(null))} maxLength={160} />
        </Field>
        <Field label="Kanallar">
          <span className="sa-multi">
            {(["IN_APP", "TELEGRAM"] as const).map((c) => (
              <label key={c} className="sa-check">
                <input type="checkbox" checked={form.channels.includes(c)} onChange={(e) => (setForm({ ...form, channels: e.target.checked ? [...form.channels, c] : form.channels.filter((x) => x !== c) }), setPreview(null))} /> {c === "IN_APP" ? "Kompaniya paneli (ilova ichida)" : "Telegram (botni boshlaganlarga)"}
              </label>
            ))}
            <label className="sa-check disabled">
              <input type="checkbox" disabled /> Email — integratsiya ulanmagan
            </label>
          </span>
        </Field>
      </div>
      <Field label="Matn">
        <textarea className="textarea" rows={5} value={form.body} onChange={(e) => (setForm({ ...form, body: e.target.value }), setPreview(null))} maxLength={3500} />
      </Field>
      <div className="form-grid">
        <Field label="Auditoriya">
          <select className="select" value={a.type} onChange={(e) => setAudience({ type: e.target.value as Audience["type"], companyIds: undefined, planIds: undefined })}>
            {Object.entries(AUDIENCE).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        {a.type === "EXPIRING" && (
          <Field label="Necha kun ichida">
            <input className="input" type="number" min={1} max={365} value={a.days || 7} onChange={(e) => setAudience({ days: Number(e.target.value) })} />
          </Field>
        )}
        {["COMPANY", "COMPANIES", "PLAN", "EXPIRING"].includes(a.type) && (
          <label className="sa-check">
            <input type="checkbox" checked={Boolean(a.ownersOnly)} onChange={(e) => setAudience({ ownersOnly: e.target.checked })} /> Faqat kompaniya egalari
          </label>
        )}
      </div>
      {(a.type === "COMPANY" || a.type === "COMPANIES") && (
        <div className="sa-multi cols sa-scroll">
          {(companies?.rows || []).map((c) => (
            <label key={c.id} className="sa-check">
              <input
                type={a.type === "COMPANY" ? "radio" : "checkbox"}
                name="company"
                checked={Boolean(a.companyIds?.includes(c.id))}
                onChange={(e) => setAudience({ companyIds: a.type === "COMPANY" ? [c.id] : e.target.checked ? [...(a.companyIds || []), c.id] : (a.companyIds || []).filter((x) => x !== c.id) })}
              />{" "}
              {c.name}
            </label>
          ))}
        </div>
      )}
      {a.type === "PLAN" && (
        <div className="sa-multi cols">
          {(plans || []).map((p) => (
            <label key={p.id} className="sa-check">
              <input type="checkbox" checked={Boolean(a.planIds?.includes(p.id))} onChange={(e) => setAudience({ planIds: e.target.checked ? [...(a.planIds || []), p.id] : (a.planIds || []).filter((x) => x !== p.id) })} /> {p.name}
            </label>
          ))}
        </div>
      )}
      {preview && (
        <div className="sa-preview">
          <b>Ko‘rib chiqish</b>
          <KeyValue
            items={[
              ["Kompaniyalar", num(preview.companies)],
              ["Rahbarlar", num(preview.users)],
              ["Panelga (ilova ichida)", num(preview.inApp)],
              ["Telegram’ga yetadi", num(preview.telegramReachable)],
              ["Telegram ulanmagan (o‘tkaziladi)", num(preview.telegramSkipped)],
              ["Namuna", preview.sample.join(", ") || "—"],
            ]}
          />
          <div className="sa-message-preview">
            <b>{form.title}</b>
            <p>{form.body}</p>
          </div>
        </div>
      )}
      <div className="form-actions">
        {saved?.status === "DRAFT" && (
          <button
            className="btn"
            onClick={async () => {
              if (await run(() => del(`/super-admin/notifications/${saved.id}`), toast, "Qoralama o‘chirildi")) {
                onChanged();
                onClose();
              }
            }}
          >
            O‘chirish
          </button>
        )}
        <button className="btn" disabled={form.title.length < 2 || form.body.length < 2 || !form.channels.length} onClick={() => void saveDraft()}>
          Saqlash va ko‘rib chiqish
        </button>
        <button className="btn btn-primary" disabled={!saved || !preview} onClick={() => setConfirm(true)}>
          <Send size={15} /> Yuborish
        </button>
      </div>
      {confirm && saved && preview && (
        <ConfirmDialog
          title="Yuborishni tasdiqlang"
          text={
            <>
              <b>{num(preview.companies)}</b> kompaniya, <b>{num(preview.users)}</b> rahbarga yuboriladi. Bu amalni qaytarib bo‘lmaydi (rejalashtirilganni bekor qilish mumkin).
              <label className="field" style={{ marginTop: 12 }}>
                <span className="label">Rejalashtirish (ixtiyoriy)</span>
                <input className="input" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              </label>
            </>
          }
          confirmLabel={scheduledAt ? "Rejalashtirish" : "Hozir yuborish"}
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            await post(`/super-admin/notifications/${saved.id}/send`, { confirm: true, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined });
            toast(scheduledAt ? "Rejalashtirildi" : "Navbatga qo‘yildi");
            onChanged();
            onClose();
          }}
        />
      )}
    </Modal>
  );
}

type DeliveryRow = { id: string; recipient: string; channel: string; status: string; attempts: number; error: string | null; sentAt: string | null; updatedAt: string };
function DeliveryDrawer({ note, onClose, onChanged }: { note: Note; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const run = useAction();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, reload } = useServerList<DeliveryRow>(`/super-admin/notifications/${note.id}/deliveries`, { status, page, pageSize: 30 });
  return (
    <DetailDrawer title={note.title} subtitle={`${audienceText(note.audience)} · ${note.createdBy}`} onClose={onClose} wide>
      <KeyValue
        items={[
          ["Holat", <StatusBadge key="s" value={note.status} />],
          ["Jami", num(note.stats?.total)],
          ["Yuborildi", num(note.stats?.sent)],
          ["Xato", num(note.stats?.failed)],
          ["O‘tkazildi (Telegram ulanmagan)", num(note.stats?.skipped)],
          ["Kutilmoqda", num(note.stats?.pending)],
        ]}
      />
      <p className="sa-message-preview">{note.body}</p>
      <PermissionGuard perm="notifications.send">
        <div className="sa-actions-grid">
          {Boolean(note.stats?.failed) && (
            <button className="btn" onClick={() => run(() => post<{ retried: number }>(`/super-admin/notifications/${note.id}/retry`, {}), toast, "Xatolar qayta navbatga qo‘yildi").then(() => (reload(true), onChanged()))}>
              Xatolarni qayta yuborish
            </button>
          )}
          {["SCHEDULED", "QUEUED", "SENDING"].includes(note.status) && (
            <button className="btn btn-danger" onClick={() => run(() => post(`/super-admin/notifications/${note.id}/cancel`, {}), toast, "Bekor qilindi").then(() => (onChanged(), onClose()))}>
              Bekor qilish
            </button>
          )}
        </div>
      </PermissionGuard>
      <FilterBar>
        <Select
          label="Holat"
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          options={[
            ["", "Barchasi"],
            ["SENT", "Yuborildi"],
            ["PENDING", "Kutilmoqda"],
            ["FAILED", "Xato"],
            ["SKIPPED", "O‘tkazildi"],
          ]}
        />
      </FilterBar>
      <DataTable
        rows={data?.rows}
        rowKey={(r) => r.id}
        loading={!data}
        columns={[
          { key: "r", label: "Oluvchi", render: (r) => r.recipient },
          { key: "c", label: "Kanal", render: (r) => (r.channel === "IN_APP" ? "Panel" : "Telegram") },
          { key: "s", label: "Holat", render: (r) => <span className="stack"><StatusBadge value={r.status} /><small>{r.error || ""}</small></span> },
          { key: "a", label: "Urinish", className: "num", render: (r) => r.attempts },
          { key: "t", label: "Vaqt", render: (r) => ago(r.sentAt || r.updatedAt) },
        ]}
      />
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </DetailDrawer>
  );
}

/* ---------------------------------------------------------- murojaatlar --- */
type TicketRow = { id: string; number: number; companyId: string; company: string; subject: string; category: string | null; priority: string; status: string; assignedTo: string | null; assignedName: string | null; createdByName: string; messages: number; unread: boolean; createdAt: string; updatedAt: string };
type Ticket = { id: string; number: number; companyId: string; company: string; subject: string; category?: string; priority: string; status: string; assignedTo?: string; assignedName?: string; createdByName: string; createdAt: string; messages: { id: string; author: string; authorName: string; text: string; internal?: boolean; attachments?: { id: string; name: string; size: number }[]; at: string }[] };
function Support() {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState({ q: "", status: "open", priority: "", assigned: "", page: 1 });
  const { data, loading, error, reload } = useServerList<TicketRow, { counts: Record<string, number> }>("/super-admin/support/tickets", { ...state, pageSize: 30 });
  const open = params.get("ticket");
  const { reload: reloadMe } = { reload: usePlatform().reload };
  return (
    <>
      <PageHeader title="Murojaatlar markazi" subtitle="Kompaniyalar panelning «Yordam» bo‘limidan yozadi; javoblar Telegram orqali ham bildiriladi" />
      {data && (
        <div className="sa-chipline">
          {Object.entries(data.counts).map(([s, n]) => (
            <button key={s} className={`sa-chip ${state.status === s ? "on" : ""}`} onClick={() => setState({ ...state, status: state.status === s ? "open" : s, page: 1 })}>
              <StatusBadge value={s} /> <b>{n}</b>
            </button>
          ))}
        </div>
      )}
      <Section>
        <FilterBar>
          <SearchInput value={state.q} onChange={(q) => setState((s) => ({ ...s, q, page: 1 }))} placeholder="#raqam, mavzu, kompaniya…" />
          <Select
            label="Holat"
            value={state.status}
            onChange={(status) => setState({ ...state, status, page: 1 })}
            options={[
              ["open", "Ochiq (barchasi)"],
              ["OPEN", "Yangi"],
              ["IN_PROGRESS", "Jarayonda"],
              ["WAITING_CUSTOMER", "Mijoz javobi kutilmoqda"],
              ["RESOLVED", "Hal qilingan"],
              ["CLOSED", "Yopilgan"],
              ["", "Hammasi"],
            ]}
          />
          <Select
            label="Muhimlik"
            value={state.priority}
            onChange={(priority) => setState({ ...state, priority, page: 1 })}
            options={[
              ["", "Har qanday"],
              ["URGENT", "Shoshilinch"],
              ["HIGH", "Yuqori"],
              ["NORMAL", "Oddiy"],
              ["LOW", "Past"],
            ]}
          />
          <Select
            label="Mas’ul"
            value={state.assigned}
            onChange={(assigned) => setState({ ...state, assigned, page: 1 })}
            options={[
              ["", "Har kim"],
              ["me", "Menga biriktirilgan"],
              ["none", "Biriktirilmagan"],
            ]}
          />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          onRowClick={(r) => setParams({ ticket: r.id })}
          empty={<p className="muted sa-empty">Murojaat yo‘q</p>}
          columns={[
            { key: "n", label: "#", render: (r) => <b className={r.unread ? "sa-unread" : ""}>#{r.number}</b> },
            { key: "s", label: "Mavzu", render: (r) => <span className="stack"><b className={r.unread ? "sa-unread" : ""}>{r.subject}</b><small>{r.company} · {r.createdByName}</small></span> },
            { key: "p", label: "Muhimlik", render: (r) => <StatusBadge value={r.priority} /> },
            { key: "st", label: "Holat", render: (r) => <StatusBadge value={r.status} /> },
            { key: "a", label: "Mas’ul", hideOnMobile: true, render: (r) => r.assignedName || "—" },
            { key: "u", label: "Yangilangan", render: (r) => ago(r.updatedAt) },
          ]}
        />
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setState({ ...state, page })} />}
      </Section>
      {open && (
        <TicketDrawer
          id={open}
          onClose={() => {
            params.delete("ticket");
            setParams(params);
            void reload(true);
            reloadMe();
          }}
        />
      )}
    </>
  );
}

function TicketDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast();
  const run = useAction();
  const { data, reload } = useApi<Ticket>(`/super-admin/support/tickets/${id}`);
  const { data: admins } = useApi<{ id: string; name: string }[]>("/super-admin/support/admins");
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setText("");
    setFiles([]);
  }, [id]);
  const update = (body: Record<string, unknown>, msg: string) => run(() => patch(`/super-admin/support/tickets/${id}`, body), toast, msg).then(() => reload(true));
  return (
    <DetailDrawer title={data ? `#${data.number} · ${data.subject}` : "…"} subtitle={data ? `${data.company} · ${data.createdByName} · ${dateTime(data.createdAt)}` : undefined} onClose={onClose} wide>
      {!data ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <PermissionGuard perm="support.manage">
            <div className="sa-ticket-controls">
              <Select
                label="Holat"
                value={data.status}
                onChange={(status) => void update({ status }, "Holat yangilandi")}
                options={[
                  ["OPEN", "Yangi"],
                  ["IN_PROGRESS", "Jarayonda"],
                  ["WAITING_CUSTOMER", "Mijoz javobi kutilmoqda"],
                  ["RESOLVED", "Hal qilindi"],
                  ["CLOSED", "Yopildi"],
                ]}
              />
              <Select
                label="Muhimlik"
                value={data.priority}
                onChange={(priority) => void update({ priority }, "Muhimlik yangilandi")}
                options={[
                  ["LOW", "Past"],
                  ["NORMAL", "Oddiy"],
                  ["HIGH", "Yuqori"],
                  ["URGENT", "Shoshilinch"],
                ]}
              />
              <Select label="Mas’ul" value={data.assignedTo || ""} onChange={(v) => void update({ assignedTo: v || null }, "Mas’ul belgilandi")} options={[["", "Biriktirilmagan"], ...((admins || []).map((a) => [a.id, a.name]) as [string, string][])]} />
              <Link className="btn btn-sm" to={`/super-admin/companies/${data.companyId}`}>
                Kompaniya
              </Link>
            </div>
          </PermissionGuard>
          <ol className="sa-thread">
            {data.messages.map((m) => (
              <li key={m.id} className={`${m.author.toLowerCase()} ${m.internal ? "internal" : ""}`}>
                <header>
                  <b>{m.authorName}</b>
                  {m.internal && (
                    <span className="badge amber">
                      <Lock size={11} /> Ichki izoh
                    </span>
                  )}
                  <time>{dateTime(m.at)}</time>
                </header>
                <p>{m.text}</p>
                {m.attachments?.map((a) => (
                  <button key={a.id} className="sa-attachment" onClick={() => run(() => downloadFile(`/super-admin/support/attachments/${a.id}`, a.name), toast)}>
                    <Paperclip size={13} /> {a.name} · {bytes(a.size)}
                  </button>
                ))}
              </li>
            ))}
          </ol>
          <PermissionGuard perm="support.manage">
            <form
              className="sa-reply"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const attachments = await Promise.all(files.map(async (f) => ({ name: f.name, dataUrl: await readFileAsDataUrl(f) })));
                  await post(`/super-admin/support/tickets/${id}/messages`, { text, internal, attachments });
                  setText("");
                  setFiles([]);
                  toast(internal ? "Ichki izoh qo‘shildi" : "Javob yuborildi");
                  void reload(true);
                } catch (reason) {
                  toast(reason instanceof Error ? reason.message : "Xatolik", "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={internal ? "Ichki izoh (kompaniyaga ko‘rinmaydi)…" : "Javob…"} required />
              <div className="sa-reply-bar">
                <label className="sa-check">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Ichki izoh
                </label>
                <label className="btn btn-sm">
                  <Paperclip size={13} /> Fayl
                  <input type="file" hidden multiple accept="image/jpeg,image/png,image/webp,application/pdf,text/plain" onChange={(e) => setFiles([...(e.target.files || [])].slice(0, 3))} />
                </label>
                {files.length > 0 && <small>{files.map((f) => f.name).join(", ")}</small>}
                <button className="btn btn-primary" disabled={busy || !text.trim()}>
                  <Send size={14} /> {internal ? "Izoh" : "Javob berish"}
                </button>
              </div>
            </form>
          </PermissionGuard>
        </>
      )}
    </DetailDrawer>
  );
}

/* ------------------------------------------------------------ demo so‘rovlari --- */
type Lead = { id: string; name: string; company: string; phone: string; employees?: string; message?: string; status: "NEW" | "CONTACTED" | "CLOSED"; createdAt: string };
function Leads() {
  const toast = useToast();
  const { data, error, reload } = useApi<Lead[]>("/admin/leads");
  return (
    <>
      <PageHeader title="Demo so‘rovlari" subtitle="Saytdagi «Demo so‘rash» formasidan" />
      <Section>
        <DataTable
          rows={data || undefined}
          rowKey={(r) => r.id}
          loading={!data}
          error={error}
          onRetry={() => void reload()}
          empty={<p className="muted sa-empty">So‘rov yo‘q</p>}
          columns={[
            { key: "d", label: "Sana", render: (r) => dateTime(r.createdAt) },
            { key: "n", label: "Ism", render: (r) => <b>{r.name}</b> },
            { key: "c", label: "Kompaniya", render: (r) => `${r.company}${r.employees ? ` · ${r.employees} xodim` : ""}` },
            { key: "p", label: "Telefon", render: (r) => <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a> },
            { key: "m", label: "Izoh", hideOnMobile: true, render: (r) => r.message || "—" },
            {
              key: "s",
              label: "Holat",
              render: (r) => (
                <select
                  className="select"
                  value={r.status}
                  aria-label="Holat"
                  onChange={async (e) => {
                    try {
                      await patch(`/admin/leads/${r.id}`, { status: e.target.value });
                      void reload(true);
                    } catch (reason) {
                      toast(reason instanceof Error ? reason.message : "Xatolik", "error");
                    }
                  }}
                >
                  <option value="NEW">Yangi</option>
                  <option value="CONTACTED">Bog‘lanildi</option>
                  <option value="CLOSED">Yopildi</option>
                </select>
              ),
            },
          ]}
        />
      </Section>
    </>
  );
}

export default function CommunicationPages({ view }: { view: string }) {
  if (view === "bulk") return <NotificationsView key="bulk" kind="BULK" />;
  if (view === "support") return <Support />;
  if (view === "leads") return <Leads />;
  return <NotificationsView key="notice" kind="NOTICE" />;
}
