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

type AgentEventBase = {
  id: string;
  conversationId: string;
  turnId: string;
  at: number;
};

type AgentTurnStartedEventPayload = AgentEventBase & {
  type: 'agent.turn.started';
  backend: AgentBackend;
};

type AgentThinkingEventPayload = AgentEventBase & {
  type: 'agent.thinking';
};

type AgentPlanEventPayload = AgentEventBase & {
  type: 'agent.plan';
  entries: string[];
  raw?: unknown;
};

type AgentReplyDeltaEventPayload = AgentEventBase & {
  type: 'agent.reply.delta';
  messageId: string;
  delta: string;
};

type AgentReplyDoneEventPayload = AgentEventBase & {
  type: 'agent.reply.done';
  messageId: string;
  content: string;
};

type AgentToolBase = AgentEventBase & {
  toolCallId: string;
  toolName?: string;
  title?: string;
  kind?: string;
  status?: string;
  raw?: unknown;
};

type AgentToolCallEventPayload = AgentToolBase & {
  type: 'agent.tool.call';
  toolName: string;
  input?: unknown;
};

type AgentToolUpdateEventPayload = AgentToolBase & {
  type: 'agent.tool.update';
  content?: unknown;
};

type AgentToolResultEventPayload = AgentToolBase & {
  type: 'agent.tool.result';
  output?: unknown;
  isError?: boolean;
};

type AgentPermissionRequestEventPayload = AgentEventBase & {
  type: 'agent.permission.request';
  callId: string;
  title: string;
  body?: string;
  options: PermissionOption[];
};

type AgentErrorEventPayload = AgentEventBase & {
  type: 'agent.error';
  source: 'runtime' | 'model' | 'tool' | 'permission' | 'transport';
  message: string;
  detail?: unknown;
};

type AgentDoneEventPayload = AgentEventBase & {
  type: 'agent.done';
  status: ConversationStatus;
  stopReason?: StopReason;
};

/** 标准化的 Agent 运行过程事件。 */
export type AgentEventPayload =
  | AgentTurnStartedEventPayload
  | AgentThinkingEventPayload
  | AgentPlanEventPayload
  | AgentReplyDeltaEventPayload
  | AgentReplyDoneEventPayload
  | AgentToolCallEventPayload
  | AgentToolUpdateEventPayload
  | AgentToolResultEventPayload
  | AgentPermissionRequestEventPayload
  | AgentErrorEventPayload
  | AgentDoneEventPayload;

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
