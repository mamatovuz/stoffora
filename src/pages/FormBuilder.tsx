import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Calendar,
  CheckSquare,
  Clock3,
  Hash,
  ListChecks,
  Lock,
  MessageSquareText,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Shuffle,
  Trash2,
  Type,
  User,
  Wallet,
  X,
  Briefcase,
  LoaderCircle,
} from "lucide-react";
import { api, errorText, put } from "../api";
import { useApi } from "../hooks";
import { Confirm, ErrorBox, Loading, useToast } from "../components/ui";
import type { QuestionType, RegistrationForm, RegistrationQuestion } from "@/lib/types";

/*
 * Bot anketasi muharriri: savollarni qo‘shish, o‘chirish, tahrirlash, tartibini
 * almashtirish va variantlarni boshqarish. O‘ngda — botda qanday ko‘rinishi.
 */

type FormResponse = {
  form: RegistrationForm;
  defaults: { intro: string; submittedText: string; approvedText: string };
  builtins: Record<string, { label: string; locked: boolean; type: QuestionType }>;
  customTypes: QuestionType[];
  companyName: string;
  positions: string[];
  branches: string[];
};

const typeMeta: Record<QuestionType, { label: string; icon: typeof Type; example?: string }> = {
  name: { label: "Ism-familiya", icon: User, example: "Ali Valiyev" },
  text: { label: "Matn", icon: Type, example: "Erkin javob" },
  number: { label: "Raqam", icon: Hash, example: "5" },
  date: { label: "Sana", icon: Calendar, example: "12.05.2026" },
  birthdate: { label: "Tug‘ilgan sana", icon: Calendar, example: "29.08.1995" },
  phone: { label: "Telefon", icon: Phone, example: "+998901234567" },
  money: { label: "Summa", icon: Wallet, example: "4 000 000" },
  choice: { label: "Variant tanlash", icon: ListChecks },
  yesno: { label: "Ha / Yo‘q", icon: CheckSquare },
  position: { label: "Lavozim", icon: Briefcase },
  branch: { label: "Filial", icon: Building2 },
  shift: { label: "Smena", icon: Shuffle },
  workHours: { label: "Ish vaqti", icon: Clock3 },
  weekday: { label: "Hafta kuni", icon: Calendar },
};

const WEEK = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"];
const newId = () => Math.random().toString(36).slice(2, 10);

