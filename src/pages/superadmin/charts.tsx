import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { Table2, LineChart as LineIcon } from "lucide-react";
import { compact, num } from "./kit";

/*
 * Super Admin grafiklari — bitta seriya (ikki o‘qli grafik yo‘q: har xil o‘lchamdagi ko‘rsatkichlar alohida grafikda),
 * ingichka chiziqlar (2px), ustun ≤ 24px va 4px yumaloq uchi, sokin to‘r, hover — tooltip,
 * har bir grafikda «Jadval» ko‘rinishi (rangga tayanmasdan o‘qish uchun).
 */

const dayLabel = (iso: string) => (iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : iso);
const hourLabel = (bucket: string) => `${bucket.slice(8, 10)}.${bucket.slice(5, 7)} ${bucket.slice(11, 13)}:00`;

function ChartTip({ active, payload, label, unit, labelFormat }: TooltipProps<number, string> & { unit?: string; labelFormat?: (v: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="sa-tip">
      <small>{labelFormat ? labelFormat(String(label)) : String(label)}</small>
      {payload.map((p) => (
        <span key={String(p.dataKey)}>
          <i style={{ background: p.color }} aria-hidden />
          {p.name}: <b>{num(Number(p.value))}</b>
          {unit ? ` ${unit}` : ""}
        </span>
      ))}
    </div>
  );
}

export function ChartCard({ title, subtitle, children, table, height = 220 }: { title: string; subtitle?: ReactNode; children: ReactNode; table: { headers: string[]; rows: (string | number)[][] }; height?: number }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card sa-chart">
      <div className="sa-chart-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-btn" onClick={() => setAsTable(!asTable)} aria-pressed={asTable} aria-label={asTable ? "Grafik ko‘rinishi" : "Jadval ko‘rinishi"} title={asTable ? "Grafik" : "Jadval"}>
          {asTable ? <LineIcon size={16} /> : <Table2 size={16} />}
        </button>
      </div>
      {asTable ? (
        <div className="sa-chart-table" style={{ maxHeight: height + 40 }}>
          <table className="table">
            <thead>
              <tr>
                {table.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className={typeof cell === "number" ? "num" : ""}>
                      {typeof cell === "number" ? num(cell) : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </section>
  );
}

const axis = { stroke: "var(--chart-axis)", fontSize: 11, tickLine: false, axisLine: false } as const;

export function TrendLine<T extends Record<string, unknown>>({ data, x, y, name, color = "var(--chart-brand)", hourly, unit }: { data: T[]; x: keyof T & string; y: keyof T & string; name: string; color?: string; hourly?: boolean; unit?: string }) {
  const format = hourly ? hourLabel : dayLabel;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey={x} {...axis} tickFormatter={(v) => format(String(v))} minTickGap={24} />
        <YAxis {...axis} allowDecimals={false} tickFormatter={(v) => compact(Number(v))} width={44} />
        <Tooltip cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }} content={<ChartTip unit={unit} labelFormat={format} />} isAnimationActive={false} />
        <Line type="monotone" dataKey={y} name={name} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Columns<T extends Record<string, unknown>>({ data, x, y, name, color = "var(--chart-brand)", unit }: { data: T[]; x: keyof T & string; y: keyof T & string; name: string; color?: string; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }} barCategoryGap="22%">
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey={x} {...axis} tickFormatter={(v) => dayLabel(String(v))} minTickGap={16} />
        <YAxis {...axis} allowDecimals={false} tickFormatter={(v) => compact(Number(v))} width={44} />
        <Tooltip cursor={{ fill: "var(--hover-tint)" }} content={<ChartTip unit={unit} labelFormat={dayLabel} />} isAnimationActive={false} />
        <Bar dataKey={y} name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Gorizontal ustunlar (kattalik bo‘yicha saralangan) — qiymat ustun uchida, o‘qish oson. */
export function HBars<T extends Record<string, unknown>>({ data, label, value, name, color = "var(--chart-brand)" }: { data: T[]; label: keyof T & string; value: keyof T & string; name: string; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 8 }} barCategoryGap="28%">
        <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
        <XAxis type="number" {...axis} allowDecimals={false} tickFormatter={(v) => compact(Number(v))} />
        <YAxis type="category" dataKey={label} {...axis} width={150} tick={{ fill: "var(--ink-2)", fontSize: 12 }} />
        <Tooltip cursor={{ fill: "var(--hover-tint)" }} content={<ChartTip />} isAnimationActive={false} />
        <Bar dataKey={value} name={name} fill={color} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} label={{ position: "right", fill: "var(--ink-2)", fontSize: 11, formatter: (v: number) => compact(v) }} />
      </BarChart>
    </ResponsiveContainer>
  );
}
