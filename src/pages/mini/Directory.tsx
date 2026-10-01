import { useEffect, useMemo, useState } from "react";
import { AlertCircle, MessageCircle, Phone, Search, Users } from "lucide-react";
import { api, errorText } from "../../api";
import { SkeletonList } from "./shared";
import { getCached, setCached } from "../miniCache";
import { PhotoAvatar, Seg, Sheet } from "./shared";
import { callPhone, choiceNative, haptic, writeInTelegram } from "./tg";

type Person = {
  id: string;
  name: string;
  position?: string;
  department?: string;
  branch?: string;
  sameBranch: boolean;
  photoDataUrl?: string;
  username?: string;
  phone?: string;
  atWork: boolean;
};

/** Hamkasblar ma’lumotnomasi: qidiruv, «hozir ishda» belgisi, bir bosishda yozish yoki qo‘ng‘iroq. */
export function DirectorySheet({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Person[] | null>(() => getCached<Person[]>("directory"));
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"branch" | "all">("branch");
  useEffect(() => {
    void api<{ rows: Person[] }>("/mini/directory")
      .then((value) => {
        setCached("directory", value.rows);
        setRows(value.rows);
        if (!value.rows.some((r) => r.sameBranch)) setScope("all");
      })
      .catch((reason) => setError(errorText(reason)));
  }, []);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows || []).filter(
      (r) =>
        (scope === "all" || r.sameBranch) &&
        (!q || [r.name, r.position, r.department, r.branch].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [rows, query, scope]);

  async function contact(person: Person) {
    haptic.tap();
    const options = [
      ...(person.username || person.phone ? [{ id: "write", text: "Telegram’da yozish" }] : []),
      ...(person.phone ? [{ id: "call", text: "Qo‘ng‘iroq qilish" }] : []),
    ];
    if (!options.length) return;
    const choice = options.length === 1 ? options[0].id : await choiceNative(`${person.name}${person.position ? ` · ${person.position}` : ""}`, options);
    if (choice === "write") writeInTelegram(person);
    if (choice === "call" && person.phone) callPhone(person.phone);
  }

  return (
    <Sheet title="Hamkasblar" subtitle={rows ? `${list.length} kishi` : "Yuklanmoqda…"} onClose={onClose} className="md-sheet">
      <label className="md-search">
        <Search size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ism, lavozim yoki bo‘lim" />
      </label>
      <Seg
        value={scope}
        onChange={setScope}
        options={[
          ["branch", "Mening filialim"],
          ["all", "Hammasi"],
        ]}
      />
      {error ? (
        <div className="mini-alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : !rows ? (
        <SkeletonList rows={5} />
      ) : !list.length ? (
        <div className="mini-empty">
          <Users size={26} />
          Hech kim topilmadi
        </div>
      ) : (
        <div className="mini-rows md-list">
          {list.map((p) => {
            const [firstName, ...rest] = p.name.split(" ");
            return (
              <div className="mini-row md-row" key={p.id} onClick={(event) => !(event.target as HTMLElement).closest("button") && void contact(p)}>
                <span className="md-avatar">
                  <PhotoAvatar employee={{ firstName, lastName: rest.join(" ") || " ", photoDataUrl: p.photoDataUrl }} />
                  {p.atWork && <i title="Hozir ishda" />}
                </span>
                <span>
                  <b>{p.name}</b>
                  <small>{[p.position, scope === "all" ? p.branch : p.department].filter(Boolean).join(" · ") || "—"}</small>
                </span>
                <span className="md-actions">
                  {(p.username || p.phone) && (
                    <button aria-label="Yozish" onClick={() => writeInTelegram(p)}>
                      <MessageCircle size={17} />
                    </button>
                  )}
                  {p.phone && (
                    <button aria-label="Qo‘ng‘iroq" onClick={() => callPhone(p.phone!)}>
                      <Phone size={17} />
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
