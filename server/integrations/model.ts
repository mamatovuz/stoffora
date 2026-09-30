import { randomUUID } from "node:crypto";
import type {
  Database,
  EntityMapping,
  Integration,
  IntegrationSettings,
  SyncEntity,
} from "../../lib/types";
import { BotClient } from "./client";
import { decryptSecret } from "./secrets";

export const PROVIDER = "gulnora_hr_bot" as const;
export const SOURCE_KEY = "staffora";

export function defaultIntegrationSettings(): IntegrationSettings {
  return {
    syncModes: {
      branch: "TWO_WAY",
      department: "TWO_WAY",
      position: "TWO_WAY",
      employee: "TWO_WAY",
      attendance: "TWO_WAY",
    },
    conflictStrategy: "MANUAL",
    applyRemoteDeletes: true,
    createInBot: false,
    pushAttendance: true,
    pollIntervalSeconds: 60,
    inviteTtlHours: 168,
    routing: {
      attendance: ["staffora", "telegram"],
      leave: ["staffora", "telegram"],
      announcements: ["staffora", "telegram", "bot"],
      system: ["staffora"],
      payroll: ["staffora", "telegram", "bot"],
    },
  };
}

export function normalizeSettings(value?: Partial<IntegrationSettings>): IntegrationSettings {
  const base = defaultIntegrationSettings();
  const merged = { ...base, ...(value || {}) };
  merged.syncModes = { ...base.syncModes, ...(value?.syncModes || {}) };
  merged.routing = { ...base.routing, ...(value?.routing || {}) };
  // 0 — faqat qo‘lda (webhook bo‘lsa real vaqt), aks holda 15 soniya – 1 soat.
  const poll = Math.round(Number(merged.pollIntervalSeconds));
  merged.pollIntervalSeconds = poll === 0 ? 0 : Math.min(3600, Math.max(15, poll || 60));
  merged.inviteTtlHours = Math.min(24 * 30, Math.max(1, Math.round(Number(merged.inviteTtlHours) || 168)));
  merged.miniAppLink = normalizeMiniAppLink(merged.miniAppLink);
  return merged;
}

export const newId = () => randomUUID();

/** https://t.me/<bot>/<app> (yoki t.me/...) — to‘g‘ri bo‘lmasa undefined. */
export function normalizeMiniAppLink(value?: string) {
  const text = (value || "").trim().replace(/^http:\/\//i, "https://");
  const match = /^(?:https:\/\/)?t\.me\/([A-Za-z0-9_]{5,32})\/([A-Za-z0-9_]{3,30})\/?$/i.exec(text);
  return match ? `https://t.me/${match[1]}/${match[2]}` : undefined;
}

export function clientFor(integration: Integration, fetchImpl?: typeof fetch) {
  return new BotClient({
    baseUrl: integration.baseUrl,
    apiKey: decryptSecret(integration.apiKeyEnc),
    fetchImpl,
  });
}

/** Kompaniyaning faol (ulangan) integratsiyasi. */
export function activeIntegration(db: Database, companyId: string) {
  return db.integrations.find(
    (item) => item.companyId === companyId && item.provider === PROVIDER && item.status !== "DISCONNECTED",
  );
}

export function integrationById(db: Database, companyId: string, id: string) {
  return db.integrations.find((item) => item.id === id && item.companyId === companyId);
}

/** Frontendga qaytadigan ko‘rinish — shifrlangan kalitlarsiz. */
export function publicIntegration(integration: Integration) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { apiKeyEnc, webhookSecretEnc, ...rest } = integration;
  return { ...rest, webhookActive: Boolean(webhookSecretEnc && integration.remoteWebhookId) };
}

/* ----------------------------------------------------------- mapping --- */

type MappingIndex = {
  byLocal: Map<string, EntityMapping>;
  byExternal: Map<string, EntityMapping>;
};
const indexCache = new WeakMap<EntityMapping[], { length: number; index: MappingIndex }>();

function mappingIndex(db: Database): MappingIndex {
  // Mapping'lar faqat push/filter bilan o‘zgaradi: uzunlik yoki massiv o‘zgarsa kesh yangilanadi.
  const cached = indexCache.get(db.entityMappings);
  if (cached && cached.length === db.entityMappings.length) return cached.index;
  const index: MappingIndex = { byLocal: new Map(), byExternal: new Map() };
  for (const m of db.entityMappings) {
    index.byLocal.set(`${m.integrationId}|${m.entity}|${m.localId}`, m);
    index.byExternal.set(`${m.integrationId}|${m.entity}|${m.externalId}`, m);
  }
  indexCache.set(db.entityMappings, { length: db.entityMappings.length, index });
  return index;
}

export function mappingByExternal(db: Database, integrationId: string, entity: SyncEntity, externalId: string | number) {
  const m = mappingIndex(db).byExternal.get(`${integrationId}|${entity}|${externalId}`);
  // Kesh eskirgan bo‘lishi mumkin (mapping o‘chirilgan/almashtirilgan) — tekshiramiz.
  return m && m.externalId === String(externalId) ? m : undefined;
}

export function mappingByLocal(db: Database, integrationId: string, entity: SyncEntity, localId: string) {
  const m = mappingIndex(db).byLocal.get(`${integrationId}|${entity}|${localId}`);
  return m && m.localId === localId ? m : undefined;
}

/** Mapping yaratadi yoki yangilaydi. Bitta tomon ikki marta bog‘lanmaydi. */
export function upsertMapping(
  db: Database,
  integration: Integration,
  entity: SyncEntity,
  localId: string,
  externalId: string | number,
  extra: Partial<EntityMapping> = {},
) {
  const external = String(externalId);
  const now = new Date().toISOString();
  let mapping = mappingByExternal(db, integration.id, entity, external) || mappingByLocal(db, integration.id, entity, localId);
  if (mapping && (mapping.localId !== localId || mapping.externalId !== external)) {
    // Eski bog‘lanishlarni tozalaymiz (bir-biriga bittadan).
    db.entityMappings = db.entityMappings.filter(
      (m) =>
        !(m.integrationId === integration.id && m.entity === entity && (m.localId === localId || m.externalId === external)),
    );
    mapping = undefined;
  }
  if (!mapping) {
    mapping = {
      id: newId(),
      companyId: integration.companyId,
      integrationId: integration.id,
      provider: PROVIDER,
      entity,
      localId,
      externalId: external,
      syncedAt: now,
    };
    db.entityMappings.push(mapping);
  }
  Object.assign(mapping, extra, { syncedAt: now });
  return mapping;
}
