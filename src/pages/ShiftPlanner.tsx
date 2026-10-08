import { useMemo, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, Coffee, Plus, RotateCcw, Wand2 } from "lucide-react";
import { errorText, post, put } from "../api";
import { useApi } from "../hooks";
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, useToast } from "../components/ui";
import { duration } from "@/lib/format";
import { isOvernight, shiftMinutes } from "@/lib/shift-time";
import type { Branch } from "@/lib/types";

/*
 * Shift Planner: xodimlar × kunlar jadvali. Smenani chapdagi palitradan katakka sudrab tashlang
 * (yoki palitrada tanlab, kataklarni bosing). «Dam» — dam olish, «Odatiy» — grafikka qaytarish.
 * Namunalar (5/2, 2/2…) — tanlangan davrga bir bosishda.
 */

type Template = { id: string; name: string; start: string; end: string; color: string };
type Cell = { date: string; working: boolean; start: string; end: string; overridden: boolean; reason?: string; leave?: string };
type Plan = {
  dates: string[];
  templates: Template[];
  patterns: { key: string; label: string }[];
  holidays: { date: string; title: string; dayOff: boolean }[];
  rows: { employeeId: string; name: string; branch: string; position: string; cells: Cell[] }[];
  coverage: { date: string; planned: number }[];
};
type Tool = { mode: "shift"; template: Template } | { mode: "off" } | { mode: "reset" };

const WD = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(Date.parse(`${s}T12:00:00Z`) + n * 86_400_000));
const monday = (s: string) => {
  const d = new Date(`${s}T12:00:00Z`);
  return addDays(s, -((d.getUTCDay() + 6) % 7));
};

