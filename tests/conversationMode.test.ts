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

describe('ConversationService mode snapshots', () => {
  it('forwards current_mode_update as conversation.mode without persisting an agent event', () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as unknown, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude', name: 'Alpha' });
    const runtime = (conversations as unknown).getRuntime(conversations.get(conversation.id));

    const emitted: unknown[] = [];
    vi.spyOn(events, 'emit').mockImplementation((name: unknown, data: unknown) => {
      if (name === 'conversation.mode') emitted.push(data);
    });

    runtime['handleSessionUpdate']({
      update: {
        sessionUpdate: 'current_mode_update',
        currentModeId: 'review',
      },
    } as unknown);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      conversationId: conversation.id,
      mode: 'review',
    });
    expect(conversations.mode(conversation.id)).toEqual(emitted[0]);
  });

  it('switches conversation mode through the runtime and emits a snapshot', async () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as unknown, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude', name: 'Alpha' });
    const runtime = (conversations as unknown).getRuntime(conversations.get(conversation.id));
    const snapshot = {
      conversationId: conversation.id,
      mode: 'plan',
      updatedAt: Date.now(),
    };
    runtime.setSessionMode = vi.fn(async () => snapshot);

    const emitted: unknown[] = [];
    vi.spyOn(events, 'emit').mockImplementation((name: unknown, data: unknown) => {
      if (name === 'conversation.mode') emitted.push(data);
    });

    const result = await conversations.setMode({ conversationId: conversation.id, mode: 'plan' });

    expect(runtime.setSessionMode).toHaveBeenCalledWith('plan');
    expect(result).toEqual(snapshot);
    expect(emitted).toEqual([snapshot]);
    expect(conversations.mode(conversation.id)).toEqual(snapshot);
  });

  it('rejects permission modes that do not belong to the conversation backend', async () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as unknown, events, '/tmp/Haunting-things-test');
    const claude = conversations.create({ backend: 'claude', name: 'Claude' });
    const codex = conversations.create({ backend: 'codex', name: 'Codex' });

    await expect(conversations.setMode({ conversationId: claude.id, mode: 'full-access' })).rejects.toThrow(
      'Unsupported permission mode for claude: full-access'
    );
    await expect(conversations.setMode({ conversationId: claude.id, mode: 'auto' })).rejects.toThrow(
      'Unsupported permission mode for claude: auto'
    );
    await expect(conversations.setMode({ conversationId: codex.id, mode: 'bypassPermissions' })).rejects.toThrow(
      'Unsupported permission mode for codex: bypassPermissions'
    );
  });

  it('allows Codex-specific permission modes', async () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as unknown, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'codex', name: 'Codex' });
    const runtime = (conversations as unknown).getRuntime(conversations.get(conversation.id));
    const snapshot = {
      conversationId: conversation.id,
      mode: 'full-access',
      updatedAt: Date.now(),
    };
    runtime.setSessionMode = vi.fn(async () => snapshot);

    const result = await conversations.setMode({ conversationId: conversation.id, mode: 'full-access' });

    expect(runtime.setSessionMode).toHaveBeenCalledWith('full-access');
    expect(result).toEqual(snapshot);
    expect(conversations.mode(conversation.id)).toEqual(snapshot);
  });

  it('restores a persisted mode snapshot when runtime memory is empty', () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as unknown, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude', name: 'Alpha' });

    repo.updateConversationRuntimeState(conversation.id, {
      sessionMode: 'auto',
    });

    expect(conversations.mode(conversation.id)).toMatchObject({
      conversationId: conversation.id,
      mode: 'auto',
    });
  });
});
