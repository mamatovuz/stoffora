import { useEffect, useState } from "react";
import {
  BriefcaseBusiness,
  Camera,
  CheckCircle2,
  KeyRound,
  Network,
  Pencil,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  UserCog,
  XCircle,
} from "lucide-react";
import { del, errorText, post, put } from "../api";
import { useApi } from "../hooks";
import {
  Avatar,
  Confirm,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Person,
  useToast,
} from "../components/ui";
import { roleLabels, useAuth } from "../auth";
import type { Company, Department, Position, Role, User } from "@/lib/types";
import type { Meta } from "../types";
import { resizePhoto } from "./Employees";

/* ----------------------------------------------- departments/positions --- */
export function DirectoryPage({ type }: { type: "departments" | "positions" }) {
  const { data, loading, error, reload } = useApi<Meta>("/meta");
  const [editing, setEditing] = useState<Department | Position | "new" | null>(null);
  const [removing, setRemoving] = useState<Department | Position | null>(null);
  const toast = useToast();
  const isDept = type === "departments";
  const rows = (isDept ? data?.departments : data?.positions) || [];
  const title = isDept ? "Bo‘limlar" : "Lavozimlar";
  const Icon = isDept ? Network : BriefcaseBusiness;
  return (
    <div className="page narrow">
      <PageHeader
        title={title}
        subtitle={isDept ? "Kompaniya tuzilmasi" : "Bo‘limlar bo‘yicha lavozimlar"}
        actions={
          <button
            className="btn btn-primary"
            onClick={() => setEditing("new")}
            disabled={!isDept && !data?.departments.length}
          >
            <Plus size={16} /> Qo‘shish
          </button>
        }
      />
      {!isDept && data && !data.departments.length && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          <Network size={18} />
          <div>
            <b>Avval bo‘lim yarating</b>
            <p>Lavozim bo‘limga biriktiriladi.</p>
          </div>
        </div>
      )}
      <section className="card">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !rows.length ? (
          <Empty
            icon={Icon}
            title={`${title} yo‘q`}
            text={isDept ? "Masalan: Savdo, Buxgalteriya, Ombor." : "Masalan: Sotuvchi, Kassir, Menejer."}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nomi</th>
                  <th>{isDept ? "Rahbar" : "Bo‘lim"}</th>
                  <th>Xodimlar</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <b>{row.name}</b>
                    </td>
                    <td className="muted">
                      {isDept
                        ? (row as Department).manager || "—"
                        : data?.departments.find((d) => d.id === (row as Position).departmentId)?.name}
                    </td>
                    <td className="num">{row.employees ?? 0}</td>
                    <td className="actions">
                      <button className="icon-btn" aria-label="Tahrirlash" onClick={() => setEditing(row)}>
                        <Pencil size={15} />
                      </button>
                      <button className="icon-btn danger" aria-label="O‘chirish" onClick={() => setRemoving(row)}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && (
        <DirectoryForm
          type={type}
          row={editing === "new" ? undefined : editing}
          departments={data?.departments || []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast("Saqlandi");
            void reload(true);
          }}
        />
      )}
      {removing && (
        <Confirm
          title="O‘chirish"
          text={`«${removing.name}» o‘chiriladi.`}
          confirmLabel="O‘chirish"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await del(`/${type}/${removing.id}`);
            toast("O‘chirildi");
            void reload(true);
          }}
        />
      )}
    </div>
  );
}

