import {
  Download,
  FileSpreadsheet,
  FileText,
  Timer,
  Users,
} from "lucide-react";
import { useApi } from "../hooks";
import { Avatar, ErrorBox, Loading, PageHeader } from "../components/ui";
import { money } from "@/lib/format";
import type { Employee } from "@/lib/types";
type Payroll = {
  employee: Employee;
  base: number;
  overtimeAmount: number;
  deduction: number;
  net: number;
};
export function PayrollPage() {
  const { data, loading, error } = useApi<Payroll[]>("/payroll");
  const total = data?.reduce((s, x) => s + x.net, 0) || 0;
  return (
    <div className="page">
      <PageHeader
        title="Ish haqi"
        subtitle="Joriy oy uchun hisob-kitob tayyorlamasi"
        actions={
          <a className="btn" href="/api/reports/payroll.csv" download>
            <Download size={16} /> Eksport
          </a>
        }
      />
      <div
        className="grid-stats"
        style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 16 }}
      >
        <div className="card stat">
          <div className="stat-label">Xodimlar</div>
          <div className="stat-value">{data?.length || 0}</div>
          <div className="stat-note">Hisob-kitobga kiritilgan</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Jami hisoblangan</div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            {money(total)}
          </div>
          <div className="stat-note">Sof to‘lov</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Davr</div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            Sentabr 2026
          </div>
          <div className="stat-note">Ochiq davr</div>
        </div>
      </div>
      <section className="card">
        {loading ? (
          <Loading />
        ) : error ? (
          <div className="section-body">
            <ErrorBox message={error} />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Xodim</th>
                  <th>Bazaviy</th>
                  <th>Qo‘shimcha ish</th>
                  <th>Ushlanma</th>
                  <th>Sof summa</th>
                  <th>Holat</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((x) => (
                  <tr key={x.employee.id}>
                    <td>
                      <div className="cell-person">
                        <Avatar
                          first={x.employee.firstName}
                          last={x.employee.lastName}
                          photo={x.employee.photoDataUrl}
                        />
                        <span>
                          <b>
                            {x.employee.firstName} {x.employee.lastName}
                          </b>
                          <small>{x.employee.employeeNo}</small>
                        </span>
                      </div>
                    </td>
                    <td>{money(x.base)}</td>
                    <td style={{ color: "var(--brand)" }}>
                      + {money(x.overtimeAmount)}
                    </td>
                    <td style={{ color: "var(--danger)" }}>
                      - {money(x.deduction)}
                    </td>
                    <td>
                      <b>{money(x.net)}</b>
                    </td>
                    <td>
                      <span className="badge badge-amber">Tayyorlanmoqda</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
const reports = [
  {
    name: "Davomat hisoboti",
    desc: "Kelish, chiqish va davomat holatlari",
    icon: Timer,
    ready: true,
  },
  {
    name: "Kechikish hisoboti",
    desc: "Kechikishlar va davomiylik",
    icon: FileText,
    ready: true,
  },
  {
    name: "Ish vaqti hisoboti",
    desc: "Ishlangan va qo‘shimcha soatlar",
    icon: FileSpreadsheet,
    ready: true,
  },
  {
    name: "Xodimlar hisoboti",
    desc: "Xodimlar ro‘yxati va ish ma’lumotlari",
    icon: Users,
    ready: false,
  },
];
export function ReportsPage() {
  return (
    <div className="page">
      <PageHeader
        title="Hisobotlar"
        subtitle="Ma’lumotlarni tahlil qiling va eksport qiling"
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
          gap: 14,
        }}
      >
        {reports.map((r) => (
          <article className="card section-body" key={r.name}>
            <r.icon size={22} color="var(--brand)" />
            <h2 style={{ fontSize: 15, margin: "14px 0 6px" }}>{r.name}</h2>
            <p className="subtle" style={{ fontSize: 12, minHeight: 32 }}>
              {r.desc}
            </p>
            <div className="form-grid" style={{ marginTop: 18 }}>
              <div className="field">
                <label className="label">Boshlanish</label>
                <input
                  className="input"
                  type="date"
                  defaultValue="2026-09-01"
                />
              </div>
              <div className="field">
                <label className="label">Tugash</label>
                <input
                  className="input"
                  type="date"
                  defaultValue="2026-09-30"
                />
              </div>
            </div>
            {r.ready ? (
              <a
                className="btn btn-primary"
                href="/api/reports/attendance.csv"
                download
              >
                <Download size={15} /> CSV yuklash
              </a>
            ) : (
              <button className="btn" disabled>
                Tez orada
              </button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
