import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, CalendarSync, Coffee, ShieldCheck } from "lucide-react";
import { api, errorText, post } from "../../api";
import { dateParts, dateUz } from "@/lib/format";
import { getCached, setCached } from "../miniCache";
import { EmptyArt, Sheet, SkeletonList, type Toast } from "./shared";
import { confirmNative, haptic } from "./tg";

/*
 * Dam olish kuni: shaxsiy dam kunlari, bir martalik ko‘chirish so‘rovi (rahbar tasdiqlaydi)
 * va kompensatsiya qoidasi (sababsiz kelmagan kunni dam kunida ishlab qoplash).
 */

type Move = {
  id: string;
  fromDate: string;
  toDate: string;
  fromWeekday: string;
  toWeekday: string;
  reason?: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  decidedBy?: string;
};
type Data = { items: Move[]; options: { restDays: string[]; workDays: string[]; maxGapDays: number }; restWeekdays: number[] };

const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const SHORT = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
const chip: Record<Move["status"], [string, string]> = {
  PENDING: ["Kutilmoqda", "warn"],
  APPROVED: ["Tasdiqlandi", "ok"],
  REJECTED: ["Rad etildi", "bad"],
  CANCELLED: ["Bekor qilindi", ""],
};
const label = (iso: string) => `${SHORT[dateParts(iso).weekday]}, ${dateUz(iso).slice(0, 5)}`;
const gapDays = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

