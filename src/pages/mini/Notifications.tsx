import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeftRight, Bell, CheckCheck, ChevronRight, Clock3, FileText, LoaderCircle, Megaphone, Plane, Vote, Wallet, X } from "lucide-react";
import { api, errorText, post } from "../../api";
import { dateLongUz, dateUz, tashkentClock, tashkentIsoDate } from "@/lib/format";
import { parseDeepLink, type DeepLink } from "@/lib/mini";
import type { Notification } from "@/lib/types";
import { haptic, useMainButton } from "./tg";

const notifKinds: Record<string, { icon: typeof Bell; tone: string; label: string }> = {
  ATTENDANCE: { icon: Clock3, tone: "warn", label: "Davomat" },
  LEAVE: { icon: Plane, tone: "blue", label: "Ta’til" },
  SWAP: { icon: ArrowLeftRight, tone: "blue", label: "Smena" },
  PAYROLL: { icon: Wallet, tone: "green", label: "Ish haqi" },
  DOCUMENT: { icon: FileText, tone: "gray", label: "Hujjat" },
  ANNOUNCEMENT: { icon: Megaphone, tone: "green", label: "E’lon" },
};
const kindOf = (item: Pick<Notification, "type" | "options">) =>
  item.options?.length ? { icon: Vote, tone: "blue", label: "So‘rovnoma" } : notifKinds[item.type] || { icon: Bell, tone: "gray", label: "Xabar" };

function relativeTime(iso: string) {
  const diff = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (diff < 1) return "hozir";
  if (diff < 60) return `${diff} daq oldin`;
  const day = tashkentIsoDate(new Date(iso));
  if (day === tashkentIsoDate()) return tashkentClock(new Date(iso));
  return `${dateUz(day)}, ${tashkentClock(new Date(iso))}`;
}
function dayGroup(iso: string) {
  const day = tashkentIsoDate(new Date(iso));
  if (day === tashkentIsoDate()) return "Bugun";
  if (day === tashkentIsoDate(new Date(Date.now() - 86_400_000))) return "Kecha";
  return dateLongUz(day);
}
const needsAction = (item: Notification) => Boolean((item.ackRequired || item.options?.length) && !item.ackAt);

export function NotifItem({ item, onOpen }: { item: Notification; onOpen?: () => void }) {
  const kind = kindOf(item);
  const Icon = kind.icon;
  return (
    <button className={`mn-item ${item.read ? "" : "unread"}`} onClick={onOpen}>
      <span className={`mn-icon ${kind.tone}`}>
        <Icon size={17} />
      </span>
      <span className="mn-text">
        <span className="mn-head">
          <b>{item.title.replace(/^📢\s*/, "")}</b>
          <time>{relativeTime(item.createdAt)}</time>
        </span>
        <small>{item.body}</small>
        {needsAction(item) && <em className="mn-need">{item.options?.length ? "Javob kutilmoqda" : "Tasdiq kutilmoqda"}</em>}
      </span>
      {!item.read && <i className="mn-dot" aria-label="O‘qilmagan" />}
    </button>
  );
}

