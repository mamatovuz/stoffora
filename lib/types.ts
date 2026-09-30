export type Role =
  | "SUPER_ADMIN"
  | "COMPANY_OWNER"
  | "HR_ADMIN"
  | "HR_MANAGER"
  | "FINANCE"
  | "IT_ADMIN"
  | "BRANCH_MANAGER"
  | "EMPLOYEE";
export type EmployeeStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED" | "DISMISSED";
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
  payroll?: PayrollSettings;
  photoChannel?: PhotoChannelSettings;
  attendanceCounting?: AttendanceCountingSettings;
  /** Kompaniyaning o‘z Telegram boti (ro‘yxatdan o‘tish, xabarlar, Mini App). */
  bot?: CompanyBotSettings;
  /** Botdagi xodim anketasi (savollar kompaniyaga moslab sozlanadi). */
  registrationForm?: RegistrationForm;
  /** Tarif: maksimal faol xodimlar soni (super admin belgilaydi; bo‘sh — cheklovsiz). */
  employeeLimit?: number;
  /** Chegaradan oshganda murojaat uchun aloqa (standart: @mamatov_ads). */
  limitContact?: string;
}
export interface CompanyBotSettings {
  /** AES-256-GCM bilan shifrlangan bot tokeni — frontendga qaytmaydi. */
  tokenEnc?: string;
  tokenHint?: string;
  username?: string;
  botId?: number;
  enabled: boolean;
  /** Xodimlar botda anketa to‘ldirib ro‘yxatdan o‘ta oladi. */
  registrationEnabled: boolean;
  /** Arizalarni tasdiqlovchi HR xodimlarning Telegram ID lari. */
  approverTelegramIds: string[];
  status?: "RUNNING" | "ERROR" | "STOPPED";
  mode?: "webhook" | "polling";
  lastError?: string;
  updatedAt?: string;
}
/**
 * Davomat hisoblash boshlanish sanasi. Shu sanagacha keldi-ketdi "mashq" hisoblanadi:
 * kechikish, kelmaslik va oylikdan ushlanmalar hisobga olinmaydi.
 */
