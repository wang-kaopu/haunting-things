import type { WebSocket } from 'ws';
import type { BridgeEventMessage, BridgeEventName } from '@shared/bridge';
import type { EventMap } from '@shared/types';

/**
 * 服务端 WebSocket 事件的内存广播总线。
 *
 * 该总线不会缓存事件；socket 只会收到其已连接且已认证期间产生的事件。
 */
export class EventBus {
  private readonly sockets = new Set<WebSocket>();

  /** 将已认证的 WebSocket 注册为事件订阅者。 */
  add(socket: WebSocket): void {
    this.sockets.add(socket);
  }

  /** 在 socket 关闭或出错后从订阅者集合移除。 */
  delete(socket: WebSocket): void {
    this.sockets.delete(socket);
  }

  /** 向当前打开的所有订阅者广播类型化 bridge 事件。 */
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
