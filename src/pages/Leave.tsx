import { useMemo, useState } from "react";
import { Check, Plane, Plus, X } from "lucide-react";
import { errorText, notifyChange, patch, post } from "../api";
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

type Row = LeaveRequest & { employee?: Employee };
type Tab = "PENDING" | "APPROVED" | "ALL";

const days = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
      86_400_000,
  ) + 1;

export function LeavePage() {
  const { data, loading, error, reload } = useApi<Row[]>("/leave");
  const [tab, setTab] = useState<Tab>("PENDING");
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
            ]}
          />
        </div>
        {loading && !data ? (
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
