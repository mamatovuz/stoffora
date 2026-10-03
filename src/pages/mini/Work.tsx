import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Camera, Check, CheckCircle2, Circle, ClipboardCheck, ListTodo, Play } from "lucide-react";
import { api, errorText, post } from "../../api";
import { dateUz, tashkentClock } from "@/lib/format";
import { fileToDataUrl } from "../../components/Documents";
import { getCached, setCached } from "../miniCache";
import { EmptyArt, Seg, Sheet, SkeletonList, type Toast } from "./shared";
import { confirmNative, haptic } from "./tg";

/*
 * «Ishlarim»: menga berilgan vazifalar, filialimning bugungi checklistlari va men yuborgan hodisalar.
 * Rasm — telefon kamerasidan (fotohisobot).
 */

export type WorkView = "tasks" | "checklist" | "incidents";
type Task = {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  priority: "LOW" | "NORMAL" | "HIGH";
  requirePhoto?: boolean;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  createdBy: string;
  overdue: boolean;
  comments: { by: string; text: string; at: string }[];
};
type Run = {
  templateId: string;
  title: string;
  dueTime?: string;
  items: { id: string; text: string; requirePhoto?: boolean; done: boolean; by?: string; at?: string }[];
  done: number;
  total: number;
  overdue: boolean;
};
type Incident = { id: string; title: string; categoryLabel: string; status: "OPEN" | "IN_PROGRESS" | "RESOLVED"; createdAt: string; history: { at: string; by: string; status: string; note?: string }[] };
type Work = { tasks: Task[]; checklists: Run[]; incidents: Incident[]; categories: Record<string, string> };

const taskChip: Record<Task["status"], [string, string]> = { TODO: ["Yangi", "warn"], IN_PROGRESS: ["Jarayonda", "warn"], DONE: ["Bajarildi", "ok"], CANCELLED: ["Bekor", ""] };
const incChip: Record<Incident["status"], [string, string]> = { OPEN: ["Ochiq", "bad"], IN_PROGRESS: ["Jarayonda", "warn"], RESOLVED: ["Hal qilindi", "ok"] };

/** Kameradan rasm olib dataUrl qaytaradi (bekor qilinsa — null). */
function usePhotoPicker() {
  const input = useRef<HTMLInputElement | null>(null);
  const resolver = useRef<((v: string | null) => void) | null>(null);
  const pick = () =>
    new Promise<string | null>((resolve) => {
      resolver.current = resolve;
      input.current?.click();
    });
  const element = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      capture="environment"
      hidden
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        resolver.current?.(file ? await fileToDataUrl(file).catch(() => null) : null);
      }}
    />
  );
  return { pick, element };
}

