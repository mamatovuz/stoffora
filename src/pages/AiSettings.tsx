import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Bot, Check, CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, Lock, Mic, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { del, errorText, post, put } from "../api";
import { useApi } from "../hooks";
import { Confirm, useToast } from "../components/ui";
import mark from "../assets/staffora-mark.svg";

/*
 * Staffora AI sozlamalari: 1) provayder va API kalit → 2) avtomatik real tekshiruv → 3) yoqish.
 * Kalit serverda shifrlanadi va hech qachon qaytarilmaydi (faqat oxirgi belgilar). Bir nechta kalit
 * bo‘lsa — birinchisi ishlamasa keyingisi avtomatik ishlatiladi.
 */
type Credential = { id: string; provider: string; model: string; keyHint: string; label?: string; active: boolean; createdAt: string; lastTestAt?: string; lastTestOk?: boolean; lastError?: string };
type Config = { enabled: boolean; responseLanguage: "uz" | "ru" | "en"; voiceEnabled: boolean; credentials: Credential[]; dailyTokenLimit?: number; monthlyTokenLimit?: number };
type BotState = { enabled: boolean; username?: string; status?: string; telegramLinked?: boolean };
type AiStatus = { enabled: boolean; configured: boolean; ready: boolean; credentialCount: number; healthyCredentialCount: number; untestedCredentialCount: number; providers: string[]; currentModel?: string; lastCheckedAt?: string; lastError?: string };
type Usage = { totals: { inputTokens: number; outputTokens: number } };

const PROVIDERS = [
  { key: "OPENAI", name: "OpenAI", prefix: "sk-", url: "https://platform.openai.com/api-keys", note: "GPT modellari · ovoz" },
  { key: "GEMINI", name: "Google Gemini", prefix: "AIza", url: "https://aistudio.google.com/app/apikey", note: "Bepul kvota mavjud" },
  { key: "ANTHROPIC", name: "Anthropic Claude", prefix: "sk-ant-", url: "https://console.anthropic.com/settings/keys", note: "Aniq tahlil" },
  { key: "GROQ", name: "Groq", prefix: "gsk_", url: "https://console.groq.com/keys", note: "Juda tez · ovoz" },
] as const;
const nameOf = (key: string) => PROVIDERS.find((p) => p.key === key)?.name || key;
const detect = (token: string) => (token.startsWith("gsk_") ? "GROQ" : token.startsWith("sk-ant-") ? "ANTHROPIC" : token.startsWith("AIza") ? "GEMINI" : token.startsWith("sk-") ? "OPENAI" : "");
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const num = (n = 0) => n.toLocaleString("ru-RU").replace(/\s/g, " ");

