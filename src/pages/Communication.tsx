import { useState } from "react";
import { Bell, Check, Plus, Send } from "lucide-react";
import { api, post } from "../api";
import { useApi } from "../hooks";
import {
  Empty,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  Status,
} from "../components/ui";
import { dateUz } from "@/lib/format";
import type { Announcement, AuditLog, Notification } from "@/lib/types";
export function AnnouncementsPage() {
  const { data, loading, error, reload } =
      useApi<Announcement[]>("/announcements"),
    [open, setOpen] = useState(false);
  return (
    <div className="page">
      <PageHeader
        title="E’lonlar"
        subtitle="Xodimlarga xabar yuborish va rejalashtirish"
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> E’lon yaratish
          </button>
        }
      />
      <section className="card">
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} />
        ) : !data?.length ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Sarlavha</th>
                  <th>Auditoriya</th>
                  <th>Kanallar</th>
                  <th>Vaqt</th>
                  <th>Holat</th>
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <b>{a.title}</b>
                      <small
                        className="subtle"
                        style={{
                          display: "block",
                          marginTop: 4,
                          maxWidth: 360,
                        }}
                      >
                        {a.message}
                      </small>
                    </td>
                    <td>{a.audience}</td>
                    <td>{a.channel.join(", ")}</td>
                    <td>{dateUz(a.scheduledAt)}</td>
                    <td>
                      <Status value={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open && (
        <AnnouncementForm
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void reload();
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
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
      title: "",
      message: "",
      audience: "Barcha xodimlar",
      channel: ["WEB"],
      scheduledAt: new Date().toISOString(),
      status: "SENT",
    }),
    [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post("/announcements", form);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    }
  }
  return (
    <Modal title="Yangi e’lon" onClose={onClose}>
      <form onSubmit={save}>
        <div className="field">
          <label className="label">Sarlavha</label>
          <input
            className="input"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
        </div>
        <div className="field">
          <label className="label">Xabar</label>
          <textarea
            className="textarea"
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            required
          />
        </div>
        <div className="field">
          <label className="label">Auditoriya</label>
          <select
            className="select"
            value={form.audience}
            onChange={(e) => setForm({ ...form, audience: e.target.value })}
          >
            <option>Barcha xodimlar</option>
            <option>Filial menejerlari</option>
            <option>HR bo‘limi</option>
          </select>
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary">
            <Send size={15} /> Yuborish
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function NotificationsPage() {
  const { data, loading, error, reload } =
    useApi<Notification[]>("/notifications");
  async function read(id: string) {
    await api(`/notifications/${id}/read`, { method: "PATCH" });
    void reload();
  }
  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <PageHeader
        title="Bildirishnomalar"
        subtitle="Muhim voqealar va ogohlantirishlar"
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : !data?.length ? (
        <Empty />
      ) : (
        <section className="card">
          {data.map((n) => (
            <div
              key={n.id}
              style={{
                display: "flex",
                gap: 13,
                padding: 17,
                borderBottom: "1px solid var(--line)",
                background: n.read ? "white" : "#f4faf7",
              }}
            >
              <span
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  background: "var(--brand-soft)",
                  color: "var(--brand)",
                }}
              >
                <Bell size={18} />
              </span>
              <div style={{ flex: 1 }}>
                <b>{n.title}</b>
                <p className="subtle" style={{ margin: "5px 0", fontSize: 12 }}>
                  {n.body}
                </p>
                <small className="subtle">{dateUz(n.createdAt)}</small>
              </div>
              {!n.read && (
                <button className="btn btn-sm" onClick={() => read(n.id)}>
                  <Check size={14} /> O‘qildi
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
export function AuditPage() {
  const { data, loading, error } = useApi<AuditLog[]>("/audit");
  return (
    <div className="page">
      <PageHeader
        title="Audit jurnali"
        subtitle="Tizimdagi muhim o‘zgarishlarning o‘zgarmas tarixi"
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : (
        <section className="card">
          <div className="timeline section-body">
            {data?.map((a) => (
              <div className="timeline-item" key={a.id}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 15,
                  }}
                >
                  <div>
                    <b>{a.action}</b>
                    <p
                      className="subtle"
                      style={{ fontSize: 12, margin: "5px 0" }}
                    >
                      {a.actor} · {a.entity} / {a.entityId.slice(0, 12)}
                    </p>
                  </div>
                  <small className="subtle">{dateUz(a.createdAt)}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
