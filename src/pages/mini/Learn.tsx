import { useCallback, useEffect, useState } from "react";
import { BookOpen, Check, ChevronRight, GraduationCap, IdCard, Pin, RefreshCw, Search, X } from "lucide-react";
import { api, errorText, post } from "../../api";
import { dateUz } from "@/lib/format";
import { Seg, Sheet, SkeletonList, type Toast } from "./shared";
import { haptic } from "./tg";

/*
 * «O‘qish»: kurslar (darslar + test; ball serverda), bilimlar bazasi (qidiruv) va raqamli ID (QR badge).
 */

export type LearnView = "courses" | "kb" | "badge";
type CourseRow = { id: string; title: string; description?: string; lessons: number; questions: number; passPercent: number; dueDate?: string; required: boolean; status: "NEW" | "PASSED" | "FAILED" | "OVERDUE"; best: number; attempts: number };
type CourseFull = { id: string; title: string; description?: string; lessons: { title: string; body: string }[]; questions: { id: string; q: string; options: string[] }[]; passPercent: number; status: string; best: number };
type Article = { id: string; title: string; category: string; pinned: boolean; updatedAt: string; excerpt: string };
type Badge = { qr: string; expiresAt: string; company: string; employee: { name: string; employeeNo: string; photoDataUrl?: string; position: string; branch: string; startDate: string } };

const CHIP: Record<CourseRow["status"], [string, string]> = { NEW: ["Yangi", "warn"], PASSED: ["Topshirildi", "ok"], FAILED: ["Qayta topshiring", "bad"], OVERDUE: ["Muddati o‘tgan", "bad"] };

export function LearnSheet({ onClose, onToast, initialView, focusId }: { onClose: () => void; onToast: Toast; initialView?: LearnView; focusId?: string }) {
  const [view, setView] = useState<LearnView>(initialView || "courses");
  const [course, setCourse] = useState<string | null>(focusId && (initialView || "courses") === "courses" ? focusId : null);
  const [article, setArticle] = useState<string | null>(focusId && initialView === "kb" ? focusId : null);
  if (course) return <CourseSheet id={course} onBack={() => setCourse(null)} onToast={onToast} />;
  if (article) return <ArticleSheet id={article} onBack={() => setArticle(null)} />;
  return (
    <Sheet title="O‘qish va ID" subtitle="Kurslar, bilimlar bazasi, raqamli guvohnoma" onClose={onClose}>
      <Seg
        className="three"
        value={view}
        onChange={(v) => {
          haptic.select();
          setView(v);
        }}
        options={[
          ["courses", "Kurslar"],
          ["kb", "Bilimlar"],
          ["badge", "Mening ID"],
        ]}
      />
      {view === "courses" ? <Courses onOpen={setCourse} /> : view === "kb" ? <Knowledge onOpen={setArticle} /> : <BadgeCard />}
    </Sheet>
  );
}

