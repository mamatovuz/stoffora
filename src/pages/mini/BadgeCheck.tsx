import { useState } from "react";
import { CheckCircle2, ScanLine, XCircle } from "lucide-react";
import { Sheet } from "./shared";
import { haptic, tg } from "./tg";

/*
 * Rahbar / qo‘riqchi: xodimning raqamli ID QR kodini Telegram skaneri bilan tekshirish.
 * Natija serverda: imzo, muddat (2 daqiqa), kompaniya va xodim holati.
 */

type Call = <T>(url: string, body?: unknown, method?: string) => Promise<T>;
type Result = {
  valid: boolean;
  employee: { name: string; employeeNo: string; photoDataUrl?: string; position: string; branch: string; department: string; status: string };
  today: { checkIn?: string; checkOut?: string } | null;
};

export function useBadgeScanner(call: Call) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const scan = () => {
    const app = tg() as (ReturnType<typeof tg> & { showScanQrPopup?: (p: { text?: string }, cb: (text: string) => boolean | void) => void; closeScanQrPopup?: () => void }) | undefined;
    if (!app?.showScanQrPopup) {
      setError("Bu Telegram versiyasida QR skaner yo‘q — Telegram’ni yangilang.");
      return;
    }
    app.showScanQrPopup({ text: "Xodimning «Mening ID» QR kodini skanerlang" }, (text) => {
      if (!text?.startsWith("staffora-badge:")) return false;
      app.closeScanQrPopup?.();
      setError("");
      void call<Result>(`/badge/verify?token=${encodeURIComponent(text)}`)
        .then((r) => {
          r.valid ? haptic.success() : haptic.error();
          setResult(r);
        })
        .catch((e) => {
          haptic.error();
          setError(e instanceof Error ? e.message : "Tekshirib bo‘lmadi");
        });
      return true;
    });
  };
  const sheet =
    result || error ? (
      <Sheet title="Xodim ID tekshiruvi" onClose={() => (setResult(null), setError(""))} primary={{ text: "Yana skanerlash", onClick: () => (setResult(null), setError(""), scan()) }}>
        {error ? (
          <section className="mini-card bc-result bad">
            <XCircle size={40} />
            <b>{error}</b>
          </section>
        ) : result ? (
          <section className={`mini-card bc-result ${result.valid ? "ok" : "bad"}`}>
            {result.employee.photoDataUrl ? <img src={result.employee.photoDataUrl} alt="" /> : null}
            {result.valid ? <CheckCircle2 size={28} /> : <XCircle size={28} />}
            <b>{result.employee.name}</b>
            <small>
              {result.employee.position} · {result.employee.branch}
            </small>
            <small>{result.employee.employeeNo}</small>
            <span className={`mini-chip ${result.valid ? "ok" : "bad"}`}>{result.valid ? "Faol xodim" : "Faol emas (ishdan ketgan)"}</span>
            {result.today && (
              <small>
                Bugun: keldi {result.today.checkIn || "—"}
                {result.today.checkOut ? `, ketdi ${result.today.checkOut}` : ""}
              </small>
            )}
          </section>
        ) : null}
      </Sheet>
    ) : null;
  return { scan, sheet, icon: <ScanLine size={18} /> };
}
