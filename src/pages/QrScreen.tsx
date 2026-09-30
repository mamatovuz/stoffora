import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { LoaderCircle, Maximize, ShieldCheck, Users } from "lucide-react";
import { api, errorText } from "../api";
import { Logo } from "../components/Logo";
import type { Branch } from "@/lib/types";
import { dateLongUz } from "@/lib/format";
import { useNow } from "../hooks";

type Qr = {
  branch: Branch;
  dataUrl: string;
  refreshAt: number;
  refreshSeconds: number;
  stats: { in: number; total: number };
};

export function QrScreen() {
  const { branchId } = useParams();
  const now = useNow(1000);
  const [qr, setQr] = useState<Qr | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await api<Qr>(`/qr/${branchId}`);
      // Server va brauzer soati farqini hisobga olmaslik uchun nisbiy vaqt.
      setQr({ ...next, refreshAt: Date.now() + next.refreshSeconds * 1000 });
      setError("");
    } catch (reason) {
      setError(errorText(reason, "QR olinmadi"));
    } finally {
      inFlight.current = false;
    }
  }, [branchId]);
  useEffect(() => {
    void load();
  }, [load]);
  const remaining = qr ? Math.max(0, Math.ceil((qr.refreshAt - now.getTime()) / 1000)) : 0;
  useEffect(() => {
    if (qr && remaining <= 0) void load();
  }, [qr, remaining, load]);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => void load(), 10_000);
    return () => window.clearTimeout(timer);
  }, [error, load]);
  // Ekran o‘chib qolmasligi uchun
  useEffect(() => {
    let lock: { release: () => Promise<void> } | undefined;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    void nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    return () => void lock?.release();
  }, []);

  return (
    <main className="qr-screen">
      <header className="qr-top">
        <Logo />
        <button
          className="btn btn-sm"
          onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
        >
          <Maximize size={14} /> To‘liq ekran
        </button>
      </header>
      {error && !qr ? (
        <div className="qr-stage" style={{ gridTemplateColumns: "1fr", textAlign: "center" }}>
          <div>
            <p style={{ fontSize: 18 }}>{error}</p>
            <button className="btn" style={{ marginTop: 16 }} onClick={() => void load()}>
              Qayta urinish
            </button>
          </div>
        </div>
      ) : !qr ? (
        <div className="qr-stage" style={{ gridTemplateColumns: "1fr", justifyItems: "center" }}>
          <LoaderCircle className="spin" size={40} />
        </div>
      ) : (
        <section className="qr-stage">
          <div className="qr-info">
            <small>DAVOMAT EKRANI</small>
            <h1>{qr.branch.name}</h1>
            <p>{qr.branch.address}</p>
            <div className="qr-clock">
              {now.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                timeZone: "Asia/Tashkent",
              })}
            </div>
            <div className="qr-date">{dateLongUz(now, true)}</div>
            <div className="qr-counters">
              <div>
                <small>Hozir ishda</small>
                <b>
                  <Users size={18} style={{ display: "inline", verticalAlign: -2 }} /> {qr.stats.in}
                </b>
              </div>
              <div>
                <small>Filial xodimlari</small>
                <b>{qr.stats.total}</b>
              </div>
            </div>
          </div>
          <div className="qr-panel">
            <div className="qr-panel-head">
              <div>
                <small>DINAMIK QR</small>
                <b>Staffora Mini App orqali skanerlang</b>
              </div>
              <ShieldCheck size={22} color="var(--brand)" />
            </div>
            <img src={qr.dataUrl} alt="Davomat uchun vaqtinchalik QR kod" />
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  marginBottom: 6,
                  color: "var(--muted)",
                }}
              >
                <span>Yangilanishgacha</span>
                <b className="num" style={{ color: "var(--ink)" }}>
                  {remaining} s
                </b>
              </div>
              <div className="progress">
                <i style={{ width: `${(remaining / qr.refreshSeconds) * 100}%` }} />
              </div>
            </div>
          </div>
        </section>
      )}
      <footer className="qr-foot">
        QR kod vaqtinchalik va faqat shu filialga tegishli. Rasmga olib yuborish
        ishlamaydi — GPS va Face ID ham tekshiriladi.
        {error && qr && <span style={{ color: "#ff9b9b" }}> · Aloqa uzildi, qayta ulanmoqda…</span>}
      </footer>
    </main>
  );
}
