import type { Team, TeamMailboxEntry } from '../../../shared/types';

export type TeamSendInvocation =
  | { name: 'team.sendMessage'; params: { teamId: string; content: string } }
  | { name: 'team.sendMessageToAgent'; params: { teamId: string; slotId: string; content: string } };

export function resolveTeamSendInvocation(
  team: Team | undefined,
  activeSlotId: string | undefined,
  content: string
): TeamSendInvocation | null {
  if (!team || !activeSlotId) return null;
  const agent = team.agents.find((item) => item.slotId === activeSlotId);
  if (agent?.role === 'teammate') {
    return {
      name: 'team.sendMessageToAgent',
      params: { teamId: team.id, slotId: agent.slotId, content },
    };
  }
  return {
    name: 'team.sendMessage',
    params: { teamId: team.id, content },
  };
}

export function mergeTeamMailboxEntries(current: TeamMailboxEntry[], nextEntry: TeamMailboxEntry): TeamMailboxEntry[] {
  const index = current.findIndex((item) => item.message.id === nextEntry.message.id);
  if (index < 0) return [...current, nextEntry];
  const next = [...current];
  next[index] = nextEntry;
  return next;
}
