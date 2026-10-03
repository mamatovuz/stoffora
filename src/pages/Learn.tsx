import { useState } from "react";
import { BookOpen, CheckCircle2, GraduationCap, Pin, Plus, Search, Trash2, Users } from "lucide-react";
import { api, errorText, post, put } from "../api";
import { useApi } from "../hooks";
import { useAuth } from "../auth";
import { can } from "@/lib/permissions";
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, StatCard, useToast } from "../components/ui";

/*
 * Bilimlar bazasi (qoidalar, yo‘riqnomalar, FAQ) va o‘qitish (kurs + test, natijalar).
 * Xodimlar Mini App / ilovada o‘qiydi va test topshiradi; ball serverda hisoblanadi.
 */

type Target = { type: "ALL" | "BRANCHES" | "DEPARTMENTS" | "POSITIONS" | "EMPLOYEES"; ids: string[] };
type Article = { id: string; title: string; body: string; category: string; pinned: boolean; target: Target; audience: string; views: number; updatedAt: string; createdBy: string };
type Question = { id?: string; q: string; options: string[]; correct: number };
type Course = {
  id: string;
  title: string;
  description?: string;
  lessons: { title: string; body: string }[];
  questions: Question[];
  passPercent: number;
  target: Target;
  audience: string;
  dueDate?: string;
  required: boolean;
  active: boolean;
  stats: { assigned: number; passed: number; failed: number; overdue: number };
};
type Named = { id: string; name: string };
const dmy = (iso?: string) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "");

