import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, FileText, Flame, Megaphone, MessageCircle, Phone, ShieldCheck, Sun } from "lucide-react";
import { dateUz, duration, tashkentClock, tashkentIsoDate } from "@/lib/format";
import type { Attendance, Branch } from "@/lib/types";
import { leaveTypeLabel } from "../../types";
import { EmptyArt, PhotoAvatar, Seg, Sheet, SkeletonList } from "./shared";
import { callPhone, confirmNative, haptic, writeInTelegram } from "./tg";

/* Rahbar rejimi vositalari: brifing, xodim kartasi, qo‘lda belgilash, trendlar, tezkor e’lon. */

export type Call = <T>(url: string, body?: unknown, method?: string) => Promise<T>;
type Toast = (text: string, tone?: "ok" | "error") => void;
type TrendAlert = { kind: string; severity: 1 | 2 | 3; text: string };
export type TrendRow = { employeeId: string; name: string; branch?: string; photoDataUrl?: string; alerts: TrendAlert[] };
const split = (name: string) => {
  const [firstName, ...rest] = name.split(" ");
  return { firstName, lastName: rest.join(" ") || " " };
};

/* ---------------------------------------------------- ertalabki brifing --- */
export function Briefing({
  name,
  stats,
  notices,
  pending,
  trends,
  onOpen,
}: {
  name: string;
  stats: { in: number; late: number; absent: number; notYet: number; leave: number; expected: number; flagged: number };
  notices: number;
  pending: number;
  trends: number;
  onOpen: (target: "NOT_YET" | "ON_LEAVE" | "requests" | "trends" | "FLAGGED" | "LATE") => void;
}) {
  const hour = Number(tashkentClock().slice(0, 2));
  const greet = hour < 12 ? "Xayrli tong" : hour < 18 ? "Xayrli kun" : "Xayrli kech";
  const items = [
    stats.notYet ? { key: "NOT_YET" as const, text: `${stats.notYet} kishi hali kelmadi`, tone: "warn" } : null,
    notices ? { key: "NOT_YET" as const, text: `${notices} tasi kechikishini aytdi`, tone: "info" } : null,
    stats.late ? { key: "LATE" as const, text: `${stats.late} kishi kechikdi`, tone: "warn" } : null,
    stats.leave ? { key: "ON_LEAVE" as const, text: `${stats.leave} kishi ta’tilda`, tone: "" } : null,
    pending ? { key: "requests" as const, text: `${pending} ta so‘rov kutmoqda`, tone: "accent" } : null,
    trends ? { key: "trends" as const, text: `${trends} xodimda muammoli trend`, tone: "bad" } : null,
    stats.flagged ? { key: "FLAGGED" as const, text: `${stats.flagged} ta shubhali belgi`, tone: "bad" } : null,
  ].filter(Boolean) as { key: Parameters<typeof onOpen>[0]; text: string; tone: string }[];
  return (
    <section className="mg-brief">
      <div className="mg-brief-head">
        <Sun size={18} />
        <b>
          {greet}, {name.split(" ")[0]}!
        </b>
      </div>
      <p>
        Bugun {stats.expected} kishi ishlashi kerak, {stats.in} kishi keldi.
        {!items.length && " Hammasi joyida — e’tibor talab qiladigan narsa yo‘q ✨"}
      </p>
      {items.length > 0 && (
        <div className="mg-brief-chips">
          {items.map((item) => (
            <button
              key={item.text}
              className={item.tone}
              onClick={() => {
                haptic.select();
                onOpen(item.key);
              }}
            >
              {item.text}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------- trendlar --- */
export function TrendsList({ rows, onOpen }: { rows: TrendRow[] | null; onOpen: (employeeId: string) => void }) {
  if (!rows) return <SkeletonList rows={3} />;
  if (!rows.length)
    return (
      <div className="mini-empty">
        <EmptyArt kind="check" />
        <b>Muammoli trend yo‘q</b>
        <small>Oxirgi 4 haftada kechikish, kelmaslik yoki shubhali belgilar bo‘yicha qonuniyat topilmadi.</small>
      </div>
    );
  return (
    <section className="mini-card">
      <div className="mini-rows">
        {rows.map((row) => (
          <button className="mini-row mg-trend" key={row.employeeId} onClick={() => onOpen(row.employeeId)}>
            <PhotoAvatar employee={{ ...split(row.name), photoDataUrl: row.photoDataUrl }} />
            <span>
              <b>{row.name}</b>
              {row.alerts.map((alert) => (
                <small key={alert.kind} className={`sev${alert.severity}`}>
                  <AlertTriangle size={11} /> {alert.text}
                </small>
              ))}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------- xodim kartasi --- */
type Card = {
  employee: {
    id: string;
    name: string;
    employeeNo: string;
    phone?: string;
    telegramUsername?: string;
    photoDataUrl?: string;
    startDate: string;
    birthDate?: string;
    position?: string;
    department?: string;
    branch?: string;
    faceEnrolled: boolean;
    biometric: boolean;
  };
  month: { present: number; late: number; lateMinutes: number; workedHours: number; overtimeHours: number; absent: number };
  streak: { current: number; best: number };
  trends: TrendAlert[];
  recent: { id: string; date: string; checkIn?: string; checkOut?: string; lateMinutes: number; workedMinutes: number; flags?: string[]; manual: boolean }[];
  documents: { id: string; title: string; expiresAt?: string; status: "OK" | "SOON" | "EXPIRED" }[];
  leaves: { id: string; type: string; startDate: string; endDate: string }[];
};

export function EmployeeCardSheet({
  employeeId,
  call,
  canEdit,
  onClose,
  onToast,
  onChanged,
}: {
  employeeId: string;
  call: Call;
  canEdit: boolean;
  onClose: () => void;
  onToast: Toast;
  onChanged: () => void;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"stats" | "history" | "docs">("stats");
  const [marking, setMarking] = useState(false);
  const load = () =>
    call<Card>(`/employee-card/${employeeId}`)
      .then(setCard)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Xatolik"));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);
  if (marking && card)
    return (
      <ManualMarkSheet
        call={call}
        employeeId={employeeId}
        name={card.employee.name}
        today={card.recent.find((r) => r.date === tashkentIsoDate())}
        onClose={() => setMarking(false)}
        onSaved={() => {
          setMarking(false);
          onToast("Davomat qo‘lda belgilandi — auditga yozildi");
          haptic.success();
          onChanged();
          void load();
        }}
        onToast={onToast}
      />
    );
  const e = card?.employee;
  return (
    <Sheet
      title={e?.name || "Xodim"}
      subtitle={e ? [e.position, e.branch].filter(Boolean).join(" · ") : "Yuklanmoqda…"}
      onClose={onClose}
      className="ec-sheet"
      primary={canEdit && card ? { text: "Qo‘lda belgilash", onClick: () => setMarking(true) } : null}
    >
      {error ? (
        <div className="mini-alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      ) : !card || !e ? (
        <SkeletonList rows={4} />
      ) : (
        <>
          <div className="ec-head">
            <PhotoAvatar employee={{ ...split(e.name), photoDataUrl: e.photoDataUrl }} className="ec-avatar" />
            <div className="ec-contacts">
              {(e.telegramUsername || e.phone) && (
                <button onClick={() => writeInTelegram({ username: e.telegramUsername, phone: e.phone })}>
                  <MessageCircle size={17} /> Yozish
                </button>
              )}
              {e.phone && (
                <button onClick={() => callPhone(e.phone!)}>
                  <Phone size={17} /> Qo‘ng‘iroq
                </button>
              )}
            </div>
            <div className="mp-chips">
              <span>🆔 {e.employeeNo}</span>
              <span className={e.faceEnrolled ? "ok" : ""}>{e.faceEnrolled ? "✓ Face ID" : "Face ID yo‘q"}</span>
              {e.biometric && <span className="ok">✓ Biometriya</span>}
              {card.streak.current > 0 && (
                <span>
                  <Flame size={12} /> {card.streak.current} kun vaqtida
                </span>
              )}
            </div>
          </div>
          {card.trends.length > 0 && (
            <div className="ec-trends">
              {card.trends.map((t) => (
                <div key={t.kind} className={`sev${t.severity}`}>
                  <AlertTriangle size={14} /> {t.text}
                </div>
              ))}
            </div>
          )}
          <Seg
            className="three"
            value={tab}
            onChange={setTab}
            options={[
              ["stats", "Bu oy"],
              ["history", "Tarix"],
              ["docs", "Hujjatlar"],
            ]}
          />
          {tab === "stats" && (
            <>
              <section className="mg-kpis">
                <div>
                  <small>Keldi</small>
                  <b>{card.month.present}</b>
                </div>
                <div>
                  <small>Kechikdi</small>
                  <b className={card.month.late ? "warn" : ""}>
                    {card.month.late} <em className="down">{card.month.lateMinutes} daq</em>
                  </b>
                </div>
                <div>
                  <small>Kelmadi</small>
                  <b>{card.month.absent}</b>
                </div>
                <div>
                  <small>Ishladi</small>
                  <b>
                    {card.month.workedHours} s{card.month.overtimeHours ? <em className="up">+{card.month.overtimeHours}</em> : null}
                  </b>
                </div>
              </section>
              <section className="mp-group">
                <div className="mp-row">
                  <span>Ish boshlagan</span>
                  <b>{dateUz(e.startDate)}</b>
                </div>
                {e.birthDate && (
                  <div className="mp-row">
                    <span>Tug‘ilgan kun</span>
                    <b>{dateUz(e.birthDate)}</b>
                  </div>
                )}
                <div className="mp-row">
                  <span>Eng uzun seriya</span>
                  <b>{card.streak.best} kun</b>
                </div>
                {card.leaves.map((l) => (
                  <div className="mp-row" key={l.id}>
                    <span>
                      <CalendarClock size={14} /> {leaveTypeLabel[l.type] || "Ta’til"}
                    </span>
                    <b>
                      {dateUz(l.startDate)} – {dateUz(l.endDate)}
                    </b>
                  </div>
                ))}
              </section>
            </>
          )}
          {tab === "history" && (
            <section className="mini-card">
              {!card.recent.length ? (
                <div className="mini-empty">Qaydlar yo‘q</div>
              ) : (
                <div className="mini-rows">
                  {card.recent.map((r) => (
                    <div className="mini-row" key={r.id}>
                      <span className="mini-date">
                        <b>{Number(r.date.slice(8))}</b>
                        <small>{dateUz(r.date).split(".")[1]}</small>
                      </span>
                      <span>
                        <b>
                          {r.checkIn || "—"} → {r.checkOut || "…"}
                        </b>
                        <small>
                          {r.workedMinutes ? duration(r.workedMinutes) : ""}
                          {r.lateMinutes ? ` · ${r.lateMinutes} daq kech` : ""}
                          {r.manual ? " · ✍️ qo‘lda" : ""}
                          {r.flags?.length ? " · ⚠️" : ""}
                        </small>
                      </span>
                      <span className={`mini-chip ${r.lateMinutes ? "warn" : "ok"}`}>{r.lateMinutes ? "Kech" : "Vaqtida"}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {tab === "docs" && (
            <section className="mp-group">
              {!card.documents.length ? (
                <div className="mini-empty">
                  <FileText size={22} /> Hujjat yuklanmagan
                </div>
              ) : (
                card.documents.map((d) => (
                  <div className="mp-row" key={d.id}>
                    <span>
                      <FileText size={14} /> {d.title}
                    </span>
                    <b className={d.status === "EXPIRED" ? "warn" : d.status === "SOON" ? "warn" : "ok"}>
                      {d.expiresAt ? (d.status === "EXPIRED" ? "Muddati o‘tgan" : `${dateUz(d.expiresAt)} gacha`) : "✓"}
                    </b>
                  </div>
                ))
              )}
            </section>
          )}
        </>
      )}
    </Sheet>
  );
}

/* ---------------------------------------------------- qo‘lda belgilash --- */
function ManualMarkSheet({
  call,
  employeeId,
  name,
  today,
  onClose,
  onSaved,
  onToast,
}: {
  call: Call;
  employeeId: string;
  name: string;
  today?: { id: string; checkIn?: string; checkOut?: string };
  onClose: () => void;
  onSaved: () => void;
  onToast: Toast;
}) {
  const now = tashkentClock();
  const [checkIn, setCheckIn] = useState(today?.checkIn || now);
  const [checkOut, setCheckOut] = useState(today?.checkIn ? today.checkOut || now : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const reasons = ["Telefoni buzilgan", "Internet yo‘q edi", "Face ID tanimadi", "Tashqi topshiriqda"];
  async function save() {
    if (reason.trim().length < 3) return onToast("Sababni yozing — auditga tushadi", "error");
    if (!(await confirmNative(`${name}: kelish ${checkIn}${checkOut ? `, ketish ${checkOut}` : ""}. Saqlansinmi?`, { ok: "Saqlash" }))) return;
    setBusy(true);
    try {
      const note = `Qo‘lda (Mini App): ${reason.trim()}`;
      if (today?.id) await call<Attendance>(`/attendance/${today.id}`, { checkIn, checkOut: checkOut || "", note }, "PUT");
      else await call<Attendance>("/attendance", { employeeId, date: tashkentIsoDate(), checkIn, checkOut: checkOut || "", note });
      onSaved();
    } catch (reason) {
      onToast(reason instanceof Error ? reason.message : "Saqlanmadi", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="Qo‘lda belgilash" subtitle={`${name} · bugun`} onClose={onClose} primary={{ text: "Saqlash", onClick: () => void save(), busy, disabled: reason.trim().length < 3 }}>
      <div className="mh-hint info">
        <ShieldCheck size={16} />
        <span>Qo‘lda belgilash Face ID/GPS’siz bo‘ladi — sabab, kim va qachon kiritgani auditga yoziladi.</span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="grid-2">
          <label>
            Keldi
            <input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} required />
          </label>
          <label>
            Ketdi (ixtiyoriy)
            <input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          </label>
        </div>
        <div className="ms-chips">
          {reasons.map((text) => (
            <button type="button" key={text} onClick={() => setReason(text)}>
              {text}
            </button>
          ))}
        </div>
        <label>
          Sabab
          <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: telefoni buzilgan" />
        </label>
      </form>
    </Sheet>
  );
}

/* ---------------------------------------------------- tezkor e’lon --- */
export function QuickAnnounceSheet({ call, branches, onClose, onToast }: { call: Call; branches: Branch[]; onClose: () => void; onToast: Toast }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState<string[]>([]);
  const [mode, setMode] = useState<"info" | "ack" | "poll">("info");
  const [options, setOptions] = useState(["Ha", "Yo‘q"]);
  const [busy, setBusy] = useState(false);
  const valid = title.trim().length >= 3 && message.trim().length >= 3 && (mode !== "poll" || options.filter((o) => o.trim()).length >= 2);
  async function send() {
    if (!valid) return;
    if (!(await confirmNative(`E’lon ${target.length ? `${target.length} ta filialga` : "barcha xodimlarga"} yuborilsinmi?`, { ok: "Yuborish" }))) return;
    setBusy(true);
    try {
      const result = await call<{ recipients: number; delivered: number }>("/quick-announce", {
        title: title.trim(),
        message: message.trim(),
        branchIds: target,
        ackRequired: mode === "ack" || undefined,
        options: mode === "poll" ? options.map((o) => o.trim()).filter(Boolean) : undefined,
      });
      haptic.success();
      onToast(`E’lon ${result.recipients} kishiga yuborildi (Telegram: ${result.delivered})`);
      onClose();
    } catch (reason) {
      onToast(reason instanceof Error ? reason.message : "Yuborilmadi", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="Tezkor e’lon" subtitle="Xodimlarga Telegram va ilova orqali" onClose={onClose} primary={{ text: "Yuborish", onClick: () => void send(), busy, disabled: !valid }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label>
          Sarlavha
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Masalan: Ertaga yig‘ilish" />
        </label>
        <label>
          Xabar
          <textarea value={message} maxLength={1500} rows={4} onChange={(e) => setMessage(e.target.value)} placeholder="Batafsil yozing" />
        </label>
        {branches.length > 1 && (
          <div className="qa-branches">
            <span>Kimga</span>
            <div className="ms-chips">
              <button type="button" className={!target.length ? "on" : ""} onClick={() => setTarget([])}>
                Hammasi
              </button>
              {branches.map((b) => (
                <button
                  type="button"
                  key={b.id}
                  className={target.includes(b.id) ? "on" : ""}
                  onClick={() => setTarget((list) => (list.includes(b.id) ? list.filter((x) => x !== b.id) : [...list, b.id]))}
                >
                  {b.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <Seg
          className="three"
          value={mode}
          onChange={setMode}
          options={[
            ["info", "Xabar"],
            ["ack", "Tanishdim"],
            ["poll", "So‘rovnoma"],
          ]}
        />
        {mode === "poll" && (
          <div className="qa-options">
            {options.map((option, index) => (
              <input
                key={index}
                value={option}
                maxLength={60}
                placeholder={`${index + 1}-variant`}
                onChange={(e) => setOptions((list) => list.map((o, i) => (i === index ? e.target.value : o)))}
              />
            ))}
            {options.length < 4 && (
              <button type="button" className="mini-link" onClick={() => setOptions((list) => [...list, ""])}>
                + Variant
              </button>
            )}
          </div>
        )}
        <p className="mp-note">
          <Megaphone size={13} /> {mode === "ack" ? "Har kim «Tanishdim» bosishi kerak — kim o‘qiganini panelda ko‘rasiz." : mode === "poll" ? "Natijalar panelda E’lonlar bo‘limida ko‘rinadi." : "Oddiy xabar."}
        </p>
      </form>
    </Sheet>
  );
}

