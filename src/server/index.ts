import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import express from 'express';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import { loadConfig } from './config';
import { openDatabase, Repository } from './db';
import { AuthService } from './auth';
import { EventBus } from './events';
import { ConversationService } from './conversations';
import { createLogger } from './logger';
import { TeamService } from './teamService';
import { WebBridge } from './webBridge';
import { healthAgent, listAgents } from './agentRegistry';

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

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    logger.warn('auth_login_invalid_request', {
      username: typeof username === 'string' ? username : undefined,
    });
    res.status(400).json({ success: false, error: 'username and password are required' });
    return;
  }
  const result = await auth.login(username, password);
  if (!result) {
    logger.warn('auth_login_failed', {
      username,
    });
    res.status(401).json({ success: false, error: 'Invalid username or password' });
    return;
  }
  auth.setCookie(res, result.token);
  logger.info('auth_login_success', {
    username: result.user.username,
    userId: result.user.id,
  });
  res.json({ success: true, user: result.user });
});

app.post('/logout', auth.authenticateRequest, (req, res) => {
  const user = (req as any).user as { id?: string; username?: string } | undefined;
  logger.info('auth_logout', {
    userId: user?.id,
    username: user?.username,
  });
  auth.clearCookie(res);
  res.json({ success: true });
});

app.get('/api/auth/user', auth.authenticateRequest, (req, res) => {
  res.json({ success: true, user: (req as any).user });
});

app.post('/api/auth/change-password', auth.authenticateRequest, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    const user = (req as any).user as { id?: string; username?: string } | undefined;
    logger.warn('auth_change_password_invalid_request', {
      userId: user?.id,
      username: user?.username,
    });
    res.status(400).json({ success: false, error: 'currentPassword and newPassword are required' });
    return;
  }
  const ok = await auth.changePassword(currentPassword, newPassword);
  if (!ok) {
    const user = (req as any).user as { id?: string; username?: string } | undefined;
    logger.warn('auth_change_password_failed', {
      userId: user?.id,
      username: user?.username,
    });
    res.status(400).json({ success: false, error: 'Password update failed' });
    return;
  }
  const user = (req as any).user as { id?: string; username?: string } | undefined;
  logger.info('auth_change_password_success', {
    userId: user?.id,
    username: user?.username,
  });
  auth.clearCookie(res);
  res.json({ success: true });
});

serveRenderer(app);

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const bridge = new WebBridge(wss, auth);

bridge.register('agent.list', () => listAgents());
bridge.register('agent.health', ({ backend }) => healthAgent(backend));
bridge.register('conversation.create', (params) => conversations.create(params));
bridge.register('conversation.setModel', (params) => conversations.setModel(params));
bridge.register('conversation.list', () => conversations.list());
bridge.register('conversation.messages', ({ conversationId }) => conversations.messages(conversationId));
bridge.register('conversation.agentEvents', ({ conversationId, limit }) =>
  conversations.agentEvents(conversationId, limit)
);
bridge.register('conversation.commands', ({ conversationId }) => conversations.commands(conversationId));
bridge.register('conversation.models', ({ conversationId }) => conversations.models(conversationId));
bridge.register('conversation.mode', ({ conversationId }) => conversations.mode(conversationId));
bridge.register('conversation.sendMessage', async (params) => {
  await conversations.sendMessage(params);
  return { accepted: true };
});
bridge.register('conversation.confirmPermission', (params) => {
  conversations.confirmPermission(params);
  return { accepted: true };
});
bridge.register('team.create', (params) => teams.create(params));
bridge.register('team.delete', ({ teamId }) => teams.delete(teamId));
bridge.register('team.addAgent', (params) => teams.addAgent(params));
bridge.register('team.removeAgent', (params) => teams.removeAgent(params));
bridge.register('team.setAgentModel', (params) => teams.setAgentModel(params));
bridge.register('team.finishTask', (params) => teams.finishTask(params));
bridge.register('team.taskCreate', (params) => teams.taskCreate(params));
bridge.register('team.tasks', ({ teamId }) => teams.tasks(teamId));
bridge.register('team.get', ({ teamId }) => teams.get(teamId));
bridge.register('team.list', () => teams.list());
bridge.register('team.sendMessage', async (params) => {
  await teams.sendMessage(params);
  return { accepted: true };
});
bridge.register('team.sendMessageToAgent', async (params) => {
  await teams.sendMessageToAgent(params);
  return { accepted: true };
});
bridge.register('team.timeline', ({ teamId }) => teams.timeline(teamId));
bridge.register('team.stop', async ({ teamId }) => {
  await teams.stop(teamId);
  return { stopped: true };
});
bridge.register('server.info', () => ({
  host: config.host,
  port: config.port,
  allowRemote: config.allowRemote,
  urls: getServerUrls(),
}));

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

/** 提供已构建的 renderer 资源；前端未构建时返回明确的 503。 */
function serveRenderer(expressApp: express.Express): void {
  const indexHtml = path.join(config.rendererDist, 'index.html');
  if (existsSync(indexHtml)) {
    expressApp.use(express.static(config.rendererDist));
    expressApp.use((_req, res) => res.sendFile(indexHtml));
    return;
  }
  expressApp.use((_req, res) => {
    res
      .status(503)
      .send('Renderer is not built. Run `npm run build:renderer` or `npm run build` before starting the server.');
  });
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
