import type { AiConfig, AiProvider } from "../../lib/ai/types";
import { decryptSecret } from "../integrations/secrets";

type ProviderMessage = { role: "system" | "user" | "assistant"; content: string };
export type ProviderResult = { text: string; inputTokens: number; outputTokens: number; model: string };

const timeoutFetch = async (url: string, init: RequestInit, timeoutMs = 25_000) => {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
};

const safeError = (body: unknown, status: number) => {
  const message = typeof body === "object" && body && "error" in body
    ? typeof (body as { error?: unknown }).error === "object" ? String(((body as { error: { message?: unknown } }).error.message || "")) : String((body as { error?: unknown }).error || "")
    : "";
  return Object.assign(new Error(message.slice(0, 240) || `AI provider HTTP ${status}`), { status: 502, code: "AI_PROVIDER_ERROR" });
};

function apiKey(config: AiConfig) {
  if (!config.apiKeyEnc) throw Object.assign(new Error("AI API key sozlanmagan."), { status: 409, code: "AI_KEY_MISSING" });
  return decryptSecret(config.apiKeyEnc);
}

export async function callProvider(config: AiConfig, messages: ProviderMessage[]): Promise<ProviderResult> {
  const key = config.provider === "STAFFORA" ? process.env.STAFFORA_AI_API_KEY : apiKey(config);
  if (!key) throw Object.assign(new Error("Staffora AI Plan server kaliti sozlanmagan."), { status: 503, code: "AI_PLAN_NOT_CONFIGURED" });
  if (config.provider === "OPENAI" || config.provider === "STAFFORA") return openAi(config.model, key, messages);
  if (config.provider === "GROQ") return openAiCompatible(config.model, key, messages, "https://api.groq.com/openai/v1/chat/completions");
  if (config.provider === "ANTHROPIC") return anthropic(config.model, key, messages);
  return gemini(config.model, key, messages);
}

async function openAi(model: string, key: string, messages: ProviderMessage[]) {
  const response = await timeoutFetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, input: messages.map((m) => ({ role: m.role, content: [{ type: "input_text", text: m.content }] })), max_output_tokens: 1200 }) });
  const body = await response.json() as { output?: { content?: { type: string; text?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number }; error?: unknown };
  if (!response.ok) throw safeError(body, response.status);
  const text = body.output?.flatMap((o) => o.content || []).filter((c) => c.type === "output_text").map((c) => c.text || "").join("\n").trim();
  if (!text) throw Object.assign(new Error("AI provider bo‘sh javob qaytardi."), { status: 502 });
  return { text, inputTokens: body.usage?.input_tokens || 0, outputTokens: body.usage?.output_tokens || 0, model };
}

async function openAiCompatible(model: string, key: string, messages: ProviderMessage[], url: string) {
  const response = await timeoutFetch(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, max_completion_tokens: 1200 }) });
  const body = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: unknown };
  if (!response.ok) throw safeError(body, response.status); const text = body.choices?.[0]?.message?.content?.trim(); if (!text) throw Object.assign(new Error("AI provider bo‘sh javob qaytardi."), { status: 502 });
  return { text, inputTokens: body.usage?.prompt_tokens || 0, outputTokens: body.usage?.completion_tokens || 0, model };
}

async function anthropic(model: string, key: string, messages: ProviderMessage[]) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n"); const chat = messages.filter((m) => m.role !== "system");
  const response = await timeoutFetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model, system, messages: chat, max_tokens: 1200 }) });
  const body = await response.json() as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; error?: unknown }; if (!response.ok) throw safeError(body, response.status); const text = body.content?.filter((c) => c.type === "text").map((c) => c.text || "").join("\n").trim(); if (!text) throw Object.assign(new Error("AI provider bo‘sh javob qaytardi."), { status: 502 }); return { text, inputTokens: body.usage?.input_tokens || 0, outputTokens: body.usage?.output_tokens || 0, model };
}

async function gemini(model: string, key: string, messages: ProviderMessage[]) {
  const systemInstruction = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n"); const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const response = await timeoutFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: systemInstruction }] }, contents, generationConfig: { maxOutputTokens: 1200 } }) });
  const body = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }; error?: unknown }; if (!response.ok) throw safeError(body, response.status); const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n").trim(); if (!text) throw Object.assign(new Error("AI provider bo‘sh javob qaytardi."), { status: 502 }); return { text, inputTokens: body.usageMetadata?.promptTokenCount || 0, outputTokens: body.usageMetadata?.candidatesTokenCount || 0, model };
}

export const providerDefaults: Record<AiProvider, string[]> = {
  OPENAI: ["gpt-5-mini", "gpt-5"],
  GEMINI: ["gemini-2.5-flash", "gemini-2.5-pro"],
  ANTHROPIC: ["claude-sonnet-4-5", "claude-haiku-4-5"],
  GROQ: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"],
  STAFFORA: [process.env.STAFFORA_AI_MODEL || "gpt-5-mini"],
};
