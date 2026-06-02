import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type ServerPreferences = {
  allowRemote?: boolean;
};

const SERVER_PREFERENCES_FILE = 'server.config.json';

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

export function saveServerPreferences(dataDir: string, preferences: ServerPreferences): void {
  const current = loadServerPreferences(dataDir);
  const next = {
    ...current,
    ...preferences,
  };
  writeFileSync(getServerPreferencesPath(dataDir), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function getServerPreferencesPath(dataDir: string): string {
  return path.join(dataDir, SERVER_PREFERENCES_FILE);
}
