import { useEffect, useState, type ReactNode } from "react";
import { Download, FileDown, Languages, Plus, Save, Trash2 } from "lucide-react";
import { del, post, put } from "../../api";
import { useApi, usePolling } from "../../hooks";
import { Field, Modal, PageHeader, useToast } from "../../components/ui";
import type { PlatformSettings } from "@/lib/platform/types";
import {
  DataTable,
  ErrorState,
  NoAccess,
  Pager,
  PermissionGuard,
  SearchInput,
  Section,
  Select,
  Skeleton,
  StatusBadge,
  ago,
  dateTime,
  downloadFile,
  num,
  useAction,
  usePlatform,
} from "./kit";

/*
 * Tizim: tillar (tarjima override’lari, topilmagan matnlar), global sozlamalar (xavfli bo‘limlar — parol bilan),
 * eksportlar (fon ishida tayyorlanadi, 24 soat ichida faqat yaratgan administrator yuklab oladi).
 */

/* ================================================================= tillar === */
type LanguagesData = {
  languages: { code: string; label: string; base: boolean; enabled: boolean; default: boolean; overrides?: number; missing?: number }[];
  overrides: { id: string; lang: string; source: string; text: string; updatedAt: string; updatedBy: string }[];
  missing: { lang: string; text: string; count: number; lastSeen: string }[];
};

