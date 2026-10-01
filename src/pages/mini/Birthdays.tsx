import { useCallback, useEffect, useState } from "react";
import { Cake, ChevronRight, LoaderCircle, PartyPopper } from "lucide-react";
import { api, errorText, post } from "../../api";
import { dateLongUz } from "@/lib/format";
import { getCached, setCached } from "../miniCache";
import { EmptyArt, PhotoAvatar, Sheet, SkeletonList, type Toast } from "./shared";
import { haptic } from "./tg";

/* Tug‘ilgan kunlar: bugun va yaqin 2 hafta; bir bosishda tabriklash. */

export type Birthday = {
  id: string;
  name: string;
  position?: string;
  branch?: string;
  sameBranch: boolean;
  photoDataUrl?: string;
  date: string;
  inDays: number;
  me: boolean;
  congratulated: boolean;
  canCongratulate: boolean;
};

const WISHES = [
  "Tug‘ilgan kuningiz muborak! Sog‘lik, baxt va omad tilayman! 🎉",
  "Tabriklayman! Yangi yoshingiz yangi yutuqlar olib kelsin! 🎂",
  "Muborak bo‘lsin! Jamoamizda borligingizdan xursandmiz! 🌟",
];

export function useBirthdays(enabled = true) {
  const [rows, setRows] = useState<Birthday[] | null>(() => getCached<Birthday[]>("birthdays"));
  const load = useCallback(
    () =>
      api<Birthday[]>("/mini/birthdays")
        .then((value) => {
          setCached("birthdays", value);
          setRows(value);
        })
        .catch(() => setRows((current) => current || [])),
    [],
  );
  useEffect(() => {
    if (enabled && !getCached("birthdays")) void load();
  }, [enabled, load]);
  return { rows, reload: load };
}

const split = (name: string) => {
  const [firstName, ...rest] = name.split(" ");
  return { firstName, lastName: rest.join(" ") || " " };
};

/** Bosh sahifadagi karta: faqat bugun tug‘ilgan kun bo‘lsa ko‘rinadi. */
export function BirthdayCard({ onOpen, offline }: { onOpen: () => void; offline?: boolean }) {
  const { rows } = useBirthdays(!offline);
  const today = (rows || []).filter((r) => r.inDays === 0);
  if (!today.length) return null;
  const mine = today.find((r) => r.me);
  const others = today.filter((r) => !r.me);
  return (
    <button className={`bd-card ${mine ? "mine" : ""}`} onClick={onOpen}>
      <span className="bd-icon">{mine ? <PartyPopper size={20} /> : <Cake size={20} />}</span>
      <span>
        <b>{mine ? "Tug‘ilgan kuningiz muborak! 🎉" : `Bugun ${others[0].name.split(" ")[0]}ning tug‘ilgan kuni`}</b>
        <small>
          {mine
            ? "Butun jamoa nomidan tabriklaymiz!"
            : others.length > 1
              ? `va yana ${others.length - 1} kishi — tabriklang 🎂`
              : `${others[0].position || "Hamkasbingiz"} — tabriklang 🎂`}
        </small>
      </span>
      <ChevronRight size={16} />
    </button>
  );
}

export function BirthdaysSheet({ onClose, onToast }: { onClose: () => void; onToast: Toast }) {
  const { rows, reload } = useBirthdays();
  const [target, setTarget] = useState<Birthday | null>(null);
  const [wish, setWish] = useState(WISHES[0]);
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!target) return;
    setBusy(true);
    try {
      await post(`/mini/birthdays/${target.id}/congrats`, { text: wish.trim() || undefined });
      haptic.success();
      onToast(`${target.name.split(" ")[0]} tabrigingizni oldi 🎉`);
      setTarget(null);
      void reload();
    } catch (reason) {
      onToast(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  }
  if (target)
    return (
      <Sheet
        title={`${target.name.split(" ")[0]}ni tabriklash`}
        subtitle="Tabrik Telegram’ga boradi"
        onClose={() => setTarget(null)}
        primary={{ text: "🎉 Tabrik yuborish", onClick: () => void send(), busy, disabled: !wish.trim(), shine: true }}
      >
        <div className="bd-wishes">
          {WISHES.map((text) => (
            <button key={text} className={wish === text ? "on" : ""} onClick={() => setWish(text)}>
              {text}
            </button>
          ))}
        </div>
        <label className="ml-field">
          O‘z so‘zlaringiz bilan
          <textarea value={wish} maxLength={300} rows={3} onChange={(e) => setWish(e.target.value)} />
        </label>
        {busy && <LoaderCircle className="spin" />}
      </Sheet>
    );
  const groups = [
    ["Bugun", (rows || []).filter((r) => r.inDays === 0)],
    ["Shu hafta", (rows || []).filter((r) => r.inDays > 0 && r.inDays <= 7)],
    ["Keyingi hafta", (rows || []).filter((r) => r.inDays > 7)],
  ] as const;
  return (
    <Sheet title="Tug‘ilgan kunlar" subtitle="Yaqin ikki hafta" onClose={onClose}>
      {!rows ? (
        <SkeletonList rows={4} />
      ) : !rows.length ? (
        <div className="mini-empty">
          <EmptyArt kind="cake" />
          <b>Yaqin kunlarda tug‘ilgan kun yo‘q</b>
          <small>Xodim profilida tug‘ilgan sana kiritilgan bo‘lsa, shu yerda ko‘rinadi.</small>
        </div>
      ) : (
        groups.map(([label, list]) =>
          list.length ? (
            <div key={label}>
              <div className="mp-group-title">{label}</div>
              <section className="mini-card">
                <div className="mini-rows">
                  {list.map((r) => (
                    <div className="mini-row" key={r.id}>
                      <PhotoAvatar employee={{ ...split(r.name), photoDataUrl: r.photoDataUrl }} />
                      <span>
                        <b>
                          {r.name}
                          {r.me ? " (siz)" : ""}
                        </b>
                        <small>
                          {r.inDays === 0 ? "🎂 Bugun" : dateLongUz(r.date)}
                          {r.position ? ` · ${r.position}` : ""}
                          {!r.sameBranch && r.branch ? ` · ${r.branch}` : ""}
                        </small>
                      </span>
                      {r.canCongratulate &&
                        (r.congratulated ? (
                          <span className="mini-chip ok">Tabriklandi</span>
                        ) : (
                          <button
                            className="mini-btn sm"
                            onClick={() => {
                              haptic.tap();
                              setTarget(r);
                            }}
                          >
                            🎉 Tabriklash
                          </button>
                        ))}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null,
        )
      )}
    </Sheet>
  );
}
