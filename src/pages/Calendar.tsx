import { CompanyCalendarPanel } from "./People";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { useApi } from "../hooks";
import {
  Empty,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  Person,
  Status,
} from "../components/ui";
import { dateLongUz, duration, monthYearUz, tashkentIsoDate } from "@/lib/format";
import type { Attendance, Employee } from "@/lib/types";
import { weekdayShort, weekOrder } from "../types";

type Row = Attendance & { employee?: Employee; branch?: string };

export function CalendarPage() {
  const today = tashkentIsoDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [year, monthIndex] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${String(days).padStart(2, "0")}`;
  const { data, loading, error } = useApi<Row[]>(
    `/attendance?from=${from}&to=${to}`,
  );
  const offset = (new Date(Date.UTC(year, monthIndex - 1, 1)).getUTCDay() + 6) % 7;
  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    data?.forEach((row) => map.set(row.date, [...(map.get(row.date) || []), row]));
    return map;
  }, [data]);
  const move = (delta: number) => {
    const next = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
    setMonth(next.toISOString().slice(0, 7));
  };
  const selectedRows = selectedDate ? grouped.get(selectedDate) || [] : [];
  const totals = useMemo(() => {
    const rows = data || [];
    return {
      present: rows.filter((r) => r.checkIn).length,
      late: rows.filter((r) => r.lateMinutes > 0).length,
      hours: Math.round(rows.reduce((s, r) => s + r.workedMinutes, 0) / 60),
    };
  }, [data]);

  return (
    <div className="page">
      <PageHeader
        title="Davomat kalendari"
        subtitle={`${monthYearUz(`${month}-15`)} · ${totals.present} ta kelish, ${totals.late} ta kechikish, ${totals.hours} soat ish`}
        actions={
          <div className="date-nav">
            <button className="icon-btn" aria-label="Oldingi oy" onClick={() => move(-1)}>
              <ChevronLeft size={17} />
            </button>
            <input
              type="month"
              value={month}
              max={today.slice(0, 7)}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              aria-label="Oy"
            />
            <button
              className="icon-btn"
              aria-label="Keyingi oy"
              disabled={month >= today.slice(0, 7)}
              onClick={() => move(1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        }
      />
      <CompanyCalendarPanel month={month} />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : (
        <section className="card calendar-board">
          <div className="calendar-weekdays">
            {weekOrder.map((day) => (
              <span key={day}>{weekdayShort[day]}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => {
              const day = index - offset + 1;
              if (day < 1 || day > days)
                return <span className="calendar-cell blank" key={index} />;
              const key = `${month}-${String(day).padStart(2, "0")}`;
              const rows = grouped.get(key) || [];
              const onTime = rows.filter((r) => r.checkIn && !r.lateMinutes).length;
              const late = rows.filter((r) => r.lateMinutes > 0).length;
              return (
                <button
                  className={`calendar-cell ${key === today ? "today" : ""}`}
                  key={key}
                  onClick={() => setSelectedDate(key)}
                  disabled={key > today}
                >
                  <span>{day}</span>
                  {rows.length ? (
                    <>
                      {onTime > 0 && (
                        <small>
                          <i style={{ background: "var(--green)" }} />
                          {onTime} vaqtida
                        </small>
                      )}
                      {late > 0 && (
                        <small>
                          <i style={{ background: "var(--amber)" }} />
                          {late} kechikkan
                        </small>
                      )}
                    </>
                  ) : (
                    key <= today && <small className="none">—</small>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}
      {selectedDate && (
        <Modal
          title={dateLongUz(selectedDate, true)}
          subtitle={`${selectedRows.length} ta qayd`}
          onClose={() => setSelectedDate(null)}
        >
          {selectedRows.length ? (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {selectedRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Person
                          first={row.employee?.firstName || "?"}
                          last={row.employee?.lastName}
                          photo={row.employee?.photoDataUrl}
                          sub={row.branch}
                        />
                      </td>
                      <td className="num">
                        <span className="times">
                          <Clock3 size={13} className="faint" />
                          <b>{row.checkIn || "—"}</b>
                          <span className="arrow">→</span>
                          <b>{row.checkOut || "—"}</b>
                        </span>
                        <small className="muted" style={{ display: "block" }}>
                          {duration(row.workedMinutes)}
                        </small>
                      </td>
                      <td className="actions">
                        <Status value={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={CalendarDays}
              title="Qaydlar yo‘q"
              text="Bu sana uchun davomat ma’lumoti mavjud emas."
            />
          )}
          <div className="form-actions">
            <Link className="btn" to={`/attendance?date=${selectedDate}`}>
              To‘liq ro‘yxatni ochish
            </Link>
          </div>
        </Modal>
      )}
    </div>
  );
}
