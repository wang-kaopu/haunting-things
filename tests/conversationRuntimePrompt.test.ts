import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@server/events';
import { ConversationService } from '@server/services/conversationService';
import type { AgentBackend, AgentEvent, ChatMessage, Conversation, ConversationMemory } from '@shared/types';

const runtimeInstances: Array<{
  send: ReturnType<typeof vi.fn>;
  cancelCurrentTurn: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  getUsageSnapshot: ReturnType<typeof vi.fn>;
  input: unknown;
}> = [];

vi.mock('@server/runtime/acpRuntime', async () => {
  const { EventEmitter } = await import('node:events');

  class MockAcpRuntime extends EventEmitter {
    readonly send = vi.fn(async () => undefined);
    readonly cancelCurrentTurn = vi.fn(async () => true);
    readonly stop = vi.fn();
    readonly getUsageSnapshot = vi.fn(() => null);

    constructor(input: unknown) {
      super();
      runtimeInstances.push({
        send: this.send,
        cancelCurrentTurn: this.cancelCurrentTurn,
        stop: this.stop,
        getUsageSnapshot: this.getUsageSnapshot,
        input,
      });
    }
  }

  return { AcpRuntime: MockAcpRuntime };
});

function createFakeRepository() {
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, ChatMessage[]>();
  const agentEvents = new Map<string, AgentEvent[]>();
  const memories = new Map<string, ConversationMemory>();

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
    listConversationsByStatus(status: Conversation['status']): Conversation[] {
      return [...conversations.values()]
        .filter((conversation) => conversation.status === status)
        .map((conversation) => structuredClone(conversation));
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
    clearConversationAcpSession(id: string): Conversation | null {
      const conversation = conversations.get(id);
      if (!conversation) return null;
      const updated = { ...conversation, acpSessionId: undefined, updatedAt: Date.now() };
      conversations.set(id, updated);
      return structuredClone(updated);
    },
    updateConversationSessionRestoreState(id: string, patch: Partial<Conversation>): Conversation | null {
      const conversation = conversations.get(id);
      if (!conversation) return null;
      const updated = { ...conversation, acpSessionId: patch.acpSessionId, ...patch, updatedAt: Date.now() };
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
    finalizeInterruptedConversation(input: {
      conversationId: string;
      lastTurnId?: string;
      reason: 'app_restarted' | 'runtime_missing';
      message: string;
    }): void {
      const conversation = conversations.get(input.conversationId);
      if (!conversation) return;
      conversations.set(input.conversationId, {
        ...conversation,
        status: 'stopped',
        lastTurnId: input.lastTurnId ?? conversation.lastTurnId,
        lastStopReason: 'stopped',
        lastError: `${input.message} (${input.reason})`,
        updatedAt: Date.now(),
      });
    },
    finalizeStreamingMessages(input: { conversationId: string; stopReason: 'stopped' }): void {
      const list = messages.get(input.conversationId) ?? [];
      messages.set(
        input.conversationId,
        list.map((message) =>
          message.status === 'streaming' ? { ...message, status: 'done', stopReason: input.stopReason } : message
        )
      );
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
    listMessagesAfter(conversationId: string, sequence: number): ChatMessage[] {
      return structuredClone((messages.get(conversationId) ?? []).filter((message) => message.sequence > sequence));
    },
    getConversationMemory(conversationId: string): ConversationMemory | null {
      const memory = memories.get(conversationId);
      return memory ? structuredClone(memory) : null;
    },
    upsertConversationMemory(memory: ConversationMemory): ConversationMemory {
      memories.set(memory.conversationId, structuredClone(memory));
      return memory;
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
    replaceConversationMcpServers(): void {},
    listConversationMcpServers(): never[] {
      return [];
    },
  };
}

describe('ConversationService runtime prompt separation', () => {
  it('stores displayMessage and sends the wrapped prompt to runtime', async () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as unknown, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude' as AgentBackend, name: 'Alpha' });

    await conversations.sendRuntimePrompt({
      conversationId: conversation.id,
      prompt: 'You are Leader...\nAvailable team RPC tools:\n- team_send_message',
      displayMessage: 'user: 原来是这样',
    });

    const runtime = runtimeInstances.at(-1);
    expect(runtime).toBeDefined();
    expect(runtime?.send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Available team RPC tools:'),
      })
    );

    const storedMessages = conversations.messages(conversation.id);
    expect(storedMessages).toHaveLength(1);
    expect(storedMessages[0]).toMatchObject({
      role: 'user',
      content: 'user: 原来是这样',
    });
    expect(storedMessages[0].content).not.toContain('Available team RPC tools:');
  });

  it('builds restore context from prior stable text messages before sending the current prompt', async () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as unknown, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude' as AgentBackend, name: 'Alpha' });

    await conversations.sendMessage({
      conversationId: conversation.id,
      content: '第一条消息',
    });
    await conversations.sendMessage({
      conversationId: conversation.id,
      content: '第二条消息',
    });

    const runtime = runtimeInstances.at(-1);
    expect(runtime?.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: '第二条消息',
        restoreContext: expect.stringContaining('用户: 第一条消息'),
      })
    );
    const lastPrompt = runtime?.send.mock.calls.at(-1)?.[0] as { restoreContext?: string };
    expect(lastPrompt.restoreContext).not.toContain('第二条消息');
  });

  it('forwards current turn cancellation to the active runtime', async () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as unknown, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude' as AgentBackend, name: 'Alpha' });

    (conversations as unknown).getRuntime(conversations.get(conversation.id));
    const result = await conversations.cancelCurrentTurn({ conversationId: conversation.id });

    const runtime = runtimeInstances.at(-1);
    expect(result).toEqual({ accepted: true });
    expect(runtime?.cancelCurrentTurn).toHaveBeenCalledTimes(1);
  });

  it('treats missing runtime during cancellation as idle recovery', async () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const emitSpy = vi.spyOn(events, 'emit');
    const conversations = new ConversationService(repo as unknown, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude' as AgentBackend, name: 'Alpha' });

    const result = await conversations.cancelCurrentTurn({ conversationId: conversation.id });

    expect(result).toEqual({ accepted: true });
    expect(conversations.list().data.find((item) => item.id === conversation.id)).toMatchObject({
      status: 'idle',
    });
    expect(emitSpy).toHaveBeenCalledWith('conversation.status', {
      conversationId: conversation.id,
      status: 'idle',
    });
  });

  it('finalizes running conversation when cancellation finds no runtime', async () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const emitSpy = vi.spyOn(events, 'emit');
    const conversations = new ConversationService(repo as unknown, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude' as AgentBackend, name: 'Alpha' });
    repo.updateConversationStatus(conversation.id, 'running');

    const result = await conversations.cancelCurrentTurn({ conversationId: conversation.id });

    expect(result).toEqual({ accepted: true });
    expect(conversations.list().data.find((item) => item.id === conversation.id)).toMatchObject({
      status: 'stopped',
      lastStopReason: 'stopped',
    });
    expect(emitSpy).toHaveBeenCalledWith('conversation.status', {
      conversationId: conversation.id,
      status: 'stopped',
      error: '运行时已丢失，当前轮次已停止',
    });
  });

  it('recovers stale running conversations on service startup', () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const emitSpy = vi.spyOn(events, 'emit');
    const conversations = new ConversationService(repo as unknown, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude' as AgentBackend, name: 'Alpha' });
    repo.updateConversationStatus(conversation.id, 'running');
    repo.addMessage({
      id: 'assistant-streaming',
      conversationId: conversation.id,
      role: 'assistant',
      type: 'text',
      content: 'partial',
      status: 'streaming',
      createdAt: Date.now(),
      sequence: 0,
    });

    conversations.recoverStaleRuntimeState();

    expect(conversations.list().data.find((item) => item.id === conversation.id)).toMatchObject({
      status: 'stopped',
      lastStopReason: 'stopped',
    });
    expect(conversations.messages(conversation.id)[0]).toMatchObject({
      status: 'done',
      stopReason: 'stopped',
    });
    expect(emitSpy).toHaveBeenCalledWith('conversation.status', {
      conversationId: conversation.id,
      status: 'stopped',
      error: '应用重启，上一轮运行时已丢失',
    });
  });

  it('force stops as idle and releases the runtime when current turn cancellation throws', async () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const conversations = new ConversationService(repo as unknown, events, '/tmp/Haunting-things-test');
    const conversation = conversations.create({ backend: 'claude' as AgentBackend, name: 'Alpha' });

    (conversations as unknown).getRuntime(conversations.get(conversation.id));
    const runtime = runtimeInstances.at(-1);
    runtime?.cancelCurrentTurn.mockRejectedValueOnce(new Error('cancel transport failed'));

    const result = await conversations.cancelCurrentTurn({ conversationId: conversation.id });

    expect(result).toEqual({ accepted: false, error: 'cancel transport failed' });
    expect(runtime?.stop).toHaveBeenCalledWith('idle');
    expect((conversations as unknown).runtimes.has(conversation.id)).toBe(false);
  });

  it('refines compressed memory asynchronously after the rule compression succeeds', async () => {
    const repo = createFakeRepository();
    const events = new EventBus();
    const emitSpy = vi.spyOn(events, 'emit');
    let resolveSummary: ((summary: string) => void) | undefined;
    const summaryPromise = new Promise<string>((resolve) => {
      resolveSummary = resolve;
    });
    const conversations = new ConversationService(
      repo as unknown,
      events,
      '/tmp/Haunting-things-test',
      undefined,
      undefined,
      undefined,
      {
        summarize: vi.fn(async () => summaryPromise),
      }
    );
    const conversation = conversations.create({ backend: 'claude' as AgentBackend, name: 'Alpha' });
    for (let index = 1; index <= 23; index += 1) {
      repo.addMessage({
        id: `m-${index}`,
        conversationId: conversation.id,
        role: index % 2 === 0 ? 'assistant' : 'user',
        type: 'text',
        content: `history ${index}`,
        createdAt: index,
        status: 'done',
        sequence: 0,
      });
    }

    const ruleState = await conversations.compressMemory({ conversationId: conversation.id, reason: 'manual test' });

    expect(ruleState.status).toBe('compressed');
    expect(repo.getConversationMemory(conversation.id)?.summary).toContain('history 1');
    resolveSummary?.('模型摘要：保留预算阈值和最近 20 条原文策略。');
    await vi.waitFor(() => {
      expect(repo.getConversationMemory(conversation.id)?.summary).toContain('模型摘要');
    });
    expect(emitSpy.mock.calls).toEqual(
      expect.arrayContaining([
        ['conversation.memory', expect.objectContaining({ conversationId: conversation.id, status: 'compressing' })],
        ['conversation.memory', expect.objectContaining({ conversationId: conversation.id, status: 'compressed' })],
      ])
    );
  });
});
