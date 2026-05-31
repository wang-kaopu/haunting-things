import { describe, expect, it, vi } from 'vitest';
import { ConversationService } from '../src/server/conversations';
import { EventBus } from '../src/server/events';
import type { AgentEvent, Conversation } from '../src/shared/types';

function createFakeRepository() {
  const conversations = new Map<string, Conversation>();
  const agentEvents = new Map<string, AgentEvent[]>();

  return {
    createConversation(conversation: Conversation): Conversation {
      conversations.set(conversation.id, structuredClone(conversation));
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
    addMessage(message: never): never {
      return message;
    },
    updateMessage(message: never): void {
      void message;
    },
    listMessages(): never[] {
      return [];
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

describe('ConversationService agent event policy', () => {
  it('does not persist streaming deltas but persists final and completed tool events', () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as any, events, '/tmp/haunting-souls-test');
    const conversation = conversations.create({ backend: 'claude', name: 'Alpha' });
    const runtime = (conversations as any).getRuntime(conversation);
    (runtime as any).activeTurnId = 'turn-1';

    const emitted: AgentEvent[] = [];
    vi.spyOn(events, 'emit').mockImplementation((name: any, data: any) => {
      if (name === 'conversation.agentEvent') emitted.push(data);
    });

    runtime.emit('agentEvent', {
      id: '1',
      type: 'agent.reply.delta',
      conversationId: conversation.id,
      turnId: 'turn-1',
      messageId: 'msg-1',
      delta: 'hello',
      at: Date.now(),
    } as AgentEvent);

    runtime.emit('agentEvent', {
      id: '2',
      type: 'agent.tool.update',
      conversationId: conversation.id,
      turnId: 'turn-1',
      toolCallId: 'tool-1',
      title: 'Read file',
      status: 'running',
      content: 'progress',
      at: Date.now(),
    } as AgentEvent);

    runtime['handleSessionUpdate']({
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        title: 'Read file',
        status: 'completed',
        output: 'done',
      },
    } as any);

    runtime['handleSessionUpdate']({
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-2',
        title: 'Write file',
        status: 'failed',
        error: { message: 'boom' },
      },
    } as any);

    runtime.emit('agentEvent', {
      id: '4',
      type: 'agent.reply.done',
      conversationId: conversation.id,
      turnId: 'turn-1',
      messageId: 'msg-1',
      content: 'final text',
      at: Date.now(),
    } as AgentEvent);

    expect(repo.listAgentEvents(conversation.id).map((event) => event.type)).toEqual([
      'agent.tool.result',
      'agent.tool.result',
      'agent.error',
      'agent.reply.done',
    ]);
    expect(emitted.map((event) => event.type)).toEqual([
      'agent.reply.delta',
      'agent.tool.update',
      'agent.tool.result',
      'agent.tool.result',
      'agent.error',
      'agent.reply.done',
    ]);
  });
});
