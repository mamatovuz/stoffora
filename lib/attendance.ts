import type { Attendance, QrNonce } from "./types";

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

export function assertAttendanceTimeOrder(checkIn: string, checkOut?: string) {
  if (!isValidClockTime(checkIn) || (checkOut && !isValidClockTime(checkOut)))
    throw Object.assign(
      new Error("Vaqt HH:MM formatida va haqiqiy bo‘lishi kerak."),
      {
        status: 400,
      },
    );
  if (checkOut && minutesBetween(checkIn, checkOut) === 0)
    throw Object.assign(
      new Error("Chiqish vaqti kirish vaqtidan keyin bo‘lishi kerak."),
      { status: 400 },
    );
}

export function calculateAttendance(input: {
  scheduledStart: string;
  scheduledEnd: string;
  checkIn: string;
  checkOut?: string;
  graceMinutes: number;
}) {
  assertAttendanceTimeOrder(input.checkIn, input.checkOut);
  const rawLate = minutesBetween(input.scheduledStart, input.checkIn);
  const lateMinutes = rawLate > input.graceMinutes ? rawLate : 0;
  const earlyLeaveMinutes = input.checkOut
    ? minutesBetween(input.checkOut, input.scheduledEnd)
    : 0;
  const workedMinutes = input.checkOut
    ? minutesBetween(input.checkIn, input.checkOut)
    : 0;
  const overtimeMinutes = input.checkOut
    ? minutesBetween(input.scheduledEnd, input.checkOut)
    : 0;
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
