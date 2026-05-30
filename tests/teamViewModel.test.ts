import { describe, expect, it } from 'vitest';
import type { Team, TeamMailboxEntry } from '../src/shared/types';
import { mergeTeamMailboxEntries, resolveTeamSendInvocation } from '../src/renderer/teamViewModel';

function makeTeam(): Team {
  return {
    id: 'team-1',
    name: 'Team',
    workspace: '/tmp/work',
    leaderSlotId: 'slot-lead',
    agents: [
      {
        slotId: 'slot-lead',
        conversationId: 'conv-lead',
        role: 'leader',
        backend: 'claude',
        name: 'Leader',
        status: 'idle',
      },
      {
        slotId: 'slot-dev',
        conversationId: 'conv-dev',
        role: 'teammate',
        backend: 'codex',
        name: 'Dev',
        status: 'idle',
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('teamViewModel', () => {
  it('routes leader sendbox submissions to team.sendMessage', () => {
    const invocation = resolveTeamSendInvocation(makeTeam(), 'slot-lead', 'hello');
    expect(invocation).toEqual({
      name: 'team.sendMessage',
      params: { teamId: 'team-1', content: 'hello' },
    });
  });

  it('routes teammate sendbox submissions to team.sendMessageToAgent', () => {
    const invocation = resolveTeamSendInvocation(makeTeam(), 'slot-dev', 'hello teammate');
    expect(invocation).toEqual({
      name: 'team.sendMessageToAgent',
      params: { teamId: 'team-1', slotId: 'slot-dev', content: 'hello teammate' },
    });
  });

  it('upserts mailbox entries by message id', () => {
    const initial: TeamMailboxEntry[] = [
      {
        message: {
          id: 'msg-1',
          teamId: 'team-1',
          toAgentId: 'slot-dev',
          fromAgentId: 'slot-lead',
          content: 'draft',
          read: false,
          createdAt: 1,
        },
        fromAgentName: 'Leader',
        toAgentName: 'Dev',
        processed: false,
      },
    ];

    const updated = mergeTeamMailboxEntries(initial, {
      message: { ...initial[0].message, read: true },
      fromAgentName: 'Leader',
      toAgentName: 'Dev',
      processed: true,
    });

    expect(updated).toHaveLength(1);
    expect(updated[0].processed).toBe(true);
    expect(updated[0].message.read).toBe(true);
  });
});
