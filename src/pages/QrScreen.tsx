import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, LoaderCircle, ShieldCheck, Wifi } from "lucide-react";
import { api } from "../api";
import { Logo } from "../components/Logo";
import type { Branch } from "@/lib/types";
import { dateLongUz } from "@/lib/format";

type Qr = { branch: Branch; dataUrl: string; expiresAt: number };
export function QrScreen() {
  const { branchId } = useParams();
  const navigate = useNavigate();
  const [qr, setQr] = useState<Qr | null>(null);
  const [seconds, setSeconds] = useState(60);
  const [error, setError] = useState("");
  async function load() {
    try {
      const next = await api<Qr>(`/qr/${branchId}`);
      setQr(next);
      setSeconds(Math.max(0, Math.ceil((next.expiresAt - Date.now()) / 1000)));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "QR olinmadi");
    }
  }
  useEffect(() => {
    void load();
  }, [branchId]);
  useEffect(() => {
    const timer = window.setInterval(
      () =>
        setSeconds((value) => {
          if (value <= 1) {
            void load();
            return 60;
          }
          return value - 1;
        }),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [branchId]);
  return (
    <main className="qr-screen">
      <button className="qr-back" onClick={() => navigate("/branches")}>
        <ChevronLeft size={17} /> Panelga qaytish
      </button>
      <header className="qr-screen-header">
        <div className="qr-logo">
          <Logo />
        </div>
        <span>
          <i />
          <Wifi size={14} /> Tizim ishlamoqda
        </span>
      </header>
      {error ? (
        <div className="qr-error">
          <p>{error}</p>
          <button className="btn" onClick={() => void load()}>
            Qayta urinish
          </button>
        </div>
      ) : !qr ? (
        <LoaderCircle className="spin" size={38} />
      ) : (
        <section className="qr-stage">
          <div className="qr-branch">
            <small>DAVOMAT EKRANI</small>
            <h1>{qr.branch.name}</h1>
            <p>{qr.branch.address}</p>
            <time>
              {new Date().toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                timeZone: "Asia/Tashkent",
              })}
            </time>
            <span>{dateLongUz(new Date(), true)}</span>
          </div>
          <div className="qr-code-panel">
            <div className="qr-panel-title">
              <div>
                <small>DINAMIK QR</small>
                <b>Telegram Mini App orqali skanerlang</b>
              </div>
              <ShieldCheck size={21} />
            </div>
            <div className="qr-box">
              <img src={qr.dataUrl} alt="Davomat uchun vaqtinchalik QR kod" />
            </div>
            <div className="qr-expiry">
              <span>QR yangilanishi</span>
              <b>00:{String(seconds).padStart(2, "0")}</b>
              <div>
                <i
                  style={{
                    width: `${Math.max(0, Math.min(100, (seconds / 60) * 100))}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </section>
      )}
      <footer className="qr-footer">
        QR kod vaqtinchalik va filialga biriktirilgan. Xodim ma’lumotlari
        ekranda ko‘rsatilmaydi.
      </footer>
    </main>
  );
}