export function ShiftPlannerPage() {
  const toast = useToast();
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monday(today));
  const [days, setDays] = useState(7);
  const [branchId, setBranchId] = useState("");
  const { data: branches } = useApi<Branch[]>("/branches");
  const { data, loading, error, reload } = useApi<Plan>(`/shift-planner?from=${from}&days=${days}${branchId ? `&branchId=${branchId}` : ""}`);
  const [tool, setTool] = useState<Tool | null>(null);
  const [busy, setBusy] = useState(false);
  const [patternOpen, setPatternOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const holidays = useMemo(() => new Map((data?.holidays || []).map((h) => [h.date, h])), [data]);

  async function apply(employeeId: string, date: string, t: Tool | null) {
    if (!t) return toast("Avval chapdan smena, «Dam» yoki «Odatiy»ni tanlang yoki sudrab tashlang", "error");
    setBusy(true);
    try {
      await put("/shift-planner/cell", { employeeId, dates: [date], mode: t.mode, templateId: t.mode === "shift" ? t.template.id : undefined });
      await reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  }
  const toolFromDrag = (raw: string): Tool | null => {
    if (raw === "off") return { mode: "off" };
    if (raw === "reset") return { mode: "reset" };
    const t = data?.templates.find((x) => x.id === raw);
    return t ? { mode: "shift", template: t } : null;
  };
  const colorOf = (c: Cell) => data?.templates.find((t) => t.start === c.start && t.end === c.end)?.color;

  return (
    <div className="page">
      <PageHeader
        title="Smena rejasi"
        subtitle="Smenani chapdan katakka sudrab tashlang yoki tanlab kataklarni bosing. Kechikish, kelmaslik va ish haqi shu rejadan hisoblanadi."
        actions={
          <>
            <select className="select" style={{ maxWidth: 200 }} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Barcha filiallar</option>
              {(branches || []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <div className="date-nav">
              <button className="icon-btn" onClick={() => setFrom(addDays(from, -days))} aria-label="Oldingi">
                <ChevronLeft size={16} />
              </button>
              <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
              <button className="icon-btn" onClick={() => setFrom(addDays(from, days))} aria-label="Keyingi">
                <ChevronRight size={16} />
              </button>
            </div>
            <select className="select" style={{ maxWidth: 120 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>1 hafta</option>
              <option value={14}>2 hafta</option>
              <option value={28}>4 hafta</option>
            </select>
            <button className="btn btn-primary" onClick={() => setPatternOpen(true)}>
              <Wand2 size={16} /> Namuna (5/2, 2/2…)
            </button>
          </>
        }
      />
      {loading && !data ? (
        <Loading />
      ) : error || !data ? (
        <ErrorBox message={error || "Ma’lumot yo‘q"} />
      ) : (
        <div className="sp-layout">
          <aside className="card sp-palette">
            <b className="sp-title">Smenalar</b>
            {data.templates.map((t) => (
              <button
                key={t.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                className={`sp-tool ${tool?.mode === "shift" && tool.template.id === t.id ? "on" : ""}`}
                style={{ borderLeftColor: t.color }}
                onClick={() => setTool({ mode: "shift", template: t })}
              >
                <b>{t.name}</b>
                <small>
                  {t.start}–{t.end}
                </small>
              </button>
            ))}
            <button draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", "off")} className={`sp-tool off ${tool?.mode === "off" ? "on" : ""}`} onClick={() => setTool({ mode: "off" })}>
              <b>
                <Coffee size={14} /> Dam
              </b>
              <small>dam olish kuni</small>
            </button>
            <button draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", "reset")} className={`sp-tool reset ${tool?.mode === "reset" ? "on" : ""}`} onClick={() => setTool({ mode: "reset" })}>
              <b>
                <RotateCcw size={14} /> Odatiy
              </b>
              <small>grafikka qaytarish</small>
            </button>
            <button className="btn btn-sm" onClick={() => setTemplateOpen(true)}>
              <Plus size={14} /> Smena turi
            </button>
            <p className="hint">Tanlangan: {tool ? (tool.mode === "shift" ? tool.template.name : tool.mode === "off" ? "Dam" : "Odatiy") : "—"}</p>
          </aside>
          <section className="card sp-grid-wrap">
            {!data.rows.length ? (
              <Empty icon={CalendarRange} title="Xodimlar yo‘q" />
            ) : (
              <table className={`sp-grid ${busy ? "busy" : ""}`}>
                <thead>
                  <tr>
                    <th className="sp-name">Xodim</th>
                    {data.dates.map((d) => {
                      const h = holidays.get(d);
                      const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
                      return (
                        <th key={d} className={`${d === today ? "today" : ""} ${wd === 0 || wd === 6 ? "weekend" : ""}`} title={h?.title}>
                          <span>{WD[wd]}</span>
                          <b>{d.slice(8)}</b>
                          {h && <i className="sp-holiday">{h.dayOff ? "🎉" : "•"}</i>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.employeeId}>
                      <td className="sp-name">
                        <b>{r.name}</b>
                        <small>{r.position || r.branch}</small>
                      </td>
                      {r.cells.map((c) => {
                        const color = colorOf(c);
                        return (
                          <td
                            key={c.date}
                            className={`sp-cell ${c.leave ? "leave" : c.working ? "work" : "off"} ${c.overridden ? "custom" : ""}`}
                            style={c.working && color ? { ["--c" as string]: color } : undefined}
                            title={c.reason || (c.working ? `${c.start}–${c.end}` : "Dam olish")}
                            onClick={() => void apply(r.employeeId, c.date, tool)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              void apply(r.employeeId, c.date, toolFromDrag(e.dataTransfer.getData("text/plain")));
                            }}
                          >
                            {c.leave ? "Ta’til" : c.working ? `${c.start.replace(/:00$/, "")}–${c.end.replace(/:00$/, "")}` : "Dam"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="sp-name">Rejada</td>
                    {data.coverage.map((c) => (
                      <td key={c.date} className="sp-cov">
                        {c.planned}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            )}
          </section>
        </div>
      )}
      {patternOpen && data && <PatternModal data={data} from={from} onClose={() => setPatternOpen(false)} onDone={() => (setPatternOpen(false), void reload(true))} />}
      {templateOpen && <TemplateModal onClose={() => setTemplateOpen(false)} onDone={() => (setTemplateOpen(false), void reload(true))} />}
    </div>
  );
}

function PatternModal({ data, from, onClose, onDone }: { data: Plan; from: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ pattern: "5/2", templateId: data.templates[0]?.id || "", from, to: addDays(from, 27), offset: 0 });
  const [ids, setIds] = useState<string[]>(data.rows.map((r) => r.employeeId));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await post<{ cells: number }>("/shift-planner/pattern", { ...form, employeeIds: ids });
      toast(`Reja tuzildi: ${ids.length} xodim, ${r.cells} kun — xodimlarga xabar yuborildi`);
      onDone();
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Smena namunasi" subtitle="Tanlangan xodimlarga davr bo‘yicha avtomatik reja (mavjud reja ustidan yoziladi)" onClose={onClose}>
      <div className="form-grid">
        <Field label="Namuna">
          <select className="select" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })}>
            {data.patterns.map((p) => (
              <option key={p.key} value={p.key}>
                {p.key} — {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Smena">
          <select className="select" value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
            {data.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.start}–{t.end})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Boshlanish">
          <input className="input" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
        </Field>
        <Field label="Tugash (3 oygacha)">
          <input className="input" type="date" value={form.to} min={form.from} onChange={(e) => setForm({ ...form, to: e.target.value })} />
        </Field>
        <Field label="Siklning qaysi kunidan" hint="0 — birinchi ish kunidan; 2/2 da xodimlarni almashtirish uchun 2 qo‘ying">
          <input className="input" type="number" min={0} max={30} value={form.offset} onChange={(e) => setForm({ ...form, offset: Number(e.target.value) || 0 })} />
        </Field>
      </div>
      <Field label={`Xodimlar (${ids.length})`}>
        <div className="sp-people">
          {data.rows.map((r) => (
            <label key={r.employeeId} className="lc-check">
              <input type="checkbox" checked={ids.includes(r.employeeId)} onChange={(e) => setIds(e.target.checked ? [...ids, r.employeeId] : ids.filter((x) => x !== r.employeeId))} /> {r.name}
            </label>
          ))}
        </div>
      </Field>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button className="btn btn-primary" disabled={busy || !ids.length || !form.templateId} onClick={() => void save()}>
          <Wand2 size={16} /> Qo‘llash
        </button>
      </div>
    </Modal>
  );
}

function TemplateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", start: "09:00", end: "18:00", color: "#2563eb" });
  async function save() {
    try {
      await post("/shift-templates", form);
      onDone();
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  return (
    <Modal title="Yangi smena turi" onClose={onClose} size="narrow">
      <Field label="Nomi">
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Masalan: Kechki" />
      </Field>
      <div className="form-grid">
        <Field label="Boshlanish">
          <input className="input" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        </Field>
        <Field label="Tugash" hint={form.start !== form.end ? `${isOvernight(form.start, form.end) ? "Ertasi kuni · " : ""}${duration(shiftMinutes(form.start, form.end))}` : "Boshlanishdan farq qilsin"}>
          <input className="input" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        </Field>
      </div>
      <Field label="Rang">
        <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
      </Field>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button className="btn btn-primary" disabled={form.name.trim().length < 2 || form.start === form.end} onClick={() => void save()}>
          Saqlash
        </button>
      </div>
    </Modal>
  );
}
