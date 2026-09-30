import { useState } from "react";
import { ExternalLink, FileText, LoaderCircle, Trash2, Upload } from "lucide-react";
import { del, errorText, post } from "../api";
import { useApi } from "../hooks";
import { Confirm, Empty, ErrorBox, Field, Loading, Modal, useToast } from "./ui";
import type { DocumentType } from "@/lib/types";

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  PASSPORT: "Pasport / ID karta",
  DIPLOMA: "Diplom",
  MEDICAL: "Tibbiy ma’lumotnoma",
  SANITARY: "Sanitariya daftarchasi",
  CONTRACT: "Mehnat shartnomasi",
  OTHER: "Boshqa hujjat",
};
const DOCUMENT_ICONS: Record<DocumentType, string> = { PASSPORT: "🪪", DIPLOMA: "🎓", MEDICAL: "🩺", SANITARY: "📗", CONTRACT: "📝", OTHER: "📄" };

type Doc = {
  id: string;
  type: DocumentType;
  title: string;
  mime: string;
  size: number;
  expiresAt?: string;
  uploadedBy: string;
  createdAt: string;
  status: "OK" | "SOON" | "EXPIRED";
};

/** Rasmni 1600 px gacha kichraytirib JPEG ga o‘giradi; PDF o‘zgarishsiz. */
export async function fileToDataUrl(file: File): Promise<string> {
  if (file.type === "application/pdf") {
    if (file.size > 1_400_000) throw new Error("PDF 1,4 MB dan katta — kichikroq fayl tanlang.");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Faylni o‘qib bo‘lmadi."));
      reader.readAsDataURL(file);
    });
  }
  if (!file.type.startsWith("image/")) throw new Error("Faqat rasm yoki PDF yuklash mumkin.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

const size = (bytes: number) => (bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`);
const dmy = (iso?: string) => (iso ? iso.split("-").reverse().join(".") : "");

export function DocumentsPanel({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<Doc[]>(`/employees/${employeeId}/documents`);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<Doc | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  return (
    <div className="docs">
      {canEdit && (
        <div className="docs-head">
          <p className="muted">Pasport, diplom, tibbiy ma’lumotnoma… Muddati bor hujjatlar uchun xodim va HR ga oldindan eslatma boradi.</p>
          <button className="btn btn-primary" onClick={() => setUploading(true)}>
            <Upload size={15} /> Hujjat yuklash
          </button>
        </div>
      )}
      {!data?.length ? (
        <Empty icon={FileText} title="Hujjat yo‘q" text="Xodim Mini App orqali ham o‘z hujjatlarini yuklashi mumkin." />
      ) : (
        <div className="docs-list">
          {data.map((doc) => (
            <div key={doc.id} className={`doc ${doc.status.toLowerCase()}`}>
              <span className="doc-icon">{DOCUMENT_ICONS[doc.type]}</span>
              <div className="doc-main">
                <b>{doc.title}</b>
                <small>
                  {DOCUMENT_LABELS[doc.type]} · {size(doc.size)} · {doc.uploadedBy}
                </small>
              </div>
              {doc.expiresAt && (
                <span className={`badge ${doc.status === "EXPIRED" ? "red" : doc.status === "SOON" ? "amber" : "green"}`}>
                  {doc.status === "EXPIRED" ? "Muddati o‘tgan" : "Amal qiladi"} · {dmy(doc.expiresAt)}
                </span>
              )}
              <a className="icon-btn" href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer" aria-label="Ochish" title="Ochish">
                <ExternalLink size={15} />
              </a>
              {canEdit && (
                <button className="icon-btn danger-hover" aria-label="O‘chirish" onClick={() => setRemoving(doc)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {uploading && (
        <UploadModal
          onClose={() => setUploading(false)}
          onUpload={async (body) => {
            await post(`/employees/${employeeId}/documents`, body);
            toast("Hujjat yuklandi");
            setUploading(false);
            void reload(true);
          }}
        />
      )}
      {removing && (
        <Confirm
          title="Hujjat o‘chirilsinmi?"
          text={`«${removing.title}» butunlay o‘chiriladi.`}
          confirmLabel="O‘chirish"
          danger
          onConfirm={async () => {
            await del(`/documents/${removing.id}`);
            toast("O‘chirildi");
            void reload(true);
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function UploadModal({ onClose, onUpload }: { onClose: () => void; onUpload: (body: { type: DocumentType; title?: string; expiresAt?: string; dataUrl: string }) => Promise<void> }) {
  const [type, setType] = useState<DocumentType>("PASSPORT");
  const [title, setTitle] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title="Hujjat yuklash" subtitle="JPG, PNG yoki PDF · 1,4 MB gacha (rasm avtomatik kichraytiriladi)" onClose={onClose} size="narrow">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return;
          setBusy(true);
          setError("");
          try {
            await onUpload({ type, title: title || undefined, expiresAt: expiresAt || undefined, dataUrl: await fileToDataUrl(file) });
          } catch (reason) {
            setError(errorText(reason));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Turi">
          <select className="select" value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
            {(Object.keys(DOCUMENT_LABELS) as DocumentType[]).map((key) => (
              <option key={key} value={key}>
                {DOCUMENT_ICONS[key]} {DOCUMENT_LABELS[key]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nomi (ixtiyoriy)">
          <input className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={DOCUMENT_LABELS[type]} />
        </Field>
        <Field label="Amal qilish muddati (bo‘lsa)" hint="Muddatdan 30, 7 va 1 kun oldin eslatma boradi">
          <input className="input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </Field>
        <label className={`doc-drop ${file ? "has" : ""}`}>
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <Upload size={18} />
          <span>{file ? `${file.name} · ${size(file.size)}` : "Faylni tanlang"}</span>
        </label>
        <ErrorBox message={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={!file || busy}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />} Yuklash
          </button>
        </div>
      </form>
    </Modal>
  );
}
