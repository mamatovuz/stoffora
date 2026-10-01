import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Clock3, MapPinned, RefreshCw, UserCheck, UserX } from "lucide-react";
import { useApi } from "../hooks";
import { ErrorBox, PageHeader } from "../components/ui";
import { tashkentIsoDate } from "@/lib/format";
import type { Branch } from "@/lib/types";
import { BranchMap, type RosterRow } from "./MiniManager";

/*
 * Panel (sayt): filiallar xaritasi — rahbar Mini App’idagi xarita bilan bir xil komponent.
 * Filial radiusi, xodimlar belgilagan joylar, shubhali / chegaradagi belgilar, filiallar reytingi.
 */

type Day = { date: string; rows: RosterRow[] };

export function MapPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(tashkentIsoDate());
  const day = useApi<Day>(`/attendance/day?date=${date}`);
  const branches = useApi<Branch[]>("/branches");
  // Bugungi kun — jonli: har daqiqada yangilanadi.
  useEffect(() => {
    if (date !== tashkentIsoDate()) return;
    const reload = day.reload;
    const timer = window.setInterval(() => document.visibilityState === "visible" && void reload(true), 60_000);
    return () => window.clearInterval(timer);
  }, [date, day.reload]);
  const rows = day.data?.rows || [];
  const stats = useMemo(
    () => ({
      in: rows.filter((r) => r.state === "IN" || r.state === "LEFT").length,
      late: rows.filter((r) => r.late).length,
      flagged: rows.filter((r) => r.record?.flags?.length && !r.record.flagsReviewedBy).length,
      missing: rows.filter((r) => r.state === "NOT_YET" || r.state === "ABSENT").length,
      located: rows.filter((r) => typeof r.record?.latitude === "number").length,
    }),
    [rows],
  );
  const kpis = [
    { label: "Keldi", value: stats.in, icon: UserCheck, tone: "green" },
    { label: "Kechikdi", value: stats.late, icon: Clock3, tone: "amber" },
    { label: "Shubhali belgi", value: stats.flagged, icon: AlertTriangle, tone: "red" },
    { label: "Kelmagan / hali yo‘q", value: stats.missing, icon: UserX, tone: "gray" },
  ];
  return (
    <div className="page wide map-page">
      <PageHeader
        title="Xarita"
        subtitle={`Filiallar, ruxsat etilgan radius va xodimlar belgilagan joylar · ${stats.located} ta belgi`}
        actions={
          <div className="toolbar">
            <input className="input" type="date" value={date} max={tashkentIsoDate()} onChange={(e) => setDate(e.target.value || tashkentIsoDate())} aria-label="Sana" />
            <button className="btn" onClick={() => void Promise.all([day.reload(true), branches.reload(true)])} aria-label="Yangilash">
              <RefreshCw size={15} className={day.loading ? "spin" : ""} /> Yangilash
            </button>
          </div>
        }
      />
      <div className="map-kpis">
        {kpis.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className={`map-kpi ${tone}`}>
            <span>
              <Icon size={18} />
            </span>
            <div>
              <b>{value}</b>
              <small>{label}</small>
            </div>
          </div>
        ))}
      </div>
      {day.error || branches.error ? (
        <ErrorBox message={day.error || branches.error} />
      ) : (
        <section className="card map-card">
          <div className="map-scope">
            <BranchMap rows={rows} branches={branches.data || []} loading={!day.data || !branches.data} onOpen={(id) => navigate(`/employees/${id}`)} height={Math.max(420, Math.min(680, window.innerHeight - 330))} />
          </div>
          {!branches.data?.length && branches.data && (
            <div className="card-body">
              <p className="hint">
                <MapPinned size={14} /> Filiallarga koordinata kiriting (Filiallar → tahrirlash) — xarita shundan keyin chiqadi.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
