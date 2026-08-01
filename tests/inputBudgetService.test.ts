import { describe, expect, it } from 'vitest';
import type { Conversation, StoredAttachment } from '@shared/types';
import {
  COMPRESSION_TRIGGER_TOKENS,
  HARD_REJECT_TOKENS,
  InputBudgetService,
} from '@server/services/inputBudgetService';

const conversation: Conversation = {
  id: 'conv-budget',
  backend: 'claude',
  name: 'Budget',
  workspaceId: 'workspace-1',
  status: 'idle',
  acpSessionId: 'session-1',
  usageSize: 200_000,
  usageUsed: 0,
  usageRatio: 0,
  usageUpdatedAt: 1,
  createdAt: 1,
  updatedAt: 1,
};

describe('InputBudgetService', () => {
  it('requests compression at the projected 150k threshold', () => {
    class FixedInputBudgetService extends InputBudgetService {
      override estimateTextTokens(text: string | null | undefined): number {
        return text ? 1 : 0;
      }
    }
    const service = new FixedInputBudgetService();
    const usage = {
      conversationId: conversation.id,
      size: 200_000,
      ratio: 0,
      updatedAt: 1,
    };
    const belowThreshold = service.plan({
      conversation: { ...conversation, usageUsed: COMPRESSION_TRIGGER_TOKENS - 16_002 },
      text: 'hello',
      usage: {
        ...usage,
        used: COMPRESSION_TRIGGER_TOKENS - 16_002,
      },
    });
    const plan = service.plan({
      conversation: { ...conversation, usageUsed: COMPRESSION_TRIGGER_TOKENS - 16_001 },
      text: 'hello',
      usage: {
        ...usage,
        used: COMPRESSION_TRIGGER_TOKENS - 16_001,
      },
    });

    expect(belowThreshold.action).toBe('allow');
    expect(plan.action).toBe('compress');
  });

  it('rejects when the current request itself leaves no safe output reserve', () => {
    class HugeInputBudgetService extends InputBudgetService {
      override estimateTextTokens(): number {
        return HARD_REJECT_TOKENS;
      }
    }
    const service = new HugeInputBudgetService();
    const plan = service.plan({
      conversation,
      text: 'huge input',
      usage: {
        conversationId: conversation.id,
        size: 200_000,
        used: 0,
        ratio: 0,
        updatedAt: 1,
      },
    });

    expect(plan.action).toBe('reject');
    expect(plan.reason).toContain('当前输入本身');
  });

  it('uses fresh-session accounting after compression', () => {
    const service = new InputBudgetService();
    const plan = service.plan({
      conversation: { ...conversation, usageUsed: 190_000 },
      text: 'compressed send',
      restoreContext: 'summary',
      usage: {
        conversationId: conversation.id,
        size: 200_000,
        used: 0,
        ratio: 0,
        updatedAt: 1,
      },
      assumeFreshSession: true,
    });

    expect(plan.action).toBe('allow');
    expect(plan.currentUsedTokens).toBe(0);
  });

  it('rejects too many image attachments before sending', () => {
    const service = new InputBudgetService();
    const attachments = Array.from({ length: 21 }, (_, index) => createAttachment(`image-${index}`, 'image/png', 1024));
    const plan = service.plan({
      conversation,
      text: 'images',
      attachments,
    });

    expect(plan.action).toBe('reject');
    expect(plan.reason).toContain('最多支持 20 个图片附件');
  });

  it('counts binary resource links conservatively and keeps a size limit', () => {
    const service = new InputBudgetService();
    const plan = service.plan({
      conversation,
      text: 'binary',
      attachments: [createAttachment('binary-1', 'application/octet-stream', 51 * 1024 * 1024)],
    });

    expect(plan.action).toBe('reject');
    expect(plan.reason).toContain('50MB');
  });
});

function createAttachment(id: string, mimeType: string, size: number): StoredAttachment {
  return {
    id,
    kind: (mimeType.startsWith('image/') ? 'image' : 'resource') as StoredAttachment['kind'],
    name: id,
    mimeType,
    size,
    path: `/tmp/${id}`,
    url: `/api/attachments/${id}`,
    createdAt: 1,
  };
}
