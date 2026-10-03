import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CalendarDays, Camera, CheckCircle2, Paperclip, Plane, Timer, X } from "lucide-react";
import { DayOffPanel } from "./DayOff";
import { MarksList } from "./Marks";
import { api, errorText, patch, post } from "../../api";
import { dateUz, tashkentIsoDate } from "@/lib/format";
import type { LeaveRequest } from "@/lib/types";
import { leaveTypeLabel } from "../../types";
import { fileToDataUrl } from "../../components/Documents";
import { SkeletonList } from "./shared";
import { MiniSwaps } from "../MiniExtras";
import { getCached, setCached } from "../miniCache";
import { Seg, Sheet, type Toast } from "./shared";
import { confirmNative, haptic } from "./tg";

type View = "leave" | "marks" | "swap" | "dayoff" | "overtime";

export function MiniRequests({ onToast, initialView, focusId }: { onToast: Toast; initialView?: View; focusId?: string }) {
  const [view, setView] = useState<View>(initialView || "leave");
  return (
    <div className="mini-body">
      <div className="mini-title">
        <h1>So‘rovlar</h1>
        <p>Ta’til, belgilash, smena, dam olish kuni va qo‘shimcha ish</p>
      </div>
      <Seg
        className="five"
        value={view}
        onChange={(next) => {
          haptic.select();
          setView(next);
        }}
        options={[
          ["leave", "Ta’til"],
          ["marks", "Belgilash"],
          ["swap", "Smena"],
          ["dayoff", "Dam kuni"],
          ["overtime", "Qo‘sh. ish"],
        ]}
      />
      {view === "leave" && <LeaveList onToast={onToast} focusId={focusId} />}
      {view === "marks" && <MarksList onToast={onToast} focusId={focusId} />}
      {view === "swap" && <MiniSwaps onToast={onToast} />}
      {view === "dayoff" && <DayOffPanel onToast={onToast} />}
      {view === "overtime" && <OvertimeList onToast={onToast} />}
    </div>
  );
}

/* ------------------------------------------------------------- ta’til --- */
const statusChip: Record<string, [string, string]> = {
  PENDING: ["Kutilmoqda", "warn"],
  APPROVED: ["Tasdiqlandi", "ok"],
  REJECTED: ["Rad etildi", "bad"],
  CANCELLED: ["Bekor qilindi", ""],
};

