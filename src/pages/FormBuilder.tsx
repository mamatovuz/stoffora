import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Briefcase,
  Building2,
  Cake,
  Calendar,
  Camera,
  CheckSquare,
  ChevronDown,
  Clock3,
  Hash,
  IdCard,
  KeyRound,
  ListChecks,
  LoaderCircle,
  Lock,
  Mail,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Shuffle,
  Trash2,
  Type,
  User,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { api, errorText, put } from "../api";
import { useApi } from "../hooks";
import { Confirm, ErrorBox, Loading, useToast } from "../components/ui";
import type { BuiltinField, QuestionType, RegistrationForm, RegistrationQuestion } from "@/lib/types";
import { LOGIN_SUFFIX } from "@/lib/staff-login";

/*
 * Ro‘yxat boti anketasi muharriri.
 *  1) «Xodimdan qaysi ma’lumotlar kerak» — tizim maydonlari: har biri Majburiy / Ixtiyoriy / So‘ralmaydi.
 *  2) «O‘z savollaringiz» — kompaniya qo‘shgan savollar (matn, raqam, yosh, telefon, email, sana, summa, variant, ha/yo‘q).
 *  3) Bot matnlari. O‘ngda — tanlangan savol botda qanday ko‘rinishi.
 * Saqlangan tartib = botdagi tartib. O‘z savoli o‘zidan oldingi tizim savoliga «yopishadi»:
 * tizim savoli ko‘chirilsa, undan keyingi o‘z savollari ham birga ko‘chadi. «Ilova uchun login» doim oxirida.
 */

type FormResponse = {
  form: RegistrationForm;
  defaults: { intro: string; submittedText: string; approvedText: string };
  builtins: Partial<Record<BuiltinField, { label: string; locked: boolean; type: QuestionType }>>;
  customTypes?: QuestionType[];
  /** Server javob turlari nomlarini yuborsa — shu ishlatiladi (bo‘lmasa mahalliy nomlar). */
  typeLabels?: Partial<Record<QuestionType, string>>;
  companyName: string;
  positions: string[];
  branches: string[];
};

const typeMeta: Record<QuestionType, { label: string; icon: typeof Type; example?: string }> = {
  name: { label: "Ism-familiya", icon: User, example: "Ali Valiyev" },
  text: { label: "Matn", icon: Type, example: "Erkin javob" },
  number: { label: "Raqam", icon: Hash, example: "5" },
  age: { label: "Yosh", icon: Cake, example: "25" },
  date: { label: "Sana", icon: Calendar, example: "12.05.2026" },
  birthdate: { label: "Tug‘ilgan sana", icon: Calendar, example: "29.08.1995" },
  phone: { label: "Telefon", icon: Phone, example: "+998901234567" },
  email: { label: "Email", icon: Mail, example: "ali@gmail.com" },
  money: { label: "Summa", icon: Wallet, example: "4 000 000" },
  choice: { label: "Variant tanlash", icon: ListChecks },
  yesno: { label: "Ha / Yo‘q", icon: CheckSquare },
  position: { label: "Lavozim", icon: Briefcase },
  branch: { label: "Filial", icon: Building2 },
  shift: { label: "Smena", icon: Shuffle },
  workHours: { label: "Ish vaqti", icon: Clock3 },
  weekday: { label: "Hafta kuni", icon: Calendar },
  gender: { label: "Jins (Erkak / Ayol)", icon: Users },
  pinfl: { label: "JShShIR", icon: IdCard, example: "31508951234567" },
  photo: { label: "Rasm", icon: Camera },
  login: { label: "Login va parol", icon: KeyRound, example: "ozodbek" },
};

/** Builder’da taklif qilinadigan javob turlari — shu tartibda. */
const CUSTOM_ORDER: QuestionType[] = ["text", "number", "age", "phone", "email", "date", "money", "choice", "yesno"];

