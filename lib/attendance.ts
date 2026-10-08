import type { Attendance, QrNonce } from "./types";
import { clockOnShiftDay, forwardMinutes, shiftWindow } from "./shift-time";

/** Keyingi kunga o‘tadigan davomatda eng uzun ish vaqti (kirish → chiqish). */
export const NEXT_DAY_MAX_MINUTES = 16 * 60;

/** Bir kun ichidagi farq (manfiy bo‘lsa 0). Smena hisoblari — `lib/shift-time`. */
export function minutesBetween(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

export function isValidClockTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/**
 * Chiqish kirishdan kichik bo‘lsa (14:00 → 00:30) — chiqish keyingi kunda deb olinadi.
 * Bunday holatda ish vaqti NEXT_DAY_MAX_MINUTES dan oshmasligi kerak (17:00 → 16:00 kabi xatoni ushlaydi).
 */
export function assertAttendanceTimeOrder(checkIn: string, checkOut?: string) {
  if (!isValidClockTime(checkIn) || (checkOut && !isValidClockTime(checkOut)))
    throw Object.assign(
      new Error("Vaqt HH:MM formatida va haqiqiy bo‘lishi kerak."),
      {
        status: 400,
      },
    );
  if (!checkOut) return;
  const worked = forwardMinutes(checkIn, checkOut);
  if (worked === 0 || (checkOut < checkIn && worked > NEXT_DAY_MAX_MINUTES))
    throw Object.assign(
      new Error("Chiqish vaqti kirish vaqtidan keyin bo‘lishi kerak (keyingi kunga o‘tsa — 16 soatgacha)."),
      { status: 400 },
    );
}

/**
 * Kechikish, erta ketish, ishlangan vaqt va qo‘shimcha ish — smena boshlangan ish
 * kuni o‘qida, shuning uchun kechasi tugaydigan smenalar ham to‘g‘ri:
 * 14:00 → 00:00, 18:00 → 02:00, 22:00 → 06:00, 23:30 → 00:30.
 */
export function calculateAttendance(input: {
  scheduledStart: string;
  scheduledEnd: string;
  checkIn: string;
  checkOut?: string;
  graceMinutes: number;
}) {
  assertAttendanceTimeOrder(input.checkIn, input.checkOut);
  const plan = shiftWindow(input.scheduledStart, input.scheduledEnd);
  const arrived = clockOnShiftDay(input.checkIn, input.scheduledStart, input.scheduledEnd);
  const left = input.checkOut ? arrived + forwardMinutes(input.checkIn, input.checkOut) : undefined;
  const rawLate = Math.max(0, arrived - plan.from);
  const lateMinutes = rawLate > input.graceMinutes ? rawLate : 0;
  const earlyLeaveMinutes = left === undefined ? 0 : Math.max(0, plan.to - left);
  const workedMinutes = left === undefined ? 0 : left - arrived;
  const overtimeMinutes = left === undefined ? 0 : Math.max(0, left - Math.max(plan.to, arrived));
  return {
    lateMinutes,
    earlyLeaveMinutes,
    workedMinutes,
    overtimeMinutes,
    status: input.checkOut
      ? lateMinutes
        ? "LATE"
        : "CHECKED_OUT"
      : lateMinutes
        ? "LATE"
        : "WORKING",
  } as const;
}

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const radius = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function assertAttendanceTransition(
  action: "CHECK_IN" | "CHECK_OUT",
  attendance?: Pick<Attendance, "checkIn" | "checkOut">,
) {
  if (action === "CHECK_IN" && attendance?.checkIn)
    throw Object.assign(new Error("Bugun allaqachon ishga kelgansiz."), {
      status: 409,
    });
  if (action === "CHECK_OUT" && !attendance?.checkIn)
    throw Object.assign(new Error("Avval ishga kelishni qayd eting."), {
      status: 409,
    });
  if (action === "CHECK_OUT" && attendance?.checkOut)
    throw Object.assign(new Error("Bugun allaqachon ishdan chiqqansiz."), {
      status: 409,
    });
}

export function assertQrNonceUsable(
  qrNonce: QrNonce | undefined,
  employeeId: string,
  now = Date.now(),
): asserts qrNonce is QrNonce {
  if (!qrNonce)
    throw Object.assign(new Error("QR kod yaroqsiz."), { status: 409 });
  if (qrNonce.usedEmployeeIds?.includes(employeeId))
    throw Object.assign(new Error("Bu QR kodni allaqachon ishlatgansiz."), {
      status: 409,
    });
  if (new Date(qrNonce.expiresAt).getTime() < now)
    throw Object.assign(new Error("QR kod muddati tugagan."), { status: 410 });
}

export function assertQrScope(
  qr: { companyId: string; branchId: string },
  expected: { companyId: string; branchId: string },
) {
  if (qr.companyId !== expected.companyId || qr.branchId !== expected.branchId)
    throw Object.assign(
      new Error("QR boshqa kompaniya yoki filialga tegishli."),
      {
        status: 403,
      },
    );
}
