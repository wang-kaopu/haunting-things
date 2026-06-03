import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { loadServerPreferences } from '@server/serverPreferences';

/** Web 服务默认监听端口。 */
export const DEFAULT_PORT = 25808;

/** 服务端启动配置。 */
export type AppConfig = {
  dataDir: string;
  dbPath: string;
  host: string;
  port: number;
  allowRemote: boolean;
  rendererDist: string;
};

/**
 * 读取服务端启动配置。
 *
 * 环境变量优先级高于持久化偏好；未显式配置时只监听本机回环地址。
 */
export function loadConfig(): AppConfig {
  const dataDir = process.env.DATA_DIR?.trim() || path.join(homedir(), '.Haunting-things');
  mkdirSync(dataDir, { recursive: true });

  const preferences = loadServerPreferences(dataDir);
  const hostOverride = process.env.HOST?.trim();
  const allowRemote =
    parseBoolean(process.env.ALLOW_REMOTE) ??
    (hostOverride ? hostOverride === '0.0.0.0' : undefined) ??
    preferences.allowRemote ??
    false;
  const host = hostOverride || resolveListenHost(allowRemote);
  const port = Number.parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

  return {
    dataDir,
    dbPath: path.join(dataDir, 'app.sqlite'),
    host,
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    allowRemote,
    rendererDist: path.resolve('dist/renderer'),
  };
}

/**
 * 根据远程访问开关解析监听地址。
 */
export function resolveListenHost(allowRemote: boolean): '0.0.0.0' | '127.0.0.1' {
  return allowRemote ? '0.0.0.0' : '127.0.0.1';
}

/**
 * 解析环境变量中的布尔值。
 */
function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}