/** Server yangi maydon nomini yubormasa — zaxira nomlar. */
const BUILTIN_LABELS: Record<BuiltinField, string> = {
  fullName: "Ism-familiya",
  phone: "Telefon",
  parentPhone: "Ota-ona telefoni",
  email: "Email",
  birthDate: "Tug‘ilgan sana",
  gender: "Jinsi",
  pinfl: "JShShIR",
  address: "Manzil",
  branchId: "Filial",
  positionId: "Lavozim",
  shift: "Smena",
  workHours: "Ish vaqti",
  salary: "Oylik",
  restDay: "Dam olish kuni",
  education: "Ma’lumoti",
  idDocument: "Pasport / ID karta",
  selfie: "Yuz rasmi",
  appLogin: "Ilova uchun login va parol",
};
const LOCKED_FALLBACK = new Set<BuiltinField>(["fullName", "phone", "positionId", "branchId"]);

type Need = "required" | "optional" | "off";
const NEED_LABELS: Record<Need, string> = { required: "Majburiy", optional: "Ixtiyoriy", off: "So‘ralmaydi" };
const needOf = (q: RegistrationQuestion): Need =>
  !q.enabled ? "off" : q.field === "appLogin" || q.required ? "required" : "optional";
const needPatch = (need: Need): Partial<RegistrationQuestion> =>
  need === "off" ? { enabled: false } : { enabled: true, required: need === "required" };

const WEEK = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"];
const newId = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------------------------------ tartib yordamchilari --- */
/** Tizim savoli + undan keyingi o‘z savollari — bitta guruh. Boshidagi o‘z savollari — alohida guruh. */
function groupsOf(list: RegistrationQuestion[]) {
  const groups: RegistrationQuestion[][] = [];
  for (const q of list) {
    if (q.field || !groups.length) groups.push([q]);
    else groups[groups.length - 1].push(q);
  }
  return groups;
}
function moveBuiltin(list: RegistrationQuestion[], id: string, delta: number) {
  const groups = groupsOf(list);
  const i = groups.findIndex((g) => g[0].id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= groups.length) return list;
  const a = groups[i][0];
  const b = groups[j][0];
  if (!a.field || !b.field || a.field === "appLogin" || b.field === "appLogin") return list;
  [groups[i], groups[j]] = [groups[j], groups[i]];
  return groups.flat();
}
function moveCustom(list: RegistrationQuestion[], id: string, delta: number) {
  const slots = list.flatMap((q, i) => (q.field ? [] : [i]));
  const k = slots.findIndex((i) => list[i].id === id);
  const t = k + delta;
  if (k < 0 || t < 0 || t >= slots.length) return list;
  const next = [...list];
  [next[slots[k]], next[slots[t]]] = [next[slots[t]], next[slots[k]]];
  return next;
}
/** O‘z savolidan oldingi tizim savoli ("" — eng boshida). */
function anchorOf(list: RegistrationQuestion[], id: string) {
  const index = list.findIndex((q) => q.id === id);
  for (let k = index - 1; k >= 0; k -= 1) if (list[k].field) return list[k].id;
  return "";
}
/** O‘z savolini tanlangan tizim savolidan (va unga yopishgan savollardan) keyinga qo‘yadi. */
function placeAfter(list: RegistrationQuestion[], id: string, anchorId: string) {
  const question = list.find((q) => q.id === id);
  if (!question) return list;
  const rest = list.filter((q) => q.id !== id);
  if (!anchorId) return [question, ...rest];
  const start = rest.findIndex((q) => q.id === anchorId);
  if (start < 0) return list;
  let end = start + 1;
  while (end < rest.length && !rest[end].field) end += 1;
  return [...rest.slice(0, end), question, ...rest.slice(end)];
}
/** «Ilova uchun login» doim oxirgi savol (server ham shunday saqlaydi). */
function loginLast(list: RegistrationQuestion[]) {
  const i = list.findIndex((q) => q.field === "appLogin");
  if (i < 0 || i === list.length - 1) return list;
  return [...list.slice(0, i), ...list.slice(i + 1), list[i]];
}
function insertCustom(list: RegistrationQuestion[], question: RegistrationQuestion) {
  const i = list.findIndex((q) => q.field === "appLogin");
  return i < 0 ? [...list, question] : [...list.slice(0, i), question, ...list.slice(i)];
}

