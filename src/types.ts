import type {
  Attendance,
  Branch,
  Department,
  Employee,
  Position,
  Schedule,
} from "@/lib/types";

export type RosterState =
  | "IN"
  | "LEFT"
  | "ABSENT"
  | "ON_LEAVE"
  | "DAY_OFF"
  | "NOT_YET"
  | "UPCOMING";

export type RosterRow = {
  employee: Employee;
  record: Attendance | null;
  state: RosterState;
  late: boolean;
  leaveType?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  branch?: string;
  department?: string;
  position?: string;
  schedule?: string;
};

export type RosterStats = {
  total: number;
  present: number;
  inNow: number;
  left: number;
  late: number;
  absent: number;
  leave: number;
  dayOff: number;
  notYet: number;
};

export type Meta = {
  branches: Branch[];
  departments: (Department & { employees?: number })[];
  positions: (Position & { employees?: number })[];
  schedules: Schedule[];
};

export const leaveTypeLabel: Record<string, string> = {
  VACATION: "Mehnat ta’tili",
  SICK: "Kasallik",
  PERMISSION: "Ruxsat (javob)",
  UNPAID: "Haq to‘lanmaydigan",
  OTHER: "Boshqa",
};

export const weekdayNames = [
  "Yakshanba",
  "Dushanba",
  "Seshanba",
  "Chorshanba",
  "Payshanba",
  "Juma",
  "Shanba",
];
export const weekdayShort = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
/** Dushanbadan boshlanadigan tartib. */
export const weekOrder = [1, 2, 3, 4, 5, 6, 0];

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00+05:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export const verificationLabel: Record<string, string> = {
  FACE: "Face ID",
  GPS: "GPS",
  QR: "QR",
  TELEGRAM: "Telegram",
  DEVICE: "Qurilma",
  MANUAL: "Qo‘lda",
};
