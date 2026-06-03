import type { ConversationStatus, StopReason } from '@shared/types/conversation';

export type AgentBackend = 'claude' | 'codex';

/** 已检测到的 Agent CLI 信息。 */
export type AgentInfo = {
  backend: AgentBackend;
  name: string;
  available: boolean;
  cliPath?: string;
  version?: string;
  error?: string;
};

/** Agent 健康检查结果，在 `AgentInfo` 基础上增加握手状态。 */
export type AgentHealth = AgentInfo & {
  ok: boolean;
  handshake?: boolean;
};

/** Agent 一轮运行过程中的标准阶段。 */
export type AgentTurnPhase =
  | 'queued'
  | 'thinking'
  | 'planning'
  | 'replying'
  | 'tool_calling'
  | 'waiting_permission'
  | 'failed'
  | 'done';

/** 权限确认的单个选项。 */
export type PermissionOption = {
  id: string;
  label: string;
  description?: string;
};

/** ACP 可用命令。 */
export type AcpAvailableCommand = {
  name: string;
  description?: string;
  input?: unknown;
};

/** Agent 事件持久化列化字段。 */
export type AgentEventMemoryFields = {
  sequence: number;
  status?: string;
  stopReason?: StopReason;
  toolCallId?: string;
  permissionCallId?: string;
  messageId?: string;
};

/** 标准化的 Agent 运行过程事件。 */
export type AgentEventPayload =
  | {
      id: string;
      type: 'agent.turn.started';
      conversationId: string;
      turnId: string;
      backend: AgentBackend;
      at: number;
    }
  | {
      id: string;
      type: 'agent.thinking';
      conversationId: string;
      turnId: string;
      at: number;
    }
  | {
      id: string;
      type: 'agent.plan';
      conversationId: string;
      turnId: string;
      entries: string[];
      raw?: unknown;
      at: number;
    }
  | {
      id: string;
      type: 'agent.reply.delta';
      conversationId: string;
      turnId: string;
      messageId: string;
      delta: string;
      at: number;
    }
  | {
      id: string;
      type: 'agent.reply.done';
      conversationId: string;
      turnId: string;
      messageId: string;
      content: string;
      at: number;
    }
  | {
      id: string;
      type: 'agent.tool.call';
      conversationId: string;
      turnId: string;
      toolCallId: string;
      toolName: string;
      title?: string;
      kind?: string;
      status?: string;
      input?: unknown;
      raw?: unknown;
      at: number;
    }
  | {
      id: string;
      type: 'agent.tool.update';
      conversationId: string;
      turnId: string;
      toolCallId: string;
      toolName?: string;
      title?: string;
      kind?: string;
      status?: string;
      content?: unknown;
      raw?: unknown;
      at: number;
    }
  | {
      id: string;
      type: 'agent.tool.result';
      conversationId: string;
      turnId: string;
      toolCallId: string;
      toolName?: string;
      title?: string;
      kind?: string;
      status?: string;
      output?: unknown;
      isError?: boolean;
      raw?: unknown;
      at: number;
    }
  | {
      id: string;
      type: 'agent.permission.request';
      conversationId: string;
      turnId: string;
      callId: string;
      title: string;
      body?: string;
      options: PermissionOption[];
      at: number;
    }
  | {
      id: string;
      type: 'agent.error';
      conversationId: string;
      turnId: string;
      source: 'runtime' | 'model' | 'tool' | 'permission' | 'transport';
      message: string;
      detail?: unknown;
      at: number;
    }
  | {
      id: string;
      type: 'agent.done';
      conversationId: string;
      turnId: string;
      status: ConversationStatus;
      stopReason?: StopReason;
      at: number;
    };

export type AgentEvent = AgentEventPayload & AgentEventMemoryFields;

/** Agent 发起的权限请求，需用户在 UI 中选择一个选项后才能继续执行。 */
export type PermissionRequest = {
  conversationId: string;
  callId: string;
  title: string;
  body?: string;
  options: PermissionOption[];
  toolCall?: unknown;
  rawInput?: unknown;
};

/** 用户对权限请求的响应，可选择一个选项或取消本次授权。 */
export type PermissionResponse =
  | { outcome: { outcome: 'selected'; optionId: string } }
  | { outcome: { outcome: 'cancelled' } };
