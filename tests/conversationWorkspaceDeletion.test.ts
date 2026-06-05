import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@server/events';
import { ConversationService } from '@server/services/conversationService';
import type { Conversation } from '@shared/types';

describe('ConversationService workspace deletion', () => {
  it('stops runtimes before deleting conversations in a workspace', () => {
    const conversations = [
      createConversation('conv-a', 'workspace-a'),
      createConversation('conv-b', 'workspace-a'),
    ];
    const repo = {
      listConversationsByWorkspace: vi.fn(() => conversations),
      deleteConversationsByWorkspace: vi.fn(() => conversations.length),
      listMessages: vi.fn(() => []),
    };
    const service = new ConversationService(repo as any, new EventBus(), '/tmp/haunting-test');
    const firstRuntime = { stop: vi.fn() };
    const secondRuntime = { stop: vi.fn() };
    (service as any).runtimes.set('conv-a', firstRuntime);
    (service as any).runtimes.set('conv-b', secondRuntime);

    const result = service.deleteByWorkspace('workspace-a');

    expect(result).toEqual({ deleted: 2 });
    expect(firstRuntime.stop).toHaveBeenCalledTimes(1);
    expect(secondRuntime.stop).toHaveBeenCalledTimes(1);
    expect((service as any).runtimes.has('conv-a')).toBe(false);
    expect((service as any).runtimes.has('conv-b')).toBe(false);
    expect(repo.deleteConversationsByWorkspace).toHaveBeenCalledWith('workspace-a');
  });
});

/** 创建最小 Conversation 快照，供工作区删除测试使用。 */
function createConversation(id: string, workspaceId: string): Conversation {
  return {
    id,
    backend: 'codex',
    name: id,
    workspaceId,
    status: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
