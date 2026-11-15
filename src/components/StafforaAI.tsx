import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Bot, Check, ChevronRight, History, Mic, RotateCcw, Send, Settings2, Sparkles, Trash2, Wifi, WifiOff, X } from "lucide-react";
import { api, del, errorText, post } from "../api";

type Message = { id: string; role: "USER" | "ASSISTANT"; text: string; createdAt: string };
type Conversation = { id: string; title: string; updatedAt: string };
type PendingAction = { id: string; name: string; level: "WRITE" | "SENSITIVE"; summary: string; confirmationToken: string };
type ChatResult = { conversationId: string; message: Message; pendingAction?: PendingAction | null };
type ActionResult = { status: string; result?: { message?: string; verified?: boolean } };
type AiStatus = { enabled: boolean; configured: boolean; ready: boolean; canManage: boolean; credentialCount: number; healthyCredentialCount: number; providers: string[]; lastError?: string };

const prompts = ["Bugungi davomatni ko‘rsat", "Kelmagan xodimlar kim?", "Filiallar statistikasini chiqar", "Ish grafiklarini ko‘rsat"];

export function StafforaAI() {
  const [open, setOpen] = useState(false), [historyOpen, setHistoryOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string>(), [messages, setMessages] = useState<Message[]>([]), [conversations, setConversations] = useState<Conversation[]>([]);
  const [status, setStatus] = useState<AiStatus>(), [text, setText] = useState(""), [busy, setBusy] = useState(false), [recording, setRecording] = useState(false);
  const [error, setError] = useState(""), [lastFailed, setLastFailed] = useState(""), [pending, setPending] = useState<PendingAction>();
  const bottom = useRef<HTMLDivElement>(null), recorder = useRef<MediaRecorder | null>(null), chunks = useRef<Blob[]>([]);
  useEffect(() => { if (open) void Promise.all([loadConversations(), loadStatus()]); }, [open]);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages, pending, busy]);

  async function loadStatus() { try { setStatus(await api<AiStatus>("/ai/status")); } catch { setStatus({ enabled: false, configured: false, ready: false, canManage: false, credentialCount: 0, healthyCredentialCount: 0, providers: [] }); } }
  async function loadConversations() { try { setConversations(await api<Conversation[]>("/ai/conversations")); } catch { setConversations([]); } }
  async function openConversation(id: string) { setBusy(true); setError(""); try { const row = await api<Conversation & { messages: Message[] }>(`/ai/conversations/${id}`); setConversationId(id); setMessages(row.messages); setHistoryOpen(false); } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); } }
  async function send(event?: FormEvent, message = text) {
    event?.preventDefault(); const clean = message.trim(); if (!clean || busy) return;
    if (!status?.ready) { setError("Staffora AI hali tayyor emas. Avval tokenni sozlang."); return; }
    setBusy(true); setError(""); setLastFailed(""); setText("");
    setMessages((old) => [...old, { id: crypto.randomUUID(), role: "USER", text: clean, createdAt: new Date().toISOString() }]);
    try { const result = await post<ChatResult>("/ai/chat", { conversationId, message: clean }, { timeoutMs: 60_000 }); setConversationId(result.conversationId); setMessages((old) => [...old, result.message]); setPending(result.pendingAction || undefined); await Promise.all([loadConversations(), loadStatus()]); }
    catch (reason) { setLastFailed(clean); setError(errorText(reason)); await loadStatus(); } finally { setBusy(false); }
  }
  async function decide(confirm: boolean) { if (!pending || busy) return; setBusy(true); setError(""); try { if (confirm) { const result = await post<ActionResult>(`/ai/actions/${pending.id}/confirm`, { confirmationToken: pending.confirmationToken }); setMessages((old) => [...old, { id: crypto.randomUUID(), role: "ASSISTANT", text: result.result?.message || "Amal bajarildi va bazada tekshirildi.", createdAt: new Date().toISOString() }]); } else { await post(`/ai/actions/${pending.id}/cancel`, {}); setMessages((old) => [...old, { id: crypto.randomUUID(), role: "ASSISTANT", text: "Amal bekor qilindi. Bazaga o‘zgarish kiritilmadi.", createdAt: new Date().toISOString() }]); } setPending(undefined); await Promise.all([loadConversations(), loadStatus()]); } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); } }
  function newChat() { setConversationId(undefined); setMessages([]); setPending(undefined); setHistoryOpen(false); setError(""); setLastFailed(""); }
  async function removeConversation(id: string) { try { await del(`/ai/conversations/${id}`); if (conversationId === id) newChat(); await loadConversations(); } catch (reason) { setError(errorText(reason)); } }
  async function dictate() {
    if (recording) { recorder.current?.stop(); setRecording(false); return; }
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); chunks.current = []; const media = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined }); recorder.current = media;
      media.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      media.onstop = async () => { stream.getTracks().forEach((track) => track.stop()); setBusy(true); try { const blob = new Blob(chunks.current, { type: media.mimeType || "audio/webm" }), data = new Uint8Array(await blob.arrayBuffer()); let binary = ""; for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192)); const result = await post<{ text: string }>("/ai/voice/transcribe", { audioBase64: btoa(binary), mimeType: blob.type.split(";")[0] || "audio/webm" }, { timeoutMs: 60_000 }); setText(result.text); } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); } };
      media.start(); setRecording(true);
    } catch { setError("Mikrofonga ruxsat berilmadi."); }
  }
  const ready = status?.ready === true;
  return <>
    <button className={`staffora-ai-fab ${open ? "active" : ""}`} aria-label="Staffora AI" onClick={() => setOpen(!open)}><span className="ai-mark"><Sparkles size={18} /></span><span className="ai-fab-label">Staffora AI</span><i className={ready ? "online" : "offline"} /></button>
    {open && <section className="staffora-ai-panel" aria-label="Staffora AI yordamchisi">
      <header><div className="ai-head-mark"><Sparkles /></div><div><b>Staffora AI</b><small className={ready ? "ai-online" : "ai-offline"}>{ready ? <><Wifi /> Ishlashga tayyor</> : <><WifiOff /> Sozlash talab qilinadi</>}</small></div><button className={`icon-btn ${historyOpen ? "active" : ""}`} title="Tarix" onClick={() => setHistoryOpen(!historyOpen)}><History size={18} /></button><button className="icon-btn" title="Yangi suhbat" onClick={newChat}>+</button><button className="icon-btn" aria-label="Yopish" onClick={() => setOpen(false)}><X size={19} /></button></header>
      {historyOpen ? <div className="ai-history"><div className="ai-history-title"><b>Suhbatlar</b><span>{conversations.length}</span></div>{conversations.length ? conversations.map((conversation) => <div key={conversation.id}><button onClick={() => void openConversation(conversation.id)}><span>{conversation.title}</span><small>{new Date(conversation.updatedAt).toLocaleDateString("uz-UZ")}</small></button><button className="icon-btn danger" title="Suhbatni o‘chirish" onClick={() => void removeConversation(conversation.id)}><Trash2 size={14} /></button></div>) : <p>Suhbatlar hali yo‘q.</p>}</div> : <>
        <div className="ai-messages">
          {!messages.length && ready && <div className="ai-welcome"><span><Bot /></span><small>STAFFORA INTELLIGENCE</small><h3>Bugun nimani tahlil qilamiz?</h3><p>Davomat, xodimlar, filiallar va ish jarayonlari bo‘yicha aniq javob oling.</p><div>{prompts.map((prompt) => <button key={prompt} onClick={() => void send(undefined, prompt)}><span>{prompt}</span><ChevronRight /></button>)}</div></div>}
          {!messages.length && status && !ready && <div className="ai-setup-state"><span><Settings2 /></span><small>SOZLASH KERAK</small><h3>Staffora AI’ni ishga tushiring</h3><p>{status.configured ? "Token mavjud, ammo AI o‘chiq yoki token tekshiruvdan o‘tmagan." : "OpenAI, Gemini, Anthropic yoki Groq tokenini bir marta kiriting."}</p>{status.lastError && <div className="ai-setup-error">{status.lastError}</div>}{status.canManage ? <Link className="btn btn-primary" to="/settings/ai" onClick={() => setOpen(false)}>AI sozlamalarini ochish <ChevronRight /></Link> : <p className="muted">Administratoringizdan AI’ni yoqishni so‘rang.</p>}</div>}
          {messages.map((message) => <article key={message.id} className={message.role === "USER" ? "user" : "assistant"}><span>{message.role === "USER" ? "Siz" : <Sparkles size={13} />}</span><div><p>{message.text}</p><small>{new Date(message.createdAt).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}</small></div></article>)}
          {busy && <article className="assistant typing"><span><Sparkles size={13} /></span><div><p><i /><i /><i /></p><small>Tahlil qilinmoqda…</small></div></article>}
          {pending && <div className={`ai-confirm ${pending.level === "SENSITIVE" ? "sensitive" : ""}`}><div className="ai-confirm-head"><span><Check size={15} /></span><div><small>AMAL TAYYOR</small><b>Bitta tasdiq yetarli</b></div></div><div className="ai-confirm-steps"><span className="done"><i>1</i> Tushunildi</span><span><i>2</i> Tasdiqlash</span><span><i>3</i> Bajarish va tekshirish</span></div><p>{pending.summary}</p><small>Ruxsat tekshirildi. Tasdiqdan keyin ma’lumot bazaga yoziladi, auditga qayd etiladi va qayta o‘qib tekshiriladi.</small><div className="ai-confirm-actions"><button className="btn btn-primary" disabled={busy} onClick={() => void decide(true)}><Check size={15} /> Bajarish</button><button className="btn" disabled={busy} onClick={() => void decide(false)}>Bekor qilish</button></div></div>}
          {error && <div className="ai-error"><span>{error}</span>{lastFailed && <button onClick={() => void send(undefined, lastFailed)}><RotateCcw /> Qayta urinish</button>}</div>}<div ref={bottom} />
        </div>
        <form className="ai-compose" onSubmit={(event) => void send(event)}><button type="button" className={`icon-btn ${recording ? "recording" : ""}`} title={recording ? "Yozishni tugatish" : "Ovozli kiritish"} disabled={!ready || busy} onClick={() => void dictate()}><Mic size={18} /></button><textarea rows={1} disabled={!ready} placeholder={recording ? "Tinglayapman…" : ready ? "Staffora AI’ga savol yozing…" : "AI sozlangandan keyin yozishingiz mumkin"} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /><button className="ai-send" disabled={!ready || !text.trim() || busy}><Send size={17} /></button></form><div className="ai-disclaimer">AI javoblari audit va ruxsatlar doirasida ishlaydi.</div>
      </>}
    </section>}
  </>;
}
