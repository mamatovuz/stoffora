import { useState } from "react";
import { Bell, CheckCheck, Clock3, Megaphone, Plane, Plus, ScrollText, Send } from "lucide-react";
import { api, errorText, notifyChange, patch, post } from "../api";
import { useApi } from "../hooks";
import {
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Segmented,
  useToast,
} from "../components/ui";
import { dateLongUz, dateUz, tashkentIsoDate } from "@/lib/format";
import type { Announcement, AuditLog, Notification } from "@/lib/types";
import type { Meta } from "../types";

const time = (value: string) =>
  new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tashkent",
  });

export function AnnouncementsPage() {
  const { data, loading, error, reload } = useApi<Announcement[]>("/announcements");
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <div className="page narrow">
      <PageHeader
        title="E’lonlar"
        subtitle="Xodimlarga Staffora, Staffora boti va xodimlar boti orqali xabar yuborish"
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> E’lon yuborish
          </button>
        }
      />
      <section className="card">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !data?.length ? (
          <Empty
            icon={Megaphone}
            title="E’lonlar yo‘q"
            text="Yig‘ilish, bayram yoki grafik o‘zgarishi haqida barcha xodimlarga bir zumda xabar bering."
          />
        ) : (
          <div className="feed">
            {data.map((a) => (
              <article className="feed-item" key={a.id}>
                <span className="feed-icon green">
                  <Megaphone size={15} />
                </span>
                <div style={{ flex: 1 }}>
                  <b>{a.title}</b>
                  <p style={{ whiteSpace: "pre-wrap" }}>{a.message}</p>
                  <small>
                    {a.audience} · {[...new Set(a.channel.map((c) => channelNames[c] || c))].join(" + ")} · {dateUz(a.scheduledAt)} {time(a.scheduledAt)}
                    {a.createdBy ? ` · ${a.createdBy}` : ""}
                  </small>
                  <DeliveryReport a={a} />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {open && (
        <AnnouncementForm
          onClose={() => setOpen(false)}
          onSaved={(delivered) => {
            setOpen(false);
            toast(
              delivered !== undefined
                ? `E’lon yuborildi · Telegram: ${delivered} ta`
                : "E’lon yuborildi",
            );
            void reload(true);
          }}
        />
      )}
    </div>
  );
}

type AudienceType = "ALL" | "BRANCHES" | "DEPARTMENTS" | "POSITIONS" | "EMPLOYEES";
const audienceLabels: Record<AudienceType, string> = {
  ALL: "Barcha xodimlar",
  BRANCHES: "Filiallar",
  DEPARTMENTS: "Bo‘limlar",
  POSITIONS: "Lavozimlar",
  EMPLOYEES: "Aniq xodimlar",
};
const channelNames: Record<string, string> = { STAFFORA: "Staffora", WEB: "Staffora", TELEGRAM: "Staffora boti", BOT: "Xodimlar boti" };

function DeliveryReport({ a }: { a: Announcement }) {
  const r = a.report;
  if (!r) return null;
  return (
    <div className="delivery-report">
      {r.staffora && <span className="badge green">Staffora: {r.staffora.delivered} ta</span>}
      {r.telegram && (
        <span className={`badge ${r.telegram.failed ? "amber" : "green"}`}>
          Staffora boti: {r.telegram.delivered}/{r.telegram.recipients}
        </span>
      )}
      {r.bot && (
        <span
          className={`badge ${r.bot.status === "FAILED" ? "red" : r.bot.status === "PARTIAL" ? "amber" : r.bot.status === "SENT" ? "green" : "blue"}`}
          title={r.bot.error || (r.bot.skipped ? `${r.bot.skipped} ta qabul qiluvchi botga bog‘lanmagan` : undefined)}
        >
          Xodimlar boti:{" "}
          {r.bot.status === "FAILED"
            ? `xato — ${r.bot.error || "yuborilmadi"}`
            : `${r.bot.sent} yuborildi${r.bot.failed ? ` · ${r.bot.failed} xato` : ""}${r.bot.status === "QUEUED" ? " · navbatda" : ""}`}
        </span>
      )}
    </div>
  );
}

function AnnouncementForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (delivered?: number) => void;
}) {
  const { data: meta } = useApi<Meta>("/meta");
  const { data: integrations } = useApi<{ items: { status: string }[] }>("/integrations");
  const botConnected = Boolean(integrations?.items.some((i) => i.status !== "DISCONNECTED"));
  const [audience, setAudience] = useState<AudienceType>("ALL");
  const { data: employees } = useApi<{ items: { id: string; firstName: string; lastName: string }[] } | { id: string; firstName: string; lastName: string }[]>(
    audience === "EMPLOYEES" ? "/employees?limit=500" : null,
  );
  const [form, setForm] = useState({ title: "", message: "" });
  const [channels, setChannels] = useState<string[]>(["STAFFORA", "TELEGRAM"]);
  const [ids, setIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  const options: { id: string; name: string }[] =
    audience === "BRANCHES"
      ? meta?.branches.map((b) => ({ id: b.id, name: b.name })) || []
      : audience === "DEPARTMENTS"
        ? meta?.departments.map((d) => ({ id: d.id, name: d.name })) || []
        : audience === "POSITIONS"
          ? meta?.positions.map((p) => ({ id: p.id, name: p.name })) || []
          : audience === "EMPLOYEES"
            ? (Array.isArray(employees) ? employees : employees?.items || []).map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }))
            : [];
  const visible = options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (!channels.length) throw new Error("Kamida bitta kanalni tanlang.");
      if (audience !== "ALL" && !ids.length) throw new Error("Qabul qiluvchilarni tanlang.");
      const result = await post<{ delivered: number }>("/announcements", {
        title: form.title,
        message: form.message,
        channel: channels,
        target: { type: audience, ids: audience === "ALL" ? [] : ids },
      });
      onSaved(channels.includes("TELEGRAM") ? result.delivered : undefined);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Yangi e’lon" subtitle="Kanallar va qabul qiluvchilarni tanlang" onClose={onClose} size="wide">
      <form onSubmit={save}>
        <Field label="Sarlavha *">
          <input className="input" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={3} />
        </Field>
        <Field label="Xabar *" hint={`${form.message.length}/3500`}>
          <textarea className="textarea" rows={5} maxLength={3500} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required minLength={5} />
        </Field>
        <Field label="Kanallar">
          <div className="channel-picks">
            {(["STAFFORA", "TELEGRAM", "BOT"] as const).map((channel) => (
              <label key={channel} className={`ic-check ${channels.includes(channel) ? "on" : ""}`} title={channel === "BOT" && !botConnected ? "Xodimlar boti ulanmagan (Sozlamalar → Integratsiyalar)" : undefined}>
                <input
                  type="checkbox"
                  disabled={channel === "BOT" && !botConnected}
                  checked={channels.includes(channel)}
                  onChange={() => setChannels((list) => toggle(list, channel))}
                />
                {channelNames[channel]}
                {channel === "BOT" && !botConnected && <small className="muted">ulanmagan</small>}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Kimga">
          <select
            className="select"
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value as AudienceType);
              setIds([]);
              setSearch("");
            }}
          >
            {(Object.keys(audienceLabels) as AudienceType[]).map((key) => (
              <option key={key} value={key}>
                {audienceLabels[key]}
              </option>
            ))}
          </select>
        </Field>
        {audience !== "ALL" && (
          <div className="stack" style={{ gap: 8, marginBottom: 14 }}>
            {options.length > 8 && <input className="input" placeholder="Qidirish…" value={search} onChange={(e) => setSearch(e.target.value)} />}
            <div className="ic-checks" style={{ maxHeight: 220, overflow: "auto" }}>
              {visible.map((o) => (
                <label key={o.id} className={`ic-check ${ids.includes(o.id) ? "on" : ""}`}>
                  <input type="checkbox" checked={ids.includes(o.id)} onChange={() => setIds((list) => toggle(list, o.id))} />
                  {o.name}
                </label>
              ))}
              {!visible.length && <small className="muted">Topilmadi</small>}
            </div>
            <small className="muted">{ids.length} ta tanlandi</small>
          </div>
        )}
        <ErrorBox message={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={saving}>
            <Send size={15} /> {saving ? "Yuborilmoqda…" : "Yuborish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type NotifFilter = "ALL" | "UNREAD" | "ATTENDANCE" | "LEAVE";
const notifMeta: Record<string, { icon: typeof Bell; tone: string; label: string }> = {
  ATTENDANCE: { icon: Clock3, tone: "amber", label: "Davomat" },
  LEAVE: { icon: Plane, tone: "blue", label: "Ta’til" },
  ANNOUNCEMENT: { icon: Megaphone, tone: "green", label: "E’lon" },
};
function dayLabel(iso: string) {
  const day = tashkentIsoDate(new Date(iso));
  const today = tashkentIsoDate();
  const yesterday = tashkentIsoDate(new Date(Date.now() - 86_400_000));
  return day === today ? "Bugun" : day === yesterday ? "Kecha" : dateLongUz(day);
}

export function NotificationsPage() {
  const { data, loading, error, setData } = useApi<Notification[]>("/notifications");
  const [filter, setFilter] = useState<NotifFilter>("ALL");
  const toast = useToast();
  const rows = (data || []).filter((n) =>
    filter === "ALL" ? true : filter === "UNREAD" ? !n.read : n.type === filter,
  );
  const unread = data?.filter((n) => !n.read).length || 0;
  const groups = rows.reduce<[string, Notification[]][]>((acc, n) => {
    const label = dayLabel(n.createdAt);
    const group = acc.find(([key]) => key === label);
    if (group) group[1].push(n);
    else acc.push([label, [n]]);
    return acc;
  }, []);

  async function markRead(id: string) {
    // Optimistik yangilash — ro‘yxat va yuqoridagi hisoblagich darhol o‘zgaradi.
    setData((list) => list?.map((n) => (n.id === id ? { ...n, read: true } : n)) || null);
    try {
      await api(`/notifications/${id}/read`, { method: "PATCH" });
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      notifyChange("notifications");
    }
  }
  async function markAll() {
    setData((list) => list?.map((n) => ({ ...n, read: true })) || null);
    try {
      await patch("/notifications/read-all");
      toast("Hammasi o‘qilgan deb belgilandi");
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      notifyChange("notifications");
    }
  }

  return (
    <div className="page narrow">
      <PageHeader
        title="Bildirishnomalar"
        subtitle={unread ? `${unread} ta o‘qilmagan` : "Hammasi o‘qilgan"}
        actions={
          unread > 0 && (
            <button className="btn" onClick={() => void markAll()}>
              <CheckCheck size={16} /> Hammasini o‘qilgan qilish
            </button>
          )
        }
      />
      <section className="card">
        <div className="filters">
          <Segmented<NotifFilter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "ALL", label: "Barchasi", count: data?.length },
              { value: "UNREAD", label: "O‘qilmagan", count: unread },
              { value: "ATTENDANCE", label: "Davomat" },
              { value: "LEAVE", label: "Ta’til" },
            ]}
          />
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !rows.length ? (
          <Empty
            icon={Bell}
            title={filter === "UNREAD" ? "O‘qilmagan bildirishnoma yo‘q" : "Bildirishnomalar yo‘q"}
            text="Kechikishlar va ta’til so‘rovlari shu yerda paydo bo‘ladi."
          />
        ) : (
          <div className="notif-list">
            {groups.map(([label, items]) => (
              <div key={label}>
                <div className="notif-day">{label}</div>
                {items.map((n) => {
                  const meta = notifMeta[n.type] || { icon: Bell, tone: "gray", label: "Tizim" };
                  return (
                    <button
                      key={n.id}
                      className={`notif-item ${n.read ? "" : "unread"}`}
                      onClick={() => !n.read && void markRead(n.id)}
                      title={n.read ? undefined : "O‘qilgan deb belgilash"}
                    >
                      <span className={`feed-icon ${meta.tone}`}>
                        <meta.icon size={15} />
                      </span>
                      <span className="notif-text">
                        <b>{n.title}</b>
                        <small>{n.body}</small>
                      </span>
                      <span className="notif-side">
                        <time>{time(n.createdAt)}</time>
                        {!n.read && <i className="notif-dot" aria-label="O‘qilmagan" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function AuditPage() {
  const { data, loading, error } = useApi<AuditLog[]>("/audit");
  const [q, setQ] = useState("");
  const rows = (data || []).filter((a) =>
    `${a.action} ${a.actor} ${a.entity}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="page narrow">
      <PageHeader title="Audit jurnali" subtitle="Tizimdagi muhim o‘zgarishlar tarixi (so‘nggi 300 ta)" />
      <section className="card">
        <div className="filters">
          <input className="input" style={{ maxWidth: 320 }} placeholder="Amal yoki foydalanuvchi…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !rows.length ? (
          <Empty icon={ScrollText} title="Yozuvlar yo‘q" />
        ) : (
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>Amal</th>
                  <th>Kim</th>
                  <th>Obyekt</th>
                  <th>Vaqt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <b>{a.action}</b>
                    </td>
                    <td data-label="Kim">{a.actor}</td>
                    <td data-label="Obyekt">
                      <span className="tag">{a.entity}</span>
                    </td>
                    <td data-label="Vaqt" className="num">
                      {dateUz(a.createdAt)} {time(a.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
