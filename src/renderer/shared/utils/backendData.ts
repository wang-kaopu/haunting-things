import type {
  AgentBackend,
  AgentEvent,
  AgentTurnPhase,
  AttachmentKind,
  AttachmentRef,
  ChatMessage,
  ChatMessageType,
  ChatRole,
  Conversation,
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationStatus,
  ConversationUsage,
  MailboxMessage,
  PermissionOption,
  PermissionRequest,
  ServerInfo,
  StopReason,
  Team,
  TeamAgent,
  TeamAgentStatus,
  TeamMailboxEntry,
  User,
  Workspace,
  WorkspaceEntry,
  WorkspaceKind,
} from '@shared/types';

type RecordValue = Record<string, unknown>;

const agentBackends = new Set<AgentBackend>(['claude', 'codex']);
const agentRoles = new Set<TeamAgent['role']>(['leader', 'teammate']);
const agentStatuses = new Set<TeamAgentStatus>(['idle', 'active', 'failed', 'stopped']);
const attachmentKinds = new Set<AttachmentKind>(['image']);
const chatMessageTypes = new Set<ChatMessageType>(['text', 'thinking', 'tool_call', 'tool_result', 'plan', 'permission', 'system']);
const chatRoles = new Set<ChatRole>(['user', 'assistant', 'system', 'tool']);
const conversationStatuses = new Set<ConversationStatus>(['idle', 'running', 'failed', 'stopped']);
const stopReasons = new Set<StopReason>(['done', 'cancelled', 'failed', 'stopped']);
const workspaceKinds = new Set<WorkspaceKind>(['local', 'temporary', 'managed']);

/**
 * 安全读取 HTTP JSON 响应。
 *
 * 登录态失效或 503 这类非 JSON 响应会返回 null，避免调用方在解析阶段崩溃。
 */
export async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * 归一化当前登录用户信息。
 */
export function normalizeAuthUser(value: unknown): User | null {
  const input = asRecord(value);
  if (!input) return null;
  const id = asString(input.id);
  const username = asString(input.username);
  if (!id || !username) return null;
  return { id, username };
}

/**
 * 归一化认证接口响应。
 */
export function normalizeAuthResponse(value: unknown): { user: User | null; error: string } {
  const input = asRecord(value);
  return {
    user: normalizeAuthUser(input?.user),
    error: asString(input?.error),
  };
}

/**
 * 归一化 Conversation 快照。
 */
export function normalizeConversation(value: unknown): Conversation | null {
  const input = asRecord(value);
  if (!input) return null;
  const id = asString(input.id);
  const backend = enumValue(input.backend, agentBackends, undefined);
  const status = enumValue(input.status, conversationStatuses, undefined);
  const createdAt = asRequiredNumber(input.createdAt);
  const updatedAt = asRequiredNumber(input.updatedAt);
  if (!id || !backend || !status || createdAt === null || updatedAt === null) return null;

  return {
    id,
    backend,
    name: asString(input.name),
    workspaceId: asString(input.workspaceId),
    model: optionalString(input.model),
    status,
    acpSessionId: optionalString(input.acpSessionId),
    sessionMode: optionalString(input.sessionMode),
    currentModelId: optionalString(input.currentModelId),
    lastTurnId: optionalString(input.lastTurnId),
    lastStopReason: enumValue(input.lastStopReason, stopReasons, undefined),
    lastError: optionalString(input.lastError),
    usageSize: optionalNumber(input.usageSize),
    usageUsed: optionalNumber(input.usageUsed),
    usageRatio: optionalNumber(input.usageRatio),
    usageUpdatedAt: optionalNumber(input.usageUpdatedAt),
    createdAt,
    updatedAt,
  };
}