export function AiSettingsPage() {
  const toast = useToast();
  const settings = useApi<Config | null>("/ai/settings");
  const usage = useApi<Usage>("/ai/usage");
  const company = useApi<BotState>("/ai/company-bot");
  const status = useApi<AiStatus>("/ai/status");
  const [form, setForm] = useState({ responseLanguage: "uz" as Config["responseLanguage"], voiceEnabled: false, dailyTokenLimit: undefined as number | undefined, monthlyTokenLimit: undefined as number | undefined });
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [label, setLabel] = useState("");
  const [picked, setPicked] = useState<string>("GEMINI");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<Credential | null>(null);
  const credentials = useMemo(() => settings.data?.credentials || [], [settings.data]);
  const detected = detect(token.trim());
  const provider = PROVIDERS.find((p) => p.key === (detected || picked)) || PROVIDERS[1];
  const s = status.data;

  useEffect(() => {
    if (!settings.data) return;
    setEnabled(settings.data.enabled);
    setForm({ responseLanguage: settings.data.responseLanguage, voiceEnabled: settings.data.voiceEnabled, dailyTokenLimit: settings.data.dailyTokenLimit, monthlyTokenLimit: settings.data.monthlyTokenLimit });
  }, [settings.data]);
  useEffect(() => {
    if (detected) setPicked(detected);
  }, [detected]);
  const reloadAll = () => Promise.all([settings.reload(true), usage.reload(true), company.reload(true), status.reload(true)]);

  async function addToken(e: FormEvent) {
    e.preventDefault();
    setBusy("token");
    setError("");
    let saved = false;
    try {
      const created = await post<Config>("/ai/settings/tokens", { token: token.trim(), label: label.trim() || undefined });
      saved = true;
      const fresh = created.credentials.find((item) => !credentials.some((old) => old.id === item.id));
      if (fresh) await post("/ai/providers/test", { credentialId: fresh.id }, { timeoutMs: 60_000 });
      toast(`${fresh ? nameOf(fresh.provider) : "API"} kaliti tekshirildi — Staffora AI tayyor`);
      setToken("");
      setLabel("");
      setShow(false);
    } catch (reason) {
      setError(saved ? `Kalit saqlandi, lekin tekshiruvdan o‘tmadi: ${errorText(reason)}` : errorText(reason));
    } finally {
      await reloadAll();
      setBusy("");
    }
  }
  async function testOne(item: Credential) {
    setBusy(item.id);
    setError("");
    try {
      await post("/ai/providers/test", { credentialId: item.id }, { timeoutMs: 60_000 });
      toast(`${nameOf(item.provider)} kaliti ishlayapti`);
    } catch (reason) {
      setError(`${nameOf(item.provider)}: ${errorText(reason)}`);
    } finally {
      await reloadAll();
      setBusy("");
    }
  }
  async function toggle(next: boolean) {
    setBusy("toggle");
    setError("");
    setEnabled(next);
    try {
      await put("/ai/settings", { ...form, enabled: next });
      toast(next ? "Staffora AI yoqildi" : "Staffora AI vaqtincha o‘chirildi");
      await reloadAll();
    } catch (reason) {
      setEnabled(!next);
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError("");
    try {
      await put("/ai/settings", { ...form, enabled });
      toast("Sozlamalar saqlandi");
      await reloadAll();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  }

  const hasKey = credentials.length > 0;
  const tested = credentials.some((c) => c.lastTestOk);
  const voiceProvider = credentials.some((c) => c.provider === "OPENAI" || c.provider === "GROQ");
  const used = (usage.data?.totals.inputTokens || 0) + (usage.data?.totals.outputTokens || 0);
  const steps: [string, string, "done" | "now" | ""][] = [
    ["API kalit qo‘shing", hasKey ? `${credentials.length} ta kalit saqlangan` : "Pastdagi formada", hasKey ? "done" : "now"],
    ["Avtomatik tekshiruv", tested ? "Kalit ishlayapti" : hasKey ? "Kalitni tekshiring" : "Qo‘shilganda o‘zi bajariladi", tested ? "done" : hasKey ? "now" : ""],
    ["AI’ni yoqing", enabled ? "Yoqilgan" : "Yuqoridagi tugma bilan", enabled ? "done" : hasKey ? "now" : ""],
  ];

  return (
    <div className="page tp-page as-page">
      <header className="tp-head">
        <div className="as-title">
          <img src={mark} alt="" />
          <div>
            <h1>Staffora AI</h1>
            <p>Korxonangiz uchun aqlli yordamchi — veb-panel va Telegram botda bir xil ishlaydi</p>
          </div>
        </div>
        <label className={`as-switch ${enabled ? "on" : ""}`} title={!hasKey ? "Avval API kalit qo‘shing" : undefined}>
          <input type="checkbox" role="switch" checked={enabled} disabled={!hasKey || busy === "toggle"} onChange={(e) => void toggle(e.target.checked)} />
          <i aria-hidden />
          <span>
            <b>{enabled ? "Yoqilgan" : "O‘chiq"}</b>
            <small>{enabled ? "Rahbarlar AI’dan foydalana oladi" : hasKey ? "Yoqish uchun bosing" : "Avval kalit qo‘shing"}</small>
          </span>
        </label>
      </header>

      <section className={`as-status ${s?.ready ? "ready" : ""}`} aria-label="Sozlash bosqichlari">
        {steps.map(([title, note, state], i) => (
          <div key={title} className={`as-step ${state}`}>
            <span>{state === "done" ? <Check size={14} /> : i + 1}</span>
            <div>
              <b>{title}</b>
              <small>{note}</small>
            </div>
          </div>
        ))}
        <div className="as-state">
          <i className={s?.ready ? "on" : "off"} />
          <span>
            <b>{s?.ready ? "Ishlashga tayyor" : "Hali tayyor emas"}</b>
            <small>{s?.ready ? `${s.providers.map(nameOf).join(", ")}${s.currentModel ? ` · ${s.currentModel}` : ""}` : s?.lastError || "Bosqichlarni yakunlang"}</small>
          </span>
        </div>
      </section>

      {error && (
        <div className="as-error" role="alert">
          <TriangleAlert size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="as-grid">
        <section className="tp-card">
          <div className="tp-card-head">
            <div className="tp-title">
              <h2>API kalitlar</h2>
              <span className="tp-muted">bir nechtasi bo‘lsa — zaxira sifatida navbat bilan ishlatiladi</span>
            </div>
          </div>
          <div className="as-providers" role="radiogroup" aria-label="Provayder">
            {PROVIDERS.map((p) => (
              <button key={p.key} type="button" role="radio" aria-checked={provider.key === p.key} className={`as-provider ${provider.key === p.key ? "on" : ""}`} onClick={() => setPicked(p.key)}>
                <span className={`as-logo ${p.key.toLowerCase()}`}>{p.name[0]}</span>
                <span>
                  <b>{p.name}</b>
                  <small>{p.note}</small>
                </span>
                {credentials.some((c) => c.provider === p.key) && <CheckCircle2 size={15} className="as-has" aria-label="Kalit bor" />}
              </button>
            ))}
          </div>
          <form className="as-form" onSubmit={(e) => void addToken(e)}>
            <div className="as-guide">
              <b>{provider.name} kalitini olish</b>
              <ol>
                <li>
                  <a href={provider.url} target="_blank" rel="noreferrer">
                    {provider.url.replace("https://", "")} <ExternalLink size={12} />
                  </a>{" "}
                  sahifasini oching va tizimga kiring.
                </li>
                <li>«Create API key» tugmasini bosing va kalitni nusxalang.</li>
                <li>
                  Kalitni pastga joylang — u <code>{provider.prefix}…</code> bilan boshlanadi.
                </li>
              </ol>
            </div>
            <label className="as-field">
              <span>API kalit</span>
              <div className={`as-input ${detected ? "ok" : ""}`}>
                <KeyRound size={16} aria-hidden />
                <input
                  type={show ? "text" : "password"}
                  required
                  minLength={12}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={`${provider.prefix}••••••••••••••••`}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <button type="button" className="as-eye" aria-label={show ? "Kalitni yashirish" : "Kalitni ko‘rsatish"} onClick={() => setShow(!show)}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {token && <small className={detected ? "as-detected" : "as-unknown"}>{detected ? `✓ ${nameOf(detected)} kaliti aniqlandi` : "Prefiks tanish emas — saqlashda real so‘rov bilan aniqlanadi"}</small>}
            </label>
            <label className="as-field">
              <span>Nomi (ixtiyoriy)</span>
              <input className="input" maxLength={80} placeholder="Masalan: asosiy kalit" value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
            <div className="as-form-foot">
              <span className="as-secure">
                <Lock size={13} /> Kalit shifrlangan holda saqlanadi va qayta ko‘rsatilmaydi
              </span>
              <button className="btn btn-primary" disabled={busy === "token" || token.trim().length < 12}>
                {busy === "token" ? <RefreshCw size={15} className="spin" /> : <ShieldCheck size={15} />}
                {busy === "token" ? "Tekshirilmoqda…" : "Qo‘shish va tekshirish"}
              </button>
            </div>
          </form>
          {credentials.length > 0 && (
            <ul className="as-keys">
              {credentials.map((item, index) => (
                <li key={item.id}>
                  <span className={`as-logo ${item.provider.toLowerCase()}`}>{nameOf(item.provider)[0]}</span>
                  <span className="as-key-text">
                    <b>
                      {item.label || nameOf(item.provider)}
                      <em>{index === 0 ? "Asosiy" : `Zaxira ${index}`}</em>
                    </b>
                    <small>
                      {item.keyHint.split(" · ")[0]} · {item.model}
                      {item.lastTestAt ? ` · tekshirildi ${when(item.lastTestAt)}` : ""}
                    </small>
                    {item.lastTestOk === false && item.lastError && <small className="as-key-error">{item.lastError}</small>}
                  </span>
                  <span className={`tp-badge ${item.lastTestOk ? "green" : item.lastTestOk === false ? "red" : "gray"}`}>{item.lastTestOk ? "Ishlaydi" : item.lastTestOk === false ? "Xato" : "Tekshirilmagan"}</span>
                  <button type="button" className="btn btn-sm" disabled={busy === item.id} onClick={() => void testOne(item)}>
                    <RefreshCw size={14} className={busy === item.id ? "spin" : ""} /> Tekshirish
                  </button>
                  <button type="button" className="as-del" aria-label="Kalitni o‘chirish" title="O‘chirish" onClick={() => setRemoving(item)}>
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="as-side">
          <form className="tp-card" onSubmit={(e) => void save(e)}>
            <div className="tp-card-head">
              <div className="tp-title">
                <h2>Javob sozlamalari</h2>
              </div>
            </div>
            <div className="as-prefs-body">
              <label className="as-field">
                <span>Javob tili</span>
                <select className="input" value={form.responseLanguage} onChange={(e) => setForm({ ...form, responseLanguage: e.target.value as Config["responseLanguage"] })}>
                  <option value="uz">O‘zbekcha</option>
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className={`as-check ${!voiceProvider ? "muted" : ""}`}>
                <input type="checkbox" checked={form.voiceEnabled} onChange={(e) => setForm({ ...form, voiceEnabled: e.target.checked })} />
                <span>
                  <b>
                    <Mic size={14} /> Ovozli buyruqlar
                  </b>
                  <small>{voiceProvider ? "Mikrofon va Telegram ovozli xabarlari" : "OpenAI yoki Groq kaliti kerak"}</small>
                </span>
              </label>
              <div className="as-limits">
                <label className="as-field">
                  <span>Kunlik limit (token)</span>
                  <input className="input" type="number" min="1000" step="1000" placeholder="Cheklanmagan" value={form.dailyTokenLimit || ""} onChange={(e) => setForm({ ...form, dailyTokenLimit: e.target.value ? Number(e.target.value) : undefined })} />
                </label>
                <label className="as-field">
                  <span>Oylik limit (token)</span>
                  <input className="input" type="number" min="1000" step="1000" placeholder="Cheklanmagan" value={form.monthlyTokenLimit || ""} onChange={(e) => setForm({ ...form, monthlyTokenLimit: e.target.value ? Number(e.target.value) : undefined })} />
                </label>
              </div>
              <button className="btn btn-primary" disabled={busy === "save"}>
                {busy === "save" ? "Saqlanmoqda…" : "Saqlash"}
              </button>
            </div>
          </form>
          <section className="tp-card">
            <div className="tp-card-head">
              <div className="tp-title">
                <h2>Foydalanish</h2>
                <span className="tp-muted">jami token</span>
              </div>
            </div>
            <div className="as-usage">
              <div>
                <small>Savollar (kirish)</small>
                <strong>{num(usage.data?.totals.inputTokens)}</strong>
              </div>
              <div>
                <small>Javoblar (chiqish)</small>
                <strong>{num(usage.data?.totals.outputTokens)}</strong>
              </div>
              {form.monthlyTokenLimit ? (
                <div className="wide">
                  <small>Oylik limitdan</small>
                  <span className="tp-meter">
                    <i className={used / form.monthlyTokenLimit > 0.9 ? "red" : "blue"} style={{ width: `${Math.min(100, (used / form.monthlyTokenLimit) * 100)}%` }} />
                  </span>
                </div>
              ) : null}
            </div>
            <p className="as-note">Tayyor savollar (davomat, kechikkanlar, filiallar, haftalik hisobot) bazadan javob oladi — provayderga yuborilmaydi va token sarflamaydi.</p>
          </section>
          <section className="tp-card">
            <div className="tp-card-head">
              <div className="tp-title">
                <h2>Telegram</h2>
              </div>
            </div>
            <div className={`as-bot ${company.data?.enabled ? "on" : ""}`}>
              <span>
                <Bot size={17} />
              </span>
              <div>
                <b>{company.data?.enabled && company.data.username ? `@${company.data.username}` : "Kompaniya boti ulanmagan"}</b>
                <small>
                  {company.data?.enabled ? (company.data.telegramLinked ? "Sizning Telegram’ingiz ulangan" : "Telegram hisobingizni profilda ulang") : "Sozlamalar → Ro‘yxat boti bo‘limida ulang"}
                </small>
              </div>
            </div>
            <p className="as-note">Alohida AI bot kerak emas: kompaniya boti rahbarlarning savollariga ham Staffora AI orqali javob beradi.</p>
          </section>
        </aside>
      </div>

      {removing && (
        <Confirm
          title="Kalit o‘chirilsinmi?"
          text={`${removing.label || nameOf(removing.provider)} (${removing.keyHint.split(" · ")[0]}) o‘chiriladi. ${credentials.length === 1 ? "Bu yagona kalit — Staffora AI o‘chib qoladi." : "Qolgan kalitlar ishlashda davom etadi."}`}
          confirmLabel="O‘chirish"
          danger
          onConfirm={async () => {
            await del(`/ai/settings/tokens/${removing.id}`);
            toast("Kalit o‘chirildi");
            await reloadAll();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
