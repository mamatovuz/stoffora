import { useEffect, useState } from "react";
import { AlarmClock, BellRing } from "lucide-react";
import { api, errorText, put } from "../../api";
import { haptic } from "./tg";
import type { Toast } from "./shared";

/* Ish boshlanishi / tugashi haqida eslatma — xodim o‘zi sozlaydi (ilova bilan bir xil API). */

type Rule = { enabled: boolean; offset: number };
type Prefs = { start: Rule; end: Rule };
const MINUTES = [5, 10, 15, 20, 30, 45, 60];

export function MiniReminders({ onToast }: { onToast: Toast }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  useEffect(() => {
    void api<Prefs>("/mini/reminders")
      .then(setPrefs)
      .catch(() => setPrefs(null));
  }, []);
  if (!prefs) return null;
  const save = async (next: Prefs) => {
    setPrefs(next);
    haptic.select();
    try {
      setPrefs(await put<Prefs>("/mini/reminders", next));
    } catch (reason) {
      onToast(errorText(reason, "Saqlanmadi."), "error");
    }
  };
  const row = (key: "start" | "end", title: string) => {
    const rule = prefs[key];
    const minutes = Math.abs(rule.offset) || 10;
    const before = rule.offset < 0;
    const set = (patch: Partial<Rule>) => void save({ ...prefs, [key]: { ...rule, ...patch } });
    return (
      <div className="mr-rule" key={key}>
        <label className="mp-row mp-switch">
          <span>
            <AlarmClock size={15} /> {title}
          </span>
          <input type="checkbox" checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        </label>
        {rule.enabled && (
          <div className="mr-controls">
            <select value={before ? "before" : "after"} onChange={(e) => set({ offset: e.target.value === "before" ? -minutes : minutes })} aria-label="Avval yoki keyin">
              <option value="before">Avval</option>
              <option value="after">Keyin</option>
            </select>
            <select value={minutes} onChange={(e) => set({ offset: before ? -Number(e.target.value) : Number(e.target.value) })} aria-label="Daqiqa">
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    );
  };
  return (
    <>
      <div className="mp-group-title">Eslatmalar</div>
      <section className="mp-group">
        {row("start", "Ish kunining boshlanishi")}
        {row("end", "Ish kunining tugashi")}
      </section>
    </>
  );
}

/* Bildirishnoma toifalari: qaysi xabarlar telefonga (Telegram / push) kelsin. */
type NotifyPrefs = { categories: { key: string; label: string; enabled: boolean }[]; note: string };

export function MiniNotifyPrefs({ onToast }: { onToast: Toast }) {
  const [data, setData] = useState<NotifyPrefs | null>(null);
  useEffect(() => {
    void api<NotifyPrefs>("/mini/notify-prefs")
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data) return null;
  const toggle = async (key: string, enabled: boolean) => {
    haptic.select();
    setData({ ...data, categories: data.categories.map((c) => (c.key === key ? { ...c, enabled } : c)) });
    try {
      await put("/mini/notify-prefs", { [key]: enabled });
    } catch (reason) {
      onToast(errorText(reason, "Saqlanmadi."), "error");
      setData(data);
    }
  };
  return (
    <>
      <div className="mp-group-title">Bildirishnomalar</div>
      <section className="mp-group">
        {data.categories.map((c) => (
          <label className="mp-row mp-switch" key={c.key}>
            <span>
              <BellRing size={15} /> {c.label}
            </span>
            <input type="checkbox" checked={c.enabled} onChange={(e) => void toggle(c.key, e.target.checked)} />
          </label>
        ))}
      </section>
      <p className="mp-note">{data.note}</p>
    </>
  );
}
