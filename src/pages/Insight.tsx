import { useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Network, UserRound } from "lucide-react";
import { errorText, put } from "../api";
import { useApi } from "../hooks";
import { useAuth } from "../auth";
import { can } from "@/lib/permissions";
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, Segmented, StatCard, useToast } from "../components/ui";

/* Tashkiliy tuzilma. */

/* ========================================================== tuzilma === */
type Person = { id: string; name: string; photoDataUrl?: string; position: string; branch: string };
type Dept = { id: string; name: string; parentId: string | null; head: Person | null; count: number; positions: { id: string; name: string; people: Person[] }[] };
type Org = { company: string; total: number; unassigned: number; departments: Dept[]; branches: { id: string; name: string; count: number; managers: Person[] }[] };

const Avatar = ({ p }: { p: Person }) => (p.photoDataUrl ? <img className="org-av" src={p.photoDataUrl} alt="" /> : <span className="org-av">{p.name.slice(0, 1)}</span>);

export function OrgChartPage() {
  const toast = useToast();
  const { user } = useAuth();
  const editable = Boolean(user && can(user.role, "employees.edit"));
  const { data, loading, error, reload } = useApi<Org>("/org/tree");
  const [view, setView] = useState<"departments" | "branches">("departments");
  const [editing, setEditing] = useState<Dept | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  const children = (parent: string | null) => (data?.departments || []).filter((d) => d.parentId === parent);
  const toggle = (id: string) => setOpen(open.includes(id) ? open.filter((x) => x !== id) : [...open, id]);

  function Node({ d }: { d: Dept }) {
    const kids = children(d.id);
    const expanded = open.includes(d.id);
    return (
      <li>
        <div className="org-node">
          <button className="org-card" onClick={() => toggle(d.id)}>
            <b>{d.name}</b>
            {d.head ? (
              <span className="org-head">
                <Avatar p={d.head} /> {d.head.name}
              </span>
            ) : (
              <small className="muted">Rahbar tayinlanmagan</small>
            )}
            <small className="muted">
              {d.count} xodim · {d.positions.length} lavozim
            </small>
          </button>
          {editable && (
            <button className="btn btn-sm org-edit" onClick={() => setEditing(d)}>
              Sozlash
            </button>
          )}
        </div>
        {expanded && (
          <div className="org-positions">
            {d.positions.map((p) => (
              <div key={p.id} className="org-pos">
                <b>
                  {p.name} <small className="muted">· {p.people.length}</small>
                </b>
                <div className="org-people">
                  {p.people.slice(0, 12).map((x) => (
                    <Link key={x.id} to={`/employees/${x.id}`} className="org-person" title={`${x.name} · ${x.branch}`}>
                      <Avatar p={x} />
                      <span>{x.name}</span>
                    </Link>
                  ))}
                  {p.people.length > 12 && <small className="muted">va yana {p.people.length - 12}</small>}
                </div>
              </div>
            ))}
          </div>
        )}
        {kids.length > 0 && (
          <ul className="org-tree">
            {kids.map((k) => (
              <Node key={k.id} d={k} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Tashkiliy tuzilma"
        subtitle="Bo‘limlar ierarxiyasi, rahbarlar, lavozimlar va xodimlar; filiallar va ularning rahbarlari."
        actions={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "departments", label: "Bo‘limlar" },
              { value: "branches", label: "Filiallar" },
            ]}
          />
        }
      />
      {loading && !data ? (
        <Loading />
      ) : error || !data ? (
        <ErrorBox message={error || "Ma’lumot yo‘q"} />
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="Faol xodimlar" value={data.total} icon={UserRound} tone="blue" />
            <StatCard label="Bo‘limlar" value={data.departments.length} icon={Network} tone="violet" />
            <StatCard label="Filiallar" value={data.branches.length} icon={Building2} tone="green" />
            <StatCard label="Bo‘limsiz xodim" value={data.unassigned} icon={UserRound} tone={data.unassigned ? "amber" : undefined} />
          </div>
          {view === "departments" ? (
            <section className="card org-wrap">
              <div className="org-root">
                <b>{data.company}</b>
              </div>
              {!data.departments.length ? (
                <Empty icon={Network} title="Bo‘limlar yo‘q" text="Avval «Bo‘limlar» sahifasida bo‘lim qo‘shing." />
              ) : (
                <ul className="org-tree top">
                  {children(null).map((d) => (
                    <Node key={d.id} d={d} />
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <div className="org-branches">
              {data.branches.map((b) => (
                <section key={b.id} className="card org-branch">
                  <b>{b.name}</b>
                  <small className="muted">{b.count} xodim</small>
                  {b.managers.length ? (
                    b.managers.map((m) => (
                      <Link key={m.id} to={`/employees/${m.id}`} className="org-person">
                        <Avatar p={m} />
                        <span>
                          {m.name}
                          <small className="muted block">{m.position || "Filial rahbari"}</small>
                        </span>
                      </Link>
                    ))
                  ) : (
                    <small className="muted">Rahbar tayinlanmagan — «Filiallar» sahifasida tayinlang</small>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}
      {editing && data && (
        <DeptModal
          dept={editing}
          all={data.departments}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            toast("Saqlandi");
            void reload(true);
          }}
        />
      )}
    </div>
  );
}

function DeptModal({ dept, all, onClose, onDone }: { dept: Dept; all: Dept[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: people } = useApi<{ items: { id: string; firstName: string; lastName: string }[] }>("/employees?limit=500&status=ACTIVE");
  const [parentId, setParentId] = useState(dept.parentId || "");
  const [headId, setHeadId] = useState(dept.head?.id || "");
  async function save() {
    try {
      await put(`/org/departments/${dept.id}`, { parentId: parentId || null, headEmployeeId: headId || null });
      onDone();
    } catch (reason) {
      toast(errorText(reason), "error");
    }
  }
  return (
    <Modal title={dept.name} subtitle="Bo‘lim o‘rni va rahbari" onClose={onClose} size="narrow">
      <Field label="Yuqori bo‘lim">
        <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">— Eng yuqori (kompaniyaga bo‘ysunadi)</option>
          {all
            .filter((d) => d.id !== dept.id)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Bo‘lim rahbari">
        <select className="select" value={headId} onChange={(e) => setHeadId(e.target.value)}>
          <option value="">— Tayinlanmagan</option>
          {(people?.items || []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.lastName}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Bekor qilish
        </button>
        <button className="btn btn-primary" onClick={() => void save()}>
          Saqlash
        </button>
      </div>
    </Modal>
  );
}
