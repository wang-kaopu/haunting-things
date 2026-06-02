import type { AcpAvailableCommand, AgentBackend, ConversationCommands } from '../../shared/types';

const STORAGE_KEY = 'haunting-souls.command-cache.v1';

type CommandCacheRecord = Partial<Record<AgentBackend, CachedCommands>>;

type CachedCommands = {
  commands: AcpAvailableCommand[];
  updatedAt: number;
};

/** 读取指定后端的可用命令缓存，作为运行时快照到达前的占位数据。 */
export function readCachedCommands(backend: AgentBackend, conversationId: string): ConversationCommands | null {
  const cached = readCache()[backend];
  if (!cached) return null;
  return {
    conversationId,
    commands: cached.commands,
    updatedAt: cached.updatedAt,
  };
}

/** 写入可用命令缓存，避免切换会话时命令下拉短暂退回空状态。 */
export function writeCachedCommands(backend: AgentBackend, snapshot: ConversationCommands): void {
  if (snapshot.commands.length === 0) return;

  const cache = readCache();
  cache[backend] = {
    commands: snapshot.commands,
    updatedAt: snapshot.updatedAt,
  };
  writeCache(cache);
}

function readCache(): CommandCacheRecord {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as CommandCacheRecord;
  } catch {
    return {};
  }
}

function writeCache(cache: CommandCacheRecord): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore unavailable or full localStorage; the live runtime snapshot still works.
  }
}