export function DayOffPanel({ onToast }: { onToast: Toast }) {
  const [data, setData] = useState<Data | null>(() => getCached<Data>("dayoff"));
  const [open, setOpen] = useState(false);
  const load = useCallback(
    () =>
      api<Data>("/mini/dayoff-moves")
        .then((value) => {
          setCached("dayoff", value);
          setData(value);
        })
        .catch((reason) => onToast(errorText(reason), "error")),
    [onToast],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function cancel(move: Move) {
    if (!(await confirmNative(`${label(move.fromDate)} → ${label(move.toDate)} so‘rovini bekor qilasizmi?`, { ok: "Bekor qilish", destructive: true }))) return;
    try {
      await post(`/mini/dayoff-moves/${move.id}/cancel`);
      haptic.success();
      void load();
    } catch (reason) {
      onToast(errorText(reason), "error");
    }
  }
  const rest = data?.restWeekdays || [];
  return (
    <>
      <section className="do-card">
        <span className="do-icon">
          <Coffee size={20} />
        </span>
        <span>
          <small>Dam olish kunlaringiz</small>
          <b>{rest.length ? rest.map((d) => WEEKDAYS[d]).join(", ") : data?.options.restDays.length ? "Grafik bo‘yicha" : "Belgilanmagan"}</b>
        </span>
        <div className="do-week" aria-hidden>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <i key={d} className={rest.includes(d) ? "on" : ""}>
              {SHORT[d]}
            </i>
          ))}
        </div>
      </section>
      <button className="mini-btn" onClick={() => setOpen(true)} disabled={!data?.options.restDays.length}>
        <CalendarSync size={18} /> Dam kunini ko‘chirish
      </button>
      {data && !data.options.restDays.length && <p className="mp-note">Yaqin 4 haftada ko‘chirish mumkin bo‘lgan dam olish kuni yo‘q.</p>}

      <div className="do-rules">
        <div>
          <ShieldCheck size={16} />
          <span>Dam olish kuni kelmasangiz — jarima yo‘q, kalendarda ko‘k rangda.</span>
        </div>
        <div>
          <CalendarSync size={16} />
          <span>Ko‘chirish faqat shu hafta uchun: rahbar tasdiqlasa, keyingi hafta yana odatdagi kun.</span>
        </div>
        <div>
          <Coffee size={16} />
          <span>Sababsiz kelmagan bo‘lsangiz, shu oydagi dam kuningizda ishlab jarimani qoplashingiz mumkin.</span>
        </div>
      </div>

      <section className="mini-card">
        {!data ? (
          <SkeletonList rows={2} />
        ) : !data.items.length ? (
          <div className="mini-empty">
            <EmptyArt kind="calendar" />
            <b>Ko‘chirish so‘rovlari yo‘q</b>
            <small>Masalan: juma o‘rniga shanba dam olmoqchi bo‘lsangiz — so‘rov yuboring.</small>
          </div>
        ) : (
          <div className="mini-rows">
            {data.items.map((m) => {
              const [text, tone] = chip[m.status];
              return (
                <div className="mini-row" key={m.id}>
                  <span className="mini-ico">
                    <CalendarSync size={17} />
                  </span>
                  <span>
                    <b className="do-move">
                      {label(m.fromDate)} <ArrowRight size={13} /> {label(m.toDate)}
                    </b>
                    <small>
                      {m.fromWeekday} ishlaysiz, {m.toWeekday} dam olasiz{m.reason ? ` · ${m.reason}` : ""}
                    </small>
                    {m.status === "PENDING" && (
                      <button className="mini-link-danger" onClick={() => void cancel(m)}>
                        Bekor qilish
                      </button>
                    )}
                  </span>
                  <span className={`mini-chip ${tone}`}>{text}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
      {open && data && (
        <MoveSheet
          data={data}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            haptic.success();
            onToast("So‘rov rahbaringizga yuborildi");
            void load();
          }}
        />
      )}
    </>
  );
}

function MoveSheet({ data, onClose, onSaved }: { data: Data; onClose: () => void; onSaved: () => void }) {
  const [from, setFrom] = useState(data.options.restDays[0] || "");
  const targets = useMemo(() => data.options.workDays.filter((d) => from && gapDays(d, from) <= data.options.maxGapDays), [data, from]);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!targets.includes(to)) setTo(targets.find((d) => d > from) || targets[0] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, targets]);
  async function save() {
    if (!from || !to) return setError("Kunlarni tanlang.");
    setBusy(true);
    setError("");
    try {
      await post("/mini/dayoff-moves", { fromDate: from, toDate: to, reason: reason.trim() || undefined });
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
      title="Dam kunini ko‘chirish"
      subtitle="Bir martalik — rahbar tasdiqlaydi"
      onClose={onClose}
      primary={{ text: from && to ? `${label(from)} → ${label(to)}` : "Kunlarni tanlang", onClick: () => void save(), busy, disabled: !from || !to }}
    >
      <div className="do-step">
        <span className="do-num">1</span>
        <b>Qaysi dam kuningizda ishlaysiz?</b>
      </div>
      <div className="do-days">
        {data.options.restDays.slice(0, 8).map((d) => (
          <button
            key={d}
            className={`rest ${from === d ? "on" : ""}`}
            onClick={() => {
              haptic.select();
              setFrom(d);
            }}
          >
            <small>{SHORT[dateParts(d).weekday]}</small>
            <b>{Number(d.slice(8))}</b>
          </button>
        ))}
      </div>
      <div className="do-step">
        <span className="do-num">2</span>
        <b>O‘rniga qaysi kuni dam olasiz?</b>
      </div>
      {targets.length ? (
        <div className="do-days">
          {targets.map((d) => (
            <button
              key={d}
              className={to === d ? "on" : ""}
              onClick={() => {
                haptic.select();
                setTo(d);
              }}
            >
              <small>{SHORT[dateParts(d).weekday]}</small>
              <b>{Number(d.slice(8))}</b>
            </button>
          ))}
        </div>
      ) : (
        <p className="mp-note">Bu kun atrofida (±{data.options.maxGapDays} kun) bo‘sh ish kuni yo‘q.</p>
      )}
      <label className="ml-field">
        Sabab (ixtiyoriy)
        <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: shanba kuni to‘y" />
      </label>
      {error && (
        <div className="mini-alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
    </Sheet>
  );
}
