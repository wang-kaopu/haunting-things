import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { openDatabase, Repository } from '../src/server/db';

describe('mailbox repository', () => {
  test('readUnreadAndMark returns unread messages once', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'haunting-souls-test-'));
    const db = openDatabase(path.join(dir, 'test.sqlite'));
    const repo = new Repository(db);
    repo.createTeam({
      id: 'team-1',
      name: 'Test Team',
      workspace: dir,
      leaderSlotId: 'agent-1',
      agents: [
        {
          slotId: 'agent-1',
          conversationId: 'conversation-1',
          role: 'leader',
          backend: 'claude',
          name: 'Leader',
          status: 'idle',
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    });

    repo.writeMailbox({
      id: 'm1',
      teamId: 'team-1',
      toAgentId: 'agent-1',
      fromAgentId: 'user',
      content: 'hello',
      read: false,
      createdAt: 1,
    });

    const firstRead = repo.readUnreadAndMark('team-1', 'agent-1');
    const secondRead = repo.readUnreadAndMark('team-1', 'agent-1');

    expect(firstRead).toHaveLength(1);
    expect(firstRead[0].content).toBe('hello');
    expect(secondRead).toHaveLength(0);

    db.close();
  });
});