type Draft = { title: string; type: QuestionType; options: string[]; required: boolean };
const emptyDraft = (): Draft => ({ title: "", type: "text", options: [], required: true });

export function FormBuilder() {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<FormResponse>("/company/registration-form");
  const [questions, setQuestions] = useState<RegistrationQuestion[]>([]);
  const [texts, setTexts] = useState({ intro: "", submittedText: "", approvedText: "" });
  const [open, setOpen] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [resetOpen, setResetOpen] = useState(false);

  const load = (response: FormResponse) => {
    setQuestions(loginLast(response.form.questions));
    setTexts({
      intro: response.form.intro || "",
      submittedText: response.form.submittedText || "",
      approvedText: response.form.approvedText || "",
    });
    setDirty(false);
    setSaveError("");
  };
  useEffect(() => {
    if (data) load(data);
  }, [data]);

  const active = useMemo(() => questions.filter((q) => q.enabled), [questions]);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || "Yuklanmadi"} />;

  const typeLabel = (type: QuestionType) => data.typeLabels?.[type] || typeMeta[type]?.label || type;
  const builtinOf = (field: BuiltinField) => ({
    label: data.builtins[field]?.label || BUILTIN_LABELS[field] || field,
    locked: data.builtins[field]?.locked ?? LOCKED_FALLBACK.has(field),
  });
  const customTypes = (() => {
    const offered = data.customTypes?.length ? data.customTypes : CUSTOM_ORDER;
    return [...CUSTOM_ORDER.filter((t) => offered.includes(t)), ...offered.filter((t) => !CUSTOM_ORDER.includes(t) && typeMeta[t])];
  })();

  const update = (next: (list: RegistrationQuestion[]) => RegistrationQuestion[]) => {
    setQuestions((list) => next(list));
    setDirty(true);
  };
  const change = (id: string, patch: Partial<RegistrationQuestion>) =>
    update((list) => list.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  const remove = (id: string) => {
    update((list) => list.filter((q) => q.id !== id));
    if (open === id) setOpen("");
  };
  const changeText = (key: keyof typeof texts, value: string) => {
    setTexts((t) => ({ ...t, [key]: value }));
    setDirty(true);
  };
  const addDraft = () => {
    if (!draft) return;
    const question: RegistrationQuestion = {
      id: newId(),
      type: draft.type,
      title: draft.title.trim(),
      options: draft.type === "choice" ? draft.options : undefined,
      required: draft.required,
      enabled: true,
    };
    update((list) => insertCustom(list, question));
    setDraft(null);
    setOpen(question.id);
  };
  const save = async () => {
    setBusy(true);
    setSaveError("");
    try {
      await put("/company/registration-form", { questions: loginLast(questions), ...texts });
      toast("Anketa saqlandi — bot darhol yangi savollarni beradi");
      void reload(true);
    } catch (reason) {
      setSaveError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const builtins = questions.filter((q) => q.field);
  const customs = questions.filter((q) => !q.field);
  const numberOf = (q: RegistrationQuestion) => (q.enabled ? active.findIndex((a) => a.id === q.id) + 1 : 0);
  const draftValid = Boolean(draft && draft.title.trim().length >= 2 && (draft.type !== "choice" || draft.options.length >= 2));

  // Ko‘rinish: yangi savol yozilayotgan bo‘lsa — o‘sha, aks holda ochilgan yoki birinchi savol.
  const focused = questions.find((q) => q.id === open);
  const previewQuestion: RegistrationQuestion | undefined = draft
    ? { id: "draft", type: draft.type, title: draft.title || "Savol matni", options: draft.options, required: draft.required, enabled: true }
    : focused || active[0];
  const previewIndex = draft ? active.length : previewQuestion ? Math.max(0, active.findIndex((a) => a.id === previewQuestion.id)) : 0;
  const previewName = draft
    ? "Yangi savol"
    : previewQuestion
      ? previewQuestion.field
        ? builtinOf(previewQuestion.field).label
        : "O‘z savolingiz"
      : "";

  return (
    <section className="card fb">
      <div className="card-head">
        <div>
          <h2>Anketa</h2>
          <p>Bot yangi xodimdan shu tartibda so‘raydi · {active.length} ta savol</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setResetOpen(true)} title="Standart savollarga qaytarish">
          <RotateCcw size={14} /> Standart
        </button>
      </div>

      <div className="fb-layout">
        <div className="fb-main">
          {/* 1 — tizim maydonlari */}
          <div className="fb-sec">
            <div className="fb-sec-head">
              <h3>Xodimdan qaysi ma’lumotlar kerak</h3>
              <p>Ixtiyoriy savolda botda «O‘tkazib yuborish» tugmasi chiqadi</p>
            </div>
            <ul className="fb-rows">
              {builtins.map((q, b) => {
                const field = q.field!;
                const meta = builtinOf(field);
                const isLogin = field === "appLogin";
                const canUp = !isLogin && b > 0;
                const canDown = !isLogin && b < builtins.length - 1 && builtins[b + 1].field !== "appLogin";
                return (
                  <Row
                    key={q.id}
                    number={numberOf(q)}
                    icon={typeMeta[q.type]?.icon || Type}
                    label={meta.label}
                    sub={q.title}
                    open={open === q.id}
                    onToggle={() => {
                      setDraft(null);
                      setOpen(open === q.id ? "" : q.id);
                    }}
                    control={
                      <NeedControl
                        label={meta.label}
                        value={meta.locked ? "required" : needOf(q)}
                        locked={meta.locked}
                        noOptional={isLogin}
                        onChange={(need) => change(q.id, needPatch(need))}
                      />
                    }
                    actions={
                      isLogin ? (
                        <span className="fb-last" title="Doim oxirgi savol">
                          Oxirida
                        </span>
                      ) : (
                        <>
                          <button className="icon-btn" disabled={!canUp} onClick={() => update((list) => moveBuiltin(list, q.id, -1))} aria-label={`${meta.label} — yuqoriga`}>
                            <ArrowUp size={14} />
                          </button>
                          <button className="icon-btn" disabled={!canDown} onClick={() => update((list) => moveBuiltin(list, q.id, 1))} aria-label={`${meta.label} — pastga`}>
                            <ArrowDown size={14} />
                          </button>
                        </>
                      )
                    }
                  >
                    <QuestionTexts question={q} onChange={(patch) => change(q.id, patch)} />
                    {(q.type === "choice" || q.type === "workHours") && (
                      <OptionsEditor
                        options={q.options || []}
                        placeholder={q.type === "workHours" ? "09:00 - 18:00" : "Yangi variant"}
                        onChange={(options) => change(q.id, { options })}
                      />
                    )}
                    <p className="fb-note">
                      {isLogin
                        ? `Bot ism-familiyadan login taklif qiladi (masalan ali.valiyev${LOGIN_SUFFIX}), keyin parol so‘raydi. Tasdiqlangach xodim shu login bilan Staffora ilovasiga kiradi.`
                        : meta.locked
                          ? `Javob profildagi «${meta.label}» maydoniga yoziladi. Bu maydonsiz xodim yaratib bo‘lmaydi.`
                          : `Javob profildagi «${meta.label}» maydoniga yoziladi.`}
                    </p>
                  </Row>
                );
              })}
            </ul>
          </div>

          {/* 2 — kompaniyaning o‘z savollari */}
          <div className="fb-sec">
            <div className="fb-sec-head">
              <h3>O‘z savollaringiz</h3>
              <p>Javoblar xodim profilidagi «Qo‘shimcha ma’lumotlar» bo‘limiga tushadi</p>
            </div>
            {customs.length > 0 && (
              <ul className="fb-rows">
                {customs.map((q, c) => (
                  <Row
                    key={q.id}
                    number={numberOf(q)}
                    icon={typeMeta[q.type]?.icon || Type}
                    label={q.title || "Savol"}
                    sub={typeLabel(q.type)}
                    open={open === q.id}
                    onToggle={() => {
                      setDraft(null);
                      setOpen(open === q.id ? "" : q.id);
                    }}
                    control={<NeedControl label={q.title} value={needOf(q)} onChange={(need) => change(q.id, needPatch(need))} />}
                    actions={
                      <>
                        <button className="icon-btn" disabled={c === 0} onClick={() => update((list) => moveCustom(list, q.id, -1))} aria-label="Yuqoriga">
                          <ArrowUp size={14} />
                        </button>
                        <button className="icon-btn" disabled={c === customs.length - 1} onClick={() => update((list) => moveCustom(list, q.id, 1))} aria-label="Pastga">
                          <ArrowDown size={14} />
                        </button>
                        <button className="icon-btn danger" onClick={() => remove(q.id)} aria-label="Savolni o‘chirish">
                          <Trash2 size={14} />
                        </button>
                      </>
                    }
                  >
                    <QuestionTexts question={q} onChange={(patch) => change(q.id, patch)} />
                    <div className="field">
                      <span className="label">Javob turi</span>
                      <TypeChooser
                        types={customTypes}
                        value={q.type}
                        label={typeLabel}
                        onChange={(type) =>
                          change(q.id, { type, options: type === "choice" ? (q.options?.length ? q.options : ["1-variant", "2-variant"]) : undefined })
                        }
                      />
                    </div>
                    {q.type === "choice" && <OptionsEditor options={q.options || []} placeholder="Yangi variant" onChange={(options) => change(q.id, { options })} />}
                    <label className="field fb-anchor">
                      <span className="label">Qaysi savoldan keyin so‘ralsin</span>
                      <select className="select" value={anchorOf(questions, q.id)} onChange={(e) => update((list) => placeAfter(list, q.id, e.target.value))}>
                        <option value="">Eng boshida</option>
                        {builtins
                          .filter((b) => b.field !== "appLogin")
                          .map((b) => (
                            <option key={b.id} value={b.id}>
                              «{builtinOf(b.field!).label}» dan keyin{b.enabled ? "" : " (so‘ralmaydi)"}
                            </option>
                          ))}
                      </select>
                    </label>
                  </Row>
                ))}
              </ul>
            )}
            {draft ? (
              <div className="fb-composer">
                <label className="field">
                  <span className="label">Savol</span>
                  <input
                    className="input"
                    autoFocus
                    maxLength={300}
                    value={draft.title}
                    placeholder="Masalan: Qaysi tillarni bilasiz?"
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                </label>
                <div className="field">
                  <span className="label">Javob turi</span>
                  <TypeChooser
                    types={customTypes}
                    value={draft.type}
                    label={typeLabel}
                    onChange={(type) => setDraft({ ...draft, type, options: type === "choice" ? draft.options : [] })}
                  />
                </div>
                {draft.type === "choice" && (
                  <OptionsEditor
                    options={draft.options}
                    placeholder="Variant yozing va Enter bosing"
                    note={draft.options.length < 2 ? "Kamida 2 ta variant" : undefined}
                    onChange={(options) => setDraft({ ...draft, options })}
                  />
                )}
                <div className="fb-composer-foot">
                  <NeedControl
                    label="Yangi savol"
                    choices={["required", "optional"]}
                    value={draft.required ? "required" : "optional"}
                    onChange={(need) => setDraft({ ...draft, required: need === "required" })}
                  />
                  <span className="fb-spacer" />
                  <button className="btn btn-ghost" onClick={() => setDraft(null)}>
                    Bekor qilish
                  </button>
                  <button className="btn btn-primary" disabled={!draftValid} onClick={addDraft}>
                    <Plus size={15} /> Qo‘shish
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="btn fb-add-btn"
                onClick={() => {
                  setOpen("");
                  setDraft(emptyDraft());
                }}
              >
                <Plus size={15} /> Savol qo‘shish
              </button>
            )}
          </div>

          {/* 3 — bot matnlari */}
          <div className="fb-sec">
            <div className="fb-sec-head">
              <h3>Bot matnlari</h3>
              <p>Bo‘sh qoldirilsa — standart matn</p>
            </div>
            <TextSetting
              label="Salomlashish (/start)"
              value={texts.intro}
              fallback={data.defaults.intro}
              hint="{company} — kompaniya nomi. <b>qalin</b>, <i>kursiv</i> ishlatish mumkin."
              onChange={(value) => changeText("intro", value)}
            />
            <TextSetting label="Anketa yuborilgandan keyin" value={texts.submittedText} fallback={data.defaults.submittedText} onChange={(value) => changeText("submittedText", value)} />
            <TextSetting
              label="Tasdiqlanganda"
              value={texts.approvedText}
              fallback={data.defaults.approvedText}
              hint="{name} — xodim ismi, {company} — kompaniya nomi. Ostida «Profilimni ochish» tugmasi chiqadi."
              onChange={(value) => changeText("approvedText", value)}
            />
          </div>
        </div>

        <aside className="fb-preview">
          <div className="fb-preview-cap">
            <span>Botda shunday ko‘rinadi</span>
            {previewName && <b>{previewName}</b>}
          </div>
          <div className="tg-phone">
            <div className="tg-top">
              <span className="tg-avatar">{data.companyName.slice(0, 1).toUpperCase()}</span>
              <div>
                <b>{data.companyName}</b>
                <small>bot</small>
              </div>
            </div>
            <div className="tg-chat">
              {previewQuestion && previewQuestion.enabled ? (
                <Preview question={previewQuestion} index={previewIndex} data={data} />
              ) : (
                <div className="tg-bubble">
                  <p className="muted">Bu savol botda so‘ralmaydi.</p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {saveError && (
        <div className="fb-save-error">
          <ErrorBox message={saveError} />
        </div>
      )}
      <div className="fb-savebar">
        <span className={`dot-text ${dirty ? "amber" : "green"}`}>{dirty ? "Saqlanmagan o‘zgarishlar bor" : "Saqlangan"}</span>
        <div className="fb-savebar-actions">
          {dirty && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => load(data)}>
              Bekor qilish
            </button>
          )}
          <button className="btn btn-primary" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} Saqlash
          </button>
        </div>
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
            setOpen("");
            setDraft(null);
            void reload(true);
          }}
          onClose={() => setResetOpen(false)}
        />
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- qatorlar --- */
function Row({
  number,
  icon: Icon,
  label,
  sub,
  open,
  onToggle,
  control,
  actions,
  children,
}: {
  number: number;
  icon: typeof Type;
  label: string;
  sub?: string;
  open: boolean;
  onToggle: () => void;
  control: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className={`fb-row ${open ? "open" : ""} ${number ? "" : "off"}`}>
      <div className="fb-row-head">
        <button type="button" className="fb-row-main" aria-expanded={open} onClick={onToggle}>
          <span className="fb-num">{number || "—"}</span>
          <span className="fb-row-text">
            <b>
              <Icon size={14} />
              <span>{label}</span>
            </b>
            {sub && <small>{sub}</small>}
          </span>
          <ChevronDown size={15} className="fb-chev" />
        </button>
        {control}
        <span className="fb-row-actions">{actions}</span>
      </div>
      {open && <div className="fb-row-edit">{children}</div>}
    </li>
  );
}

