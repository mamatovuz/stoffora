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
            text={isDept ? "Masalan: Savdo, Buxgalteriya, Ombor." : "Masalan: Sotuvchi, Kassir, Omborchi."}
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
  const [editing, setEditing] = useState<SafeUser | null>(null);
  const toast = useToast();
  const canManage = user?.role === "COMPANY_OWNER" || user?.role === "HR_ADMIN";
  return (
    <div className="page narrow">
      <PageHeader
        title="Panel foydalanuvchilari"
        subtitle="HR, buxgalter va filial rahbarlariga panelga kirish huquqi bering"
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
                      {canManage && (
                        <button className="icon-btn" aria-label="Tahrirlash" onClick={() => setEditing(u)}>
                          <Pencil size={15} />
                        </button>
                      )}
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
      {editing && (
        <EditUserForm
          user={editing}
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


function EditUserForm({
  user,
  onClose,
  onSaved,
}: {
  user: SafeUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { refresh, user: me } = useAuth();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const owner = user.role === "COMPANY_OWNER";
  return (
    <Modal title="Foydalanuvchini tahrirlash" subtitle={user.email} onClose={onClose} size="narrow">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            await put(`/users/${user.id}`, owner ? { name } : { name, role });
            if (me?.userId === user.id) await refresh();
            onSaved();
          } catch (reason) {
            setError(errorText(reason));
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Ism familiya">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={80} autoFocus />
        </Field>
        <Field label="Rol" hint={owner ? "Kompaniya egasining roli o‘zgarmaydi" : undefined}>
          <select className="select" value={role} disabled={owner} onChange={(e) => setRole(e.target.value as Role)}>
            {(owner ? ["COMPANY_OWNER" as Role] : assignable).map((r) => (
              <option key={r} value={r}>
                {roleLabels[r]}
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
            {saving ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
