import { TimeInput } from "../../components/TimeInput";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Building2, LogIn, LogOut, MessageSquareText, Plus } from "lucide-react";
import { api, errorText, post } from "../../api";
import { dateUz } from "@/lib/format";
import { getCached, setCached } from "../miniCache";
import { Seg, Sheet, SkeletonList, type Toast } from "./shared";
import { confirmNative, haptic } from "./tg";

/*
 * Belgilash so‘rovi: kirish yoki chiqishni belgilash esdan chiqqan bo‘lsa — sana, vaqt,
 * Kirish/Chiqish, filial (ruxsat bo‘lsa) va izoh bilan HR’ga so‘rov.
 */

export type MarkRow = {
  id: string;
  date: string;
  time: string;
  kind: "IN" | "OUT";
  branchId: string;
  branchName: string;
  comment: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  decidedBy?: string;
  decidedNote?: string;
};
type MarksData = { items: MarkRow[]; branches: { id: string; name: string }[]; canChooseBranch: boolean; homeBranchId: string; minDate: string; today: string; now: string };

const statusChip: Record<string, [string, string]> = {
  PENDING: ["Kutilmoqda", "warn"],
  APPROVED: ["Tasdiqlandi", "ok"],
  REJECTED: ["Rad etildi", "bad"],
  CANCELLED: ["Bekor qilindi", ""],
};

export function MarksList({ onToast, focusId }: { onToast: Toast; focusId?: string }) {
  const [data, setData] = useState<MarksData | null>(() => getCached<MarksData>("marks"));
  const [open, setOpen] = useState(false);
  const load = useCallback(
    () =>
      api<MarksData>("/mini/corrections")
        .then((value) => {
          setCached("marks", value);
          setData(value);
        })
        .catch((e) => onToast(errorText(e), "error")),
    [onToast],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (focusId && data) document.getElementById(`mark-${focusId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusId, data]);
  async function cancel(item: MarkRow) {
    if (!(await confirmNative(`${dateUz(item.date)} · ${item.kind === "IN" ? "Kirish" : "Chiqish"} ${item.time} so‘rovini bekor qilasizmi?`, { ok: "Bekor qilish", destructive: true }))) return;
    try {
      await post(`/mini/corrections/${item.id}/cancel`, {});
      haptic.success();
      void load();
    } catch (reason) {
      onToast(errorText(reason), "error");
    }
  }
  return (
    <>
      <button className="mini-btn" onClick={() => setOpen(true)} disabled={!data}>
        <Plus size={18} /> Belgilash so‘rovi
      </button>
      <div className="mh-hint info">
        <AlertCircle size={16} />
        <span>Kirish yoki chiqishni belgilash esdan chiqdimi? Vaqtini va sababini yozing — HR tasdiqlasa, davomatga yoziladi.</span>
      </div>
      <section className="mini-card">
        {data === null ? (
          <SkeletonList rows={3} />
        ) : !data.items.length ? (
          <div className="mini-empty">
            <LogIn size={28} />
            Belgilash so‘rovlari yo‘q
          </div>
        ) : (
          <div className="mini-rows">
            {data.items.map((item) => {
              const [label, tone] = statusChip[item.status] || [item.status, ""];
              return (
                <div className={`mini-row ${item.id === focusId ? "focus" : ""}`} key={item.id} id={`mark-${item.id}`}>
                  <span className={`mini-ico ${item.kind === "IN" ? "ok" : "bad"}`}>{item.kind === "IN" ? <LogIn size={18} /> : <LogOut size={18} />}</span>
                  <span>
                    <b>
                      {item.kind === "IN" ? "Kirish" : "Chiqish"} · {item.time}
                    </b>
                    <small>
                      {dateUz(item.date)} · {item.branchName}
                    </small>
                    <small>«{item.comment}»</small>
                    {item.status !== "PENDING" && (item.decidedBy || item.decidedNote) ? (
                      <small>
                        {item.decidedBy}
                        {item.decidedNote ? ` — ${item.decidedNote}` : ""}
                      </small>
                    ) : null}
                    {item.status === "PENDING" && (
                      <button className="mini-link-danger" onClick={() => void cancel(item)}>
                        Bekor qilish
                      </button>
                    )}
                  </span>
                  <span className={`mini-chip ${tone}`}>{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
      {open && data && (
        <MarkSheet
          data={data}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onToast("So‘rov yuborildi — HR ko‘rib chiqadi");
            haptic.success();
            void load();
          }}
        />
      )}
    </>
  );
}

function MarkSheet({ data, onClose, onSaved }: { data: MarksData; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"IN" | "OUT">("OUT");
  const [date, setDate] = useState(data.today);
  const [time, setTime] = useState("");
  const [branchId, setBranchId] = useState(data.homeBranchId || data.branches[0]?.id || "");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = Boolean(date && /^\d{2}:\d{2}$/.test(time) && comment.trim().length >= 3 && branchId);
  async function save() {
    if (!valid) return setError(!time ? "Vaqtni tanlang." : "Izoh yozing (kamida 3 belgi).");
    setBusy(true);
    setError("");
    try {
      await post("/mini/corrections", { date, time, kind, branchId: data.canChooseBranch ? branchId : undefined, comment: comment.trim() });
      onSaved();
    } catch (reason) {
      setError(errorText(reason, "So‘rov yuborilmadi."));
      haptic.error();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="Belgilash so‘rovi" subtitle="HR tasdiqlasa, vaqt davomatga yoziladi" onClose={onClose} primary={{ text: "Yuborish", onClick: () => void save(), busy, disabled: !valid }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Seg
          value={kind}
          onChange={(next) => {
            haptic.select();
            setKind(next);
          }}
          options={[
            ["IN", "Kirish"],
            ["OUT", "Chiqish"],
          ]}
        />
        <div className="grid-2">
          <label>
            Sana
            <input type="date" min={data.minDate} max={data.today} value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            Vaqt
            <TimeInput value={time} onChange={setTime} required />
          </label>
        </div>
        <label>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Building2 size={15} /> Filial
          </span>
          {data.canChooseBranch ? (
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {data.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : (
            <input value={data.branches.find((b) => b.id === branchId)?.name || "—"} readOnly />
          )}
        </label>
        <label>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <MessageSquareText size={15} /> Izoh
          </span>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder="Masalan: kechqurun chiqishni belgilash esimdan chiqibdi" required />
        </label>
        {error && (
          <div className="mini-alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}
      </form>
    </Sheet>
  );
}
