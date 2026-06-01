import type {
  AgentEvent,
  AgentTurnPhase,
  ChatMessage,
  ChatRole,
  ConversationUsage,
  TeamAgent,
} from '../../../shared/types';

export function formatAgentStatus(status: TeamAgent['status']): string {
  const map: Record<TeamAgent['status'], string> = {
    idle: '空闲',
    active: '运行中',
    failed: '错误',
    stopped: '已停止',
  };

  return map[status] ?? status;
}

export function formatPhase(phase?: AgentTurnPhase): string {
  if (!phase) return '';

  const map: Record<AgentTurnPhase, string> = {
    queued: '排队中',
    thinking: '正在思考',
    planning: '正在规划',
    replying: '正在回复',
    tool_calling: '调用工具',
    waiting_permission: '等待授权',
    failed: '返回错误',
    done: '已完成',
  };

  return map[phase] ?? phase;
}

export function formatUsagePercent(usage?: ConversationUsage | null): string {
  if (!usage || usage.size <= 0) return '';
  return `${Math.round((usage.used / usage.size) * 100)}%`;
}

export function formatUsageShort(usage?: ConversationUsage | null): string {
  if (!usage) return 'Usage';
  return `${usage.used.toLocaleString()} / ${usage.size.toLocaleString()}`;
}

export function formatAgentEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'agent.turn.started':
      return '开始新一轮任务';
    case 'agent.thinking':
      return '正在思考';
    case 'agent.plan':
      return event.entries.length ? `正在规划：${event.entries.join(' / ')}` : '正在规划';
    case 'agent.tool.call':
      return `调用工具：${event.title || event.toolName || event.toolCallId}`;
    case 'agent.tool.update':
      return `工具运行中：${event.title || event.toolCallId}`;
    case 'agent.tool.result':
      return event.isError
        ? `工具返回错误：${event.title || event.toolName || event.toolCallId}`
        : `工具调用完成：${event.title || event.toolName || event.toolCallId}`;
    case 'agent.permission.request':
      return `等待授权：${event.title}`;
    case 'agent.error':
      return `返回错误：${event.message}`;
    case 'agent.done':
      return event.status === 'idle' ? '本轮完成' : `本轮结束：${event.status}`;
    case 'agent.reply.delta':
      return '正在回复';
    case 'agent.reply.done':
      return '回复完成';
  }
}

export function getMessageFallbackText(message: ChatMessage, activePhase?: AgentTurnPhase): string {
  if (message.content) return message.content;
  if (message.status !== 'streaming') return message.status === 'error' ? '消息发送失败。' : '';
  if (activePhase === 'thinking') return '正在思考...';
  if (activePhase === 'planning') return '正在规划...';
  if (activePhase === 'tool_calling') return '正在调用工具...';
  if (activePhase === 'waiting_permission') return '等待授权...';
  if (activePhase === 'failed') return '本轮出现错误...';
  return '正在回复...';
}

export function formatMessageRole(role: ChatRole): string {
  const labels: Record<ChatRole, string> = {
    user: '用户',
    assistant: '助手',
    system: '系统',
    tool: '工具',
  };
  return labels[role];
}

export function phaseFromAgentEvent(event: AgentEvent): AgentTurnPhase {
  switch (event.type) {
    case 'agent.turn.started':
    case 'agent.thinking':
      return 'thinking';
    case 'agent.plan':
      return 'planning';
    case 'agent.reply.delta':
    case 'agent.reply.done':
      return 'replying';
    case 'agent.tool.call':
    case 'agent.tool.update':
      return 'tool_calling';
    case 'agent.tool.result':
      return event.isError ? 'failed' : 'tool_calling';
    case 'agent.permission.request':
      return 'waiting_permission';
    case 'agent.error':
      return 'failed';
    case 'agent.done':
      return event.status === 'idle' ? 'done' : 'failed';
  }
}

export function shouldShowAgentEventInToast(event: AgentEvent): boolean {
  return event.type === 'agent.error' || event.type === 'agent.done' || event.type === 'agent.permission.request';
}
