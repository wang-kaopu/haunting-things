import type { WebSocket } from 'ws';
import type { BridgeEventMessage, BridgeEventName } from '../shared/bridge';
import type { EventMap } from '../shared/types';

export class EventBus {
  private readonly sockets = new Set<WebSocket>();

  add(socket: WebSocket): void {
    this.sockets.add(socket);
  }

  delete(socket: WebSocket): void {
    this.sockets.delete(socket);
  }

  emit<Name extends BridgeEventName>(name: Name, data: EventMap[Name]): void {
    const payload: BridgeEventMessage<Name> = { type: 'event', name, data };
    const raw = JSON.stringify(payload);
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(raw);
      }
    }
  }
}
