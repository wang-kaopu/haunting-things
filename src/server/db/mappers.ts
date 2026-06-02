import type {
  AgentEvent,
  AttachmentRef,
  ChatMessage,
  Conversation,
  MailboxMessage,
  StoredAttachment,
  Team,
  TeamTask,
} from '../../shared/types';

/**
 * 将 conversation 表行映射为共享领域类型。
 */
export function rowToConversation(row: any): Conversation {
  return {
    id: row.id,
    backend: row.backend,
    name: row.name,
    workspace: row.workspace,
    model: row.model ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 将 messages 表行映射为共享领域类型。
 */
export function rowToMessage(row: any): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    status: row.status ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * 还原持久化的 AgentEvent payload。
 */
export function rowToAgentEvent(row: any): AgentEvent {
  return JSON.parse(row.payload) as AgentEvent;
}

/**
 * 将附件表行映射为服务端完整附件记录。
 */
export function rowToStoredAttachment(row: any): StoredAttachment {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    path: row.path,
    url: row.url,
    sha256: row.sha256 ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * 将服务端附件记录裁剪为前端可见引用。
 */
export function toAttachmentRef(attachment: StoredAttachment): AttachmentRef {
  return {
    id: attachment.id,
    kind: attachment.kind,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    url: attachment.url,
    createdAt: attachment.createdAt,
  };
}

/**
 * 将 team 表行映射为共享领域类型。
 */
export function rowToTeam(row: any): Team {
  return {
    id: row.id,
    name: row.name,
    workspace: row.workspace,
    leaderSlotId: row.leader_slot_id,
    agents: parseTeamAgents(row.agents),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 将 mailbox 表行映射为共享领域类型。
 */
export function rowToMailbox(row: any): MailboxMessage {
  return {
    id: row.id,
    teamId: row.team_id,
    toAgentId: row.to_agent_id,
    fromAgentId: row.from_agent_id,
    content: row.content,
    summary: row.summary ?? undefined,
    read: row.read === 1,
    createdAt: row.created_at,
  };
}

/**
 * 将 task 表行映射为共享领域类型。
 */
export function rowToTask(row: any): TeamTask {
  return {
    id: row.id,
    teamId: row.team_id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    createdBySlotId: row.created_by_slot_id ?? undefined,
    assignedSlotId: row.assigned_slot_id ?? undefined,
    completedBySlotId: row.completed_by_slot_id ?? undefined,
    completionSummary: row.completion_summary ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

/**
 * 解析 Team 成员列表。
 *
 * 旧数据可能写入空字符串或非法 JSON，解析失败时返回空数组以保证列表接口可用。
 */
function parseTeamAgents(value: unknown): Team['agents'] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as Team['agents']) : [];
  } catch {
    return [];
  }
}
