import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { patch, post } from "../api";
import { useApi } from "../hooks";
import {
  Avatar,
  Empty,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  Status,
} from "../components/ui";
import { dateUz } from "@/lib/format";
import type { Employee, LeaveRequest } from "@/lib/types";
type Row = LeaveRequest & { employee?: Employee };
export function LeavePage() {
  const { data, loading, error, reload } = useApi<Row[]>("/leave"),
    { data: employees } = useApi<{ items: Employee[] }>("/employees?limit=50");
  const [open, setOpen] = useState(false);
  async function decide(id: string, status: "APPROVED" | "REJECTED") {
    await patch(`/leave/${id}`, { status });
    void reload();
  }
  return (
    <div className="page">
      <PageHeader
        title="Ta’til va yo‘qlik"
        subtitle="Xodim so‘rovlarini ko‘rib chiqing"
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> So‘rov qo‘shish
          </button>
        }
      />
      <section className="card">
        {loading ? (
          <Loading />
        ) : error ? (
          <div className="section-body">
            <ErrorBox message={error} />
          </div>
        ) : !data?.length ? (
          <Empty />
        ) : (
          <div className="table-wrap mobile-cards">
            <table className="table">
              <thead>
                <tr>
                  <th>Xodim</th>
                  <th>Turi</th>
                  <th>Boshlanish</th>
                  <th>Tugash</th>
                  <th>Sabab</th>
                  <th>Holat</th>
                  <th>Amal</th>
                </tr>
              </thead>
              <tbody>
                {data.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div className="cell-person">
                        <Avatar
                          first={l.employee?.firstName || "?"}
                          last={l.employee?.lastName}
                          photo={l.employee?.photoDataUrl}
                        />
                        <span>
                          <b>
                            {l.employee?.firstName} {l.employee?.lastName}
                          </b>
                          <small>{l.employee?.employeeNo}</small>
                        </span>
                      </div>
                    </td>
                    <td>{typeLabel(l.type)}</td>
                    <td>{dateUz(l.startDate)}</td>
                    <td>{dateUz(l.endDate)}</td>
                    <td>{l.reason}</td>
                    <td>
                      <Status value={l.status} />
                    </td>
                    <td>
                      {l.status === "PENDING" ? (
                        <div className="toolbar">
                          <button
                            className="btn btn-sm"
                            onClick={() => decide(l.id, "APPROVED")}
                          >
                            <Check size={14} /> Tasdiqlash
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => decide(l.id, "REJECTED")}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <span className="subtle">{l.decidedBy || "—"}</span>
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
          employees={employees?.items || []}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
const typeLabel = (v: string) =>
  ({
    VACATION: "Mehnat ta’tili",
    SICK: "Kasallik",
    PERMISSION: "Ruxsat",
    UNPAID: "Haq to‘lanmaydi",
    OTHER: "Boshqa",
  })[v] || v;
function LeaveForm({
  employees,
  onClose,
  onSaved,
}: {
  employees: Employee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
      employeeId: employees[0]?.id || "",
      type: "VACATION",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
      reason: "",
    }),
    [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post("/leave", form);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    }
  }
  return (
    <Modal title="Ta’til so‘rovi" onClose={onClose}>
      <form onSubmit={save}>
        <div className="field">
          <label className="label">Xodim</label>
          <select
            className="select"
            value={form.employeeId}
            onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
          >
            {employees.map((x) => (
              <option key={x.id} value={x.id}>
                {x.firstName} {x.lastName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label">Ta’til turi</label>
          <select
            className="select"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            <option value="VACATION">Mehnat ta’tili</option>
            <option value="SICK">Kasallik</option>
            <option value="PERMISSION">Ruxsat</option>
            <option value="UNPAID">Haq to‘lanmaydi</option>
            <option value="OTHER">Boshqa</option>
          </select>
        </div>
        <div className="form-grid">
          <div className="field">
            <label className="label">Boshlanish</label>
            <input
              className="input"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label">Tugash</label>
            <input
              className="input"
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <label className="label">Sabab</label>
          <textarea
            className="textarea"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            required
          />
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary">Yuborish</button>
        </div>
      </form>
    </Modal>
  );
}
