import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import { createApp } from './app/createApp';
import { registerBridgeHandlers } from './app/bridge/registerBridgeHandlers';
import { WebBridge } from './app/bridge/webBridge';
import { loadConfig } from './config';
import { openDatabase, Repository } from './db/db';
import { AuthService } from './services/authService';
import { EventBus } from './events';
import { ConversationService } from './services/conversationService';
import { createLogger } from './logger';
import { TeamService } from './services/teamService';

const config = loadConfig();
const logger = createLogger('server');
const db = openDatabase(config.dbPath);
const repo = new Repository(db);
const auth = new AuthService(repo);
await auth.ensureAdmin();

if (process.argv.includes('--reset-password')) {
  const password = await auth.resetAdminPassword();
  logger.info('admin_password_reset', {
    username: 'admin',
    password,
  });
  db.close();
  process.exit(0);
}

const events = new EventBus();
const conversations = new ConversationService(repo, events, config.dataDir);
const teams = new TeamService(repo, conversations, events);
const app = createApp({ auth, logger, rendererDist: config.rendererDist });
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const bridge = new WebBridge(wss, auth);

registerBridgeHandlers({
  bridge,
  conversations,
  teams,
  serverInfo: () => ({
    host: config.host,
    port: config.port,
    allowRemote: config.allowRemote,
    urls: getServerUrls(),
  }),
});

bridge.initialize(
  (socket) => events.add(socket),
  (socket) => events.delete(socket)
);

server.listen(config.port, config.host, () => {
  logger.info('server_listening', {
    host: config.host,
    port: config.port,
    urls: getServerUrls(),
  });
  if (auth.state.initialPassword) {
    logger.info('initial_admin_credentials', {
      username: 'admin',
      password: auth.state.initialPassword,
    });
  }
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/** 优雅停止 HTTP/WebSocket 流量并关闭 SQLite；若关闭卡住则强制退出。 */
function shutdown(): void {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
}

/** 根据当前监听配置生成本机和可选局域网访问地址。 */
function getServerUrls(): string[] {
  const urls = new Set<string>([`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`]);
  if (config.allowRemote) {
    for (const ip of getNonInternalIPv4()) urls.add(`http://${ip}:${config.port}`);
  }
  return [...urls];
}

/** 枚举非内网回环 IPv4 地址，用于生成远程访问 URL。 */
function getNonInternalIPv4(): string[] {
  const ips: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if ((entry.family === 'IPv4' || (entry.family as unknown) === 4) && !entry.internal) {
        ips.push(entry.address);
      }
    }
  }
  return ips;
}
