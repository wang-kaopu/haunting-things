import type { AcpModelInfo, AgentBackend, ConversationModels } from '../../shared/types';

const STORAGE_KEY = 'haunting-souls.model-cache.v1';

type ModelCacheRecord = Partial<Record<AgentBackend, CachedModels>>;

type CachedModels = {
  currentModelId?: string;
  models: AcpModelInfo[];
  updatedAt: number;
};

export function readCachedModels(backend: AgentBackend, conversationId: string): ConversationModels | null {
  const cached = readCache()[backend];
  if (!cached) return null;
  return {
    conversationId,
    currentModelId: cached.currentModelId,
    models: cached.models,
    updatedAt: cached.updatedAt,
  };
}

export function writeCachedModels(backend: AgentBackend, snapshot: ConversationModels): void {
  if (snapshot.models.length === 0 && !snapshot.currentModelId) return;

  const cache = readCache();
  const previous = cache[backend];
  cache[backend] = {
    currentModelId: snapshot.currentModelId,
    models: snapshot.models.length > 0 ? snapshot.models : previous?.models ?? [],
    updatedAt: snapshot.updatedAt,
  };
  writeCache(cache);
}

function readCache(): ModelCacheRecord {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as ModelCacheRecord;
  } catch {
    return {};
  }
}

function writeCache(cache: ModelCacheRecord): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore unavailable or full localStorage; the live runtime snapshot still works.
  }
}
