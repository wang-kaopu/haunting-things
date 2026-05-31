import type { AgentEvent } from '../shared/types';

export type AgentEventPolicy = {
  persist: boolean;
  realtime: boolean;
  activity: boolean;
};

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