/** Auditoriya tanlash: hamma yoki filiallar / bo‘limlar / lavozimlar. */
function TargetPicker({ value, onChange }: { value: Target; onChange: (t: Target) => void }) {
  const { data: branches } = useApi<Named[]>("/branches");
  const { data: departments } = useApi<Named[]>("/departments");
  const { data: positions } = useApi<Named[]>("/positions");
  const list = value.type === "BRANCHES" ? branches : value.type === "DEPARTMENTS" ? departments : value.type === "POSITIONS" ? positions : [];
  return (
    <Field label="Kimlar uchun">
      <select className="select" value={value.type} onChange={(e) => onChange({ type: e.target.value as Target["type"], ids: [] })}>
        <option value="ALL">Barcha xodimlar</option>
        <option value="BRANCHES">Filiallar</option>
        <option value="DEPARTMENTS">Bo‘limlar</option>
        <option value="POSITIONS">Lavozimlar</option>
      </select>
      {value.type !== "ALL" && (
        <div className="ops-chips" style={{ marginTop: 8 }}>
          {(list || []).map((x) => (
            <button key={x.id} type="button" className={`chip ${value.ids.includes(x.id) ? "on" : ""}`} onClick={() => onChange({ ...value, ids: value.ids.includes(x.id) ? value.ids.filter((i) => i !== x.id) : [...value.ids, x.id] })}>
              {x.name}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}

/* ====================================================== bilimlar bazasi === */
export function KnowledgePage() {
  const toast = useToast();
  const { user } = useAuth();
  const manage = Boolean(user && can(user.role, "kb.manage"));
  const { data, loading, error, reload } = useApi<Article[]>("/kb");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Article | "new" | null>(null);
  const [open, setOpen] = useState<Article | null>(null);
  const rows = (data || []).filter((a) => `${a.title} ${a.body} ${a.category}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page narrow">
      <PageHeader
        title="Bilimlar bazasi"
        subtitle="Qoidalar, yo‘riqnomalar va ko‘p so‘raladigan savollar — xodimlar Mini App / ilovada o‘qiydi va qidiradi."
        actions={
          manage && (
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              <Plus size={16} /> Maqola
            </button>
          )
        }
      />
      <section className="card">
        <div className="filters">
          <span className="input-icon">
            <Search size={16} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidirish…" />
          </span>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !rows.length ? (
          <Empty icon={BookOpen} title="Maqolalar yo‘q" text="Ichki qoidalar, kassa yo‘riqnomasi, ta’til tartibi kabi maqolalar qo‘shing." />
        ) : (
          <div className="kb-list">
            {rows.map((a) => (
              <button key={a.id} className="kb-item" onClick={() => setOpen(a)}>
                <span className="kb-ico">{a.pinned ? <Pin size={16} /> : <BookOpen size={16} />}</span>
                <span>
                  <b>{a.title}</b>
                  <small>
                    {a.category} · {a.audience} · 👁 {a.views} · {dmy(a.updatedAt)}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      {open && (
        <Modal title={open.title} subtitle={`${open.category} · ${open.audience}`} onClose={() => setOpen(null)} size="wide">
          <article className="kb-body">{open.body}</article>
          {manage && (
            <div className="form-actions">
              <button
                className="icon-btn"
                title="O‘chirish"
                onClick={() => confirm("Maqola o‘chirilsinmi?") && void api(`/kb/${open.id}`, { method: "DELETE" }).then(() => (setOpen(null), reload(true))).catch((r) => toast(errorText(r), "error"))}
              >
                <Trash2 size={15} />
              </button>
              <button className="btn" onClick={() => (setEditing(open), setOpen(null))}>
                Tahrirlash
              </button>
            </div>
          )}
        </Modal>
      )}
      {editing && <ArticleModal article={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => (setEditing(null), toast("Saqlandi"), void reload(true))} />}
    </div>
  );
}

function ArticleModal({ article, onClose, onDone }: { article: Article | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: article?.title || "", body: article?.body || "", category: article?.category || "Umumiy", pinned: article?.pinned || false, target: article?.target || ({ type: "ALL", ids: [] } as Target) });
  async function save() {
    try {
      if (article) await put(`/kb/${article.id}`, form);
      else await post("/kb", form);
      onDone();
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  return (
    <Modal title={article ? "Maqolani tahrirlash" : "Yangi maqola"} onClose={onClose} size="wide">
      <div className="form-grid">
        <Field label="Sarlavha">
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Masalan: Ta’til olish tartibi" />
        </Field>
        <Field label="Bo‘lim">
          <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Qoidalar / Kassa / HR" />
        </Field>
      </div>
      <Field label="Matn">
        <textarea className="input" rows={12} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
      </Field>
      <TargetPicker value={form.target} onChange={(target) => setForm({ ...form, target })} />
      <label className="lc-check">
        <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} /> Tepada qadab qo‘yish
      </label>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button className="btn btn-primary" disabled={form.title.trim().length < 3 || form.body.trim().length < 5} onClick={() => void save()}>
          Saqlash
        </button>
      </div>
    </Modal>
  );
}

/* ============================================================ o‘qitish === */
export function LearningPage() {
  const toast = useToast();
  const { user } = useAuth();
  const manage = Boolean(user && can(user.role, "learning.manage"));
  const { data, loading, error, reload } = useApi<Course[]>("/courses");
  const [editing, setEditing] = useState<Course | "new" | null>(null);
  const [results, setResults] = useState<Course | null>(null);
  const all = data || [];
  const sum = (k: keyof Course["stats"]) => all.reduce((n, c) => n + c.stats[k], 0);
  return (
    <div className="page">
      <PageHeader
        title="O‘qitish"
        subtitle="Kurs = darslar + test. Xodimlar Mini App / ilovada o‘qiydi, test topshiradi; natija va muddati o‘tganlar shu yerda."
        actions={
          manage && (
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              <Plus size={16} /> Kurs
            </button>
          )
        }
      />
      <div className="stat-grid">
        <StatCard label="Kurslar" value={all.length} icon={GraduationCap} tone="blue" />
        <StatCard label="Topshirgan" value={sum("passed")} icon={CheckCircle2} tone="green" />
        <StatCard label="Yiqilgan" value={sum("failed")} icon={GraduationCap} tone="amber" />
        <StatCard label="Muddati o‘tgan" value={sum("overdue")} icon={GraduationCap} tone="red" />
      </div>
      <section className="card">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !all.length ? (
          <Empty icon={GraduationCap} title="Kurslar yo‘q" text="Masalan: «Kassa bilan ishlash», «Xavfsizlik texnikasi», «Mijozga xizmat» kursini yarating." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Kurs</th>
                  <th>Kimlar uchun</th>
                  <th>Natija</th>
                  <th>Muddat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {all.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <b>{c.title}</b> {!c.active && <span className="badge gray">O‘chiq</span>} {c.required && <span className="badge blue">Majburiy</span>}
                      <small className="muted block">
                        {c.lessons.length} dars · {c.questions.length} savol · o‘tish {c.passPercent}%
                      </small>
                    </td>
                    <td>{c.audience}</td>
                    <td>
                      <div className="ln-progress">
                        <i style={{ width: `${c.stats.assigned ? (c.stats.passed / c.stats.assigned) * 100 : 0}%` }} />
                      </div>
                      <small className="muted">
                        {c.stats.passed}/{c.stats.assigned} topshirdi{c.stats.overdue ? ` · ${c.stats.overdue} muddati o‘tgan` : ""}
                      </small>
                    </td>
                    <td>{c.dueDate ? dmy(c.dueDate) : "—"}</td>
                    <td className="actions">
                      <button className="btn btn-sm" onClick={() => setResults(c)}>
                        <Users size={14} /> Natijalar
                      </button>
                      {manage && (
                        <>
                          <button className="btn btn-sm" onClick={() => setEditing(c)}>
                            Tahrirlash
                          </button>
                          <button className="icon-btn" title="O‘chirish" onClick={() => confirm(`«${c.title}» va natijalari o‘chirilsinmi?`) && void api(`/courses/${c.id}`, { method: "DELETE" }).then(() => reload(true)).catch((r) => toast(errorText(r), "error"))}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {results && <ResultsModal course={results} onClose={() => setResults(null)} />}
      {editing && <CourseModal course={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => (setEditing(null), toast("Saqlandi — xodimlarga xabar ketdi"), void reload(true))} />}
    </div>
  );
}

function ResultsModal({ course, onClose }: { course: Course; onClose: () => void }) {
  const { data, loading } = useApi<{ employeeId: string; name: string; branch: string; status: string; best: number; attempts: number; passedAt?: string }[]>(`/courses/${course.id}/results`);
  const LABEL: Record<string, [string, string]> = { PASSED: ["Topshirdi", "green"], FAILED: ["Yiqildi", "amber"], OVERDUE: ["Muddati o‘tgan", "red"], NEW: ["Boshlamagan", "gray"] };
  return (
    <Modal title={course.title} subtitle="Xodimlar natijalari" onClose={onClose} size="wide">
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Xodim</th>
                <th>Holat</th>
                <th>Eng yaxshi</th>
                <th>Urinish</th>
              </tr>
            </thead>
            <tbody>
              {(data || []).map((r) => (
                <tr key={r.employeeId}>
                  <td>
                    {r.name}
                    <small className="muted block">{r.branch}</small>
                  </td>
                  <td>
                    <span className={`badge ${LABEL[r.status]?.[1] || "gray"}`}>{LABEL[r.status]?.[0] || r.status}</span>
                    {r.passedAt && <small className="muted block">{dmy(r.passedAt)}</small>}
                  </td>
                  <td>{r.attempts ? `${r.best}%` : "—"}</td>
                  <td>{r.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function CourseModal({ course, onClose, onDone }: { course: Course | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: course?.title || "",
    description: course?.description || "",
    passPercent: course?.passPercent || 70,
    dueDate: course?.dueDate || "",
    required: course?.required ?? true,
    active: course?.active ?? true,
    target: course?.target || ({ type: "ALL", ids: [] } as Target),
  });
  const [lessons, setLessons] = useState(course?.lessons || [{ title: "", body: "" }]);
  const [questions, setQuestions] = useState<Question[]>(course?.questions || [{ q: "", options: ["", ""], correct: 0 }]);
  const setQ = (i: number, patch: Partial<Question>) => setQuestions(questions.map((q, k) => (k === i ? { ...q, ...patch } : q)));
  async function save() {
    try {
      const body = {
        ...form,
        lessons: lessons.filter((l) => l.title.trim() && l.body.trim()),
        questions: questions.map((q) => ({ ...q, options: q.options.map((o) => o.trim()).filter(Boolean) })),
      };
      if (course) await put(`/courses/${course.id}`, body);
      else await post("/courses", body);
      onDone();
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  const valid = form.title.trim().length >= 3 && questions.length > 0 && questions.every((q) => q.q.trim().length >= 3 && q.options.filter((o) => o.trim()).length >= 2 && q.options[q.correct]?.trim());
  return (
    <Modal title={course ? "Kursni tahrirlash" : "Yangi kurs"} onClose={onClose} size="wide">
      <div className="form-grid">
        <Field label="Nomi">
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Kassa bilan ishlash" />
        </Field>
        <Field label="O‘tish foizi">
          <input className="input" type="number" min={10} max={100} value={form.passPercent} onChange={(e) => setForm({ ...form, passPercent: Number(e.target.value) || 70 })} />
        </Field>
        <Field label="Muddat (ixtiyoriy)">
          <input className="input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
        </Field>
      </div>
      <Field label="Qisqacha tavsif">
        <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <TargetPicker value={form.target} onChange={(target) => setForm({ ...form, target })} />
      <div className="ops-chips">
        <label className="lc-check">
          <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} /> Majburiy
        </label>
        <label className="lc-check">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Faol
        </label>
      </div>
      <h4 className="ln-h">Darslar</h4>
      {lessons.map((l, i) => (
        <div key={i} className="ln-edit">
          <input className="input" value={l.title} onChange={(e) => setLessons(lessons.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} placeholder={`${i + 1}-dars sarlavhasi`} />
          <textarea className="input" rows={4} value={l.body} onChange={(e) => setLessons(lessons.map((x, k) => (k === i ? { ...x, body: e.target.value } : x)))} placeholder="Dars matni" />
          <button className="icon-btn" onClick={() => setLessons(lessons.filter((_, k) => k !== i))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button className="btn btn-sm" onClick={() => setLessons([...lessons, { title: "", body: "" }])}>
        <Plus size={14} /> Dars
      </button>
      <h4 className="ln-h">Test savollari (to‘g‘ri javobni belgilang)</h4>
      {questions.map((q, i) => (
        <div key={i} className="ln-edit">
          <input className="input" value={q.q} onChange={(e) => setQ(i, { q: e.target.value })} placeholder={`${i + 1}-savol`} />
          {q.options.map((o, j) => (
            <div key={j} className="ln-opt-edit">
              <input type="radio" name={`c${i}`} checked={q.correct === j} onChange={() => setQ(i, { correct: j })} title="To‘g‘ri javob" />
              <input className="input" value={o} onChange={(e) => setQ(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })} placeholder={`Variant ${j + 1}`} />
              {q.options.length > 2 && (
                <button className="icon-btn" onClick={() => setQ(i, { options: q.options.filter((_, k) => k !== j), correct: q.correct === j ? 0 : q.correct > j ? q.correct - 1 : q.correct })}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          <div className="ops-chips">
            {q.options.length < 6 && (
              <button className="btn btn-sm" onClick={() => setQ(i, { options: [...q.options, ""] })}>
                <Plus size={13} /> Variant
              </button>
            )}
            {questions.length > 1 && (
              <button className="btn btn-sm" onClick={() => setQuestions(questions.filter((_, k) => k !== i))}>
                <Trash2 size={13} /> Savolni o‘chirish
              </button>
            )}
          </div>
        </div>
      ))}
      <button className="btn btn-sm" onClick={() => setQuestions([...questions, { q: "", options: ["", ""], correct: 0 }])}>
        <Plus size={14} /> Savol
      </button>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button className="btn btn-primary" disabled={!valid} onClick={() => void save()}>
          Saqlash
        </button>
      </div>
    </Modal>
  );
}
