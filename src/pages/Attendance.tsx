import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlarmClock,
  ChevronLeft,
  ChevronRight,
  Download,
  LogIn,
  LogOut,
  MapPin,
  Pencil,
  Plane,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserX,
  Users,
  AlertTriangle,
} from "lucide-react";
import { del, errorText, post, put } from "../api";
import { useApi, usePolling } from "../hooks";
import {
  Confirm,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Person,
  Segmented,
  StatCard,
  Status,
  useToast,
} from "../components/ui";
import { dateLongUz, duration, tashkentClock, tashkentIsoDate } from "@/lib/format";
import { FLAG_LABELS } from "@/lib/gps";
import {
  addDays,
  leaveTypeLabel,
  verificationLabel,
  type Meta,
  type RosterRow,
  type RosterStats,
} from "../types";

type Day = { date: string; stats: RosterStats; rows: RosterRow[] };
type Filter =
  | "ALL"
  | "PRESENT"
  | "IN"
  | "LEFT"
  | "LATE"
  | "ABSENT"
  | "ON_LEAVE"
  | "NOT_YET";

export function AttendancePage() {
  const [params, setParams] = useSearchParams();
  const today = tashkentIsoDate();
  const date = params.get("date") || today;
  const filter = (params.get("state") as Filter) || "ALL";
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const [editing, setEditing] = useState<RosterRow | null>(null);
  const [flagged, setFlagged] = useState<RosterRow | null>(null);
  const [removing, setRemoving] = useState<RosterRow | null>(null);
  const toast = useToast();
  const { data, loading, error, reload } = useApi<Day>(
    `/attendance/day?date=${date}`,
  );
  const { data: meta } = useApi<Meta>("/meta");
  usePolling(() => {
    if (date === today) void reload(true);
  }, 30_000);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.rows || [])
      .filter((row) => !branch || row.employee.branchId === branch)
      .filter((row) =>
        !q
          ? true
          : `${row.employee.firstName} ${row.employee.lastName} ${row.employee.employeeNo} ${row.employee.phone}`
              .toLowerCase()
              .includes(q),
      )
      .filter((row) =>
        filter === "ALL"
          ? true
          : filter === "LATE"
            ? row.late
            : filter === "PRESENT"
              ? row.state === "IN" || row.state === "LEFT"
              : row.state === filter,
      )
      .sort((a, b) => order(a) - order(b) ||
        `${a.employee.firstName}`.localeCompare(`${b.employee.firstName}`));
  }, [data, query, branch, filter]);

  const s = data?.stats;
  return (
    <div className="page">
      <PageHeader
        title="Keldi-ketdi"
        subtitle={
          <>
            {dateLongUz(date, true)}
            {date === today && (
              <>
                {" "}
                · <span className="live-dot" style={{ marginLeft: 4 }} />
                jonli yangilanadi
              </>
            )}
          </>
        }
        actions={
          <>
            <div className="date-nav">
              <button
                className="icon-btn"
                aria-label="Oldingi kun"
                onClick={() => set("date", addDays(date, -1))}
              >
                <ChevronLeft size={17} />
              </button>
              <input
                type="date"
                value={date}
                max={today}
                onChange={(e) => set("date", e.target.value)}
                aria-label="Sana"
              />
              <button
                className="icon-btn"
                aria-label="Keyingi kun"
                disabled={date >= today}
                onClick={() => set("date", addDays(date, 1))}
              >
                <ChevronRight size={17} />
              </button>
            </div>
            {date !== today && (
              <button className="btn" onClick={() => set("date", "")}>
                Bugun
              </button>
            )}
            <a
              className="btn"
              href={`/api/reports/attendance.xlsx?from=${date}&to=${date}`}
              download
            >
              <Download size={16} /> Excel
            </a>
          </>
        }
      />

      {s && (
        <div className="stat-grid">
          <StatCard
            label="Jami xodim"
            value={s.total}
            note={`${s.dayOff} nafar dam olishda`}
            icon={Users}
            onClick={() => set("state", "")}
            selected={filter === "ALL"}
          />
          <StatCard
            label="Keldi"
            value={s.present}
            note={`${s.inNow} ishda · ${s.left} ketgan`}
            icon={UserCheck}
            tone="green"
            onClick={() => set("state", "PRESENT")}
            selected={filter === "PRESENT"}
          />
          <StatCard
            label="Kechikdi"
            value={s.late}
            icon={AlarmClock}
            tone="amber"
            onClick={() => set("state", "LATE")}
            selected={filter === "LATE"}
          />
          <StatCard
            label="Kelmadi"
            value={s.absent}
            note={s.notYet ? `${s.notYet} nafar kutilmoqda` : undefined}
            icon={UserX}
            tone="red"
            onClick={() => set("state", "ABSENT")}
            selected={filter === "ABSENT"}
          />
          <StatCard
            label="Ta’tilda"
            value={s.leave}
            icon={Plane}
            tone="violet"
            onClick={() => set("state", "ON_LEAVE")}
            selected={filter === "ON_LEAVE"}
          />
        </div>
      )}

      <section className="card">
        <div className="filters">
          <span className="input-icon">
            <Search size={16} />
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ism, ID yoki telefon…"
            />
          </span>
          <select
            className="select"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">Barcha filiallar</option>
            {meta?.branches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <div style={{ marginLeft: "auto", overflowX: "auto" }}>
            <Segmented<Filter>
              value={filter}
              onChange={(value) => set("state", value === "ALL" ? "" : value)}
              options={[
                { value: "ALL", label: "Barchasi" },
                { value: "IN", label: "Ishda", count: s?.inNow },
                { value: "LEFT", label: "Ketgan", count: s?.left },
                { value: "NOT_YET", label: "Kutilmoqda", count: s?.notYet },
              ]}
            />
          </div>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !rows.length ? (
          <Empty
            icon={Users}
            title={data?.rows.length ? "Mos xodim topilmadi" : "Xodimlar yo‘q"}
            text={
              data?.rows.length
                ? "Filtr yoki qidiruvni o‘zgartiring."
                : "Keldi-ketdi ro‘yxati xodimlar qo‘shilgach paydo bo‘ladi."
            }
            action={
              !data?.rows.length && (
                <Link to="/employees/new" className="btn btn-primary">
                  Xodim qo‘shish
                </Link>
              )
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>Xodim</th>
                  <th>Grafik</th>
                  <th>Keldi</th>
                  <th>Ketdi</th>
                  <th>Ishladi</th>
                  <th>Holat</th>
                  <th>Tasdiq</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const r = row.record;
                  return (
                    <tr key={row.employee.id}>
                      <td>
                        <Link to={`/employees/${row.employee.id}`}>
                          <Person
                            first={row.employee.firstName}
                            last={row.employee.lastName}
                            photo={row.employee.photoDataUrl}
                            sub={[row.position, row.branch]
                              .filter(Boolean)
                              .join(" · ")}
                          />
                        </Link>
                      </td>
                      <td data-label="Grafik" className="num">
                        {row.scheduledStart
                          ? `${row.scheduledStart}–${row.scheduledEnd}`
                          : "—"}
                      </td>
                      <td data-label="Keldi">
                        <span className="stack">
                          <b className="time">{r?.checkIn || "—"}</b>
                          {row.late && (
                            <small className="late-text">
                              +{r?.lateMinutes} daq
                            </small>
                          )}
                        </span>
                      </td>
                      <td data-label="Ketdi">
                        <span className="stack">
                          <b className="time">
                            {r?.checkOut ||
                              (r?.checkIn ? (
                                <span className="faint">…</span>
                              ) : (
                                "—"
                              ))}
                          </b>
                          {!!r?.earlyLeaveMinutes && (
                            <small className="late-text">
                              −{r.earlyLeaveMinutes} daq erta
                            </small>
                          )}
                        </span>
                      </td>
                      <td data-label="Ishladi" className="num">
                        {r?.checkIn
                          ? r.checkOut
                            ? duration(r.workedMinutes)
                            : date === today
                              ? duration(liveMinutes(r.checkIn))
                              : "—"
                          : "—"}
                        {!!r?.overtimeMinutes && (
                          <small className="muted" style={{ display: "block" }}>
                            +{duration(r.overtimeMinutes)} qo‘shimcha
                          </small>
                        )}
                      </td>
                      <td data-label="Holat">
                        <span className="state-cell">
                          <Status value={row.state} live={row.state === "IN"} />
                          {row.state === "ON_LEAVE" && row.leaveType && (
                            <small>{leaveTypeLabel[row.leaveType]}</small>
                          )}
                          {r?.note && <small title={r.note}>{truncate(r.note)}</small>}
                        </span>
                      </td>
                      <td data-label="Tasdiq">
                        <span className="tags">
                          {r?.verification.map((item) => (
                            <span className="tag" key={item}>
                              {item === "MANUAL" ? (
                                <Pencil size={10} />
                              ) : (
                                <ShieldCheck size={10} />
                              )}
                              {verificationLabel[item] || item}
                            </span>
                          )) || <span className="faint">—</span>}
                          {r?.flags?.length ? (
                            <button
                              className={`tag gps-flag ${r.flagsReviewedBy ? "reviewed" : ""}`}
                              title={`${r.flags.map((f) => FLAG_LABELS[f]).join("\n")}${r.flagsReviewedBy ? `\nKo‘rib chiqildi: ${r.flagsReviewedBy}` : "\nBosing — ko‘rib chiqish"}`}
                              onClick={() => setFlagged(row)}
                            >
                              <AlertTriangle size={10} /> {r.flagsReviewedBy ? "Tekshirilgan" : "Shubhali GPS"}
                            </button>
                          ) : null}
                        </span>
                      </td>
                      <td className="actions">
                        <span className="roster-actions">
                          {!r && row.state !== "UPCOMING" && (
                            <button
                              className="btn btn-sm"
                              onClick={() => setEditing(row)}
                            >
                              <LogIn size={14} /> Belgilash
                            </button>
                          )}
                          {r && !r.checkOut && date === today && (
                            <QuickCheckout
                              row={row}
                              onDone={() => {
                                toast("Ketish qayd etildi");
                                void reload(true);
                              }}
                            />
                          )}
                          {r && (
                            <>
                              <button
                                className="icon-btn"
                                aria-label="Tahrirlash"
                                title="Tahrirlash"
                                onClick={() => setEditing(row)}
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                className="icon-btn danger"
                                aria-label="O‘chirish"
                                title="O‘chirish"
                                onClick={() => setRemoving(row)}
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <AttendanceForm
          row={editing}
          date={date}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            toast(message);
            void reload(true);
          }}
        />
      )}
      {flagged?.record && (
        <Modal title="Shubhali joylashuv" subtitle={`${flagged.employee.firstName} ${flagged.employee.lastName} · ${dateLongUz(date)}`} onClose={() => setFlagged(null)} size="narrow">
          <div className="stack" style={{ gap: 10 }}>
            <ul className="flag-list">
              {(flagged.record.flags || []).map((flag) => (
                <li key={flag}>
                  <AlertTriangle size={14} /> {FLAG_LABELS[flag]}
                </li>
              ))}
            </ul>
            <div className="kv">
              <div>
                <span>Filialgacha masofa</span>
                <b>{flagged.record.distanceMeters ?? "—"} m</b>
              </div>
              <div>
                <span>Koordinata</span>
                <b>
                  {flagged.record.latitude?.toFixed(6)}, {flagged.record.longitude?.toFixed(6)}
                </b>
              </div>
            </div>
            {flagged.record.latitude && (
              <a className="link" href={`https://maps.google.com/?q=${flagged.record.latitude},${flagged.record.longitude}`} target="_blank" rel="noreferrer">
                Xaritada ko‘rish →
              </a>
            )}
            <p className="muted" style={{ fontSize: 12.5 }}>
              Bu faqat ogohlantirish — davomat bloklanmagan. Face ID rasmi (rasm kanali yoqilgan bo‘lsa) bilan solishtirib, qaror qiling.
            </p>
            {flagged.record.flagsReviewedBy && <p className="muted">Ko‘rib chiqilgan: {flagged.record.flagsReviewedBy}</p>}
            <div className="form-actions">
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await post(`/attendance/${flagged.record!.id}/review-flags`, { verdict: "SUSPICIOUS" });
                  toast("Shubhali deb belgilandi");
                  setFlagged(null);
                  void reload(true);
                }}
              >
                Shubhali
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  await post(`/attendance/${flagged.record!.id}/review-flags`, { verdict: "OK" });
                  toast("Hammasi joyida deb belgilandi");
                  setFlagged(null);
                  void reload(true);
                }}
              >
                Joyida edi
              </button>
            </div>
          </div>
        </Modal>
      )}
      {removing?.record && (
        <Confirm
          title="Davomat qaydini o‘chirish"
          text={`${removing.employee.firstName} ${removing.employee.lastName} uchun ${dateLongUz(date)} kungi qayd o‘chiriladi. Amal audit jurnaliga yoziladi.`}
          confirmLabel="O‘chirish"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await del(`/attendance/${removing.record!.id}`);
            toast("Qayd o‘chirildi");
            void reload(true);
          }}
        />
      )}
    </div>
  );
}

