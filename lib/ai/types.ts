export type AiProvider = "OPENAI" | "GEMINI" | "ANTHROPIC" | "GROQ" | "STAFFORA";
export interface AiConfig {
  id: string;
  companyId: string;
  enabled: boolean;
  provider: AiProvider;
  model: string;
  apiKeyEnc?: string;
  apiKeyHint?: string;
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
  createdAt: string;
}

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