export function WorkSheet({ onClose, onToast, initialView, focusId }: { onClose: () => void; onToast: Toast; initialView?: WorkView; focusId?: string }) {
  const [view, setView] = useState<WorkView>(initialView || "tasks");
  const [data, setData] = useState<Work | null>(() => getCached("work"));
  const [busy, setBusy] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(focusId || null);
  const photo = usePhotoPicker();
  const load = useCallback(
    () =>
      api<Work>("/mini/work")
        .then((value) => {
          setCached("work", value);
          setData(value);
        })
        .catch((reason) => onToast(errorText(reason), "error")),
    [onToast],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      haptic.success();
      onToast(ok);
      await load();
    } catch (reason) {
      haptic.error();
      onToast(errorText(reason), "error");
    } finally {
      setBusy(null);
    }
  }
  async function finishTask(t: Task) {
    let image: string | null = null;
    if (t.requirePhoto) {
      onToast("Natija rasmini oling");
      image = await photo.pick();
      if (!image) return;
    } else if (!(await confirmNative(`«${t.title}» bajarildimi?`, { ok: "Ha, bajarildi" }))) return;
    await run(t.id, () => post(`/mini/tasks/${t.id}/status`, { status: "DONE", photo: image || undefined }), "Bajarildi — rahbarga xabar ketdi");
  }
  async function toggleItem(r: Run, item: Run["items"][number]) {
    let image: string | null = null;
    if (!item.done && item.requirePhoto) {
      image = await photo.pick();
      if (!image) return;
    }
    await run(`${r.templateId}:${item.id}`, () => post(`/mini/checklists/${r.templateId}/items/${item.id}`, { done: !item.done, photo: image || undefined }), item.done ? "Belgi olib tashlandi" : "Belgilandi");
  }

  if (reporting && data)
    return (
      <IncidentForm
        categories={data.categories}
        onClose={() => setReporting(false)}
        onSaved={() => {
          setReporting(false);
          setView("incidents");
          haptic.success();
          onToast("Yuborildi — rahbar ko‘radi, holati shu yerda");
          void load();
        }}
      />
    );

  const active = (data?.tasks || []).filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
  const done = (data?.tasks || []).filter((t) => t.status === "DONE");
  const checklistLeft = (data?.checklists || []).reduce((n, r) => n + r.total - r.done, 0);
  return (
    <Sheet title="Ishlarim" subtitle="Vazifalar, checklist va muammolar" onClose={onClose} primary={view === "incidents" ? { text: "Muammo haqida xabar berish", onClick: () => setReporting(true) } : null}>
      {photo.element}
      <Seg
        className="three"
        value={view}
        onChange={(next) => {
          haptic.select();
          setView(next);
        }}
        options={[
          ["tasks", `Vazifalar${active.length ? ` · ${active.length}` : ""}`],
          ["checklist", `Checklist${checklistLeft ? ` · ${checklistLeft}` : ""}`],
          ["incidents", "Muammolar"],
        ]}
      />
      {!data ? (
        <SkeletonList rows={3} />
      ) : view === "tasks" ? (
        !data.tasks.length ? (
          <div className="mini-empty">
            <EmptyArt kind="check" />
            <b>Vazifalar yo‘q</b>
            <small>Rahbar vazifa bersa — shu yerda va Telegram’da ko‘rasiz.</small>
          </div>
        ) : (
          <>
            {active.map((t) => (
              <section className={`mini-card wk-task ${t.overdue ? "late" : ""}`} key={t.id}>
                <button className="wk-task-head" onClick={() => setOpenTask(openTask === t.id ? null : t.id)}>
                  <span className="mini-ico">
                    <ListTodo size={18} />
                  </span>
                  <span>
                    <b>{t.title}</b>
                    <small>
                      {t.createdBy}
                      {t.dueDate ? ` · muddat ${dateUz(t.dueDate)}` : ""}
                      {t.overdue ? " · kechikdi" : ""}
                    </small>
                  </span>
                  <span className={`mini-chip ${t.priority === "HIGH" ? "bad" : taskChip[t.status][1]}`}>{t.priority === "HIGH" ? "Muhim" : taskChip[t.status][0]}</span>
                </button>
                {openTask === t.id && (
                  <div className="wk-task-body">
                    {t.description && <p>{t.description}</p>}
                    {t.comments.slice(-3).map((c, i) => (
                      <small key={i}>
                        <b>{c.by}:</b> {c.text}
                      </small>
                    ))}
                  </div>
                )}
                <div className="sw-actions">
                  {t.status === "TODO" && (
                    <button className="mini-btn sm ghost" disabled={busy === t.id} onClick={() => void run(t.id, () => post(`/mini/tasks/${t.id}/status`, { status: "IN_PROGRESS" }), "Boshlandi")}>
                      <Play size={15} /> Boshladim
                    </button>
                  )}
                  <button className="mini-btn sm" disabled={busy === t.id} onClick={() => void finishTask(t)}>
                    {t.requirePhoto ? <Camera size={15} /> : <Check size={15} />} Bajarildi
                  </button>
                </div>
              </section>
            ))}
            {done.length > 0 && (
              <section className="mini-card">
                <div className="mini-rows">
                  {done.map((t) => (
                    <div className="mini-row" key={t.id}>
                      <span className="mini-ico">
                        <CheckCircle2 size={18} />
                      </span>
                      <span>
                        <b>{t.title}</b>
                        <small>{t.createdBy}</small>
                      </span>
                      <span className="mini-chip ok">Bajarildi</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )
      ) : view === "checklist" ? (
        !data.checklists.length ? (
          <div className="mini-empty">
            <ClipboardCheck size={28} />
            <b>Bugun checklist yo‘q</b>
            <small>Filialingiz uchun kundalik ro‘yxat bo‘lsa — shu yerda chiqadi.</small>
          </div>
        ) : (
          data.checklists.map((r) => (
            <section className={`mini-card wk-run ${r.done === r.total ? "ok" : r.overdue ? "late" : ""}`} key={r.templateId}>
              <div className="wk-run-head">
                <b>{r.title}</b>
                <small>
                  {r.done}/{r.total}
                  {r.dueTime ? ` · ${r.dueTime} gacha` : ""}
                </small>
              </div>
              <span className="wk-bar">
                <i style={{ width: `${r.total ? (r.done / r.total) * 100 : 0}%` }} />
              </span>
              {r.items.map((item) => (
                <button key={item.id} className={`wk-item ${item.done ? "done" : ""}`} disabled={busy === `${r.templateId}:${item.id}`} onClick={() => void toggleItem(r, item)}>
                  {item.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                  <span>
                    {item.text}
                    {item.done ? <small>{`${item.by} · ${item.at ? tashkentClock(new Date(item.at)) : ""}`}</small> : item.requirePhoto ? <small>📷 rasm bilan</small> : null}
                  </span>
                </button>
              ))}
            </section>
          ))
        )
      ) : !data.incidents.length ? (
        <div className="mini-empty">
          <AlertTriangle size={28} />
          <b>Muammo yo‘q</b>
          <small>Jihoz buzildimi, internet yo‘qmi, xavfli holatmi — rasm bilan yuboring, rahbar darhol ko‘radi.</small>
        </div>
      ) : (
        <section className="mini-card">
          <div className="mini-rows">
            {data.incidents.map((i) => {
              const last = i.history[i.history.length - 1];
              return (
                <div className="mini-row" key={i.id}>
                  <span className="mini-ico">
                    <AlertTriangle size={18} />
                  </span>
                  <span>
                    <b>{i.title}</b>
                    <small>
                      {i.categoryLabel} · {dateUz(i.createdAt.slice(0, 10))}
                    </small>
                    {last?.note && i.status !== "OPEN" && <small>{last.note}</small>}
                  </span>
                  <span className={`mini-chip ${incChip[i.status][1]}`}>{incChip[i.status][0]}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </Sheet>
  );
}

function IncidentForm({ categories, onClose, onSaved }: { categories: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: "", description: "", category: "EQUIPMENT", severity: "MEDIUM" });
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const photo = usePhotoPicker();
  async function save() {
    if (form.title.trim().length < 3) return setError("Qisqacha nima bo‘lganini yozing.");
    setBusy(true);
    setError("");
    try {
      await post("/mini/incidents", { ...form, description: form.description || undefined, photo: image || undefined });
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="Muammo haqida xabar" subtitle="Rahbar va mas’ullarga darhol boradi" onClose={onClose} primary={{ text: "Yuborish", onClick: () => void save(), busy }}>
      {photo.element}
      <form onSubmit={(e) => (e.preventDefault(), void save())}>
        <label>
          Nima bo‘ldi
          <input value={form.title} maxLength={140} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Masalan: kassa printeri ishlamayapti" />
        </label>
        <label>
          Turi
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.entries(categories).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Jiddiyligi
          <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            <option value="LOW">Past — kutsa bo‘ladi</option>
            <option value="MEDIUM">O‘rta</option>
            <option value="HIGH">Jiddiy — ish to‘xtadi / xavfli</option>
          </select>
        </label>
        <label>
          Tafsilot (ixtiyoriy)
          <textarea value={form.description} maxLength={1500} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <button type="button" className="mini-btn ghost" onClick={async () => setImage((await photo.pick()) || image)}>
          <Camera size={17} /> {image ? "Rasm olindi ✓ (qayta olish)" : "Rasm olish"}
        </button>
        {image && <img src={image} alt="" className="wk-preview" />}
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
