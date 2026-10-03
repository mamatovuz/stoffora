import { DeviceRequestsPanel } from "../components/MobileDevices";
import { LeaveBalancesPanel } from "./People";
import { useMemo, useState } from "react";
import { ArrowLeftRight, CalendarSync, Check, Plane, Plus, X } from "lucide-react";
import { errorText, notifyChange, patch, post } from "../api";
import type { ShiftSwapRequest } from "@/lib/types";
import { useApi } from "../hooks";
import {
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Person,
  Segmented,
  Status,
  useToast,
} from "../components/ui";
import { dateUz, tashkentIsoDate } from "@/lib/format";
import type { Employee, LeaveRequest } from "@/lib/types";
import { leaveTypeLabel } from "../types";
import { AdvanceRequestsPanel, type AdvanceRow } from "../components/AdvanceRequests";
import { useAuth } from "../auth";
import { canAny } from "@/lib/permissions";

type Row = LeaveRequest & { employee?: Employee };
type Tab = "PENDING" | "APPROVED" | "ALL" | "SWAPS" | "DAYOFF" | "ADVANCES" | "DEVICES" | "BALANCE";
type DayOffRow = { id: string; employeeName: string; fromDate: string; toDate: string; fromWeekday: string; toWeekday: string; reason?: string; status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; decidedBy?: string; createdAt: string };
type SwapRow = ShiftSwapRequest & { requesterName: string; colleagueName: string; giveShift?: string; takeShift?: string };

const days = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
      86_400_000,
  ) + 1;

export function LeavePage() {
  const { data, loading, error, reload } = useApi<Row[]>("/leave");
  const [tab, setTab] = useState<Tab>("PENDING");
  const swaps = useApi<SwapRow[]>("/shift-swaps");
  const dayoffs = useApi<DayOffRow[]>("/dayoff-moves");
  const { user } = useAuth();
  // HR 1-bosqichda avans so‘rovlarini ko‘radi (keyin moliyaga o‘tadi).
  const hrAdvances = Boolean(user && canAny(user.role, ["leave.approve", "employees.edit"]));
  const advances = useApi<AdvanceRow[]>(hrAdvances ? "/payroll/advances?status=PENDING" : null);
  const deviceRequests = useApi<{ id: string }[]>(hrAdvances ? "/mobile/device-requests?status=PENDING" : null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const today = tashkentIsoDate();
  const rows = useMemo(
    () =>
      (data || []).filter((l) =>
        tab === "ALL" ? true : tab === "PENDING" ? l.status === "PENDING" : l.status === "APPROVED",
      ),
    [data, tab],
  );
  const onLeaveNow = (data || []).filter(
    (l) => l.status === "APPROVED" && l.startDate <= today && l.endDate >= today,
  ).length;
  async function decide(id: string, status: "APPROVED" | "REJECTED") {
    setBusy(id);
    try {
      await patch(`/leave/${id}`, { status });
      toast(status === "APPROVED" ? "So‘rov tasdiqlandi" : "So‘rov rad etildi");
      notifyChange("leave");
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="page">
      <PageHeader
        title="Ta’til va yo‘qlik"
        subtitle={`Hozir ta’tilda: ${onLeaveNow} nafar`}
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> Ta’til qo‘shish
          </button>
        }
      />
      <section className="card">
        <div className="filters">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              {
                value: "PENDING",
                label: "Kutilmoqda",
                count: data?.filter((l) => l.status === "PENDING").length,
              },
              { value: "APPROVED", label: "Tasdiqlangan" },
              { value: "ALL", label: "Barchasi" },
              {
                value: "SWAPS",
                label: "Smena almashish",
                count: swaps.data?.filter((s) => s.status === "PENDING_MANAGER").length,
              },
              { value: "DAYOFF", label: "Dam kunini ko‘chirish", count: dayoffs.data?.filter((m) => m.status === "PENDING").length },
              ...(hrAdvances ? [{ value: "ADVANCES" as Tab, label: "Avans so‘rovlari", count: advances.data?.length }] : []),
              ...(hrAdvances ? [{ value: "DEVICES" as Tab, label: "Yangi telefon", count: deviceRequests.data?.length }] : []),
              { value: "BALANCE" as Tab, label: "Ta’til balansi" },
            ]}
          />
        </div>
        {tab === "BALANCE" ? (
          <LeaveBalancesPanel />
        ) : tab === "ADVANCES" ? (
          <div className="card-body">
            <AdvanceRequestsPanel mode="hr" onChanged={() => void advances.reload(true)} />
          </div>
        ) : tab === "DEVICES" ? (
          <DeviceRequestsPanel onChanged={() => void deviceRequests.reload(true)} />
        ) : tab === "SWAPS" ? (
          <SwapsPanel api={swaps} />
        ) : tab === "DAYOFF" ? (
          <DayOffPanel api={dayoffs} />
        ) : loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !rows.length ? (
          <Empty
            icon={Plane}
            title={tab === "PENDING" ? "Kutilayotgan so‘rov yo‘q" : "So‘rovlar yo‘q"}
            text="Xodimlar Telegram Mini App orqali ta’til so‘rovi yuboradi."
          />
        ) : (
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>Xodim</th>
                  <th>Turi</th>
                  <th>Sana</th>
                  <th>Sabab</th>
                  <th>Holat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Person
                        first={l.employee?.firstName || "?"}
                        last={l.employee?.lastName}
                        photo={l.employee?.photoDataUrl}
                        sub={l.employee?.employeeNo}
                      />
                    </td>
                    <td data-label="Turi">{leaveTypeLabel[l.type] || l.type}</td>
                    <td data-label="Sana">
                      <span className="stack">
                        <span className="num">
                          {dateUz(l.startDate)} — {dateUz(l.endDate)}
                        </span>
                        <small>{days(l.startDate, l.endDate)} kun</small>
                      </span>
                    </td>
                    <td data-label="Sabab" style={{ maxWidth: 280 }}>
                      {l.reason}
                      {l.documentId && (
                        <a className="leave-attachment" href={`/api/documents/${l.documentId}/file`} target="_blank" rel="noreferrer">
                          📎 Biriktirilgan hujjat
                        </a>
                      )}
                    </td>
                    <td data-label="Holat">
                      <span className="state-cell">
                        <Status value={l.status} />
                        {l.decidedBy && <small>{l.decidedBy}</small>}
                      </span>
                    </td>
                    <td className="actions">
                      {l.status === "PENDING" && (
                        <span className="toolbar" style={{ justifyContent: "flex-end" }}>
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={busy === l.id}
                            onClick={() => void decide(l.id, "APPROVED")}
                          >
                            <Check size={14} /> Tasdiqlash
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={busy === l.id}
                            onClick={() => void decide(l.id, "REJECTED")}
                            aria-label="Rad etish"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open && (
        <LeaveForm
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            toast("Ta’til qo‘shildi");
            void reload(true);
          }}
        />
      )}
    </div>
  );
}

function LeaveForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: employees } = useApi<{ items: Employee[] }>("/employees?limit=200&status=ACTIVE");
  const today = tashkentIsoDate();
  const [form, setForm] = useState({
    employeeId: "",
    type: "VACATION",
    startDate: today,
    endDate: today,
    reason: "",
    approve: true,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await post("/leave", form);
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Ta’til qo‘shish" onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Xodim *">
          <select
            className="select"
            value={form.employeeId}
            onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
            required
          >
            <option value="" disabled>
              Tanlang
            </option>
            {employees?.items.map((x) => (
              <option key={x.id} value={x.id}>
                {x.firstName} {x.lastName} · {x.employeeNo}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Turi">
          <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {Object.entries(leaveTypeLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Boshlanish">
            <input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: form.endDate < e.target.value ? e.target.value : form.endDate })} required />
          </Field>
          <Field label="Tugash">
            <input className="input" type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
          </Field>
        </div>
        <Field label="Sabab *">
          <textarea className="textarea" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required minLength={3} />
        </Field>
        <label className="checkbox-row" style={{ marginBottom: 14 }}>
          <input type="checkbox" checked={form.approve} onChange={(e) => setForm({ ...form, approve: e.target.checked })} />
          Darhol tasdiqlash
        </label>
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

const swapStatus: Record<ShiftSwapRequest["status"], [string, string]> = {
  PENDING_COLLEAGUE: ["Hamkasb javobi kutilmoqda", "PENDING"],
  PENDING_MANAGER: ["Tasdiq kutilmoqda", "PENDING"],
  APPROVED: ["Tasdiqlangan", "APPROVED"],
  REJECTED: ["Rad etilgan", "REJECTED"],
  CANCELLED: ["Bekor qilingan", "CANCELLED"],
};

function SwapsPanel({ api }: { api: ReturnType<typeof useApi<SwapRow[]>> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  async function decide(id: string, approve: boolean) {
    setBusy(id);
    try {
      await post(`/shift-swaps/${id}/decide`, { approve });
      toast(approve ? "Almashish tasdiqlandi — grafik yangilandi" : "Almashish rad etildi");
      notifyChange("leave");
      void api.reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(null);
    }
  }
  if (api.loading && !api.data) return <Loading />;
  if (api.error)
    return (
      <div className="card-body">
        <ErrorBox message={api.error} />
      </div>
    );
  if (!api.data?.length)
    return (
      <Empty
        icon={ArrowLeftRight}
        title="Smena almashish so‘rovlari yo‘q"
        text="Xodim Mini App orqali hamkasbiga ish kunini beradi, hamkasb rozi bo‘lgach so‘rov shu yerga tushadi."
      />
    );
  return (
    <div className="swap-list">
      {api.data.map((s) => (
        <article key={s.id} className={`swap-card ${s.status === "PENDING_MANAGER" ? "is-pending" : ""}`}>
          <div className="swap-people">
            <div>
              <small>Beradi</small>
              <b>{s.requesterName}</b>
            </div>
            <ArrowLeftRight size={18} className="swap-arrow" />
            <div>
              <small>Oladi</small>
              <b>{s.colleagueName}</b>
            </div>
          </div>
          <div className="swap-dates">
            <span>
              <b className="num">{dateUz(s.giveDate)}</b>
              {s.giveShift && <small>{s.giveShift}</small>}
              <em>{s.colleagueName.split(" ")[0]} ishlaydi</em>
            </span>
            {s.takeDate && (
              <span>
                <b className="num">{dateUz(s.takeDate)}</b>
                {s.takeShift && <small>{s.takeShift}</small>}
                <em>{s.requesterName.split(" ")[0]} ishlaydi</em>
              </span>
            )}
          </div>
          {s.reason && <p className="swap-reason">{s.reason}</p>}
          <footer>
            <span className="state-cell">
              <Status value={swapStatus[s.status][1]} label={swapStatus[s.status][0]} />
              {s.decidedBy && <small>{s.decidedBy}</small>}
            </span>
            {s.status === "PENDING_MANAGER" && (
              <span className="toolbar">
                <button className="btn btn-sm btn-primary" disabled={busy === s.id} onClick={() => void decide(s.id, true)}>
                  <Check size={14} /> Tasdiqlash
                </button>
                <button className="btn btn-sm btn-danger" disabled={busy === s.id} onClick={() => void decide(s.id, false)} aria-label="Rad etish">
                  <X size={14} />
                </button>
              </span>
            )}
          </footer>
        </article>
      ))}
    </div>
  );
}

/** Dam olish kunini bir martaga ko‘chirish so‘rovlari (xodim Mini App’dan yuboradi). */
function DayOffPanel({ api }: { api: ReturnType<typeof useApi<DayOffRow[]>> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  async function decide(id: string, approve: boolean) {
    setBusy(id);
    try {
      await post(`/dayoff-moves/${id}/decide`, { approve });
      toast(approve ? "Dam kuni ko‘chirildi — faqat shu hafta uchun" : "So‘rov rad etildi");
      notifyChange("leave");
      void api.reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(null);
    }
  }
  if (api.loading && !api.data) return <Loading />;
  if (api.error)
    return (
      <div className="card-body">
        <ErrorBox message={api.error} />
      </div>
    );
  if (!api.data?.length)
    return (
      <Empty
        icon={CalendarSync}
        title="Dam kunini ko‘chirish so‘rovlari yo‘q"
        text="Xodim Mini App’da «Dam kuni» bo‘limidan masalan juma o‘rniga shanba dam olishni so‘raydi. Tasdiqlansa — faqat o‘sha hafta uchun ko‘chadi."
      />
    );
  return (
    <div className="swap-list">
      {api.data.map((m) => (
        <article key={m.id} className={`swap-card ${m.status === "PENDING" ? "is-pending" : ""}`}>
          <div className="swap-people">
            <div>
              <small>Xodim</small>
              <b>{m.employeeName}</b>
            </div>
          </div>
          <div className="swap-dates">
            <span>
              <b className="num">{dateUz(m.fromDate)}</b>
              <small>{m.fromWeekday}</small>
              <em>ishlaydi (odatda dam)</em>
            </span>
            <span>
              <b className="num">{dateUz(m.toDate)}</b>
              <small>{m.toWeekday}</small>
              <em>dam oladi</em>
            </span>
          </div>
          {m.reason && <p className="swap-reason">{m.reason}</p>}
          <footer>
            <span className="state-cell">
              <Status value={m.status} label={{ PENDING: "Tasdiq kutilmoqda", APPROVED: "Tasdiqlangan", REJECTED: "Rad etilgan", CANCELLED: "Bekor qilingan" }[m.status]} />
              {m.decidedBy && <small>{m.decidedBy}</small>}
            </span>
            {m.status === "PENDING" && (
              <span className="toolbar">
                <button className="btn btn-sm btn-primary" disabled={busy === m.id} onClick={() => void decide(m.id, true)}>
                  <Check size={14} /> Tasdiqlash
                </button>
                <button className="btn btn-sm btn-danger" disabled={busy === m.id} onClick={() => void decide(m.id, false)} aria-label="Rad etish">
                  <X size={14} />
                </button>
              </span>
            )}
          </footer>
        </article>
      ))}
    </div>
  );
}
