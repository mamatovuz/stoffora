import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, ClipboardCheck, ListTodo, MessageSquare, Plus, Search, Trash2, Wrench } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api, errorText, patch, post, put } from "../api";
import { useApi } from "../hooks";
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, Segmented, StatCard, useToast } from "../components/ui";
import { fileToDataUrl } from "../components/Documents";

/*
 * Operatsiya: vazifalar, kundalik checklistlar, hodisalar (Ochiq → Jarayonda → Hal qilindi).
 * Xodimlar Mini App / ilovada bajaradi; bu yerda HR, filial rahbari va (hodisalarda) IT boshqaradi.
 */

const dmy = (iso?: string) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "");
const when = (iso: string) => `${dmy(iso)} ${new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" })}`;
const Badge = ({ tone, children }: { tone: string; children: React.ReactNode }) => <span className={`badge ${tone}`}>{children}</span>;
const Photo = ({ id }: { id: string }) => (
  <a href={`/api/ops/photos/${id}`} target="_blank" rel="noreferrer" className="ops-photo">
    <img src={`/api/ops/photos/${id}`} alt="Rasm" loading="lazy" />
  </a>
);

/* ============================================================ vazifalar === */
type Task = {
  id: string;
  title: string;
  description?: string;
  assignees: { id: string; name: string }[];
  branch?: string;
  dueDate?: string;
  priority: "LOW" | "NORMAL" | "HIGH";
  requirePhoto?: boolean;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  createdBy: string;
  createdAt: string;
  doneAt?: string;
  doneBy?: string;
  overdue: boolean;
  photoIds: string[];
  comments: { by: string; text: string; at: string; photoId?: string }[];
};
const TASK_STATUS: Record<Task["status"], [string, string]> = { TODO: ["Yangi", "blue"], IN_PROGRESS: ["Jarayonda", "amber"], DONE: ["Bajarildi", "green"], CANCELLED: ["Bekor", "gray"] };
const PRIORITY: Record<Task["priority"], [string, string]> = { LOW: ["Past", "gray"], NORMAL: ["Oddiy", "blue"], HIGH: ["Muhim", "red"] };

