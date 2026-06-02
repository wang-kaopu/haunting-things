import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/server/events';
import { ConversationService } from '../src/server/services/conversationService';
import type { Conversation } from '../src/shared/types';

function createFakeRepository() {
  const conversations = new Map<string, Conversation>();

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
    updateConversationModel(id: string, model: string | undefined): void {
      const conversation = conversations.get(id);
      if (conversation) conversations.set(id, { ...conversation, model, updatedAt: Date.now() });
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
    listMessages(): never[] {
      return [];
    },
    addAgentEvent(event: never): never {
      return event;
    },
    listAgentEvents(): never[] {
      return [];
    },
  };
}

describe('ConversationService mode snapshots', () => {
  it('forwards current_mode_update as conversation.mode without persisting an agent event', () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as any, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude', name: 'Alpha' });
    const runtime = (conversations as any).getRuntime(conversation);

    const emitted: unknown[] = [];
    vi.spyOn(events, 'emit').mockImplementation((name: any, data: any) => {
      if (name === 'conversation.mode') emitted.push(data);
    });

    runtime['handleSessionUpdate']({
      update: {
        sessionUpdate: 'current_mode_update',
        mode: 'review',
      },
    } as any);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      conversationId: conversation.id,
      mode: 'review',
    });
    expect(conversations.mode(conversation.id)).toEqual(emitted[0]);
  });
});
