import type {
  AgentBackend,
  AgentEvent,
  AgentTurnPhase,
  AttachmentKind,
  AttachmentRef,
  ChatMessage,
  ChatRole,
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationStatus,
  ConversationUsage,
  MailboxMessage,
  PermissionOption,
  PermissionRequest,
  ServerInfo,
  Team,
  TeamAgent,
  TeamAgentStatus,
  TeamMailboxEntry,
  User,
} from '../../../shared/types';

type RecordValue = Record<string, unknown>;

const agentBackends = new Set<AgentBackend>(['claude', 'codex']);
const agentRoles = new Set<TeamAgent['role']>(['leader', 'teammate']);
const agentStatuses = new Set<TeamAgentStatus>(['idle', 'active', 'failed', 'stopped']);
const attachmentKinds = new Set<AttachmentKind>(['image']);
const chatRoles = new Set<ChatRole>(['user', 'assistant', 'system', 'tool']);
const conversationStatuses = new Set<ConversationStatus>(['idle', 'running', 'failed', 'stopped']);

export async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function normalizeAuthUser(value: unknown): User | null {
  const input = asRecord(value);
  if (!input) return null;
  const id = asString(input.id);
  const username = asString(input.username);
  if (!id || !username) return null;
  return { id, username };
}

export function normalizeAuthResponse(value: unknown): { user: User | null; error: string } {
  const input = asRecord(value);
  return {
    user: normalizeAuthUser(input?.user),
    error: asString(input?.error),
  };
}

export function normalizeTeamList(value: unknown): Team[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeTeam(item)).filter((team): team is Team => team !== null);
}

export function normalizeTeam(value: unknown): Team | null {
  const input = asRecord(value);
  if (!input) return null;
  const id = asString(input.id);
  if (!id) return null;
  const agents = normalizeArray(input.agents, normalizeTeamAgent);
  return {
    id,
    name: asString(input.name, '未命名团队'),
    workspace: asString(input.workspace),
    leaderSlotId: asString(input.leaderSlotId, agents.find((agent) => agent.role === 'leader')?.slotId ?? agents[0]?.slotId ?? ''),
    agents,
    createdAt: asNumber(input.createdAt, Date.now()),
    updatedAt: asNumber(input.updatedAt, Date.now()),
  };
}

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

export function normalizeMessageList(value: unknown): ChatMessage[] {
  return normalizeArray(value, normalizeChatMessage);
}

export function normalizeChatMessage(value: unknown): ChatMessage | null {
  const input = asRecord(value);
  if (!input) return null;
  const id = asString(input.id);
  const conversationId = asString(input.conversationId);
  if (!id || !conversationId) return null;
  return {
    id,
    conversationId,
    role: enumValue(input.role, chatRoles, 'assistant'),
    content: asString(input.content),
    attachments: normalizeArray(input.attachments, normalizeAttachmentRef),
    createdAt: asNumber(input.createdAt, Date.now()),
    status: enumValue(input.status, new Set(['streaming', 'done', 'error'] as const), undefined),
  };
}

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

export function normalizeAgentEventList(value: unknown): AgentEvent[] {
  return normalizeArray(value, normalizeAgentEvent);
}

export function normalizeAgentEvent(value: unknown): AgentEvent | null {
  const input = asRecord(value);
  if (!input) return null;
  const type = asString(input.type);
  const conversationId = asString(input.conversationId);
  if (!type || !conversationId) return null;
  const base = {
    id: asString(input.id, `${type}:${Date.now()}`),
    conversationId,
    turnId: asString(input.turnId),
    at: asNumber(input.at, Date.now()),
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
      return { ...base, type, status: enumValue(input.status, conversationStatuses, 'idle') };
    default:
      return null;
  }
}

export function normalizeConversationStream(value: unknown): { conversationId: string; message: ChatMessage } | null {
  const input = asRecord(value);
  if (!input) return null;
  const conversationId = asString(input.conversationId);
  const message = normalizeChatMessage(input.message);
  if (!conversationId || !message) return null;
  return { conversationId, message };
}

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

export function normalizeTeamMessageEvent(value: unknown): { teamId: string; entry: TeamMailboxEntry } | null {
  const input = asRecord(value);
  if (!input) return null;
  const teamId = asString(input.teamId);
  const entry = normalizeTeamMailboxEntry(input.entry);
  if (!teamId || !entry) return null;
  return { teamId, entry };
}

export function normalizeServerInfo(value: unknown): ServerInfo | null {
  const input = asRecord(value);
  if (!input) return null;
  const host = asString(input.host);
  const port = asNumber(input.port, Number.NaN);
  if (!host || !Number.isFinite(port)) return null;
  return {
    host,
    port,
    allowRemote: asBoolean(input.allowRemote, false),
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

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function enumValue<T extends string>(value: unknown, values: Set<T>, fallback: T): T;
function enumValue<T extends string>(value: unknown, values: Set<T>, fallback: T | undefined): T | undefined;
function enumValue<T extends string>(value: unknown, values: Set<T>, fallback: T | undefined): T | undefined {
  return typeof value === 'string' && values.has(value as T) ? (value as T) : fallback;
}