export function TasksPage() {
  const toast = useToast();
  const [params] = useSearchParams();
  const { data, loading, error, reload } = useApi<{ tasks: Task[]; employees: { id: string; name: string; branchId: string }[] }>("/tasks");
  const { data: branches } = useApi<{ id: string; name: string }[]>("/branches");
  const [filter, setFilter] = useState<"open" | "overdue" | "done" | "all">("open");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(params.get("id"));
  const tasks = data?.tasks || [];
  const rows = tasks.filter(
    (t) =>
      (filter === "all" || (filter === "open" ? t.status === "TODO" || t.status === "IN_PROGRESS" : filter === "overdue" ? t.overdue : t.status === "DONE")) &&
      `${t.title} ${t.assignees.map((a) => a.name).join(" ")} ${t.branch || ""}`.toLowerCase().includes(q.toLowerCase()),
  );
  const open = tasks.find((t) => t.id === openId);
  const openCount = tasks.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS").length;
  return (
    <div className="page">
      <PageHeader
        title="Vazifalar"
        subtitle="Xodimga yoki butun filialga vazifa bering — ular Mini App / ilovada «Boshladim», «Bajarildi» (kerak bo‘lsa rasm bilan) bosadi."
        actions={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Vazifa berish
          </button>
        }
      />
      <div className="stat-grid">
        <StatCard label="Ochiq" value={openCount} icon={ListTodo} tone="blue" onClick={() => setFilter("open")} selected={filter === "open"} />
        <StatCard label="Muddati o‘tgan" value={tasks.filter((t) => t.overdue).length} icon={AlertTriangle} tone="red" onClick={() => setFilter("overdue")} selected={filter === "overdue"} />
        <StatCard label="Bajarilgan" value={tasks.filter((t) => t.status === "DONE").length} icon={CheckCircle2} tone="green" onClick={() => setFilter("done")} selected={filter === "done"} />
        <StatCard label="Jami" value={tasks.length} icon={ListTodo} tone="violet" onClick={() => setFilter("all")} selected={filter === "all"} />
      </div>
      <section className="card">
        <div className="filters">
          <span className="input-icon">
            <Search size={16} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Vazifa, xodim yoki filial…" />
          </span>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !rows.length ? (
          <Empty icon={ListTodo} title="Vazifalar yo‘q" text="«Vazifa berish» bilan xodim yoki filialga topshiriq yuboring." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Vazifa</th>
                  <th>Ijrochi</th>
                  <th>Muddat</th>
                  <th>Holat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="clickable" onClick={() => setOpenId(t.id)}>
                    <td>
                      <b>{t.title}</b> {t.priority === "HIGH" && <Badge tone="red">Muhim</Badge>} {t.requirePhoto && <Camera size={13} className="muted" />}
                      <small className="muted block">
                        {t.createdBy} · {dmy(t.createdAt)}
                        {t.comments.length ? ` · 💬 ${t.comments.length}` : ""}
                      </small>
                    </td>
                    <td>
                      {t.assignees.length > 2 ? `${t.assignees[0].name} va yana ${t.assignees.length - 1}` : t.assignees.map((a) => a.name).join(", ")}
                      {t.branch && <small className="muted block">{t.branch}</small>}
                    </td>
                    <td className={t.overdue ? "text-red" : ""}>{t.dueDate ? dmy(t.dueDate) : "—"}</td>
                    <td>
                      <Badge tone={TASK_STATUS[t.status][1]}>{TASK_STATUS[t.status][0]}</Badge>
                      {t.overdue && <Badge tone="red">Kechikdi</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {adding && data && (
        <TaskModal
          employees={data.employees}
          branches={branches || []}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            toast("Vazifa yuborildi — xodimlarga xabar ketdi");
            void reload(true);
          }}
        />
      )}
      {open && <TaskDrawer task={open} onClose={() => setOpenId(null)} onChanged={() => void reload(true)} />}
    </div>
  );
}

function TaskModal({ employees, branches, onClose, onDone }: { employees: { id: string; name: string; branchId: string }[]; branches: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: "", description: "", dueDate: "", priority: "NORMAL", requirePhoto: false, branchId: "" });
  const [ids, setIds] = useState<string[]>([]);
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const pool = employees.filter((e) => (!form.branchId || e.branchId === form.branchId) && e.name.toLowerCase().includes(who.toLowerCase()));
  async function save() {
    setBusy(true);
    try {
      await post("/tasks", { ...form, assigneeIds: ids, branchId: form.branchId || undefined, description: form.description || undefined });
      onDone();
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Vazifa berish" subtitle="Xodimlarni tanlang yoki faqat filialni tanlab, uning barcha xodimlariga yuboring" onClose={onClose}>
      <Field label="Vazifa">
        <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Masalan: Vitrinani yangilash" autoFocus />
      </Field>
      <Field label="Tafsilot (ixtiyoriy)">
        <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <div className="form-grid">
        <Field label="Muddat">
          <input className="input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
        </Field>
        <Field label="Muhimlik">
          <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="LOW">Past</option>
            <option value="NORMAL">Oddiy</option>
            <option value="HIGH">Muhim</option>
          </select>
        </Field>
        <Field label="Filial">
          <select className="select" value={form.branchId} onChange={(e) => (setForm({ ...form, branchId: e.target.value }), setIds([]))}>
            <option value="">Har qanday</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="lc-check">
        <input type="checkbox" checked={form.requirePhoto} onChange={(e) => setForm({ ...form, requirePhoto: e.target.checked })} /> Bajarilganda rasm majburiy (fotohisobot)
      </label>
      <Field label={ids.length ? `Ijrochilar (${ids.length})` : form.branchId ? "Ijrochilar — tanlanmasa filialning barcha xodimlari" : "Ijrochilar"}>
        <input className="input" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Qidirish…" style={{ marginBottom: 6 }} />
        <div className="sp-people">
          {pool.map((e) => (
            <label key={e.id} className="lc-check">
              <input type="checkbox" checked={ids.includes(e.id)} onChange={(ev) => setIds(ev.target.checked ? [...ids, e.id] : ids.filter((x) => x !== e.id))} /> {e.name}
            </label>
          ))}
        </div>
      </Field>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button className="btn btn-primary" disabled={busy || form.title.trim().length < 2 || (!ids.length && !form.branchId)} onClick={() => void save()}>
          Yuborish
        </button>
      </div>
    </Modal>
  );
}