const stateOrder: Record<string, number> = {
  IN: 0,
  LEFT: 1,
  ABSENT: 2,
  NOT_YET: 3,
  ON_LEAVE: 4,
  DAY_OFF: 5,
  UPCOMING: 6,
  PRACTICE: 3,
};
const order = (row: RosterRow) => stateOrder[row.state] ?? 9;
const truncate = (value: string) =>
  value.length > 28 ? `${value.slice(0, 26)}…` : value;
function liveMinutes(checkIn: string) {
  const [h, m] = checkIn.split(":").map(Number);
  const [nh, nm] = tashkentClock().split(":").map(Number);
  return Math.max(0, nh * 60 + nm - (h * 60 + m));
}

function QuickCheckout({
  row,
  onDone,
}: {
  row: RosterRow;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <button
      className="btn btn-sm"
      disabled={busy}
      title="Hozirgi vaqt bilan ketishni belgilash"
      onClick={async () => {
        setBusy(true);
        try {
          await put(`/attendance/${row.record!.id}`, {
            checkIn: row.record!.checkIn,
            checkOut: tashkentClock(),
            note: row.record!.note,
          });
          onDone();
        } catch (reason) {
          toast(errorText(reason), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <LogOut size={14} /> Ketdi
    </button>
  );
}

function AttendanceForm({
  row,
  date,
  onClose,
  onSaved,
}: {
  row: RosterRow;
  date: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const record = row.record;
  const [checkIn, setCheckIn] = useState(
    record?.checkIn ||
      (date === tashkentIsoDate() ? tashkentClock() : row.scheduledStart || "09:00"),
  );
  const [checkOut, setCheckOut] = useState(record?.checkOut || "");
  const [note, setNote] = useState(record?.note || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (record)
        await put(`/attendance/${record.id}`, {
          checkIn,
          checkOut,
          note: note || undefined,
        });
      else
        await post("/attendance", {
          employeeId: row.employee.id,
          date,
          checkIn,
          checkOut,
          note: note || undefined,
        });
      onSaved(record ? "Davomat yangilandi" : "Davomat qo‘lda belgilandi");
    } catch (reason) {
      setError(errorText(reason, "Davomat saqlanmadi."));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={record ? "Davomatni tahrirlash" : "Davomatni qo‘lda belgilash"}
      subtitle={`${row.employee.firstName} ${row.employee.lastName} · ${dateLongUz(date)}`}
      onClose={onClose}
    >
      <div className="alert warn" style={{ marginBottom: 16 }}>
        <ShieldCheck size={18} />
        <div>
          <b>Audit nazorati</b>
          <p>
            Qo‘lda kiritilgan har bir o‘zgarish kim tomonidan qilingani bilan
            audit jurnaliga yoziladi.
          </p>
        </div>
      </div>
      <form onSubmit={save}>
        <div className="form-grid">
          <Field
            label="Kelish vaqti"
            hint={row.scheduledStart ? `Grafik: ${row.scheduledStart}` : undefined}
          >
            <input
              className="input"
              type="time"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Ketish vaqti"
            hint={row.scheduledEnd ? `Grafik: ${row.scheduledEnd}` : "Bo‘sh qoldirsa — hali ishda"}
          >
            <input
              className="input"
              type="time"
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
            />
          </Field>
          <Field label="Izoh (sabab)" className="span-2">
            <input
              className="input"
              value={note}
              maxLength={300}
              placeholder="Masalan: telefon ishlamadi, qo‘lda belgilandi"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        {record?.distanceMeters !== undefined && (
          <p className="hint" style={{ marginBottom: 12 }}>
            <MapPin size={13} style={{ display: "inline", verticalAlign: -2 }} />{" "}
            Qayd paytida filialdan masofa: {record.distanceMeters} m
          </p>
        )}
        <ErrorBox message={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
