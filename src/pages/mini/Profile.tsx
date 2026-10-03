import { useEffect, useRef, useState } from "react";
import { Cake, ChevronRight, Fingerprint, ListChecks, ListTodo, MapPin, MessageCircleQuestion, ScrollText, Share2, Smile, TriangleAlert, Users } from "lucide-react";
import type { HelpdeskView } from "./Helpdesk";
import type { WorkView } from "./Work";
import { MobileLinkRow } from "./MobileLink";
import { MiniReminders } from "./Reminders";
import { dateUz, tashkentWeekday } from "@/lib/format";
import type { Lang } from "../../i18n";
import { weekdayShort, weekOrder } from "../../types";
import { MiniDocuments, MiniPayslips } from "../MiniExtras";
import type { MiniPrefs } from "../miniPrefs";
import type { BioInfo } from "./biometric";
import { biometricLabel } from "./biometric";
import { PhotoAvatar, type HomeData, type Toast } from "./shared";
import { confirmNative, haptic, openExternal, shareText, supports, tg } from "./tg";

/** «09:00» → «9», «09:30» → «9:30» — haftalik jadval tor ustunlarga sig‘sin. */
const short = (hhmm: string) => (hhmm.endsWith(":00") ? String(Number(hhmm.slice(0, 2))) : hhmm.replace(/^0/, ""));

export type ProfileSection = "docs" | "payslips" | "settings" | "directory" | "helpdesk" | "birthdays";

