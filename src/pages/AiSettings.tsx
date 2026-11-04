import { useEffect, useState, type FormEvent } from "react";
import {
  Bot,
  CheckCircle2,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { del, errorText, post, put } from "../api";
import { useApi } from "../hooks";
import { PageHeader } from "../components/ui";

type Credential = {
  id: string;
  provider: string;
  model: string;
  keyHint: string;
  label?: string;
  active: boolean;
  createdAt: string;
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastError?: string;
};
type Config = {
  enabled: boolean;
  responseLanguage: "uz" | "ru" | "en";
  voiceEnabled: boolean;
  credentials: Credential[];
  dailyTokenLimit?: number;
  monthlyTokenLimit?: number;
};
type BotState = {
  enabled: boolean;
  username?: string;
  status?: string;
  telegramLinked?: boolean;
};
const providerNames: Record<string, string> = {
  OPENAI: "OpenAI",
  GEMINI: "Google Gemini",
  ANTHROPIC: "Anthropic Claude",
  GROQ: "Groq",
};

export function AiSettingsPage() {
  const settings = useApi<Config | null>("/ai/settings");
  const usage = useApi<{
    totals: { inputTokens: number; outputTokens: number };
  }>("/ai/usage");
  const company = useApi<BotState>("/ai/company-bot");
  const [form, setForm] = useState({
    enabled: false,
    responseLanguage: "uz" as Config["responseLanguage"],
    voiceEnabled: false,
    dailyTokenLimit: undefined as number | undefined,
    monthlyTokenLimit: undefined as number | undefined,
  });
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (settings.data)
      setForm({
        enabled: settings.data.enabled,
        responseLanguage: settings.data.responseLanguage,
        voiceEnabled: settings.data.voiceEnabled,
        dailyTokenLimit: settings.data.dailyTokenLimit,
        monthlyTokenLimit: settings.data.monthlyTokenLimit,
      });
  }, [settings.data]);
  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await fn();
      setMessage(ok);
      await Promise.all([
        settings.reload(true),
        usage.reload(true),
        company.reload(true),
      ]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    await run(
      "save",
      () => put("/ai/settings", form),
      "Staffora AI sozlamalari saqlandi.",
    );
  }
  async function addToken(e: FormEvent) {
    e.preventDefault();
    await run(
      "token",
      () => post("/ai/settings/tokens", { token, label: label || undefined }),
      "Token saqlandi, provider avtomatik aniqlandi.",
    );
    setToken("");
    setLabel("");
  }
  const credentials = settings.data?.credentials || [];
  const bot = company.data;
  return (
    <div className="page ai-settings-page ai-settings-v2">
      <PageHeader
        title="Staffora AI"
        subtitle="Tokenni kiriting — provider avtomatik aniqlanadi va ishlaydigan zaxira tokenlar navbat bilan qo‘llanadi"
      />
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice error">{error}</div>}
      <div className="ai-v2-hero">
        <div>
          <span>
            <Sparkles />
          </span>
          <div>
            <h2>Bir AI, barcha Staffora jarayonlari</h2>
            <p>
              Veb-panel va kompaniyangizning mavjud Telegram boti bitta xavfsiz
              AI orchestratoridan foydalanadi.
            </p>
          </div>
        </div>
        <label className="ai-master-switch">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          <span>
            <b>{form.enabled ? "AI yoqilgan" : "AI o‘chiq"}</b>
            <small>
              {form.enabled
                ? "Foydalanuvchilar yordamchidan foydalana oladi"
                : "Tokenlar saqlanadi, lekin so‘rovlar bajarilmaydi"}
            </small>
          </span>
        </label>
      </div>
      <div className="ai-v2-grid">
        <section className="card ai-token-card">
          <div className="card-head">
            <div>
              <h3>
                <KeyRound /> API tokenlar
              </h3>
              <p className="muted">
                OpenAI, Gemini, Anthropic yoki Groq tokeni. Token shifrlanadi va
                qayta ko‘rsatilmaydi.
              </p>
            </div>
            <span className="badge blue">{credentials.length} ta token</span>
          </div>
          <form className="ai-token-form" onSubmit={(e) => void addToken(e)}>
            <label>
              Yangi API token
              <div className="input-icon">
                <KeyRound />
                <input
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  placeholder="Tokenni shu yerga kiriting"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
            </label>
            <label>
              Nom (ixtiyoriy)
              <input
                placeholder="Masalan: asosiy yoki zaxira"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <button className="btn btn-primary" disabled={busy === "token"}>
              <Plus /> {busy === "token" ? "Aniqlanmoqda…" : "Token qo‘shish"}
            </button>
          </form>
          <div className="ai-token-list">
            {credentials.length ? (
              credentials.map((item, index) => (
                <article key={item.id}>
                  <span
                    className={`provider-logo ${item.provider.toLowerCase()}`}
                  >
                    {item.provider[0]}
                  </span>
                  <div>
                    <b>
                      {item.label ||
                        `${providerNames[item.provider] || item.provider} token`}
                    </b>
                    <small>
                      {item.keyHint} · {item.model}
                    </small>
                    <em>{index === 0 ? "Asosiy" : "Zaxira #" + (index + 1)}</em>
                  </div>
                  <span
                    className={`token-health ${item.lastTestOk === false ? "bad" : ""}`}
                  >
                    {item.lastTestOk === false ? (
                      <>
                        <TriangleAlert /> Xato
                      </>
                    ) : item.lastTestOk ? (
                      <>
                        <CheckCircle2 /> Ishlaydi
                      </>
                    ) : (
                      "Tekshirilmagan"
                    )}
                  </span>
                  <button
                    className="btn btn-sm"
                    disabled={busy === item.id}
                    onClick={() =>
                      void run(
                        item.id,
                        () =>
                          post("/ai/providers/test", { credentialId: item.id }),
                        `${providerNames[item.provider]} token ishlayapti.`,
                      )
                    }
                  >
                    <RefreshCw /> Test
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Tokenni o‘chirish"
                    onClick={() =>
                      void run(
                        `delete-${item.id}`,
                        () => del(`/ai/settings/tokens/${item.id}`),
                        "Token o‘chirildi.",
                      )
                    }
                  >
                    <Trash2 />
                  </button>
                </article>
              ))
            ) : (
              <div className="ai-token-empty">
                <KeyRound />
                <b>Hali token qo‘shilmagan</b>
                <span>
                  Yuqoriga token kiriting. Provider va modelni Staffora
                  avtomatik tanlaydi.
                </span>
              </div>
            )}
          </div>
        </section>
        <aside className="ai-v2-side">
          <section className="card">
            <h3>
              <Bot /> Telegram
            </h3>
            {bot?.enabled && bot.username ? (
              <div className="existing-bot">
                <span>
                  <Bot />
                </span>
                <div>
                  <b>@{bot.username}</b>
                  <small>{bot.status || "Ulangan"}</small>
                </div>
                <CheckCircle2 />
              </div>
            ) : (
              <div className="existing-bot missing">
                <span>
                  <Bot />
                </span>
                <div>
                  <b>Kompaniya boti ulanmagan</b>
                  <small>
                    Sozlamalar → Ro‘yxat boti orqali kompaniya botini ulang.
                  </small>
                </div>
              </div>
            )}
            <p className="muted ai-bot-note">
              <ShieldCheck /> Alohida AI bot tokeni kerak emas. Rahbar Telegram
              hisobini Staffora bilan ulagan bo‘lsa, mavjud kompaniya boti AI
              so‘rovlarini ham qabul qiladi.
            </p>
          </section>
          <section className="card">
            <h3>Foydalanish</h3>
            <div className="ai-usage">
              <div>
                <small>Kirish tokenlari</small>
                <strong>
                  {usage.data?.totals.inputTokens.toLocaleString() || 0}
                </strong>
              </div>
              <div>
                <small>Javob tokenlari</small>
                <strong>
                  {usage.data?.totals.outputTokens.toLocaleString() || 0}
                </strong>
              </div>
            </div>
          </section>
        </aside>
      </div>
      <form className="card ai-behavior" onSubmit={(e) => void save(e)}>
        <div>
          <h3>Javob va limitlar</h3>
          <p className="muted">AI xarajatini va tilini boshqaring.</p>
        </div>
        <label>
          Javob tili
          <select
            value={form.responseLanguage}
            onChange={(e) =>
              setForm({
                ...form,
                responseLanguage: e.target.value as Config["responseLanguage"],
              })
            }
          >
            <option value="uz">O‘zbekcha</option>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          Kunlik token
          <input
            type="number"
            min="1000"
            placeholder="Cheklanmagan"
            value={form.dailyTokenLimit || ""}
            onChange={(e) =>
              setForm({
                ...form,
                dailyTokenLimit: e.target.value
                  ? Number(e.target.value)
                  : undefined,
              })
            }
          />
        </label>
        <label>
          Oylik token
          <input
            type="number"
            min="1000"
            placeholder="Cheklanmagan"
            value={form.monthlyTokenLimit || ""}
            onChange={(e) =>
              setForm({
                ...form,
                monthlyTokenLimit: e.target.value
                  ? Number(e.target.value)
                  : undefined,
              })
            }
          />
        </label>
        <label className="switch-row field-switch">
          <input
            type="checkbox"
            checked={form.voiceEnabled}
            onChange={(e) =>
              setForm({ ...form, voiceEnabled: e.target.checked })
            }
          />
          <span>Ovozli kiritish</span>
        </label>
        <button className="btn btn-primary" disabled={busy === "save"}>
          {busy === "save" ? "Saqlanmoqda…" : "Sozlamalarni saqlash"}
        </button>
      </form>
    </div>
  );
}
