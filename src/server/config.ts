import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const DEFAULT_PORT = 25808;

export type AppConfig = {
  dataDir: string;
  dbPath: string;
  host: string;
  port: number;
  allowRemote: boolean;
  rendererDist: string;
};

export function loadConfig(): AppConfig {
  const dataDir = process.env.DATA_DIR?.trim() || path.join(homedir(), '.Haunting-things');
  mkdirSync(dataDir, { recursive: true });

  const allowRemote = process.env.ALLOW_REMOTE === 'true' || process.env.HOST === '0.0.0.0';
  const host = process.env.HOST?.trim() || (allowRemote ? '0.0.0.0' : '127.0.0.1');
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
