import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { clearPreviewToken, setPreviewToken } from "../api";
import { useAuth } from "../auth";

/**
 * Super admin «kompaniyani ko‘rish» havolasi: /preview#<token>.
 * Token manzil hash’ida keladi (serverga va loglarga tushmaydi), shu tabning sessionStorage’iga saqlanadi
 * va hash darhol tozalanadi. Keyin panel shu kompaniya nomidan (faqat o‘qish yoki yordam rejimi) ochiladi.
 */
export function PreviewEntry() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [error, setError] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, "", "/preview");
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
      setError("Havola noto‘g‘ri yoki eskirgan. Super admin panelidan qayta oching.");
      return;
    }
    clearPreviewToken();
    setPreviewToken(token);
    void refresh().then(() => navigate("/dashboard", { replace: true }));
  }, [navigate, refresh]);
  if (!error)
    return (
      <div className="screen-loader">
        <span />
      </div>
    );
  return (
    <div className="sa-preview-error">
      <ShieldAlert size={28} />
      <p>{error}</p>
      <button className="btn" onClick={() => window.close()}>
        Yopish
      </button>
    </div>
  );
}
