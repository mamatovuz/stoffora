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
  /** Rag‘batlantirish: ketma-ket vaqtida kelganlarga bonus. */
  rewards?: RewardSettings;
  /** Yillik ta’til: kalendar kunlarida (standart 21). */
  leavePolicy?: { annualDays: number };
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
  /** Mini App imkoniyatlari (panel → Sozlamalar → Mini App). */
  miniApp?: MiniAppSettings;
}
export interface MiniAppSettings {
  /** Telefon biometriyasi (barmoq izi / Face ID) bilan tez tasdiqlash. */
  biometricEnabled?: boolean;
  /** Biometriya bilan har N-belgida bir marta baribir yuz tekshiriladi. */
  faceEvery?: number;
  /** Xodimlar ma’lumotnomasi (hamkasblar ro‘yxati) Mini App’da ko‘rinadi. */
  directoryEnabled?: boolean;
  /** Ma’lumotnomada hamkasblar telefoni ko‘rinadi. */
  directoryPhones?: boolean;
  /** Tanaffus (tushlik) belgilash. */
  breaksEnabled?: boolean;
  /** Filial ichidagi «vaqtida kelish» reytingi. */
  leaderboardEnabled?: boolean;
  /** Rahbarlarga «hali kelmaganlar» xulosasi (ish boshlanib 20 daqiqa o‘tgach). */
  managerDigest?: boolean;
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
export interface RewardSettings {
  enabled: boolean;
  /** Bosqichlar: shuncha ish kuni ketma-ket vaqtida → shuncha so‘m (shu oy oyligiga). */
  rules: { days: number; amount: number }[];
  /** Boshqa xodimlarga motivatsiya xabari. */
  announce: boolean;
}
export interface RewardAward {
  id: string;
  /** employeeId:days:seriya boshi — takror berilmasligi uchun. */
  key: string;
  companyId: string;
  employeeId: string;
  days: number;
  amount: number;
  month: string;
  adjustmentId?: string;
  /** Rag‘batlantirish yoqilgan paytdagi mavjud seriya — pul berilmagan. */
  skipped?: boolean;
  createdAt: string;
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
  /** Xodim Mini App orqali avans so‘ray oladi. */
  advanceRequestsEnabled?: boolean;
  /** Bir oyda olinadigan avans chegarasi — oylikning shuncha foizi. */
  advanceMaxPercent?: number;
  /** Avans avval HR, keyin moliya tasdiqlaydi (standart: yoqilgan). O‘chirilsa — faqat moliya. */
  advanceHrApproval?: boolean;
  /**
   * Sababsiz kelmagan kunni dam olish kunida ishlab qoplash (shu oy ichida).
   * Standart: yoqilgan. Qoplangan kun uchun kelmaslik ushlanmasi olinmaydi
   * (o‘sha dam kunidagi ish esa qo‘shimcha ish sifatida to‘lanmaydi).
   */
  absenceCompensation?: boolean;
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
  /** Filial rahbarlari (xodimlar) — avtomatik «Filial rahbari» huquqini oladi. */
  managerEmployeeIds?: string[];
  /** Smenaga kerakli xodimlar soni (ertangi tayyorlikni tekshirish uchun). */
  requiredStaff?: number;
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
  /** Shu lavozimdagi xodimlar istalgan filialda keldi-ketdi qila oladi (masalan, HR). */
  anyBranch?: boolean;
  /** anyBranch bo‘lsa — ruxsat etilgan filiallar; bo‘sh bo‘lsa — barcha faol filiallar. */
  branchIds?: string[];
  /** Shu lavozimdagi xodimlarga avtomatik panel huquqi (HR, moliya, IT, filial rahbari). */
  panelRole?: "HR_ADMIN" | "HR_MANAGER" | "FINANCE" | "IT_ADMIN" | "BRANCH_MANAGER";
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
/** Kompaniya kalendari: bayram (dam olish kuni bo‘lsa — kelmaslik hisoblanmaydi) yoki tadbir. */
export interface Holiday {
  id: string;
  companyId: string;
  date: string;
  title: string;
  kind: "HOLIDAY" | "EVENT";
  /** true — shu kuni ishlanmaydi (grafikda dam olish). */
  dayOff: boolean;
  /** Bo‘sh — barcha filiallar. */
  branchIds?: string[];
  createdBy: string;
  createdAt: string;
}
/** Filialga o‘tkazish: doimiy yoki vaqtinchalik (muddat tugagach avtomatik qaytadi). */
export interface BranchTransfer {
  id: string;
  companyId: string;
  employeeId: string;
  fromBranchId: string;
  toBranchId: string;
  startDate: string;
  endDate?: string;
  temporary: boolean;
  reason?: string;
  status: "PLANNED" | "ACTIVE" | "DONE" | "CANCELLED";
  createdBy: string;
  createdAt: string;
}
/** Aktiv (telefon, noutbuk, kalit, forma…) — kimga berilgan va tarixi. */
export interface Asset {
  id: string;
  companyId: string;
  name: string;
  code?: string;
  category: "PHONE" | "LAPTOP" | "KEY" | "UNIFORM" | "TOOL" | "OTHER";
  quantity: number;
  note?: string;
  status: "IN_STOCK" | "ISSUED" | "RETURNED" | "LOST";
  employeeId?: string;
  issuedAt?: string;
  returnedAt?: string;
  history: { action: string; by: string; at: string; employeeId?: string }[];
  createdAt: string;
}
/** Tasdiqlash vakolatini vaqtincha berish. */
export interface Delegation {
  id: string;
  companyId: string;
  fromUserId: string;
  fromName: string;
  fromRole: Role;
  toUserId: string;
  toName: string;
  startDate: string;
  endDate: string;
  reason?: string;
  createdAt: string;
  revokedAt?: string;
}
export interface ReminderRule {
  enabled: boolean;
  offset: number;
}
export interface Employee {
  id: string;
  companyId: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  birthDate?: string;
  /** MALE | FEMALE. */
  gender?: string;
  /** JShShIR (PINFL) — 14 raqamli shaxsiy identifikatsiya raqami. */
  pinfl?: string;
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
  /** Profil rasmining sifati (0–1, Face ID kadridan) va yangilangan vaqti. */
  photoQuality?: number;
  /** Rasm manbai: PANEL — saytda yuklangan (Face ID namunasi, Face ID kadrlari almashtirmaydi). */
  photoSource?: "PANEL" | "FACE";
  photoUpdatedAt?: string;
  faceEnrolledAt?: string;
  status: EmployeeStatus;
  dismissedAt?: string;
  dismissReason?: string;
  /** Xodim uchun alohida hisoblash boshlanish sanasi (kompaniyanikidan keyin bo‘lsa ustun). */
  countingStartDate?: string;
  /**
   * Shaxsiy dam olish kunlari (0 — yakshanba … 6 — shanba). Grafik har kuni ishlasa ham
   * xodim shu kunlari dam oladi: kelmasa «kelmadi» hisoblanmaydi, kelsa — ishlagan kun.
   */
  restDays?: number[];
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
  /**
   * Ish boshlanishi / tugashi haqida eslatma (xodim o‘zi sozlaydi). offset — daqiqa:
   * manfiy — oldin («Avval 10 min»), musbat — keyin («Keyin 10 min»).
   */
  reminders?: { start: ReminderRule; end: ReminderRule };
  /** Yillik ta’til kunlari (bo‘sh — kompaniya qoidasi). */
  annualLeaveDays?: number;
  /** Onboarding’ning qo‘lda belgilanadigan qadamlari (IT qurilma berdi, rahbar tanishtirdi, o‘qitish). */
  onboardingManual?: Record<string, { done: boolean; by: string; at: string }>;
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
  /** Internetsiz belgilanib keyin yuborilgan yozuvlar (takror yuborilsa ikki marta yozilmasligi uchun). */
  offlineIds?: string[];
  flagsReviewedBy?: string;
  /** Tanaffuslar (tushlik) — ma’lumot uchun, ish vaqtidan ayrilmaydi. */
  breaks?: { start: string; end?: string }[];
  /** Xodimning qo‘shimcha ish haqidagi izohi (rahbar tasdiqlashi uchun). */
  overtimeNote?: string;
  updatedAt: string;
}
export type AttendanceFlag =
  | "GPS_ACCURACY"
  | "GPS_EXACT_REPEAT"
  | "GPS_TELEPORT"
  | "GPS_EDGE"
  | "GPS_STALE"
  | "OFFLINE"
  | "DEVICE_STILL"
  | "DESKTOP"
  | "MOCK_LOCATION";
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
  /** Biriktirilgan hujjat (masalan kasallik varaqasi rasmi). */
  documentId?: string;
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
  /** Xodimdan «Tanishdim» tasdig‘i so‘raladi. */
  ackRequired?: boolean;
  /** So‘rovnoma: javob variantlari (bo‘sh — oddiy e’lon). */
  options?: string[];
  report?: {
    staffora?: { recipients: number; delivered: number; acknowledged?: number; answers?: Record<string, number> };
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
  /** E’lon bilan bog‘liq bo‘lsa — tasdiq va so‘rovnoma uchun. */
  announcementId?: string;
  ackRequired?: boolean;
  ackAt?: string;
  options?: string[];
  answer?: string;
  /** Mini App ichidagi bo‘lim (chuqur havola): leave, swaps, salary, payslip_2026-09… */
  go?: string;
  /** Mobil ilovaga push yuborilgan vaqt (takror yuborilmasin). */
  pushedAt?: string;
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
  /** Xodimga bog‘langan hisob (lavozim/filial orqali avtomatik ochilgan bo‘lsa — autoRole). */
  employeeId?: string;
  autoRole?: boolean;
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
  /** Qanday tasdiqlandi: yuz (Face ID) yoki telefon biometriyasi. */
  method?: "FACE" | "BIOMETRIC";
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
  /**
   * Moslashuvchan namunalar: ishonchli tekshiruvlardan olingan oxirgi yuzlar
   * (soqol, soch, yorug‘lik, yosh o‘zgarishiga moslashish uchun). Ko‘pi bilan 6 ta.
   */
  adaptiveSamples?: number[][];
  /** PANEL — saytda yuklangan rasmdan olingan namuna. */
  source?: "PANEL" | "FACE";
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
  advanceRequests: AdvanceRequest[];
  documents: EmployeeDocument[];
  /** Tug‘ilgan kun tabriklari va hujjat eslatmalari takror yuborilmasligi uchun. */
  sentGreetings: { key: string; at: string }[];
  biometricDevices: BiometricDevice[];
  lateNotices: LateNotice[];
  clientLogs: ClientLog[];
  tickets: Ticket[];
  certificateRequests: CertificateRequest[];
  /** Xodim avans uchun saqlagan karta (roziligi bilan). Xodim obyektidan alohida — tasodifan API’da chiqib ketmasin. */
  payoutCards: PayoutCard[];
  dayOffMoves: DayOffMove[];
  attendanceCorrections: AttendanceCorrection[];
  rewardAwards: RewardAward[];
  payrollWorkflows: PayrollWorkflow[];
  holidays: Holiday[];
  branchTransfers: BranchTransfer[];
  assets: Asset[];
  delegations: Delegation[];
  /* ---- Native mobil ilova (iOS/Android) — xodimlar o‘sha, faqat qurilma xavfsizligi ---- */
  mobileDevices: MobileDevice[];
  mobileSessions: MobileSession[];
  mobileActivationCodes: MobileActivationCode[];
  deviceChangeRequests: DeviceChangeRequest[];
  mobilePushTokens: MobilePushToken[];
}
export interface PayoutCard {
  companyId: string;
  employeeId: string;
  cardEnc: string;
  cardMask: string;
  cardBrand: string;
  holder: string;
  updatedAt: string;
}

/* ------------------------------------------- murojaatlar (HR’ga savol) --- */
export interface TicketMessage {
  id: string;
  from: "EMPLOYEE" | "HR";
  /** HR javobida — javob bergan xodim ismi. Anonim murojaatda xodim ismi yozilmaydi. */
  author?: string;
  text: string;
  at: string;
}
/**
 * Xodimning HR’ga savoli yoki taklif/shikoyati. Anonim murojaatda xodim ID si
 * saqlanmaydi — faqat sirli xesh (o‘zi javobni ko‘rishi uchun), HR uni bilmaydi.
 */
export interface Ticket {
  id: string;
  companyId: string;
  employeeId?: string;
  ownerHash?: string;
  kind: "QUESTION" | "FEEDBACK";
  anonymous: boolean;
  category: string;
  subject: string;
  /** Anonim bo‘lmasa — filial (rahbar faqat o‘z filialinikini ko‘radi). */
  branchId?: string;
  status: "OPEN" | "ANSWERED" | "CLOSED";
  messages: TicketMessage[];
  unreadEmployee: boolean;
  unreadHr: boolean;
  createdAt: string;
  updatedAt: string;
}
/** Ma’lumotnoma (spravka) so‘rovi: HR tayyorlab faylni yuklaydi, xodim Mini App’dan oladi. */
export interface CertificateRequest {
  id: string;
  companyId: string;
  employeeId: string;
  type: "WORK" | "SALARY" | "NDFL" | "VISA" | "OTHER";
  purpose: string;
  note?: string;
  status: "PENDING" | "READY" | "REJECTED";
  documentId?: string;
  decidedBy?: string;
  decidedNote?: string;
  createdAt: string;
  updatedAt: string;
}

/* ----------------------------------------------------------- Mini App --- */
/** Telefon biometriyasi bilan bog‘langan qurilma (token faqat xesh ko‘rinishida saqlanadi). */
export interface BiometricDevice {
  id: string;
  companyId: string;
  employeeId: string;
  tokenHash: string;
  label: string;
  uses: number;
  createdAt: string;
  lastUsedAt?: string;
  /** Oxirgi marta haqiqiy yuz tekshiruvi o‘tgan vaqt. */
  lastFaceAt: string;
  revokedAt?: string;
}
/** «Kechikaman» — xodim oldindan ogohlantiradi. */
export interface LateNotice {
  id: string;
  companyId: string;
  employeeId: string;
  date: string;
  minutes: number;
  reason: string;
  createdAt: string;
}
/** Mini App xatolari (kamera, GPS, kirish) — tahlil uchun. */
export interface ClientLog {
  id: string;
  companyId?: string;
  employeeId?: string;
  kind: string;
  message: string;
  detail?: string;
  platform?: string;
  version?: string;
  at: string;
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
  /**
   * Jarima holati: yo‘q yoki APPROVED — oylikdan ushlanadi; PENDING — filial rahbari taklif qilgan,
   * HR / direktor ko‘rib chiqadi; REJECTED — rad etilgan (hisobga olinmaydi).
   */
  status?: "PENDING" | "APPROVED" | "REJECTED";
  /** Taklif qilgan filial rahbari (PENDING jarima uchun). */
  proposedBy?: string;
  decidedBy?: string;
  decidedAt?: string;
  decidedNote?: string;
}
/** Xodimning Mini App orqali yuborgan avans so‘rovi. */
export interface AdvanceRequest {
  id: string;
  companyId: string;
  employeeId: string;
  month: string;
  amount: number;
  reason?: string;
  /** PENDING — HR ko‘rmoqda; HR_APPROVED — HR tasdiqladi, moliyada; APPROVED — moliya tasdiqladi (oylikdan ushlanadi). */
  status: "PENDING" | "HR_APPROVED" | "APPROVED" | "REJECTED" | "CANCELLED";
  /** 1-bosqich: HR qarori. */
  hrDecidedBy?: string;
  hrDecidedAt?: string;
  hrNote?: string;
  decidedBy?: string;
  decidedNote?: string;
  adjustmentId?: string;
  /** Pul qanday beriladi: kartaga (raqam shifrlangan) yoki naqd. */
  payout?: AdvancePayout;
  /** Moliya pulni o‘tkazdi / berdi. */
  paidAt?: string;
  paidBy?: string;
  createdAt: string;
  updatedAt: string;
}
export interface AdvancePayout {
  method: "CARD" | "CASH";
  /** AES-256-GCM bilan shifrlangan to‘liq raqam — faqat moliya ochadi (audit bilan). */
  cardEnc?: string;
  cardMask?: string;
  cardBrand?: string;
  /** Qabul qiluvchining ism-familiyasi (karta egasi). */
  holder?: string;
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
/** Oyni yopish jarayoni: HR → Moliya → Direktor → To‘landi. */
export interface PayrollWorkflow {
  id: string;
  companyId: string;
  month: string;
  stage: "CALCULATING" | "HR_CHECKED" | "FINANCE_CHECKED" | "APPROVED" | "PAID";
  history: { stage: PayrollWorkflow["stage"]; by: string; at: string; note?: string }[];
  paidAt?: string;
  paidBy?: string;
}
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
/* ============================================== Native mobil ilova === */
/**
 * Ishonchli qurilma: o‘rnatishda yaratilgan ECDSA P-256 kalit juftining ochiq qismi.
 * Maxfiy kalit telefondan chiqmaydi. Qoida: bir xodim — bitta faol qurilma,
 * bitta qurilma (ochiq kalit) — bitta xodim. Server tomonida tekshiriladi.
 */
export interface MobileDevice {
  id: string;
  companyId: string;
  employeeId: string;
  /** SPKI (DER, base64) — imzoni tekshirish uchun. */
  publicKey: string;
  /** Ochiq kalitning SHA-256 izi — noyoblik va qidiruv uchun. */
  keyFingerprint: string;
  platform: "ios" | "android";
  model?: string;
  osVersion?: string;
  appVersion?: string;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokeReason?: string;
}
/** Mobil sessiya: refresh token faqat xesh ko‘rinishida; har yangilanishda almashadi. */
export interface MobileSession {
  id: string;
  companyId: string;
  employeeId: string;
  deviceId: string;
  refreshHash: string;
  /** Oldingi refresh token xeshi — qayta ishlatilsa (o‘g‘irlangan token) sessiya yopiladi. */
  prevRefreshHash?: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string;
  revokeReason?: string;
}
/** Bir martalik faollashtirish kodi (xesh saqlanadi); Mini App yoki HR beradi. */
export interface MobileActivationCode {
  id: string;
  companyId: string;
  employeeId: string;
  codeHash: string;
  /** Kodning oxirgi 2 belgisi — HR ko‘rishi uchun (kodni tiklab bo‘lmaydi). */
  hint: string;
  source: "MINI_APP" | "HR";
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  revokedAt?: string;
  attempts: number;
}
/** Yangi telefon: eski faol qurilma bor — HR tasdiqlaydi, eskisi bekor qilinadi. */
export interface DeviceChangeRequest {
  id: string;
  companyId: string;
  employeeId: string;
  oldDeviceId?: string;
  publicKey: string;
  keyFingerprint: string;
  platform: "ios" | "android";
  model?: string;
  osVersion?: string;
  appVersion?: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  /** Tasdiqlangach yaratilgan yangi qurilma. */
  newDeviceId?: string;
}
export interface MobilePushToken {
  id: string;
  companyId: string;
  employeeId: string;
  deviceId: string;
  provider: "expo";
  token: string;
  platform: "ios" | "android";
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  lastError?: string;
}

/** Dam olish kunini bir martaga boshqa kunga ko‘chirish (rahbar tasdiqlaydi). */
export interface DayOffMove {
  id: string;
  companyId: string;
  employeeId: string;
  /** Odatdagi dam olish kuni — shu kuni ishlaydi. */
  fromDate: string;
  /** Yangi dam olish kuni — shu kuni ishlamaydi. */
  toDate: string;
  reason?: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  decidedBy?: string;
  createdAt: string;
  updatedAt: string;
}
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
  /** Dam olish kunini ko‘chirish so‘rovi natijasi. */
  dayOffMoveId?: string;
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

/**
 * Belgilash so‘rovi: xodim kirish/chiqishni belgilashni unutgan (masalan, kechqurun chiqib ketib,
 * «Chiqish»ni bosmagan). HR/rahbar tasdiqlasa — davomat qaydiga shu vaqt yoziladi.
 */
export interface AttendanceCorrection {
  id: string;
  companyId: string;
  employeeId: string;
  date: string;
  /** HH:MM (Toshkent vaqti). */
  time: string;
  kind: "IN" | "OUT";
  branchId: string;
  comment: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  decidedBy?: string;
  decidedNote?: string;
  decidedAt?: string;
  /** Tasdiqlangach yozilgan davomat qaydi. */
  attendanceId?: string;
  /** Tasdiqlash paytidagi eski qiymat (audit uchun). */
  previous?: { checkIn?: string; checkOut?: string };
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
  | "education"
  | "gender"
  | "pinfl"
  | "idDocument"
  | "selfie";
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
  | "weekday"
  | "gender"
  | "pinfl"
  | "photo";
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
  gender?: "MALE" | "FEMALE";
  /** JShShIR (PINFL) — 14 raqam. */
  pinfl?: string;
  /** Pasport / ID karta rasmi — document_files dagi fayl ID si (tasdiqlangach xodim hujjatiga aylanadi). */
  idDocument?: string;
  idDocumentMime?: string;
  idDocumentSize?: number;
  /** Yuz rasmi (selfi) — fayl ID si; tasdiqlangach profil rasmi va Face ID namunasi bo‘ladi. */
  selfie?: string;
  selfieDescriptor?: number[];
  /** «Ish vaqti» savolida tanlangan mavjud ish grafigi. */
  scheduleId?: string;
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
