import type { IncomingMessage } from 'node:http';
import type { WebSocketServer, WebSocket } from 'ws';
import type { AuthService } from './auth';
import type { BridgeClientMessage, BridgeHandler, BridgeInvokeName, BridgeResultMessage } from '../shared/bridge';
import { createLogger } from './logger';

export class WebBridge {
  private readonly handlers = new Map<string, BridgeHandler<any>>();
  private readonly logger = createLogger('bridge');

  constructor(
    private readonly wss: WebSocketServer,
    private readonly auth: AuthService
  ) {}

  register<Name extends BridgeInvokeName>(name: Name, handler: BridgeHandler<Name>): void {
    this.handlers.set(name, handler);
  }

  initialize(onConnection: (socket: WebSocket) => void, onClose: (socket: WebSocket) => void): void {
    this.wss.on('connection', (socket, request) => {
      const token = this.auth.extractTokenFromCookieHeader((request as IncomingMessage).headers.cookie);
      const user = this.auth.verifyToken(token);
      if (!user) {
        socket.close(1008, 'Unauthorized');
        return;
      }

      onConnection(socket);
      socket.on('message', (raw) => void this.handleMessage(socket, raw.toString()));
      socket.on('close', () => onClose(socket));
      socket.on('error', () => onClose(socket));
    });
  }

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
    this.logger.info('invoke_start', {
      invokeId: message.id,
      name: message.name,
      params: summarizeInvokeParams(message.name, message.data),
    });

    try {
      const data = await handler(message.data as never);
      this.logger.info('invoke_success', {
        invokeId: message.id,
        name: message.name,
        ms: Date.now() - startedAt,
        result: summarizeInvokeResult(message.name, data),
      });
      this.send(socket, { id: message.id, type: 'result', name: message.name, data } as BridgeResultMessage);
    } catch (error) {
      this.logger.warn('invoke_error', {
        invokeId: message.id,
        name: message.name,
        ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      this.send(socket, {
        id: message.id,
        type: 'result',
        name: message.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private send(socket: WebSocket, payload: BridgeResultMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  }
}

function summarizeInvokeParams(name: string, data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;

  const input = data as Record<string, unknown>;

  switch (name) {
    case 'conversation.sendMessage':
    case 'team.sendMessage':
    case 'team.sendMessageToAgent':
      return {
        ...pick(input, ['conversationId', 'teamId', 'slotId']),
        contentLength: typeof input.content === 'string' ? input.content.length : undefined,
        filesCount: Array.isArray(input.files) ? input.files.length : 0,
      };
    case 'conversation.setModel':
    case 'team.setAgentModel':
      return pick(input, ['conversationId', 'teamId', 'slotId', 'model']);
    case 'conversation.confirmPermission':
      return pick(input, ['conversationId', 'callId', 'optionId']);
    case 'team.create':
      return pick(input, ['name', 'workspace', 'leaderBackend', 'leaderModel']);
    case 'team.addAgent':
      return pick(input, ['teamId', 'name', 'backend', 'model']);
    default:
      return redactObject(input);
  }
}

function summarizeInvokeResult(name: string, result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;

  if (Array.isArray(result)) {
    return { count: result.length };
  }

  const output = result as Record<string, unknown>;

  switch (name) {
    case 'conversation.create':
      return pick(output, ['id', 'backend', 'model', 'status']);
    case 'team.create':
      return pick(output, ['id', 'name', 'leaderSlotId']);
    case 'team.addAgent':
      return pick(output, ['slotId', 'conversationId', 'backend', 'model', 'status']);
    default:
      return summarizeObject(output);
  }
}

function pick(input: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in input).map((key) => [key, input[key]]));
}

function summarizeObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (typeof value === 'string' && value.length > 160) {
        return [key, `${value.slice(0, 157)}...`];
      }
      if (Array.isArray(value)) {
        return [key, { count: value.length }];
      }
      return [key, value];
    })
  );
}

function redactObject(input: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set(['password', 'currentPassword', 'newPassword', 'token', 'authorization']);
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, blocked.has(key) ? '***' : value]));
}
