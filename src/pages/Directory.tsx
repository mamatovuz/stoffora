import { useEffect, useState } from "react";
import { Camera, Check, Plus, Save, ShieldCheck } from "lucide-react";
import { post, put } from "../api";
import { useApi } from "../hooks";
import {
  Empty,
  Avatar,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  Status,
} from "../components/ui";
import { useAuth } from "../auth";
import type { Attendance, Company, Department, Position } from "@/lib/types";
import { monthYearUz } from "@/lib/format";
type Meta = { departments: Department[]; positions: Position[] };
export function DirectoryPage({ type }: { type: "departments" | "positions" }) {
  const { data, loading, error, reload } = useApi<Meta>("/meta"),
    [open, setOpen] = useState(false);
  const rows = type === "departments" ? data?.departments : data?.positions;
  const title = type === "departments" ? "Bo‘limlar" : "Lavozimlar";
  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle={`Kompaniya ${title.toLowerCase()}ini boshqarish`}
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> Qo‘shish
          </button>
        }
      />
      <section className="card">
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} />
        ) : !rows?.length ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nomi</th>
                  <th>{type === "departments" ? "Menejer" : "Bo‘lim"}</th>
                  <th>Xodimlar</th>
                  <th>Holat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <b>{row.name}</b>
                    </td>
                    <td>
                      {type === "departments"
                        ? (row as Department).manager || "—"
                        : data?.departments.find(
                            (d) => d.id === (row as Position).departmentId,
                          )?.name}
                    </td>
                    <td>—</td>
                    <td>
                      <Status value="ACTIVE" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open && (
        <DirectoryForm
          type={type}
          departments={data?.departments || []}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
function DirectoryForm({
  type,
  departments,
  onClose,
  onSaved,
}: {
  type: "departments" | "positions";
  departments: Department[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(""),
    [manager, setManager] = useState(""),
    [departmentId, setDepartmentId] = useState(departments[0]?.id || ""),
    [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post(
        `/${type}`,
        type === "departments" ? { name, manager } : { name, departmentId },
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    }
  }
  return (
    <Modal
      title={type === "departments" ? "Yangi bo‘lim" : "Yangi lavozim"}
      onClose={onClose}
    >
      <form onSubmit={save}>
        <div className="field">
          <label className="label">Nomi</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        {type === "departments" ? (
          <div className="field">
            <label className="label">Menejer</label>
            <input
              className="input"
              value={manager}
              onChange={(e) => setManager(e.target.value)}
            />
          </div>
        ) : (
          <div className="field">
            <label className="label">Bo‘lim</label>
            <select
              className="select"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              {departments.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button className="btn" type="button" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary">Saqlash</button>
        </div>
      </form>
    </Modal>
  );
}
const roleRows = [
  ["COMPANY_OWNER", "Kompaniya egasi", "Barcha bo‘limlar va sozlamalar"],
  ["HR_ADMIN", "HR administrator", "Xodimlar, davomat, ta’til va hisobotlar"],
  ["HR_MANAGER", "HR menejer", "Xodimlarni ko‘rish va tahrirlash"],
  ["FINANCE", "Moliya", "Ish haqi va moliyaviy hisobotlar"],
  ["IT_ADMIN", "IT administrator", "Qurilmalar va tizim sozlamalari"],
  ["BRANCH_MANAGER", "Filial menejeri", "O‘z filialidagi xodimlar va davomat"],
];
export function RolesPage() {
  return (
    <div className="page">
      <PageHeader
        title="Rollar va ruxsatlar"
        subtitle="Foydalanuvchilarning tizim imkoniyatlarini boshqaring"
      />
      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Rol</th>
                <th>Tavsif</th>
                <th>Asosiy ruxsatlar</th>
                <th>Holat</th>
              </tr>
            </thead>
            <tbody>
              {roleRows.map((r) => (
                <tr key={r[0]}>
                  <td>
                    <span className="cell-person">
                      <span
                        style={{
                          width: 34,
                          height: 34,
                          display: "grid",
                          placeItems: "center",
                          background: "var(--brand-soft)",
                          color: "var(--brand)",
                          borderRadius: 7,
                        }}
                      >
                        <ShieldCheck size={17} />
                      </span>
                      <b>{r[0].replaceAll("_", " ")}</b>
                    </span>
                  </td>
                  <td>{r[1]}</td>
                  <td className="subtle">{r[2]}</td>
                  <td>
                    <Status value="ACTIVE" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
export function SettingsPage() {
  const { user, refresh } = useAuth();
  const { data, loading, error } = useApi<Company>("/company"),
    [name, setName] = useState(""),
    [timezone, setTimezone] = useState("Asia/Tashkent"),
    [saved, setSaved] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  useEffect(() => {
    if (data) {
      setName(data.name);
      setTimezone(data.timezone);
    }
  }, [data]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    await put("/company", { name, timezone });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }
  async function uploadProfilePhoto(file?: File) {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError("");
    try {
      const photoDataUrl = await resizeProfilePhoto(file);
      await put("/profile/photo", { photoDataUrl });
      await refresh();
    } catch (reason) {
      setPhotoError(
        reason instanceof Error ? reason.message : "Rasm yuklanmadi.",
      );
    } finally {
      setPhotoBusy(false);
    }
  }
  if (loading)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <PageHeader
        title="Kompaniya sozlamalari"
        subtitle="Asosiy parametrlar va lokalizatsiya"
      />
      <section className="card settings-profile-card">
        <Avatar
          first={user?.name.split(" ")[0] || "?"}
          last={user?.name.split(" ")[1]}
          photo={user?.photoDataUrl}
        />
        <div>
          <h2>Panel profil rasmi</h2>
          <p>
            Bosh harflar o‘rniga panel menyusi va yuqori qismida shu rasm
            ko‘rinadi.
          </p>
          {photoError && <span className="field-error">{photoError}</span>}
        </div>
        <label className={`btn ${photoBusy ? "disabled" : ""}`}>
          <Camera size={16} /> {photoBusy ? "Tayyorlanmoqda…" : "Rasm yuklash"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            disabled={photoBusy}
            onChange={(event) =>
              void uploadProfilePhoto(event.target.files?.[0])
            }
          />
        </label>
      </section>
      <form className="card" onSubmit={save}>
        <div className="section-head">
          <h2>Asosiy ma’lumotlar</h2>
        </div>
        <div className="section-body">
          <div className="form-grid">
            <div className="field">
              <label className="label">Kompaniya nomi</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label className="label">Vaqt zonasi</label>
              <select
                className="select"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                <option>Asia/Tashkent</option>
                <option>Asia/Almaty</option>
                <option>Europe/Moscow</option>
              </select>
            </div>
            <div className="field">
              <label className="label">Standart til</label>
              <select className="select">
                <option>O‘zbekcha</option>
                <option>Русский</option>
                <option>English</option>
              </select>
            </div>
            <div className="field">
              <label className="label">Joriy reja</label>
              <input className="input" value={data?.plan || ""} disabled />
            </div>
          </div>
          {error && <ErrorBox message={error} />}
          <div className="form-actions">
            {saved && (
              <span style={{ color: "var(--brand)", alignSelf: "center" }}>
                <Check size={15} style={{ display: "inline" }} /> Saqlandi
              </span>
            )}
            <button className="btn btn-primary">
              <Save size={15} /> Saqlash
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

async function resizeProfilePhoto(file: File) {
  if (file.size > 8 * 1024 * 1024)
    throw new Error("Rasm hajmi 8 MB dan oshmasin.");
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Rasmni o‘qib bo‘lmadi."));
    reader.onload = () => {
      const element = new Image();
      element.onerror = () =>
        reject(new Error("Rasm formati qo‘llab quvvatlanmaydi."));
      element.onload = () => resolve(element);
      element.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Rasmni tayyorlab bo‘lmadi.");
  context.drawImage(
    image,
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    512,
    512,
  );
  return canvas.toDataURL("image/jpeg", 0.82);
}
export function CalendarPage() {
  const { data, loading, error } =
    useApi<
      (Attendance & { employee?: { firstName: string; lastName: string } })[]
    >("/attendance");
  const today = new Date(),
    year = today.getFullYear(),
    month = today.getMonth(),
    count = new Date(year, month + 1, 0).getDate();
  const grouped = new Map<string, Attendance[]>();
  data?.forEach((a) =>
    grouped.set(a.date, [...(grouped.get(a.date) || []), a]),
  );
  return (
    <div className="page">
      <PageHeader title="Davomat kalendari" subtitle={monthYearUz(today)} />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : (
        <div className="calendar-grid">
          {Array.from({ length: count }, (_, i) => {
            const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
              rows = grouped.get(date) || [];
            return (
              <div
                className={`calendar-day ${i + 1 === today.getDate() ? "today" : ""}`}
                key={i}
              >
                <span>{i + 1}</span>
                <div style={{ marginTop: 12, fontSize: 11 }}>
                  {rows.length ? (
                    <>
                      <b>
                        {rows.filter((x) => x.status !== "ABSENT").length}{" "}
                        kelgan
                      </b>
                      <small
                        className="subtle"
                        style={{ display: "block", marginTop: 5 }}
                      >
                        {rows.filter((x) => x.status === "LATE").length}{" "}
                        kechikkan
                      </small>
                    </>
                  ) : (
                    <small className="subtle">Ma’lumot yo‘q</small>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