/** 归一化 Workspace 快照。 */
export function normalizeWorkspace(value: unknown): Workspace | null {
  const input = asRecord(value);
  if (!input) return null;
  const id = asString(input.id);
  const workspacePath = asString(input.path);
  const createdAt = asRequiredNumber(input.createdAt);
  const updatedAt = asRequiredNumber(input.updatedAt);
  if (!id || !workspacePath || createdAt === null || updatedAt === null) return null;
  return {
    id,
    name: asString(input.name, workspacePath),
    path: workspacePath,
    kind: enumValue(input.kind, workspaceKinds, 'local'),
    isTemporary: Boolean(input.isTemporary),
    existsOnDisk: input.existsOnDisk !== false,
    lastOpenedAt: optionalNumber(input.lastOpenedAt),
    createdAt,
    updatedAt,
  };
}

/** 归一化工作区文件树。 */
export function normalizeWorkspaceEntryList(value: unknown): WorkspaceEntry[] {
  return normalizeArray(value, normalizeWorkspaceEntry);
}

function normalizeWorkspaceEntry(value: unknown): WorkspaceEntry | null {
  const input = asRecord(value);
  if (!input) return null;
  const name = asString(input.name);
  const fullPath = asString(input.fullPath);
  const relativePath = asString(input.relativePath);
  if (!name || !fullPath || !relativePath) return null;
  return {
    name,
    fullPath,
    relativePath,
    isDir: Boolean(input.isDir),
    isFile: Boolean(input.isFile),
    size: optionalNumber(input.size),
    modifiedAt: optionalNumber(input.modifiedAt),
    children: normalizeWorkspaceEntryList(input.children),
  };
}

/**
 * 归一化 Team 列表，过滤不可用的旧数据项。
 */
export function normalizeTeamList(value: unknown): Team[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeTeam(item)).filter((team): team is Team => team !== null);
}

/**
 * 归一化 Team 元数据。
 *
 * 旧数据可能缺少 leaderSlotId，会优先回退到 leader 成员，保证 UI 仍能选中可用成员。
 */
export function normalizeTeam(value: unknown): Team | null {
  const input = asRecord(value);
  if (!input) return null;
  const id = asString(input.id);
  if (!id) return null;
  const agents = normalizeArray(input.agents, normalizeTeamAgent);
  return {
    id,
    name: asString(input.name, '未命名团队'),
    workspaceId: asString(input.workspaceId),
    leaderSlotId: asString(input.leaderSlotId, agents.find((agent) => agent.role === 'leader')?.slotId ?? agents[0]?.slotId ?? ''),
    agents,
    createdAt: asNumber(input.createdAt, Date.now()),
    updatedAt: asNumber(input.updatedAt, Date.now()),
  };
}

/**
 * 归一化 Team 成员。
 */
export function normalizeTeamAgent(value: unknown): TeamAgent | null {
  const input = asRecord(value);
  if (!input) return null;
  const slotId = asString(input.slotId);
  const conversationId = asString(input.conversationId);
  if (!slotId || !conversationId) return null;
  return {
    slotId,
    conversationId,
    role: enumValue(input.role, agentRoles, 'teammate'),
    backend: enumValue(input.backend, agentBackends, 'codex'),
    model: optionalString(input.model),
    name: asString(input.name, slotId),
    status: enumValue(input.status, agentStatuses, 'idle'),
  };
}

/**
 * 归一化聊天消息列表。
 */
export function normalizeMessageList(value: unknown): ChatMessage[] {
  return normalizeArray(value, normalizeChatMessage);
}

/**
 * 归一化单条聊天消息。
 *
 * 附件字段来自关系表聚合结果。
 */
export function normalizeChatMessage(value: unknown): ChatMessage | null {
  const input = asRecord(value);
  if (!input) return null;
  const id = asString(input.id);
  const conversationId = asString(input.conversationId);
  const role = enumValue(input.role, chatRoles, undefined);
  const type = enumValue(input.type, chatMessageTypes, undefined);
  const sequence = asRequiredNumber(input.sequence);
  const createdAt = asRequiredNumber(input.createdAt);
  if (!id || !conversationId || !role || !type || sequence === null || createdAt === null) return null;
  return {
    id,
    conversationId,
    role,
    type,
    content: asString(input.content),
    attachments: normalizeArray(input.attachments, normalizeAttachmentRef),
    createdAt,
    status: enumValue(input.status, new Set(['streaming', 'done', 'error'] as const), undefined),
    turnId: optionalString(input.turnId),
    sourceEventId: optionalString(input.sourceEventId),
    stopReason: enumValue(input.stopReason, stopReasons, undefined),
    toolCallId: optionalString(input.toolCallId),
    permissionCallId: optionalString(input.permissionCallId),
    parentMessageId: optionalString(input.parentMessageId),
    sequence,
  };
}

