import type { EventMap, InvokeMap } from '@shared/types';

export type BridgeInvokeName = keyof InvokeMap & string;
export type BridgeEventName = keyof EventMap & string;

export type BridgeInvokeMessage<Name extends BridgeInvokeName = BridgeInvokeName> = {
  id: string;
  type: 'invoke';
  name: Name;
  data: InvokeMap[Name]['params'];
};

export type BridgeResultMessage<Name extends BridgeInvokeName = BridgeInvokeName> = {
  id: string;
  type: 'result';
  name: Name;
  data?: InvokeMap[Name]['result'];
  error?: string;
};

export type BridgeEventMessage<Name extends BridgeEventName = BridgeEventName> = {
  type: 'event';
  name: Name;
  data: EventMap[Name];
};

export type BridgeClientMessage = BridgeInvokeMessage;
export type BridgeServerMessage = BridgeResultMessage | BridgeEventMessage;

export type BridgeHandler<Name extends BridgeInvokeName> = (
  params: InvokeMap[Name]['params']
) => Promise<InvokeMap[Name]['result']> | InvokeMap[Name]['result'];

/**
 * 生成 bridge invoke 的客户端请求 ID。
 */
export function createBridgeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