export interface AttendanceCountingSettings {
  /** YYYY-MM-DD; bo‘sh bo‘lsa — hamma kun hisoblanadi. */
  startDate?: string;
  note?: string;
  updatedAt?: string;
  updatedBy?: string;
}
/** Keldi-ketdi rasmlari yuboriladigan maxfiy Telegram kanal. */
export interface PhotoChannelSettings {
  enabled: boolean;
  chatId: string;
  chatTitle?: string;
  /** Necha kundan keyin kanaldagi rasmlar o‘chiriladi (0 — o‘chirilmaydi). */
  retentionDays: number;
}
export interface PayrollSettings {
  /** NONE — ushlanmaydi; HOURLY — soatlik stavka bo‘yicha; PER_MINUTE — har daqiqa uchun belgilangan summa. */
  latePenaltyMode: "NONE" | "HOURLY" | "PER_MINUTE";
  latePenaltyPerMinute: number;
  /** Oyiga shuncha daqiqa kechikish jarimasiz. */
  freeLateMinutesPerMonth: number;
  /** Oylik ish soatlari (soatlik stavka = oylik / shu soat). */
  monthlyHours: number;
  overtimePay: boolean;
  /** Sababsiz kelmagan kun uchun ushlanma: NONE — yo‘q; DAILY — kunlik stavka (oylik / oydagi ish kunlari). */
  absencePenalty?: "NONE" | "DAILY";
  /** Qo‘shimcha ish faqat rahbar tasdiqlagandan keyin pul bo‘ladi. */
  overtimeRequiresApproval?: boolean;
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
  /** QR_GPS_FACE — filial ekranidagi QR ham talab qilinadi; GPS_FACE — faqat yuz va GPS. */
  attendanceMode?: "QR_GPS_FACE" | "GPS_FACE";
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
  dismissedAt?: string;
  dismissReason?: string;
  /** Xodim uchun alohida hisoblash boshlanish sanasi (kompaniyanikidan keyin bo‘lsa ustun). */
  countingStartDate?: string;
  /** telegramId qayerdan kelgan: xodimning o‘zi ulagan yoki integratsiya (bot) bergan. */
  telegramIdSource?: "LINK" | "INTEGRATION";
  /** Xabarlar qaysi bot orqali yetadi: Staffora boti, kompaniya boti yoki xodimlar boti. */
  telegramChannel?: "STAFFORA_BOT" | "COMPANY_BOT" | "EMPLOYEE_BOT";
  parentPhone?: string;
  education?: string;
  shift?: "DAY" | "NIGHT" | "BOTH";
  /** Botdagi anketa orqali ro‘yxatdan o‘tgan bo‘lsa — ariza ID si. */
  registrationId?: string;
  /** Anketadagi qo‘shimcha savollar javoblari (savol → javob). */
  customFields?: Record<string, string>;
  /** Mini App va bot tili. */
  language?: "uz" | "ru";
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
  note?: string;
  /** Yozuv qayerdan kelgan: Staffora (Mini App/panel) yoki xodimlar boti. */
  source?: "STAFFORA" | "BOT";
  /** Tashqi tizimlardagi ID lar: { gulnora_hr_bot: "123" }. */
  externalIds?: Record<string, string>;
  /** Qo‘shimcha ish tasdig‘i: true — tasdiqlangan, false — rad etilgan, yo‘q — kutilmoqda. */
  overtimeApproved?: boolean;
  overtimeDecidedBy?: string;
  /** Shubhali belgilar (masalan soxta GPS) — HR ko‘rib chiqadi. */
  flags?: AttendanceFlag[];
  flagsReviewedBy?: string;
  updatedAt: string;
}
export type AttendanceFlag = "GPS_ACCURACY" | "GPS_EXACT_REPEAT" | "GPS_TELEPORT" | "GPS_EDGE" | "GPS_STALE";
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
  /** Yangi format: qabul qiluvchilar filtri va kanallar bo‘yicha yetkazish hisoboti. */
  target?: AnnouncementTarget;
  createdBy?: string;
  report?: {
    staffora?: { recipients: number; delivered: number };
    telegram?: { recipients: number; delivered: number; failed: number };
    bot?: {
      integrationId: string;
      externalId?: string;
      status: "QUEUED" | "SENT" | "FAILED" | "PARTIAL";
      recipients: number;
      sent: number;
      failed: number;
      acknowledged: number;
      skipped: number;
      error?: string;
      checkedAt?: string;
    };
  };
}
export interface AnnouncementTarget {
  type: "ALL" | "BRANCHES" | "DEPARTMENTS" | "POSITIONS" | "EMPLOYEES";
  ids: string[];
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
  telegramId?: string;
  telegramUsername?: string;
  twoFactorEnabled?: boolean;
  /** Filial rahbari faqat shu filiallarni ko‘radi (bo‘sh — hech qaysi). */
  branchIds?: string[];
  /** Panel tili. */
  language?: "uz" | "ru";
  screenLock?: { enabled: boolean; minutes: number; passwordHash?: string };
}
export interface PanelSession {
  id: string;
  userId: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt?: string;
  /** Ekran qulflangan vaqt — qulf ochilmaguncha API so‘rovlari bloklanadi. */
  lockedAt?: string;
}
export interface PhotoJob {
  id: string;
  companyId: string;
  employeeId?: string;
  chatId: string;
  photoDataUrl: string;
  caption: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: string;
}
export interface ChannelPost {
  companyId: string;
  chatId: string;
  messageId: number;
  sentAt: string;
}
export interface TelegramInvite {
  id: string;
  companyId: string;
  employeeId: string;
  code: string;
  expiresAt: string;
  usedAt?: string;
  revokedAt?: string;
  /** Bir martalik (standart) — ishlatilgach yaroqsiz. */
  oneTime?: boolean;
  createdBy?: string;
  /** Qanday yuborilgan: qo‘lda nusxa, integratsiya boti orqali. */
  channel?: "MANUAL" | "BOT";
  sentAt?: string;
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
  /** O‘rtacha (markaziy) deskriptor. */
  descriptor: number[];
  /** Ro‘yxatdan o‘tishda olingan alohida namunalar. */
  samples?: number[][];
  /** Oxirgi muvaffaqiyatli tekshiruv deskriptori — replay hujumini aniqlash uchun. */
  lastDescriptor?: number[];
  lastVerifiedAt?: string;
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
  panelSessions: PanelSession[];
  photoQueue: PhotoJob[];
  channelPosts: ChannelPost[];
  integrations: Integration[];
  entityMappings: EntityMapping[];
  syncJobs: SyncJob[];
  integrationConflicts: IntegrationConflict[];
  registrations: RegistrationRequest[];
  payrollAdjustments: PayrollAdjustment[];
  payrollPeriods: PayrollPeriod[];
  scheduleOverrides: ScheduleOverride[];
  shiftSwaps: ShiftSwapRequest[];
  documents: EmployeeDocument[];
  /** Tug‘ilgan kun tabriklari va hujjat eslatmalari takror yuborilmasligi uchun. */
  sentGreetings: { key: string; at: string }[];
}

