import { useEffect, useState } from "react";
import { ChevronRight, Copy, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { api, errorText, post } from "../../api";
import { Sheet, type Toast } from "./shared";
import { haptic } from "./tg";

type Status = { device?: { platform: string; model?: string; createdAt: string; lastSeenAt?: string }; pendingReplacement: boolean };
type Code = { code: string; expiresAt: string; link: string; hasDevice: boolean };

/**
 * «Telefon ilovasini ulash»: Telegram orqali tasdiqlangan xodim bir martalik (15 daqiqa) kod
 * oladi va uni Staffora ilovasiga kiritadi — darhol kiradi (HR tasdig‘i kerak emas).
 * Yangi telefonda kiritilsa, eski telefondagi ilovadan avtomatik chiqiladi.
 * Kod hech qayerda saqlanmaydi — faqat ekranda.
 */
const CODE_TTL = 15 * 60;
export function MobileLinkRow({ onToast }: { onToast: Toast }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<Code | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    api<Status>("/mini/mobile/status").then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    if (!code) return;
    const tick = () => {
      const s = Math.max(0, Math.round((Date.parse(code.expiresAt) - Date.now()) / 1000));
      setLeft(s);
      if (!s) {
        setCode(null);
        setExpired(true);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [code]);

  const generate = async () => {
    setBusy(true);
    try {
      setCode(await post<Code>("/mini/mobile/activation-code", {}));
      setExpired(false);
      haptic.success();
    } catch (error) {
      onToast(errorText(error), "error");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      haptic.success();
      onToast("Kod nusxalandi — ilovaga qo‘ying");
    } catch {
      onToast("Kodni qo‘lda kiriting", "error");
    }
  };
  const close = () => {
    setOpen(false);
    setCode(null);
    setExpired(false);
  };

  const device = status?.device;
  return (
    <>
      <button className="mp-row link" onClick={() => setOpen(true)}>
        <span className="mlink-row-label">
          <Smartphone size={15} />
          <span>
            Telefon ilovasi
            {status && !device && <small>Face ID bilan keldi-ketdi · 1 daqiqada ulanadi</small>}
          </span>
        </span>
        <span className="mp-row-end">
          <small className={device ? "ok" : ""}>{device ? device.model || (device.platform === "ios" ? "iPhone" : "Android") : "Ulanmagan"}</small>
          <ChevronRight size={16} />
        </span>
      </button>
      {open && (
        <Sheet
          title="Staffora ilovasi"
          subtitle="iPhone va Android uchun"
          onClose={close}
          primary={code ? null : { text: device ? "Yangi telefon uchun kod" : "Ulash kodini olish", onClick: () => void generate(), busy, icon: <Smartphone size={16} /> }}
        >
          <div className="mlink">
            {device && (
              <div className="mlink-device">
                <ShieldCheck size={18} />
                <div>
                  <b>Ishonchli telefon: {device.model || device.platform}</b>
                  <small>Ulangan: {new Date(device.createdAt).toLocaleDateString("ru-RU")}</small>
                </div>
              </div>
            )}
            {code ? (
              <div className="mlink-code">
                <small>Staffora ilovasiga shu kodni kiriting</small>
                <button className="mlink-digits" onClick={() => void copy()} aria-label="Kodni nusxalash">
                  {code.code}
                  <Copy size={16} />
                </button>
                <div className="mlink-timer" aria-hidden>
                  <i style={{ width: `${Math.min(100, (left / CODE_TTL) * 100)}%` }} />
                </div>
                <small>
                  {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} amal qiladi · faqat bir marta · bosib nusxalang
                </small>
                <button className="mlink-again" onClick={() => void generate()} disabled={busy}>
                  <RefreshCw size={14} /> Yangi kod
                </button>
              </div>
            ) : (
              <>
                {expired && <p className="mlink-note">Kod muddati tugadi. Yangi kod oling.</p>}
                <ol className="mlink-steps">
                  <li>
                    <span>
                      <b>O‘rnating.</b> App Store yoki Google Play’dan «Staffora» ilovasini yuklab oling.
                    </span>
                  </li>
                  <li>
                    <span>
                      <b>Kod oling.</b> Pastdagi «{device ? "Yangi telefon uchun kod" : "Ulash kodini olish"}» tugmasini bosing.
                    </span>
                  </li>
                  <li>
                    <span>
                      <b>Kiriting.</b> Ilovada 8 belgili kodni yozing — darhol kirasiz.
                    </span>
                  </li>
                </ol>
              </>
            )}
            <p className="mlink-hint">
              {device
                ? "Yangi telefonda kod kiritsangiz, ilova o‘sha telefonda ochiladi va eski telefondan avtomatik chiqiladi. HR tasdig‘i kerak emas."
                : "Kodni hech kimga bermang. Davomat baribir Face ID bilan — faqat o‘zingiz belgilaysiz."}
            </p>
          </div>
        </Sheet>
      )}
    </>
  );
}
