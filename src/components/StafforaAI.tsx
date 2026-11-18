import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowUp, Check, ChevronRight, History, Mic, Plus, RotateCcw, Settings2, ShieldAlert, Square, Trash2, X } from "lucide-react";
import { api, del, errorText, post } from "../api";
import { useAuth } from "../auth";
import mark from "../assets/staffora-mark.svg";
import { Markdown } from "./Markdown";
import type { AiCard } from "@/lib/ai/types";

/*
 * Staffora AI — pastki o‘ng burchakdagi yumaloq tugma (Staffora belgisi) va chat oynasi.
 * O‘qish savollari darhol bazadan javob beradi (hisobot kartasi bilan); o‘zgartirish buyruqlari
 * tasdiqlash kartasini ko‘rsatadi va faqat «Tasdiqlash»dan keyin bajariladi.
 */
type Message = { id: string; role: "USER" | "ASSISTANT"; text: string; card?: AiCard; createdAt: string };
type Conversation = { id: string; title: string; updatedAt: string };
type PendingAction = { id: string; name: string; level: "WRITE" | "SENSITIVE"; summary: string; confirmationToken: string };
type ChatResult = { conversationId: string; message: Message; pendingAction?: PendingAction | null };
type ActionResult = { status: string; result?: { message?: string; verified?: boolean } };
type AiStatus = { enabled: boolean; configured: boolean; ready: boolean; canManage: boolean; providers: string[]; currentModel?: string; lastError?: string };

const ASK = ["Bugungi davomatni ko‘rsat", "Bugun kechikkan xodimlarni chiqar", "Kelmagan xodimlar kim?", "Filiallar bo‘yicha statistikani ko‘rsat", "O‘tgan hafta hisobotini tayyorla", "Ish grafiklarini ko‘rsat"];
/** Amal namunalari — yuborilmaydi, maydonga yoziladi (foydalanuvchi qiymatni o‘zgartiradi). */
const DO = ["ID E-1001 bugun 08:30 da keldi", "ID E-1001 oyligini 5 000 000 so‘m qil", "«Kechki smena» grafigini 14:00–23:00 qilib yarat"];
const PROVIDER: Record<string, string> = { OPENAI: "OpenAI", GEMINI: "Gemini", ANTHROPIC: "Claude", GROQ: "Groq", STAFFORA: "Staffora" };
const clock = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });

