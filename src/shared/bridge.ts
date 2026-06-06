import type { EventMap, InvokeMap } from '@shared/types';

/** Bridge RPC 可调用 API 名称。 */
export type BridgeInvokeName = keyof InvokeMap & string;

/** Bridge 服务端推送事件名称。 */
export type BridgeEventName = keyof EventMap & string;

/** 浏览器发往后端的 Bridge RPC 调用消息。 */
export type BridgeInvokeMessage<Name extends BridgeInvokeName = BridgeInvokeName> = {
  id: string;
  type: 'invoke';
  name: Name;
  data: InvokeMap[Name]['params'];
};

/** 后端返回给浏览器的 Bridge RPC 结果消息。 */
export type BridgeResultMessage<Name extends BridgeInvokeName = BridgeInvokeName> = {
  id: string;
  type: 'result';
  name: Name;
  data?: InvokeMap[Name]['result'];
  error?: string;
};

/** 后端主动推送给浏览器的 Bridge 事件消息。 */
export type BridgeEventMessage<Name extends BridgeEventName = BridgeEventName> = {
  type: 'event';
  name: Name;
  data: EventMap[Name];
};

/** Bridge 客户端消息联合类型。 */
export type BridgeClientMessage = BridgeInvokeMessage;

/** Bridge 服务端消息联合类型。 */
export type BridgeServerMessage = BridgeResultMessage | BridgeEventMessage;

/** Bridge RPC 处理器签名，按 API 名称约束入参与返回值。 */
export type BridgeHandler<Name extends BridgeInvokeName> = (
  params: InvokeMap[Name]['params']
) => Promise<InvokeMap[Name]['result']> | InvokeMap[Name]['result'];

/**
 * 生成 bridge invoke 的客户端请求 ID。
 */
export function createBridgeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
