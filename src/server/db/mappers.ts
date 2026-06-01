import type { AgentEvent, ChatMessage, Conversation, MailboxMessage, Team, TeamTask } from '../../shared/types';

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

/** 将 `messages` 表行映射为共享领域类型。 */
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

export function rowToAgentEvent(row: any): AgentEvent {
  return JSON.parse(row.payload) as AgentEvent;
}

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

function parseTeamAgents(value: unknown): Team['agents'] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as Team['agents']) : [];
  } catch {
    return [];
  }
}
