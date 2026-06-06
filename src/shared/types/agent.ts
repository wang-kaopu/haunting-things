import type { ConversationStatus, StopReason } from '@shared/types/conversation';

/** 当前项目支持驱动的 Agent 后端类型。 */
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

/** Agent 事件持久化和实时推送共享的基础字段。 */
type AgentEventBase = {
  id: string;
  conversationId: string;
  turnId: string;
  at: number;
};

/** Agent 回合开始事件载荷。 */
type AgentTurnStartedEventPayload = AgentEventBase & {
  type: 'agent.turn.started';
  backend: AgentBackend;
};

/** Agent 进入思考阶段事件载荷。 */
type AgentThinkingEventPayload = AgentEventBase & {
  type: 'agent.thinking';
};

/** Agent 输出计划事件载荷。 */
type AgentPlanEventPayload = AgentEventBase & {
  type: 'agent.plan';
  entries: string[];
  raw?: unknown;
};

/** Agent 回复流式增量事件载荷。 */
type AgentReplyDeltaEventPayload = AgentEventBase & {
  type: 'agent.reply.delta';
  messageId: string;
  delta: string;
};

/** Agent 回复完成事件载荷。 */
type AgentReplyDoneEventPayload = AgentEventBase & {
  type: 'agent.reply.done';
  messageId: string;
  content: string;
};

/** 工具相关 Agent 事件共享的工具字段。 */
type AgentToolBase = AgentEventBase & {
  toolCallId: string;
  toolName?: string;
  title?: string;
  kind?: string;
  status?: string;
  raw?: unknown;
};

/** 工具调用开始事件载荷；toolName 在调用开始时必填。 */
type AgentToolCallEventPayload = AgentToolBase & {
  type: 'agent.tool.call';
  toolName: string;
  input?: unknown;
};

/** 工具执行过程更新事件载荷。 */
type AgentToolUpdateEventPayload = AgentToolBase & {
  type: 'agent.tool.update';
  content?: unknown;
};

/** 工具执行结果事件载荷。 */
type AgentToolResultEventPayload = AgentToolBase & {
  type: 'agent.tool.result';
  output?: unknown;
  isError?: boolean;
};

/** Agent 请求用户权限确认事件载荷。 */
type AgentPermissionRequestEventPayload = AgentEventBase & {
  type: 'agent.permission.request';
  callId: string;
  title: string;
  body?: string;
  options: PermissionOption[];
};

/** Agent 运行错误事件载荷。 */
type AgentErrorEventPayload = AgentEventBase & {
  type: 'agent.error';
  source: 'runtime' | 'model' | 'tool' | 'permission' | 'transport';
  message: string;
  detail?: unknown;
};

/** Agent 回合结束事件载荷。 */
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

/** 带持久化序列字段的完整 Agent 事件。 */
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
