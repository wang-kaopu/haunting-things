import type { IncomingMessage } from 'node:http';
import type { WebSocketServer, WebSocket } from 'ws';
import type { AuthService } from '@server/services/authService';
import type { BridgeClientMessage, BridgeHandler, BridgeInvokeName, BridgeResultMessage } from '@shared/bridge';
import { createLogger } from '@server/utils/logger';
import { createRequestId, runWithRequestContext } from '@server/utils/requestContext';

/**
 * 渲染端与服务端之间的已认证 WebSocket RPC bridge。
 *
 * 渲染端消息由 `InvokeMap` 约束类型；该类负责分发到已注册处理器，
 * 并返回统一的成功或错误结果信封。
 */
export class WebBridge {
  private readonly handlers = new Map<string, BridgeHandler<any>>();
  private readonly logger = createLogger('bridge');

  constructor(
    private readonly wss: WebSocketServer,
    private readonly auth: AuthService
  ) {}

  /** 注册一个可由 renderer 调用的 RPC handler。 */
  register<Name extends BridgeInvokeName>(name: Name, handler: BridgeHandler<Name>): void {
    this.handlers.set(name, handler);
  }

  /** 为 WebSocket server 挂载认证和消息处理逻辑。 */
  initialize(onConnection: (socket: WebSocket) => void, onClose: (socket: WebSocket) => void): void {
    this.wss.on('connection', (socket, request) => {
      const token = this.auth.extractTokenFromCookieHeader((request as IncomingMessage).headers.cookie);
      const user = this.auth.verifyToken(token);
      if (!user) {
        socket.close(1008, 'Unauthorized');
        return;
      }

      this.logger.info('websocket_connected', {
        userId: user.id,
        remoteAddress: request.socket.remoteAddress,
      });
      onConnection(socket);
      socket.on('message', (raw) => {
        const requestId = createRequestId();
        void runWithRequestContext({ requestId, userId: user.id }, () => this.handleMessage(socket, raw.toString()));
      });
      socket.on('close', (code, reason) => {
        this.logger.info('websocket_closed', {
          userId: user.id,
          code,
          reason: reason.toString(),
        });
        onClose(socket);
      });
      socket.on('error', (error) => {
        this.logger.warn('websocket_error', {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
        onClose(socket);
      });
    });
  }

  /** 解析并分发一条客户端 invoke 消息。 */
  private async handleMessage(socket: WebSocket, raw: string): Promise<void> {
    let message: BridgeClientMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      this.logger.warn('invalid_message_json', {
        size: raw.length,
      });
      return;
    }
    if (message.type !== 'invoke') return;

    const handler = this.handlers.get(message.name);
    if (!handler) {
      this.logger.warn('invoke_unknown', {
        invokeId: message.id,
        name: message.name,
      });
      this.send(socket, { id: message.id, type: 'result', name: message.name, error: `Unknown API: ${message.name}` });
      return;
    }

    const startedAt = Date.now();
    this.logger.info(
      `bridge request: name=${message.name}, invoke_id=${message.id}, params=${formatBridgeValue(
        summarizeInvokeParams(message.name, message.data)
      )}`
    );

    try {
      const data = await handler(message.data as never);
      this.logger.info(
        `bridge response: name=${message.name}, invoke_id=${message.id}, status=ok, result=${formatBridgeValue(
          summarizeInvokeResult(message.name, data)
        )} - ${Date.now() - startedAt}ms`
      );
      this.send(socket, { id: message.id, type: 'result', name: message.name, data } as BridgeResultMessage);
    } catch (error) {
      this.logger.warn(
        `bridge response: name=${message.name}, invoke_id=${message.id}, status=error, error=${formatBridgeValue(
          error instanceof Error ? error.message : String(error)
        )} - ${Date.now() - startedAt}ms`
      );
      this.send(socket, {
        id: message.id,
        type: 'result',
        name: message.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 在 socket 仍打开时发送一条结果信封。 */
  private send(socket: WebSocket, payload: BridgeResultMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  }
}

/** 返回适合日志记录的 invoke 参数摘要，避免包含大字段或密钥。 */
function summarizeInvokeParams(name: string, data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;

  const input = data as Record<string, unknown>;

  switch (name) {
    case 'attachment.upload':
      return {
        fileName: input.fileName,
        mimeType: input.mimeType,
        dataBase64Length: typeof input.dataBase64 === 'string' ? input.dataBase64.length : undefined,
      };
    case 'attachment.delete':
      return pick(input, ['attachmentId']);
    case 'workspace.root':
    case 'workspace.browse':
    case 'workspace.selectDirectory':
    case 'workspace.createTemporary':
    case 'workspace.get':
    case 'workspace.tree':
    case 'workspace.readTextFile':
    case 'workspace.writeTextFile':
    case 'workspace.mkdir':
    case 'workspace.rename':
    case 'workspace.deleteEntry':
    case 'workspace.openPath':
    case 'workspace.revealPath':
      return {
        ...pick(input, ['workspaceId', 'name', 'relativePath', 'newName', 'search']),
        contentLength: typeof input.content === 'string' ? input.content.length : undefined,
      };
    case 'conversation.deleteMessage':
      return pick(input, ['messageId']);
    case 'conversation.deleteMessageAttachment':
      return pick(input, ['messageId', 'attachmentId']);
    case 'conversation.sendMessage':
    case 'conversation.cancel':
    case 'team.sendMessage':
    case 'team.sendMessageToAgent':
      return {
        ...pick(input, ['conversationId', 'teamId', 'slotId']),
        contentLength: typeof input.content === 'string' ? input.content.length : undefined,
        filesCount: Array.isArray(input.files) ? input.files.length : 0,
      };
    case 'conversation.setModel':
    case 'conversation.setMode':
    case 'team.setAgentModel':
      return pick(input, ['conversationId', 'teamId', 'slotId', 'model', 'mode']);
    case 'conversation.confirmPermission':
      return pick(input, ['conversationId', 'callId', 'optionId']);
    case 'team.create':
      return pick(input, ['name', 'workspaceId', 'leaderBackend', 'leaderModel']);
    case 'team.addAgent':
      return pick(input, ['teamId', 'name', 'backend', 'model']);
    default:
      return redactObject(input);
  }
}

/** 返回用于结构化 invoke 日志的紧凑结果摘要。 */
function summarizeInvokeResult(name: string, result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;

  if (Array.isArray(result)) {
    return { count: result.length };
  }

  const output = result as Record<string, unknown>;

  switch (name) {
    case 'conversation.create':
      return pick(output, ['id', 'backend', 'workspaceId', 'model', 'status']);
    case 'team.create':
      return pick(output, ['id', 'name', 'workspaceId', 'leaderSlotId']);
    case 'team.addAgent':
      return pick(output, ['slotId', 'conversationId', 'backend', 'model', 'status']);
    default:
      return summarizeObject(output);
  }
}

/** 仅从对象中复制指定字段用于结构化日志。 */
function pick(input: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in input).map((key) => [key, input[key]]));
}

/** 记录任意结果对象时保留完整字段，便于排查 bridge 返回内容。 */
function summarizeObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input));
}

/** 从任意 invoke payload 日志中脱敏明显的凭据字段。 */
function redactObject(input: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set(['password', 'currentPassword', 'newPassword', 'token', 'authorization']);
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, blocked.has(key) ? '***' : value]));
}

/** 将 Bridge 日志值转换为一行可读文本。 */
function formatBridgeValue(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}
