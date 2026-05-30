export type AgentBackend = 'claude' | 'codex';

export type AgentInfo = {
  backend: AgentBackend;
  name: string;
  available: boolean;
  cliPath?: string;
  version?: string;
  error?: string;
};

export type AgentHealth = AgentInfo & {
  ok: boolean;
  handshake?: boolean;
};

export type ConversationStatus = 'idle' | 'running' | 'failed' | 'stopped';

export type Conversation = {
  id: string;
  backend: AgentBackend;
  name: string;
  workspace: string;
  status: ConversationStatus;
  createdAt: number;
  updatedAt: number;
};

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  status?: 'streaming' | 'done' | 'error';
};

export type PermissionOption = {
  id: string;
  label: string;
  description?: string;
};

export type PermissionRequest = {
  conversationId: string;
  callId: string;
  title: string;
  body?: string;
  options: PermissionOption[];
};

export type TeamAgentStatus = 'idle' | 'active' | 'failed' | 'stopped';

export type TeamAgent = {
  slotId: string;
  conversationId: string;
  role: 'leader' | 'teammate';
  backend: AgentBackend;
  name: string;
  status: TeamAgentStatus;
};

export type Team = {
  id: string;
  name: string;
  workspace: string;
  leaderSlotId: string;
  agents: TeamAgent[];
  createdAt: number;
  updatedAt: number;
};

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

export type ServerInfo = {
  host: string;
  port: number;
  allowRemote: boolean;
  urls: string[];
};

export type User = {
  id: string;
  username: string;
};

export type InvokeMap = {
  'agent.list': { params: void; result: AgentInfo[] };
  'agent.health': { params: { backend: AgentBackend }; result: AgentHealth };
  'conversation.create': {
    params: { backend: AgentBackend; workspace?: string; name?: string };
    result: Conversation;
  };
  'conversation.list': { params: void; result: Conversation[] };
  'conversation.messages': { params: { conversationId: string }; result: ChatMessage[] };
  'conversation.sendMessage': {
    params: { conversationId: string; content: string; files?: string[] };
    result: { accepted: true };
  };
  'conversation.confirmPermission': {
    params: { conversationId: string; callId: string; optionId: string };
    result: { accepted: true };
  };
  'team.create': {
    params: { name: string; workspace?: string; leaderBackend: AgentBackend };
    result: Team;
  };
  'team.addAgent': { params: { teamId: string; name: string; backend: AgentBackend }; result: TeamAgent };
  'team.get': { params: { teamId: string }; result: Team | null };
  'team.list': { params: void; result: Team[] };
  'team.sendMessage': { params: { teamId: string; content: string; files?: string[] }; result: { accepted: true } };
  'team.sendMessageToAgent': {
    params: { teamId: string; slotId: string; content: string; files?: string[] };
    result: { accepted: true };
  };
  'team.stop': { params: { teamId: string }; result: { stopped: true } };
  'server.info': { params: void; result: ServerInfo };
};

export type EventMap = {
  'conversation.stream': { conversationId: string; message: ChatMessage };
  'conversation.permission': PermissionRequest;
  'conversation.finish': { conversationId: string; status: ConversationStatus };
  'conversation.status': { conversationId: string; status: ConversationStatus; error?: string };
  'team.agent.status': { teamId: string; slotId: string; status: TeamAgentStatus; error?: string };
  'team.agent.message': { teamId: string; slotId: string; message: ChatMessage };
  'team.agent.added': { teamId: string; agent: TeamAgent };
  'team.turn.finished': { teamId: string; slotId: string };
};
