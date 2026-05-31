/** 应用层所有共享类型定义：Agent、Conversation、Team、消息、权限请求及 WebSocket Bridge API。 */

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

/** Conversation 当前状态。 */
export type ConversationStatus = 'idle' | 'running' | 'failed' | 'stopped';

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

/** 单个 Conversation 的元数据。 */
export type Conversation = {
  id: string;
  backend: AgentBackend;
  name: string;
  workspace: string;
  model?: string;
  status: ConversationStatus;
  createdAt: number;
  updatedAt: number;
};

/** 聊天消息的发送者角色。 */
export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

/** 单条聊天消息，`status` 在流式输出期间为 `streaming`，完成后为 `done`。 */
export type ChatMessage = {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  status?: 'streaming' | 'done' | 'error';
};

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

/** 标准化的 Agent 运行过程事件。 */
export type AgentEvent =
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
      at: number;
    };

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

/** Conversation 的实时 usage 快照。 */
export type ConversationUsage = {
  conversationId: string;
  size: number;
  used: number;
  ratio: number;
  updatedAt: number;
};

/** Conversation 的实时可用命令快照。 */
export type ConversationCommands = {
  conversationId: string;
  commands: AcpAvailableCommand[];
  updatedAt: number;
};

/** Conversation 的实时模式快照。 */
export type ConversationMode = {
  conversationId: string;
  mode: string;
  updatedAt: number;
};

/** Conversation 的实时模型快照。 */
export type AcpModelInfo = {
  id: string;
  name?: string;
  description?: string;
};

/** Conversation 的实时模型快照。 */
export type ConversationModels = {
  conversationId: string;
  currentModelId?: string;
  models: AcpModelInfo[];
  updatedAt: number;
};

/** Team 中单个 Agent 的运行状态。 */
export type TeamAgentStatus = 'idle' | 'active' | 'failed' | 'stopped';

/** Team 中单个 Agent 成员的完整描述。 */
export type TeamAgent = {
  slotId: string;
  conversationId: string;
  role: 'leader' | 'teammate';
  backend: AgentBackend;
  model?: string;
  name: string;
  status: TeamAgentStatus;
};

/** Team 的完整描述，包含所有成员列表。 */
export type Team = {
  id: string;
  name: string;
  workspace: string;
  leaderSlotId: string;
  agents: TeamAgent[];
  createdAt: number;
  updatedAt: number;
};

/** Team 内部成员间的异步消息（存储在 mailbox 表）。 */
export type MailboxMessage = {
  id: string;
  teamId: string;
  toAgentId: string;
  fromAgentId: string;
  content: string;
  summary?: string;
  read: boolean;
  createdAt: number;
};

/** Team mailbox / timeline 的可展示条目。 */
export type TeamMailboxEntry = {
  message: MailboxMessage;
  fromAgentName: string;
  toAgentName: string;
  processed: boolean;
};

/** Team 任务状态。 */
export type TeamTaskStatus = 'pending' | 'done';

/** Team 内部的任务记录。 */
export type TeamTask = {
  id: string;
  teamId: string;
  title: string;
  description?: string;
  status: TeamTaskStatus;
  createdBySlotId?: string;
  assignedSlotId?: string;
  completedBySlotId?: string;
  completionSummary?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

/** 服务器监听信息，用于 UI 展示访问地址。 */
export type ServerInfo = {
  host: string;
  port: number;
  allowRemote: boolean;
  urls: string[];
};

/** 已登录用户的公开信息。 */
export type User = {
  id: string;
  username: string;
};

/**
 * WebSocket Bridge 可调用 API 的完整映射。
 * key 为 API 名称，value 包含 `params`（请求参数）和 `result`（返回值）类型。
 */
export type InvokeMap = {
  'agent.list': { params: void; result: AgentInfo[] };
  'agent.health': { params: { backend: AgentBackend }; result: AgentHealth };
  'conversation.create': {
    params: { backend: AgentBackend; workspace?: string; name?: string; model?: string };
    result: Conversation;
  };
  'conversation.setModel': {
    params: { conversationId: string; model: string };
    result: Conversation;
  };
  'conversation.list': { params: void; result: Conversation[] };
  'conversation.messages': { params: { conversationId: string }; result: ChatMessage[] };
  'conversation.agentEvents': { params: { conversationId: string }; result: AgentEvent[] };
  'conversation.commands': { params: { conversationId: string }; result: ConversationCommands | null };
  'conversation.models': { params: { conversationId: string }; result: ConversationModels | null };
  'conversation.mode': { params: { conversationId: string }; result: ConversationMode | null };
  'conversation.sendMessage': {
    params: { conversationId: string; content: string; files?: string[] };
    result: { accepted: true };
  };
  'conversation.confirmPermission': {
    params: { conversationId: string; callId: string; optionId: string };
    result: { accepted: true };
  };
  'team.create': {
    params: { name: string; workspace?: string; leaderBackend: AgentBackend; leaderModel?: string };
    result: Team;
  };
  'team.delete': { params: { teamId: string }; result: { deleted: true } };
  'team.addAgent': { params: { teamId: string; name: string; backend: AgentBackend; model?: string }; result: TeamAgent };
  'team.removeAgent': { params: { teamId: string; slotId: string }; result: { removed: true } };
  'team.setAgentModel': { params: { teamId: string; slotId: string; model: string }; result: TeamAgent };
  'team.finishTask': {
    params: { teamId: string; summary: string; taskId?: string };
    result: { finished: true };
  };
  'team.taskCreate': {
    params: {
      teamId: string;
      title: string;
      description?: string;
      assignedSlotId?: string;
      createdBySlotId?: string;
    };
    result: TeamTask;
  };
  'team.tasks': { params: { teamId: string }; result: TeamTask[] };
  'team.get': { params: { teamId: string }; result: Team | null };
  'team.list': { params: void; result: Team[] };
  'team.sendMessage': { params: { teamId: string; content: string; files?: string[] }; result: { accepted: true } };
  'team.sendMessageToAgent': {
    params: { teamId: string; slotId: string; content: string; files?: string[] };
    result: { accepted: true };
  };
  'team.timeline': { params: { teamId: string }; result: TeamMailboxEntry[] };
  'team.stop': { params: { teamId: string }; result: { stopped: true } };
  'server.info': { params: void; result: ServerInfo };
};

/**
 * WebSocket Bridge 服务端主动推送事件的完整映射。
 * key 为事件名称，value 为事件数据类型。
 */
export type EventMap = {
  'conversation.stream': { conversationId: string; message: ChatMessage };
  'conversation.agentEvent': AgentEvent;
  'conversation.usage': ConversationUsage;
  'conversation.commands': ConversationCommands;
  'conversation.models': ConversationModels;
  'conversation.mode': ConversationMode;
  'conversation.permission': PermissionRequest;
  'conversation.finish': { conversationId: string; status: ConversationStatus };
  'conversation.status': { conversationId: string; status: ConversationStatus; error?: string };
  'team.agent.status': { teamId: string; slotId: string; status: TeamAgentStatus; error?: string };
  'team.agent.prompt': { teamId: string; slotId: string; conversationId: string; prompt: string };
  'team.agent.message': { teamId: string; entry: TeamMailboxEntry };
  'team.agent.added': { teamId: string; agent: TeamAgent };
  'team.agent.removed': { teamId: string; slotId: string };
  'team.turn.finished': { teamId: string; slotId: string };
};
