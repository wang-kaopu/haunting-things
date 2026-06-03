import path from 'node:path';
import { createApp } from '@server/app/createApp';
import { registerBridgeHandlers } from '@server/app/bridge/registerBridgeHandlers';
import { loadConfig } from '@server/config';
import { openDatabase } from '@server/db/connection';
import { AttachmentRepository } from '@server/db/attachmentRepository';
import { ConversationRepository } from '@server/db/conversationRepository';
import { MailboxRepository } from '@server/db/mailboxRepository';
import { TaskRepository } from '@server/db/taskRepository';
import { TeamRepository } from '@server/db/teamRepository';
import { UserRepository } from '@server/db/userRepository';
import { AuthService } from '@server/services/authService';
import { AttachmentService } from '@server/services/attachmentService';
import { EventBus } from '@server/events';
import { ConversationService } from '@server/services/conversationService';
import { createLogger } from '@server/utils/logger';
import { installRpcLogger } from '@server/utils/rpcLogger';
import { TeamService } from '@server/services/teamService';
import { ServerManager } from '@server/serverManager';

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
conversations.recoverStaleRuntimeState();
const teams = new TeamService(teamsRepo, mailboxRepo, tasksRepo, conversations, events, attachmentsRepo, attachmentService);
const app = createApp({ auth, logger, rendererDist: config.rendererDist, attachments: attachmentsRepo });
const serverManager = new ServerManager({
  app,
  auth,
  logger,
  dataDir: config.dataDir,
  port: config.port,
  allowRemote: config.allowRemote,
  configureBridge: (bridge) => {
    registerBridgeHandlers({
      bridge,
      attachments: attachmentsRepo,
      attachmentService,
      conversations,
      teams,
      serverInfo: () => serverManager.info(),
      setRemoteAccess: ({ allowRemote }) => serverManager.setRemoteAccess(allowRemote),
    });

    bridge.initialize(
      (socket) => events.add(socket),
      (socket) => events.delete(socket)
    );
  },
  onFirstListen: () => {
    logger.info('server_listening', serverManager.info());
    if (auth.state.initialPassword) {
      logger.info(
        'initial_admin_credentials',
        {
          username: 'admin',
          password: auth.state.initialPassword,
        },
        { reveal: ['password'] }
      );
    }
  },
});

await serverManager.start();

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/** 优雅停止 HTTP/WebSocket 流量并关闭 SQLite；若关闭卡住则强制退出。 */
function shutdown(): void {
  void serverManager.shutdown().finally(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
}