export function StafforaAI() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [status, setStatus] = useState<AiStatus>();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [lastFailed, setLastFailed] = useState("");
  const [pending, setPending] = useState<PendingAction>();
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api<AiStatus>("/ai/status"));
    } catch {
      setStatus({ enabled: false, configured: false, ready: false, canManage: false, providers: [] });
    }
  }, []);
  const loadConversations = useCallback(async () => {
    try {
      setConversations(await api<Conversation[]>("/ai/conversations"));
    } catch {
      setConversations([]);
    }
  }, []);
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);
  useEffect(() => {
    if (!open) return;
    void Promise.all([loadConversations(), loadStatus()]);
    const timer = window.setTimeout(() => input.current?.focus({ preventScroll: true }), 220);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, loadConversations, loadStatus]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, pending, busy, error]);
  // Maydon balandligi matnga moslashadi (5 qatorgacha).
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 124)}px`;
  }, [text]);

  async function openConversation(id: string) {
    setBusy(true);
    setError("");
    try {
      const row = await api<Conversation & { messages: Message[] }>(`/ai/conversations/${id}`);
      setConversationId(id);
      setMessages(row.messages.filter((m) => m.role === "USER" || m.role === "ASSISTANT"));
      setPending(undefined);
      setView("chat");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  async function send(event?: FormEvent, message = text) {
    event?.preventDefault();
    const clean = message.trim();
    if (!clean || busy) return;
    if (!status?.ready) {
      setError("Staffora AI hali sozlanmagan.");
      return;
    }
    setBusy(true);
    setError("");
    setLastFailed("");
    setText("");
    setView("chat");
    setMessages((old) => [...old, { id: crypto.randomUUID(), role: "USER", text: clean, createdAt: new Date().toISOString() }]);
    try {
      const result = await post<ChatResult>("/ai/chat", { conversationId, message: clean }, { timeoutMs: 60_000 });
      setConversationId(result.conversationId);
      setMessages((old) => [...old, result.message]);
      setPending(result.pendingAction || undefined);
      void loadConversations();
    } catch (reason) {
      setLastFailed(clean);
      setError(errorText(reason));
      void loadStatus();
    } finally {
      setBusy(false);
    }
  }
  async function decide(confirm: boolean) {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      let reply = "Bekor qilindi — bazaga hech narsa yozilmadi.";
      if (confirm) reply = `✅ ${(await post<ActionResult>(`/ai/actions/${pending.id}/confirm`, { confirmationToken: pending.confirmationToken })).result?.message || "Bajarildi va bazada tekshirildi."}`;
      else await post(`/ai/actions/${pending.id}/cancel`, {});
      setMessages((old) => [...old, { id: crypto.randomUUID(), role: "ASSISTANT", text: reply, createdAt: new Date().toISOString() }]);
      setPending(undefined);
      void loadConversations();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  function newChat() {
    setConversationId(undefined);
    setMessages([]);
    setPending(undefined);
    setView("chat");
    setError("");
    setLastFailed("");
    input.current?.focus();
  }
  async function removeConversation(id: string) {
    try {
      await del(`/ai/conversations/${id}`);
      if (conversationId === id) newChat();
      await loadConversations();
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  async function dictate() {
    if (recording) {
      recorder.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const media = new MediaRecorder(stream, MediaRecorder.isTypeSupported("audio/webm") ? { mimeType: "audio/webm" } : undefined);
      recorder.current = media;
      media.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      media.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setBusy(true);
        try {
          const blob = new Blob(chunks.current, { type: media.mimeType || "audio/webm" });
          const data = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
          const result = await post<{ text: string }>("/ai/voice/transcribe", { audioBase64: btoa(binary), mimeType: blob.type.split(";")[0] || "audio/webm" }, { timeoutMs: 60_000 });
          setText(result.text);
          input.current?.focus();
        } catch (reason) {
          setError(errorText(reason));
        } finally {
          setBusy(false);
        }
      };
      media.start();
      setRecording(true);
    } catch {
      setError("Mikrofonga ruxsat berilmadi. Brauzer sozlamalaridan ruxsat bering.");
    }
  }

  const ready = status?.ready === true;
  const first = user?.name.split(" ")[0] || "";
  const engine = status?.providers.length ? status.providers.map((p) => PROVIDER[p] || p).join(", ") : "";

  return (
    <>
      <button
        type="button"
        className={`sai-fab ${open ? "open" : ""} ${busy ? "busy" : ""}`}
        aria-label={open ? "Staffora AI’ni yopish" : "Staffora AI"}
        aria-expanded={open}
        data-tip="Staffora AI"
        onClick={() => setOpen(!open)}
      >
        <span className="sai-fab-ring" aria-hidden />
        {open ? <X size={22} className="sai-fab-x" /> : <img src={mark} alt="" className="sai-fab-mark" />}
        {!open && <i className={`sai-dot ${ready ? "on" : "off"}`} aria-hidden />}
      </button>

      {open && (
        <section className="sai-panel" role="dialog" aria-label="Staffora AI yordamchisi">
          <header className="sai-head">
            <img src={mark} alt="" className="sai-head-mark" />
            <div className="sai-head-text">
              <b>Staffora AI</b>
              <small className={ready ? "on" : "off"}>
                <i aria-hidden />
                {ready ? `Tayyor${engine ? ` · ${engine}` : ""}` : status ? "Sozlash kerak" : "Tekshirilmoqda…"}
              </small>
            </div>
            <button type="button" className="sai-icon" title="Yangi suhbat" aria-label="Yangi suhbat" onClick={newChat}>
              <Plus size={18} />
            </button>
            <button type="button" className={`sai-icon ${view === "history" ? "on" : ""}`} title="Suhbatlar tarixi" aria-label="Suhbatlar tarixi" onClick={() => setView(view === "history" ? "chat" : "history")}>
              <History size={17} />
            </button>
            <button type="button" className="sai-icon" title="Yopish" aria-label="Yopish" onClick={() => setOpen(false)}>
              <X size={18} />
            </button>
          </header>

          {view === "history" ? (
            <div className="sai-history">
              <div className="sai-history-head">
                <b>Suhbatlar</b>
                <span>{conversations.length}</span>
              </div>
              {conversations.length ? (
                <ul>
                  {conversations.map((c) => (
                    <li key={c.id} className={c.id === conversationId ? "current" : ""}>
                      <button type="button" onClick={() => void openConversation(c.id)}>
                        <span>{c.title}</span>
                        <small>{new Date(c.updatedAt).toLocaleDateString("ru-RU")}</small>
                      </button>
                      <button type="button" className="sai-icon danger" title="O‘chirish" aria-label="Suhbatni o‘chirish" onClick={() => void removeConversation(c.id)}>
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sai-muted">Suhbatlar hali yo‘q. Savol bering — u shu yerda saqlanadi.</p>
              )}
            </div>
          ) : (
            <>
              <div className="sai-body" ref={scroller}>
                {!messages.length && status && !ready && (
                  <div className="sai-intro">
                    <span className="sai-intro-icon">
                      <Settings2 size={22} />
                    </span>
                    <h3>Staffora AI’ni ulang</h3>
                    <p>
                      {status.configured
                        ? "API kalit saqlangan, lekin AI o‘chirilgan yoki kalit tekshiruvdan o‘tmagan."
                        : "OpenAI, Gemini, Claude yoki Groq kalitini bir marta kiriting — shundan keyin davomat, xodimlar va filiallar haqida so‘rashingiz mumkin."}
                    </p>
                    {status.lastError && <div className="sai-alert">{status.lastError}</div>}
                    {status.canManage ? (
                      <Link className="btn btn-primary" to="/settings/ai" onClick={() => setOpen(false)}>
                        AI sozlamalari <ChevronRight size={15} />
                      </Link>
                    ) : (
                      <p className="sai-muted">Administratoringizdan AI’ni yoqishni so‘rang.</p>
                    )}
                  </div>
                )}
                {!messages.length && ready && (
                  <div className="sai-intro">
                    <img src={mark} alt="" className="sai-intro-mark" />
                    <h3>Assalomu alaykum{first ? `, ${first}` : ""}!</h3>
                    <p>Korxonangiz haqida so‘rang — javob bazadagi real ma’lumotdan. O‘zgartirishlar faqat sizning tasdig‘ingiz bilan bajariladi.</p>
                    <div className="sai-chips" aria-label="Tezkor savollar">
                      {ASK.map((prompt) => (
                        <button key={prompt} type="button" onClick={() => void send(undefined, prompt)}>
                          {prompt}
                        </button>
                      ))}
                    </div>
                    <small className="sai-label">Buyruq namunalari</small>
                    <div className="sai-chips do">
                      {DO.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => {
                            setText(prompt);
                            input.current?.focus();
                          }}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m) =>
                  m.role === "USER" ? (
                    <div key={m.id} className="sai-msg user">
                      <div className="sai-bubble">{m.text}</div>
                      <time>{clock(m.createdAt)}</time>
                    </div>
                  ) : (
                    <div key={m.id} className="sai-msg bot">
                      <img src={mark} alt="" className="sai-avatar" />
                      <div className="sai-msg-col">
                        <div className="sai-bubble">
                          {/* Karta bo‘lsa, matndan faqat sarlavha — raqamlar kartada (matn Telegram va tarix uchun to‘liq saqlanadi). */}
                          <Markdown text={m.card ? m.text.split("\n")[0] : m.text} />
                        </div>
                        {m.card && <ResultCard card={m.card} />}
                        <time>{clock(m.createdAt)}</time>
                      </div>
                    </div>
                  ),
                )}
                {busy && (
                  <div className="sai-msg bot">
                    <img src={mark} alt="" className="sai-avatar thinking" />
                    <div className="sai-msg-col">
                      <div className="sai-bubble sai-typing" aria-live="polite">
                        <i />
                        <i />
                        <i />
                        <span>Ma’lumotlar tekshirilmoqda</span>
                      </div>
                    </div>
                  </div>
                )}
                {pending && (
                  <div className={`sai-confirm ${pending.level === "SENSITIVE" ? "sensitive" : ""}`}>
                    <div className="sai-confirm-head">
                      <span>{pending.level === "SENSITIVE" ? <ShieldAlert size={16} /> : <Check size={16} />}</span>
                      <div>
                        <b>Tasdiqlash kerak</b>
                        <small>{pending.level === "SENSITIVE" ? "Muhim o‘zgartirish" : "Ma’lumot o‘zgartiriladi"}</small>
                      </div>
                    </div>
                    <p>{pending.summary}</p>
                    <small>Ruxsatingiz tekshirildi. Tasdiqlasangiz, o‘zgarish bazaga yoziladi, auditga qayd etiladi va qayta o‘qib tekshiriladi. 10 daqiqa amal qiladi.</small>
                    <div className="sai-confirm-actions">
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void decide(true)}>
                        <Check size={15} /> Tasdiqlash
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={() => void decide(false)}>
                        Bekor qilish
                      </button>
                    </div>
                  </div>
                )}
                {error && (
                  <div className="sai-alert" role="alert">
                    <span>{error}</span>
                    {lastFailed && (
                      <button type="button" onClick={() => void send(undefined, lastFailed)}>
                        <RotateCcw size={13} /> Qayta urinish
                      </button>
                    )}
                  </div>
                )}
              </div>
              <form className="sai-compose" onSubmit={(event) => void send(event)}>
                <textarea
                  ref={input}
                  rows={1}
                  disabled={!ready}
                  placeholder={recording ? "Gapiring… tugatish uchun ■ ni bosing" : ready ? "Savol yoki buyruq yozing…" : "AI ulanganidan keyin yozish mumkin"}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="sai-compose-actions">
                  <button
                    type="button"
                    className={`sai-icon ${recording ? "rec" : ""}`}
                    title={recording ? "Yozishni tugatish" : "Ovoz bilan yozish"}
                    aria-label={recording ? "Yozishni tugatish" : "Ovoz bilan yozish"}
                    disabled={!ready || (busy && !recording)}
                    onClick={() => void dictate()}
                  >
                    {recording ? <Square size={14} /> : <Mic size={17} />}
                  </button>
                  <button type="submit" className="sai-send" aria-label="Yuborish" disabled={!ready || !text.trim() || busy}>
                    <ArrowUp size={17} />
                  </button>
                </div>
              </form>
              <p className="sai-foot">Javoblar faqat sizga ruxsat etilgan ma’lumotlardan · Enter — yuborish</p>
            </>
          )}
        </section>
      )}
    </>
  );
}

function ResultCard({ card }: { card: AiCard }) {
  if (card.kind === "stats")
    return (
      <div className="sai-card">
        <div className="sai-card-head">
          <b>{card.title}</b>
          {card.subtitle && <small>{card.subtitle}</small>}
        </div>
        <div className="sai-stats">
          {card.items.map((item) => (
            <div key={item.label} className={item.tone || "gray"}>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  return (
    <div className="sai-card">
      <div className="sai-card-head">
        <b>{card.title}</b>
        {card.subtitle && <small>{card.subtitle}</small>}
      </div>
      <div className="sai-table">
        <table>
          <thead>
            <tr>
              {card.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, k) => (
                  <td key={k}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {card.more ? <small className="sai-more">va yana {card.more} ta qator</small> : null}
    </div>
  );
}
