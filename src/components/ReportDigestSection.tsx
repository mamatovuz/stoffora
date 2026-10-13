import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, CalendarRange, Send } from "lucide-react";
import type { Company } from "@/lib/types";
import { errorText, post, put } from "../api";
import { useApi } from "../hooks";
import { ErrorBox, Loading, useToast } from "./ui";

type Digest = { weekly: boolean; monthly: boolean; branchManagers: boolean; payroll: boolean };
const DEFAULTS: Digest = { weekly: true, monthly: true, branchManagers: true, payroll: true };

/** Sozlamalar → Avtomatik hisobot: rahbarlarga Telegram’da haftalik va oylik hisobot (Excel bilan). */
export function ReportDigestSection() {
  const toast = useToast();
  const { data: company, loading } = useApi<Company>("/company");
  const { data: security } = useApi<{ telegramLinked?: boolean }>("/auth/security");
  const [form, setForm] = useState<Digest>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<"" | "weekly" | "monthly">("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (company) setForm({ ...DEFAULTS, ...(company.reportDigest || {}) } as Digest);
  }, [company]);

  if (loading && !company) return <Loading />;
  const row = (key: keyof Digest, title: string, text: string) => (
    <label className="setting-row" key={key}>
      <span>
        <b>{title}</b>
        <small>{text}</small>
      </span>
      <span className="switch">
        <input type="checkbox" checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
        <span />
      </span>
    </label>
  );
  const test = async (kind: "weekly" | "monthly") => {
    setTesting(kind);
    setError("");
    try {
      await post("/reports/digest/test", { kind });
      toast(kind === "weekly" ? "Haftalik hisobot Telegram’ingizga yuborildi" : "Oylik hisobot Telegram’ingizga yuborildi");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setTesting("");
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Avtomatik hisobot</h2>
          <p>Rahbarlarga Telegram’da qisqa xulosa va Excel fayl — o‘zingiz yuklab olishingiz shart emas</p>
        </div>
      </div>
      <div className="card-body" style={{ display: "grid", gap: 4 }}>
        <div className="digest-plan">
          <div>
            <CalendarDays size={18} />
            <span>
              <b>Haftalik</b>
              <small>Har dushanba 08:30 · o‘tgan hafta: davomat %, kechikishlar, kelmaganlar + davomat Excel</small>
            </span>
          </div>
          <div>
            <CalendarRange size={18} />
            <span>
              <b>Oylik</b>
              <small>Har oyning 1-kuni 08:30 · o‘tgan oy xulosasi + davomat Excel + ish haqi qaydnomasi</small>
            </span>
          </div>
        </div>
        {row("weekly", "Haftalik hisobot", "Kompaniya egasi va HR administratorlariga")}
        {row("monthly", "Oylik hisobot", "Oy yakuni bo‘yicha to‘liq xulosa")}
        {row("branchManagers", "Filial rahbarlariga ham", "Har biri faqat o‘z filiallari bo‘yicha hisobot oladi")}
        {row("payroll", "Oylik hisobotga ish haqi qaydnomasini qo‘shish", "Faqat ish haqini ko‘rish huquqi borlarga yuboriladi")}
        <p className="hint" style={{ marginTop: 8 }}>
          Hisobot Telegram’i ulangan panel foydalanuvchilariga keladi.{" "}
          {security && !security.telegramLinked && (
            <>
              Sizning Telegram’ingiz ulanmagan —{" "}
              <Link className="link" to="/settings?tab=security">
                Xavfsizlik bo‘limida ulang
              </Link>
              .
            </>
          )}
        </p>
        <ErrorBox message={error} />
        <div className="form-actions" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <span className="toolbar">
            <button type="button" className="btn btn-sm" disabled={Boolean(testing)} onClick={() => void test("weekly")}>
              <Send size={14} /> {testing === "weekly" ? "Yuborilmoqda…" : "Haftalikni hozir menga yuborish"}
            </button>
            <button type="button" className="btn btn-sm" disabled={Boolean(testing)} onClick={() => void test("monthly")}>
              <Send size={14} /> {testing === "monthly" ? "Yuborilmoqda…" : "Oylikni hozir menga yuborish"}
            </button>
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                await put("/company/report-digest", form);
                toast("Saqlandi");
              } catch (reason) {
                setError(errorText(reason));
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
      </div>
    </section>
  );
}
