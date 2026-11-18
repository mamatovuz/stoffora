import type { Attendance, PayRate, PayType, PayrollSettings } from "./types";
import type { PayrollLine } from "./payroll";
import { normalizePayrollSettings } from "./payroll";

/*
 * Ish haqi turlari (oylikdan tashqari): kunlik, soatbay va ishbay. Oylik — lib/payroll.ts calculatePayroll.
 *   Kunlik  = tasdiqlangan (kirish VA chiqish bor) ish kunlari × kunlik stavka
 *   Soatbay = yopiq intervallardagi haqiqiy ish vaqti × soatlik stavka (ochiq kirish — istisno, pul emas)
 *   Ishbay  = tasdiqlangan miqdor × birlik narxi (yozuvlar yig‘indisi)
 * Soatbay va ishbayda kechikish ushlanmasi qo‘llanmaydi: ishlanmagan vaqt allaqachon to‘lanmaydi —
 * ikki marta jarima bo‘lmasin. Barcha summalar butun so‘mga yaxlitlanadi (floating xatosiz saqlash).
 */

export const PAY_TYPE_LABEL: Record<PayType, string> = { MONTHLY: "Oylik", DAILY: "Kunlik", HOURLY: "Soatbay", PIECE: "Ishbay" };

/** Sanada amal qilayotgan stavka: eng so‘nggi `effectiveFrom <= sana`. Yozuv bo‘lmasa — xodim kartasidagi oylik. */
export function effectiveRate(rates: Pick<PayRate, "employeeId" | "payType" | "rate" | "effectiveFrom" | "createdAt">[], employee: { id: string; baseSalary: number }, onDate: string) {
  const found = rates
    .filter((r) => r.employeeId === employee.id && r.effectiveFrom <= onDate)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt))[0];
  return found ? { payType: found.payType, rate: Math.max(0, Math.round(found.rate)), effectiveFrom: found.effectiveFrom as string | undefined } : { payType: "MONTHLY" as PayType, rate: Math.max(0, Math.round(employee.baseSalary || 0)), effectiveFrom: undefined };
}

export type TypedPayLine = PayrollLine & {
  payType: PayType;
  rate: number;
  /** Kunlik — to‘langan kunlar; soatbay — soatlar (0,01); ishbay — jami miqdor. */
  units: number;
  /** Chiqish belgilanmagan o‘tgan kunlar — hisoblanmaydi, tekshirish kerak. */
  openDays: string[];
};

