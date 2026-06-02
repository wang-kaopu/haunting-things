import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 需要跨进程重启保留的服务端偏好。 */
export type ServerPreferences = {
  allowRemote?: boolean;
};

const SERVER_PREFERENCES_FILE = 'server.config.json';

/**
 * 从数据目录读取服务端偏好。
 *
 * 配置文件损坏时返回空对象，让服务仍能以默认本机访问模式启动。
 */
export function loadServerPreferences(dataDir: string): ServerPreferences {
  const filePath = getServerPreferencesPath(dataDir);
  if (!existsSync(filePath)) return {};

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const input = parsed as Record<string, unknown>;
    return {
      allowRemote: typeof input.allowRemote === 'boolean' ? input.allowRemote : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * 保存服务端偏好，保留未来可能加入的其它字段。
 */
export function saveServerPreferences(dataDir: string, preferences: ServerPreferences): void {
  const current = loadServerPreferences(dataDir);
  const next = {
    ...current,
    ...preferences,
  };
  writeFileSync(getServerPreferencesPath(dataDir), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

/**
 * 返回服务端偏好文件路径。
 */
function getServerPreferencesPath(dataDir: string): string {
  return path.join(dataDir, SERVER_PREFERENCES_FILE);
}
