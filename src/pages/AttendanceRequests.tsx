import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Building2, Check, Clock4, LogIn, LogOut, MessageSquareText, X } from "lucide-react";
import { errorText, notifyChange, post } from "../api";
import { useApi, usePolling } from "../hooks";
import { Avatar, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Segmented, Status, useToast } from "../components/ui";
import { dateLongUz, dateUz } from "@/lib/format";
import type { AttendanceCorrection } from "@/lib/types";

export type CorrectionRow = AttendanceCorrection & {
  employeeName: string;
  employeeNo?: string;
  photoDataUrl?: string;
  position?: string;
  branchName: string;
};
type Tab = "PENDING" | "ALL";

/**
 * Davomat so‘rovlari (belgilash so‘rovi): xodim unutgan kirish/chiqish. Kunlar bo‘yicha guruhlangan —
 * xodim, Kirish/Chiqish, vaqt, filial, izoh; Tasdiqlash yoki Rad etish.
 */
export function AttendanceRequestsPage() {
  const [params, setParams] = useSearchParams();
  const focusId = params.get("id");
  const [tab, setTab] = useState<Tab>("PENDING");
  const { data, loading, error, reload, setData } = useApi<CorrectionRow[]>("/attendance-corrections");
  usePolling(() => void reload(true), 30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<CorrectionRow | null>(null);
  const [note, setNote] = useState("");
  const toast = useToast();

  // Bildirishnomadan ochilgan so‘rov ko‘rib chiqilgan bo‘lsa — «Barchasi» ko‘rinishida ko‘rsatamiz.
  useEffect(() => {
    const row = focusId ? data?.find((r) => r.id === focusId) : undefined;
    if (row && row.status !== "PENDING") setTab("ALL");
    if (row) setTimeout(() => document.getElementById(`corr-${row.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }, [focusId, data]);

  const pending = data?.filter((r) => r.status === "PENDING").length || 0;
  const groups = useMemo(() => {
    const rows = (data || []).filter((r) => tab === "ALL" || r.status === "PENDING");
    const map = new Map<string, CorrectionRow[]>();
    for (const r of rows) map.set(r.date, [...(map.get(r.date) || []), r]);
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data, tab]);

  async function decide(row: CorrectionRow, approve: boolean, reason?: string) {
    setBusy(row.id);
    try {
      const saved = await post<CorrectionRow>(`/attendance-corrections/${row.id}/decide`, { approve, note: reason || undefined });
      setData((list) => list?.map((r) => (r.id === row.id ? saved : r)) || null);
      toast(approve ? `${row.employeeName}: ${row.kind === "IN" ? "kirish" : "chiqish"} ${row.time} davomatga yozildi` : "So‘rov rad etildi");
      setRejecting(null);
      setNote("");
      if (focusId === row.id) setParams({}, { replace: true });
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(null);
      notifyChange("notifications");
      notifyChange("leave");
    }
  }

  return (
    <div className="page narrow">
      <PageHeader
        title="Davomat so‘rovlari"
        subtitle="Xodim kirish yoki chiqishni belgilashni unutgan bo‘lsa — so‘rov yuboradi. Tasdiqlansa, vaqt davomatga yoziladi."
      />
      <section className="card">
        <div className="filters">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "PENDING", label: "Kutilmoqda", count: pending },
              { value: "ALL", label: "Barchasi", count: data?.length },
            ]}
          />
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !groups.length ? (
          <Empty icon={Clock4} title={tab === "PENDING" ? "Kutilayotgan so‘rov yo‘q" : "So‘rovlar yo‘q"} text="Xodimlar Mini App yoki ilovadagi «So‘rovlar → Belgilash» orqali yuboradi." />
        ) : (
          <div className="corr-list">
            {groups.map(([date, rows]) => (
              <div key={date}>
                <div className="notif-day">{dateLongUz(date, true)}</div>
                {rows.map((r) => (
                  <article key={r.id} id={`corr-${r.id}`} className={`corr-row ${focusId === r.id ? "focus" : ""}`}>
                    <Avatar first={r.employeeName.split(" ")[0] || ""} last={r.employeeName.split(" ")[1]} photo={r.photoDataUrl} />
                    <div className="corr-main">
                      <div className="corr-head">
                        <b>{r.employeeName}</b>
                        {r.position && <small>{r.position}</small>}
                      </div>
                      <div className="corr-meta">
                        <span className={`corr-kind ${r.kind === "IN" ? "in" : "out"}`}>
                          {r.kind === "IN" ? <LogIn size={14} /> : <LogOut size={14} />}
                          {r.kind === "IN" ? "Kirish" : "Chiqish"}
                        </span>
                        <span className="corr-time">{r.time}</span>
                        <span className="corr-branch">
                          <Building2 size={14} /> {r.branchName}
                        </span>
                      </div>
                      <p className="corr-comment">
                        <MessageSquareText size={14} /> {r.comment}
                      </p>
                      {r.status !== "PENDING" && (
                        <small className="corr-decided">
                          {r.decidedBy ? `${r.decidedBy}` : ""}
                          {r.decidedAt ? ` · ${dateUz(r.decidedAt)}` : ""}
                          {r.decidedNote ? ` · «${r.decidedNote}»` : ""}
                        </small>
                      )}
                    </div>
                    <div className="corr-side">
                      {r.status === "PENDING" ? (
                        <>
                          <button className="btn btn-primary" disabled={busy === r.id} onClick={() => void decide(r, true)}>
                            <Check size={16} /> Tasdiqlash
                          </button>
                          <button className="btn btn-danger" disabled={busy === r.id} onClick={() => setRejecting(r)}>
                            <X size={16} /> Rad etish
                          </button>
                        </>
                      ) : (
                        <Status value={r.status} />
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
      {rejecting && (
        <Modal title="So‘rovni rad etish" subtitle={`${rejecting.employeeName} · ${dateUz(rejecting.date)} · ${rejecting.kind === "IN" ? "Kirish" : "Chiqish"} ${rejecting.time}`} onClose={() => setRejecting(null)} size="narrow">
          <Field label="Sabab (xodimga yuboriladi, ixtiyoriy)">
            <textarea className="input" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: kamera yozuvida ko‘rinmadi" />
          </Field>
          <div className="form-actions">
            <button className="btn" onClick={() => setRejecting(null)}>
              Bekor qilish
            </button>
            <button className="btn btn-danger" disabled={busy === rejecting.id} onClick={() => void decide(rejecting, false, note.trim())}>
              <X size={16} /> Rad etish
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
