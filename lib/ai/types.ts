export type AiProvider = "OPENAI" | "GEMINI" | "ANTHROPIC" | "GROQ" | "STAFFORA";
export interface AiConfig {
  id: string;
  companyId: string;
  enabled: boolean;
  provider: AiProvider;
  model: string;
  apiKeyEnc?: string;
  apiKeyHint?: string;
  credentials?: {
    id: string;
    provider: Exclude<AiProvider, "STAFFORA">;
    model: string;
    keyEnc: string;
    keyHint: string;
    label?: string;
    active: boolean;
    createdAt: string;
    lastTestAt?: string;
    lastTestOk?: boolean;
    lastError?: string;
  }[];
  responseLanguage: "uz" | "ru" | "en";
  voiceEnabled: boolean;
  dailyTokenLimit?: number;
  monthlyTokenLimit?: number;
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastError?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface AiConversation {
  id: string;
  companyId: string;
  userId: string;
  channel: "WEB" | "TELEGRAM";
  telegramChatId?: string;
  provider: AiProvider;
  model: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiMessage {
  id: string;
  conversationId: string;
  companyId: string;
  userId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  text: string;
  actionId?: string;
  /** Real ma’lumotdan tuzilgan hisobot kartasi (web chatda jadval/statistika sifatida ko‘rsatiladi). */
  card?: AiCard;
  /** Keyingi qadam tugmalari (saytda chip, Telegram’da inline tugma). */
  suggestions?: AiSuggestion[];
  createdAt: string;
}

export type AiTone = "green" | "amber" | "red" | "blue" | "gray";

/** AI javobidagi tuzilgan natija: ko‘rsatkichlar, jadval yoki xodim kartasi (raqamlar faqat bazadan). */
export type AiCard =
  | { kind: "stats"; title: string; subtitle?: string; items: { label: string; value: string; tone?: AiTone }[] }
  | { kind: "table"; title: string; subtitle?: string; columns: string[]; rows: string[][]; more?: number }
  | {
      kind: "profile";
      title: string;
      subtitle?: string;
      /** Ism-familiya bosh harflari (rasm o‘rnida). */
      initials: string;
      status?: { text: string; tone: AiTone };
      fields: { label: string; value: string }[];
      /** Panel ichidagi sahifa (masalan /employees/<id>). */
      link?: string;
    };

/**
 * Tugma: `prompt` — bosilganda AI’ga yuboriladigan matn. `key` — Telegram callback uchun qisqa
 * kalit (64 bayt chegarasi): `k:late`, `e:<employeeId>` kabi.
 */
export type AiSuggestion = { label: string; prompt: string; key?: string };

/** Tezkor savollar: sayt chiplari va Telegram tugmalari bir xil ro‘yxatdan. */
export const AI_QUICK = {
  today: { label: "Bugungi davomat", prompt: "Bugungi davomatni ko‘rsat" },
  late: { label: "Kechikkanlar", prompt: "Bugun kechikkan xodimlar" },
  absent: { label: "Kelmaganlar", prompt: "Bugun kelmagan xodimlar" },
  branches: { label: "Filiallar", prompt: "Filiallar statistikasi" },
  week: { label: "Haftalik hisobot", prompt: "O‘tgan hafta hisoboti" },
  rank: { label: "Oy reytingi", prompt: "Bu oy eng ko‘p kechikkanlar" },
  leave: { label: "Ta’til so‘rovlari", prompt: "Kutilayotgan ta’til so‘rovlari" },
  schedules: { label: "Ish grafiklari", prompt: "Ish grafiklarini ko‘rsat" },
} as const;
export type AiQuickKey = keyof typeof AI_QUICK;
export const quick = (key: AiQuickKey): AiSuggestion => ({ ...AI_QUICK[key], key: `k:${key}` });

export type AiActionLevel = "READ" | "WRITE" | "SENSITIVE" | "FORBIDDEN";
export interface AiActionExecution {
  id: string;
  companyId: string;
  userId: string;
  conversationId?: string;
  name: string;
  level: AiActionLevel;
  payload: Record<string, unknown>;
  summary: string;
  status: "PENDING_CONFIRMATION" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "EXPIRED";
  idempotencyKey: string;
  confirmationTokenHash?: string;
  confirmationExpiresAt?: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface AiUsageLog {
  id: string;
  companyId: string;
  userId: string;
  provider: AiProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number;
  channel: "WEB" | "TELEGRAM";
  createdAt: string;
}

export interface AiTelegramIntegration {
  id: string;
  companyId: string;
  tokenEnc: string;
  tokenHint: string;
  botId: number;
  username: string;
  displayName: string;
  enabled: boolean;
  webhookSecretHash: string;
  webhookStatus: "PENDING" | "ACTIVE" | "ERROR";
  lastActivityAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiTelegramLink {
  id: string;
  companyId: string;
  userId: string;
  telegramUserId: string;
  telegramChatId: string;
  username?: string;
  linkedAt: string;
}

export interface AiPairingToken {
  id: string;
  companyId: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt?: string;
  createdAt: string;
}
