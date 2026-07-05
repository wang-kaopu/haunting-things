import { existsSync, readFileSync } from 'node:fs';
import { countTokens } from 'gpt-tokenizer';
import type { Conversation, ConversationUsage, StoredAttachment } from '@shared/types';

export const BASE_CONTEXT_TOKENS = 200_000;
export const COMPRESSION_TRIGGER_TOKENS = 150_000;
export const HARD_REJECT_TOKENS = 180_000;
export const OUTPUT_RESERVE_TOKENS = 16_000;
export const RECENT_MEMORY_MESSAGE_WINDOW = 20;

const TOKEN_SAFETY_MULTIPLIER = 1.15;
const IMAGE_ATTACHMENT_TOKEN_ESTIMATE = 1700;
const RESOURCE_LINK_TOKEN_ESTIMATE = 128;
const MAX_IMAGE_ATTACHMENTS = 20;
const MAX_TEXT_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const MAX_RESOURCE_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export type InputBudgetAction = 'allow' | 'compress' | 'reject';

export type InputBudgetPlan = {
  action: InputBudgetAction;
  reason: string;
  contextLimit: number;
  compressionTriggerTokens: number;
  hardRejectTokens: number;
  currentUsedTokens: number;
  currentInputTokens: number;
  restoreContextTokens: number;
  attachmentTokens: number;
  outputReserveTokens: number;
  projectedTokens: number;
};

/** 输入预算超过硬安全线时抛出的业务错误。 */
export class InputBudgetError extends Error {
  constructor(readonly plan: InputBudgetPlan) {
    super(buildBudgetErrorMessage(plan));
    this.name = 'InputBudgetError';
  }
}

/** 为 ACP prompt 提供保守 token 估算和发送前预算决策。 */
export class InputBudgetService {
  /**
   * 估算文本 token 数，加入安全系数以覆盖 Claude/Codex tokenizer 差异。
   *
   * @param text - 待发送或待注入上下文
   * @returns 保守估算的 token 数
   */
  estimateTextTokens(text: string | null | undefined): number {
    if (!text) return 0;
    try {
      return Math.ceil(countTokens(text) * TOKEN_SAFETY_MULTIPLIER);
    } catch {
      return Math.ceil(Math.max(text.length / 2, Buffer.byteLength(text, 'utf8') / 4));
    }
  }

  /**
   * 将文本按 token 预算裁剪，优先保留尾部最近内容。
   *
   * @param text - 原始文本
   * @param maxTokens - 最大 token 预算
   * @returns 不超过预算的尾部文本
   */
  tailClipToTokens(text: string, maxTokens: number): string {
    if (maxTokens <= 0) return '';
    if (this.estimateTextTokens(text) <= maxTokens) return text;

    let low = 0;
    let high = text.length;
    let best = '';
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = text.slice(text.length - mid);
      if (this.estimateTextTokens(candidate) <= maxTokens) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best.trimStart();
  }

  /**
   * 估算附件进入模型上下文时的 token 成本。
   *
   * @param attachments - 已解析的服务端附件
   * @returns 附件 token 估算和拒绝原因
   */
  estimateAttachmentTokens(attachments: StoredAttachment[] = []): { tokens: number; rejectReason?: string } {
    let tokens = 0;
    let imageCount = 0;

    for (const attachment of attachments) {
      if (attachment.kind === 'image' || attachment.mimeType.startsWith('image/')) {
        imageCount += 1;
        tokens += IMAGE_ATTACHMENT_TOKEN_ESTIMATE;
        continue;
      }

      if (attachment.mimeType.startsWith('text/') && attachment.size <= MAX_TEXT_ATTACHMENT_BYTES) {
        const text = this.readTextAttachment(attachment);
        tokens += text ? this.estimateTextTokens(text) : RESOURCE_LINK_TOKEN_ESTIMATE;
        continue;
      }

      if (attachment.size > MAX_RESOURCE_ATTACHMENT_BYTES) {
        return { tokens, rejectReason: '单个二进制或资源链接附件不能超过 50MB。' };
      }

      tokens += RESOURCE_LINK_TOKEN_ESTIMATE;
    }

    if (imageCount > MAX_IMAGE_ATTACHMENTS) {
      return { tokens, rejectReason: `最多支持 ${MAX_IMAGE_ATTACHMENTS} 个图片附件进入同一轮上下文。` };
    }
    return { tokens };
  }

