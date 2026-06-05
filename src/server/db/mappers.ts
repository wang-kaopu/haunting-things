import type {
  AgentEvent,
  AttachmentRef,
  ChatMessage,
  Conversation,
  ConversationSummary,
  ConversationWithWorkspace,
  MailboxMessage,
  StoredAttachment,
  Team,
  TeamWithWorkspace,
  TeamTask,
  Workspace,
} from '@shared/types';

/**
 * 将 conversation 表行映射为共享领域类型。
 */
export function rowToConversation(row: any): Conversation {
  return {
    id: row.id,
    backend: row.backend,
    name: row.name,
    workspaceId: row.workspace_id,
    model: row.model ?? undefined,
    status: row.status,
    acpSessionId: row.acp_session_id ?? undefined,
    sessionMode: row.session_mode ?? undefined,
    currentModelId: row.current_model_id ?? undefined,
    lastTurnId: row.last_turn_id ?? undefined,
    lastStopReason: row.last_stop_reason ?? undefined,
    lastError: row.last_error ?? undefined,
    usageSize: row.usage_size ?? undefined,
    usageUsed: row.usage_used ?? undefined,
    usageRatio: row.usage_ratio ?? undefined,
    usageUpdatedAt: row.usage_updated_at ?? undefined,
    sessionRestoreStatus: row.session_restore_status ?? undefined,
    sessionRestoreMethod: row.session_restore_method ?? undefined,
    sessionRestoreError: row.session_restore_error ?? undefined,
    sessionRestoredAt: row.session_restored_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 将 workspaces 表行映射为共享领域类型。 */
export function rowToWorkspace(row: any): Workspace {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    kind: row.kind,
    isTemporary: row.is_temporary === 1,
    existsOnDisk: row.exists_on_disk === 1,
    lastOpenedAt: row.last_opened_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 将 conversation + workspace join 行映射为带工作区详情的会话视图。 */
export function rowToConversationWithWorkspace(row: any): ConversationWithWorkspace {
  return {
    ...rowToConversation(row),
    workspace: rowToWorkspace(readWorkspaceJoinRow(row)),
  };
}

/** 将 conversation + workspace join 行映射为会话列表摘要。 */
export function rowToConversationSummary(row: any): ConversationSummary {
  const conversation = rowToConversation(row);
  return {
    id: conversation.id,
    name: conversation.name,
    preview: row.preview ?? '',
    status: conversation.status,
    backend: conversation.backend,
    model: conversation.currentModelId ?? conversation.model,
    workspace: rowToWorkspace(readWorkspaceJoinRow(row)),
    lastStopReason: conversation.lastStopReason,
    lastError: conversation.lastError,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
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
    type: row.type,
    content: row.content,
    status: row.status ?? undefined,
    createdAt: row.created_at,
    turnId: row.turn_id ?? undefined,
    sourceEventId: row.source_event_id ?? undefined,
    stopReason: row.stop_reason ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    permissionCallId: row.permission_call_id ?? undefined,
    parentMessageId: row.parent_message_id ?? undefined,
    sequence: row.sequence,
  };
}

/**
 * 还原持久化的 AgentEvent payload。
 */
export function rowToAgentEvent(row: any): AgentEvent {
  const payload = JSON.parse(row.payload) as AgentEvent;
  return {
    ...payload,
    id: row.id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    type: row.type,
    status: row.status ?? payload.status,
    stopReason: row.stop_reason ?? payload.stopReason,
    toolCallId: row.tool_call_id ?? payload.toolCallId,
    permissionCallId: row.permission_call_id ?? payload.permissionCallId,
    messageId: row.message_id ?? payload.messageId,
    sequence: row.sequence,
  } as AgentEvent;
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
    workspaceId: row.workspace_id,
    leaderSlotId: row.leader_slot_id,
    agents: parseTeamAgents(row.agents),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 将 team + workspace join 行映射为带工作区详情的团队视图。 */
export function rowToTeamWithWorkspace(row: any): TeamWithWorkspace {
  return {
    ...rowToTeam(row),
    workspace: rowToWorkspace(readWorkspaceJoinRow(row)),
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

function readWorkspaceJoinRow(row: any): any {
  return {
    id: row.workspace__id,
    name: row.workspace__name,
    path: row.workspace__path,
    kind: row.workspace__kind,
    is_temporary: row.workspace__is_temporary,
    exists_on_disk: row.workspace__exists_on_disk,
    last_opened_at: row.workspace__last_opened_at,
    created_at: row.workspace__created_at,
    updated_at: row.workspace__updated_at,
  };
}