function LanguagesView() {
  const toast = useToast();
  const run = useAction();
  const { data, error, reload } = useApi<LanguagesData>("/super-admin/languages");
  const [editing, setEditing] = useState<{ source: string; text: string } | null>(null);
  const [filter, setFilter] = useState("");
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton rows={8} />;
  const text = filter.toLowerCase();
  const overrides = data.overrides.filter((o) => !text || `${o.source} ${o.text}`.toLowerCase().includes(text));
  return (
    <>
      <PageHeader
        title="Tillar va tarjimalar"
        subtitle="Asosiy til — o‘zbekcha. Ruscha tarjimani shu yerdan aniqlashtirish mumkin: o‘zgarish panel va Mini App’da 5 daqiqada ko‘rinadi."
        actions={
          <PermissionGuard perm="settings.manage">
            <button className="btn btn-primary" onClick={() => setEditing({ source: "", text: "" })}>
              <Plus size={15} /> Tarjima qo‘shish
            </button>
          </PermissionGuard>
        }
      />
      <div className="sa-lang-cards">
        {data.languages.map((l) => (
          <div key={l.code} className="card sa-lang-card">
            <Languages size={18} />
            <span className="stack">
              <b>{l.label}</b>
              <small>
                {l.base ? "Asosiy til" : `${num(l.overrides || 0)} override · ${num(l.missing || 0)} topilmagan matn`}
                {l.default ? " · standart" : ""}
              </small>
            </span>
            <StatusBadge value={l.enabled ? "ACTIVE" : "DISABLED"} label={l.enabled ? "Yoqilgan" : "O‘chiq"} />
          </div>
        ))}
      </div>

      <Section title="Tarjimasi topilmagan matnlar" subtitle="Panel foydalanuvchilari ruscha rejimda ko‘rgan, lug‘atda yo‘q matnlar (shaxsiy ma’lumot saqlanmaydi)">
        <DataTable
          rows={data.missing.filter((m) => m.lang === "ru").slice(0, 100)}
          rowKey={(m) => m.text}
          empty={<p className="muted sa-empty">Hozircha topilmagan matn yo‘q</p>}
          columns={[
            { key: "t", label: "Matn", render: (m) => <span className="sa-ellipsis">{m.text}</span> },
            { key: "c", label: "Necha marta", className: "num", render: (m) => num(m.count) },
            { key: "l", label: "Oxirgi marta", hideOnMobile: true, render: (m) => ago(m.lastSeen) },
            {
              key: "a",
              label: "",
              className: "sa-row-actions",
              render: (m) => (
                <PermissionGuard perm="settings.manage">
                  <button className="btn btn-sm" onClick={() => setEditing({ source: m.text, text: "" })}>
                    Tarjima qilish
                  </button>
                </PermissionGuard>
              ),
            },
          ]}
        />
      </Section>

      <Section title="Tarjima override’lari (ruscha)" actions={<SearchInput value={filter} onChange={setFilter} placeholder="Matn bo‘yicha qidirish…" />}>
        <DataTable
          rows={overrides}
          rowKey={(o) => o.id}
          empty={<p className="muted sa-empty">Override yo‘q — standart lug‘at ishlatiladi</p>}
          onRowClick={(o) => setEditing({ source: o.source, text: o.text })}
          columns={[
            { key: "s", label: "O‘zbekcha", render: (o) => o.source },
            { key: "t", label: "Ruscha", render: (o) => <b>{o.text}</b> },
            { key: "u", label: "O‘zgartirgan", hideOnMobile: true, render: (o) => <span className="muted">{o.updatedBy} · {ago(o.updatedAt)}</span> },
            {
              key: "a",
              label: "",
              className: "sa-row-actions",
              render: (o) => (
                <PermissionGuard perm="settings.manage">
                  <button
                    className="icon-btn"
                    aria-label="O‘chirish"
                    onClick={(e) => {
                      e.stopPropagation();
                      void run(() => del(`/super-admin/translations/${o.id}`), toast, "Override o‘chirildi").then(() => reload(true));
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </PermissionGuard>
              ),
            },
          ]}
        />
      </Section>

      {editing && (
        <Modal title="Ruscha tarjima" subtitle="Matn aynan paneldagidek bo‘lishi kerak (katta-kichik harf, tinish belgilari)" onClose={() => setEditing(null)} size="narrow">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(() => post("/super-admin/translations", { lang: "ru", source: editing.source.trim(), text: editing.text.trim() }), toast, "Tarjima saqlandi");
              if (ok) {
                setEditing(null);
                void reload(true);
              }
            }}
          >
            <Field label="O‘zbekcha matn">
              <textarea className="textarea" rows={2} value={editing.source} onChange={(e) => setEditing({ ...editing, source: e.target.value })} required maxLength={300} />
            </Field>
            <Field label="Ruscha tarjima">
              <textarea className="textarea" rows={2} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} required maxLength={500} autoFocus />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Bekor qilish
              </button>
              <button className="btn btn-primary" disabled={!editing.source.trim() || !editing.text.trim()}>
                <Save size={15} /> Saqlash
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/* ============================================================== sozlamalar === */
type SettingsData = { settings: PlatformSettings; environment: Record<string, boolean | string | null> };

const ENV_LABELS: Record<string, string> = {
  DATABASE_URL: "Tashqi baza (Postgres/Supabase)",
  TELEGRAM_BOT_TOKEN: "Telegram bot tokeni",
  SESSION_SECRET: "SESSION_SECRET (≥ 32 belgi)",
  JWT_SECRET: "JWT_SECRET (≥ 32 belgi)",
  COOKIE_SECURE: "COOKIE_SECURE=true (HTTPS)",
  RAILWAY_VOLUME_MOUNT_PATH: "Doimiy disk (zaxira nusxalar uchun)",
  RAILWAY_API_TOKEN: "Railway API tokeni (ixtiyoriy)",
  APP_URL: "Ilova manzili (APP_URL)",
  EMAIL: "Email yuborish xizmati",
};

/** Raqamli maydon: bo‘sh — standart qiymat (server tomonda). */
function NumberField({ label, value, onChange, placeholder, min, max, step, hint }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; placeholder: string; min: number; max: number; step?: number; hint?: ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      <input
        className="input"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step || 1}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </Field>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="sa-toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="sa-toggle-track" aria-hidden />
      <span className="stack">
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

const DANGEROUS = new Set(["session", "retention", "supportAccessEnabled", "requireAdminMfa", "backups"]);

function SettingsView() {
  const toast = useToast();
  const run = useAction();
  const { can } = usePlatform();
  const { data, error, reload } = useApi<SettingsData>("/super-admin/settings");
  const [form, setForm] = useState<PlatformSettings | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => {
    if (data) setForm(JSON.parse(JSON.stringify(data.settings)) as PlatformSettings);
  }, [data]);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data || !form) return <Skeleton rows={12} />;
  const readOnly = !can("settings.manage");
  const s = form;
  const set = <K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) => setForm({ ...s, [key]: value });
  const sub = <K extends keyof PlatformSettings>(key: K, patchValue: Partial<NonNullable<PlatformSettings[K]>>) => setForm({ ...s, [key]: { ...((s[key] as object) || {}), ...patchValue } });
  const dirty = (keys: (keyof PlatformSettings)[]) => keys.some((k) => JSON.stringify(s[k] ?? null) !== JSON.stringify(data.settings[k] ?? null));

  /** Bo‘limni saqlash: faqat shu bo‘lim kalitlari yuboriladi (undefined → JSONdan tushib qoladi). */
  const save = async (section: string, keys: (keyof PlatformSettings)[]) => {
    const body = Object.fromEntries(keys.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
    setSaving(section);
    const ok = await run(() => put("/super-admin/settings", body), toast, "Sozlamalar saqlandi");
    setSaving(null);
    if (ok) void reload(true);
  };
  const saveBar = (section: string, keys: (keyof PlatformSettings)[]) =>
    readOnly ? null : (
      <div className="sa-save-bar">
        {keys.some((k) => DANGEROUS.has(k)) && <small className="muted">Bu bo‘lim xavfli — saqlashda parol so‘raladi.</small>}
        <button className="btn btn-primary btn-sm" disabled={!dirty(keys) || saving !== null} onClick={() => void save(section, keys)}>
          <Save size={14} /> {saving === section ? "Saqlanmoqda…" : "Saqlash"}
        </button>
      </div>
    );

  const m = s.maintenance || { enabled: false, message: "", level: "info" as const };
  const n = s.notifications || {};
  const r = s.retention || {};
  const a = s.alerts || {};
  const b = s.backups || {};
  return (
    <>
      <PageHeader title="Global sozlamalar" subtitle={data.settings.updatedAt ? `Oxirgi o‘zgarish: ${dateTime(data.settings.updatedAt)} · ${data.settings.updatedBy || "—"}` : "Standart qiymatlar ishlatilmoqda"} />
      <fieldset className="sa-fieldset" disabled={readOnly}>
        <div className="sa-grid-2">
          <Section title="Platforma">
            <Field label="Platforma nomi">
              <input className="input" value={s.platformName || ""} placeholder="Staffora" onChange={(e) => set("platformName", e.target.value)} maxLength={60} />
            </Field>
            <div className="sa-form-row">
              <Field label="Standart vaqt mintaqasi">
                <input className="input" value={s.defaultTimezone || ""} placeholder="Asia/Tashkent" onChange={(e) => set("defaultTimezone", e.target.value)} />
              </Field>
              <Field label="Hisobot vaqt mintaqasi">
                <input className="input" value={s.reportingTimezone || ""} placeholder="Asia/Tashkent" onChange={(e) => set("reportingTimezone", e.target.value)} />
              </Field>
            </div>
            <div className="sa-form-row">
              <Field label="Standart til">
                <select className="select" value={s.defaultLanguage || "uz"} onChange={(e) => set("defaultLanguage", e.target.value as "uz" | "ru")}>
                  <option value="uz">O‘zbekcha</option>
                  <option value="ru">Русский</option>
                </select>
              </Field>
              <NumberField label="Sinov muddati (kun)" value={s.trialDays} onChange={(v) => set("trialDays", v)} placeholder="tarifdagi qiymat" min={0} max={365} hint="Kompaniya «Sinov»ga o‘tkazilganda" />
            </div>
            <NumberField label="Yuklanadigan fayl hajmi (MB)" value={s.uploads?.maxMb} onChange={(v) => sub("uploads", { maxMb: v })} placeholder="1.4" min={0.1} max={1.4} step={0.1} hint="Shartnoma va murojaat ilovalari (eng ko‘pi 1.4 MB)" />
            {saveBar("platform", ["platformName", "defaultTimezone", "reportingTimezone", "defaultLanguage", "trialDays", "uploads"])}
          </Section>

          <Section title="Yordam aloqalari" subtitle="Kompaniyalarning «Yordam» sahifasida ko‘rsatiladi">
            <div className="sa-form-row">
              <Field label="Email">
                <input className="input" type="email" value={s.support?.email || ""} onChange={(e) => sub("support", { email: e.target.value })} />
              </Field>
              <Field label="Telegram">
                <input className="input" value={s.support?.telegram || ""} placeholder="@staffora_support" onChange={(e) => sub("support", { telegram: e.target.value })} />
              </Field>
            </div>
            <div className="sa-form-row">
              <Field label="Telefon">
                <input className="input" value={s.support?.phone || ""} onChange={(e) => sub("support", { phone: e.target.value })} />
              </Field>
              <Field label="Ish vaqti">
                <input className="input" value={s.support?.hours || ""} placeholder="Du–Ju, 9:00–18:00" onChange={(e) => sub("support", { hours: e.target.value })} />
              </Field>
            </div>
            {saveBar("support", ["support"])}
          </Section>
        </div>

        <Section title="Texnik ishlar banneri" subtitle="Yoqilsa — barcha kompaniya panellarida yuqorida ko‘rinadi (ko‘rsatilgan vaqt oralig‘ida)">
          <Toggle label="Bannerni ko‘rsatish" checked={m.enabled} onChange={(enabled) => set("maintenance", { ...m, enabled })} />
          <Field label="Xabar">
            <textarea className="textarea" rows={2} maxLength={300} value={m.message} onChange={(e) => set("maintenance", { ...m, message: e.target.value })} placeholder="Masalan: 23:00–23:30 oralig‘ida texnik ishlar olib boriladi." />
          </Field>
          <div className="sa-form-row three">
            <Field label="Daraja">
              <select className="select" value={m.level} onChange={(e) => set("maintenance", { ...m, level: e.target.value as "info" | "warning" | "critical" })}>
                <option value="info">Ma’lumot</option>
                <option value="warning">Ogohlantirish</option>
                <option value="critical">Jiddiy</option>
              </select>
            </Field>
            <Field label="Boshlanishi">
              <input className="input" type="datetime-local" value={toLocalInput(m.startsAt)} onChange={(e) => set("maintenance", { ...m, startsAt: fromLocalInput(e.target.value) })} />
            </Field>
            <Field label="Tugashi">
              <input className="input" type="datetime-local" value={toLocalInput(m.endsAt)} onChange={(e) => set("maintenance", { ...m, endsAt: fromLocalInput(e.target.value) })} />
            </Field>
          </div>
          {saveBar("maintenance", ["maintenance"])}
        </Section>

        <div className="sa-grid-2">
          <Section title="Bildirishnomalar" subtitle="Standart holatda o‘chiq — real xabar faqat yoqilganda yuboriladi">
            <Toggle label="Administratorlarga Telegram ogohlantirishlari" hint="Incident, yangi murojaat — Telegram ulangan administratorlarga" checked={Boolean(n.adminTelegram)} onChange={(v) => sub("notifications", { adminTelegram: v })} />
            <Toggle label="Tarif muddati haqida ogohlantirish" hint="Kompaniya egasiga, quyidagi kunlarda" checked={Boolean(n.subscriptionAlerts)} onChange={(v) => sub("notifications", { subscriptionAlerts: v })} />
            <Field label="Necha kun qolganda (vergul bilan)" hint="Masalan: 7, 3, 1">
              <input
                className="input"
                value={(n.expiryDays || []).join(", ")}
                placeholder="7, 3, 1"
                onChange={(e) =>
                  sub("notifications", {
                    expiryDays: e.target.value
                      .split(/[,\s]+/)
                      .map(Number)
                      .filter((x) => Number.isInteger(x) && x > 0 && x <= 90)
                      .slice(0, 6),
                  })
                }
              />
            </Field>
            <Toggle label="Onboarding yangiliklari" hint="Kompaniya sozlash bosqichlari bo‘yicha administratorlarga" checked={Boolean(n.onboardingUpdates)} onChange={(v) => sub("notifications", { onboardingUpdates: v })} />
            {saveBar("notifications", ["notifications"])}
          </Section>

          <Section title="Xavfsizlik" subtitle="Xavfli bo‘lim — saqlashda parol so‘raladi">
            <NumberField label="Qayta tasdiq oralig‘i (daqiqa)" value={s.session?.reauthMinutes} onChange={(v) => sub("session", { reauthMinutes: v })} placeholder="10" min={1} max={120} hint="Xavfli amaldan oldin parol shu muddatdan eski bo‘lsa so‘raladi" />
            <Toggle label="Administratorlar uchun 2 bosqichli kirish" hint="Telegram ulangan administratorga kirishda kod yuboriladi" checked={Boolean(s.requireAdminMfa)} onChange={(v) => set("requireAdminMfa", v)} />
            <Toggle label="Yozish huquqli yordam kirishi" hint="O‘chiq bo‘lsa — kompaniyani faqat «faqat o‘qish» rejimida ko‘rish mumkin" checked={Boolean(s.supportAccessEnabled)} onChange={(v) => set("supportAccessEnabled", v)} />
            <NumberField label="Demo kompaniya muddati (kun)" value={s.demo?.ttlDays} onChange={(v) => sub("demo", { ttlDays: v })} placeholder="7" min={1} max={30} />
            {saveBar("security", ["session", "requireAdminMfa", "supportAccessEnabled", "demo"])}
          </Section>
        </div>

        <div className="sa-grid-2">
          <Section title="Ogohlantirish chegaralari" subtitle="Monitoring va incident qoidalari">
            <div className="sa-form-row">
              <NumberField label="Xato ulushi (%)" value={a.errorRatePercent} onChange={(v) => sub("alerts", { errorRatePercent: v })} placeholder="5" min={0.1} max={100} step={0.1} />
              <NumberField label="Kamida so‘rov (15 daq)" value={a.minRequests} onChange={(v) => sub("alerts", { minRequests: v })} placeholder="20" min={1} max={100000} />
            </div>
            <div className="sa-form-row">
              <NumberField label="p95 javob vaqti (ms)" value={a.latencyP95Ms} onChange={(v) => sub("alerts", { latencyP95Ms: v })} placeholder="2000" min={100} max={60000} />
              <NumberField label="Navbat chegarasi" value={a.queueBacklog} onChange={(v) => sub("alerts", { queueBacklog: v })} placeholder="200" min={10} max={1000000} />
            </div>
            <div className="sa-form-row three">
              <NumberField label="Zaxira yoshi (soat)" value={a.backupMaxAgeHours} onChange={(v) => sub("alerts", { backupMaxAgeHours: v })} placeholder="48" min={1} max={720} />
              <NumberField label="Xato kirishlar (15 daq)" value={a.failedLogins} onChange={(v) => sub("alerts", { failedLogins: v })} placeholder="20" min={3} max={10000} />
              <NumberField label="Takroriy ogohlantirish (daq)" value={a.cooldownMinutes} onChange={(v) => sub("alerts", { cooldownMinutes: v })} placeholder="30" min={1} max={1440} />
            </div>
            {saveBar("alerts", ["alerts"])}
          </Section>

          <Section title="Zaxira nusxalar" subtitle="Avtomatik zaxira — 0 bo‘lsa o‘chiq. Tiklash hech qachon avtomatik bajarilmaydi.">
            <div className="sa-form-row">
              <NumberField label="Har necha soatda" value={b.scheduleHours} onChange={(v) => sub("backups", { scheduleHours: v })} placeholder="0 (o‘chiq)" min={0} max={168} />
              <NumberField label="Saqlanadigan nusxalar" value={b.keep} onChange={(v) => sub("backups", { keep: v })} placeholder="5" min={1} max={30} />
            </div>
            <Toggle label="Rasmlarni qo‘shish" hint="Davomat rasmlari (hajm katta bo‘lishi mumkin)" checked={Boolean(b.includeMedia)} onChange={(v) => sub("backups", { includeMedia: v })} />
            <Toggle label="Hujjat fayllarini qo‘shish" checked={b.includeFiles !== false} onChange={(v) => sub("backups", { includeFiles: v })} />
            {saveBar("backups", ["backups"])}
          </Section>
        </div>

        <Section title="Ma’lumotlarni saqlash muddati" subtitle="Muddati o‘tgan texnik yozuvlar kuniga bir marta tozalanadi. Kompaniya ma’lumotlari (xodimlar, davomat) bunga kirmaydi.">
          <div className="sa-form-row four">
            <NumberField label="Audit (kun)" value={r.auditDays} onChange={(v) => sub("retention", { auditDays: v })} placeholder="365" min={30} max={3650} />
            <NumberField label="Metrikalar (kun)" value={r.metricsDays} onChange={(v) => sub("retention", { metricsDays: v })} placeholder="90" min={7} max={730} />
            <NumberField label="Foydalanish (kun)" value={r.usageDays} onChange={(v) => sub("retention", { usageDays: v })} placeholder="400" min={30} max={1095} />
            <NumberField label="Hal qilingan xatolar (kun)" value={r.errorsDays} onChange={(v) => sub("retention", { errorsDays: v })} placeholder="90" min={7} max={730} />
            <NumberField label="Yetkazishlar (kun)" value={r.deliveriesDays} onChange={(v) => sub("retention", { deliveriesDays: v })} placeholder="90" min={7} max={365} />
            <NumberField label="Fon ishlari (kun)" value={r.jobsDays} onChange={(v) => sub("retention", { jobsDays: v })} placeholder="30" min={7} max={365} />
            <NumberField label="Xavfsizlik hodisalari (kun)" value={r.securityDays} onChange={(v) => sub("retention", { securityDays: v })} placeholder="180" min={30} max={1095} />
          </div>
          {saveBar("retention", ["retention"])}
        </Section>
      </fieldset>

      <Section title="Muhit o‘zgaruvchilari" subtitle="Faqat berilgan / berilmaganligi ko‘rsatiladi — qiymatlar hech qachon brauzerga yuborilmaydi">
        <ul className="sa-env">
          {Object.entries(data.environment).map(([key, value]) => (
            <li key={key}>
              <StatusBadge value={value ? "OK" : "NOT_CONFIGURED"} label={value ? "Bor" : "Yo‘q"} />
              <span className="stack">
                <b>{ENV_LABELS[key] || key}</b>
                <small>
                  <code>{key}</code>
                  {typeof value === "string" ? ` · ${value}` : ""}
                </small>
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/** ISO → datetime-local (Toshkent vaqti, UTC+5). */
function toLocalInput(iso?: string) {
  if (!iso) return "";
  return new Date(Date.parse(iso) + 5 * 3600_000).toISOString().slice(0, 16);
}
function fromLocalInput(value: string) {
  return value ? new Date(`${value}:00+05:00`).toISOString() : undefined;
}

/* =============================================================== eksport === */
type ExportJob = { id: string; type: string; status: string; payload: { type: string; format: string; from?: string; to?: string; companyId?: string; reason?: string }; result: { name?: string; rows?: number; bytes?: number } | null; error: string | null; createdAt: string; finishedAt: string | null; createdBy: string | null };

function ExportsView() {
  const toast = useToast();
  const run = useAction();
  const [page, setPage] = useState(1);
  const { data, error, reload } = useApi<{ rows: ExportJob[]; total: number; page: number; pageSize: number; types: Record<string, string> }>(`/super-admin/exports?page=${page}&pageSize=20`);
  const [creating, setCreating] = useState(false);
  const { me } = usePlatform();
  usePolling(() => {
    if (data?.rows.some((j) => j.status === "QUEUED" || j.status === "RUNNING")) void reload(true);
  }, 3000);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  const expired = (j: ExportJob) => Date.now() - Date.parse(j.finishedAt || j.createdAt) > 24 * 3600_000;
  return (
    <>
      <PageHeader
        title="Eksportlar"
        subtitle="Fayl fon ishida tayyorlanadi · 24 soat ichida faqat yaratgan administrator yuklab oladi · har bir eksport auditga yoziladi"
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={!data}>
            <FileDown size={15} /> Yangi eksport
          </button>
        }
      />
      <Section>
        <DataTable
          rows={data?.rows}
          loading={!data}
          rowKey={(j) => j.id}
          empty={<p className="muted sa-empty">Hali eksport qilinmagan</p>}
          columns={[
            { key: "t", label: "Eksport", render: (j) => <span className="stack"><b>{data?.types[j.payload.type] || j.payload.type}</b><small>{j.payload.format.toUpperCase()}{j.payload.from ? ` · ${j.payload.from} — ${j.payload.to || "…"}` : ""}{j.payload.reason ? ` · ${j.payload.reason}` : ""}</small></span> },
            { key: "w", label: "Kim", hideOnMobile: true, render: (j) => j.createdBy || "—" },
            { key: "c", label: "Yaratilgan", render: (j) => ago(j.createdAt) },
            { key: "s", label: "Holat", render: (j) => (j.status === "SUCCEEDED" && expired(j) ? <StatusBadge value="EXPIRED" label="Muddati o‘tgan" /> : <StatusBadge value={j.status} />) },
            { key: "r", label: "Natija", hideOnMobile: true, render: (j) => <span className="muted">{j.error || (j.result?.rows !== undefined ? `${num(j.result.rows)} qator` : "—")}</span> },
            {
              key: "a",
              label: "",
              className: "sa-row-actions",
              render: (j) =>
                j.status === "SUCCEEDED" && !expired(j) && (j.createdBy === me?.user.name || me?.user.role === "OWNER") ? (
                  <button className="btn btn-sm" onClick={() => void run(() => downloadFile(`/super-admin/exports/${j.id}/download`, `${j.payload.type}.${j.payload.format}`), toast)}>
                    <Download size={14} /> Yuklab olish
                  </button>
                ) : null,
            },
          ]}
        />
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Section>
      {creating && data && (
        <CreateExport
          types={data.types}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void reload(true);
          }}
        />
      )}
    </>
  );
}

function CreateExport({ types, onClose, onDone }: { types: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const run = useAction();
  const { can } = usePlatform();
  const { data: companies } = useApi<{ rows: { id: string; name: string }[] }>("/super-admin/companies?pageSize=200");
  const [form, setForm] = useState({ type: "companies", format: "xlsx", from: "", to: "", companyId: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const available = Object.entries(types).filter(([key]) => (key === "audit" ? can("audit.read") : key === "billing" ? can("billing.read") : true));
  const needsCompany = form.type === "company_data";
  const needsRange = ["usage", "audit", "billing"].includes(form.type);
  return (
    <Modal title="Yangi eksport" subtitle="Kompaniya ma’lumoti eksporti — sabab va parol bilan" onClose={onClose} size="narrow">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const body = {
            type: form.type,
            format: form.format,
            from: needsRange && form.from ? form.from : undefined,
            to: needsRange && form.to ? form.to : undefined,
            companyId: form.companyId || undefined,
            reason: form.reason.trim() || undefined,
          };
          const ok = await run(() => post("/super-admin/exports", body), toast, "Eksport navbatga qo‘yildi");
          setBusy(false);
          if (ok) onDone();
        }}
      >
        <Field label="Turi">
          <Select label="Eksport turi" value={form.type} onChange={(type) => setForm({ ...form, type })} options={available as [string, string][]} />
        </Field>
        <Field label="Format">
          <Select
            label="Format"
            value={form.format}
            onChange={(format) => setForm({ ...form, format })}
            options={[
              ["xlsx", "Excel (XLSX)"],
              ["csv", "CSV"],
              ["json", "JSON"],
            ]}
          />
        </Field>
        {needsRange && (
          <div className="sa-form-row">
            <Field label="Boshlanish">
              <input className="input" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
            </Field>
            <Field label="Tugash">
              <input className="input" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
            </Field>
          </div>
        )}
        <Field label={needsCompany ? "Kompaniya" : "Kompaniya (ixtiyoriy)"}>
          <Select label="Kompaniya" value={form.companyId} onChange={(companyId) => setForm({ ...form, companyId })} options={[["", needsCompany ? "Tanlang…" : "Barcha kompaniyalar"], ...(companies?.rows || []).map((c) => [c.id, c.name] as [string, string])]} />
        </Field>
        <Field label={needsCompany ? "Sabab (majburiy, kamida 10 belgi)" : "Sabab (ixtiyoriy)"}>
          <textarea className="textarea" rows={2} maxLength={300} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={busy || (needsCompany && (!form.companyId || form.reason.trim().length < 10))}>
            <FileDown size={15} /> Eksport qilish
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function SystemPages({ view }: { view: string }) {
  const { can, me } = usePlatform();
  if (!me) return <Skeleton rows={8} />;
  if (view === "languages") return can("settings.read") ? <LanguagesView /> : <NoAccess />;
  if (view === "exports") return can("audit.export") ? <ExportsView /> : <NoAccess />;
  return can("settings.read") ? <SettingsView /> : <NoAccess />;
}
