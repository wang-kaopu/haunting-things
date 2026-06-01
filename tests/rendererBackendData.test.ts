import { describe, expect, test } from 'vitest';
import {
  normalizeMessageList,
  normalizeServerInfo,
  normalizeTeamList,
  normalizeConversationCommands,
} from '../src/renderer/app/utils/backendData';

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
        { id: 'm1', conversationId: 'c1', role: 'user', content: 'hello', createdAt: 1 },
        { id: '', conversationId: 'c2', role: 'assistant', content: 'bad', createdAt: 2 },
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
});
