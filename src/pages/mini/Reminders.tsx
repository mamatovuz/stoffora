import { useEffect, useState } from "react";
import { AlarmClock } from "lucide-react";
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
