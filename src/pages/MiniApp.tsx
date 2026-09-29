import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Home,
  LoaderCircle,
  MapPin,
  QrCode,
  Send,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { api, post } from "../api";
import { FaceScanner } from "../components/FaceScanner";
import {
  dateLongUz,
  dateParts,
  dateUz,
  duration,
  monthShortUz,
  tashkentWeekday,
} from "@/lib/format";
import { haversineDistance } from "@/lib/attendance";
import type {
  Attendance,
  Branch,
  Company,
  Department,
  Employee,
  LeaveRequest,
  Notification,
  Position,
  Schedule,
} from "@/lib/types";
import stafforaMark from "../assets/staffora-mark.svg";

type HomeData = {
  employee: Employee;
  company: Company;
  branch: Branch;
  department: Department;
  position: Position;
  schedule: Schedule;
  attendance?: Attendance;
  notifications: Notification[];
};
type Tab = "home" | "attendance" | "leave" | "profile";

export function MiniAppPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState("");
  const [home, setHome] = useState<HomeData | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState<{
    sessionId: string;
    action: "CHECK_IN" | "CHECK_OUT";
  } | null>(null);
  const [faceAction, setFaceAction] = useState<"CHECK_IN" | "CHECK_OUT" | null>(
    null,
  );
  const [toast, setToast] = useState("");

  async function loadHome() {
    setHome(await api<HomeData>("/mini/home"));
  }
  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    webApp?.ready();
    webApp?.expand();
    document.documentElement.dataset.telegramTheme =
      webApp?.colorScheme || "light";
    void (async () => {
      try {
        await post("/telegram/auth", { initData: webApp?.initData || "" });
        setAuthenticated(true);
        await loadHome();
      } catch (reason) {
        setAuthError(
          reason instanceof Error ? reason.message : "Kirish amalga oshmadi.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function beginAttendance(action: "CHECK_IN" | "CHECK_OUT") {
    window.Telegram?.WebApp.HapticFeedback?.impactOccurred("medium");
    setFaceAction(action);
  }
  if (loading)
    return (
      <div className="mini-splash">
        <img className="mini-logo" src={stafforaMark} alt="STAFFORA" />
        <LoaderCircle className="spin" size={24} />
      </div>
    );
  if (authError || !authenticated || !home)
    return (
      <div className="mini-splash mini-error">
        <img className="mini-logo" src={stafforaMark} alt="STAFFORA" />
        <h1>Hisob ulanmagan</h1>
        <p>{authError || "Telegram orqali qayta oching."}</p>
        <button
          className="mini-primary"
          onClick={() => window.Telegram?.WebApp.close()}
        >
          Botga qaytish
        </button>
      </div>
    );
  return (
    <main className="mini-app">
      <header className="mini-header">
        <div>
          <span className="mini-brand">
            <img src={stafforaMark} alt="" /> STAFFORA
          </span>
          <small>{home.company.name}</small>
          <b>Salom, {home.employee.firstName} 👋</b>
        </div>
        <span className="mini-avatar">
          {home.employee.photoDataUrl ? (
            <img src={home.employee.photoDataUrl} alt="" />
          ) : (
            <>
              {home.employee.firstName[0]}
              {home.employee.lastName[0]}
            </>
          )}
        </span>
      </header>
      <div className="mini-content">
        {tab === "home" && (
          <MiniHome data={home} onAction={beginAttendance} onTab={setTab} />
        )}
        {tab === "attendance" && <MiniAttendance />}
        {tab === "leave" && <MiniLeave />}
        {tab === "profile" && <MiniProfile data={home} />}
      </div>
      <nav className="mini-nav">
        <MiniNavButton
          icon={Home}
          label="Bosh sahifa"
          active={tab === "home"}
          onClick={() => setTab("home")}
        />
        <MiniNavButton
          icon={Clock3}
          label="Davomat"
          active={tab === "attendance"}
          onClick={() => setTab("attendance")}
        />
        <MiniNavButton
          icon={CalendarDays}
          label="Ta’til"
          active={tab === "leave"}
          onClick={() => setTab("leave")}
        />
        <MiniNavButton
          icon={UserRound}
          label="Profil"
          active={tab === "profile"}
          onClick={() => setTab("profile")}
        />
      </nav>
      {faceAction && (
        <FaceScanner
          enrolled={Boolean(home.employee.faceEnrolledAt)}
          onClose={() => setFaceAction(null)}
          onVerified={async (faceProof) => {
            try {
              const action = faceAction;
              const session = await post<{ id: string }>(
                "/mini/attendance/session",
                { action, faceProof },
              );
              setFaceAction(null);
              await loadHome();
              setScan({ sessionId: session.id, action });
            } catch (reason) {
              setToast(
                reason instanceof Error ? reason.message : "Amal bajarilmadi.",
              );
              throw reason;
            }
          }}
        />
      )}
      {scan && (
        <QrScanner
          session={scan}
          branch={home.branch}
          onClose={() => setScan(null)}
          onSuccess={async (message) => {
            setScan(null);
            setToast(message);
            window.Telegram?.WebApp.HapticFeedback?.notificationOccurred(
              "success",
            );
            await loadHome();
          }}
        />
      )}
      {toast && (
        <button className="mini-toast" onClick={() => setToast("")}>
          <CheckCircle2 size={20} />
          <span>
            <b>Muvaffaqiyatli</b>
            <small>{toast}</small>
          </span>
        </button>
      )}
    </main>
  );
}

function MiniHome({
  data,
  onAction,
  onTab,
}: {
  data: HomeData;
  onAction: (action: "CHECK_IN" | "CHECK_OUT") => void;
  onTab: (tab: Tab) => void;
}) {
  const attendance = data.attendance;
  const isWorking = Boolean(attendance?.checkIn && !attendance.checkOut);
  const finished = Boolean(attendance?.checkOut);
  const today = data.schedule.days.find((day) => day.day === tashkentWeekday());
  const worked = attendance?.checkIn
    ? Math.max(
        0,
        Math.floor(
          (Date.now() -
            new Date(
              `${attendance.date}T${attendance.checkIn}:00+05:00`,
            ).getTime()) /
            60000,
        ),
      )
    : 0;
  return (
    <>
      <section className={`mini-attendance-card ${isWorking ? "working" : ""}`}>
        <div className="mini-card-top">
          <span>
            <i />
            {finished
              ? "Bugungi ish yakunlandi"
              : isWorking
                ? "Ishlamoqdasiz"
                : "Ish boshlanmagan"}
          </span>
          <small>{dateLongUz(new Date())}</small>
        </div>
        <div className="mini-time-row">
          <div>
            <small>Grafik</small>
            <b>
              {today?.enabled ? `${today.start} – ${today.end}` : "Dam olish"}
            </b>
          </div>
          <div>
            <small>Kelish</small>
            <b>{attendance?.checkIn || "—"}</b>
          </div>
          {isWorking && (
            <div>
              <small>Ishlagan</small>
              <b>{duration(worked)}</b>
            </div>
          )}
        </div>
        {!finished ? (
          <button
            className="mini-action"
            onClick={() => onAction(isWorking ? "CHECK_OUT" : "CHECK_IN")}
          >
            {isWorking ? "ISHDAN CHIQISH" : "ISHGA KELISH"}
            <ChevronRight size={20} />
          </button>
        ) : (
          <div className="mini-complete">
            <CheckCircle2 size={19} /> {attendance?.checkIn} –{" "}
            {attendance?.checkOut}
          </div>
        )}
        <div className="mini-verify">
          <ShieldCheck size={14} /> Face ID + GPS + dinamik QR bilan
          himoyalangan
        </div>
      </section>
      <section className="mini-section">
        <h2>Bugungi ma’lumot</h2>
        <div className="mini-info-list">
          <div>
            <span className="mini-icon">
              <Building2 size={18} />
            </span>
            <span>
              <small>Filial</small>
              <b>{data.branch.name}</b>
            </span>
          </div>
          <div>
            <span className="mini-icon">
              <MapPin size={18} />
            </span>
            <span>
              <small>Manzil</small>
              <b>{data.branch.address}</b>
            </span>
          </div>
        </div>
      </section>
      <section className="mini-quick-actions" aria-label="Tezkor amallar">
        <button onClick={() => onTab("attendance")}>
          <Clock3 size={19} />
          <span>Davomat</span>
        </button>
        <button onClick={() => onTab("leave")}>
          <CalendarDays size={19} />
          <span>Ta’til</span>
        </button>
        <button onClick={() => onTab("profile")}>
          <UserRound size={19} />
          <span>Profil</span>
        </button>
      </section>
      {data.notifications.length > 0 && (
        <section className="mini-section">
          <div className="mini-section-head">
            <h2>Bildirishnomalar</h2>
            <Bell size={18} />
          </div>
          {data.notifications.slice(0, 2).map((item) => (
            <div className="mini-notification" key={item.id}>
              <b>{item.title}</b>
              <p>{item.body}</p>
            </div>
          ))}
        </section>
      )}
      <button className="mini-link-row" onClick={() => onTab("attendance")}>
        <span>Davomat tarixini ko‘rish</span>
        <ChevronRight size={18} />
      </button>
    </>
  );
}

function MiniAttendance() {
  const [rows, setRows] = useState<Attendance[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void api<Attendance[]>("/mini/attendance")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  const stats = useMemo(
    () => ({
      days: rows?.length || 0,
      late: rows?.filter((item) => item.lateMinutes > 0).length || 0,
      hours: Math.round(
        (rows?.reduce((sum, item) => sum + item.workedMinutes, 0) || 0) / 60,
      ),
    }),
    [rows],
  );
  return (
    <>
      <div className="mini-page-title">
        <h1>Davomat</h1>
        <p>Ish vaqtingiz tarixi</p>
      </div>
      <div className="mini-stats">
        <div>
          <b>{stats.days}</b>
          <small>Ish kuni</small>
        </div>
        <div>
          <b>{stats.late}</b>
          <small>Kechikish</small>
        </div>
        <div>
          <b>{stats.hours}s</b>
          <small>Ishlangan</small>
        </div>
      </div>
      {error && <p className="mini-inline-error">{error}</p>}
      <section className="mini-list">
        {rows === null ? (
          <MiniLoader />
        ) : rows.length === 0 ? (
          <MiniEmpty text="Davomat tarixi yo‘q" />
        ) : (
          rows.map((item) => (
            <article key={item.id}>
              <div className="mini-date">
                <b>{dateParts(item.date).day}</b>
                <small>{monthShortUz(item.date)}</small>
              </div>
              <div className="mini-list-main">
                <b>
                  {item.checkIn || "—"} → {item.checkOut || "—"}
                </b>
                <small>
                  {item.lateMinutes
                    ? `${item.lateMinutes} daqiqa kechikdi`
                    : "Vaqtida"}
                </small>
              </div>
              <span
                className={`mini-status ${item.lateMinutes ? "late" : "ok"}`}
              >
                {item.status === "ABSENT"
                  ? "Kelmagan"
                  : item.checkOut
                    ? "Tugadi"
                    : "Ishda"}
              </span>
            </article>
          ))
        )}
      </section>
    </>
  );
}

function MiniLeave() {
  const [rows, setRows] = useState<LeaveRequest[] | null>(null);
  const [open, setOpen] = useState(false);
  const load = () => api<LeaveRequest[]>("/mini/leave").then(setRows);
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <div className="mini-page-title">
        <h1>Ta’til</h1>
        <p>So‘rovlar va ularning holati</p>
      </div>
      <button className="mini-primary" onClick={() => setOpen(true)}>
        <CalendarDays size={18} /> Yangi so‘rov
      </button>
      <section className="mini-list mini-leave-list">
        {rows === null ? (
          <MiniLoader />
        ) : rows.length === 0 ? (
          <MiniEmpty text="Ta’til so‘rovlari yo‘q" />
        ) : (
          rows.map((item) => (
            <article key={item.id}>
              <span className="mini-icon">
                <CalendarDays size={18} />
              </span>
              <div className="mini-list-main">
                <b>{leaveType(item.type)}</b>
                <small>
                  {dateUz(item.startDate)} – {dateUz(item.endDate)}
                </small>
              </div>
              <span className={`mini-status ${item.status.toLowerCase()}`}>
                {leaveStatus(item.status)}
              </span>
            </article>
          ))
        )}
      </section>
      {open && (
        <LeaveSheet
          onClose={() => setOpen(false)}
          onSaved={async () => {
            setOpen(false);
            await load();
          }}
        />
      )}
    </>
  );
}

function MiniProfile({ data }: { data: HomeData }) {
  return (
    <>
      <div className="mini-profile-head">
        <span className="mini-profile-avatar">
          {data.employee.photoDataUrl ? (
            <img src={data.employee.photoDataUrl} alt="" />
          ) : (
            <>
              {data.employee.firstName[0]}
              {data.employee.lastName[0]}
            </>
          )}
        </span>
        <h1>
          {data.employee.firstName} {data.employee.lastName}
        </h1>
        <p>
          {data.position.name} · {data.employee.employeeNo}
        </p>
      </div>
      <section className="mini-section mini-profile-section">
        <h2>Ish ma’lumotlari</h2>
        <ProfileRow label="Bo‘lim" value={data.department.name} />
        <ProfileRow label="Filial" value={data.branch.name} />
        <ProfileRow label="Ish grafigi" value={data.schedule.name} />
        <ProfileRow
          label="Ish boshlagan"
          value={dateUz(data.employee.startDate)}
        />
      </section>
      <section className="mini-section mini-profile-section">
        <h2>Aloqa</h2>
        <ProfileRow label="Telefon" value={data.employee.phone} />
        <ProfileRow label="Email" value={data.employee.email} />
        <ProfileRow
          label="Telegram"
          value={data.employee.telegramConnected ? "Ulangan ✓" : "Ulanmagan"}
        />
        <ProfileRow label="Qurilma" value={data.employee.deviceStatus} />
        <ProfileRow
          label="Face ID"
          value={
            data.employee.faceEnrolledAt
              ? `Faol · ${dateUz(data.employee.faceEnrolledAt)}`
              : "Sozlanmagan"
          }
        />
      </section>
    </>
  );
}

function QrScanner({
  session,
  branch,
  onClose,
  onSuccess,
}: {
  session: { sessionId: string; action: string };
  branch: Branch;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locationReady, setLocationReady] = useState(false);
  const locationRef = useRef<GeolocationPosition | null>(null);
  const completed = useRef(false);
  async function commit(qrToken: string) {
    if (completed.current || busy) return;
    completed.current = true;
    setBusy(true);
    setError("");
    try {
      const location = locationRef.current;
      if (!location) throw new Error("Joylashuv hali tasdiqlanmadi.");
      const row = await post<Attendance>("/mini/attendance/commit", {
        sessionId: session.sessionId,
        qrToken,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      onSuccess(
        `${session.action === "CHECK_IN" ? "Ishga kelish" : "Ishdan chiqish"} ${row.checkOut || row.checkIn} da qayd etildi.`,
      );
    } catch (reason) {
      completed.current = false;
      setError(
        isGeolocationError(reason)
          ? "Joylashuvni aniqlashga ruxsat bering."
          : reason instanceof Error
            ? reason.message
            : "Tekshiruv amalga oshmadi.",
      );
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let stream: MediaStream | undefined, timer: number | undefined;
    void (async () => {
      try {
        const location = await new Promise<GeolocationPosition>(
          (resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 0,
            }),
        );
        const distance = haversineDistance(
          location.coords.latitude,
          location.coords.longitude,
          branch.latitude,
          branch.longitude,
        );
        if (distance > branch.radiusMeters)
          throw new Error(`Filial hududidan ${distance} metr uzoqdasiz.`);
        locationRef.current = location;
        setLocationReady(true);
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (window.BarcodeDetector) {
          const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
          timer = window.setInterval(async () => {
            if (!videoRef.current || completed.current) return;
            const codes = await detector.detect(videoRef.current);
            if (codes[0]?.rawValue) void commit(codes[0].rawValue);
          }, 500);
        }
      } catch (reason) {
        if (isGeolocationError(reason)) {
          setError("Joylashuvni aniqlashga ruxsat bering.");
          return;
        }
        if (
          reason instanceof Error &&
          reason.message.includes("Filial hududidan")
        ) {
          setError(reason.message);
          return;
        }
        setError("Kamerani ochib bo‘lmadi. Quyida QR tokenni kiriting.");
      }
    })();
    return () => {
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  return (
    <div className="mini-sheet-layer">
      <button className="mini-sheet-backdrop" onClick={onClose} />
      <section className="mini-sheet scanner-sheet">
        <div className="mini-sheet-head">
          <div>
            <b>QR kodni skanerlang</b>
            <small>Filial ekranidagi dinamik QR</small>
          </div>
          <button onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="attendance-steps">
          <span className="done">
            <i>1</i>
            <b>Face ID</b>
            <small>Tasdiqlandi</small>
          </span>
          <span className="done">
            <i>2</i>
            <b>Filial</b>
            <small>{branch.name}</small>
          </span>
          <span className={locationReady ? "done" : "active"}>
            <i>3</i>
            <b>GPS</b>
            <small>
              {locationReady ? "Hudud tasdiqlandi" : "Tekshirilmoqda"}
            </small>
          </span>
          <span
            className={locationReady && !busy ? "active" : busy ? "done" : ""}
          >
            <i>4</i>
            <b>QR</b>
            <small>{busy ? "O‘qildi" : "Skanerlang"}</small>
          </span>
          <span className={busy ? "active" : ""}>
            <i>5</i>
            <b>Server</b>
            <small>{busy ? "Tekshirilmoqda" : "Kutilmoqda"}</small>
          </span>
        </div>
        <div className="scanner-view">
          <video ref={videoRef} muted playsInline />
          <div className="scanner-frame">
            <i />
            <i />
            <i />
            <i />
          </div>
          {busy && (
            <div className="scanner-busy">
              <LoaderCircle className="spin" />
              Tekshirilmoqda...
            </div>
          )}
        </div>
        <div className="mini-security">
          <ShieldCheck size={17} />
          <span>
            GPS joylashuvingiz va bir martalik QR serverda tekshiriladi.
          </span>
        </div>
        {error && <p className="mini-inline-error">{error}</p>}
        <details className="mini-manual">
          <summary>Kamera ishlamasa</summary>
          <textarea
            placeholder="QR token"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button
            className="mini-primary"
            disabled={manual.length < 20 || busy}
            onClick={() => void commit(manual)}
          >
            Tekshirish
          </button>
        </details>
      </section>
    </div>
  );
}

function LeaveSheet({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    type: "VACATION",
    startDate: today,
    endDate: today,
    reason: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await post("/mini/leave", form);
      onSaved();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "So‘rov yuborilmadi.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mini-sheet-layer">
      <button className="mini-sheet-backdrop" onClick={onClose} />
      <section className="mini-sheet">
        <div className="mini-sheet-head">
          <div>
            <b>Ta’til so‘rovi</b>
            <small>HR ko‘rib chiqishi uchun</small>
          </div>
          <button onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={save}>
          <label>
            Ta’til turi
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="VACATION">Mehnat ta’tili</option>
              <option value="SICK">Kasallik</option>
              <option value="PERMISSION">Ruxsat</option>
              <option value="UNPAID">Haq to‘lanmaydi</option>
              <option value="OTHER">Boshqa</option>
            </select>
          </label>
          <div className="mini-form-grid">
            <label>
              Boshlanish
              <input
                type="date"
                value={form.startDate}
                onChange={(e) =>
                  setForm({ ...form, startDate: e.target.value })
                }
              />
            </label>
            <label>
              Tugash
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </label>
          </div>
          <label>
            Sabab
            <textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              required
              minLength={3}
            />
          </label>
          {error && <p className="mini-inline-error">{error}</p>}
          <button className="mini-primary" disabled={busy}>
            <Send size={17} />
            {busy ? "Yuborilmoqda..." : "So‘rovni yuborish"}
          </button>
        </form>
      </section>
    </div>
  );
}

function MiniNavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Home;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      <Icon size={20} />
      <span>{label}</span>
    </button>
  );
}
function MiniLoader() {
  return (
    <div className="mini-loader">
      <LoaderCircle className="spin" />
    </div>
  );
}
function MiniEmpty({ text }: { text: string }) {
  return (
    <div className="mini-empty">
      <CalendarDays size={28} />
      <p>{text}</p>
    </div>
  );
}
function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-profile-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
const leaveType = (value: string) =>
  ({
    VACATION: "Mehnat ta’tili",
    SICK: "Kasallik",
    PERMISSION: "Ruxsat",
    UNPAID: "Haq to‘lanmaydi",
    OTHER: "Boshqa",
  })[value] || value;
const leaveStatus = (value: string) =>
  ({
    PENDING: "Kutilmoqda",
    APPROVED: "Tasdiqlandi",
    REJECTED: "Rad etildi",
    CANCELLED: "Bekor qilindi",
  })[value] || value;

function isGeolocationError(value: unknown): value is GeolocationPositionError {
  return typeof value === "object" && value !== null && "code" in value;
}