function NeedControl({
  value,
  onChange,
  label,
  locked,
  noOptional,
  choices = ["required", "optional", "off"],
}: {
  value: Need;
  onChange: (need: Need) => void;
  label: string;
  locked?: boolean;
  noOptional?: boolean;
  choices?: Need[];
}) {
  return (
    <div className="fb-need" role="radiogroup" aria-label={`${label} — so‘ralishi`}>
      {choices.map((need) => {
        const disabled = locked ? need !== "required" : Boolean(noOptional && need === "optional");
        return (
          <button
            key={need}
            type="button"
            role="radio"
            aria-checked={value === need}
            className={value === need ? `active ${need}` : undefined}
            disabled={disabled}
            title={
              locked
                ? "Xodim yaratish uchun zarur — doim so‘raladi"
                : noOptional && need === "optional"
                  ? "Login so‘ralsa — majburiy"
                  : undefined
            }
            onClick={() => value !== need && onChange(need)}
          >
            {locked && need === "required" && <Lock size={11} />}
            {NEED_LABELS[need]}
          </button>
        );
      })}
    </div>
  );
}

function QuestionTexts({ question, onChange }: { question: RegistrationQuestion; onChange: (patch: Partial<RegistrationQuestion>) => void }) {
  const example = typeMeta[question.type]?.example;
  return (
    <>
      <label className="field">
        <span className="label">Savol matni</span>
        <textarea className="textarea fb-textarea" rows={2} maxLength={300} value={question.title} onChange={(e) => onChange({ title: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">Izoh yoki misol</span>
        <input
          className="input"
          maxLength={200}
          value={question.hint || ""}
          placeholder={example ? `Misol: ${example}` : "Ixtiyoriy"}
          onChange={(e) => onChange({ hint: e.target.value })}
        />
      </label>
    </>
  );
}

function TypeChooser({ types, value, label, onChange }: { types: QuestionType[]; value: QuestionType; label: (type: QuestionType) => string; onChange: (type: QuestionType) => void }) {
  return (
    <div className="fb-typegrid" role="radiogroup" aria-label="Javob turi">
      {types.map((type) => {
        const Icon = typeMeta[type]?.icon || Type;
        return (
          <button key={type} type="button" role="radio" aria-checked={value === type} className="fb-typeopt" onClick={() => onChange(type)}>
            <Icon size={15} />
            <span>{label(type)}</span>
          </button>
        );
      })}
    </div>
  );
}

function OptionsEditor({ options, placeholder, note, onChange }: { options: string[]; placeholder: string; note?: string; onChange: (options: string[]) => void }) {
  const [value, setValue] = useState("");
  const addOption = () => {
    const clean = value.trim();
    if (!clean || options.includes(clean)) return;
    onChange([...options, clean].slice(0, 20));
    setValue("");
  };
  return (
    <div className="field">
      <span className="label">
        Variantlar ({options.length}){note && <span className="fb-note-inline"> · {note}</span>}
      </span>
      {options.length > 0 && (
        <div className="fb-options">
          {options.map((option, i) => (
            <span key={`${i}-${option}`} className="fb-option">
              <input
                value={option}
                onChange={(e) => onChange(options.map((o, j) => (j === i ? e.target.value : o)))}
                onBlur={(e) => !e.target.value.trim() && onChange(options.filter((_, j) => j !== i))}
                aria-label={`Variant ${i + 1}`}
              />
              <button type="button" onClick={() => onChange(options.filter((_, j) => j !== i))} aria-label="Variantni o‘chirish">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
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
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/* ------------------------------------------------------- Telegram ko‘rinishi --- */
function Preview({ question, index, data }: { question: RegistrationQuestion; index: number; data: FormResponse }) {
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
      buttons = (question.options?.length ? question.options : ["1-variant", "2-variant"]).map((o) => [o]);
      break;
    case "yesno":
      buttons = [["✅ Ha", "❌ Yo‘q"]];
      break;
    case "gender":
      buttons = [["👨 Erkak", "👩 Ayol"]];
      break;
    case "login":
      buttons = [[`✅ ali.valiyev${LOGIN_SUFFIX}`]];
      break;
  }
  const nav: string[][] = [];
  if (!question.required && question.field !== "appLogin") nav.push(["⏭ O‘tkazib yuborish"]);
  nav.push(index > 0 ? ["⬅️ Orqaga", "✖️ Bekor qilish"] : ["✖️ Bekor qilish"]);
  const typed = !buttons.length || question.type === "login";
  const example = typeMeta[question.type]?.example;
  const placeholder =
    question.type === "photo"
      ? "📎 Rasm yuboring"
      : question.type === "login"
        ? `Yoki o‘zingiz yozing: ${example}`
        : example
          ? `Masalan: ${question.hint?.replace(/^Misol:\s*/i, "") || example}`
          : "Javobni yozing…";
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
          {!question.required && question.field !== "appLogin" && (
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
            {row.map((label, j) => (
              <span key={`${j}-${label}`}>{label}</span>
            ))}
          </div>
        ))}
      </div>
      {typed && (
        <div className="tg-input">
          <span>{placeholder}</span>
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