function TaskDrawer({ task, onClose, onChanged }: { task: Task; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  async function run(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) toast(ok);
      onChanged();
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  return (
    <Modal title={task.title} subtitle={`${task.createdBy} · ${dmy(task.createdAt)}${task.dueDate ? ` · muddat ${dmy(task.dueDate)}` : ""}`} onClose={onClose}>
      <div className="ops-head">
        <Badge tone={TASK_STATUS[task.status][1]}>{TASK_STATUS[task.status][0]}</Badge>
        <Badge tone={PRIORITY[task.priority][1]}>{PRIORITY[task.priority][0]}</Badge>
        {task.overdue && <Badge tone="red">Muddati o‘tgan</Badge>}
        {task.requirePhoto && <Badge tone="violet">Fotohisobot</Badge>}
      </div>
      {task.description && <p className="ops-desc">{task.description}</p>}
      <p className="muted">Ijrochilar: {task.assignees.map((a) => a.name).join(", ")}</p>
      {task.doneBy && (
        <p className="text-green">
          ✓ {task.doneBy} — {when(task.doneAt!)}
        </p>
      )}
      {!!task.photoIds.length && (
        <div className="ops-photos">
          {task.photoIds.map((id) => (
            <Photo key={id} id={id} />
          ))}
        </div>
      )}
      <div className="ops-thread">
        {task.comments.map((c, i) => (
          <div key={i} className="ops-msg">
            <b>{c.by}</b> <small className="muted">{when(c.at)}</small>
            <p>{c.text}</p>
            {c.photoId && !task.photoIds.includes(c.photoId) && <Photo id={c.photoId} />}
          </div>
        ))}
      </div>
      <div className="ops-reply">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Izoh yozing…" onKeyDown={(e) => e.key === "Enter" && text.trim() && void run(() => post(`/tasks/${task.id}/comment`, { text }).then(() => setText("")))} />
        <button className="btn" disabled={!text.trim()} onClick={() => void run(() => post(`/tasks/${task.id}/comment`, { text }).then(() => setText("")))}>
          <MessageSquare size={15} /> Yuborish
        </button>
      </div>
      <div className="form-actions">
        <button className="icon-btn" title="O‘chirish" onClick={() => confirm("Vazifa o‘chirilsinmi?") && void run(() => api(`/tasks/${task.id}`, { method: "DELETE" }).then(onClose), "O‘chirildi")}>
          <Trash2 size={15} />
        </button>
        {task.status === "DONE" || task.status === "CANCELLED" ? (
          <button className="btn" onClick={() => void run(() => patch(`/tasks/${task.id}`, { status: "TODO" }), "Qayta ochildi")}>
            Qayta ochish
          </button>
        ) : (
          <>
            <button className="btn" onClick={() => void run(() => patch(`/tasks/${task.id}`, { status: "CANCELLED" }), "Bekor qilindi")}>
              Bekor qilish
            </button>
            <button className="btn btn-primary" onClick={() => void run(() => patch(`/tasks/${task.id}`, { status: "DONE" }), "Bajarildi deb belgilandi")}>
              <CheckCircle2 size={15} /> Bajarildi
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ========================================================= checklistlar === */
type Template = { id: string; title: string; branchIds: string[]; weekdays: number[]; dueTime?: string; items: { id: string; text: string; requirePhoto?: boolean }[]; active: boolean };
type Run = {
  templateId: string;
  title: string;
  dueTime?: string;
  branchId: string;
  branch: string;
  date: string;
  items: { id: string; text: string; requirePhoto?: boolean; done: boolean; by?: string; at?: string; photoId?: string; note?: string }[];
  done: number;
  total: number;
  completedAt?: string;
  overdue: boolean;
};
const WD = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];

export function ChecklistsPage() {
  const toast = useToast();
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [view, setView] = useState<"today" | "templates">("today");
  const { data, loading, error, reload } = useApi<{ date: string; templates: Template[]; runs: Run[]; branches: { id: string; name: string }[] }>(`/checklists?date=${date}`);
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [openRun, setOpenRun] = useState<Run | null>(null);
  const runs = data?.runs || [];
  return (
    <div className="page">
      <PageHeader
        title="Checklistlar"
        subtitle="Har kuni takrorlanadigan ro‘yxatlar (ochilish, kassa, tozalik…). Xodimlar Mini App / ilovada band-band belgilaydi; vaqtida tugamasa — sizga xabar."
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "today", label: "Bajarilishi" },
                { value: "templates", label: "Shablonlar", count: data?.templates.length },
              ]}
            />
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              <Plus size={16} /> Checklist
            </button>
          </>
        }
      />
      {loading && !data ? (
        <Loading />
      ) : error || !data ? (
        <ErrorBox message={error || "Ma’lumot yo‘q"} />
      ) : view === "today" ? (
        <>
          <div className="stat-grid">
            <StatCard label="Bugungi ro‘yxatlar" value={runs.length} icon={ClipboardCheck} tone="blue" />
            <StatCard label="Tugagan" value={runs.filter((r) => r.done === r.total).length} icon={CheckCircle2} tone="green" />
            <StatCard label="Vaqtida tugamagan" value={runs.filter((r) => r.overdue).length} icon={AlertTriangle} tone="red" />
            <div className="card stat">
              <div className="stat-top">
                <span>Sana</span>
              </div>
              <input className="input" type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
          </div>
          {!runs.length ? (
            <section className="card">
              <Empty icon={ClipboardCheck} title="Bu kunga checklist yo‘q" text="«Checklist» tugmasi bilan filial uchun kundalik ro‘yxat yarating." />
            </section>
          ) : (
            <div className="ops-grid">
              {runs.map((r) => (
                <button key={`${r.templateId}-${r.branchId}`} className={`card ops-run ${r.done === r.total ? "ok" : r.overdue ? "bad" : ""}`} onClick={() => setOpenRun(r)}>
                  <span className="ops-run-top">
                    <b>{r.title}</b>
                    <small>{r.branch}</small>
                  </span>
                  <span className="ops-bar">
                    <i style={{ width: `${r.total ? (r.done / r.total) * 100 : 0}%` }} />
                  </span>
                  <small>
                    {r.done}/{r.total}
                    {r.completedAt ? ` · tugadi ${when(r.completedAt).slice(11)}` : r.dueTime ? ` · muddat ${r.dueTime}` : ""}
                    {r.overdue && " · kechikdi"}
                  </small>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <section className="card">
          {!data.templates.length ? (
            <Empty icon={ClipboardCheck} title="Shablonlar yo‘q" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Checklist</th>
                    <th>Filiallar</th>
                    <th>Kunlar</th>
                    <th>Muddat</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.templates.map((t) => (
                    <tr key={t.id} className="clickable" onClick={() => setEditing(t)}>
                      <td>
                        <b>{t.title}</b> {!t.active && <Badge tone="gray">O‘chiq</Badge>}
                        <small className="muted block">{t.items.length} band</small>
                      </td>
                      <td>{t.branchIds.length ? t.branchIds.map((id) => data.branches.find((b) => b.id === id)?.name || "—").join(", ") : "Barcha filiallar"}</td>
                      <td>{t.weekdays.length === 7 ? "Har kuni" : t.weekdays.map((d) => WD[d]).join(", ")}</td>
                      <td>{t.dueTime || "—"}</td>
                      <td className="actions">
                        <button
                          className="icon-btn"
                          title="O‘chirish"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`«${t.title}» o‘chirilsinmi?`)) void api(`/checklists/${t.id}`, { method: "DELETE" }).then(() => reload(true)).catch((r) => toast(errorText(r), "error"));
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {editing && data && (
        <ChecklistModal
          template={editing === "new" ? null : editing}
          branches={data.branches}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            toast("Saqlandi");
            void reload(true);
          }}
        />
      )}
      {openRun && (
        <Modal title={openRun.title} subtitle={`${openRun.branch} · ${dmy(openRun.date)} · ${openRun.done}/${openRun.total}`} onClose={() => setOpenRun(null)}>
          <div className="ops-items">
            {openRun.items.map((i) => (
              <div key={i.id} className={`ops-item ${i.done ? "done" : ""}`}>
                <CheckCircle2 size={18} />
                <span>
                  <b>{i.text}</b>
                  <small className="muted">{i.done ? `${i.by} · ${when(i.at!).slice(11)}${i.note ? ` · ${i.note}` : ""}` : i.requirePhoto ? "rasm bilan" : "belgilanmagan"}</small>
                </span>
                {i.photoId && <Photo id={i.photoId} />}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ChecklistModal({ template, branches, onClose, onDone }: { template: Template | null; branches: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: template?.title || "",
    branchIds: template?.branchIds || [],
    weekdays: template?.weekdays || [0, 1, 2, 3, 4, 5, 6],
    dueTime: template?.dueTime || "",
    active: template?.active ?? true,
  });
  const [items, setItems] = useState(template?.items.map((i) => ({ ...i, requirePhoto: Boolean(i.requirePhoto) })) || [{ id: "", text: "", requirePhoto: false }]);
  async function save() {
    try {
      const body = { ...form, items: items.filter((i) => i.text.trim()).map((i) => ({ id: i.id || undefined, text: i.text, requirePhoto: i.requirePhoto })) };
      if (template) await put(`/checklists/${template.id}`, body);
      else await post("/checklists", body);
      onDone();
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <Modal title={template ? "Checklistni tahrirlash" : "Yangi checklist"} onClose={onClose}>
      <div className="form-grid">
        <Field label="Nomi">
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ertalabki ochilish" />
        </Field>
        <Field label="Shu vaqtgacha tugasin">
          <input className="input" type="time" value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} />
        </Field>
      </div>
      <Field label="Hafta kunlari">
        <div className="ops-chips">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <button key={d} type="button" className={`chip ${form.weekdays.includes(d) ? "on" : ""}`} onClick={() => setForm({ ...form, weekdays: toggle(form.weekdays, d) })}>
              {WD[d]}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Filiallar (tanlanmasa — barchasi)">
        <div className="ops-chips">
          {branches.map((b) => (
            <button key={b.id} type="button" className={`chip ${form.branchIds.includes(b.id) ? "on" : ""}`} onClick={() => setForm({ ...form, branchIds: toggle(form.branchIds, b.id) })}>
              {b.name}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Bandlar">
        <div className="ops-edit-items">
          {items.map((item, idx) => (
            <div key={idx} className="ops-edit-item">
              <input className="input" value={item.text} onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)))} placeholder={`${idx + 1}. Masalan: Kassani ochish`} />
              <label className="lc-check" title="Rasm majburiy">
                <input type="checkbox" checked={item.requirePhoto} onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, requirePhoto: e.target.checked } : x)))} /> <Camera size={14} />
              </label>
              <button className="icon-btn" onClick={() => setItems(items.filter((_, i) => i !== idx))} disabled={items.length === 1}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button className="btn btn-sm" onClick={() => setItems([...items, { id: "", text: "", requirePhoto: false }])}>
            <Plus size={14} /> Band qo‘shish
          </button>
        </div>
      </Field>
      <label className="lc-check">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Faol
      </label>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button className="btn btn-primary" disabled={form.title.trim().length < 2 || !items.some((i) => i.text.trim()) || !form.weekdays.length} onClick={() => void save()}>
          Saqlash
        </button>
      </div>
    </Modal>
  );
}

/* ========================================================== hodisalar === */
type Incident = {
  id: string;
  branch: string;
  branchId: string;
  title: string;
  description?: string;
  category: string;
  categoryLabel: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  reporterName: string;
  assignee?: string;
  photoIds: string[];
  history: { at: string; by: string; status: Incident["status"]; note?: string }[];
  createdAt: string;
  resolvedAt?: string;
};
const INC_STATUS: Record<Incident["status"], [string, string]> = { OPEN: ["Ochiq", "red"], IN_PROGRESS: ["Jarayonda", "amber"], RESOLVED: ["Hal qilindi", "green"] };
const SEVERITY: Record<Incident["severity"], [string, string]> = { LOW: ["Past", "gray"], MEDIUM: ["O‘rta", "amber"], HIGH: ["Jiddiy", "red"] };

export function IncidentsPage() {
  const toast = useToast();
  const [params] = useSearchParams();
  const { data, loading, error, reload } = useApi<{ incidents: Incident[]; categories: Record<string, string>; branches: { id: string; name: string }[] }>("/incidents");
  const [filter, setFilter] = useState<Incident["status"] | "all">("OPEN");
  const [openId, setOpenId] = useState<string | null>(params.get("id"));
  const [adding, setAdding] = useState(false);
  const list = data?.incidents || [];
  const rows = list.filter((i) => filter === "all" || i.status === filter);
  const open = list.find((i) => i.id === openId);
  useEffect(() => {
    const id = params.get("id");
    if (id) setOpenId(id);
  }, [params]);
  const count = (s: Incident["status"]) => list.filter((i) => i.status === s).length;
  return (
    <div className="page">
      <PageHeader
        title="Hodisalar"
        subtitle="Xodimlar Mini App / ilovadan muammoni rasm bilan yuboradi. Ochiq → Jarayonda → Hal qilindi; har o‘tish tarixda qoladi va xodimga xabar boradi."
        actions={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Hodisa qo‘shish
          </button>
        }
      />
      <div className="stat-grid">
        <StatCard label="Ochiq" value={count("OPEN")} icon={AlertTriangle} tone="red" onClick={() => setFilter("OPEN")} selected={filter === "OPEN"} />
        <StatCard label="Jarayonda" value={count("IN_PROGRESS")} icon={Wrench} tone="amber" onClick={() => setFilter("IN_PROGRESS")} selected={filter === "IN_PROGRESS"} />
        <StatCard label="Hal qilingan" value={count("RESOLVED")} icon={CheckCircle2} tone="green" onClick={() => setFilter("RESOLVED")} selected={filter === "RESOLVED"} />
        <StatCard label="Jami" value={list.length} icon={AlertTriangle} tone="violet" onClick={() => setFilter("all")} selected={filter === "all"} />
      </div>
      <section className="card">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !rows.length ? (
          <Empty icon={CheckCircle2} title="Hodisa yo‘q" text="Bu holatda hodisa yo‘q." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Hodisa</th>
                  <th>Filial</th>
                  <th>Kim</th>
                  <th>Holat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className="clickable" onClick={() => setOpenId(i.id)}>
                    <td>
                      <b>{i.title}</b> {i.photoIds.length > 0 && <Camera size={13} className="muted" />}
                      <small className="muted block">
                        {i.categoryLabel} · {when(i.createdAt)}
                      </small>
                    </td>
                    <td>{i.branch}</td>
                    <td>
                      {i.reporterName}
                      {i.assignee && <small className="muted block">→ {i.assignee}</small>}
                    </td>
                    <td>
                      <Badge tone={INC_STATUS[i.status][1]}>{INC_STATUS[i.status][0]}</Badge> {i.severity === "HIGH" && <Badge tone="red">Jiddiy</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open && <IncidentModal incident={open} onClose={() => setOpenId(null)} onChanged={() => void reload(true)} />}
      {adding && data && (
        <NewIncidentModal
          categories={data.categories}
          branches={data.branches}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            toast("Hodisa qo‘shildi");
            void reload(true);
          }}
        />
      )}
    </div>
  );
}

function IncidentModal({ incident, onClose, onChanged }: { incident: Incident; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState(incident.assignee || "");
  async function move(status: Incident["status"]) {
    try {
      await post(`/incidents/${incident.id}/status`, { status, note: note || undefined, assignee });
      setNote("");
      toast(`Holat: ${INC_STATUS[status][0]} — xodimga xabar yuborildi`);
      onChanged();
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  return (
    <Modal title={incident.title} subtitle={`${incident.branch} · ${incident.categoryLabel} · ${incident.reporterName}`} onClose={onClose}>
      <div className="ops-head">
        <Badge tone={INC_STATUS[incident.status][1]}>{INC_STATUS[incident.status][0]}</Badge>
        <Badge tone={SEVERITY[incident.severity][1]}>{SEVERITY[incident.severity][0]}</Badge>
      </div>
      {incident.description && <p className="ops-desc">{incident.description}</p>}
      {!!incident.photoIds.length && (
        <div className="ops-photos">
          {incident.photoIds.map((id) => (
            <Photo key={id} id={id} />
          ))}
        </div>
      )}
      <ol className="ops-timeline">
        {incident.history.map((h, i) => (
          <li key={i}>
            <Badge tone={INC_STATUS[h.status][1]}>{INC_STATUS[h.status][0]}</Badge> <b>{h.by}</b> <small className="muted">{when(h.at)}</small>
            {h.note && <p>{h.note}</p>}
          </li>
        ))}
      </ol>
      <div className="form-grid">
        <Field label="Mas’ul">
          <input className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Kim hal qiladi" />
        </Field>
        <Field label={incident.status === "RESOLVED" ? "Izoh" : "Izoh (hal qilishda majburiy)"}>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nima qilindi" />
        </Field>
      </div>
      <div className="form-actions">
        {incident.status !== "OPEN" && (
          <button className="btn" onClick={() => void move("OPEN")}>
            Qayta ochish
          </button>
        )}
        {incident.status === "OPEN" && (
          <button className="btn" onClick={() => void move("IN_PROGRESS")}>
            <Wrench size={15} /> Jarayonga olish
          </button>
        )}
        {incident.status !== "RESOLVED" && (
          <button className="btn btn-primary" disabled={!note.trim()} onClick={() => void move("RESOLVED")}>
            <CheckCircle2 size={15} /> Hal qilindi
          </button>
        )}
      </div>
    </Modal>
  );
}

function NewIncidentModal({ categories, branches, onClose, onDone }: { categories: Record<string, string>; branches: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: "", description: "", category: "EQUIPMENT", severity: "MEDIUM", branchId: branches[0]?.id || "" });
  const [photo, setPhoto] = useState("");
  const cats = useMemo(() => Object.entries(categories), [categories]);
  async function save() {
    try {
      await post("/incidents", { ...form, description: form.description || undefined, photo: photo || undefined });
      onDone();
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  return (
    <Modal title="Hodisa qo‘shish" onClose={onClose} size="narrow">
      <Field label="Nima bo‘ldi">
        <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Konditsioner ishlamayapti" />
      </Field>
      <div className="form-grid">
        <Field label="Turi">
          <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {cats.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Jiddiyligi">
          <select className="select" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            <option value="LOW">Past</option>
            <option value="MEDIUM">O‘rta</option>
            <option value="HIGH">Jiddiy</option>
          </select>
        </Field>
      </div>
      <Field label="Filial">
        <select className="select" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Tafsilot">
        <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <Field label="Rasm (ixtiyoriy)">
        <input type="file" accept="image/*" onChange={async (e) => e.target.files?.[0] && setPhoto(await fileToDataUrl(e.target.files[0]))} />
      </Field>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button className="btn btn-primary" disabled={form.title.trim().length < 3 || !form.branchId} onClick={() => void save()}>
          Saqlash
        </button>
      </div>
    </Modal>
  );
}
