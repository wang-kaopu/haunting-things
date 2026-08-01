import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@server/events';
import { ConversationService } from '@server/services/conversationService';
import type { Conversation, ConversationCommands } from '@shared/types';

function createFakeRepository() {
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, never[]>();

  return {
    createConversation(conversation: Conversation): Conversation {
      conversations.set(conversation.id, structuredClone(conversation));
      return conversation;
    },
    getConversation(id: string): Conversation | null {
      const conversation = conversations.get(id);
      return conversation ? structuredClone(conversation) : null;
    },
    listConversations(): Conversation[] {
      return [...conversations.values()].map((conversation) => structuredClone(conversation));
    },
    updateConversationStatus(id: string, status: Conversation['status']): void {
      const conversation = conversations.get(id);
      if (conversation) conversations.set(id, { ...conversation, status, updatedAt: Date.now() });
    },
    addMessage(message: never): never {
      return message;
    },
    updateMessage(message: never): void {
      void message;
    },
    listMessages(conversationId: string): never[] {
      return structuredClone(messages.get(conversationId) ?? []);
    },
    addAgentEvent(event: never): never {
      return event;
    },
  };
}

describe('ConversationService commands snapshots', () => {
  it('forwards commands snapshot without persisting as agent event', () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as unknown, events, '/tmp/Haunting-things-test');

    const conversation = conversations.create({ backend: 'claude', name: 'Alpha' });
    const runtime = (conversations as unknown).getRuntime(conversations.get(conversation.id));

    const emitted: ConversationCommands[] = [];
    const emitSpy = vi.spyOn(events, 'emit').mockImplementation((name: unknown, data: unknown) => {
      if (name === 'conversation.commands') emitted.push(data);
    });

    const snapshot: ConversationCommands = {
      conversationId: conversation.id,
      commands: [
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
      updatedAt: Date.now(),
    };

    runtime.emit('commands', snapshot);

    expect(emitted).toHaveLength(1);
    expect(conversations.commands(conversation.id)).toEqual(snapshot);
    expect(emitSpy).toHaveBeenCalledWith('conversation.commands', snapshot);
  });
});
