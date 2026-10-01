import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronLeft, Download, EyeOff, FileText, LoaderCircle, MessageCircleQuestion, Megaphone, Send } from "lucide-react";
import { api, errorText, post } from "../../api";
import { dateUz, tashkentClock, tashkentIsoDate } from "@/lib/format";
import { getCached, setCached } from "../miniCache";
import { EmptyArt, Seg, Sheet, SkeletonList, type Toast } from "./shared";
import { confirmNative, downloadMiniFile, haptic } from "./tg";

/*
 * «Murojaatlar»: HR’ga savol (yozishma), anonim taklif/shikoyat va ma’lumotnoma (spravka).
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
  unread: boolean;
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
  decidedNote?: string;
  createdAt: string;
};
export type HelpdeskView = "questions" | "feedback" | "certificates";

const statusChip: Record<Ticket["status"], [string, string]> = {
  OPEN: ["Kutilmoqda", "warn"],
  ANSWERED: ["Javob bor", "ok"],
  CLOSED: ["Yopilgan", ""],
};
const certChip: Record<Certificate["status"], [string, string]> = {
  PENDING: ["Tayyorlanmoqda", "warn"],
  READY: ["Tayyor", "ok"],
  REJECTED: ["Rad etildi", "bad"],
};
const when = (iso: string) => {
  const day = tashkentIsoDate(new Date(iso));
  return day === tashkentIsoDate() ? tashkentClock(new Date(iso)) : `${dateUz(day)}, ${tashkentClock(new Date(iso))}`;
};

export function HelpdeskSheet({ onClose, onToast, initialView, focusId }: { onClose: () => void; onToast: Toast; initialView?: HelpdeskView; focusId?: string }) {
  const [view, setView] = useState<HelpdeskView>(initialView || "questions");
  const [data, setData] = useState<{ categories: Record<string, string>; items: Ticket[] } | null>(() => getCached("tickets"));
  const [open, setOpen] = useState<Ticket | null>(null);
  const [composing, setComposing] = useState(false);
  const load = useCallback(
    () =>
      api<{ categories: Record<string, string>; items: Ticket[] }>("/mini/tickets")
        .then((value) => {
          setCached("tickets", value);
          setData(value);
          return value;
        })
        .catch((reason) => {
          onToast(errorText(reason), "error");
          return null;
        }),
    [onToast],
  );
  useEffect(() => {
    void load().then((value) => {
      const target = value?.items.find((t) => t.id === focusId);
      if (target) {
        setView(target.kind === "FEEDBACK" ? "feedback" : "questions");
        setOpen(target);
      }
    });
  }, [load, focusId]);

  if (open)
    return (
      <TicketThread
        ticket={open}
        categories={data?.categories || {}}
        onBack={() => {
          setOpen(null);
          void load();
        }}
        onChanged={(ticket) => setOpen(ticket)}
        onToast={onToast}
      />
    );
  if (composing && view !== "certificates")
    return (
      <TicketForm
        kind={view === "feedback" ? "FEEDBACK" : "QUESTION"}
        categories={data?.categories || {}}
        onClose={() => setComposing(false)}
        onSaved={(ticket) => {
          setComposing(false);
          haptic.success();
          onToast(ticket.anonymous ? "Anonim xabaringiz yuborildi" : "HR’ga yuborildi — javob Telegram’ga ham keladi");
          void load();
          if (ticket.kind === "QUESTION") setOpen(ticket);
        }}
      />
    );

  const items = (data?.items || []).filter((t) => (view === "feedback" ? t.kind === "FEEDBACK" : t.kind === "QUESTION"));
  return (
    <Sheet
      title="Murojaatlar"
      subtitle="HR bilan bevosita aloqa"
      onClose={onClose}
      className="hd-sheet"
      primary={view === "certificates" ? null : { text: view === "feedback" ? "Taklif yoki shikoyat yozish" : "HR’ga savol berish", onClick: () => setComposing(true) }}
    >
      <Seg
        className="three"
        value={view}
        onChange={(next) => {
          haptic.select();
          setView(next);
        }}
        options={[
          ["questions", "Savollar"],
          ["feedback", "Taklif"],
          ["certificates", "Spravka"],
        ]}
      />
      {view === "certificates" ? (
        <Certificates onToast={onToast} />
      ) : !data ? (
        <SkeletonList rows={3} />
      ) : !items.length ? (
        <div className="mini-empty">
          <EmptyArt kind={view === "feedback" ? "idea" : "chat"} />
          <b>{view === "feedback" ? "Fikringiz muhim" : "Savollar yo‘q"}</b>
          <small>
            {view === "feedback"
              ? "Ish sharoiti, jamoa yoki jarayon haqida taklif yoki shikoyatingizni yozing. Xohlasangiz — anonim."
              : "Ish haqi, grafik, ta’til yoki hujjatlar bo‘yicha HR’dan so‘rang — javob shu yerga keladi."}
          </small>
        </div>
      ) : (
        <section className="mini-card">
          <div className="mini-rows">
            {items.map((t) => {
              const [label, tone] = statusChip[t.status];
              const last = t.messages[t.messages.length - 1];
              return (
                <button className="mini-row" key={t.id} onClick={() => setOpen(t)}>
                  <span className="mini-ico">{t.kind === "FEEDBACK" ? t.anonymous ? <EyeOff size={17} /> : <Megaphone size={17} /> : <MessageCircleQuestion size={17} />}</span>
                  <span>
                    <b>
                      {t.subject}
                      {t.unread && <i className="mn-dot inline" aria-label="Yangi javob" />}
                    </b>
                    <small>
                      {last?.from === "HR" ? "HR: " : ""}
                      {last?.text.slice(0, 60)}
                    </small>
                  </span>
                  <span className={`mini-chip ${tone}`}>{label}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </Sheet>
  );
}

function TicketForm({ kind, categories, onClose, onSaved }: { kind: Ticket["kind"]; categories: Record<string, string>; onClose: () => void; onSaved: (t: Ticket) => void }) {
  const [category, setCategory] = useState(kind === "FEEDBACK" ? "IDEA" : "SALARY");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [anonymous, setAnonymous] = useState(kind === "FEEDBACK");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = subject.trim().length >= 3 && text.trim().length >= 5;
  async function save() {
    if (!valid) return setError("Mavzu va xabarni yozing.");
    setBusy(true);
    setError("");
    try {
      onSaved(await post<Ticket>("/mini/tickets", { kind, anonymous, category, subject: subject.trim(), text: text.trim() }));
    } catch (reason) {
      setError(errorText(reason));
      haptic.error();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={kind === "FEEDBACK" ? "Taklif yoki shikoyat" : "HR’ga savol"}
      subtitle={kind === "FEEDBACK" && anonymous ? "Ismingiz HR’ga ko‘rinmaydi" : "Javob shu yerga va Telegram’ga keladi"}
      onClose={onClose}
      primary={{ text: "Yuborish", onClick: () => void save(), busy, disabled: !valid }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          Mavzu turi
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(categories).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Qisqacha mavzu
          <input value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} placeholder={kind === "FEEDBACK" ? "Masalan: oshxonada navbat" : "Masalan: avans qachon beriladi?"} />
        </label>
        <label>
          Xabar
          <textarea value={text} maxLength={2000} rows={5} onChange={(e) => setText(e.target.value)} placeholder="Batafsil yozing" />
        </label>
        {kind === "FEEDBACK" && (
          <label className="mp-row mp-switch hd-anon">
            <span>
              <EyeOff size={15} /> Anonim yuborish
              <small>HR va rahbarlar kimdan kelganini ko‘rmaydi. Javobni faqat siz shu yerda ko‘rasiz.</small>
            </span>
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          </label>
        )}
        {error && (
          <div className="mini-alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}
      </form>
    </Sheet>
  );
}

function TicketThread({ ticket, categories, onBack, onChanged, onToast }: { ticket: Ticket; categories: Record<string, string>; onBack: () => void; onChanged: (t: Ticket) => void; onToast: Toast }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ticket.unread) void post(`/mini/tickets/${ticket.id}/read`).catch(() => undefined);
    end.current?.scrollIntoView({ block: "end" });
  }, [ticket.id, ticket.unread, ticket.messages.length]);
  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      onChanged(await post<Ticket>(`/mini/tickets/${ticket.id}/messages`, { text: text.trim() }));
      setText("");
      haptic.success();
    } catch (reason) {
      onToast(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (!(await confirmNative("Murojaatni yopasizmi? Savolingizga javob olgan bo‘lsangiz — yoping.", { ok: "Yopish" }))) return;
    await post(`/mini/tickets/${ticket.id}/close`).catch(() => undefined);
    onBack();
  }
  const closed = ticket.status === "CLOSED";
  return (
    <Sheet
      title={ticket.subject}
      subtitle={`${categories[ticket.category] || ""}${ticket.anonymous ? " · anonim" : ""} · ${statusChip[ticket.status][0]}`}
      onClose={onBack}
      className="hd-thread"
      headExtra={
        <button className="mn-readall" onClick={onBack}>
          <ChevronLeft size={15} /> Ro‘yxat
        </button>
      }
      primary={closed ? null : { text: text.trim() ? "Yuborish" : "Xabar yozing", onClick: () => void send(), busy, disabled: !text.trim() }}
      secondary={!closed && ticket.status === "ANSWERED" ? { text: "Yopish", onClick: () => void close() } : null}
    >
      <div className="hd-messages">
        {ticket.messages.map((m) => (
          <div key={m.id} className={`hd-msg ${m.from === "HR" ? "hr" : "me"}`}>
            <p>{m.text}</p>
            <small>
              {m.from === "HR" ? m.author || "HR" : "Siz"} · {when(m.at)}
            </small>
          </div>
        ))}
        {ticket.status === "OPEN" && <div className="hd-wait">HR javobini kutmoqdasiz — odatda ish kuni davomida javob beriladi.</div>}
        <div ref={end} />
      </div>
      {!closed && (
        <label className="hd-input">
          <textarea value={text} maxLength={2000} rows={2} onChange={(e) => setText(e.target.value)} placeholder="Xabar yozing…" />
          {!window.Telegram?.WebApp?.initData && (
            <button type="button" aria-label="Yuborish" disabled={busy || !text.trim()} onClick={() => void send()}>
              {busy ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}
            </button>
          )}
        </label>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------- ma’lumotnoma --- */
