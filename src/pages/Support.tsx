import { useState } from "react";
import { LifeBuoy, Mail, MessageCircle, Paperclip, Phone, Plus, Send, X } from "lucide-react";
import { post } from "../api";
import { useAuth } from "../auth";
import { useApi } from "../hooks";
import { Empty, Field, Modal, PageHeader, useToast } from "../components/ui";
import { DetailDrawer, ErrorState, Skeleton, StatusBadge, ago, bytes, dateTime, downloadFile, readFileAsDataUrl, useAction } from "./superadmin/kit";

/*
 * Staffora yordami (kompaniya paneli): platformaga murojaat yuborish, javoblarni ko‘rish, fayl biriktirish.
 * Faqat o‘z kompaniyasining murojaatlari ko‘rinadi (server tomonda tekshiriladi).
 */

type Attachment = { id: string; name: string; mime: string; size: number };
type Message = { id: string; author: "COMPANY" | "ADMIN" | "SYSTEM"; authorName: string; text: string; attachments?: Attachment[]; at: string };
type Ticket = { id: string; number: number; subject: string; category?: string; priority: string; status: string; createdByName: string; messages: Message[]; unreadCompany: boolean; createdAt: string; updatedAt: string };
type Contacts = { platformName: string; email: string | null; telegram: string | null; phone: string | null; hours: string | null };

const PRIORITIES: [string, string][] = [
  ["NORMAL", "Oddiy"],
  ["HIGH", "Yuqori"],
  ["URGENT", "Shoshilinch"],
  ["LOW", "Past"],
];
const CATEGORIES = ["Davomat", "Telegram bot", "Mobil ilova", "Hisobotlar", "Ish haqi", "Tarif va to‘lov", "Boshqa"];
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,text/plain";

function FilePick({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  return (
    <span className="sp-files">
      <label className="btn btn-sm">
        <Paperclip size={13} /> Fayl
        <input type="file" hidden multiple accept={ACCEPT} onChange={(e) => onChange([...files, ...(e.target.files || [])].slice(0, 3))} />
      </label>
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="sp-file">
          {f.name}
          <button type="button" aria-label="Olib tashlash" onClick={() => onChange(files.filter((_, j) => j !== i))}>
            <X size={12} />
          </button>
        </span>
      ))}
    </span>
  );
}

const encode = (files: File[]) => Promise.all(files.map(async (f) => ({ name: f.name, dataUrl: await readFileAsDataUrl(f) })));

