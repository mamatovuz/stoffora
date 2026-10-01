import { useMemo, useRef, useState } from "react";
import { Check, EyeOff, FileText, MessageCircleQuestion, Megaphone, Send, Upload, X } from "lucide-react";
import { errorText, patch, post } from "../api";
import { useApi } from "../hooks";
import { Empty, ErrorBox, Loading, Modal, PageHeader, Segmented, useToast } from "../components/ui";
import { fileToDataUrl } from "../components/Documents";
import { dateUz } from "@/lib/format";

/*
 * HR «Murojaatlar» sahifasi: xodimlarning savollari, (anonim) taklif/shikoyatlari
 * va ma’lumotnoma (spravka) so‘rovlari — hammasi Mini App’dan keladi.
 */

type Message = { id: string; from: "EMPLOYEE" | "HR"; author?: string; text: string; at: string };
type Ticket = {
  id: string;
  kind: "QUESTION" | "FEEDBACK";
  anonymous: boolean;
  category: string;
  subject: string;
  status: "OPEN" | "ANSWERED" | "CLOSED";
  messages: Message[];
  unreadHr: boolean;
  employeeName: string;
  branch?: string;
  createdAt: string;
  updatedAt: string;
};
type Certificate = {
  id: string;
  type: string;
  purpose: string;
  note?: string;
  status: "PENDING" | "READY" | "REJECTED";
  documentId?: string;
  decidedBy?: string;
  decidedNote?: string;
  employeeName: string;
  employeeNo?: string;
  createdAt: string;
};
type Tab = "QUESTION" | "FEEDBACK" | "CERTIFICATES";

const ticketStatus: Record<Ticket["status"], [string, string]> = {
  OPEN: ["Javob kutmoqda", "amber"],
  ANSWERED: ["Javob berilgan", "green"],
  CLOSED: ["Yopilgan", "gray"],
};
const certStatus: Record<Certificate["status"], [string, string]> = {
  PENDING: ["Tayyorlash kerak", "amber"],
  READY: ["Tayyor", "green"],
  REJECTED: ["Rad etilgan", "red"],
};
const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });

