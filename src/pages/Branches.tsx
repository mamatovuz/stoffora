import { useState } from "react";
import { ManagerPicker, type Picked } from "../components/ManagerPicker";
import { Link } from "react-router-dom";
import {
  Building2,
  Crosshair,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  QrCode,
  ScanFace,
  Trash2,
} from "lucide-react";
import { del, errorText, post, put } from "../api";
import { useApi } from "../hooks";
import {
  Confirm,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Status,
  useToast,
} from "../components/ui";
import type { Branch, Schedule } from "@/lib/types";

type BranchRow = Branch & { employees: number; presentToday: number };

export function BranchesPage() {
  const { data, loading, error, reload } = useApi<BranchRow[]>("/branches");
  const { data: schedules } = useApi<Schedule[]>("/schedules");
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const [removing, setRemoving] = useState<Branch | null>(null);
  const toast = useToast();
  return (
    <div className="page">
      <PageHeader
        title="Filiallar"
        subtitle="Ish joylari, GPS hududlari va davomat ekranlari"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus size={16} /> Filial qo‘shish
          </button>
        }
      />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : !data?.length ? (
        <section className="card">
          <Empty
            icon={Building2}
            title="Hali filial yo‘q"
            text="Filial — xodimlar davomat belgilaydigan joy. Manzil va GPS nuqtasini kiriting."
            action={
              <button className="btn btn-primary" onClick={() => setEditing("new")}>
                <Plus size={16} /> Birinchi filialni qo‘shish
              </button>
            }
          />
        </section>
      ) : (
        <div className="grid-cards">
          {data.map((b) => (
            <article className="card branch-card" key={b.id}>
              <div className="card-body">
                <div className="branch-top">
                  <span className="branch-icon">
                    <Building2 size={21} />
                  </span>
                  <Status value={b.status} />
                </div>
                <h3>{b.name}</h3>
                <p className="address">
                  <MapPin size={14} /> {b.address}
                </p>
                <div className="branch-stats">
                  <div>
                    <small>Xodimlar</small>
                    <b>{b.employees}</b>
                  </div>
                  <div>
                    <small>Bugun keldi</small>
                    <b>{b.presentToday}</b>
                  </div>
                  <div>
                    <small>Radius</small>
                    <b>{b.radiusMeters} m</b>
                  </div>
                </div>
                <div className="tags" style={{ marginTop: 12 }}>
                  <span className="tag">
                    <ScanFace size={11} /> Face ID
                  </span>
                  <span className="tag">
                    <MapPin size={11} /> GPS
                  </span>
                  {(b.attendanceMode || "QR_GPS_FACE") === "QR_GPS_FACE" && (
                    <span className="tag">
                      <QrCode size={11} /> Dinamik QR
                    </span>
                  )}
                  {b.manager && <span className="tag">Filial rahbari: {b.manager}</span>}
                </div>
              </div>
              <div className="card-foot">
                <a
                  className="link"
                  href={`https://www.google.com/maps?q=${b.latitude},${b.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Xarita <ExternalLink size={12} />
                </a>
                <div className="toolbar">
                  <button className="icon-btn" aria-label="Tahrirlash" onClick={() => setEditing(b)}>
                    <Pencil size={15} />
                  </button>
                  <button className="icon-btn danger" aria-label="O‘chirish" onClick={() => setRemoving(b)}>
                    <Trash2 size={15} />
                  </button>
                  {(b.attendanceMode || "QR_GPS_FACE") === "QR_GPS_FACE" && (
                    <Link className="btn btn-sm" to={`/attendance-screen/${b.id}`} target="_blank">
                      <QrCode size={14} /> QR ekran
                    </Link>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <BranchForm
          branch={editing === "new" ? undefined : editing}
          schedules={schedules || []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast(editing === "new" ? "Filial yaratildi" : "Filial saqlandi");
            setEditing(null);
            void reload(true);
          }}
        />
      )}
      {removing && (
        <Confirm
          title="Filialni o‘chirish"
          text={`«${removing.name}» o‘chiriladi. Filialda xodim bo‘lsa, avval ularni boshqa filialga o‘tkazing.`}
          confirmLabel="O‘chirish"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await del(`/branches/${removing.id}`);
            toast("Filial o‘chirildi");
            void reload(true);
          }}
        />
      )}
    </div>
  );
}

function BranchForm({
  branch,
  schedules,
  onClose,
  onSaved,
}: {
  branch?: Branch;
  schedules: Schedule[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: branch?.name || "",
    address: branch?.address || "",
    latitude: branch ? String(branch.latitude) : "",
    longitude: branch ? String(branch.longitude) : "",
    radiusMeters: branch?.radiusMeters || 150,
    manager: branch?.manager || "",
    scheduleId: branch?.scheduleId || schedules[0]?.id || "",
    status: branch?.status || "ACTIVE",
    attendanceMode: branch?.attendanceMode || "QR_GPS_FACE",
    requiredStaff: branch?.requiredStaff || 0,
  });
  // Filial rahbarlari (xodimlar): nomlar «manager» matnidan (server shu tartibda yozadi).
  const [managers, setManagers] = useState<Picked[]>(() => {
    const names = (branch?.manager || "").split(", ");
    return (branch?.managerEmployeeIds || []).map((id, i) => ({ id, name: names[i] || "Xodim" }));
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const set = (k: keyof typeof form, v: string | number) =>
    setForm((f) => ({ ...f, [k]: v }));

  function locate() {
    if (!navigator.geolocation) {
      setError("Brauzer joylashuvni aniqlay olmaydi.");
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((f) => ({
          ...f,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        }));
        setLocating(false);
      },
      () => {
        setError("Joylashuvga ruxsat berilmadi. Koordinatalarni qo‘lda kiriting.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const latitude = Number(form.latitude.replace(",", "."));
    const longitude = Number(form.longitude.replace(",", "."));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (!latitude && !longitude)) {
      setError("GPS koordinatalarini kiriting yoki «Joriy joylashuv» tugmasini bosing.");
      return;
    }
    setSaving(true);
    try {
      const body = { ...form, latitude, longitude, managerEmployeeIds: managers.map((m) => m.id), manager: managers.length ? form.manager : "" };
      if (branch) await put(`/branches/${branch.id}`, body);
      else await post("/branches", body);
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={branch ? "Filialni tahrirlash" : "Yangi filial"}
      subtitle="Xodimlar faqat shu hudud ichida davomat belgilay oladi"
      onClose={onClose}
    >
      <form onSubmit={save}>
        <div className="form-grid">
          <Field label="Filial nomi *">
            <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} required minLength={2} placeholder="Bosh ofis" />
          </Field>
          <Field label="Smenaga kerakli xodimlar soni" hint="Ertangi smena tayyorligini tekshirish uchun (0 — belgilanmagan)">
            <input className="input" type="number" min={0} max={1000} value={form.requiredStaff || ""} onChange={(e) => set("requiredStaff", Number(e.target.value) || 0)} placeholder="Masalan: 22" />
          </Field>
          <Field label="Filial rahbari" hint="Tanlangan xodim filial rahbari bo‘ladi: ilova va Mini App’da o‘z filiali xodimlarini, davomatini ko‘radi, jarima taklif qiladi">
            <ManagerPicker value={managers} onChange={setManagers} />
          </Field>
          <Field label="Manzil *" className="span-2">
            <input className="input" value={form.address} onChange={(e) => set("address", e.target.value)} required minLength={3} placeholder="Shahar, ko‘cha, uy" />
          </Field>
        </div>
        <div className="form-section-title">GPS hudud</div>
        <div className="form-grid cols-3">
          <Field label="Kenglik (lat)">
            <input className="input" inputMode="decimal" value={form.latitude} onChange={(e) => set("latitude", e.target.value)} placeholder="41.311081" required />
          </Field>
          <Field label="Uzunlik (lng)">
            <input className="input" inputMode="decimal" value={form.longitude} onChange={(e) => set("longitude", e.target.value)} placeholder="69.240562" required />
          </Field>
          <Field label="Radius (metr)" hint="10 – 10 000 m. Tavsiya: bino uchun 100–200 m">
            <input className="input" type="number" min={10} max={10000} step={10} value={form.radiusMeters} onChange={(e) => set("radiusMeters", Number(e.target.value))} />
          </Field>
        </div>
        <div className="toolbar" style={{ marginTop: -4, marginBottom: 14 }}>
          <button type="button" className="btn btn-sm" onClick={locate} disabled={locating}>
            {locating ? <LoaderCircle size={14} className="spin" /> : <Crosshair size={14} />}
            Joriy joylashuvimni olish
          </button>
          {form.latitude && form.longitude && (
            <a
              className="link"
              href={`https://www.google.com/maps?q=${form.latitude},${form.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              Xaritada tekshirish <ExternalLink size={12} />
            </a>
          )}
        </div>
        <div className="form-section-title">Davomat usuli</div>
        <div className="mode-options" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={`mode-option ${form.attendanceMode === "QR_GPS_FACE" ? "active" : ""}`}
            onClick={() => set("attendanceMode", "QR_GPS_FACE")}
          >
            <b>
              <QrCode size={15} /> Face ID + GPS + QR
            </b>
            <small>Eng xavfsiz. Filialda planshet/ekranda dinamik QR turadi.</small>
          </button>
          <button
            type="button"
            className={`mode-option ${form.attendanceMode === "GPS_FACE" ? "active" : ""}`}
            onClick={() => set("attendanceMode", "GPS_FACE")}
          >
            <b>
              <ScanFace size={15} /> Face ID + GPS
            </b>
            <small>QR ekran shart emas. Yuz va joylashuv yetarli.</small>
          </button>
        </div>
        <div className="form-grid">
          <Field label="Standart grafik">
            <select className="select" value={form.scheduleId} onChange={(e) => set("scheduleId", e.target.value)}>
              <option value="">—</option>
              {schedules.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Holat">
            <select className="select" value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="ACTIVE">Faol</option>
              <option value="INACTIVE">Nofaol</option>
            </select>
          </Field>
        </div>
        <ErrorBox message={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Saqlanmoqda…" : branch ? "Saqlash" : "Filialni yaratish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
