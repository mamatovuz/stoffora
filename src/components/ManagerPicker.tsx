import { useState } from "react";
import { Search, X } from "lucide-react";
import { useApi, useDebounced } from "../hooks";
import type { Employee } from "@/lib/types";

export type Picked = { id: string; name: string };

/** Xodimlardan bir yoki bir nechtasini tanlash (qidiruv bilan) — filial rahbarlari uchun. */
export function ManagerPicker({ value, onChange, max = 5 }: { value: Picked[]; onChange: (next: Picked[]) => void; max?: number }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(query, 250);
  const { data } = useApi<{ items: Employee[] }>(open ? `/employees?limit=8&status=ACTIVE&q=${encodeURIComponent(debounced)}` : null);
  const options = (data?.items || []).filter((e) => !value.some((v) => v.id === e.id));
  return (
    <div className="mgr-picker">
      {value.length > 0 && (
        <div className="mgr-chips">
          {value.map((m) => (
            <span key={m.id} className="mgr-chip">
              {m.name}
              <button type="button" aria-label="Olib tashlash" onClick={() => onChange(value.filter((v) => v.id !== m.id))}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      {value.length < max && (
        <span className="input-icon">
          <Search size={16} />
          <input
            className="input"
            value={query}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={value.length ? "Yana rahbar qo‘shish…" : "Xodimni qidiring va tanlang…"}
          />
        </span>
      )}
      {open && options.length > 0 && (
        <div className="mgr-options">
          {options.map((e) => (
            <button
              type="button"
              key={e.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange([...value, { id: e.id, name: `${e.firstName} ${e.lastName}`.trim() }]);
                setQuery("");
              }}
            >
              <b>
                {e.firstName} {e.lastName}
              </b>
              <small>{e.employeeNo}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
