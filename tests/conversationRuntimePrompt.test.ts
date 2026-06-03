import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/server/events';
import { ConversationService } from '../src/server/services/conversationService';
import type { AgentBackend, AgentEvent, ChatMessage, Conversation } from '../src/shared/types';

const runtimeInstances: Array<{
  send: ReturnType<typeof vi.fn>;
  cancelCurrentTurn: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('../src/server/runtime/acpRuntime', () => {
  const { EventEmitter } = require('node:events') as typeof import('node:events');

  class MockAcpRuntime extends EventEmitter {
    readonly send = vi.fn(async () => undefined);
    readonly cancelCurrentTurn = vi.fn(async () => true);
    readonly stop = vi.fn();

    constructor(_input: unknown) {
      super();
      runtimeInstances.push({ send: this.send, cancelCurrentTurn: this.cancelCurrentTurn, stop: this.stop });
    }
  }

  return { AcpRuntime: MockAcpRuntime };
});

function createFakeRepository() {
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, ChatMessage[]>();
  const agentEvents = new Map<string, AgentEvent[]>();

  return {
    createConversation(conversation: Conversation): Conversation {
      conversations.set(conversation.id, structuredClone(conversation));
      messages.set(conversation.id, []);
      agentEvents.set(conversation.id, []);
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
    addMessage(message: ChatMessage): ChatMessage {
      const list = messages.get(message.conversationId) ?? [];
      const stored = { ...message, sequence: list.length + 1 };
      list.push(structuredClone(stored));
      messages.set(message.conversationId, list);
      return stored;
    },
    updateMessage(message: ChatMessage): void {
      const list = messages.get(message.conversationId) ?? [];
      const index = list.findIndex((item) => item.id === message.id);
      if (index >= 0) list[index] = structuredClone(message);
      messages.set(message.conversationId, list);
    },
    listMessages(conversationId: string): ChatMessage[] {
      return structuredClone(messages.get(conversationId) ?? []);
    },
    messageExists(messageId: string): boolean {
      return [...messages.values()].some((list) => list.some((message) => message.id === messageId));
    },
    addAgentEvent(event: AgentEvent): AgentEvent {
      const list = agentEvents.get(event.conversationId) ?? [];
      list.push(structuredClone(event));
      agentEvents.set(event.conversationId, list);
      return event;
    },
    listAgentEvents(conversationId: string): AgentEvent[] {
      return structuredClone(agentEvents.get(conversationId) ?? []);
    },
  };
}

describe('ConversationService runtime prompt separation', () => {
  it('stores displayMessage and sends the wrapped prompt to runtime', async () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as any, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude' as AgentBackend, name: 'Alpha' });

    await conversations.sendRuntimePrompt({
      conversationId: conversation.id,
      prompt: 'You are Leader...\nAvailable team RPC tools:\n- team_send_message',
      displayMessage: 'user: 原来是这样',
    });

    const runtime = runtimeInstances.at(-1);
    expect(runtime).toBeDefined();
    expect(runtime?.send).toHaveBeenCalledWith(
      expect.stringContaining('Available team RPC tools:')
    );

    const storedMessages = conversations.messages(conversation.id);
    expect(storedMessages).toHaveLength(1);
    expect(storedMessages[0]).toMatchObject({
      role: 'user',
      content: 'user: 原来是这样',
    });
    expect(storedMessages[0].content).not.toContain('Available team RPC tools:');
  });

  it('forwards current turn cancellation to the active runtime', async () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as any, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude' as AgentBackend, name: 'Alpha' });

    (conversations as any).getRuntime(conversation);
    const result = await conversations.cancelCurrentTurn({ conversationId: conversation.id });

    const runtime = runtimeInstances.at(-1);
    expect(result).toEqual({ accepted: true });
    expect(runtime?.cancelCurrentTurn).toHaveBeenCalledTimes(1);
  });

  it('treats missing runtime during cancellation as idle recovery', async () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const emitSpy = vi.spyOn(events, 'emit');
    const conversations = new ConversationService(repo as any, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude' as AgentBackend, name: 'Alpha' });

    const result = await conversations.cancelCurrentTurn({ conversationId: conversation.id });

    expect(result).toEqual({ accepted: true });
    expect(conversations.list().find((item) => item.id === conversation.id)).toMatchObject({
      status: 'idle',
    });
    expect(emitSpy).toHaveBeenCalledWith('conversation.status', {
      conversationId: conversation.id,
      status: 'idle',
    });
  });

  it('force stops as idle and releases the runtime when current turn cancellation throws', async () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as any, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude' as AgentBackend, name: 'Alpha' });

    (conversations as any).getRuntime(conversation);
    const runtime = runtimeInstances.at(-1);
    runtime?.cancelCurrentTurn.mockRejectedValueOnce(new Error('cancel transport failed'));

    const result = await conversations.cancelCurrentTurn({ conversationId: conversation.id });

    expect(result).toEqual({ accepted: false, error: 'cancel transport failed' });
    expect(runtime?.stop).toHaveBeenCalledWith('idle');
    expect((conversations as any).runtimes.has(conversation.id)).toBe(false);
  });
});
