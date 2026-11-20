import { useState } from "react";
import {
  AlarmClock,
  AlertCircle,
  ArrowLeftRight,
  Bell,
  Cake,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarSync,
  FileText,
  HandCoins,
  Hourglass,
  IdCard,
  MessageCircleQuestion,
  Plane,
  Receipt,
  Timer,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { errorText, post } from "../../api";
import { duration } from "@/lib/format";
import type { DeepLink } from "@/lib/mini";
import { Catalog, type CatalogGroup, type CatalogItem } from "./Catalog";
import { miniModuleOn, Sheet, todayPlanOf, type HomeData, type Toast } from "./shared";
import { haptic, shareText } from "./tg";

/*
 * «Bo‘limlar» — xodimning barcha imkoniyatlari bitta katalogda (bosh sahifa faqat keldi-ketdi va oylik).
 * Har bir bo‘lim super admin modullari va kompaniya sozlamalariga qarab ko‘rinadi.
 */

export function MiniSections({
  data,
  offline,
  initialView,
  onOpen,
  onToast,
  onRefresh,
}: {
  data: HomeData;
  offline?: boolean;
  /** «late» — bot havolasidan: «Kechikaman» oynasi darhol ochiladi. */
  initialView?: string;
  onOpen: (link: DeepLink) => void;
  onToast: Toast;
  onRefresh: () => Promise<unknown>;
}) {
  const f = data.features;
  const on = (key: string) => miniModuleOn(f, key);
  const a = data.attendance;
  const day = todayPlanOf(data);
  const missingSetup = !data.branch || !data.schedule;
  const canLate = !a?.checkIn && !data.todayLeave && Boolean(day?.enabled) && !missingSetup && !offline;
  const [lateOpen, setLateOpen] = useState(() => initialView === "late" && canLate && !data.lateNotice);

  const item = (key: string, label: string, icon: CatalogItem["icon"], link: DeepLink, badge?: number): CatalogItem => ({ key, label, icon, badge, onClick: () => onOpen(link) });
  const groups: CatalogGroup[] = [
    {
      title: "Davomat",
      items: [
        item("calendar", "Kalendar", CalendarDays, { tab: "history", view: "calendar" }),
        item("schedule", "Ish grafigi", CalendarRange, { tab: "history", view: "schedule" }),
        item("stats", "Statistika", TrendingUp, { tab: "history", view: "stats" }),
        ...(on("attendanceRequests") ? [item("marks", "Belgilash so‘rovi", CalendarClock, { tab: "leave", view: "marks" })] : []),
        ...(canLate
          ? [
              {
                key: "late",
                label: "Kechikaman",
                icon: Hourglass,
                onClick: () => {
                  haptic.select();
                  if (data.lateNotice) onToast(`Rahbaringiz ogohlantirilgan: ~${duration(data.lateNotice.minutes)} kechikasiz`);
                  else setLateOpen(true);
                },
              },
            ]
          : []),
      ],
    },
    {
      title: "So‘rovlar",
      items: [
        ...(on("leave") ? [item("leave", "Ta’til", Plane, { tab: "leave", view: "leave" })] : []),
        ...(on("attendanceRequests") ? [item("dayoff", "Dam olish kuni", CalendarSync, { tab: "leave", view: "dayoff" })] : []),
        item("swap", "Smena almashish", ArrowLeftRight, { tab: "leave", view: "swap" }),
        // «Qo‘shimcha ish uchun to‘lash» o‘chiq — kech qolish hech narsani o‘zgartirmaydi, bo‘lim ham yo‘q.
        ...(f?.overtime !== false ? [item("overtime", "Qo‘shimcha ish", Timer, { tab: "leave", view: "overtime" })] : []),
        ...(f?.advances && on("payroll") && on("advances") ? [item("advance", "Avans", HandCoins, { tab: "home", action: "advance" })] : []),
      ],
    },
    {
      title: "Moliya",
      items: on("payroll")
        ? [item("salary", "Oylik", Wallet, { tab: "home", action: "salary" }), item("payslips", "Hisob varaqalar", Receipt, { tab: "profile", section: "payslips" })]
        : [],
    },
    {
      title: "Boshqa",
      items: [
        item("notifs", "Xabarlar", Bell, { tab: "home", action: "notifs" }, data.unreadNotifications || 0),
        ...(f?.directory !== false ? [item("directory", "Hamkasblar", Users, { tab: "profile", section: "directory" })] : []),
        item("badge", "ID karta", IdCard, { tab: "badge" }),
        item("birthdays", "Tug‘ilgan kunlar", Cake, { tab: "profile", section: "birthdays" }),
        ...(on("helpdesk") ? [item("helpdesk", "HR’ga savol", MessageCircleQuestion, { tab: "profile", section: "helpdesk" })] : []),
        item("docs", "Hujjatlar", FileText, { tab: "profile", section: "docs" }),
        item("reminders", "Eslatmalar", AlarmClock, { tab: "profile", section: "reminders" }),
      ],
    },
  ];

  return (
    <div className="mini-body sec">
      <h1 className="sec-title">Bo‘limlar</h1>
      <Catalog groups={groups} />
      {lateOpen && (
        <LateSheet
          start={day?.start || ""}
          name={`${data.employee.firstName} ${data.employee.lastName}`}
          onClose={() => setLateOpen(false)}
          onSaved={async (sent) => {
            setLateOpen(false);
            onToast(sent ? "Rahbaringiz ogohlantirildi" : "Ogohlantirish saqlandi — HR panelida ko‘rinadi");
            haptic.success();
            await onRefresh();
          }}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------- kechikaman --- */
function LateSheet({ start, name, onClose, onSaved }: { start: string; name: string; onClose: () => void; onSaved: (sent: boolean) => void }) {
  const [minutes, setMinutes] = useState(15);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const presets = ["Tirbandlik", "Transport kechikdi", "Shifokorda", "Oilaviy sabab"];
  async function save() {
    if (reason.trim().length < 3) return setError("Sababni qisqacha yozing.");
    setBusy(true);
    setError("");
    try {
      const result = await post<{ managersNotified: number }>("/mini/late-notice", { minutes, reason: reason.trim() });
      onSaved(result.managersNotified > 0);
    } catch (reason) {
      setError(errorText(reason, "Yuborilmadi."));
      haptic.error();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title="Kechikaman"
      subtitle={start ? `Ish ${start} da boshlanadi · rahbaringizga xabar boradi` : "Rahbaringizga xabar boradi"}
      onClose={onClose}
      primary={{ text: `~${minutes} daqiqaga kechikaman`, onClick: () => void save(), busy, disabled: reason.trim().length < 3 }}
      secondary={{
        text: "Hamkasbga ulashish",
        onClick: () => void shareText("Kechikaman", `⏳ ${name}: ishga ~${duration(minutes)} kechikaman.${reason.trim() ? ` Sabab: ${reason.trim()}` : ""}`),
      }}
    >
      <div className="ml-minutes" role="radiogroup" aria-label="Necha daqiqa">
        {[5, 10, 15, 30, 45, 60, 90].map((value) => (
          <button
            key={value}
            role="radio"
            aria-checked={minutes === value}
            className={minutes === value ? "on" : ""}
            onClick={() => {
              haptic.select();
              setMinutes(value);
            }}
          >
            {value < 60 ? `${value} daq` : `${value / 60} soat`.replace("1.5", "1,5")}
          </button>
        ))}
      </div>
      <div className="ms-chips">
        {presets.map((text) => (
          <button type="button" key={text} onClick={() => setReason(text)}>
            {text}
          </button>
        ))}
      </div>
      <label className="ml-field">
        Sabab
        <textarea value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: avtobus kechikdi" />
      </label>
      {error && (
        <div className="mini-alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
    </Sheet>
  );
}
