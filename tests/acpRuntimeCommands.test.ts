import { describe, expect, it } from 'vitest';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { AcpRuntime } from '../src/server/acpRuntime';
import type { ConversationCommands } from '../src/shared/types';

describe('AcpRuntime available commands', () => {
  it('handles available_commands_update as commands snapshot', () => {
    const runtime = new AcpRuntime({
      conversationId: 'conv-1',
      backend: 'claude',
      workspace: '/tmp/workspace',
    });

    const received: ConversationCommands[] = [];
    runtime.on('commands', (snapshot) => {
      received.push(snapshot);
    });

    runtime['handleSessionUpdate']({
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          {
            name: 'review',
            description: 'Review my current changes and find issues',
            input: { type: 'object' },
          },
          {
            name: 'compact',
            description: 'summarize conversation to prevent hitting the context limit',
            input: null,
          },
        ],
      },
    } as SessionNotification);

    expect(received).toHaveLength(1);
    expect(received[0].conversationId).toBe('conv-1');
    expect(received[0].commands).toHaveLength(2);
    expect(received[0].commands[0]).toMatchObject({
      name: 'review',
      description: 'Review my current changes and find issues',
      input: { type: 'object' },
    });
    expect(runtime.getAvailableCommandsSnapshot()).toEqual(received[0]);
  });
});