function Courses({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<CourseRow[] | null>(null);
  useEffect(() => {
    void api<CourseRow[]>("/mini/courses")
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  if (!rows) return <SkeletonList rows={3} />;
  if (!rows.length)
    return (
      <div className="mini-empty">
        <GraduationCap size={28} />
        <b>Kurslar yo‘q</b>
        <small>HR kurs tayinlasa — shu yerda chiqadi.</small>
      </div>
    );
  return (
    <section className="mini-card">
      <div className="mini-rows">
        {rows.map((c) => (
          <button className="mini-row" key={c.id} onClick={() => onOpen(c.id)}>
            <span className="mini-ico">
              <GraduationCap size={18} />
            </span>
            <span>
              <b>{c.title}</b>
              <small>
                {c.lessons} dars · {c.questions} savol{c.dueDate ? ` · ${dateUz(c.dueDate)} gacha` : ""}
                {c.attempts ? ` · eng yaxshi ${c.best}%` : ""}
              </small>
            </span>
            <span className={`mini-chip ${CHIP[c.status][1]}`}>{CHIP[c.status][0]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function CourseSheet({ id, onBack, onToast }: { id: string; onBack: () => void; onToast: Toast }) {
  const [c, setC] = useState<CourseFull | null>(null);
  const [testing, setTesting] = useState(false);
  const [answers, setAnswers] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ score: number; passed: boolean; passPercent: number; wrong: number[]; total: number } | null>(null);
  const [lesson, setLesson] = useState(0);
  const load = useCallback(
    () =>
      api<CourseFull>(`/mini/courses/${id}`)
        .then((v) => {
          setC(v);
          setAnswers(v.questions.map(() => -1));
        })
        .catch((e) => onToast(errorText(e), "error")),
    [id, onToast],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function submit() {
    if (!c) return;
    if (answers.some((a) => a < 0)) return onToast("Barcha savollarga javob bering", "error");
    setBusy(true);
    try {
      const r = await post<NonNullable<typeof result>>(`/mini/courses/${id}/attempt`, { answers });
      setResult(r);
      if (r.passed) haptic.success();
      else haptic.error();
    } catch (e) {
      onToast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }
  if (!c)
    return (
      <Sheet title="Kurs" onClose={onBack}>
        <SkeletonList rows={4} />
      </Sheet>
    );
  if (result)
    return (
      <Sheet title={c.title} onClose={onBack} primary={result.passed ? { text: "Tayyor", onClick: onBack } : { text: "Qayta topshirish", onClick: () => (setResult(null), setAnswers(c.questions.map(() => -1))) }}>
        <section className={`mini-card ln-result ${result.passed ? "ok" : "bad"}`}>
          {result.passed ? <Check size={36} /> : <X size={36} />}
          <b>{result.score}%</b>
          <span>{result.passed ? "Tabriklaymiz — kurs topshirildi!" : `O‘tish uchun ${result.passPercent}% kerak`}</span>
          {result.wrong.length > 0 && <small>Xato savollar: {result.wrong.join(", ")}</small>}
        </section>
      </Sheet>
    );
  if (testing)
    return (
      <Sheet title="Test" subtitle={`${c.questions.length} savol · o‘tish ${c.passPercent}%`} onClose={() => setTesting(false)} primary={{ text: "Javoblarni yuborish", onClick: () => void submit(), busy, disabled: answers.some((a) => a < 0) }}>
        <div className="ln-quiz">
          {c.questions.map((q, i) => (
            <section className="mini-card" key={q.id}>
              <b>
                {i + 1}. {q.q}
              </b>
              {q.options.map((o, j) => (
                <label key={j} className={`ln-opt ${answers[i] === j ? "on" : ""}`}>
                  <input type="radio" name={q.id} checked={answers[i] === j} onChange={() => (haptic.select(), setAnswers(answers.map((a, k) => (k === i ? j : a))))} />
                  {o}
                </label>
              ))}
            </section>
          ))}
        </div>
      </Sheet>
    );
  const current = c.lessons[lesson];
  return (
    <Sheet title={c.title} subtitle={c.description} onClose={onBack} primary={{ text: c.status === "PASSED" ? "Testni qayta yechish" : "Testni boshlash", onClick: () => setTesting(true) }}>
      {c.lessons.length > 0 ? (
        <>
          <div className="ln-steps">
            {c.lessons.map((l, i) => (
              <button key={i} className={i === lesson ? "on" : ""} onClick={() => setLesson(i)}>
                {i + 1}
              </button>
            ))}
          </div>
          <section className="mini-card ln-lesson">
            <b>{current.title}</b>
            <p>{current.body}</p>
          </section>
          {lesson < c.lessons.length - 1 && (
            <button className="mini-btn ghost" onClick={() => setLesson(lesson + 1)}>
              Keyingi dars <ChevronRight size={16} />
            </button>
          )}
        </>
      ) : (
        <p className="mp-note">Bu kursda faqat test bor.</p>
      )}
    </Sheet>
  );
}

function Knowledge({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Article[] | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      void api<Article[]>(`/mini/kb${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)
        .then(setRows)
        .catch(() => setRows([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <>
      <label className="md-search">
        <Search size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qoida, yo‘riqnoma, savol…" />
      </label>
      {!rows ? (
        <SkeletonList rows={3} />
      ) : !rows.length ? (
        <div className="mini-empty">
          <BookOpen size={28} />
          <b>{q ? "Topilmadi" : "Hali maqola yo‘q"}</b>
        </div>
      ) : (
        <section className="mini-card">
          <div className="mini-rows">
            {rows.map((a) => (
              <button className="mini-row" key={a.id} onClick={() => onOpen(a.id)}>
                <span className="mini-ico">{a.pinned ? <Pin size={17} /> : <BookOpen size={17} />}</span>
                <span>
                  <b>{a.title}</b>
                  <small>
                    {a.category} · {a.excerpt}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function ArticleSheet({ id, onBack }: { id: string; onBack: () => void }) {
  const [a, setA] = useState<{ title: string; body: string; category: string; updatedAt: string } | null>(null);
  useEffect(() => {
    void api<typeof a>(`/mini/kb/${id}`)
      .then(setA)
      .catch(() => onBack());
  }, [id, onBack]);
  return (
    <Sheet title={a?.title || "Maqola"} subtitle={a ? `${a.category} · ${dateUz(a.updatedAt.slice(0, 10))}` : undefined} onClose={onBack}>
      {!a ? <SkeletonList rows={4} /> : <article className="mini-card ln-article">{a.body}</article>}
    </Sheet>
  );
}

function BadgeCard() {
  const [b, setB] = useState<Badge | null>(null);
  const [left, setLeft] = useState(0);
  const load = useCallback(() => {
    void api<Badge>("/mini/badge")
      .then(setB)
      .catch(() => setB(null));
  }, []);
  useEffect(load, [load]);
  // QR 2 daqiqa amal qiladi — tugashidan oldin o‘zi yangilanadi.
  useEffect(() => {
    if (!b) return;
    const tick = () => {
      const s = Math.max(0, Math.round((Date.parse(b.expiresAt) - Date.now()) / 1000));
      setLeft(s);
      if (s <= 5) load();
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [b, load]);
  if (!b) return <SkeletonList rows={3} />;
  return (
    <section className="mini-card ln-badge">
      <div className="ln-badge-top">
        <IdCard size={16} /> {b.company}
      </div>
      <div className="ln-badge-person">
        {b.employee.photoDataUrl ? <img src={b.employee.photoDataUrl} alt="" /> : <span className="ln-badge-ph">{b.employee.name.slice(0, 1)}</span>}
        <span>
          <b>{b.employee.name}</b>
          <small>{b.employee.position}</small>
          <small>
            {b.employee.branch} · {b.employee.employeeNo}
          </small>
        </span>
      </div>
      <img className="ln-qr" src={b.qr} alt="Xodim QR kodi" />
      <small className="ln-timer">
        <RefreshCw size={12} /> QR {left} soniyadan keyin yangilanadi — skrinshot ishlamaydi
      </small>
    </section>
  );
}