function DirectoryForm({
  type,
  row,
  departments,
  onClose,
  onSaved,
}: {
  type: "departments" | "positions";
  row?: Department | Position;
  departments: Department[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isDept = type === "departments";
  const [name, setName] = useState(row?.name || "");
  const [manager, setManager] = useState((row as Department)?.manager || "");
  const [departmentId, setDepartmentId] = useState(
    (row as Position)?.departmentId || departments[0]?.id || "",
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = isDept ? { name, manager } : { name, departmentId };
      if (row) await put(`/${type}/${row.id}`, body);
      else await post(`/${type}`, body);
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={row ? "Tahrirlash" : isDept ? "Yangi bo‘lim" : "Yangi lavozim"} onClose={onClose} size="narrow">
      <form onSubmit={save}>
        <Field label="Nomi *">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus />
        </Field>
        {isDept ? (
          <Field label="Rahbar">
            <input className="input" value={manager} onChange={(e) => setManager(e.target.value)} />
          </Field>
        ) : (
          <Field label="Bo‘lim *">
            <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required>
              {departments.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <ErrorBox message={error} />
        <div className="form-actions">
          <button className="btn" type="button" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- roles --- */
const roleRows: [Role, string][] = [
  ["COMPANY_OWNER", "Barcha bo‘limlar, sozlamalar va foydalanuvchilar"],
  ["HR_ADMIN", "Xodimlar, davomat, filiallar, ta’til, e’lonlar va hisobotlar"],
  ["HR_MANAGER", "Xodimlarni qo‘shish/tahrirlash, davomat va ta’tilni tasdiqlash"],
  ["FINANCE", "Ish haqi va hisobotlarni ko‘rish, eksport"],
  ["IT_ADMIN", "Qurilmalar, sozlamalar va audit jurnali"],
  ["BRANCH_MANAGER", "Xodimlar ro‘yxati, davomatni ko‘rish va tuzatish"],
];
export function RolesPage() {
  return (
    <div className="page">
      <PageHeader title="Rollar va ruxsatlar" subtitle="Panel foydalanuvchilarining imkoniyatlari" />
      <div className="role-grid">
        {roleRows.map(([role, text]) => (
          <div className="role-card card" key={role}>
            <b>
              <ShieldCheck size={17} color="var(--brand)" /> {roleLabels[role]}
            </b>
            <p>{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- users --- */
type SafeUser = Omit<User, "passwordHash">;
const assignable: Role[] = ["HR_ADMIN", "HR_MANAGER", "FINANCE", "IT_ADMIN", "BRANCH_MANAGER"];
export function UsersPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi<SafeUser[]>("/users");
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<SafeUser | null>(null);
  const toast = useToast();
  const canManage = user?.role === "COMPANY_OWNER" || user?.role === "HR_ADMIN";
  return (
    <div className="page narrow">
      <PageHeader
        title="Panel foydalanuvchilari"
        subtitle="HR, buxgalter va filial menejerlariga panelga kirish huquqi bering"
        actions={
          canManage && (
            <button className="btn btn-primary" onClick={() => setOpen(true)}>
              <Plus size={16} /> Foydalanuvchi qo‘shish
            </button>
          )
        }
      />
      <section className="card">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="card-body">
            <ErrorBox message={error} />
          </div>
        ) : !data?.length ? (
          <Empty icon={UserCog} />
        ) : (
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>Foydalanuvchi</th>
                  <th>Rol</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Person first={u.name.split(" ")[0]} last={u.name.split(" ")[1]} photo={u.photoDataUrl} sub={u.email} />
                    </td>
                    <td data-label="Rol">
                      <span className={`badge plain ${u.role === "COMPANY_OWNER" ? "green" : "blue"}`}>
                        {roleLabels[u.role]}
                      </span>
                    </td>
                    <td className="actions">
                      {canManage && u.role !== "COMPANY_OWNER" && u.id !== user?.userId && (
                        <button className="icon-btn danger" aria-label="O‘chirish" onClick={() => setRemoving(u)}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open && (
        <UserForm
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            toast("Foydalanuvchi qo‘shildi");
            void reload(true);
          }}
        />
      )}
      {removing && (
        <Confirm
          title="Foydalanuvchini o‘chirish"
          text={`${removing.name} panelga kira olmaydi.`}
          confirmLabel="O‘chirish"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await del(`/users/${removing.id}`);
            toast("O‘chirildi");
            void reload(true);
          }}
        />
      )}
    </div>
  );
}

function UserForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "HR_MANAGER" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await post("/users", form);
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Yangi panel foydalanuvchisi" subtitle="Login ma’lumotlarini xodimga xavfsiz yetkazing" onClose={onClose}>
      <form onSubmit={save}>
        <Field label="F.I.Sh. *">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
        </Field>
        <div className="form-grid">
          <Field label="Email *">
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
          <Field label="Vaqtinchalik parol *" hint="Kamida 10 belgi">
            <input className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={10} autoComplete="new-password" />
          </Field>
        </div>
        <Field label="Rol">
          <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {assignable.map((role) => (
              <option key={role} value={role}>
                {roleLabels[role]}
              </option>
            ))}
          </select>
        </Field>
        <ErrorBox message={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Saqlanmoqda…" : "Qo‘shish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------ settings --- */
type BotStatus = { state: string; mode?: string; username?: string; error?: string; webAppUrl?: string };

export function SettingsPage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const { data, loading, error } = useApi<Company>("/company");
  const { data: bot } = useApi<BotStatus>("/telegram/status");
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Tashkent");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [passwordError, setPasswordError] = useState("");
  useEffect(() => {
    if (data) {
      setName(data.name);
      setTimezone(data.timezone);
    }
  }, [data]);
  if (loading && !data)
    return (
      <div className="page narrow">
        <Loading />
      </div>
    );
  const [first, last] = (user?.name || "?").split(" ");
  return (
    <div className="page narrow">
      <PageHeader title="Sozlamalar" subtitle="Kompaniya, profil va Telegram bot" />
      <div style={{ display: "grid", gap: 16 }}>
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Mening profilim</h2>
              <p>{user?.email}</p>
            </div>
          </div>
          <div className="card-body">
            <div className="photo-picker" style={{ marginBottom: 0 }}>
              <Avatar first={first} last={last} photo={user?.photoDataUrl} size="lg" />
              <div>
                <b>{user?.name}</b>
                <small>{user ? roleLabels[user.role] : ""}</small>
                <label className={`btn btn-sm ${photoBusy ? "disabled" : ""}`}>
                  <Camera size={14} /> {photoBusy ? "Yuklanmoqda…" : "Rasm yuklash"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    disabled={photoBusy}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setPhotoBusy(true);
                      try {
                        await put("/profile/photo", { photoDataUrl: await resizePhoto(file) });
                        await refresh();
                        toast("Rasm yangilandi");
                      } catch (reason) {
                        toast(errorText(reason), "error");
                      } finally {
                        setPhotoBusy(false);
                        event.target.value = "";
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        </section>

        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try {
              await put("/company", { name, timezone });
              toast("Kompaniya sozlamalari saqlandi");
            } catch (reason) {
              toast(errorText(reason), "error");
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="card-head">
            <h2>Kompaniya</h2>
            <span className="badge plain green">{data?.plan} tarif</span>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="Kompaniya nomi">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
              </Field>
              <Field label="Vaqt zonasi" hint="Davomat hisob-kitobi Toshkent vaqtida">
                <select className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  <option>Asia/Tashkent</option>
                  <option>Asia/Samarkand</option>
                </select>
              </Field>
            </div>
            <ErrorBox message={error} />
            <div className="form-actions">
              <button className="btn btn-primary" disabled={saving}>
                <Save size={15} /> Saqlash
              </button>
            </div>
          </div>
        </form>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Telegram bot</h2>
              <p>Xodimlar davomatni shu bot orqali belgilaydi</p>
            </div>
            {bot?.state === "running" ? (
              <span className="badge green live">Ishlayapti</span>
            ) : (
              <span className="badge red">{bot?.state === "disabled" ? "O‘chirilgan" : "Xato"}</span>
            )}
          </div>
          <div className="card-body">
            <div className="kv">
              <div>
                <span>Bot</span>
                <b>
                  {bot?.username ? (
                    <a className="link" href={`https://t.me/${bot.username}`} target="_blank" rel="noreferrer">
                      <Send size={13} /> @{bot.username}
                    </a>
                  ) : (
                    "—"
                  )}
                </b>
              </div>
              <div>
                <span>Rejim</span>
                <b>{bot?.mode === "webhook" ? "Webhook" : bot?.mode === "polling" ? "Polling" : "—"}</b>
              </div>
              <div>
                <span>Mini App manzili</span>
                <b>{bot?.webAppUrl || "—"}</b>
              </div>
            </div>
            {bot?.error && (
              <div className="alert warn" style={{ marginTop: 12 }}>
                <XCircle size={18} />
                <div>
                  <b>Muammo</b>
                  <p>{bot.error}</p>
                </div>
              </div>
            )}
            {bot?.state === "running" && (
              <div className="alert success" style={{ marginTop: 12 }}>
                <CheckCircle2 size={18} />
                <div>
                  <b>Xodimlarni ulash</b>
                  <p>
                    Xodim botda /start bosib telefon raqamini yuboradi — raqam profilidagi
                    bilan mos kelsa avtomatik ulanadi.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            setPasswordError("");
            if (passwords.newPassword !== passwords.confirm) {
              setPasswordError("Yangi parollar bir xil emas.");
              return;
            }
            try {
              await put("/auth/password", {
                currentPassword: passwords.currentPassword,
                newPassword: passwords.newPassword,
              });
              setPasswords({ currentPassword: "", newPassword: "", confirm: "" });
              toast("Parol o‘zgartirildi");
            } catch (reason) {
              setPasswordError(errorText(reason));
            }
          }}
        >
          <div className="card-head">
            <h2>Parolni o‘zgartirish</h2>
            <KeyRound size={17} className="faint" />
          </div>
          <div className="card-body">
            <div className="form-grid cols-3">
              <Field label="Joriy parol">
                <input className="input" type="password" autoComplete="current-password" value={passwords.currentPassword} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} required />
              </Field>
              <Field label="Yangi parol">
                <input className="input" type="password" autoComplete="new-password" minLength={10} value={passwords.newPassword} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} required />
              </Field>
              <Field label="Takrorlang">
                <input className="input" type="password" autoComplete="new-password" minLength={10} value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} required />
              </Field>
            </div>
            <ErrorBox message={passwordError} />
            <div className="form-actions">
              <button className="btn">Parolni yangilash</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
