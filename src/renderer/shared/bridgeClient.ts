import type { BridgeEventName, BridgeInvokeName, BridgeServerMessage } from '@shared/bridge';
import { createBridgeId } from '@shared/bridge';
import type { EventMap, InvokeMap } from '@shared/types';

/** 等待后端 Bridge RPC 响应的 Promise 处理器。 */
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type ConnectionWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: number;
};  

/** Bridge 事件订阅回调，按事件名推导 payload。 */
type EventHandler<Name extends BridgeEventName> = (data: EventMap[Name]) => void;

/** 浏览器端 Bridge 客户端，负责 RPC 调用、事件订阅和 WebSocket 重连。 */
class BrowserBridge {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly handlers = new Map<string, Set<(data: unknown) => void>>();
  private readonly connectionWaiters = new Set<ConnectionWaiter>();
  private reconnectTimer: number | null = null;

  /**
   * 调用后端 Bridge RPC，并按 API 名称推导请求参数和返回值。
   */
  invoke<Name extends BridgeInvokeName>(
    name: Name,
    data: InvokeMap[Name]['params']
  ): Promise<InvokeMap[Name]['result']> {
    const id = createBridgeId();
    this.connect();
    const payload = JSON.stringify({ id, type: 'invoke', name, data });
    console.info('[diag] bridge invoke queued', {
      id,
      name,
      socketState: this.socket?.readyState,
      at: new Date().toISOString(),
    });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.send(payload, { id, name });
    });
  }

  /**
   * 订阅后端 Bridge 推送事件，并返回取消订阅函数。
   */
  on<Name extends BridgeEventName>(name: Name, handler: EventHandler<Name>): () => void {
    const set = this.handlers.get(name) ?? new Set();
    set.add(handler as (data: unknown) => void);
    this.handlers.set(name, set);
    this.connect();
    return () => set.delete(handler as (data: unknown) => void);
  }

  /** 等待当前连接关闭并建立下一条可用的 Bridge 连接。 */
  waitForReconnect(timeoutMs: number): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return this.waitForOpen(timeoutMs);
    }

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        socket.removeEventListener('close', onClose);
        reject(new Error('Bridge reconnection timed out.'));
      }, timeoutMs);
      const onClose = () => {
        window.clearTimeout(timeout);
        void this.waitForOpen(timeoutMs).then(resolve, reject);
      };

      socket.addEventListener('close', onClose, { once: true });
    });
  }

  /** 建立或复用 WebSocket 连接。 */
  private connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(`${protocol}//${window.location.host}/bridge`);
    this.socket.addEventListener('open', () => {
      console.info('[diag] bridge socket open', {
        url: this.socket?.url,
        at: new Date().toISOString(),
      });
      this.resolveConnectionWaiters();
    });
    this.socket.addEventListener('message', (event) => this.handleMessage(String(event.data)));
    this.socket.addEventListener('close', (event) => {
      console.info('[diag] bridge socket close', {
        code: event.code,
        reason: event.reason,
        at: new Date().toISOString(),
      });
      this.rejectPending(new Error('Bridge connection closed before the request completed.'));
      this.scheduleReconnect();
    });
  }

  /** 在连接打开后发送已序列化的 RPC 调用消息。 */
  private send(payload: string, meta: { id: string; name: string }): void {
    const socket = this.socket;
    if (!socket) return;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
      console.info('[diag] bridge invoke sent', {
        id: meta.id,
        name: meta.name,
        socketState: socket.readyState,
        at: new Date().toISOString(),
      });
      return;
    }
    socket.addEventListener(
      'open',
      () => {
        socket.send(payload);
        console.info('[diag] bridge invoke sent', {
          id: meta.id,
          name: meta.name,
          socketState: socket.readyState,
          at: new Date().toISOString(),
        });
      },
      { once: true }
    );
  }

  /** 分发后端返回的 RPC 结果或实时事件。 */
  private handleMessage(raw: string): void {
    let message: BridgeServerMessage;
    try {
      message = JSON.parse(raw) as BridgeServerMessage;
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'result') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.data);
      return;
    }
    const handlers = this.handlers.get(message.name);
    if (handlers) {
      for (const handler of handlers) handler(message.data);
    }
  }

  /** WebSocket 断开后延迟重连，避免立即自旋。 */
  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1000);
  }

  /** 建立连接后继续等待中的服务重启流程。 */
  private waitForOpen(timeoutMs: number): Promise<void> {
    this.connect();
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const waiter: ConnectionWaiter = {
        resolve,
        reject,
        timeout: window.setTimeout(() => {
          this.connectionWaiters.delete(waiter);
          reject(new Error('Bridge reconnection timed out.'));
        }, timeoutMs),
      };
      this.connectionWaiters.add(waiter);
    });
  }

  /** 解析所有等待下一条已打开连接的调用。 */
  private resolveConnectionWaiters(): void {
    for (const waiter of this.connectionWaiters) {
      window.clearTimeout(waiter.timeout);
      waiter.resolve();
    }
    this.connectionWaiters.clear();
  }

  /**
   * 连接断开时拒绝所有未完成 RPC，避免调用方永久等待。
   *
   * @param error - 传递给调用方的失败原因
   */
  private rejectPending(error: Error): void {
    if (this.pending.size === 0) return;
    const pending = Array.from(this.pending.values());
    this.pending.clear();
    for (const item of pending) item.reject(error);
  }
}

export const bridge = new BrowserBridge();
