export type Role =
  | "SUPER_ADMIN"
  | "COMPANY_OWNER"
  | "HR_ADMIN"
  | "HR_MANAGER"
  | "FINANCE"
  | "IT_ADMIN"
  | "BRANCH_MANAGER"
  | "EMPLOYEE";
export type EmployeeStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type AttendanceStatus =
  "PRESENT" | "LATE" | "ABSENT" | "ON_LEAVE" | "WORKING" | "CHECKED_OUT";
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface Company {
  id: string;
  name: string;
  slug: string;
  ownerName: string;
  plan: string;
  status: "ACTIVE" | "TRIAL" | "SUSPENDED";
  timezone: string;
  createdAt: string;
}
export interface Branch {
  id: string;
  companyId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  manager: string;
  status: "ACTIVE" | "INACTIVE";
  scheduleId: string;
}
export interface Department {
  id: string;
  companyId: string;
  name: string;
  manager?: string;
}
export interface Position {
  id: string;
  companyId: string;
  name: string;
  departmentId: string;
}
export interface ScheduleDay {
  day: number;
  enabled: boolean;
  start: string;
  end: string;
  breakMinutes: number;
}
export interface Schedule {
  id: string;
  companyId: string;
  name: string;
  type: "FIXED" | "FLEXIBLE" | "SHIFT";
  graceMinutes: number;
  overtimeEnabled: boolean;
  days: ScheduleDay[];
}
export interface Employee {
  id: string;
  companyId: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  birthDate?: string;
  gender?: string;
  phone: string;
  email: string;
  address?: string;
  departmentId: string;
  positionId: string;
  branchId: string;
  scheduleId: string;
  manager?: string;
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACT";
  startDate: string;
  baseSalary: number;
  currency: string;
  telegramUsername?: string;
  telegramId?: string;
  telegramConnected: boolean;
  deviceStatus: "PENDING" | "CONNECTED" | "BLOCKED";
  photoDataUrl?: string;
  faceEnrolledAt?: string;
  status: EmployeeStatus;
  createdAt: string;
  updatedAt: string;
}
export interface Attendance {
  id: string;
  companyId: string;
  employeeId: string;
  branchId: string;
  date: string;
  scheduledStart: string;
  scheduledEnd: string;
  checkIn?: string;
  checkOut?: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  status: AttendanceStatus;
  verification: ("GPS" | "QR" | "TELEGRAM" | "DEVICE" | "FACE" | "MANUAL")[];
  latitude?: number;
  longitude?: number;
  distanceMeters?: number;
  updatedAt: string;
}
export interface LeaveRequest {
  id: string;
  companyId: string;
  employeeId: string;
  type: "VACATION" | "SICK" | "PERMISSION" | "UNPAID" | "OTHER";
  startDate: string;
  endDate: string;
  reason: string;
  status: LeaveStatus;
  decidedBy?: string;
  createdAt: string;
}
export interface AuditLog {
  id: string;
  companyId: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}
export interface Announcement {
  id: string;
  companyId: string;
  title: string;
  message: string;
  audience: string;
  channel: string[];
  scheduledAt: string;
  status: "DRAFT" | "SCHEDULED" | "SENT";
}
export interface Notification {
  id: string;
  companyId: string;
  title: string;
  body: string;
  type: string;
  employeeId?: string;
  read: boolean;
  createdAt: string;
}
export interface User {
  id: string;
  companyId?: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  photoDataUrl?: string;
}
export interface TelegramInvite {
  id: string;
  companyId: string;
  employeeId: string;
  code: string;
  expiresAt: string;
  usedAt?: string;
}
export interface AttendanceSession {
  id: string;
  companyId: string;
  employeeId: string;
  branchId: string;
  action: "CHECK_IN" | "CHECK_OUT";
  nonce: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  faceVerifiedAt?: string;
}
export interface FaceProfile {
  companyId: string;
  employeeId: string;
  descriptor: number[];
  enrolledAt: string;
  updatedAt: string;
}
export interface QrNonce {
  id: string;
  companyId: string;
  branchId: string;
  nonce: string;
  expiresAt: string;
  usedAt?: string;
  usedEmployeeIds?: string[];
}
export interface Database {
  companies: Company[];
  branches: Branch[];
  departments: Department[];
  positions: Position[];
  schedules: Schedule[];
  employees: Employee[];
  attendance: Attendance[];
  leaveRequests: LeaveRequest[];
  auditLogs: AuditLog[];
  announcements: Announcement[];
  notifications: Notification[];
  users: User[];
  telegramInvites: TelegramInvite[];
  attendanceSessions: AttendanceSession[];
  qrNonces: QrNonce[];
  faceProfiles: FaceProfile[];
}
