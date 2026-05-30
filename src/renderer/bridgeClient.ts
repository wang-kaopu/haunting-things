import type { BridgeEventName, BridgeInvokeName, BridgeServerMessage } from '../shared/bridge';
import { createBridgeId } from '../shared/bridge';
import type { EventMap, InvokeMap } from '../shared/types';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type EventHandler<Name extends BridgeEventName> = (data: EventMap[Name]) => void;

class BrowserBridge {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly handlers = new Map<string, Set<(data: unknown) => void>>();
  private reconnectTimer: number | null = null;

  invoke<Name extends BridgeInvokeName>(
    name: Name,
    data: InvokeMap[Name]['params']
  ): Promise<InvokeMap[Name]['result']> {
    const id = createBridgeId();
    this.connect();
    const payload = JSON.stringify({ id, type: 'invoke', name, data });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.send(payload);
    });
  }

  on<Name extends BridgeEventName>(name: Name, handler: EventHandler<Name>): () => void {
    const set = this.handlers.get(name) ?? new Set();
    set.add(handler as (data: unknown) => void);
    this.handlers.set(name, set);
    this.connect();
    return () => set.delete(handler as (data: unknown) => void);
  }

  private connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(`${protocol}//${window.location.host}`);
    this.socket.addEventListener('message', (event) => this.handleMessage(String(event.data)));
    this.socket.addEventListener('close', () => this.scheduleReconnect());
  }

  private send(payload: string): void {
    const socket = this.socket;
    if (!socket) return;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
      return;
    }
    socket.addEventListener('open', () => socket.send(payload), { once: true });
  }

  private handleMessage(raw: string): void {
    const message = JSON.parse(raw) as BridgeServerMessage;
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

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1000);
  }
}

export const bridge = new BrowserBridge();