function LeaveList({ onToast, focusId }: { onToast: Toast; focusId?: string }) {
  const [rows, setRows] = useState<LeaveRequest[] | null>(() => getCached<LeaveRequest[]>("leave"));
  const [balance, setBalance] = useState<{ year: number; entitled: number; used: number; pending: number; remaining: number } | null>(null);
  const [holidays, setHolidays] = useState<{ id: string; date: string; title: string; dayOff: boolean }[]>([]);
  useEffect(() => {
    void api<NonNullable<typeof balance>>("/mini/leave-balance").then(setBalance).catch(() => undefined);
    void api<{ holidays: typeof holidays }>("/mini/calendar").then((r) => setHolidays(r.holidays)).catch(() => undefined);
  }, []);
  const [open, setOpen] = useState(false);
  const load = useCallback(
    () =>
      api<LeaveRequest[]>("/mini/leave")
        .then((value) => {
          setCached("leave", value);
          setRows(value);
        })
        .catch((e) => onToast(errorText(e), "error")),
    [onToast],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // Bot xabaridagi havola: kerakli so‘rovni ko‘rsatib, ajratib qo‘yamiz.
  useEffect(() => {
    if (!focusId || !rows) return;
    document.getElementById(`leave-${focusId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusId, rows]);
  async function cancel(item: LeaveRequest) {
    if (!(await confirmNative(`${dateUz(item.startDate)} – ${dateUz(item.endDate)} so‘rovini bekor qilasizmi?`, { ok: "Bekor qilish", destructive: true }))) return;
    try {
      await patch(`/mini/leave/${item.id}/cancel`);
      onToast("So‘rov bekor qilindi");
      haptic.success();
      void load();
    } catch (reason) {
      onToast(errorText(reason), "error");
    }
  }
  return (
    <>
      {balance && (
        <section className="desk-tiles">
          <div>
            <b>{balance.entitled}</b>
            <small>{balance.year} yil haqqi</small>
          </div>
          <div>
            <b>{balance.used}</b>
            <small>ishlatilgan</small>
          </div>
          <div className="warn">
            <b>{balance.pending}</b>
            <small>kutilmoqda</small>
          </div>
          <div className={balance.remaining > 0 ? "ok" : "bad"}>
            <b>{balance.remaining}</b>
            <small>qolgan</small>
          </div>
        </section>
      )}
      <button className="mini-btn" onClick={() => setOpen(true)}>
        <CalendarDays size={18} /> Yangi so‘rov
      </button>
      {holidays.length > 0 && (
        <div className="mh-hint info">
          <CalendarDays size={16} />
          <span>Yaqin bayramlar: {holidays.slice(0, 3).map((h) => `${dateUz(h.date)} — ${h.title}${h.dayOff ? " (dam)" : ""}`).join("; ")}</span>
        </div>
      )}
      <section className="mini-card">
        {rows === null ? (
          <SkeletonList rows={4} />
        ) : rows.length === 0 ? (
          <div className="mini-empty">
            <Plane size={28} />
            Hali so‘rov yubormagansiz
          </div>
        ) : (
          <div className="mini-rows">
            {rows.map((item) => {
              const [label, tone] = statusChip[item.status] || [item.status, ""];
              return (
                <div className={`mini-row ${item.id === focusId ? "focus" : ""}`} key={item.id} id={`leave-${item.id}`}>
                  <span className="mini-ico">
                    <Plane size={18} />
                  </span>
                  <span>
                    <b>
                      {leaveTypeLabel[item.type] || item.type}
                      {item.documentId ? " 📎" : ""}
                    </b>
                    <small>
                      {dateUz(item.startDate)} – {dateUz(item.endDate)}
                      {item.decidedBy && item.status !== "PENDING" ? ` · ${item.decidedBy}` : ""}
                    </small>
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
      {open && (
        <LeaveSheet
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onToast("So‘rov HR’ga yuborildi — javob Telegram’ga keladi");
            haptic.success();
            void load();
          }}
        />
      )}
    </>
  );
}

function LeaveSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const today = tashkentIsoDate();
  const [form, setForm] = useState({ type: "VACATION", startDate: today, endDate: today, reason: "" });
  const [attachment, setAttachment] = useState<{ name: string; dataUrl: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const days = Math.max(1, Math.round((Date.parse(form.endDate) - Date.parse(form.startDate)) / 86_400_000) + 1);
  const valid = form.reason.trim().length >= 3 && form.endDate >= form.startDate;
  async function save() {
    if (!valid) return setError(form.reason.trim().length < 3 ? "Sababni qisqacha yozing." : "Sanalarni tekshiring.");
    setBusy(true);
    setError("");
    try {
      await post("/mini/leave", { ...form, attachment: attachment?.dataUrl });
      onSaved();
    } catch (reason) {
      setError(errorText(reason, "So‘rov yuborilmadi."));
      haptic.error();
    } finally {
      setBusy(false);
    }
  }
  async function pickFile(file?: File) {
    if (!file) return;
    try {
      setAttachment({ name: file.name, dataUrl: await fileToDataUrl(file) });
      haptic.success();
    } catch (reason) {
      setError(errorText(reason, "Faylni o‘qib bo‘lmadi."));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  return (
    <Sheet
      title="Ta’til so‘rovi"
      subtitle="HR ko‘rib chiqadi, javob Telegram’ga keladi"
      onClose={onClose}
      primary={{ text: `Yuborish · ${days} kun`, onClick: () => void save(), busy, disabled: !valid }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          Turi
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {Object.entries(leaveTypeLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid-2">
          <label>
            Boshlanish
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: form.endDate < e.target.value ? e.target.value : form.endDate })}
              required
            />
          </label>
          <label>
            Tugash
            <input type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
          </label>
        </div>
        <label>
          Sabab
          <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required minLength={3} placeholder="Qisqacha yozing" />
        </label>
        <div className="ml-attach">
          {attachment ? (
            <div className="ml-file">
              <Paperclip size={16} />
              <span>{attachment.name}</span>
              <button type="button" aria-label="Olib tashlash" onClick={() => setAttachment(null)}>
                <X size={15} />
              </button>
            </div>
          ) : (
            <button type="button" className="mini-btn soft dashed" onClick={() => fileInput.current?.click()}>
              <Camera size={17} /> {form.type === "SICK" ? "Kasallik varaqasini rasmga olish" : "Hujjat biriktirish (ixtiyoriy)"}
            </button>
          )}
          <input ref={fileInput} type="file" accept="image/*,application/pdf" capture={form.type === "SICK" ? "environment" : undefined} hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
          {form.type === "SICK" && !attachment && <small>Varaqa rasmi HR’ga darhol yetadi — keyin olib borish shart emas.</small>}
        </div>
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

/* ---------------------------------------------------- qo‘shimcha ish --- */
type OvertimeRow = {
  id: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  scheduledEnd: string;
  overtimeMinutes: number;
  approved?: boolean;
  decidedBy?: string;
  note?: string;
  closed: boolean;
};
type OvertimeData = { requiresApproval: boolean; paid: boolean; rows: OvertimeRow[] };

function OvertimeList({ onToast }: { onToast: Toast }) {
  const [data, setData] = useState<OvertimeData | null>(() => getCached<OvertimeData>("overtime"));
  const [editing, setEditing] = useState<OvertimeRow | null>(null);
  const load = useCallback(
    () =>
      api<OvertimeData>("/mini/overtime")
        .then((value) => {
          setCached("overtime", value);
          setData(value);
        })
        .catch((e) => onToast(errorText(e), "error")),
    [onToast],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const total = (data?.rows || []).filter((r) => r.date.slice(0, 7) === tashkentIsoDate().slice(0, 7)).reduce((s, r) => s + r.overtimeMinutes, 0);
  return (
    <>
      {data && (
        <div className="mh-hint info">
          <Timer size={16} />
          <span>
            Bu oy: {Math.floor(total / 60)} soat {total % 60} daq.{" "}
            {!data.paid ? "Kompaniyada qo‘shimcha ish to‘lanmaydi." : data.requiresApproval ? "Rahbar tasdiqlagani ish haqiga qo‘shiladi — izoh yozib qo‘ying." : "Avtomatik ish haqiga qo‘shiladi."}
          </span>
        </div>
      )}
      <section className="mini-card">
        {data === null ? (
          <SkeletonList rows={3} />
        ) : !data.rows.length ? (
          <div className="mini-empty">
            <Timer size={28} />
            Qo‘shimcha ish qayd etilmagan
          </div>
        ) : (
          <div className="mini-rows">
            {data.rows.map((r) => {
              const state =
                r.approved === true ? ["Tasdiqlandi", "ok"] : r.approved === false ? ["Rad etildi", "bad"] : data.requiresApproval ? ["Kutilmoqda", "warn"] : ["Hisoblanadi", "ok"];
              return (
                <div className="mini-row" key={r.id}>
                  <span className="mini-ico">
                    <Timer size={18} />
                  </span>
                  <span>
                    <b>
                      {dateUz(r.date)} · +{Math.floor(r.overtimeMinutes / 60) ? `${Math.floor(r.overtimeMinutes / 60)} s ` : ""}
                      {r.overtimeMinutes % 60} daq
                    </b>
                    <small>
                      {r.checkIn} → {r.checkOut || "…"} (grafik {r.scheduledEnd} gacha)
                    </small>
                    {r.note && <small>«{r.note}»</small>}
                    {data.requiresApproval && r.approved === undefined && !r.closed && (
                      <button className="mini-link" onClick={() => setEditing(r)}>
                        {r.note ? "Izohni o‘zgartirish" : "Izoh yozish"}
                      </button>
                    )}
                  </span>
                  <span className={`mini-chip ${state[1]}`}>{state[0]}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
      {editing && (
        <OvertimeNoteSheet
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onToast("Izoh rahbaringizga yuborildi");
            haptic.success();
            void load();
          }}
        />
      )}
    </>
  );
}

function OvertimeNoteSheet({ row, onClose, onSaved }: { row: OvertimeRow; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState(row.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await post(`/mini/overtime/${row.id}/note`, { note: note.trim() });
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
      haptic.error();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title="Qo‘shimcha ish izohi"
      subtitle={`${dateUz(row.date)} · ${row.overtimeMinutes} daqiqa`}
      onClose={onClose}
      primary={{ text: "Rahbarga yuborish", onClick: () => void save(), busy, disabled: note.trim().length < 3 }}
    >
      <label className="ml-field">
        Nima ish qildingiz?
        <textarea value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: inventarizatsiya, mijoz buyurtmasi" autoFocus />
      </label>
      <p className="mp-note">
        <CheckCircle2 size={13} /> Rahbar tasdiqlasa, qo‘shimcha ish shu oy ish haqiga qo‘shiladi.
      </p>
      {error && (
        <div className="mini-alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
    </Sheet>
  );
}