/**
 * 归一化前端可访问的附件引用。
 */
export function normalizeAttachmentRef(value: unknown): AttachmentRef | null {
  const input = asRecord(value);
  if (!input) return null;
  const id = asString(input.id);
  const url = asString(input.url);
  if (!id || !url) return null;
  return {
    id,
    kind: enumValue(input.kind, attachmentKinds, 'image'),
    name: asString(input.name, 'image'),
    mimeType: asString(input.mimeType, 'image/png'),
    size: asNumber(input.size, 0),
    url,
    createdAt: asNumber(input.createdAt, Date.now()),
  };
}

/**
 * 归一化 Agent 事件列表。
 */
export function normalizeAgentEventList(value: unknown): AgentEvent[] {
  return normalizeArray(value, normalizeAgentEvent);
}

/**
 * 归一化 ACP bridge 上报的 Agent 事件。
 *
 * 不识别的事件类型会被丢弃，避免未知 payload 进入通知和时间线。
 */
export function normalizeAgentEvent(value: unknown): AgentEvent | null {
  const input = asRecord(value);
  if (!input) return null;
  const type = asString(input.type);
  const conversationId = asString(input.conversationId);
  const id = asString(input.id);
  const turnId = asString(input.turnId);
  const sequence = asRequiredNumber(input.sequence);
  const at = asRequiredNumber(input.at);
  if (!id || !type || !conversationId || !turnId || sequence === null || at === null) return null;
  const memory = {
    sequence,
    status: optionalString(input.status),
    stopReason: enumValue(input.stopReason, stopReasons, undefined),
    toolCallId: optionalString(input.toolCallId),
    permissionCallId: optionalString(input.permissionCallId),
    messageId: optionalString(input.messageId),
  };
  const base = {
    id,
    conversationId,
    turnId,
    ...memory,
    at,
  };

  switch (type) {
    case 'agent.turn.started':
      return { ...base, type, backend: enumValue(input.backend, agentBackends, 'codex') };
    case 'agent.thinking':
      return { ...base, type };
    case 'agent.plan':
      return { ...base, type, entries: Array.isArray(input.entries) ? input.entries.map((item) => asString(item)).filter(Boolean) : [], raw: input.raw };
    case 'agent.reply.delta':
      return { ...base, type, messageId: asString(input.messageId), delta: asString(input.delta) };
    case 'agent.reply.done':
      return { ...base, type, messageId: asString(input.messageId), content: asString(input.content) };
    case 'agent.tool.call':
      return {
        ...base,
        type,
        toolCallId: asString(input.toolCallId),
        toolName: asString(input.toolName),
        title: optionalString(input.title),
        kind: optionalString(input.kind),
        status: optionalString(input.status),
        input: input.input,
        raw: input.raw,
      };
    case 'agent.tool.update':
      return {
        ...base,
        type,
        toolCallId: asString(input.toolCallId),
        toolName: optionalString(input.toolName),
        title: optionalString(input.title),
        kind: optionalString(input.kind),
        status: optionalString(input.status),
        content: input.content,
        raw: input.raw,
      };
    case 'agent.tool.result':
      return {
        ...base,
        type,
        toolCallId: asString(input.toolCallId),
        toolName: optionalString(input.toolName),
        title: optionalString(input.title),
        kind: optionalString(input.kind),
        status: optionalString(input.status),
        output: input.output,
        isError: asBoolean(input.isError, false),
        raw: input.raw,
      };
    case 'agent.permission.request':
      return {
        ...base,
        type,
        callId: asString(input.callId),
        title: asString(input.title, '权限确认'),
        body: optionalString(input.body),
        options: normalizeArray(input.options, normalizePermissionOption),
      };
    case 'agent.error':
      return {
        ...base,
        type,
        source: enumValue(input.source, new Set(['runtime', 'model', 'tool', 'permission', 'transport'] as const), 'runtime'),
        message: asString(input.message, '未知错误'),
        detail: input.detail,
      };
    case 'agent.done':
      return {
        ...base,
        type,
        status: enumValue(input.status, conversationStatuses, 'idle'),
        stopReason: enumValue(input.stopReason, stopReasons, undefined),
      };
    default:
      return null;
  }
}

