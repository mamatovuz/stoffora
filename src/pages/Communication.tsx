import { useState } from "react";
import { Bell, CheckCheck, Clock3, Megaphone, Plane, Plus, ScrollText, Send } from "lucide-react";
import { api, errorText, patch, post } from "../api";
import { useApi } from "../hooks";
import {
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  useToast,
} from "../components/ui";
import { dateUz } from "@/lib/format";
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
        subtitle="Xodimlarga Telegram va Mini App orqali xabar yuborish"
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
                    {a.audience} · {a.channel.join(" + ")} · {dateUz(a.scheduledAt)} {time(a.scheduledAt)}
                  </small>
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

function AnnouncementForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (delivered?: number) => void;
}) {
  const { data: meta } = useApi<Meta>("/meta");
  const [form, setForm] = useState({ title: "", message: "", branchId: "", telegram: true });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await post<{ delivered: number }>("/announcements", {
        title: form.title,
        message: form.message,
        branchId: form.branchId || undefined,
        channel: form.telegram ? ["WEB", "TELEGRAM"] : ["WEB"],
      });
      onSaved(form.telegram ? result.delivered : undefined);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Yangi e’lon" onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Sarlavha *">
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={3} />
        </Field>
        <Field label="Xabar *">
          <textarea className="textarea" rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required minLength={5} />
        </Field>
        <Field label="Kimga">
          <select className="select" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
            <option value="">Barcha xodimlar</option>
            {meta?.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} filiali
              </option>
            ))}
          </select>
        </Field>
        <label className="checkbox-row" style={{ marginBottom: 14 }}>
          <input type="checkbox" checked={form.telegram} onChange={(e) => setForm({ ...form, telegram: e.target.checked })} />
          Telegram bot orqali ham yuborish
        </label>
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

export function NotificationsPage() {
  const { data, loading, error, reload } = useApi<Notification[]>("/notifications");
  const unread = data?.filter((n) => !n.read).length || 0;
  async function read(id: string) {
    await api(`/notifications/${id}/read`, { method: "PATCH" });
    void reload(true);
  }
  return (
    <div className="page narrow">
      <PageHeader
        title="Bildirishnomalar"
        subtitle={unread ? `${unread} ta o‘qilmagan` : "Hammasi o‘qilgan"}
        actions={
          unread > 0 && (
            <button
              className="btn"
              onClick={async () => {
                await patch("/notifications/read-all");
                void reload(true);
              }}
            >
              <CheckCheck size={16} /> Hammasini o‘qilgan deb belgilash
            </button>
          )
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
          <Empty icon={Bell} title="Bildirishnomalar yo‘q" text="Kechikishlar va ta’til so‘rovlari shu yerda paydo bo‘ladi." />
        ) : (
          <div className="feed">
            {data.map((n) => (
              <article
                className="feed-item"
                key={n.id}
                style={{ background: n.read ? undefined : "#f5fbf8" }}
              >
                <span
                  className={`feed-icon ${n.type === "ATTENDANCE" ? "amber" : n.type === "LEAVE" ? "blue" : "green"}`}
                >
                  {n.type === "ATTENDANCE" ? <Clock3 size={15} /> : n.type === "LEAVE" ? <Plane size={15} /> : <Bell size={15} />}
                </span>
                <div style={{ flex: 1 }}>
                  <b>{n.title}</b>
                  <p>{n.body}</p>
                  <small>
                    {dateUz(n.createdAt)} {time(n.createdAt)}
                  </small>
                </div>
                {!n.read && (
                  <button className="btn btn-sm btn-ghost" onClick={() => void read(n.id)}>
                    O‘qildi
                  </button>
                )}
              </article>
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