/* ---------------------------------------------------------- ish haqi --- */
export interface PayrollAdjustment {
  id: string;
  companyId: string;
  employeeId: string;
  /** YYYY-MM */
  month: string;
  type: "ADVANCE" | "BONUS" | "FINE";
  amount: number;
  note?: string;
  createdBy: string;
  createdAt: string;
}
export interface PayslipLine {
  employeeId: string;
  employeeNo: string;
  name: string;
  position?: string;
  base: number;
  days: number;
  expectedDays: number;
  absentDays: number;
  lateMinutes: number;
  overtimeAmount: number;
  bonus: number;
  lateDeduction: number;
  absenceDeduction: number;
  fine: number;
  advance: number;
  net: number;
  explanation: string;
}
/** Yopilgan oy — raqamlar o‘zgarmaydi. */
export interface PayrollPeriod {
  id: string;
  companyId: string;
  month: string;
  closedAt: string;
  closedBy: string;
  lines: PayslipLine[];
  total: number;
  payslipsSentAt?: string;
}

/* --------------------------------------------------- grafik o‘zgarishi --- */
/** Bitta kunga grafik o‘zgarishi (smena almashish natijasi). */
export interface ScheduleOverride {
  id: string;
  companyId: string;
  employeeId: string;
  date: string;
  working: boolean;
  start?: string;
  end?: string;
  reason: string;
  swapId?: string;
}
export interface ShiftSwapRequest {
  id: string;
  companyId: string;
  requesterId: string;
  colleagueId: string;
  /** Talab qiluvchi bera oladigan ish kuni (hamkasb shu kuni ishlaydi). */
  giveDate: string;
  /** Ixtiyoriy: talab qiluvchi o‘rniga hamkasbning shu kunida ishlaydi. */
  takeDate?: string;
  reason?: string;
  status: "PENDING_COLLEAGUE" | "PENDING_MANAGER" | "APPROVED" | "REJECTED" | "CANCELLED";
  decidedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------------------------------- hujjatlar --- */
export type DocumentType = "PASSPORT" | "DIPLOMA" | "MEDICAL" | "SANITARY" | "CONTRACT" | "OTHER";
export interface EmployeeDocument {
  id: string;
  companyId: string;
  employeeId: string;
  type: DocumentType;
  title: string;
  mime: string;
  size: number;
  expiresAt?: string;
  uploadedBy: string;
  createdAt: string;
}

/* ------------------------------------------ botdagi ro‘yxatdan o‘tish --- */
/** Xodim profiliga bevosita yoziladigan (tizim) maydonlari. */
export type BuiltinField =
  | "fullName"
  | "birthDate"
  | "phone"
  | "parentPhone"
  | "positionId"
  | "address"
  | "branchId"
  | "shift"
  | "workHours"
  | "salary"
  | "restDay"
  | "education";
export type QuestionType =
  | "name"
  | "text"
  | "number"
  | "date"
  | "birthdate"
  | "phone"
  | "money"
  | "choice"
  | "yesno"
  | "position"
  | "branch"
  | "shift"
  | "workHours"
  | "weekday";
/** Anketa savoli — kompaniya panelda qo‘shadi, o‘chiradi, tahrirlaydi. */
export interface RegistrationQuestion {
  id: string;
  /** Tizim maydoni bo‘lsa — javob xodim profilidagi shu maydonga yoziladi. */
  field?: BuiltinField;
  type: QuestionType;
  title: string;
  hint?: string;
  options?: string[];
  required: boolean;
  enabled: boolean;
}
export interface RegistrationForm {
  questions: RegistrationQuestion[];
  /** /start dagi salomlashish matni ({company} — kompaniya nomi). */
  intro?: string;
  /** Anketa yuborilgandan keyingi matn. */
  submittedText?: string;
  /** Tasdiqlanganda xodimga boradigan matn ({name}, {company}). */
  approvedText?: string;
  updatedAt?: string;
  updatedBy?: string;
}
/** Anketa holati: savol ID si yoki xulosa / tahrirlash tanlovi. */
export type RegistrationStep = string;
export interface RegistrationData {
  fullName?: string;
  birthDate?: string;
  phone?: string;
  parentPhone?: string;
  positionId?: string;
  address?: string;
  branchId?: string;
  shift?: "DAY" | "NIGHT" | "BOTH";
  workHours?: string;
  salary?: number;
  /** 0–6 (yakshanba=0) yoki -1 — dam olishsiz. */
  restDay?: number;
  education?: string;
  /** Kompaniya qo‘shgan savollar javoblari (savol ID → javob). */
  custom?: Record<string, string>;
}
export interface RegistrationRequest {
  id: string;
  companyId: string;
  telegramId: string;
  telegramUsername?: string;
  telegramName?: string;
  status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  step: RegistrationStep;
  /** Bitta maydonni tahrirlayapti — javobdan keyin xulosaga qaytadi. */
  editing?: boolean;
  /** Summa kiritildi — tasdiqlash kutilmoqda. */
  confirming?: boolean;
  /** Yuborilgan paytdagi savollar (sarlavhalar o‘zgarsa ham ariza to‘g‘ri ko‘rinadi). */
  questions?: RegistrationQuestion[];
  data: RegistrationData;
  lastPromptId?: number;
  hrMessages?: { chatId: string; messageId: number }[];
  employeeId?: string;
  decidedBy?: string;
  rejectReason?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  decidedAt?: string;
}

/* ------------------------------------------------------ integratsiya --- */
export type IntegrationProvider = "gulnora_hr_bot";
export type SyncEntity = "branch" | "department" | "position" | "employee" | "attendance";
/** IMPORT — bot → Staffora; EXPORT — Staffora → bot; TWO_WAY — ikki tomonlama; OFF — o‘chiq. */
export type SyncMode = "IMPORT" | "EXPORT" | "TWO_WAY" | "OFF";
export type ConflictStrategy = "STAFFORA_WINS" | "BOT_WINS" | "LATEST" | "MANUAL";
export type NotificationChannel = "staffora" | "telegram" | "bot";

export interface IntegrationSettings {
  syncModes: Record<SyncEntity, SyncMode>;
  conflictStrategy: ConflictStrategy;
  /** Bot'dagi o‘chirish Staffora'da ham ishdan bo‘shatish/nofaol qilishga olib keladi. */
  applyRemoteDeletes: boolean;
  /** Staffora'da yaratilgan (Telegram ID si bor) xodimlarni botga ham yaratish. */
  createInBot: boolean;
  /** Staffora keldi-ketdisini botga yuborish. */
  pushAttendance: boolean;
  /** O‘zgarishlar lentasini tekshirish oralig‘i (soniya). */
  pollIntervalSeconds: number;
  /** Taklif havolasi amal qilish muddati (soat). */
  inviteTtlHours: number;
  /**
   * Xodimlar botiga ulangan Staffora Mini App havolasi (BotFather → /newapp):
   * https://t.me/<bot>/<nomi>. Berilsa, xodim bir bosishda, START siz kiradi.
   */
  miniAppLink?: string;
  /** Bildirishnoma yo‘nalishlari: toifa → kanallar. */
  routing: Record<"attendance" | "leave" | "announcements" | "system" | "payroll" | "hr", NotificationChannel[]>;
}

export interface Integration {
  id: string;
  companyId: string;
  provider: IntegrationProvider;
  name: string;
  baseUrl: string;
  /** AES-256-GCM bilan shifrlangan API kalit (hech qachon frontendga qaytmaydi). */
  apiKeyEnc: string;
  /** Kalitning faqat ko‘rinadigan boshlanishi (gfk_abcd…). */
  apiKeyHint: string;
  webhookSecretEnc?: string;
  /** Bot tomonidagi webhook obunasi ID si. */
  remoteWebhookId?: number;
  webhookUrl?: string;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  remote?: {
    companyName?: string;
    apiName?: string;
    apiVersion?: string;
    build?: string;
    scopes?: string[];
    source?: string;
  };
  settings: IntegrationSettings;
  /** /integration/changes kursori. */
  cursor: number;
  /** Integratsiya o‘zi yaratgan yordamchi yozuvlar (masalan «Umumiy» bo‘lim) — botga eksport qilinmaydi. */
  localOnlyIds?: string[];
  lastSyncAt?: string;
  lastPollAt?: string;
  lastWebhookAt?: string;
  lastError?: string;
  lastErrorAt?: string;
  initialSyncDoneAt?: string;
  connectedAt: string;
  connectedBy: string;
  disconnectedAt?: string;
  updatedAt: string;
}

export interface EntityMapping {
  id: string;
  companyId: string;
  integrationId: string;
  provider: IntegrationProvider;
  entity: SyncEntity;
  localId: string;
  externalId: string;
  /** Oxirgi sinxronlashdagi maydonlar izi — qaysi tomon o‘zgarganini aniqlash uchun. */
  localHash?: string;
  remoteHash?: string;
  remoteUpdatedAt?: string;
  syncedAt: string;
  /** Bot'dagi asl ma’lumot (hamma maydonlar saqlanadi, maxfiylarsiz). */
  snapshot?: Record<string, unknown>;
}

export interface SyncJobCounter {
  total: number;
  created: number;
  updated: number;
  linked: number;
  skipped: number;
  failed: number;
}
export interface SyncJob {
  id: string;
  companyId: string;
  integrationId: string;
  type: "INITIAL" | "MANUAL" | "ACCESS_SEND" | "ANNOUNCEMENT";
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "PARTIAL";
  entities: string[];
  phase?: string;
  progress: number;
  counters: Record<string, SyncJobCounter>;
  errors: { entity: string; externalId?: string; message: string }[];
  createdBy: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface IntegrationConflict {
  id: string;
  companyId: string;
  integrationId: string;
  entity: SyncEntity;
  localId: string;
  externalId: string;
  fields: { field: string; local: unknown; remote: unknown }[];
  remote: Record<string, unknown>;
  status: "OPEN" | "RESOLVED";
  resolution?: "STAFFORA" | "BOT";
  resolvedBy?: string;
  createdAt: string;
  resolvedAt?: string;
}