/**
 * 归一化 conversation.stream 事件。
 */
export function normalizeConversationStream(value: unknown): { conversationId: string; message: ChatMessage } | null {
  const input = asRecord(value);
  if (!input) return null;
  const conversationId = asString(input.conversationId);
  const message = normalizeChatMessage(input.message);
  if (!conversationId || !message) return null;
  return { conversationId, message };
}

/**
 * 归一化上下文窗口使用量快照。
 */
export function normalizeConversationUsage(value: unknown): ConversationUsage | null {
  const input = asRecord(value);
  const conversationId = asString(input?.conversationId);
  if (!input || !conversationId) return null;
  return {
    conversationId,
    size: asNumber(input.size, 0),
    used: asNumber(input.used, 0),
    ratio: asNumber(input.ratio, 0),
    updatedAt: asNumber(input.updatedAt, Date.now()),
  };
}

/**
 * 归一化 Agent 可用命令快照。
 */
export function normalizeConversationCommands(value: unknown): ConversationCommands | null {
  const input = asRecord(value);
  const conversationId = asString(input?.conversationId);
  if (!input || !conversationId) return null;
  return {
    conversationId,
    commands: normalizeArray(input.commands, normalizeCommand),
    updatedAt: asNumber(input.updatedAt, Date.now()),
  };
}

/**
 * 归一化模型列表快照。
 */
export function normalizeConversationModels(value: unknown): ConversationModels | null {
  const input = asRecord(value);
  const conversationId = asString(input?.conversationId);
  if (!input || !conversationId) return null;
  return {
    conversationId,
    currentModelId: optionalString(input.currentModelId),
    models: normalizeArray(input.models, (item) => {
      const model = asRecord(item);
      const id = asString(model?.id);
      return id ? { id, name: optionalString(model?.name), description: optionalString(model?.description) } : null;
    }),
    updatedAt: asNumber(input.updatedAt, Date.now()),
  };
}

/**
 * 归一化运行模式快照。
 */
export function normalizeConversationMode(value: unknown): ConversationMode | null {
  const input = asRecord(value);
  const conversationId = asString(input?.conversationId);
  if (!input || !conversationId) return null;
  return {
    conversationId,
    mode: asString(input.mode),
    updatedAt: asNumber(input.updatedAt, Date.now()),
  };
}

/**
 * 归一化权限请求事件。
 */
export function normalizePermissionRequest(value: unknown): PermissionRequest | null {
  const input = asRecord(value);
  if (!input) return null;
  const conversationId = asString(input.conversationId);
  const callId = asString(input.callId);
  if (!conversationId || !callId) return null;
  return {
    conversationId,
    callId,
    title: asString(input.title, '权限确认'),
    body: optionalString(input.body),
    options: normalizeArray(input.options, normalizePermissionOption),
    toolCall: input.toolCall,
    rawInput: input.rawInput,
  };
}

/**
 * 归一化 Team 成员状态变更事件。
 */
export function normalizeTeamAgentStatusEvent(
  value: unknown
): { teamId: string; slotId: string; status: TeamAgentStatus; error?: string } | null {
  const input = asRecord(value);
  if (!input) return null;
  const teamId = asString(input.teamId);
  const slotId = asString(input.slotId);
  if (!teamId || !slotId) return null;
  return {
    teamId,
    slotId,
    status: enumValue(input.status, agentStatuses, 'idle'),
    error: optionalString(input.error),
  };
}