function Certificates({ onToast }: { onToast: Toast }) {
  const [data, setData] = useState<{ types: Record<string, string>; items: Certificate[] } | null>(() => getCached("certificates"));
  const [form, setForm] = useState({ type: "WORK", purpose: "", note: "" });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<{ types: Record<string, string>; items: Certificate[] }>("/mini/certificates")
        .then((value) => {
          setCached("certificates", value);
          setData(value);
        })
        .catch((reason) => onToast(errorText(reason), "error")),
    [onToast],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function save() {
    if (form.purpose.trim().length < 3) return onToast("Qayerga kerakligini yozing", "error");
    setBusy(true);
    try {
      await post("/mini/certificates", { type: form.type, purpose: form.purpose.trim(), note: form.note.trim() || undefined });
      haptic.success();
      onToast("So‘rov HR’ga yuborildi — tayyor bo‘lganda xabar keladi");
      setAsking(false);
      setForm({ type: "WORK", purpose: "", note: "" });
      void load();
    } catch (reason) {
      onToast(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  }
  async function download(id: string) {
    setDownloading(id);
    try {
      await downloadMiniFile({ kind: "document", id });
    } catch (reason) {
      onToast(errorText(reason, "Yuklab bo‘lmadi."), "error");
    } finally {
      setDownloading(null);
    }
  }
  return (
    <>
      {!asking ? (
        <button className="mini-btn" onClick={() => setAsking(true)}>
          <FileText size={18} /> Ma’lumotnoma so‘rash
        </button>
      ) : (
        <section className="mini-card hd-cert-form">
          <label>
            Turi
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {Object.entries(data?.types || {}).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Qayerga kerak
            <input value={form.purpose} maxLength={200} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Masalan: bankka kredit uchun" />
          </label>
          <label>
            Izoh (ixtiyoriy)
            <input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Masalan: oxirgi 6 oylik daromad bilan" />
          </label>
          <div className="ms-form-actions">
            <button type="button" className="mini-btn sm ghost-neutral" onClick={() => setAsking(false)}>
              Bekor qilish
            </button>
            <button type="button" className="mini-btn sm" disabled={busy} onClick={() => void save()}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />} Yuborish
            </button>
          </div>
        </section>
      )}
      {!data ? (
        <SkeletonList rows={2} />
      ) : !data.items.length ? (
        <div className="mini-empty">
          <EmptyArt kind="doc" />
          <b>Hali so‘rov yo‘q</b>
          <small>Ish joyidan, ish haqi yoki 2-NDFL ma’lumotnomasini so‘rang — HR tayyorlab, shu yerga yuklaydi.</small>
        </div>
      ) : (
        <section className="mini-card">
          <div className="mini-rows">
            {data.items.map((c) => {
              const [label, tone] = certChip[c.status];
              return (
                <div className="mini-row" key={c.id}>
                  <span className="mini-ico">
                    <FileText size={17} />
                  </span>
                  <span>
                    <b>{data.types[c.type] || c.type}</b>
                    <small>
                      {c.purpose} · {dateUz(c.createdAt.slice(0, 10))}
                      {c.decidedNote ? ` · ${c.decidedNote}` : ""}
                    </small>
                    {c.status === "READY" && c.documentId && (
                      <button className="mini-link" disabled={downloading === c.documentId} onClick={() => void download(c.documentId!)}>
                        {downloading === c.documentId ? "Yuklanmoqda…" : (
                          <>
                            <Download size={13} /> Yuklab olish
                          </>
                        )}
                      </button>
                    )}
                  </span>
                  <span className={`mini-chip ${tone}`}>{label}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
