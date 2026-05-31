import { describe, expect, it, vi } from 'vitest';
import { ConversationService } from '../src/server/conversations';
import { EventBus } from '../src/server/events';
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

describe('ConversationService model snapshots', () => {
  it('updates the conversation model and clears cached runtime snapshots', () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as any, events, '/tmp/haunting-souls-test');
    const conversation = conversations.create({ backend: 'claude', name: 'Alpha', model: 'old-model' });

    (conversations as any).commandSnapshots.set(conversation.id, {
      conversationId: conversation.id,
      commands: [{ name: 'review' }],
      updatedAt: Date.now(),
    });
    (conversations as any).modelSnapshots.set(conversation.id, {
      conversationId: conversation.id,
      currentModelId: 'old-model',
      models: [{ id: 'old-model', name: 'Old Model' }],
      updatedAt: Date.now(),
    });

    const restartSpy = vi.spyOn(conversations, 'restart');
    const updated = conversations.setModel({ conversationId: conversation.id, model: 'sonnet-4' });

    expect(updated.model).toBe('sonnet-4');
    expect(restartSpy).toHaveBeenCalledWith(conversation.id);
    expect(conversations.commands(conversation.id)).toBeNull();
    expect(conversations.models(conversation.id)).toBeNull();
  });
});
