import type { Attendance, PayrollSettings } from "./types";

export const defaultPayrollSettings: PayrollSettings = {
  latePenaltyMode: "HOURLY",
  latePenaltyPerMinute: 1000,
  freeLateMinutesPerMonth: 0,
  monthlyHours: 176,
  overtimePay: true,
  absencePenalty: "NONE",
  overtimeRequiresApproval: false,
};

export function normalizePayrollSettings(
  value?: Partial<PayrollSettings>,
): PayrollSettings {
  const merged = { ...defaultPayrollSettings, ...(value || {}) };
  const int = (n: unknown, min: number, max: number, fallback: number) => {
    const x = Math.round(Number(n));
    return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback;
  };
  return {
    latePenaltyMode: ["NONE", "HOURLY", "PER_MINUTE"].includes(merged.latePenaltyMode)
      ? merged.latePenaltyMode
      : "HOURLY",
    latePenaltyPerMinute: int(merged.latePenaltyPerMinute, 0, 10_000_000, 1000),
    freeLateMinutesPerMonth: int(merged.freeLateMinutesPerMonth, 0, 10_000, 0),
    monthlyHours: int(merged.monthlyHours, 1, 400, 176),
    overtimePay: Boolean(merged.overtimePay),
    absencePenalty: merged.absencePenalty === "DAILY" ? "DAILY" : "NONE",
    overtimeRequiresApproval: Boolean(merged.overtimeRequiresApproval),
    advanceRequestsEnabled: merged.advanceRequestsEnabled !== false,
    advanceMaxPercent: int(merged.advanceMaxPercent ?? 50, 0, 100, 50),
    advanceHrApproval: merged.advanceHrApproval !== false,
    absenceCompensation: merged.absenceCompensation !== false,
  };
}

export type PayrollExtras = {
  /** Sababsiz kelmagan kunlar (mashq, ta’til, dam olish hisobga kirmaydi). */
  absentDays?: number;
  /** Oydagi rejalashtirilgan ish kunlari — kunlik stavka shundan. */
  workingDays?: number;
  bonus?: number;
  fine?: number;
  advance?: number;
};

export type PayrollLine = {
  base: number;
  days: number;
  lateDays: number;
  lateMinutes: number;
  chargeableLateMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  /** Tasdiq kutilayotgan qo‘shimcha ish (hali pul emas). */
  pendingOvertimeMinutes: number;
  hourlyRate: number;
  dailyRate: number;
  overtimeAmount: number;
  /** Kechikish ushlanmasi (eski nom saqlangan). */
  deduction: number;
  absentDays: number;
  absenceDeduction: number;
  bonus: number;
  fine: number;
  advance: number;
  /** Hisoblangan (avansdan oldin). */
  gross: number;
  /** Qo‘lga beriladi. */
  net: number;
  explanation: string;
};