export function SupportPage() {
  const { user } = useAuth();
  const { data, error, reload } = useApi<Ticket[]>("/support/tickets");
  const { data: contacts } = useApi<Contacts>("/support/contacts");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const readOnly = user?.preview?.mode === "READ_ONLY";
  return (
    <div className="page">
      <PageHeader
        title="Staffora yordami"
        subtitle="Savol, xato yoki taklif — murojaat yuboring, javob shu yerda ko‘rinadi"
        actions={
          !readOnly && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> Yangi murojaat
            </button>
          )
        }
      />
      {contacts && (contacts.email || contacts.telegram || contacts.phone) && (
        <div className="sp-contacts">
          {contacts.telegram && (
            <a href={`https://t.me/${contacts.telegram.replace(/^@/, "")}`} target="_blank" rel="noreferrer">
              <MessageCircle size={15} /> {contacts.telegram}
            </a>
          )}
          {contacts.email && (
            <a href={`mailto:${contacts.email}`}>
              <Mail size={15} /> {contacts.email}
            </a>
          )}
          {contacts.phone && (
            <a href={`tel:${contacts.phone.replace(/[^\d+]/g, "")}`}>
              <Phone size={15} /> {contacts.phone}
            </a>
          )}
          {contacts.hours && <span className="muted">{contacts.hours}</span>}
        </div>
      )}
      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : !data ? (
        <Skeleton rows={6} />
      ) : !data.length ? (
        <div className="card">
          <Empty icon={LifeBuoy} title="Murojaat yo‘q" text="Muammo yoki savol bo‘lsa — «Yangi murojaat» tugmasini bosing." />
        </div>
      ) : (
        <ul className="sp-list">
          {data.map((t) => {
            const last = t.messages[t.messages.length - 1];
            return (
              <li key={t.id}>
                <button className={`card sp-ticket ${t.unreadCompany ? "unread" : ""}`} onClick={() => setOpen(t.id)}>
                  <span className="sp-ticket-main">
                    <b>
                      <small>#{t.number}</small> {t.subject}
                    </b>
                    <span className="muted">
                      {last ? `${last.author === "ADMIN" ? "Staffora: " : ""}${last.text.slice(0, 120)}` : ""}
                    </span>
                  </span>
                  <span className="sp-ticket-side">
                    <StatusBadge value={t.status} />
                    <small className="muted">{ago(t.updatedAt)}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {creating && (
        <CreateTicket
          onClose={() => setCreating(false)}
          onDone={(id) => {
            setCreating(false);
            void reload(true);
            setOpen(id);
          }}
        />
      )}
      {open && <TicketView id={open} readOnly={readOnly} onClose={() => setOpen(null)} onChanged={() => void reload(true)} />}
    </div>
  );
}

function CreateTicket({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const toast = useToast();
  const run = useAction();
  const [form, setForm] = useState({ subject: "", text: "", priority: "NORMAL", category: CATEGORIES[0] });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Yangi murojaat" subtitle="Muammoni batafsil yozing — qaysi sahifa, qachon, nima bo‘ldi" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ticket = await run(async () => post<Ticket>("/support/tickets", { ...form, attachments: await encode(files) }), toast, "Murojaat yuborildi");
          setBusy(false);
          if (ticket) onDone(ticket.id);
        }}
      >
        <Field label="Mavzu">
          <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required minLength={3} maxLength={160} autoFocus />
        </Field>
        <div className="sa-form-row">
          <Field label="Bo‘lim">
            <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Muhimlik">
            <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {PRIORITIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Xabar">
          <textarea className="textarea" rows={5} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} required minLength={5} maxLength={5000} />
        </Field>
        <FilePick files={files} onChange={setFiles} />
        <p className="muted sp-note">Rasm, PDF yoki matn · 3 tagacha fayl. Parol va maxfiy ma’lumot yubormang.</p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={busy || form.subject.trim().length < 3 || form.text.trim().length < 5}>
            <Send size={15} /> Yuborish
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TicketView({ id, readOnly, onClose, onChanged }: { id: string; readOnly: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const run = useAction();
  const { data, error, reload } = useApi<Ticket>(`/support/tickets/${id}`);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const closed = data?.status === "CLOSED";
  return (
    <DetailDrawer
      title={data ? `#${data.number} · ${data.subject}` : "…"}
      subtitle={data ? `${data.category || "Murojaat"} · ${dateTime(data.createdAt)}` : undefined}
      onClose={() => {
        onChanged();
        onClose();
      }}
      actions={data && <StatusBadge value={data.status} />}
    >
      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : !data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <ol className="sa-thread">
            {data.messages.map((m) => (
              <li key={m.id} className={m.author === "COMPANY" ? "admin" : m.author === "ADMIN" ? "company" : "system"}>
                <header>
                  <b>{m.author === "ADMIN" ? `Staffora · ${m.authorName}` : m.authorName}</b>
                  <time>{dateTime(m.at)}</time>
                </header>
                <p>{m.text}</p>
                {m.attachments?.map((a) => (
                  <button key={a.id} className="sa-attachment" onClick={() => void run(() => downloadFile(`/support/attachments/${a.id}`, a.name), toast)}>
                    <Paperclip size={13} /> {a.name} · {bytes(a.size)}
                  </button>
                ))}
              </li>
            ))}
          </ol>
          {closed ? (
            <p className="muted sa-empty">Murojaat yopilgan. Yangi savol bo‘lsa — yangi murojaat oching.</p>
          ) : readOnly ? null : (
            <form
              className="sa-reply"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const ok = await run(async () => post(`/support/tickets/${id}/messages`, { text, attachments: await encode(files) }), toast, "Yuborildi");
                setBusy(false);
                if (ok) {
                  setText("");
                  setFiles([]);
                  void reload(true);
                }
              }}
            >
              <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Javob yozing…" required />
              <div className="sa-reply-bar">
                <FilePick files={files} onChange={setFiles} />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    void run(() => post(`/support/tickets/${id}/close`, {}), toast, "Murojaat yopildi").then((r) => {
                      if (r) void reload(true);
                    })
                  }
                >
                  Yopish
                </button>
                <button className="btn btn-primary" disabled={busy || !text.trim()}>
                  <Send size={14} /> Yuborish
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </DetailDrawer>
  );
}
