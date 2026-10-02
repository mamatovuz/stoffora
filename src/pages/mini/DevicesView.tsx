import { useCallback, useEffect, useState } from "react";
import { Search, Smartphone, Trash2 } from "lucide-react";
import { PhotoAvatar, SkeletonList } from "./shared";
import { confirmNative, haptic } from "./tg";

/*
 * IT / HR — qurilmalar (Mini App): xodimlarning ulangan telefonlari, telefon almashtirish so‘rovlari
 * (tasdiqlash / rad etish) va telefonni o‘chirish. Panel API’lari — huquq serverda tekshiriladi.
 */

type Call = <T>(url: string, body?: unknown, method?: string) => Promise<T>;
type Toast = (text: string, tone?: "ok" | "error") => void;
type Device = { id: string; platform: string; model?: string; appVersion?: string; lastSeenAt?: string; createdAt: string; push: boolean; employeeName: string; employeeNo?: string; branch?: string; photoDataUrl?: string };
type DeviceRequest = { id: string; employeeName: string; platform: string; model?: string; createdAt: string; oldDevice?: { model?: string; platform: string } };

const ago = (iso?: string) => {
  if (!iso) return "—";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 60 ? `${m} daq oldin` : m < 1440 ? `${Math.round(m / 60)} soat oldin` : `${Math.round(m / 1440)} kun oldin`;
};

export function DevicesView({ call, onToast }: { call: Call; onToast: Toast }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [requests, setRequests] = useState<DeviceRequest[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fail = useCallback((e: unknown) => onToast(e instanceof Error ? e.message : "Xatolik", "error"), [onToast]);
  const load = useCallback(() => {
    call<{ rows: Device[] }>("/mobile-devices")
      .then((r) => setDevices(r.rows))
      .catch((e) => (setDevices([]), fail(e)));
    call<DeviceRequest[]>("/mobile/device-requests?status=PENDING")
      .then(setRequests)
      .catch(() => setRequests([]));
  }, [call, fail]);
  useEffect(load, [load]);

  const decide = async (r: DeviceRequest, approve: boolean) => {
    if (!approve && !(await confirmNative(`${r.employeeName} — yangi telefon so‘rovi rad etilsinmi?`, { ok: "Rad etish", destructive: true }))) return;
    setBusy(r.id);
    try {
      await call(`/mobile/device-requests/${r.id}/decide`, { approve });
      haptic.success();
      onToast(approve ? "Yangi telefon tasdiqlandi" : "Rad etildi");
      load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const revoke = async (d: Device) => {
    if (!(await confirmNative(`${d.employeeName} — ${d.model || d.platform} o‘chirilsinmi? Boshqa xodim shu telefondan kira oladi.`, { ok: "O‘chirish", destructive: true }))) return;
    setBusy(d.id);
    try {
      await call(`/mobile-devices/${d.id}/revoke`, { reason: "IT/HR Mini App’dan o‘chirdi" });
      haptic.success();
      load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const list = (devices || []).filter((d) => `${d.employeeName} ${d.employeeNo || ""} ${d.model || ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <section className="mf-stats">
        <div>
          <small>Ulangan telefonlar</small>
          <b>{devices?.length ?? "…"}</b>
        </div>
        <div className={requests.length ? "bad" : ""}>
          <small>Almashtirish so‘rovlari</small>
          <b>{requests.length}</b>
        </div>
      </section>
      {requests.length > 0 && <div className="mp-group-title">Telefon almashtirish so‘rovlari</div>}
      {requests.map((r) => (
        <article className="mg-req" key={r.id}>
          <div className="mg-req-head">
            <span className="mini-ico">
              <Smartphone size={17} />
            </span>
            <span>
              <b>{r.employeeName}</b>
              <small>
                Yangi: {r.model || r.platform} · {ago(r.createdAt)}
                {r.oldDevice ? ` · eski: ${r.oldDevice.model || r.oldDevice.platform}` : ""}
              </small>
            </span>
          </div>
          <div className="mg-actions">
            <button className="mini-btn sm" disabled={busy === r.id} onClick={() => void decide(r, true)}>
              Tasdiqlash
            </button>
            <button className="mini-btn sm ghost" disabled={busy === r.id} onClick={() => void decide(r, false)}>
              Rad etish
            </button>
          </div>
        </article>
      ))}
      <label className="md-search">
        <Search size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xodim yoki telefon" />
      </label>
      <section className="mini-card">
        {devices === null ? (
          <SkeletonList rows={4} />
        ) : !list.length ? (
          <div className="mini-empty">Ulangan telefon yo‘q</div>
        ) : (
          <div className="mini-rows">
            {list.map((d) => {
              const [firstName = "", lastName = ""] = d.employeeName.split(" ");
              return (
                <div className="mini-row" key={d.id}>
                  <PhotoAvatar employee={{ firstName, lastName, photoDataUrl: d.photoDataUrl }} />
                  <span>
                    <b>{d.employeeName}</b>
                    <small>
                      {d.model || d.platform}
                      {d.appVersion ? ` · v${d.appVersion}` : ""} · {ago(d.lastSeenAt || d.createdAt)}
                      {!d.push ? " · push yo‘q" : ""}
                    </small>
                  </span>
                  <button className="mini-icon-btn danger" aria-label="O‘chirish" disabled={busy === d.id} onClick={() => void revoke(d)}>
                    <Trash2 size={17} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