type Rec = Pick<Attendance, "date" | "checkIn" | "checkOut" | "lateMinutes" | "workedMinutes" | "overtimeMinutes" | "overtimeApproved">;
const som = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} so‘m`;

export function calculateTypedPay(
  input: {
    payType: Exclude<PayType, "MONTHLY">;
    rate: number;
    records: Rec[];
    /** Bugungi sana (YYYY-MM-DD): bugungi ochiq kirish — «ishda», istisno emas. */
    today: string;
    workingDays: number;
    pieceAmount?: number;
    pieceQuantity?: number;
    bonus?: number;
    fine?: number;
    advance?: number;
  },
  settingsInput?: Partial<PayrollSettings>,
): TypedPayLine {
  const settings = normalizePayrollSettings(settingsInput);
  const rate = Math.max(0, Math.round(input.rate || 0));
  const present = input.records.filter((r) => r.checkIn);
  const complete = present.filter((r) => r.checkOut);
  const openDays = present.filter((r) => !r.checkOut && r.date < input.today).map((r) => r.date);
  const lateMinutes = present.reduce((s, r) => s + Math.max(0, Math.round(r.lateMinutes || 0)), 0);
  const lateDays = present.filter((r) => (r.lateMinutes || 0) > 0).length;
  const workedMinutes = complete.reduce((s, r) => s + Math.max(0, Math.round(r.workedMinutes || 0)), 0);
  const approved = (r: Rec) => !settings.overtimeRequiresApproval || r.overtimeApproved === true;
  const overtimeMinutes = complete.filter(approved).reduce((s, r) => s + Math.max(0, Math.round(r.overtimeMinutes || 0)), 0);
  const pendingOvertimeMinutes = settings.overtimeRequiresApproval ? complete.filter((r) => r.overtimeApproved === undefined).reduce((s, r) => s + Math.max(0, r.overtimeMinutes || 0), 0) : 0;
  const overtimeFactor = (settings.overtimeRatePercent ?? 100) / 100;
  const chargeableLateMinutes = Math.max(0, lateMinutes - settings.freeLateMinutesPerMonth);

  let base = 0;
  let units = 0;
  let hourlyRate = 0;
  let overtimeAmount = 0;
  let deduction = 0;
  if (input.payType === "DAILY") {
    units = complete.length;
    base = rate * units;
    const dayHours = input.workingDays ? settings.monthlyHours / input.workingDays : 8;
    hourlyRate = dayHours > 0 ? rate / dayHours : 0;
    if (settings.overtimePay) overtimeAmount = Math.round((overtimeMinutes / 60) * hourlyRate * overtimeFactor);
    const raw = settings.latePenaltyMode === "PER_MINUTE" ? chargeableLateMinutes * settings.latePenaltyPerMinute : settings.latePenaltyMode === "HOURLY" ? (chargeableLateMinutes / 60) * hourlyRate : 0;
    deduction = Math.min(base, Math.round(raw));
  } else if (input.payType === "HOURLY") {
    units = Math.round((workedMinutes / 60) * 100) / 100;
    base = Math.round((rate * workedMinutes) / 60);
    hourlyRate = rate;
    // Ish vaqtiga qo‘shimcha ish ham kirgan — faqat oshirilgan stavka farqi qo‘shiladi.
    if (settings.overtimePay && overtimeFactor > 1) overtimeAmount = Math.round((overtimeMinutes / 60) * rate * (overtimeFactor - 1));
  } else {
    units = Math.round((input.pieceQuantity || 0) * 100) / 100;
    base = Math.max(0, Math.round(input.pieceAmount || 0));
  }
  const bonus = Math.max(0, Math.round(input.bonus || 0));
  const fine = Math.max(0, Math.round(input.fine || 0));
  const advance = Math.max(0, Math.round(input.advance || 0));
  const gross = Math.max(0, base + overtimeAmount + bonus - deduction - fine);
  const net = Math.max(0, gross - advance);

  const head =
    input.payType === "DAILY"
      ? `Kunlik: ${units} kun × ${som(rate)} = ${som(base)}`
      : input.payType === "HOURLY"
        ? `Soatbay: ${String(units).replace(".", ",")} soat × ${som(rate)} = ${som(base)}`
        : `Ishbay: tasdiqlangan natijalar ${som(base)}`;
  const parts = [head];
  if (overtimeAmount) parts.push(`+${som(overtimeAmount)} qo‘shimcha ish`);
  if (bonus) parts.push(`+${som(bonus)} bonus`);
  if (deduction) parts.push(`−${som(deduction)} kechikish`);
  if (fine) parts.push(`−${som(fine)} jarima`);
  if (advance) parts.push(`−${som(advance)} avans`);
  if (openDays.length) parts.push(`${openDays.length} kun chiqish belgilanmagan — hisoblanmadi`);

  return {
    base,
    days: present.length,
    lateDays,
    lateMinutes,
    chargeableLateMinutes: input.payType === "DAILY" ? chargeableLateMinutes : 0,
    workedMinutes,
    overtimeMinutes,
    pendingOvertimeMinutes,
    hourlyRate,
    dailyRate: input.payType === "DAILY" ? rate : 0,
    overtimeAmount,
    deduction,
    absentDays: 0,
    absenceDeduction: 0,
    bonus,
    fine,
    advance,
    gross,
    net,
    explanation: `${parts.join(" · ")}. Qo‘lga: ${som(net)}.`,
    payType: input.payType,
    rate,
    units,
    openDays,
  };
}