export function FormBuilder() {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<FormResponse>("/company/registration-form");
  const [questions, setQuestions] = useState<RegistrationQuestion[]>([]);
  const [texts, setTexts] = useState({ intro: "", submittedText: "", approvedText: "" });
  const [selected, setSelected] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!data) return;
    setQuestions(data.form.questions);
    setTexts({ intro: data.form.intro || "", submittedText: data.form.submittedText || "", approvedText: data.form.approvedText || "" });
    setSelected((current) => current || data.form.questions[0]?.id || "");
    setDirty(false);
  }, [data]);

  const active = useMemo(() => questions.filter((q) => q.enabled), [questions]);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || "Yuklanmadi"} />;

  const change = (id: string, patch: Partial<RegistrationQuestion>) => {
    setQuestions((list) => list.map((q) => (q.id === id ? { ...q, ...patch } : q)));
    setDirty(true);
  };
  const move = (id: string, delta: number) => {
    setQuestions((list) => {
      const index = list.findIndex((q) => q.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
  };
  const remove = (id: string) => {
    setQuestions((list) => list.filter((q) => q.id !== id));
    if (selected === id) setSelected(questions[0]?.id || "");
    setDirty(true);
  };
  const add = (type: QuestionType) => {
    const question: RegistrationQuestion = {
      id: newId(),
      type,
      title: type === "choice" ? "Variantlardan birini tanlang:" : type === "yesno" ? "Savolingizni yozing?" : "Yangi savol",
      options: type === "choice" ? ["1-variant", "2-variant"] : undefined,
      required: true,
      enabled: true,
    };
    setQuestions((list) => [...list, question]);
    setSelected(question.id);
    setAdding(false);
    setDirty(true);
  };
  const save = async () => {
    setBusy(true);
    setSaveError("");
    try {
      await put("/company/registration-form", { questions, ...texts });
      toast("Anketa saqlandi — bot darhol yangi savollarni beradi");
      void reload(true);
    } catch (reason) {
      setSaveError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const current = questions.find((q) => q.id === selected);

  return (
    <section className="card fb">
      <div className="card-head">
        <div>
          <h2>Anketa savollari</h2>
          <p>
            Botdagi savollarni kompaniyangizga moslang: qo‘shing, o‘chiring, matnini va variantlarini o‘zgartiring. {active.length} ta savol yoqilgan.
          </p>
        </div>
        <div className="toolbar">
          <button className="btn btn-ghost" onClick={() => setResetOpen(true)} title="Standart savollarga qaytarish">
            <RotateCcw size={15} /> Standart
          </button>
          <button className="btn btn-primary" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} Saqlash
          </button>
        </div>
      </div>
      <div className="fb-layout">
        <div className="fb-list">
          {questions.map((q, index) => {
            const meta = typeMeta[q.type];
            const builtin = q.field ? data.builtins[q.field] : undefined;
            const locked = Boolean(builtin?.locked);
            const number = active.findIndex((a) => a.id === q.id) + 1;
            return (
              <div
                key={q.id}
                className={`fb-item ${selected === q.id ? "selected" : ""} ${q.enabled ? "" : "off"}`}
                onClick={() => setSelected(q.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSelected(q.id)}
              >
                <div className="fb-item-head">
                  <span className="fb-num">{q.enabled ? number : "—"}</span>
                  <span className="fb-type">
                    <meta.icon size={13} /> {builtin ? builtin.label : meta.label}
                    {locked && <Lock size={11} />}
                  </span>
                  <span className="fb-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn" disabled={index === 0} onClick={() => move(q.id, -1)} aria-label="Yuqoriga">
                      <ArrowUp size={14} />
                    </button>
                    <button className="icon-btn" disabled={index === questions.length - 1} onClick={() => move(q.id, 1)} aria-label="Pastga">
                      <ArrowDown size={14} />
                    </button>
                    {!q.field && (
                      <button className="icon-btn danger" onClick={() => remove(q.id)} aria-label="O‘chirish">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </span>
                </div>
                {selected === q.id ? (
                  <div className="fb-edit" onClick={(e) => e.stopPropagation()}>
                    <label className="field">
                      <span className="label">Savol matni</span>
                      <textarea className="textarea" rows={2} maxLength={300} value={q.title} onChange={(e) => change(q.id, { title: e.target.value })} />
                    </label>
                    <label className="field">
                      <span className="label">Izoh / misol (ixtiyoriy)</span>
                      <input className="input" maxLength={200} value={q.hint || ""} placeholder={meta.example ? `Misol: ${meta.example}` : ""} onChange={(e) => change(q.id, { hint: e.target.value })} />
                    </label>
                    {!q.field && (
                      <label className="field">
                        <span className="label">Javob turi</span>
                        <select
                          className="select"
                          value={q.type}
                          onChange={(e) => {
                            const type = e.target.value as QuestionType;
                            change(q.id, { type, options: type === "choice" ? q.options?.length ? q.options : ["1-variant", "2-variant"] : undefined });
                          }}
                        >
                          {data.customTypes.map((type) => (
                            <option key={type} value={type}>
                              {typeMeta[type].label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {(q.type === "choice" || q.type === "workHours") && (
                      <OptionsEditor
                        options={q.options || []}
                        placeholder={q.type === "workHours" ? "09:00 - 18:00" : "Yangi variant"}
                        onChange={(options) => change(q.id, { options })}
                      />
                    )}
                    <div className="fb-switches">
                      <label className={`checkbox-row ${locked ? "disabled" : ""}`} title={locked ? "Xodim yaratish uchun zarur — o‘chirib bo‘lmaydi" : undefined}>
                        <input type="checkbox" disabled={locked} checked={q.enabled} onChange={(e) => change(q.id, { enabled: e.target.checked })} /> Botda so‘ralsin
                      </label>
                      <label className={`checkbox-row ${locked ? "disabled" : ""}`}>
                        <input type="checkbox" disabled={locked} checked={q.required} onChange={(e) => change(q.id, { required: e.target.checked })} /> Majburiy
                      </label>
                    </div>
                    {q.field && (
                      <small className="muted">
                        Javob xodim profilidagi «{data.builtins[q.field]?.label}» maydoniga yoziladi{locked ? " — bu maydonsiz xodim yaratib bo‘lmaydi" : ""}.
                      </small>
                    )}
                    {!q.field && <small className="muted">Javob xodim profilidagi «Qo‘shimcha ma’lumotlar» bo‘limiga tushadi.</small>}
                  </div>
                ) : (
                  <div className="fb-title">{q.title}</div>
                )}
              </div>
            );
          })}
          <div className="fb-add">
            {adding ? (
              <div className="fb-types">
                {data.customTypes.map((type) => {
                  const meta = typeMeta[type];
                  return (
                    <button key={type} className="fb-type-btn" onClick={() => add(type)}>
                      <meta.icon size={16} />
                      <span>{meta.label}</span>
                    </button>
                  );
                })}
                <button className="icon-btn" onClick={() => setAdding(false)} aria-label="Yopish">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button className="btn btn-block" onClick={() => setAdding(true)}>
                <Plus size={16} /> Savol qo‘shish
              </button>
            )}
          </div>

          <div className="fb-texts">
            <h3 className="form-section-title">
              <MessageSquareText size={15} /> Bot matnlari
            </h3>
            <TextSetting
              label="Salomlashish (/start)"
              value={texts.intro}
              fallback={data.defaults.intro}
              hint="{company} — kompaniya nomi. <b>qalin</b>, <i>kursiv</i> ishlatish mumkin."
              onChange={(intro) => {
                setTexts((t) => ({ ...t, intro }));
                setDirty(true);
              }}
            />
            <TextSetting
              label="Anketa yuborilgandan keyin"
              value={texts.submittedText}
              fallback={data.defaults.submittedText}
              onChange={(submittedText) => {
                setTexts((t) => ({ ...t, submittedText }));
                setDirty(true);
              }}
            />
            <TextSetting
              label="Tasdiqlanganda"
              value={texts.approvedText}
              fallback={data.defaults.approvedText}
              hint="{name} — xodim ismi, {company} — kompaniya nomi. Ostida «Profilimni ochish» tugmasi chiqadi."
              onChange={(approvedText) => {
                setTexts((t) => ({ ...t, approvedText }));
                setDirty(true);
              }}
            />
          </div>
          <ErrorBox message={saveError} />
        </div>

        <aside className="fb-preview">
          <div className="tg-phone">
            <div className="tg-top">
              <span className="tg-avatar">{data.companyName.slice(0, 1).toUpperCase()}</span>
              <div>
                <b>{data.companyName}</b>
                <small>bot</small>
              </div>
            </div>
            <div className="tg-chat">
              {current && current.enabled ? (
                <Preview question={current} index={active.findIndex((a) => a.id === current.id)} total={active.length} data={data} />
              ) : (
                <div className="tg-bubble">
                  <p className="muted">{current ? "Bu savol o‘chirilgan — botda so‘ralmaydi." : "Savolni tanlang"}</p>
                </div>
              )}
            </div>
          </div>
          <small className="muted" style={{ textAlign: "center" }}>
            Botda shunday ko‘rinadi
          </small>
        </aside>
      </div>
      {resetOpen && (
        <Confirm
          title="Standart savollarga qaytarilsinmi?"
          text="Qo‘shgan savollaringiz va matnlaringiz o‘chadi. Yuborilgan arizalarga ta’sir qilmaydi."
          confirmLabel="Qaytarish"
          danger
          onConfirm={async () => {
            await api("/company/registration-form", { method: "DELETE" });
            toast("Standart anketa tiklandi");
            void reload(true);
          }}
          onClose={() => setResetOpen(false)}
        />
      )}
    </section>
  );
}

function OptionsEditor({ options, placeholder, onChange }: { options: string[]; placeholder: string; onChange: (options: string[]) => void }) {
  const [value, setValue] = useState("");
  const addOption = () => {
    const clean = value.trim();
    if (!clean || options.includes(clean)) return;
    onChange([...options, clean].slice(0, 20));
    setValue("");
  };
  return (
    <div className="field">
      <span className="label">Variantlar ({options.length})</span>
      <div className="fb-options">
        {options.map((option, i) => (
          <span key={option} className="fb-option">
            <input
              value={option}
              onChange={(e) => onChange(options.map((o, j) => (j === i ? e.target.value : o)))}
              onBlur={(e) => !e.target.value.trim() && onChange(options.filter((_, j) => j !== i))}
              aria-label={`Variant ${i + 1}`}
            />
            <button type="button" onClick={() => onChange(options.filter((_, j) => j !== i))} aria-label="O‘chirish">
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="fb-option-add">
        <input
          className="input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addOption();
            }
          }}
        />
        <button type="button" className="btn btn-sm" onClick={addOption} disabled={!value.trim()}>
          <Plus size={14} /> Qo‘shish
        </button>
      </div>
    </div>
  );
}

function TextSetting({ label, value, fallback, hint, onChange }: { label: string; value: string; fallback: string; hint?: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <textarea className="textarea" rows={3} maxLength={1500} value={value} placeholder={fallback.replace(/<\/?[biu]>/g, "")} onChange={(e) => onChange(e.target.value)} />
      <span className="hint">{hint || "Bo‘sh qoldirilsa — standart matn."}</span>
    </label>
  );
}

function Preview({ question, index, total, data }: { question: RegistrationQuestion; index: number; total: number; data: FormResponse }) {
  void total;
  let buttons: string[][] = [];
  switch (question.type) {
    case "position":
      buttons = chunk(data.positions.length ? data.positions : ["(lavozimlar yo‘q)"], 2);
      break;
    case "branch":
      buttons = chunk(data.branches.length ? data.branches : ["(filiallar yo‘q)"], 2);
      break;
    case "shift":
      buttons = [["☀️ Kunduzgi smena"], ["🌙 Kechki smena"], ["🔄 Qo‘sh smena"]];
      break;
    case "workHours":
      buttons = [...chunk((question.options || []).map((o) => `🕒 ${o}`), 2), ["✍️ Boshqa vaqt"]];
      break;
    case "weekday":
      buttons = [...chunk(WEEK, 3), ["♾ Dam olishsiz"]];
      break;
    case "choice":
      buttons = (question.options || []).map((o) => [o]);
      break;
    case "yesno":
      buttons = [["✅ Ha", "❌ Yo‘q"]];
      break;
  }
  const nav: string[][] = [];
  if (!question.required) nav.push(["⏭ O‘tkazib yuborish"]);
  nav.push(index > 0 ? ["⬅️ Orqaga", "✖️ Bekor qilish"] : ["✖️ Bekor qilish"]);
  const typed = !buttons.length;
  return (
    <>
      <div className="tg-bubble">
        <p>
          <b>{question.title || "…"}</b>
          {question.hint && (
            <>
              <br />
              {question.hint}
            </>
          )}
          {!question.required && (
            <>
              <br />
              <i>Ixtiyoriy — o‘tkazib yuborish mumkin.</i>
            </>
          )}
        </p>
      </div>
      <div className="tg-buttons">
        {[...buttons, ...nav].map((row, i) => (
          <div key={i}>
            {row.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        ))}
      </div>
      {typed && (
        <div className="tg-input">
          <span>{typeMeta[question.type].example ? `Masalan: ${question.hint?.replace(/^Misol:\s*/i, "") || typeMeta[question.type].example}` : "Javobni yozing…"}</span>
        </div>
      )}
    </>
  );
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  items.forEach((item, i) => {
    if (i % size === 0) out.push([]);
    out[out.length - 1].push(item);
  });
  return out;
}