export function MiniProfile({
  data,
  onToast,
  lang,
  onLang,
  prefs,
  onPrefs,
  section,
  focusId,
  bio,
  onBiometric,
  emojiStatus,
  onEmojiStatus,
  onDirectory,
  onHelpdesk,
  onWork,
  onBirthdays,
}: {
  data: HomeData;
  onToast: Toast;
  lang: Lang;
  onLang: (lang: Lang) => void;
  prefs: MiniPrefs;
  onPrefs: (prefs: MiniPrefs) => void;
  section?: ProfileSection;
  focusId?: string;
  bio: BioInfo | null;
  onBiometric: (enable: boolean) => void;
  emojiStatus: boolean;
  onEmojiStatus: (enable: boolean) => void;
  onDirectory: () => void;
  onHelpdesk: (view: HelpdeskView) => void;
  onWork: (view: WorkView) => void;
  onBirthdays: () => void;
}) {
  const [homeScreen, setHomeScreen] = useState<"unsupported" | "unknown" | "added" | "missed">("unsupported");
  useEffect(() => {
    const webApp = tg();
    if (!supports("8.0") || !webApp?.checkHomeScreenStatus) return;
    try {
      webApp.checkHomeScreenStatus((status) => setHomeScreen(status));
    } catch {
      /* qo‘llab-quvvatlanmaydi */
    }
    const onAdded = () => setHomeScreen("added");
    webApp.onEvent?.("homeScreenAdded", onAdded);
    return () => webApp.offEvent?.("homeScreenAdded", onAdded);
  }, []);
  // Chuqur havola yoki «Sozlamalar» tugmasi — kerakli bo‘limga aylantiramiz.
  const settingsRef = useRef<HTMLDivElement>(null);
  const docsRef = useRef<HTMLDivElement>(null);
  const payslipsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = section === "settings" ? settingsRef : section === "docs" ? docsRef : section === "payslips" ? payslipsRef : null;
    if (target) window.setTimeout(() => target.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
  }, [section]);

  const e = data.employee;
  const days = Math.max(0, Math.floor((Date.now() - new Date(`${e.startDate}T00:00:00+05:00`).getTime()) / 86_400_000));
  const tenure = days < 31 ? `${days} kun` : days < 365 ? `${Math.floor(days / 30.44)} oy` : `${Math.floor(days / 365.25)} yil ${Math.floor((days % 365.25) / 30.44)} oy`;
  const today = tashkentWeekday();
  const salary = e.baseSalary ? `${e.baseSalary.toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m` : "—";
  const deduction = data.month.deduction ? `−${data.month.deduction.toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m` : "0";
  const mapUrl = data.branch && data.branch.latitude ? `https://maps.google.com/?q=${data.branch.latitude},${data.branch.longitude}` : undefined;
  const features = data.features;
  const bioAllowed = Boolean(features?.biometric && bio?.available);
  const bioOn = Boolean(bio?.tokenSaved && features?.biometricRegistered);
  const premium = Boolean(tg()?.initDataUnsafe?.user?.is_premium);

  return (
    <div className="mini-body mp">
      <div className="mp-head">
        <PhotoAvatar employee={e} className="mp-avatar" />
        <h1>
          {e.firstName} {e.lastName}
        </h1>
        <p>{data.position?.name || "Lavozim belgilanmagan"}</p>
        <div className="mp-chips">
          <span>🆔 {e.employeeNo}</span>
          <span>⏳ {tenure}</span>
          <span className={e.faceEnrolledAt ? "ok" : ""}>{e.faceEnrolledAt ? "✓ Face ID" : "Face ID yo‘q"}</span>
          {bioOn && <span className="ok">✓ {bio?.type === "face" ? "Telefon yuzi" : "Barmoq izi"}</span>}
        </div>
      </div>

      <div className="mp-group-title">Bu oy</div>
      <section className="mp-group mp-month">
        <div>
          <b>{data.month.days}</b>
          <small>kun keldi</small>
        </div>
        <div>
          <b className={data.month.lateMinutes ? "warn" : ""}>{data.month.lateMinutes}</b>
          <small>daq kechikish</small>
        </div>
        <div>
          <b>{Math.round(data.month.workedMinutes / 60)}</b>
          <small>soat ishladi</small>
        </div>
      </section>
      <section className="mp-group">
        <div className="mp-row">
          <span>Oylik</span>
          <b>{salary}</b>
        </div>
        <div className="mp-row">
          <span>Kechikish ushlanmasi</span>
          <b className={data.month.deduction ? "warn" : ""}>{deduction}</b>
        </div>
      </section>

      <div className="mp-group-title">Ish joyi</div>
      <section className="mp-group">
        <div className="mp-row">
          <span>Kompaniya</span>
          <b>{data.company?.name || "—"}</b>
        </div>
        <div className="mp-row">
          <span>Bo‘lim</span>
          <b>{data.department?.name || "—"}</b>
        </div>
        {data.branch && (
          <button className="mp-row link" onClick={() => mapUrl && openExternal(mapUrl)}>
            <span>Filial</span>
            <b>
              {data.branch.name}
              {mapUrl && <MapPin size={14} />}
            </b>
          </button>
        )}
        <div className="mp-row">
          <span>Ish boshlagan</span>
          <b>{dateUz(e.startDate)}</b>
        </div>
        {features?.directory !== false && (
          <button className="mp-row link" onClick={onDirectory}>
            <span>
              <Users size={15} /> Hamkasblar ma’lumotnomasi
            </span>
            <ChevronRight size={16} />
          </button>
        )}
      </section>

      <div className="mp-group-title">Ishlarim</div>
      <section className="mp-group">
        <button className="mp-row link" onClick={() => onWork("tasks")}>
          <span>
            <ListTodo size={15} /> Vazifalar
          </span>
          <ChevronRight size={16} />
        </button>
        <button className="mp-row link" onClick={() => onWork("checklist")}>
          <span>
            <ListChecks size={15} /> Bugungi checklist
          </span>
          <ChevronRight size={16} />
        </button>
        <button className="mp-row link" onClick={() => onWork("incidents")}>
          <span>
            <TriangleAlert size={15} /> Muammo haqida xabar berish
          </span>
          <ChevronRight size={16} />
        </button>
      </section>

      <div className="mp-group-title">HR bilan aloqa</div>
      <section className="mp-group">
        <button className="mp-row link" onClick={() => onHelpdesk("questions")}>
          <span>
            <MessageCircleQuestion size={15} /> HR’ga savol berish
          </span>
          <ChevronRight size={16} />
        </button>
        <button className="mp-row link" onClick={() => onHelpdesk("certificates")}>
          <span>
            <ScrollText size={15} /> Ma’lumotnoma (spravka) so‘rash
          </span>
          <ChevronRight size={16} />
        </button>
        <button className="mp-row link" onClick={() => onHelpdesk("feedback")}>
          <span>
            <Share2 size={15} /> Taklif yoki shikoyat (anonim mumkin)
          </span>
          <ChevronRight size={16} />
        </button>
        <button className="mp-row link" onClick={onBirthdays}>
          <span>
            <Cake size={15} /> Tug‘ilgan kunlar
          </span>
          <ChevronRight size={16} />
        </button>
      </section>

      <div className="mp-group-title">Mobil ilova</div>
      <section className="mp-group">
        <MobileLinkRow onToast={onToast} />
      </section>

      {data.schedule && (
        <>
          <div className="mp-group-title">Ish grafigi · {data.schedule.name}</div>
          <section className="mp-group mp-week">
            {weekOrder.map((day) => {
              const d = data.schedule!.days.find((x) => x.day === day);
              // Shaxsiy dam kuni grafikdagi ish kunidan ustun.
              const personal = Boolean(e.restDays?.includes(day));
              const working = Boolean(d?.enabled) && !personal;
              return (
                <div key={day} className={`${day === today ? "today" : ""} ${working ? "" : "off"} ${personal ? "personal" : ""}`}>
                  <span>{weekdayShort[day]}</span>
                  <b>{working && d ? `${short(d.start)}–${short(d.end)}` : "Dam"}</b>
                </div>
              );
            })}
          </section>
        </>
      )}

      <div ref={payslipsRef}>
        <MiniPayslips onToast={onToast} focusMonth={section === "payslips" ? focusId : undefined} />
      </div>
      <div ref={docsRef}>
        <MiniDocuments onToast={onToast} />
      </div>

      <div className="mp-group-title">Aloqa</div>
      <section className="mp-group">
        <div className="mp-row">
          <span>Telefon</span>
          <b>{e.phone || "—"}</b>
        </div>
        <div className="mp-row">
          <span>Telegram</span>
          <b>{e.telegramConnected ? "Ulangan ✓" : "Ulanmagan"}</b>
        </div>
      </section>

      <div ref={settingsRef} className="mp-group-title">
        Xavfsizlik va qulaylik
      </div>
      <section className="mp-group mp-prefs">
        {bioAllowed ? (
          <label className="mp-row mp-switch">
            <span>
              <Fingerprint size={15} /> {biometricLabel(bio!.type)} bilan tasdiqlash
              <small>Kamerasiz, 1 soniyada. Har {features?.faceEvery || 5}-belgida yuz ham tekshiriladi.</small>
            </span>
            <input
              type="checkbox"
              checked={bioOn}
              onChange={async (event) => {
                const enable = event.target.checked;
                if (!enable && !(await confirmNative("Biometriya o‘chirilsinmi? Keyin har safar Face ID bilan kamera orqali tasdiqlaysiz.", { ok: "O‘chirish", destructive: true }))) return;
                onBiometric(enable);
              }}
            />
          </label>
        ) : features?.biometric && bio && !bio.available && tg()?.initData ? (
          <div className="mp-row">
            <span>
              <Fingerprint size={15} /> Telefon biometriyasi
            </span>
            <b className="muted">Bu qurilmada yo‘q</b>
          </div>
        ) : null}
        {features?.workEmojiId && premium && (
          <label className="mp-row mp-switch">
            <span>
              <Smile size={15} /> Ishdaligimda Telegram statusi
              <small>Kelganda profilingizda «ishda» emoji-statusi chiqadi, ish tugashi bilan o‘chadi.</small>
            </span>
            <input type="checkbox" checked={emojiStatus} onChange={(event) => onEmojiStatus(event.target.checked)} />
          </label>
        )}
        <div className="mp-pref">
          <span>Mavzu</span>
          <div className="mini-seg three" role="radiogroup">
            {(
              [
                ["auto", "Avto"],
                ["light", "Yorug‘"],
                ["dark", "Tungi"],
              ] as const
            ).map(([value, label]) => (
              <button key={value} role="radio" aria-checked={prefs.theme === value} className={prefs.theme === value ? "on" : ""} onClick={() => onPrefs({ ...prefs, theme: value })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mp-pref">
          <span>Shrift</span>
          <div className="mini-seg" role="radiogroup">
            {(
              [
                ["normal", "Oddiy"],
                ["large", "Katta"],
              ] as const
            ).map(([value, label]) => (
              <button key={value} role="radio" aria-checked={prefs.font === value} className={prefs.font === value ? "on" : ""} onClick={() => onPrefs({ ...prefs, font: value })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="mp-row mp-switch">
          <span>Yuqori kontrast</span>
          <input type="checkbox" checked={prefs.contrast} onChange={(e) => onPrefs({ ...prefs, contrast: e.target.checked })} />
        </label>
        {(homeScreen === "missed" || homeScreen === "unknown") && (
          <button
            className="mp-row link mp-homescreen"
            onClick={() => {
              haptic.tap();
              tg()?.addToHomeScreen?.();
            }}
          >
            <span>📲 Telefon ekraniga Staffora yorlig‘ini qo‘shish</span>
            <ChevronRight size={16} />
          </button>
        )}
        {homeScreen === "added" && (
          <div className="mp-row">
            <span>Telefon ekranida yorliq</span>
            <b>Qo‘shilgan ✓</b>
          </div>
        )}
        <button
          className="mp-row link"
          onClick={() => void shareText("Staffora", `${data.company?.name || "Kompaniya"}da davomat, ta’til va oylikni Staffora ilovasida kuzataman. Telegram’da bot orqali oching.`)}
        >
          <span>
            <Share2 size={15} /> Hamkasbga ulashish
          </span>
          <ChevronRight size={16} />
        </button>
      </section>

      <MiniReminders onToast={onToast} />

      <div className="mp-group-title">Til</div>
      <section className="mp-group">
        <div className="mini-seg mp-lang" role="radiogroup" data-no-translate>
          <button role="radio" aria-checked={lang === "uz"} className={lang === "uz" ? "on" : ""} onClick={() => onLang("uz")}>
            🇺🇿 O‘zbekcha
          </button>
          <button role="radio" aria-checked={lang === "ru"} className={lang === "ru" ? "on" : ""} onClick={() => onLang("ru")}>
            🇷🇺 Русский
          </button>
        </div>
      </section>
      <p className="mp-note">Ma’lumotlarni o‘zgartirish uchun HR bo‘limiga murojaat qiling.</p>
    </div>
  );
}
