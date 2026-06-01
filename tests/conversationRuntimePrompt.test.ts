import { describe, expect, it, vi } from 'vitest';
import { ConversationService } from '../src/server/services/conversationService';
import { EventBus } from '../src/server/events';
import type { AgentBackend, ChatMessage, Conversation, AgentEvent } from '../src/shared/types';

const runtimeInstances: Array<{ send: ReturnType<typeof vi.fn> }> = [];

vi.mock('../src/server/runtime/acpRuntime', () => {
  const { EventEmitter } = require('node:events') as typeof import('node:events');

  class MockAcpRuntime extends EventEmitter {
    readonly send = vi.fn(async () => undefined);

    constructor(_input: unknown) {
      super();
      runtimeInstances.push({ send: this.send });
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
    addMessage(message: ChatMessage): ChatMessage {
      const list = messages.get(message.conversationId) ?? [];
      list.push(structuredClone(message));
      messages.set(message.conversationId, list);
      return message;
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
    const conversations = new ConversationService(repo as any, events, '/tmp/haunting-souls-test');
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
});
