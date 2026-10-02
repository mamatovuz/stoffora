import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { post } from "../api";
import { useAuth } from "../auth";
import { useApi } from "../hooks";
import { canAny } from "@/lib/permissions";
import { dateUz } from "@/lib/format";
import { Avatar, Confirm, Empty, ErrorBox, Loading, Segmented, useToast } from "./ui";

type Row = {
  id: string;
  platform: "ios" | "android";
  model?: string;
  osVersion?: string;
  appVersion?: string;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokeReason?: string;
  push: boolean;
  employeeId: string;
  employeeName: string;
  employeeNo?: string;
  branch?: string;
  photoDataUrl?: string;
  sessions: number;
};
type Data = { rows: Row[]; pendingRequests: number };

const when = (iso?: string) => (iso ? `${dateUz(iso.slice(0, 10))}, ${new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : "—");
const device = (r: Pick<Row, "platform" | "model">) => r.model || (r.platform === "ios" ? "iPhone" : "Android");

/**
 * Sozlamalar → Ilovalar: Staffora mobil ilovasi ulangan telefonlar.
 * «Uzish» — telefon shu xodimdan ajratiladi: sessiya darhol yopiladi, push to‘xtaydi va
 * shu telefonga endi boshqa xodim o‘z kodi bilan kira oladi.
 */
export function MobileAppsSection() {
  const { user } = useAuth();
  const [status, setStatus] = useState<"ACTIVE" | "REVOKED">("ACTIVE");
  const { data, loading, error, reload } = useApi<Data>(`/mobile-devices?status=${status}`);
  const [query, setQuery] = useState("");
  const [revoking, setRevoking] = useState<Row | null>(null);
  const toast = useToast();
  const canEdit = Boolean(user && canAny(user.role, ["employees.edit", "devices.manage"]));
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.rows || []).filter((r) => !q || [r.employeeName, r.employeeNo, r.model, r.branch].some((v) => v?.toLowerCase().includes(q)));
  }, [data, query]);

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Mobil ilovalar</h2>
          <p>Staffora ilovasi ulangan telefonlar. Uzilgan telefonga boshqa xodim o‘z kodi bilan kira oladi.</p>
        </div>
        <Segmented<"ACTIVE" | "REVOKED">
          value={status}
          onChange={setStatus}
          options={[
            { value: "ACTIVE", label: "Ulangan", count: status === "ACTIVE" ? data?.rows.length : undefined },
            { value: "REVOKED", label: "Uzilgan" },
          ]}
        />
      </div>
      <div className="card-body" style={{ display: "grid", gap: 12 }}>
        {data?.pendingRequests ? (
          <div className="alert warn">
            <Smartphone size={18} />
            <div>
              <b>{data.pendingRequests} ta yangi telefon so‘rovi kutilmoqda</b>
              <p>
                <Link to="/leave">So‘rovlar → Yangi telefon</Link> bo‘limida tasdiqlang.
              </p>
            </div>
          </div>
        ) : null}
        <label className="apps-search">
          <Search size={16} />
          <input className="input" placeholder="Xodim, tabel raqami yoki telefon modeli" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} />
        ) : !rows.length ? (
          <Empty
            icon={Smartphone}
            title={status === "ACTIVE" ? "Ulangan telefon yo‘q" : "Uzilgan telefon yo‘q"}
            text={status === "ACTIVE" ? "Xodim Mini App → Profil → «Telefon ilovasi»dan kod olib, ilovaga kiritganda shu yerda ko‘rinadi." : undefined}
          />
        ) : (
          <div className="apps-list">
            {rows.map((r) => (
              <article key={r.id} className={`apps-row ${r.status === "ACTIVE" ? "" : "off"}`}>
                <Avatar first={r.employeeName.split(" ")[0]} last={r.employeeName.split(" ")[1]} photo={r.photoDataUrl} />
                <div className="apps-main">
                  <Link to={`/employees/${r.employeeId}`} className="apps-name">
                    {r.employeeName}
                    {r.employeeNo ? <small> · {r.employeeNo}</small> : null}
                  </Link>
                  <span className="apps-device">
                    <Smartphone size={13} /> {device(r)} · {r.platform === "ios" ? "iOS" : "Android"} {r.osVersion || ""}
                    {r.appVersion ? ` · v${r.appVersion}` : ""}
                    {r.branch ? ` · ${r.branch}` : ""}
                  </span>
                  <span className="apps-meta">
                    {r.status === "ACTIVE"
                      ? `Ulangan: ${when(r.createdAt)} · oxirgi faollik: ${when(r.lastSeenAt)} · ${r.sessions ? "ilovada kirgan" : "chiqib ketgan"} · push ${r.push ? "yoqilgan" : "o‘chiq"}`
                      : `Uzilgan: ${when(r.revokedAt)}${r.revokedBy ? ` · ${r.revokedBy}` : ""}${r.revokeReason ? ` · ${r.revokeReason}` : ""}`}
                  </span>
                </div>
                {r.status === "ACTIVE" ? (
                  <span className="apps-actions">
                    <span className="badge green">
                      <ShieldCheck size={12} /> Ishonchli
                    </span>
                    {canEdit && (
                      <button className="btn btn-sm btn-danger" onClick={() => setRevoking(r)}>
                        <ShieldOff size={14} /> Uzish
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="badge gray">Uzilgan</span>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
      {revoking && (
        <Confirm
          title="Telefonni uzish"
          danger
          confirmLabel="Uzish"
          text={`${revoking.employeeName} — «${device(revoking)}». Ilova darhol chiqib ketadi va push to‘xtaydi. Shu telefonga endi boshqa xodim o‘z ulash kodi bilan kira oladi; ${revoking.employeeName.split(" ")[0]} esa yangi kod bilan istalgan telefonga qayta ulanadi.`}
          onConfirm={async () => {
            await post(`/mobile-devices/${revoking.id}/revoke`, { reason: "Sozlamalar → Ilovalar: uzildi" });
            toast("Telefon uzildi — endi boshqa xodim kira oladi");
            void reload(true);
          }}
          onClose={() => setRevoking(null)}
        />
      )}
    </section>
  );
}
