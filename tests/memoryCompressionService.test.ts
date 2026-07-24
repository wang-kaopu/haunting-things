import { describe, expect, it } from 'vitest';
import type { AgentEvent, ChatMessage, Conversation, ConversationMemory } from '@shared/types';
import { InputBudgetService, RECENT_MEMORY_MESSAGE_WINDOW } from '@server/services/inputBudgetService';
import { MemoryCompressionService } from '@server/services/memoryCompressionService';

function createMessage(sequence: number): ChatMessage {
  return {
    id: `m-${sequence}`,
    conversationId: 'conv-memory',
    role: sequence % 2 === 0 ? 'assistant' : 'user',
    type: 'text',
    content: `message ${sequence}`,
    createdAt: sequence,
    status: 'done',
    sequence,
  };
}

function createRepo(messages: ChatMessage[]) {
  let memory: ConversationMemory | null = null;
  return {
    listMessages() {
      return structuredClone(messages);
    },
    getConversationMemory() {
      return memory ? structuredClone(memory) : null;
    },
    upsertConversationMemory(next: ConversationMemory) {
      memory = structuredClone(next);
      return next;
    },
    createConversation(conversation: Conversation) {
      return conversation;
    },
    updateConversationModel() {},
    updateConversationStatus() {},
    updateConversationAcpSession() {
      return null;
    },
    clearConversationAcpSession() {
      return null;
    },
    updateConversationSessionRestoreState() {
      return null;
    },
    updateConversationRuntimeState() {
      return null;
    },
    updateConversationTurnResult() {
      return null;
    },
    listConversations() {
      return [];
    },
    listConversationsByWorkspace() {
      return [];
    },
    countConversationsByWorkspace() {
      return 0;
    },
    deleteConversationsByWorkspace() {
      return 0;
    },
    listConversationsByStatus() {
      return [];
    },
    getConversation() {
      return null;
    },
    getConversationWithWorkspace() {
      return null;
    },
    listConversationsWithWorkspace() {
      return [];
    },
    listConversationSummaries() {
      return { data: [] };
    },
    updateConversationWorkspace() {
      return null;
    },
    finalizeInterruptedConversation() {},
    finalizeStreamingMessages() {},
    addMessage(message: ChatMessage) {
      return message;
    },
    updateMessage() {},
    listMessagesAfter() {
      return [];
    },
    messageExists() {
      return false;
    },
    addAgentEvent(event: AgentEvent) {
      return event;
    },
    listAgentEvents() {
      return [];
    },
    replaceConversationMcpServers() {},
    listConversationMcpServers() {
      return [];
    },
    replaceConversationCommands() {},
    getConversationCommands() {
      return null;
    },
    replaceConversationModels() {},
    getConversationModels() {
      return null;
    },
    replaceConversationMode() {},
    getConversationMode() {
      return null;
    },
  };
}

describe('MemoryCompressionService', () => {
  it('compresses stable messages before the recent window', () => {
    const messages = Array.from({ length: RECENT_MEMORY_MESSAGE_WINDOW + 5 }, (_, index) => createMessage(index + 1));
    const repo = createRepo(messages);
    const service = new MemoryCompressionService(repo as unknown, new InputBudgetService());

    const result = service.compress({ conversationId: 'conv-memory', reason: 'test compression' });

    expect(result.memory.status).toBe('compressed');
    expect(result.memory.sourceMessageCount).toBe(5);
    expect(result.memory.coveredUntilSequence).toBe(5);
    expect(result.memory.summary).toContain('message 1');
    expect(result.memory.summary).toContain('message 5');
    expect(result.memory.summary).not.toContain('message 6');
  });

  it('replaces the rule summary with a model-refined summary', async () => {
    const messages = Array.from({ length: RECENT_MEMORY_MESSAGE_WINDOW + 3 }, (_, index) => createMessage(index + 1));
    const repo = createRepo(messages);
    const service = new MemoryCompressionService(repo as unknown, new InputBudgetService());

    service.compress({ conversationId: 'conv-memory', reason: 'rule compression' });
    const result = await service.refineWithModel({
      conversationId: 'conv-memory',
      reason: 'model refinement',
      summarize: async (source) => {
        expect(source.messages).toHaveLength(3);
        expect(source.coveredUntilSequence).toBe(3);
        return '模型摘要：用户已经确认 200k 固定预算。';
      },
    });

    expect(result.skipped).toBe(false);
    expect(result.memory.status).toBe('compressed');
    expect(result.memory.summary).toContain('模型摘要');
    expect(result.memory.summary).not.toContain('message 1');
  });

  it('skips stale model summaries when a newer compression changed the covered range', async () => {
    const messages = Array.from({ length: RECENT_MEMORY_MESSAGE_WINDOW + 3 }, (_, index) => createMessage(index + 1));
    const repo = createRepo(messages);
    const service = new MemoryCompressionService(repo as unknown, new InputBudgetService());

    service.compress({ conversationId: 'conv-memory', reason: 'first compression' });
    const result = await service.refineWithModel({
      conversationId: 'conv-memory',
      reason: 'stale model refinement',
      summarize: async () => {
        repo.upsertConversationMemory({
          conversationId: 'conv-memory',
          summary: 'newer summary',
          coveredUntilSequence: 99,
          sourceMessageCount: 99,
          tokenEstimate: 3,
          status: 'compressed',
          compressionReason: 'newer compression',
          createdAt: 1,
          updatedAt: 2,
        });
        return 'stale summary';
      },
    });

    expect(result.skipped).toBe(true);
    expect(result.memory.summary).toBe('newer summary');
  });
});