/**
 * 归一化 Conversation 状态变更事件。
 */
export function normalizeConversationStatusEvent(
  value: unknown
): { conversationId: string; status: ConversationStatus; error?: string } | null {
  const input = asRecord(value);
  if (!input) return null;
  const conversationId = asString(input.conversationId);
  if (!conversationId) return null;
  return {
    conversationId,
    status: enumValue(input.status, conversationStatuses, 'idle'),
    error: optionalString(input.error),
  };
}

/**
 * 归一化 Team mailbox 时间线条目。
 */
export function normalizeTeamMailboxEntry(value: unknown): TeamMailboxEntry | null {
  const input = asRecord(value);
  if (!input) return null;
  const message = normalizeMailboxMessage(input.message);
  if (!message) return null;
  return {
    message,
    fromAgentName: asString(input.fromAgentName, message.fromAgentId),
    toAgentName: asString(input.toAgentName, message.toAgentId),
    processed: asBoolean(input.processed, message.read),
  };
}

/**
 * 归一化 Team mailbox 实时事件。
 */
export function normalizeTeamMessageEvent(value: unknown): { teamId: string; entry: TeamMailboxEntry } | null {
  const input = asRecord(value);
  if (!input) return null;
  const teamId = asString(input.teamId);
  const entry = normalizeTeamMailboxEntry(input.entry);
  if (!teamId || !entry) return null;
  return { teamId, entry };
}

/**
 * 归一化服务监听信息。
 */
export function normalizeServerInfo(value: unknown): ServerInfo | null {
  const input = asRecord(value);
  if (!input) return null;
  const host = asString(input.host);
  const port = asNumber(input.port, Number.NaN);
  if (!host || !Number.isFinite(port)) return null;
  const restarting = asBoolean(input.restarting, false);
  return {
    host,
    port,
    allowRemote: asBoolean(input.allowRemote, false),
    ...(restarting ? { restarting } : {}),
    urls: Array.isArray(input.urls) ? input.urls.map((url) => asString(url)).filter(Boolean) : [],
  };
}

function normalizeMailboxMessage(value: unknown): MailboxMessage | null {
  const input = asRecord(value);
  if (!input) return null;
  const id = asString(input.id);
  const teamId = asString(input.teamId);
  const toAgentId = asString(input.toAgentId);
  const fromAgentId = asString(input.fromAgentId);
  if (!id || !teamId || !toAgentId || !fromAgentId) return null;
  return {
    id,
    teamId,
    toAgentId,
    fromAgentId,
    content: asString(input.content),
    summary: optionalString(input.summary),
    attachments: normalizeArray(input.attachments, normalizeAttachmentRef),
    read: asBoolean(input.read, false),
    createdAt: asNumber(input.createdAt, Date.now()),
  };
}

function normalizeCommand(value: unknown): ConversationCommands['commands'][number] | null {
  const input = asRecord(value);
  const name = asString(input?.name);
  if (!input || !name) return null;
  return {
    name,
    description: optionalString(input.description),
    input: input.input,
  };
}

function normalizePermissionOption(value: unknown): PermissionOption | null {
  const input = asRecord(value);
  const id = asString(input?.id);
  if (!input || !id) return null;
  return {
    id,
    label: asString(input.label, id),
    description: optionalString(input.description),
  };
}

function normalizeArray<T>(value: unknown, normalize: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalize(item)).filter((item): item is T => item !== null);
}

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asRequiredNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function enumValue<T extends string>(value: unknown, values: Set<T>, fallback: T): T;
function enumValue<T extends string>(value: unknown, values: Set<T>, fallback: T | undefined): T | undefined;
function enumValue<T extends string>(value: unknown, values: Set<T>, fallback: T | undefined): T | undefined {
  return typeof value === 'string' && values.has(value as T) ? (value as T) : fallback;
}