export function HelpdeskPage() {
  const tickets = useApi<{ categories: Record<string, string>; items: Ticket[] }>("/tickets");
  const certificates = useApi<{ types: Record<string, string>; items: Certificate[] }>("/certificates");
  const [tab, setTab] = useState<Tab>("QUESTION");
  const [open, setOpen] = useState<Ticket | null>(null);
  const [preparing, setPreparing] = useState<Certificate | null>(null);
  const list = useMemo(() => (tickets.data?.items || []).filter((t) => t.kind === tab), [tickets.data, tab]);
  const count = (kind: Ticket["kind"]) => tickets.data?.items.filter((t) => t.kind === kind && t.status === "OPEN").length;
  return (
    <div className="page">
      <PageHeader title="Murojaatlar" subtitle="Xodimlarning savollari, takliflari va ma’lumotnoma so‘rovlari (Mini App’dan)" />
      <section className="card">
        <div className="filters">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "QUESTION", label: "Savollar", count: count("QUESTION") },
              { value: "FEEDBACK", label: "Taklif va shikoyatlar", count: count("FEEDBACK") },
              { value: "CERTIFICATES", label: "Ma’lumotnomalar", count: certificates.data?.items.filter((c) => c.status === "PENDING").length },
            ]}
          />
        </div>
        {tab === "CERTIFICATES" ? (
          certificates.loading && !certificates.data ? (
            <Loading />
          ) : certificates.error ? (
            <div className="card-body">
              <ErrorBox message={certificates.error} />
            </div>
          ) : !certificates.data?.items.length ? (
            <Empty icon={FileText} title="So‘rovlar yo‘q" text="Xodim Mini App’da «Spravka» bo‘limidan so‘raganda shu yerga tushadi." />
          ) : (
            <div className="hd-list">
              {certificates.data.items.map((c) => {
                const [label, tone] = certStatus[c.status];
                return (
                  <article key={c.id} className={`hd-item ${c.status === "PENDING" ? "is-new" : ""}`}>
                    <div>
                      <b>{certificates.data!.types[c.type] || c.type}</b>
                      <small>
                        {c.employeeName}
                        {c.employeeNo ? ` · ${c.employeeNo}` : ""} · {when(c.createdAt)}
                      </small>
                      <p>
                        Qayerga: {c.purpose}
                        {c.note ? ` · ${c.note}` : ""}
                      </p>
                      {c.decidedBy && (
                        <small className="muted">
                          {c.decidedBy}
                          {c.decidedNote ? ` — ${c.decidedNote}` : ""}
                        </small>
                      )}
                    </div>
                    <span className={`badge ${tone}`}>{label}</span>
                    {c.status === "PENDING" && (
                      <button className="btn btn-sm btn-primary" onClick={() => setPreparing(c)}>
                        <Upload size={14} /> Tayyorlash
                      </button>
                    )}
                    {c.documentId && (
                      <a className="btn btn-sm" href={`/api/documents/${c.documentId}/file`} target="_blank" rel="noreferrer">
                        <FileText size={14} /> Fayl
                      </a>
                    )}
                  </article>
                );
              })}
            </div>
          )
        ) : tickets.loading && !tickets.data ? (
          <Loading />
        ) : tickets.error ? (
          <div className="card-body">
            <ErrorBox message={tickets.error} />
          </div>
        ) : !list.length ? (
          <Empty
            icon={tab === "FEEDBACK" ? Megaphone : MessageCircleQuestion}
            title={tab === "FEEDBACK" ? "Takliflar yo‘q" : "Savollar yo‘q"}
            text={tab === "FEEDBACK" ? "Xodimlar Mini App’dan taklif yoki shikoyat (xohlasa anonim) yuborishi mumkin." : "Xodim Mini App’da «HR’ga savol» bosganda shu yerga tushadi."}
          />
        ) : (
          <div className="hd-list">
            {list.map((t) => {
              const [label, tone] = ticketStatus[t.status];
              const last = t.messages[t.messages.length - 1];
              return (
                <button key={t.id} className={`hd-item ${t.unreadHr ? "is-new" : ""}`} onClick={() => setOpen(t)}>
                  <div>
                    <b>
                      {t.unreadHr && <i className="hd-dot" />}
                      {t.subject}
                    </b>
                    <small>
                      {t.anonymous ? (
                        <>
                          <EyeOff size={12} /> Anonim
                        </>
                      ) : (
                        t.employeeName
                      )}
                      {t.branch ? ` · ${t.branch}` : ""} · {tickets.data?.categories[t.category] || t.category} · {when(t.updatedAt)}
                    </small>
                    <p>
                      {last?.from === "HR" ? "Siz: " : ""}
                      {last?.text.slice(0, 160)}
                    </p>
                  </div>
                  <span className={`badge ${tone}`}>{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      {open && (
        <TicketModal
          ticket={open}
          categories={tickets.data?.categories || {}}
          onClose={() => {
            setOpen(null);
            void tickets.reload(true);
          }}
          onChanged={(t) => {
            setOpen(t);
            void tickets.reload(true);
          }}
        />
      )}
      {preparing && (
        <CertificateModal
          request={preparing}
          title={certificates.data?.types[preparing.type] || preparing.type}
          onClose={() => setPreparing(null)}
          onSaved={() => {
            setPreparing(null);
            void certificates.reload(true);
          }}
        />
      )}
    </div>
  );
}

function TicketModal({ ticket, categories, onClose, onChanged }: { ticket: Ticket; categories: Record<string, string>; onClose: () => void; onChanged: (t: Ticket) => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // Ochilganda o‘qildi deb belgilanadi.
  const marked = useRef(false);
  if (!marked.current && ticket.unreadHr) {
    marked.current = true;
    void patch(`/tickets/${ticket.id}`, { read: true }).catch(() => undefined);
  }
  async function reply(close = false) {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const updated = await post<Ticket>(`/tickets/${ticket.id}/messages`, { text: text.trim(), close });
      setText("");
      toast(ticket.anonymous ? "Javob yuborildi — xodim ilovada ko‘radi" : "Javob yuborildi — xodimga Telegram’da xabar ketdi");
      onChanged({ ...ticket, ...updated, employeeName: ticket.employeeName, branch: ticket.branch });
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  }
  async function setStatus(status: Ticket["status"]) {
    try {
      const updated = await patch<Ticket>(`/tickets/${ticket.id}`, { status });
      onChanged({ ...ticket, ...updated, employeeName: ticket.employeeName, branch: ticket.branch });
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  return (
    <Modal
      title={ticket.subject}
      subtitle={`${ticket.anonymous ? "Anonim" : ticket.employeeName} · ${categories[ticket.category] || ticket.category} · ${ticketStatus[ticket.status][0]}`}
      onClose={onClose}
      size="wide"
    >
      {ticket.anonymous && (
        <div className="alert info" style={{ marginBottom: 12 }}>
          <EyeOff size={18} />
          <div>
            <b>Anonim murojaat</b>
            <p>Yuboruvchini tizim ham ko‘rsatmaydi. Javobingizni xodim faqat Mini App’da ko‘radi.</p>
          </div>
        </div>
      )}
      <div className="hd-thread-panel">
        {ticket.messages.map((m) => (
          <div key={m.id} className={`hd-bubble ${m.from === "HR" ? "hr" : "emp"}`}>
            <p>{m.text}</p>
            <small>
              {m.from === "HR" ? m.author || "HR" : ticket.anonymous ? "Anonim" : m.author || ticket.employeeName} · {when(m.at)}
            </small>
          </div>
        ))}
      </div>
      {ticket.status !== "CLOSED" ? (
        <>
          <textarea className="textarea" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Javobingizni yozing…" />
          <div className="form-actions">
            <button className="btn" onClick={() => void setStatus("CLOSED")}>
              <X size={15} /> Yopish
            </button>
            <button className="btn" disabled={busy || !text.trim()} onClick={() => void reply(true)}>
              <Check size={15} /> Javob berib yopish
            </button>
            <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void reply(false)}>
              <Send size={15} /> Javob berish
            </button>
          </div>
        </>
      ) : (
        <div className="form-actions">
          <span className="muted">Murojaat yopilgan · {dateUz(ticket.updatedAt.slice(0, 10))}</span>
          <button className="btn" onClick={() => void setStatus("OPEN")}>
            Qayta ochish
          </button>
        </div>
      )}
    </Modal>
  );
}

function CertificateModal({ request, title, onClose, onSaved }: { request: Certificate; title: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(ready: boolean) {
    if (ready && !file) return setError("Tayyor ma’lumotnoma faylini tanlang (PDF yoki rasm).");
    setBusy(true);
    setError("");
    try {
      await post(`/certificates/${request.id}/decide`, { ready, note: note.trim() || undefined, dataUrl: file?.dataUrl });
      toast(ready ? "Ma’lumotnoma xodimga yuborildi" : "So‘rov rad etildi");
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} subtitle={`${request.employeeName} · qayerga: ${request.purpose}`} onClose={onClose} size="narrow">
      {request.note && <p className="hint">Xodim izohi: {request.note}</p>}
      <label className="btn" style={{ marginBottom: 12 }}>
        <Upload size={15} /> {file ? file.name : "Faylni tanlash (PDF yoki rasm, 1,4 MB gacha)"}
        <input
          type="file"
          accept="application/pdf,image/*"
          hidden
          onChange={async (e) => {
            const picked = e.target.files?.[0];
            if (!picked) return;
            try {
              setFile({ name: picked.name, dataUrl: await fileToDataUrl(picked) });
            } catch (reason) {
              setError(errorText(reason));
            }
          }}
        />
      </label>
      <textarea className="textarea" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Izoh (ixtiyoriy): masalan, asli kadrlar bo‘limida" />
      <ErrorBox message={error} />
      <div className="form-actions">
        <button className="btn btn-danger" disabled={busy} onClick={() => void decide(false)}>
          <X size={15} /> Rad etish
        </button>
        <button className="btn btn-primary" disabled={busy || !file} onClick={() => void decide(true)}>
          <Send size={15} /> Xodimga yuborish
        </button>
      </div>
    </Modal>
  );
}
