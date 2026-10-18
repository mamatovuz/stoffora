import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { useApi } from "../hooks";
import { useAuth } from "../auth";
import { can } from "@/lib/permissions";
import { dateLongUz, duration, tashkentIsoDate } from "@/lib/format";
import type { Branch } from "@/lib/types";
import { leaveTypeLabel } from "../types";
import { Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { AttendanceEditModal, type EditTarget } from "../components/AttendanceEdit";

/*
 * Umumiy tabel (Verifix’dagidek): barcha xodimlar × oy kunlari bitta jadvalda.
 * Katakda — keldi (yuqorida) va ketdi (pastda), rang — holat. Ism ustuni va sarlavha yopishqoq,
 * o‘ngda oy bo‘yicha jami. Katak bosilsa — davomatni shu yerning o‘zida tuzatish (huquq bo‘lsa).
 * Excel — xuddi shu jadval (/api/attendance/grid.xlsx).
 */

type State = "PLANNED" | "ON_TIME" | "LATE" | "IN" | "NO_CHECKOUT" | "ABSENT" | "REST" | "REST_WORKED" | "LEAVE" | "BEFORE_START";
type Cell = { date: string; state: State; in?: string; out?: string; late: number; early: number; worked: number; plan?: string; leave?: string; reason?: string; manual: boolean; recordId?: string };
type Row = {
  employee: { id: string; name: string; employeeNo: string; photo?: string; branchId: string };
  branch: string;
  position: string;
  cells: Cell[];
  totals: { present: number; late: number; lateMinutes: number; early: number; absent: number; leave: number; workedMinutes: number; plannedMinutes: number };
};
type Grid = { month: string; label: string; today: string; company: string; dates: { date: string; weekday: number; holiday?: string }[]; rows: Row[] };

const WEEKDAY = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
const STATE_LABEL: Record<State, string> = {
  PLANNED: "Reja",
  ON_TIME: "Vaqtida",
  LATE: "Kechikdi",
  IN: "Ishda",
  NO_CHECKOUT: "Ketish belgilanmagan",
  ABSENT: "Kelmadi",
  REST: "Dam olish",
  REST_WORKED: "Dam kunida ishladi",
  LEAVE: "Ta’til",
  BEFORE_START: "Ishga kirmagan",
};
const shiftMonth = (month: string, delta: number) => {
  const d = new Date(`${month}-15T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
};
const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0] || "")
    .join("")
    .toUpperCase();

/** Katak ustiga olib borilganda — to‘liq ma’lumot. */
function cellTitle(row: Row, c: Cell) {
  return [
    `${row.employee.name} · ${dateLongUz(c.date, true)}`,
    c.plan ? `Grafik: ${c.plan}` : c.state === "REST" ? `Dam olish${c.reason ? ` (${c.reason})` : ""}` : "",
    c.in ? `Keldi ${c.in}${c.out ? ` · ketdi ${c.out}` : ""}` : STATE_LABEL[c.state],
    c.late ? `Kechikdi: ${duration(c.late)}` : "",
    c.early ? `Erta ketdi: ${duration(c.early)}` : "",
    c.worked ? `Ishladi: ${duration(c.worked)}` : "",
    c.leave ? leaveTypeLabel[c.leave] || "Ta’til" : "",
    c.manual ? "✎ Qo‘lda tuzatilgan" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function AttendanceGridPage() {
  const { user } = useAuth();
  const canEdit = Boolean(user && can(user.role, "attendance.edit"));
  const current = tashkentIsoDate().slice(0, 7);
  const [month, setMonth] = useState(current);
  const [branch, setBranch] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const qs = `month=${month}${branch ? `&branch=${branch}` : ""}`;
  const { data, loading, error, reload } = useApi<Grid>(`/attendance/grid?${qs}`);
  const branches = useApi<Branch[]>("/branches");
  const grid = data?.month === month ? data : null;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (grid?.rows || []).filter((r) => !q || `${r.employee.name} ${r.employee.employeeNo} ${r.branch} ${r.position}`.toLowerCase().includes(q));
  }, [grid, query]);
  const totals = rows.reduce(
    (acc, r) => ({ present: acc.present + r.totals.present, late: acc.late + r.totals.late, absent: acc.absent + r.totals.absent, worked: acc.worked + r.totals.workedMinutes }),
    { present: 0, late: 0, absent: 0, worked: 0 },
  );
  const today = grid?.today || tashkentIsoDate();
  const grouped = !branch && new Set(rows.map((r) => r.branch)).size > 1;

  const openCell = (row: Row, c: Cell) => {
    if (!canEdit || c.date > today || c.state === "BEFORE_START") return;
    setEditing({
      employeeId: row.employee.id,
      employeeName: row.employee.name,
      date: c.date,
      plan: c.plan,
      record: c.recordId ? { id: c.recordId, checkIn: c.in, checkOut: c.out, manual: c.manual } : undefined,
    });
  };

  return (
    <div className="page tgrid-page">
      <PageHeader
        title="Tabel"
        subtitle="Barcha xodimlar × oy kunlari · har katakda keldi (yuqorida) va ketdi (pastda)"
        actions={
          <a className="btn" href={`/api/attendance/grid.xlsx?${qs}`} download>
            <Download size={16} /> Excel
          </a>
        }
      />
      <section className="card tgrid-card">
        <div className="tgrid-bar">
          <div className="tgrid-month">
            <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Oldingi oy">
              <ChevronLeft size={16} />
            </button>
            <b>{grid?.label || data?.label || month}</b>
            <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= current} aria-label="Keyingi oy">
              <ChevronRight size={16} />
            </button>
          </div>
          {(branches.data?.length || 0) > 1 && (
            <select className="input tgrid-select" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Filial">
              <option value="">Barcha filiallar</option>
              {branches.data!.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <label className="tgrid-search">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Xodim, ID yoki lavozim" />
          </label>
          {grid && (
            <div className="tgrid-sum">
              <span>
                <b>{rows.length}</b> xodim
              </span>
              <span className="ok">
                <b>{totals.present}</b> kelgan kun
              </span>
              <span className="warn">
                <b>{totals.late}</b> kechikish
              </span>
              <span className="bad">
                <b>{totals.absent}</b> kelmagan
              </span>
              <span>
                <b>{duration(totals.worked)}</b> ishlangan
              </span>
            </div>
          )}
        </div>

        {error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !grid && loading ? (
          <Loading />
        ) : !rows.length ? (
          <Empty title="Xodim topilmadi" text={query ? "Qidiruvni o‘zgartirib ko‘ring." : "Bu oy uchun tabelda xodim yo‘q."} />
        ) : (
          <div className="tgrid-wrap">
            <table className="tgrid">
              <thead>
                <tr>
                  <th className="tgrid-name">Xodim</th>
                  {grid!.dates.map((d) => (
                    <th key={d.date} className={`${d.weekday === 0 || d.holiday ? "off" : ""} ${d.date === today ? "today" : ""}`} title={d.holiday || undefined}>
                      <b>{Number(d.date.slice(8))}</b>
                      <small>{WEEKDAY[d.weekday]}</small>
                    </th>
                  ))}
                  <th className="tgrid-total">Keldi</th>
                  <th className="tgrid-total">Kech</th>
                  <th className="tgrid-total">Kelmadi</th>
                  <th className="tgrid-total">Ishladi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <Fragment key={row.employee.id}>
                    {grouped && row.branch !== rows[i - 1]?.branch && (
                      <tr className="tgrid-group">
                        <td className="tgrid-name">
                          {row.branch || "Filialsiz"} · {rows.filter((r) => r.branch === row.branch).length}
                        </td>
                        <td colSpan={grid!.dates.length + 4} />
                      </tr>
                    )}
                    <tr>
                      <td className="tgrid-name">
                        <Link to={`/employees/${row.employee.id}`} className="tgrid-person">
                          <span className="tgrid-avatar">{row.employee.photo ? <img src={row.employee.photo} alt="" /> : initials(row.employee.name)}</span>
                          <span>
                            <b>{row.employee.name}</b>
                            <small>{[row.position, grouped ? "" : row.branch].filter(Boolean).join(" · ") || row.employee.employeeNo}</small>
                          </span>
                        </Link>
                      </td>
                      {row.cells.map((c) => {
                        const editable = canEdit && c.date <= today && c.state !== "BEFORE_START";
                        return (
                          <td key={c.date} className={`tgrid-cell s-${c.state.toLowerCase()} ${c.date === today ? "today" : ""}`}>
                            <button type="button" disabled={!editable} onClick={() => openCell(row, c)} title={cellTitle(row, c)} aria-label={cellTitle(row, c)}>
                              {c.in ? (
                                <>
                                  <span>{c.in}</span>
                                  <span className="out">{c.out || (c.state === "IN" ? "…" : "—")}</span>
                                </>
                              ) : c.state === "ABSENT" ? (
                                <span className="mark">✕</span>
                              ) : c.state === "LEAVE" ? (
                                <span className="mark">T</span>
                              ) : null}
                              {c.manual && <i className="tgrid-manual">✎</i>}
                            </button>
                          </td>
                        );
                      })}
                      <td className="tgrid-total">{row.totals.present || "—"}</td>
                      <td className={`tgrid-total ${row.totals.late ? "warn" : ""}`} title={row.totals.lateMinutes ? `Jami ${duration(row.totals.lateMinutes)}` : undefined}>
                        {row.totals.late || "—"}
                      </td>
                      <td className={`tgrid-total ${row.totals.absent ? "bad" : ""}`}>{row.totals.absent || "—"}</td>
                      <td className="tgrid-total">{row.totals.workedMinutes ? `${Math.round(row.totals.workedMinutes / 60)} s` : "—"}</td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="tgrid-legend">
          <span>
            <i className="s-on_time" /> Vaqtida
          </span>
          <span>
            <i className="s-late" /> Kechikdi
          </span>
          <span>
            <i className="s-no_checkout" /> Ketish belgilanmagan
          </span>
          <span>
            <i className="s-absent" /> Kelmadi (✕)
          </span>
          <span>
            <i className="s-leave" /> Ta’til (T)
          </span>
          <span>
            <i className="s-rest" /> Dam olish
          </span>
          <span>✎ Qo‘lda tuzatilgan</span>
          {canEdit && <span className="tgrid-hint">Katakni bosing — davomatni tuzatish</span>}
        </div>
      </section>
      {editing && (
        <AttendanceEditModal
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload(true);
          }}
        />
      )}
    </div>
  );
}
