import type { AgentEvent } from '../shared/types';

export type AgentEventPolicy = {
  persist: boolean;
  realtime: boolean;
  activity: boolean;
};

/**
 * 判断 Agent 事件应如何进入持久化和实时 UI 流。
 *
 * 高频流式 delta 只走实时通道；最终回复、终态工具事件、权限请求和错误会保留为可查询记录。
 */
export function classifyAgentEvent(event: AgentEvent): AgentEventPolicy {
  switch (event.type) {
    case 'agent.reply.delta':
      return {
        persist: false,
        realtime: true,
        activity: false,
      };
    case 'agent.thinking':
      return {
        persist: false,
        realtime: true,
        activity: true,
      };
    case 'agent.tool.update':
      return {
        persist: shouldPersistToolUpdate(event.status),
        realtime: true,
        activity: true,
      };
    case 'agent.reply.done':
      return {
        persist: true,
        realtime: true,
        activity: false,
      };
    case 'agent.turn.started':
    case 'agent.plan':
    case 'agent.tool.call':
    case 'agent.tool.result':
    case 'agent.permission.request':
    case 'agent.error':
    case 'agent.done':
      return {
        persist: true,
        realtime: true,
        activity: true,
      };
    default:
      return {
        persist: true,
        realtime: true,
        activity: true,
      };
  }
}

/** 仅持久化描述终态的工具更新事件。 */
function shouldPersistToolUpdate(status?: string): boolean {
  if (!status) return false;

  const normalized = status.toLowerCase();
  return (
    normalized === 'completed' ||
    normalized === 'complete' ||
    normalized === 'succeeded' ||
    normalized === 'success' ||
    normalized === 'failed' ||
    normalized === 'error' ||
    normalized === 'errored' ||
    normalized === 'canceled' ||
    normalized === 'cancelled'
  );
}
