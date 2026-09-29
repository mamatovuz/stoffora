import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ShieldCheck,
} from "lucide-react";
import { useApi } from "../hooks";
import {
  Avatar,
  Empty,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  Status,
} from "../components/ui";
import { dateLongUz, duration, monthYearUz } from "@/lib/format";
import type { Attendance, Employee } from "@/lib/types";

type Row = Attendance & {
  employee?: Employee;
  branch?: string;
  department?: string;
};
const weekdays = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

export function CalendarPage() {
  const { data, loading, error } = useApi<Row[]>("/attendance");
  const now = new Date();
  const [cursor, setCursor] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    data?.forEach((row) =>
      map.set(row.date, [...(map.get(row.date) || []), row]),
    );
    return map;
  }, [data]);
  const selectedRows = selectedDate ? grouped.get(selectedDate) || [] : [];
  function moveMonth(delta: number) {
    setCursor(new Date(year, month + delta, 1));
  }
  return (
    <div className="page calendar-page">
      <PageHeader
        title="Davomat kalendari"
        subtitle="Kunlik holat va jamoa dinamikasi"
      />
      <section className="calendar-toolbar">
        <div>
          <CalendarDays size={18} />
          <b>{monthYearUz(cursor)}</b>
        </div>
        <div>
          <button
            className="btn btn-sm"
            onClick={() => moveMonth(-1)}
            aria-label="Oldingi oy"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            className="btn btn-sm"
            onClick={() =>
              setCursor(new Date(now.getFullYear(), now.getMonth(), 1))
            }
          >
            Bugun
          </button>
          <button
            className="btn btn-sm"
            onClick={() => moveMonth(1)}
            aria-label="Keyingi oy"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </section>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : (
        <section className="calendar-board">
          <div className="calendar-weekdays">
            {weekdays.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-month-grid">
            {Array.from({ length: 42 }, (_, index) => {
              const day = index - offset + 1;
              if (day < 1 || day > days)
                return <span className="calendar-blank" key={index} />;
              const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const rows = grouped.get(key) || [];
              const present = rows.filter((row) =>
                ["PRESENT", "WORKING", "CHECKED_OUT"].includes(row.status),
              ).length;
              const late = rows.filter((row) => row.status === "LATE").length;
              const absent = rows.filter(
                (row) => row.status === "ABSENT",
              ).length;
              const isToday =
                day === now.getDate() &&
                month === now.getMonth() &&
                year === now.getFullYear();
              return (
                <button
                  className={`calendar-cell ${isToday ? "today" : ""}`}
                  key={key}
                  onClick={() => setSelectedDate(key)}
                >
                  <span>{day}</span>
                  {rows.length ? (
                    <div className="calendar-counts">
                      {present > 0 && (
                        <small className="present">
                          <i />
                          {present} ishda
                        </small>
                      )}
                      {late > 0 && (
                        <small className="late">
                          <i />
                          {late} kechikkan
                        </small>
                      )}
                      {absent > 0 && (
                        <small className="absent">
                          <i />
                          {absent} kelmagan
                        </small>
                      )}
                    </div>
                  ) : (
                    <small className="calendar-no-data">Qayd yo‘q</small>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}
      {selectedDate && (
        <Modal
          title={dateLongUz(selectedDate)}
          onClose={() => setSelectedDate(null)}
        >
          {selectedRows.length ? (
            <div className="calendar-detail-list">
              {selectedRows.map((row) => (
                <article key={row.id}>
                  <Avatar
                    first={row.employee?.firstName || "?"}
                    last={row.employee?.lastName}
                    photo={row.employee?.photoDataUrl}
                  />
                  <div>
                    <b>
                      {row.employee?.firstName} {row.employee?.lastName}
                    </b>
                    <small>
                      {row.scheduledStart}–{row.scheduledEnd} · {row.branch}
                    </small>
                    <span>
                      <Clock3 size={12} /> {row.checkIn || "—"} →{" "}
                      {row.checkOut || "—"} · {duration(row.workedMinutes)}
                    </span>
                    <em>
                      <ShieldCheck size={11} /> {row.verification.join(" · ")}
                    </em>
                  </div>
                  <Status value={row.status} />
                </article>
              ))}
            </div>
          ) : (
            <Empty
              title="Qaydlar yo‘q"
              text="Bu sana uchun davomat ma’lumoti mavjud emas."
            />
          )}
        </Modal>
      )}
    </div>
  );
}
