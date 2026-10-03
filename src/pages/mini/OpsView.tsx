import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, ListTodo, Wrench } from "lucide-react";
import { SkeletonList } from "./shared";
import { haptic } from "./tg";

/*
 * Rahbar (Mini App) — «Operatsiya»: bugungi checklistlar (filial bo‘yicha), ochiq hodisalar
 * (Jarayonga olish / Hal qilindi) va ochiq vazifalar. Panel API’lari — huquq serverda tekshiriladi.
 */

type Call = <T>(url: string, body?: unknown, method?: string) => Promise<T>;
type Toast = (text: string, tone?: "ok" | "error") => void;
type Run = { templateId: string; title: string; branch: string; branchId: string; done: number; total: number; dueTime?: string; overdue: boolean };
type Incident = { id: string; title: string; branch: string; categoryLabel: string; severity: "LOW" | "MEDIUM" | "HIGH"; status: "OPEN" | "IN_PROGRESS" | "RESOLVED"; reporterName: string; assignee?: string; createdAt: string; description?: string };
type Task = { id: string; title: string; assignees: { name: string }[]; dueDate?: string; status: string; overdue: boolean };
type Summary = { openTasks: number; overdueTasks: number; openIncidents: number; highIncidents: number; checklists: { total: number; done: number; overdue: number }; runs: Run[]; incidents: Incident[]; tasks: Task[] };

const dmy = (iso?: string) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "");

export function OpsView({ call, onToast }: { call: Call; onToast: Toast }) {
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const fail = useCallback((e: unknown) => onToast(e instanceof Error ? e.message : "Xatolik", "error"), [onToast]);
  const load = useCallback(() => {
    call<Summary>("/ops/summary")
      .then(setData)
      .catch((e) => fail(e));
  }, [call, fail]);
  useEffect(load, [load]);

  async function move(i: Incident, status: Incident["status"], text?: string) {
    setBusy(i.id);
    try {
      await call(`/incidents/${i.id}/status`, { status, note: text || undefined });
      haptic.success();
      onToast(status === "RESOLVED" ? "Hal qilindi — xodimga xabar ketdi" : "Jarayonga olindi");
      setResolving(null);
      setNote("");
      load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <SkeletonList rows={4} />;
  return (
    <>
      <div className="op-stats">
        <span className={data.openIncidents ? "bad" : ""}>
          <b>{data.openIncidents}</b>
          <small>ochiq hodisa</small>
        </span>
        <span className={data.checklists.overdue ? "bad" : ""}>
          <b>
            {data.checklists.done}/{data.checklists.total}
          </b>
          <small>checklist</small>
        </span>
        <span className={data.overdueTasks ? "bad" : ""}>
          <b>{data.openTasks}</b>
          <small>ochiq vazifa{data.overdueTasks ? ` · ${data.overdueTasks} kechikdi` : ""}</small>
        </span>
      </div>

      {data.runs.length > 0 && (
        <section className="mini-card">
          <div className="sw-head">
            <ClipboardCheck size={16} /> Bugungi checklistlar
          </div>
          {data.runs.map((r) => (
            <div key={`${r.templateId}-${r.branchId}`} className={`wk-run ${r.done === r.total ? "ok" : r.overdue ? "late" : ""}`} style={{ padding: "8px 0" }}>
              <div className="wk-run-head">
                <b>
                  {r.title} · {r.branch}
                </b>
                <small>
                  {r.done}/{r.total}
                  {r.overdue ? " · kechikdi" : r.dueTime ? ` · ${r.dueTime}` : ""}
                </small>
              </div>
              <span className="wk-bar">
                <i style={{ width: `${r.total ? (r.done / r.total) * 100 : 0}%` }} />
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="mini-card">
        <div className="sw-head">
          <AlertTriangle size={16} /> Hodisalar
        </div>
        {!data.incidents.length ? (
          <div className="mini-empty">
            <CheckCircle2 size={26} />
            Ochiq hodisa yo‘q
          </div>
        ) : (
          data.incidents.map((i) => (
            <div className="sw-item" key={i.id}>
              <p>
                {i.severity === "HIGH" && "🔴 "}
                <b>{i.title}</b>
                <br />
                <small>
                  {i.branch} · {i.categoryLabel} · {i.reporterName} · {dmy(i.createdAt)}
                  {i.assignee ? ` · → ${i.assignee}` : ""}
                </small>
              </p>
              {i.description && <small>{i.description}</small>}
              {resolving === i.id ? (
                <div className="op-resolve">
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nima qilindi?" autoFocus />
                  <button className="mini-btn sm" disabled={!note.trim() || busy === i.id} onClick={() => void move(i, "RESOLVED", note)}>
                    Saqlash
                  </button>
                </div>
              ) : (
                <div className="sw-actions">
                  {i.status === "OPEN" && (
                    <button className="mini-btn sm ghost" disabled={busy === i.id} onClick={() => void move(i, "IN_PROGRESS")}>
                      <Wrench size={15} /> Jarayonga
                    </button>
                  )}
                  <button className="mini-btn sm" disabled={busy === i.id} onClick={() => (setResolving(i.id), setNote(""))}>
                    <CheckCircle2 size={15} /> Hal qilindi
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </section>

      {data.tasks.length > 0 && (
        <section className="mini-card">
          <div className="sw-head">
            <ListTodo size={16} /> Ochiq vazifalar
          </div>
          <div className="mini-rows">
            {data.tasks.map((t) => (
              <div className="mini-row" key={t.id}>
                <span className="mini-ico">
                  <ListTodo size={18} />
                </span>
                <span>
                  <b>{t.title}</b>
                  <small>
                    {t.assignees.map((a) => a.name).join(", ").slice(0, 60)}
                    {t.dueDate ? ` · ${dmy(t.dueDate)}` : ""}
                  </small>
                </span>
                <span className={`mini-chip ${t.overdue ? "bad" : "warn"}`}>{t.overdue ? "Kechikdi" : t.status === "IN_PROGRESS" ? "Jarayonda" : "Yangi"}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
