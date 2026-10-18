import { useState } from "react";
import { History, Save } from "lucide-react";
import { errorText, post, put } from "../api";
import { Field, Modal, useToast } from "./ui";
import { TimeInput } from "./TimeInput";
import { dateLongUz } from "@/lib/format";

/*
 * Davomatni qo‘lda tuzatish (xodim kalendari va umumiy tabeldan): kelish/ketish vaqti va sabab.
 * Qayd bo‘lsa — tahrirlanadi (PUT), bo‘lmasa — yangisi kiritiladi (POST). Kechikish, erta ketish va
 * ishlangan vaqt serverda grafik bo‘yicha qayta hisoblanadi; har o‘zgarish «oldin → keyin» bilan
 * audit jurnaliga yoziladi. Yopilgan (hisob-kitob qilingan) oyni server tahrirlatmaydi.
 */

export type EditTarget = {
  employeeId: string;
  employeeName: string;
  date: string;
  /** Grafik bo‘yicha reja (masalan 09:00–18:00) — ma’lumot uchun. */
  plan?: string;
  record?: { id: string; checkIn?: string; checkOut?: string; note?: string; manual?: boolean };
};

export function AttendanceEditModal({ target, onClose, onSaved }: { target: EditTarget; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [checkIn, setCheckIn] = useState(target.record?.checkIn || "");
  const [checkOut, setCheckOut] = useState(target.record?.checkOut || "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(target.record?.id);
  const changed = checkIn !== (target.record?.checkIn || "") || checkOut !== (target.record?.checkOut || "");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!checkIn) return setError("Kelish vaqtini kiriting.");
    if (reason.trim().length < 3) return setError("Sababni yozing — u audit jurnalida saqlanadi.");
    setBusy(true);
    try {
      const note = `Tuzatildi: ${reason.trim()}`;
      if (editing) await put(`/attendance/${target.record!.id}`, { checkIn, checkOut: checkOut || "", note });
      else await post("/attendance", { employeeId: target.employeeId, date: target.date, checkIn, checkOut: checkOut || "", note });
      toast(editing ? "Davomat tuzatildi" : "Davomat kiritildi");
      onSaved();
    } catch (reasonError) {
      setError(errorText(reasonError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? "Davomatni tuzatish" : "Davomat kiritish"} subtitle={`${target.employeeName} · ${dateLongUz(target.date, true)}`} onClose={onClose} size="narrow">
      <form className="att-edit" onSubmit={save}>
        <div className="att-edit-plan">
          <span>Grafik</span>
          <b>{target.plan || "Dam olish kuni"}</b>
          {target.record?.checkIn && (
            <>
              <span>Hozir</span>
              <b>
                {target.record.checkIn} – {target.record.checkOut || "chiqish yo‘q"}
              </b>
            </>
          )}
        </div>
        <div className="att-edit-times">
          <Field label="Keldi">
            <TimeInput className="input" value={checkIn} onChange={setCheckIn} placeholder="09:00" required autoFocus />
          </Field>
          <Field label="Ketdi" hint="Bo‘sh — hali ketmagan">
            <TimeInput className="input" value={checkOut} onChange={setCheckOut} placeholder="18:00" />
          </Field>
        </div>
        <Field label="Sabab" hint="Masalan: Face ID ishlamadi, rahbar tasdiqladi">
          <input className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Nima uchun tuzatilyapti?" required />
        </Field>
        <p className="hint att-edit-note">
          <History size={14} /> Kechikish va ishlangan vaqt grafik bo‘yicha qayta hisoblanadi. O‘zgarish (oldin → keyin) audit jurnaliga yoziladi.
        </p>
        {error && <div className="alert danger">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={busy || (editing && !changed)}>
            <Save size={15} /> {editing ? "Saqlash" : "Kiritish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
