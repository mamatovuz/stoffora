import { useEffect, useState } from "react";
import { ChevronRight, Copy, ShieldCheck, Smartphone } from "lucide-react";
import { api, errorText, post } from "../../api";
import { Sheet, type Toast } from "./shared";
import { haptic } from "./tg";

type Status = { device?: { platform: string; model?: string; createdAt: string; lastSeenAt?: string }; pendingReplacement: boolean };
type Code = { code: string; expiresAt: string; link: string; hasDevice: boolean };

/**
 * «Telefon ilovasini ulash»: Telegram orqali tasdiqlangan xodim bir martalik (15 daqiqa) kod
 * oladi va uni Staffora ilovasiga kiritadi. Kod hech qayerda saqlanmaydi — faqat ekranda.
 */
export function MobileLinkRow({ onToast }: { onToast: Toast }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<Code | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    api<Status>("/mini/mobile/status").then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    if (!code) return;
    const tick = () => {
      const s = Math.max(0, Math.round((Date.parse(code.expiresAt) - Date.now()) / 1000));
      setLeft(s);
      if (!s) setCode(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [code]);

  const generate = async () => {
    setBusy(true);
    try {
      setCode(await post<Code>("/mini/mobile/activation-code", {}));
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
      onToast("Kod nusxalandi");
    } catch {
      onToast("Kodni qo‘lda kiriting", "error");
    }
  };
  const close = () => {
    setOpen(false);
    setCode(null);
  };

  const device = status?.device;
  return (
    <>
      <button className="mp-row link" onClick={() => setOpen(true)}>
        <span>
          <Smartphone size={15} /> Telefon ilovasi
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
            {status?.pendingReplacement && <p className="mlink-note">Yangi telefon so‘rovingiz HR tasdig‘ini kutmoqda.</p>}
            {code ? (
              <div className="mlink-code">
                <small>Ilovaga shu kodni kiriting</small>
                <button className="mlink-digits" onClick={() => void copy()} aria-label="Kodni nusxalash">
                  {code.code}
                  <Copy size={16} />
                </button>
                <small>
                  {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} amal qiladi · faqat bir marta
                </small>
              </div>
            ) : (
              <ol className="mlink-steps">
                <li>App Store yoki Google Play’dan «Staffora» ilovasini o‘rnating.</li>
                <li>«Ulash kodini olish» tugmasini bosing.</li>
                <li>Ilovada kodni kiriting — telefon sizga bog‘lanadi.</li>
              </ol>
            )}
            <p className="mlink-hint">
              {device
                ? "Har bir xodimda bitta ishonchli telefon bo‘ladi. Yangi telefonni ulasangiz, HR tasdiqlagach eskisi o‘chiriladi."
                : "Kodni hech kimga bermang. Bir telefon faqat bitta xodimga bog‘lanadi."}
            </p>
          </div>
        </Sheet>
      )}
    </>
  );
}
