import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@server/events';
import { ConversationService } from '@server/services/conversationService';
import type { Conversation } from '@shared/types';

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
    updateConversationAcpSession(id: string, acpSessionId: string): Conversation | null {
      const conversation = conversations.get(id);
      if (!conversation) return null;
      const updated = { ...conversation, acpSessionId, updatedAt: Date.now() };
      conversations.set(id, updated);
      return structuredClone(updated);
    },
    updateConversationRuntimeState(id: string, patch: Partial<Conversation>): Conversation | null {
      const conversation = conversations.get(id);
      if (!conversation) return null;
      const updated = { ...conversation, ...patch, updatedAt: Date.now() };
      conversations.set(id, updated);
      return structuredClone(updated);
    },
    updateConversationTurnResult(id: string, patch: Partial<Conversation>): Conversation | null {
      const conversation = conversations.get(id);
      if (!conversation) return null;
      const updated = { ...conversation, ...patch, updatedAt: Date.now() };
      conversations.set(id, updated);
      return structuredClone(updated);
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
    messageExists(): boolean {
      return false;
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
    const conversations = new ConversationService(repo as any, events, '/tmp/Haunting-things-test');
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

    const emittedCommands: unknown[] = [];
    const emittedModels: unknown[] = [];
    const emitSpy = vi.spyOn(events, 'emit').mockImplementation((name: any, data: any) => {
      if (name === 'conversation.commands') emittedCommands.push(data);
      if (name === 'conversation.models') emittedModels.push(data);
    });

    const restartSpy = vi.spyOn(conversations, 'restart');
    const updated = conversations.setModel({ conversationId: conversation.id, model: 'sonnet-4' });

    expect(updated.model).toBe('sonnet-4');
    expect(restartSpy).toHaveBeenCalledWith(conversation.id);
    expect(conversations.commands(conversation.id)).toBeNull();
    expect(conversations.models(conversation.id)).toMatchObject({
      conversationId: conversation.id,
      currentModelId: 'sonnet-4',
      models: [],
    });
    expect(emittedCommands.at(-1)).toMatchObject({
      conversationId: conversation.id,
      commands: [],
    });
    expect(emittedModels.at(-1)).toMatchObject({
      conversationId: conversation.id,
      currentModelId: 'sonnet-4',
      models: [],
    });
    expect(emitSpy).toHaveBeenCalled();
  });
});
