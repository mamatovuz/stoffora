import { useState } from "react";
import { Check, KeyRound, ShieldCheck, ShieldOff, Smartphone, X } from "lucide-react";
import { errorText, post } from "../api";
import { useApi } from "../hooks";
import { dateUz } from "@/lib/format";
import { Confirm, Empty, ErrorBox, Loading, Status, useToast } from "./ui";

type Device = {
  id: string;
  platform: "ios" | "android";
  model?: string;
  osVersion?: string;
  appVersion?: string;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokeReason?: string;
  push: boolean;
};
type ChangeRequest = {
  id: string;
  employeeId: string;
  platform: "ios" | "android";
  model?: string;
  osVersion?: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  employeeName?: string;
  employeeNo?: string;
  oldDevice?: Device;
};
type DeviceInfo = { devices: Device[]; requests: ChangeRequest[]; activeCodes: { id: string; hint: string; source: string; expiresAt: string }[] };

const when = (iso?: string) => (iso ? `${dateUz(iso.slice(0, 10))} ${new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : "—");
const deviceName = (d: { platform: string; model?: string }) => d.model || (d.platform === "ios" ? "iPhone" : "Android");
const REQUEST_LABEL = { PENDING: "Tasdiq kutilmoqda", APPROVED: "Tasdiqlangan", REJECTED: "Rad etilgan", CANCELLED: "Bekor qilingan" };

/** Xodim profili: ishonchli telefon, taklif kodi, bekor qilish va almashtirish so‘rovlari. */
export function MobileDevicePanel({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const { data, loading, error, reload } = useApi<DeviceInfo>(`/employees/${employeeId}/mobile-devices`);
  const [invite, setInvite] = useState<{ code: string; expiresAt: string; sentToTelegram: boolean } | null>(null);
  const [revoke, setRevoke] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function createInvite() {
    setBusy(true);
    try {
      setInvite(await post(`/employees/${employeeId}/mobile-invite`, {}));
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  }
  async function decide(id: string, approve: boolean) {
    setBusy(true);
    try {
      await post(`/mobile/device-requests/${id}/decide`, { approve });
      toast(approve ? "Yangi telefon tasdiqlandi, eskisi o‘chirildi" : "So‘rov rad etildi");
      void reload(true);
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const active = data?.devices.find((d) => d.status === "ACTIVE");
  const pending = data?.requests.filter((r) => r.status === "PENDING") || [];
  const history = data?.devices.filter((d) => d.status !== "ACTIVE") || [];

  return (
    <section className="mdev">
      <header className="mdev-head">
        <div>
          <h3>
            <Smartphone size={17} /> Mobil ilova
          </h3>
          <p className="muted">Bitta xodim — bitta ishonchli telefon. Telefon kaliti qurilmadan chiqmaydi; chiqish (logout) bog‘lanishni o‘chirmaydi.</p>
        </div>
        {canEdit && (
          <button className="btn btn-sm" disabled={busy} onClick={() => void createInvite()}>
            <KeyRound size={14} /> Taklif kodi
          </button>
        )}
      </header>

      {invite && (
        <div className="mdev-invite">
          <small>Bir martalik kod · {when(invite.expiresAt)} gacha</small>
          <b className="num">{invite.code}</b>
          <small>{invite.sentToTelegram ? "Xodimga Telegram’da ham yuborildi." : "Xodimga shaxsan bering — kodni hech kimga ko‘rsatmang."} Kod ekrandan yopilgach qayta ko‘rinmaydi.</small>
        </div>
      )}

      {pending.map((r) => (
        <div key={r.id} className="mdev-request">
          <div>
            <b>Yangi telefon so‘rovi: {deviceName(r)}</b>
            <small>
              {r.platform === "ios" ? "iOS" : "Android"} {r.osVersion || ""} · {when(r.createdAt)}
            </small>
            <small>Tasdiqlansa {active ? `«${deviceName(active)}»` : "eski telefon"} va undagi barcha sessiyalar o‘chiriladi.</small>
          </div>
          {canEdit && (
            <span className="toolbar">
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void decide(r.id, true)}>
                <Check size={14} /> Tasdiqlash
              </button>
              <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void decide(r.id, false)} aria-label="Rad etish">
                <X size={14} />
              </button>
            </span>
          )}
        </div>
      ))}

      {active ? (
        <div className="mdev-card">
          <span className="mdev-icon ok">
            <ShieldCheck size={20} />
          </span>
          <div>
            <b>{deviceName(active)}</b>
            <small>
              {active.platform === "ios" ? "iOS" : "Android"} {active.osVersion || ""} · ilova {active.appVersion || "—"} · push {active.push ? "yoqilgan" : "o‘chiq"}
            </small>
            <small>
              Ulangan: {when(active.createdAt)} · oxirgi faollik: {when(active.lastSeenAt)}
            </small>
          </div>
          {canEdit && (
            <button className="btn btn-sm btn-danger" onClick={() => setRevoke(active)}>
              <ShieldOff size={14} /> Bekor qilish
            </button>
          )}
        </div>
      ) : (
        !pending.length && (
          <Empty
            icon={Smartphone}
            title="Telefon ulanmagan"
            text="Xodim Mini App → Profil → «Telefon ilovasi»dan kod oladi yoki siz «Taklif kodi» yaratasiz (72 soat, bir martalik)."
          />
        )
      )}

      {Boolean(data?.activeCodes.length) && !invite && (
        <p className="muted mdev-note">Faol kod: •••• ••{data!.activeCodes[0].hint} · {when(data!.activeCodes[0].expiresAt)} gacha</p>
      )}

      {Boolean(history.length) && (
        <details className="mdev-history">
          <summary>Avvalgi qurilmalar ({history.length})</summary>
          {history.map((d) => (
            <div key={d.id}>
              <b>{deviceName(d)}</b>
              <small>
                {when(d.createdAt)} — {when(d.revokedAt)} · {d.revokeReason || "bekor qilingan"}
                {d.revokedBy ? ` · ${d.revokedBy}` : ""}
              </small>
            </div>
          ))}
        </details>
      )}

      {revoke && (
        <Confirm
          title="Telefonni bekor qilish"
          danger
          confirmLabel="Bekor qilish"
          text={`«${deviceName(revoke)}» endi ishonchli bo‘lmaydi: ilovadagi sessiya darhol yopiladi va push xabarlar to‘xtaydi. Xodim yangi kod bilan qayta ulashi mumkin.`}
          onConfirm={async () => {
            await post(`/mobile-devices/${revoke.id}/revoke`, { reason: "HR bekor qildi" });
            toast("Qurilma bekor qilindi");
            void reload(true);
          }}
          onClose={() => setRevoke(null)}
        />
      )}
    </section>
  );
}

/** «So‘rovlar» sahifasi: barcha kutilayotgan telefon almashtirish so‘rovlari. */
export function DeviceRequestsPanel({ onChanged }: { onChanged?: () => void }) {
  const { data, loading, error, reload } = useApi<ChangeRequest[]>("/mobile/device-requests?status=PENDING");
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  async function decide(id: string, approve: boolean) {
    setBusy(id);
    try {
      await post(`/mobile/device-requests/${id}/decide`, { approve });
      toast(approve ? "Yangi telefon tasdiqlandi" : "So‘rov rad etildi");
      void reload(true);
      onChanged?.();
    } catch (reason) {
      toast(errorText(reason), "error");
    } finally {
      setBusy(null);
    }
  }
  if (loading && !data) return <Loading />;
  if (error)
    return (
      <div className="card-body">
        <ErrorBox message={error} />
      </div>
    );
  if (!data?.length)
    return <Empty icon={Smartphone} title="Telefon almashtirish so‘rovlari yo‘q" text="Xodim yangi telefonda ilovani faollashtirsa, so‘rov shu yerda paydo bo‘ladi." />;
  return (
    <div className="swap-list">
      {data.map((r) => (
        <article key={r.id} className="swap-card is-pending">
          <div className="swap-people">
            <div>
              <small>Xodim {r.employeeNo ? `· ${r.employeeNo}` : ""}</small>
              <b>{r.employeeName}</b>
            </div>
          </div>
          <div className="swap-dates">
            <span>
              <b>{r.oldDevice ? deviceName(r.oldDevice) : "—"}</b>
              <em>eski telefon</em>
            </span>
            <span>
              <b>{deviceName(r)}</b>
              <em>yangi telefon · {when(r.createdAt)}</em>
            </span>
          </div>
          <footer>
            <span className="state-cell">
              <Status value={r.status} label={REQUEST_LABEL[r.status]} />
            </span>
            <span className="toolbar">
              <button className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => void decide(r.id, true)}>
                <Check size={14} /> Tasdiqlash
              </button>
              <button className="btn btn-sm btn-danger" disabled={busy === r.id} onClick={() => void decide(r.id, false)} aria-label="Rad etish">
                <X size={14} />
              </button>
            </span>
          </footer>
        </article>
      ))}
    </div>
  );
}
