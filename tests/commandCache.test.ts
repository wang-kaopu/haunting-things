import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCachedCommands, writeCachedCommands } from '@renderer/shared/commandCache';

function createLocalStorageMock(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: vi.fn(() => items.clear()),
    getItem: vi.fn((key: string) => items.get(key) ?? null),
    key: vi.fn((index: number) => [...items.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => {
      items.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      items.set(key, value);
    }),
  };
}

describe('command cache', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: createLocalStorageMock() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads cached backend commands for the requested conversation', () => {
    writeCachedCommands('claude', {
      conversationId: 'old-conversation',
      commands: [{ name: 'review', description: 'Review changes' }],
      updatedAt: 10,
    });

    expect(readCachedCommands('claude', 'new-conversation')).toEqual({
      conversationId: 'new-conversation',
      commands: [{ name: 'review', description: 'Review changes' }],
      updatedAt: 10,
    });
  });

  it('does not overwrite existing cache with empty command snapshots', () => {
    writeCachedCommands('codex', {
      conversationId: 'conversation-1',
      commands: [{ name: 'test' }],
      updatedAt: 20,
    });
    writeCachedCommands('codex', {
      conversationId: 'conversation-1',
      commands: [],
      updatedAt: 30,
    });

    expect(readCachedCommands('codex', 'conversation-2')).toEqual({
      conversationId: 'conversation-2',
      commands: [{ name: 'test' }],
      updatedAt: 20,
    });
  });
});