export function NotificationsSheet({ onClose, onChanged, onNavigate }: { onClose: () => void; onChanged: () => void; onNavigate: (link: DeepLink) => void }) {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Notification | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [ackError, setAckError] = useState("");
  useEffect(() => {
    api<{ items: Notification[] }>("/mini/notifications")
      .then((r) => {
        setItems(r.items);
        // Javob kutayotgan e’lon bo‘lsa — darhol ochamiz.
        const pending = r.items.find(needsAction);
        if (pending) setOpen(pending);
      })
      .catch((reason) => setError(errorText(reason)));
  }, []);
  useEffect(() => {
    setAnswer("");
    setAckError("");
  }, [open?.id]);
  const markRead = async (ids?: string[]) => {
    setItems((list) => list?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) || null);
    await post("/mini/notifications/read", ids ? { ids } : { all: true }).catch(() => undefined);
    onChanged();
  };
  useEffect(() => {
    if (open && !open.read) void markRead([open.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id]);

  async function acknowledge() {
    if (!open) return;
    if (open.options?.length && !answer) return setAckError("Variantlardan birini tanlang.");
    setBusy(true);
    setAckError("");
    try {
      const updated = await post<Notification>(`/mini/notifications/${open.id}/ack`, { answer: answer || undefined });
      setItems((list) => list?.map((n) => (n.id === updated.id ? updated : n)) || null);
      setOpen(updated);
      haptic.success();
      onChanged();
    } catch (reason) {
      setAckError(errorText(reason));
      haptic.error();
    } finally {
      setBusy(false);
    }
  }

  const link = open?.go ? parseDeepLink(open.go) : null;
  const action = open && needsAction(open);
  useMainButton(
    open && action
      ? { text: open.options?.length ? (answer ? `«${answer}» — yuborish` : "Variantni tanlang") : "✅ Tanishdim", onClick: () => void acknowledge(), disabled: Boolean(open.options?.length && !answer), progress: busy }
      : open && link && link.tab !== "home"
        ? { text: "Bo‘limni ochish", onClick: () => onNavigate(link) }
        : null,
  );

  const unread = items?.filter((n) => !n.read).length || 0;
  const groups = (items || []).reduce<[string, Notification[]][]>((acc, n) => {
    const label = dayGroup(n.createdAt);
    const group = acc.find(([key]) => key === label);
    if (group) group[1].push(n);
    else acc.push([label, [n]]);
    return acc;
  }, []);
  return (
    <div className="sheet-layer">
      <button className="sheet-backdrop" onClick={onClose} aria-label="Yopish" />
      <section className="sheet mn-sheet">
        <div className="sheet-head">
          <div>
            <b>Xabarnomalar</b>
            <small>{unread ? `${unread} ta o‘qilmagan` : "Hammasi o‘qilgan"}</small>
          </div>
          {unread > 0 && (
            <button className="mn-readall" onClick={() => void markRead()}>
              <CheckCheck size={15} /> O‘qildi
            </button>
          )}
          <button className="sheet-close" onClick={onClose} aria-label="Yopish">
            <X size={18} />
          </button>
        </div>
        {error ? (
          <div className="mini-alert warn">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        ) : !items ? (
          <div className="mn-loading">
            <LoaderCircle className="spin" size={22} />
          </div>
        ) : !items.length ? (
          <div className="mini-empty">
            <Bell size={26} />
            <b>Xabarlar yo‘q</b>
            <small>E’lonlar, ta’til javoblari va eslatmalar shu yerda ko‘rinadi.</small>
          </div>
        ) : (
          <div className="mn-scroll">
            {groups.map(([label, rows]) => (
              <div key={label} className="mn-group">
                <div className="mn-day">{label}</div>
                <div className="mn-list">
                  {rows.map((item) => (
                    <NotifItem key={item.id} item={item} onOpen={() => setOpen(item)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {open && (
          <div className="mn-detail" role="dialog" aria-label={open.title}>
            <button className="mn-back" onClick={() => setOpen(null)}>
              <ChevronRight size={16} style={{ transform: "rotate(180deg)" }} /> Orqaga
            </button>
            <span className={`mn-icon lg ${kindOf(open).tone}`}>
              {(() => {
                const Icon = kindOf(open).icon;
                return <Icon size={22} />;
              })()}
            </span>
            <small className="mn-kind">
              {kindOf(open).label} · {relativeTime(open.createdAt)}
            </small>
            <h2>{open.title.replace(/^📢\s*/, "")}</h2>
            <p>{open.body}</p>
            {open.options?.length ? (
              <div className="mn-poll" role="radiogroup">
                {open.options.map((option) => {
                  const chosen = open.ackAt ? open.answer === option : answer === option;
                  return (
                    <button
                      key={option}
                      role="radio"
                      aria-checked={chosen}
                      disabled={Boolean(open.ackAt)}
                      className={chosen ? "on" : ""}
                      onClick={() => {
                        haptic.select();
                        setAnswer(option);
                      }}
                    >
                      <i />
                      {option}
                    </button>
                  );
                })}
                {open.ackAt && <small className="mn-acked">✓ Javobingiz qabul qilindi</small>}
              </div>
            ) : open.ackRequired ? (
              open.ackAt ? (
                <small className="mn-acked">✓ Tanishganingiz tasdiqlandi · {relativeTime(open.ackAt)}</small>
              ) : null
            ) : null}
            {ackError && (
              <div className="mini-alert" style={{ marginTop: 10 }}>
                <AlertCircle size={18} />
                <span>{ackError}</span>
              </div>
            )}
            {/* Telegram tashqarisida (MainButton yo‘q) — oddiy tugmalar */}
            {!window.Telegram?.WebApp?.initData && action && (
              <button className="mini-btn" style={{ marginTop: 14 }} disabled={busy} onClick={() => void acknowledge()}>
                {open.options?.length ? "Javobni yuborish" : "Tanishdim"}
              </button>
            )}
            {!window.Telegram?.WebApp?.initData && !action && link && link.tab !== "home" && (
              <button className="mini-btn" style={{ marginTop: 14 }} onClick={() => onNavigate(link)}>
                Bo‘limni ochish
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
