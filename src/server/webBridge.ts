import type { IncomingMessage } from 'node:http';
import type { WebSocketServer, WebSocket } from 'ws';
import type { AuthService } from './auth';
import type { BridgeClientMessage, BridgeHandler, BridgeInvokeName, BridgeResultMessage } from '../shared/bridge';

export class WebBridge {
  private readonly handlers = new Map<string, BridgeHandler<any>>();

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
      return;
    }
    if (message.type !== 'invoke') return;

    const handler = this.handlers.get(message.name);
    if (!handler) {
      this.send(socket, { id: message.id, type: 'result', name: message.name, error: `Unknown API: ${message.name}` });
      return;
    }

    try {
      const data = await handler(message.data as never);
      this.send(socket, { id: message.id, type: 'result', name: message.name, data } as BridgeResultMessage);
    } catch (error) {
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
