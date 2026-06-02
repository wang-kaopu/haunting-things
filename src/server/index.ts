import http from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { createApp } from './app/createApp';
import { registerBridgeHandlers } from './app/bridge/registerBridgeHandlers';
import { WebBridge } from './app/bridge/webBridge';
import { loadConfig } from './config';
import { openDatabase } from './db/connection';
import { AttachmentRepository } from './db/attachmentRepository';
import { ConversationRepository } from './db/conversationRepository';
import { MailboxRepository } from './db/mailboxRepository';
import { TaskRepository } from './db/taskRepository';
import { TeamRepository } from './db/teamRepository';
import { UserRepository } from './db/userRepository';
import { AuthService } from './services/authService';
import { AttachmentService } from './services/attachmentService';
import { EventBus } from './events';
import { ConversationService } from './services/conversationService';
import { createLogger } from './utils/logger';
import { installRpcLogger } from './utils/rpcLogger';
import { TeamService } from './services/teamService';

installRpcLogger();

const config = loadConfig();
const logger = createLogger('server');
const db = openDatabase(config.dbPath);
const usersRepo = new UserRepository(db);
const attachmentsRepo = new AttachmentRepository(db);
const conversationsRepo = new ConversationRepository(db);
const teamsRepo = new TeamRepository(db);
const mailboxRepo = new MailboxRepository(db);
const tasksRepo = new TaskRepository(db);
const auth = new AuthService(usersRepo);

if (process.argv.includes('--reset-password')) {
  const deletedUsers = auth.clearAdminPassword();
  logger.info('admin_password_cleared', {
    username: 'admin',
    deletedUsers,
  });
  db.close();
  process.exit(0);
}

await auth.ensureAdmin();

const events = new EventBus();
const attachmentService = new AttachmentService(path.join(config.dataDir, 'attachments'));
const conversations = new ConversationService(conversationsRepo, events, config.dataDir, attachmentsRepo, attachmentService);
const teams = new TeamService(teamsRepo, mailboxRepo, tasksRepo, conversations, events, attachmentsRepo, attachmentService);
const app = createApp({ auth, logger, rendererDist: config.rendererDist, attachments: attachmentsRepo });
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const bridge = new WebBridge(wss, auth);

registerBridgeHandlers({
  bridge,
  attachments: attachmentsRepo,
  attachmentService,
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
    }, { reveal: ['password'] });
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
