import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Banknote, Bot, Building2, Check, ClipboardList, Network, Send, UserPlus, Wallet, X } from "lucide-react";
import { useAuth } from "../auth";

export type SetupData = {
  setup: {
    branches: number;
    departments: number;
    positions: number;
    schedules: number;
    employees: number;
    telegramLinked: number;
    faceEnrolled: number;
    salaries: number;
    payrollConfigured: boolean;
    companyBot: boolean;
    panelUsers: number;
  };
  bot: { state: string; username?: string };
};

/** «Staffora’ni N qadamda sozlang» — yangi kompaniya uchun (egasi va HR). Ish stolida ham ko‘rinadi. */
export function SetupChecklist({ data }: { data: SetupData }) {
  const { user } = useAuth();
  // Yashirilgan bo‘lsa — yangi qadam bajarilgunicha ko‘rinmaydi.
  const [hiddenAt, setHiddenAt] = useState<number | null>(() => {
    try {
      const value = localStorage.getItem("staffora_hide_setup");
      return value === null ? null : Number(value);
    } catch {
      return null;
    }
  });
  const setup = data.setup;
  const steps = [
    {
      done: setup.schedules > 0,
      title: "Ish grafigini yarating",
      text: "Ish vaqti, tanaffus va kechikish imtiyozi",
      to: "/schedules",
      icon: ClipboardList,
    },
    {
      done: setup.branches > 0,
      title: "Filial qo‘shing",
      text: "Manzil, GPS nuqta va davomat radiusi",
      to: "/branches",
      icon: Building2,
    },
    {
      done: setup.departments > 0 && setup.positions > 0,
      title: "Bo‘lim va lavozimlar",
      text: "Tashkiliy tuzilmani belgilang",
      to: setup.departments ? "/positions" : "/departments",
      icon: Network,
    },
    {
      done: setup.employees > 0,
      title: "Xodimlarni qo‘shing",
      text: "Telefon raqami bilan — bot orqali ulanadi",
      to: "/employees/new",
      icon: UserPlus,
    },
    {
      done: setup.companyBot,
      title: "Ro‘yxat botini ulang",
      text: "Xodimlar botda anketa to‘ldirib o‘zlari qo‘shiladi",
      to: "/settings?tab=regbot",
      icon: Bot,
    },
    {
      done: setup.employees > 0 && setup.telegramLinked > 0,
      title: "Xodimlar Telegram’ni ulasin",
      text: data.bot.username
        ? `@${data.bot.username} → /start → telefon raqam`
        : "Bot tokenini sozlang",
      to: "/employees",
      icon: Send,
    },
    {
      done: setup.payrollConfigured,
      title: "Ish haqi qoidalari",
      text: "Kechikish jarimasi, qo‘shimcha ish, kelmaslik ushlanmasi",
      to: "/settings?tab=payroll",
      icon: Wallet,
    },
    {
      done: setup.employees > 0 && setup.salaries >= setup.employees,
      title: "Oyliklarni kiriting",
      text: `${setup.salaries} / ${setup.employees} xodimning oyligi kiritilgan`,
      to: "/payroll",
      icon: Banknote,
    },
  ];
  const setupDone = steps.filter((step) => step.done).length;
  const canSetup = user?.role === "COMPANY_OWNER" || user?.role === "HR_ADMIN";
  const hideSetup = hiddenAt !== null && hiddenAt >= setupDone;
  return (
    <>
      {canSetup && setupDone < steps.length && !hideSetup && (
        <section className="card onboarding">
          <div>
            <span className="badge blue plain">Boshlash</span>
            <button
              className="icon-btn onboarding-close"
              aria-label="Yashirish"
              title="Keyinroq"
              onClick={() => {
                setHiddenAt(setupDone);
                try {
                  localStorage.setItem("staffora_hide_setup", String(setupDone));
                } catch {
                  /* e’tiborsiz */
                }
              }}
            >
              <X size={16} />
            </button>
            <h2 style={{ marginTop: 10 }}>Sozlashni yakunlang · {setupDone} / {steps.length}</h2>
            <div className="progress" style={{ maxWidth: 320, marginTop: 10 }}>
              <i style={{ width: `${(setupDone / steps.length) * 100}%` }} />
            </div>
            {data.bot.state !== "running" && (
              <div className="alert warn" style={{ marginTop: 16 }}>
                <AlertTriangle size={18} />
                <div>
                  <b>Telegram bot ishlamayapti</b>
                  <p>
                    Serverda TELEGRAM_BOT_TOKEN va HTTPS APP_URL sozlanganini
                    tekshiring. Holat: {data.bot.state}.
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className="checklist">
            {steps.filter((step) => !step.done).map((step) => (
              <Link
                key={step.title}
                to={step.to}
                className="check-item"
              >
                <span className="check-dot">
                  <Check size={14} strokeWidth={3} />
                </span>
                <span>
                  <b>{step.title}</b>
                  <small>{step.text}</small>
                </span>
                <step.icon size={17} className="faint" />
              </Link>
            ))}
          </div>
        </section>
      )}

    </>
  );
}
