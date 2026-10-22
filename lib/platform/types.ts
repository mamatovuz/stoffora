import type { Role } from "../types";

/*
 * Super Admin Control Center — platforma darajasidagi ma’lumot turlari.
 * Kichik va kam o‘zgaradigan yozuvlar xotiradagi bazada (core_rows) saqlanadi;
 * tez o‘sadigan jurnallar (audit, metrikalar, yetkazib berishlar, xatolar) — alohida SQL jadvallarda
 * (lib/backend.ts → PLATFORM_DDL).
 */

/** Platforma administratori roli (User.role === "SUPER_ADMIN" bo‘lganlar uchun). Bo‘sh — OWNER (eski hisoblar). */
export type PlatformRole = "OWNER" | "ADMIN" | "SUPPORT" | "FINANCE" | "ANALYST";

export type PlanLimits = {
  /** Maksimal faol xodim (null/yo‘q — cheklovsiz). */
  employees?: number | null;
  branches?: number | null;
  /** Panel foydalanuvchilari (rahbarlar). */
  managers?: number | null;
};

export interface SubscriptionPlan {
  id: string;
  /** Barqaror kalit: free, pro, enterprise… */
  key: string;
  name: string;
  description?: string;
  /** Narx belgilanmagan bo‘lsa — null (soxta narx ko‘rsatilmaydi). */
  price: number | null;
  currency: string;
  period: "MONTH" | "YEAR";
  limits: PlanLimits;
  /** Tarifga kiradigan modullar ("all" — hammasi). */
  modules: string[] | "all";
  trialDays: number;
  status: "ACTIVE" | "ARCHIVED";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type SubscriptionStatus = "TRIAL" | "ACTIVE" | "GRACE" | "EXPIRED" | "SUSPENDED";

export interface CompanySubscription {
  planId: string;
  /** Rejim: TRIAL | ACTIVE | SUSPENDED (GRACE/EXPIRED sanadan hisoblanadi — subscriptionStatus). */
  status: SubscriptionStatus;
  startedAt: string;
  /** Joriy davr tugashi (bo‘sh — muddatsiz). */
  endsAt?: string;
  trialEndsAt?: string;
  /** Muddat tugagach necha kun «imtiyozli davr» (GRACE). */
  graceDays: number;
  /** Super admin qo‘lda bergan (masalan, bepul Pro). */
  manual?: boolean;
  free?: boolean;
  /** Kompaniyaga xos limitlar (tarif limitlaridan ustun). */
  limits?: PlanLimits;
  pausedAt?: string;
  pausedStatus?: SubscriptionStatus;
  note?: string;
  /** Yuborilgan ogohlantirishlar kaliti (masalan, "2026-11-01:7") — takror yuborilmasin. */
  alertsSent?: string[];
  /** Oxirgi kuzatilgan hisoblangan holat (o‘zgarish auditga yoziladi). */
  lastStatus?: SubscriptionStatus;
  updatedAt: string;
  updatedBy?: string;
}

export interface ModuleOverride {
  enabled: boolean;
  /** Muddati o‘tsa — override amal qilmaydi (asosiy holatga qaytadi). */
  expiresAt?: string;
  trial?: boolean;
  limits?: Record<string, number>;
  note?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ModuleCatalogEntry {
  /** false — modul butun platformada o‘chiq. */
  globalEnabled?: boolean;
  /** Yangi kompaniyalarda standart holat. */
  defaultEnabled?: boolean;
  version?: string;
  /** Talab qilinadigan minimal tarif kaliti (ma’lumot uchun, tarif modullari bilan birga). */
  requiredPlan?: string;
  limits?: Record<string, number>;
  note?: string;
}

export interface PromoCode {
  id: string;
  /** Katta harflarda, noyob. */
  code: string;
  description?: string;
  kind: "PERCENT" | "FIXED" | "TRIAL_EXTENSION" | "FREE_PLAN";
  /** PERCENT — foiz, FIXED — summa, TRIAL_EXTENSION / FREE_PLAN — kunlar. */
  value: number;
  currency?: string;
  /** FREE_PLAN — qaysi tarif; boshqalarda — faqat shu tarifga cheklash. */
  planId?: string;
  expiresAt?: string;
  /** Jami ishlatish chegarasi (bo‘sh — cheklovsiz). */
  usageLimit?: number;
  /** Bitta kompaniya necha marta ishlata oladi. */
  perCompanyLimit: number;
  /** Faqat shu kompaniyalar uchun (bo‘sh — hammaga). */
  companyIds?: string[];
  status: "ACTIVE" | "DISABLED";
  used: number;
  createdAt: string;
  createdBy: string;
}

export interface PromoRedemption {
  id: string;
  promoId: string;
  code: string;
  companyId: string;
  at: string;
  by: string;
  effect: string;
  billingRecordId?: string;
}

export type BillingStatus = "DRAFT" | "ISSUED" | "PAID" | "VOID" | "OVERDUE";
export interface BillingRecord {
  id: string;
  /** INV-2026-0001 */
  number: string;
  companyId: string;
  planId?: string;
  planName?: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  discount?: number;
  currency: string;
  promoCode?: string;
  status: BillingStatus;
  dueDate?: string;
  paidAt?: string;
  paymentMethod?: string;
  /** To‘lovni tasdiqlovchi hujjat/tranzaksiya raqami — «To‘langan» uchun majburiy. */
  paymentReference?: string;
  confirmedBy?: string;
  note?: string;
  history: { at: string; by: string; status: BillingStatus; note?: string }[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface CompanyContract {
  id: string;
  companyId: string;
  /** Bir shartnomaning barcha versiyalari bir guruhda. */
  groupId: string;
  version: number;
  type: "SERVICE" | "NDA" | "DPA" | "ADDENDUM" | "OTHER";
  title: string;
  number?: string;
  startsAt?: string;
  endsAt?: string;
  status: "ACTIVE" | "EXPIRED" | "TERMINATED" | "SUPERSEDED";
  fileId: string;
  fileName: string;
  mime: string;
  size: number;
  note?: string;
  uploadedBy: string;
  createdAt: string;
}

export interface SupportAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}
export interface SupportMessage {
  id: string;
  author: "COMPANY" | "ADMIN" | "SYSTEM";
  authorName: string;
  authorId?: string;
  text: string;
  /** Ichki izoh — kompaniyaga ko‘rinmaydi. */
  internal?: boolean;
  attachments?: SupportAttachment[];
  at: string;
}
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export interface SupportTicket {
  id: string;
  number: number;
  companyId: string;
  createdById: string;
  createdByName: string;
  subject: string;
  category?: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignedTo?: string;
  assignedName?: string;
  messages: SupportMessage[];
  unreadAdmin: boolean;
  unreadCompany: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export type AudienceType = "ALL" | "OWNERS" | "LEADERS" | "COMPANY" | "COMPANIES" | "PLAN" | "EXPIRING";
export interface NotificationAudience {
  type: AudienceType;
  companyIds?: string[];
  planIds?: string[];
  /** EXPIRING — necha kun ichida tugaydiganlar. */
  days?: number;
  /** Faqat kompaniya egalariga (aks holda — barcha rahbarlar). */
  ownersOnly?: boolean;
}
export type PlatformChannel = "IN_APP" | "TELEGRAM";
export interface PlatformNotification {
  id: string;
  /** NOTICE — bildirishnoma markazi; BULK — ommaviy xabar. */
  kind: "NOTICE" | "BULK";
  title: string;
  body: string;
  audience: NotificationAudience;
  channels: PlatformChannel[];
  status: "DRAFT" | "SCHEDULED" | "QUEUED" | "SENDING" | "SENT" | "PARTIAL" | "FAILED" | "CANCELLED";
  scheduledAt?: string;
  sentAt?: string;
  stats?: { total: number; sent: number; failed: number; skipped: number; pending: number };
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface FeatureFlagRule {
  scope: "COMPANY" | "PLAN" | "INTERNAL";
  ids?: string[];
  enabled: boolean;
}
export interface FeatureFlagState {
  key: string;
  description?: string;
  /** Hamma uchun standart holat. */
  enabled: boolean;
  /** 0–100: kompaniyalarning shu foiziga (barqaror xesh bo‘yicha) yoqiladi. */
  rollout?: number;
  rules: FeatureFlagRule[];
  expiresAt?: string;
}
export interface FeatureFlag extends FeatureFlagState {
  id: string;
  version: number;
  history: { version: number; at: string; by: string; snapshot: FeatureFlagState }[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ApiKey {
  id: string;
  companyId: string;
  name: string;
  /** Ko‘rinadigan qism: stf_<prefix> */
  prefix: string;
  /** HMAC-SHA256(secret) — xom kalit saqlanmaydi. */
  hash: string;
  scopes: string[];
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  createdBy: string;
  revokedAt?: string;
  revokedBy?: string;
  rotatedFromId?: string;
}

export interface WebhookEndpoint {
  id: string;
  companyId: string;
  url: string;
  description?: string;
  events: string[];
  /** Maxfiy kalit shifrlangan holda (AES-256-GCM, server kaliti bilan). */
  secretEnc: string;
  secretHint: string;
  enabled: boolean;
  /** Ketma-ket muvaffaqiyatsiz yetkazishlar. */
  failures: number;
  disabledReason?: string;
  lastDeliveryAt?: string;
  lastStatus?: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export type IncidentSeverity = "INFO" | "WARNING" | "CRITICAL";
export interface PlatformIncident {
  id: string;
  rule: string;
  severity: IncidentSeverity;
  title: string;
  detail: string;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  companyId?: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  acknowledgedBy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  notifiedAt?: string;
}

export interface BackupRecord {
  id: string;
  kind: "MANUAL" | "SCHEDULED";
  status: "RUNNING" | "SUCCESS" | "FAILED";
  format: "sqlite" | "jsonl.gz";
  startedAt: string;
  finishedAt?: string;
  sizeBytes?: number;
  /** Fayl nomi (zaxira papkasi ichida) — ommaviy URL emas. */
  file?: string;
  checksum?: string;
  tables?: Record<string, number>;
  includes: { media: boolean; files: boolean };
  error?: string;
  verifyStatus?: "PASSED" | "FAILED";
  verifiedAt?: string;
  verifyError?: string;
  createdBy: string;
  deletedAt?: string;
}

/** Kompaniya panelini ko‘rish sessiyasi (READ_ONLY) yoki yordam kirishi (SUPPORT). */
export interface PreviewSession {
  id: string;
  adminId: string;
  adminName: string;
  companyId: string;
  mode: "READ_ONLY" | "SUPPORT";
  reason?: string;
  status: "PENDING_APPROVAL" | "ACTIVE" | "ENDED" | "REJECTED";
  approvedBy?: string;
  createdAt: string;
  expiresAt: string;
  endedAt?: string;
  endedBy?: string;
  ip?: string;
}

export interface TranslationOverride {
  id: string;
  lang: string;
  source: string;
  text: string;
  updatedAt: string;
  updatedBy: string;
}

export interface MaintenanceBanner {
  enabled: boolean;
  message: string;
  level: "info" | "warning" | "critical";
  startsAt?: string;
  endsAt?: string;
}

export interface PlatformSettings {
  platformName?: string;
  support?: { email?: string; telegram?: string; phone?: string; hours?: string };
  defaultTimezone?: string;
  /** Hisobot vaqt mintaqasi (KPI «bugun» shu bo‘yicha). */
  reportingTimezone?: string;
  defaultLanguage?: "uz" | "ru";
  trialDays?: number;
  session?: { panelHours?: number; reauthMinutes?: number };
  uploads?: { maxMb?: number };
  notifications?: {
    /** Platforma administratorlariga Telegram ogohlantirishlari (incident, support). */
    adminTelegram?: boolean;
    /** Tarif muddati haqida kompaniya egalariga ogohlantirish. */
    subscriptionAlerts?: boolean;
    expiryDays?: number[];
    onboardingUpdates?: boolean;
  };
  maintenance?: MaintenanceBanner;
  retention?: { auditDays?: number; metricsDays?: number; usageDays?: number; errorsDays?: number; deliveriesDays?: number; jobsDays?: number; securityDays?: number };
  alerts?: {
    errorRatePercent?: number;
    minRequests?: number;
    latencyP95Ms?: number;
    queueBacklog?: number;
    backupMaxAgeHours?: number;
    failedLogins?: number;
    cooldownMinutes?: number;
  };
  backups?: { scheduleHours?: number; keep?: number; includeMedia?: boolean; includeFiles?: boolean };
  /** Yozish huquqli yordam kirishi (standart: o‘chiq). */
  supportAccessEnabled?: boolean;
  languages?: { enabled?: string[] };
  modules?: Record<string, ModuleCatalogEntry>;
  demo?: { ttlDays?: number };
  /** Platforma administratorlari uchun 2 bosqichli kirish talab qilinadi. */
  requireAdminMfa?: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

/** Kompaniyaga qo‘shilgan platforma maydonlari (lib/types.ts → Company). */
export interface CompanyPlatformFields {
  subscription?: CompanySubscription;
  archive?: { at: string; by: string; reason: string; previousStatus: "ACTIVE" | "TRIAL" | "SUSPENDED" };
  demo?: { createdAt: string; expiresAt: string; createdBy: string };
  /** Ichki sinov kompaniyasi (feature flag INTERNAL doirasi, analitikadan chiqariladi). */
  internal?: boolean;
  moduleOverrides?: Record<string, ModuleOverride>;
  /** Onboarding: administrator belgilagan e’tibor talab qiladigan qadamlar. */
  onboardingNotes?: Record<string, string>;
  onboardingCompletedAt?: string;
}

/** Foydalanuvchiga qo‘shilgan platforma maydonlari. */
export interface UserPlatformFields {
  platformRole?: PlatformRole;
  blockedAt?: string;
  blockedBy?: string;
  blockReason?: string;
  /** Qo‘shimcha kompaniyalarga kirish (rahbar bir nechta kompaniyani boshqaradi). */
  extraCompanyIds?: string[];
  lastLoginAt?: string;
}

export const LEADER_ROLES: Role[] = ["COMPANY_OWNER", "HR_ADMIN", "HR_MANAGER", "FINANCE", "IT_ADMIN", "BRANCH_MANAGER"];
