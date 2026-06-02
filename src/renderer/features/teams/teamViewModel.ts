import type { Team, TeamMailboxEntry } from '../../../shared/types';

export type TeamSendInvocation =
  | { name: 'team.sendMessage'; params: { teamId: string; content: string; files?: string[] } }
  | { name: 'team.sendMessageToAgent'; params: { teamId: string; slotId: string; content: string; files?: string[] } };

export type TeamSendPayload = {
  content: string;
  files?: string[];
};

export function resolveTeamSendInvocation(
  team: Team | undefined,
  activeSlotId: string | undefined,
  payload: string | TeamSendPayload
): TeamSendInvocation | null {
  if (!team || !activeSlotId) return null;
  const content = typeof payload === 'string' ? payload : payload.content;
  const files = typeof payload === 'string' ? undefined : payload.files;
  const agent = team.agents.find((item) => item.slotId === activeSlotId);
  if (agent?.role === 'teammate') {
    return {
      name: 'team.sendMessageToAgent',
      params: withFiles({ teamId: team.id, slotId: agent.slotId, content }, files),
    };
  }
  return {
    name: 'team.sendMessage',
    params: withFiles({ teamId: team.id, content }, files),
  };
}

function withFiles<T extends { content: string }>(params: T, files: string[] | undefined): T & { files?: string[] } {
  return files && files.length > 0 ? { ...params, files } : params;
}

export function mergeTeamMailboxEntries(current: TeamMailboxEntry[], nextEntry: TeamMailboxEntry): TeamMailboxEntry[] {
  const index = current.findIndex((item) => item.message.id === nextEntry.message.id);
  if (index < 0) return [...current, nextEntry];
  const next = [...current];
  next[index] = nextEntry;
  return next;
}
