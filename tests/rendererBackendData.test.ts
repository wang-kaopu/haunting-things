import { describe, expect, test } from 'vitest';
import {
  normalizeMessageList,
  normalizeServerInfo,
  normalizeTeamList,
  normalizeConversation,
  normalizeConversationCommands,
} from '../src/renderer/shared/utils/backendData';

describe('renderer backend data normalization', () => {
  test('normalizes missing team list payloads to an empty list', () => {
    expect(normalizeTeamList(undefined)).toEqual([]);
    expect(normalizeTeamList({})).toEqual([]);
  });

  test('normalizes legacy team rows without valid agents json', () => {
    const teams = normalizeTeamList([
      {
        id: 'team-1',
        name: 'Legacy',
        workspace: '/tmp/project',
        leaderSlotId: undefined,
        agents: undefined,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    expect(teams).toEqual([
      {
        id: 'team-1',
        name: 'Legacy',
        workspace: '/tmp/project',
        leaderSlotId: '',
        agents: [],
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
  });

  test('drops invalid list entries instead of passing them to components', () => {
    expect(normalizeMessageList(undefined)).toEqual([]);
    expect(
      normalizeMessageList([
        { id: 'm1', conversationId: 'c1', role: 'user', type: 'text', content: 'hello', sequence: 1, createdAt: 1 },
        { id: '', conversationId: 'c2', role: 'assistant', type: 'text', content: 'bad', sequence: 2, createdAt: 2 },
      ])
    ).toHaveLength(1);
  });

  test('normalizes snapshot arrays and server urls defensively', () => {
    expect(
      normalizeConversationCommands({
        conversationId: 'c1',
        commands: [{ name: 'run' }, { description: 'missing name' }],
        updatedAt: 1,
      })?.commands
    ).toEqual([{ name: 'run', description: undefined, input: undefined }]);

    expect(normalizeServerInfo({ host: '127.0.0.1', port: 1234, allowRemote: true, urls: undefined })).toEqual({
      host: '127.0.0.1',
      port: 1234,
      allowRemote: true,
      urls: [],
    });
  });

  test('normalizes persisted conversation runtime fields', () => {
    expect(
      normalizeConversation({
        id: 'conv-1',
        backend: 'codex',
        name: 'Alpha',
        workspace: '/tmp/project',
        model: 'gpt-5',
        status: 'idle',
        acpSessionId: 'session-1',
        sessionMode: 'auto',
        currentModelId: 'gpt-5',
        lastTurnId: 'turn-1',
        lastStopReason: 'cancelled',
        usageSize: 100,
        usageUsed: 25,
        usageRatio: 0.25,
        usageUpdatedAt: 10,
        createdAt: 1,
        updatedAt: 2,
      })
    ).toMatchObject({
      id: 'conv-1',
      acpSessionId: 'session-1',
      sessionMode: 'auto',
      currentModelId: 'gpt-5',
      lastStopReason: 'cancelled',
      usageSize: 100,
      usageUsed: 25,
      usageRatio: 0.25,
      usageUpdatedAt: 10,
    });
  });
});