  /**
   * 根据当前 usage、待发送内容和阈值生成预算决策。
   *
   * @param input - 当前会话、prompt 内容和估算模式
   * @returns allow / compress / reject 决策
   */
  plan(input: {
    conversation: Conversation;
    text: string;
    attachments?: StoredAttachment[];
    restoreContext?: string | null;
    usage?: ConversationUsage | null;
    assumeFreshSession?: boolean;
  }): InputBudgetPlan {
    const attachmentEstimate = this.estimateAttachmentTokens(input.attachments ?? []);
    const textTokens = this.estimateTextTokens(input.text);
    const restoreContextTokens = this.estimateTextTokens(input.restoreContext);
    const attachmentTokens = attachmentEstimate.tokens;
    const currentInputTokens = textTokens + restoreContextTokens + attachmentTokens;
    const currentRequestTokens = textTokens + attachmentTokens;
    const currentUsedTokens = input.assumeFreshSession
      ? 0
      : Math.min(input.usage?.used ?? input.conversation.usageUsed ?? 0, BASE_CONTEXT_TOKENS);
    const projectedTokens = currentUsedTokens + currentInputTokens + OUTPUT_RESERVE_TOKENS;

    const base = {
      contextLimit: BASE_CONTEXT_TOKENS,
      compressionTriggerTokens: COMPRESSION_TRIGGER_TOKENS,
      hardRejectTokens: HARD_REJECT_TOKENS,
      currentUsedTokens,
      currentInputTokens,
      restoreContextTokens,
      attachmentTokens,
      outputReserveTokens: OUTPUT_RESERVE_TOKENS,
      projectedTokens,
    };

    if (attachmentEstimate.rejectReason) {
      return { ...base, action: 'reject', reason: attachmentEstimate.rejectReason };
    }
    if (currentRequestTokens + OUTPUT_RESERVE_TOKENS >= HARD_REJECT_TOKENS) {
      return { ...base, action: 'reject', reason: '当前输入本身超过安全预算，请拆分后发送。' };
    }
    if (input.assumeFreshSession && projectedTokens >= HARD_REJECT_TOKENS) {
      return { ...base, action: 'reject', reason: '压缩后上下文仍超过 180k 安全线，请减少输入或附件。' };
    }
    if (!input.assumeFreshSession && projectedTokens >= COMPRESSION_TRIGGER_TOKENS) {
      return { ...base, action: 'compress', reason: '预计上下文达到 200k 的 75%，需要先压缩记忆。' };
    }
    if (!input.assumeFreshSession && currentUsedTokens >= COMPRESSION_TRIGGER_TOKENS) {
      return { ...base, action: 'compress', reason: '当前 ACP usage 已达到 200k 的 75%，需要先压缩记忆。' };
    }
    return { ...base, action: 'allow', reason: projectedTokens >= COMPRESSION_TRIGGER_TOKENS ? '压缩后仍接近阈值，但未超过硬安全线。' : '预算通过。' };
  }

  private readTextAttachment(attachment: StoredAttachment): string | null {
    if (!existsSync(attachment.path)) return null;
    const statSize = attachment.size;
    if (statSize > MAX_TEXT_ATTACHMENT_BYTES) return null;
    return readFileSync(attachment.path, 'utf8');
  }
}

function buildBudgetErrorMessage(plan: InputBudgetPlan): string {
  return `${plan.reason} 当前估算 ${plan.projectedTokens.toLocaleString()} tokens，硬安全线 ${plan.hardRejectTokens.toLocaleString()} tokens。`;
}