const som = (value: number) =>
  `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;

/**
 * Bitta xodimning oylik hisob-kitobi. Barcha summalar butun so‘mga yaxlitlanadi.
 *   hisoblangan = oylik + qo‘shimcha ish + bonus − kechikish − kelmaslik − jarima (≥ 0)
 *   qo‘lga      = hisoblangan − avans (≥ 0)
 */
export function calculatePayroll(
  baseSalary: number,
  records: Pick<Attendance, "checkIn" | "lateMinutes" | "workedMinutes" | "overtimeMinutes" | "overtimeApproved">[],
  settingsInput?: Partial<PayrollSettings>,
  extras: PayrollExtras = {},
): PayrollLine {
  const settings = normalizePayrollSettings(settingsInput);
  const base = Math.max(0, Math.round(baseSalary || 0));
  const present = records.filter((r) => r.checkIn);
  const lateMinutes = present.reduce((s, r) => s + Math.max(0, Math.round(r.lateMinutes || 0)), 0);
  const lateDays = present.filter((r) => (r.lateMinutes || 0) > 0).length;
  const workedMinutes = present.reduce((s, r) => s + Math.max(0, r.workedMinutes || 0), 0);
  const approved = (r: (typeof present)[number]) => !settings.overtimeRequiresApproval || r.overtimeApproved === true;
  const overtimeMinutes = present.filter(approved).reduce((s, r) => s + Math.max(0, r.overtimeMinutes || 0), 0);
  const pendingOvertimeMinutes = settings.overtimeRequiresApproval
    ? present.filter((r) => r.overtimeApproved === undefined).reduce((s, r) => s + Math.max(0, r.overtimeMinutes || 0), 0)
    : 0;
  const hourlyRate = base / settings.monthlyHours;
  const chargeableLateMinutes = Math.max(0, lateMinutes - settings.freeLateMinutesPerMonth);

  let rawDeduction = 0;
  if (settings.latePenaltyMode === "PER_MINUTE") rawDeduction = chargeableLateMinutes * settings.latePenaltyPerMinute;
  else if (settings.latePenaltyMode === "HOURLY") rawDeduction = (chargeableLateMinutes / 60) * hourlyRate;
  const overtimeAmount = settings.overtimePay ? Math.round((overtimeMinutes / 60) * hourlyRate) : 0;
  const deduction = Math.min(base, Math.round(rawDeduction));

  const absentDays = Math.max(0, Math.round(extras.absentDays || 0));
  const workingDays = Math.max(0, Math.round(extras.workingDays || 0));
  const dailyRate = workingDays ? base / workingDays : 0;
  const absenceDeduction =
    settings.absencePenalty === "DAILY" && dailyRate ? Math.min(Math.max(0, base - deduction), Math.round(absentDays * dailyRate)) : 0;
  const bonus = Math.max(0, Math.round(extras.bonus || 0));
  const fine = Math.max(0, Math.round(extras.fine || 0));
  const advance = Math.max(0, Math.round(extras.advance || 0));
  const gross = Math.max(0, base + overtimeAmount + bonus - deduction - absenceDeduction - fine);
  const net = Math.max(0, gross - advance);

  const parts: string[] = [`Oylik ${som(base)}`];
  if (overtimeAmount) parts.push(`+${som(overtimeAmount)} qo‘shimcha ish`);
  if (bonus) parts.push(`+${som(bonus)} bonus`);
  if (deduction) parts.push(`−${som(deduction)} kechikish (${lateMinutes} daq)`);
  else if (lateMinutes)
    parts.push(`${lateMinutes} daq kechikish — ${settings.latePenaltyMode === "NONE" ? "jarima o‘chirilgan" : `${settings.freeLateMinutesPerMonth} daqiqagacha jarimasiz`}`);
  if (absenceDeduction) parts.push(`−${som(absenceDeduction)} kelmagan ${absentDays} kun`);
  if (fine) parts.push(`−${som(fine)} jarima`);
  if (advance) parts.push(`−${som(advance)} avans berilgan`);
  const explanation =
    parts.length === 1
      ? `Oylik ${som(base)}. Kechikish va ushlanma yo‘q — to‘liq to‘lanadi.`
      : `${parts.join(" · ")}. Qo‘lga: ${som(net)}.`;

  return {
    base,
    days: present.length,
    lateDays,
    lateMinutes,
    chargeableLateMinutes,
    workedMinutes,
    overtimeMinutes,
    pendingOvertimeMinutes,
    hourlyRate,
    dailyRate,
    overtimeAmount,
    deduction,
    absentDays,
    absenceDeduction,
    bonus,
    fine,
    advance,
    gross,
    net,
    explanation,
  };
}

/** Davomat KPI: kelish darajasi, vaqtida kelish va umumiy ball (0–100). */
export function attendanceKpi(input: {
  expectedDays: number;
  presentDays: number;
  lateDays: number;
}) {
  const attendance = input.expectedDays
    ? Math.min(1, input.presentDays / input.expectedDays)
    : 1;
  const punctuality = input.presentDays
    ? Math.max(0, (input.presentDays - input.lateDays) / input.presentDays)
    : input.expectedDays
      ? 0
      : 1;
  const score = Math.round((attendance * 0.6 + punctuality * 0.4) * 100);
  return {
    attendance: Math.round(attendance * 100),
    punctuality: Math.round(punctuality * 100),
    score,
    grade: score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D",
  };
}
