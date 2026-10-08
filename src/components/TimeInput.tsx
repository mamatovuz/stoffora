import { useEffect, useState, type InputHTMLAttributes } from "react";

/** «9» → 09:00, «930» → 09:30, «14» → 14:00, «2400»/«25:00» → null. */
export function normalizeClock(raw: string): string | null {
  if (raw.includes(":")) {
    const [h, m = ""] = raw.split(":").map((part) => part.replace(/\D/g, ""));
    if (!h || h.length > 2 || m.length > 2) return null;
    const hour = Number(h);
    const minute = Number(m || "0");
    return hour > 23 || minute > 59 ? null : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const [h, m] = digits.length <= 2 ? [digits, "0"] : digits.length === 3 ? [digits.slice(0, 1), digits.slice(1)] : [digits.slice(0, 2), digits.slice(2, 4)];
  const hour = Number(h);
  const minute = Number(m);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Vaqt maydoni — doim 24 soatlik (SS:DD). Brauzerning `type="time"` maydoni
 * tizim tiliga qarab AM/PM ko‘rsatadi; bu yerda 14:00, 00:00 kabi yoziladi.
 */
export function TimeInput({
  value,
  onChange,
  required,
  ...rest
}: { value: string; onChange: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  function commit() {
    if (!text.trim() && !required) {
      if (value) onChange("");
      return;
    }
    const clock = normalizeClock(text);
    if (clock) {
      setText(clock);
      if (clock !== value) onChange(clock);
    } else setText(value);
  }
  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder={rest.placeholder ?? "SS:DD"}
      maxLength={5}
      required={required}
      value={text}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d:]/g, "");
        let hour: string;
        let minute: string;
        if (raw.includes(":")) {
          const [h, m = ""] = raw.split(":");
          hour = h.slice(0, 2);
          minute = m.replace(/\D/g, "").slice(0, 2);
        } else {
          // Ikki raqamdan keyin «:» o‘zi qo‘yiladi (1400 → 14:00).
          hour = raw.slice(0, 2);
          minute = raw.slice(2, 4);
        }
        const next = raw.includes(":") || minute ? `${hour}:${minute}` : hour;
        setText(next);
        if (hour && minute.length === 2) {
          const clock = normalizeClock(`${hour.padStart(2, "0")}${minute}`);
          if (clock) onChange(clock);
        }
      }}
      onBlur={(e) => {
        commit();
        rest.onBlur?.(e);
      }}
    />
  );
}
