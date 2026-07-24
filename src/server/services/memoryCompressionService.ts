import type {
  ChatMessage,
  ConversationMemory,
  ConversationMemoryState,
} from '@shared/types';
import type { ConversationRepositoryPort } from '@server/port/conversationRepositoryPort';
import { InputBudgetService, RECENT_MEMORY_MESSAGE_WINDOW } from '@server/services/inputBudgetService';

const SUMMARY_TARGET_TOKENS = 12_000;
const MESSAGE_SNIPPET_TOKENS = 320;

export type MemoryCompressionResult = {
  memory: ConversationMemory;
  state: ConversationMemoryState;
};

export type MemoryRefinementResult = {
  memory: ConversationMemory;
  state: ConversationMemoryState;
  skipped: boolean;
};

export type MemoryRefinementSource = {
  conversationId: string;
  reason: string;
  ruleSummary: string;
  coveredUntilSequence: number;
  sourceMessageCount: number;
  messages: ChatMessage[];
};

/** 负责将旧消息历史压缩成会话级派生记忆。 */
export class MemoryCompressionService {
  constructor(
    private readonly repo: ConversationRepositoryPort,
    private readonly budget: InputBudgetService
  ) {}

  /**
   * 对指定 conversation 执行规则压缩，并保留最近窗口之前的稳定消息摘要。
   *
   * @param input - conversation 和压缩原因
   * @returns 压缩后的记忆记录和 UI 状态
   */
  compress(input: { conversationId: string; reason: string }): MemoryCompressionResult {
    const now = Date.now();
    const messages = this.repo.listMessages(input.conversationId).filter(isStableTextMessage);
    const compressibleMessages = messages.slice(0, Math.max(0, messages.length - RECENT_MEMORY_MESSAGE_WINDOW));
    const existing = this.repo.getConversationMemory(input.conversationId);

    if (compressibleMessages.length === 0) {
      const memory = this.repo.upsertConversationMemory({
        conversationId: input.conversationId,
        summary: existing?.summary ?? '暂无可压缩的旧稳定消息；系统会继续保留最近对话原文。',
        coveredUntilSequence: existing?.coveredUntilSequence ?? -1,
        sourceMessageCount: existing?.sourceMessageCount ?? 0,
        tokenEstimate: existing?.tokenEstimate ?? 0,
        status: 'warning',
        compressionReason: input.reason,
        lastError: '没有超过最近窗口的稳定消息可压缩。',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      return { memory, state: toMemoryState(memory, input.reason) };
    }

    const coveredUntilSequence = Math.max(...compressibleMessages.map((message) => message.sequence));
    const rawSummary = this.buildRuleSummary(compressibleMessages, input.reason);
    const summary = this.budget.tailClipToTokens(rawSummary, SUMMARY_TARGET_TOKENS);
    const tokenEstimate = this.budget.estimateTextTokens(summary);
    const memory = this.repo.upsertConversationMemory({
      conversationId: input.conversationId,
      summary,
      coveredUntilSequence,
      sourceMessageCount: compressibleMessages.length,
      tokenEstimate,
      status: 'compressed',
      compressionReason: input.reason,
      lastError: undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    return { memory, state: toMemoryState(memory, input.reason) };
  }

  /**
   * 将压缩失败写入状态表，保留上一版 summary 以便后续仍可恢复上下文。
   *
   * @param input - conversation、原因和错误
   * @returns 失败状态
   */
  markFailed(input: { conversationId: string; reason: string; error: unknown }): ConversationMemoryState {
    const now = Date.now();
    const existing = this.repo.getConversationMemory(input.conversationId);
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    const memory = this.repo.upsertConversationMemory({
      conversationId: input.conversationId,
      summary: existing?.summary ?? '',
      coveredUntilSequence: existing?.coveredUntilSequence ?? -1,
      sourceMessageCount: existing?.sourceMessageCount ?? 0,
      tokenEstimate: existing?.tokenEstimate ?? 0,
      status: 'failed',
      compressionReason: input.reason,
      lastError: message,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return toMemoryState(memory, input.reason);
  }

  /**
   * 记录后台模型摘要失败，但保留规则摘要作为可用压缩结果。
   *
   * @param input - conversation、原因和错误
   * @returns 告警状态
   */
  markRefinementFailed(input: { conversationId: string; reason: string; error: unknown }): ConversationMemoryState {
    const now = Date.now();
    const existing = this.repo.getConversationMemory(input.conversationId);
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    const memory = this.repo.upsertConversationMemory({
      conversationId: input.conversationId,
      summary: existing?.summary ?? '',
      coveredUntilSequence: existing?.coveredUntilSequence ?? -1,
      sourceMessageCount: existing?.sourceMessageCount ?? 0,
      tokenEstimate: existing?.tokenEstimate ?? 0,
      status: 'warning',
      compressionReason: input.reason,
      lastError: message,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return toMemoryState(memory, input.reason);
  }

  /**
   * 使用后台模型摘要替换规则摘要；如果压缩覆盖范围已变化，则丢弃陈旧结果。
   *
   * @param input - 会话、压缩原因和模型摘要回调
   * @returns 模型摘要写入结果，或陈旧结果跳过标记
   */
  async refineWithModel(input: {
    conversationId: string;
    reason: string;
    summarize: (source: MemoryRefinementSource) => Promise<string>;
  }): Promise<MemoryRefinementResult> {
    const existing = this.repo.getConversationMemory(input.conversationId);
    if (!existing?.summary.trim() || existing.coveredUntilSequence < 0 || existing.sourceMessageCount <= 0) {
      const memory = existing ?? this.createEmptyWarningMemory(input.conversationId, input.reason);
      return {
        memory,
        state: toMemoryState(memory, input.reason),
        skipped: true,
      };
    }

    const sourceMessages = this.repo
      .listMessages(input.conversationId)
      .filter((message) => isStableTextMessage(message) && message.sequence <= existing.coveredUntilSequence);
    if (sourceMessages.length === 0) {
      return { memory: existing, state: toMemoryState(existing, input.reason), skipped: true };
    }

    const modelSummary = (await input.summarize({
      conversationId: input.conversationId,
      reason: input.reason,
      ruleSummary: existing.summary,
      coveredUntilSequence: existing.coveredUntilSequence,
      sourceMessageCount: existing.sourceMessageCount,
      messages: sourceMessages,
    })).trim();
    if (!modelSummary) {
      throw new Error('模型摘要为空。');
    }

    const latest = this.repo.getConversationMemory(input.conversationId);
    if (
      !latest ||
      latest.coveredUntilSequence !== existing.coveredUntilSequence ||
      latest.sourceMessageCount !== existing.sourceMessageCount
    ) {
      return { memory: latest ?? existing, state: toMemoryState(latest ?? existing, input.reason), skipped: true };
    }

    const summary = this.budget.tailClipToTokens(this.buildModelSummaryEnvelope(modelSummary, existing), SUMMARY_TARGET_TOKENS);
    const memory = this.repo.upsertConversationMemory({
      ...latest,
      summary,
      tokenEstimate: this.budget.estimateTextTokens(summary),
      status: 'compressed',
      compressionReason: `后台模型摘要完成：${input.reason}`,
      lastError: undefined,
      updatedAt: Date.now(),
    });
    return { memory, state: toMemoryState(memory, input.reason), skipped: false };
  }

  /**
   * 用确定性规则构造兜底摘要，保证模型摘要不可用时仍能重建上下文。
   *
   * @param messages - 需要压缩的旧稳定消息
   * @param reason - 压缩原因
   * @returns 可直接写入 memory 的规则摘要
   */
  private buildRuleSummary(messages: ChatMessage[], reason: string): string {
    const lines = messages.map((message) => {
      const role = formatRole(message.role);
      const stopReason = message.stopReason ? `, stop=${message.stopReason}` : '';
      const snippet = this.budget.tailClipToTokens(message.content.trim(), MESSAGE_SNIPPET_TOKENS);
      return `- #${message.sequence} ${role}${stopReason}: ${snippet}`;
    });

    return [
      '以下是当前会话较早历史的规则压缩记忆。',
      `压缩原因：${reason}`,
      `覆盖消息数：${messages.length}`,
      `覆盖 sequence：${messages[0]?.sequence ?? 0} - ${messages[messages.length - 1]?.sequence ?? 0}`,
      '使用方式：把它当作背景记忆，不要逐字复述；如果和最近原文冲突，以最近原文为准。',
      '',
      ...lines,
    ].join('\n');
  }

  /**
   * 构造没有可压缩内容时的内存告警状态。
   *
   * @param conversationId - 会话 ID
   * @param reason - 压缩原因
   * @returns 未持久化的告警 memory
   */
  private createEmptyWarningMemory(conversationId: string, reason: string): ConversationMemory {
    const now = Date.now();
    return {
      conversationId,
      summary: '',
      coveredUntilSequence: -1,
      sourceMessageCount: 0,
      tokenEstimate: 0,
      status: 'warning',
      compressionReason: reason,
      lastError: '没有可供模型摘要的已压缩记忆。',
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 给模型摘要补上覆盖范围和使用说明，保持恢复上下文格式稳定。
   *
   * @param summary - 后台模型生成的摘要正文
   * @param previous - 被替换的规则摘要记录
   * @returns 可写入 memory 的模型摘要
   */
  private buildModelSummaryEnvelope(summary: string, previous: ConversationMemory): string {
    return [
      '以下是当前会话较早历史的模型压缩记忆。',
      `覆盖消息数：${previous.sourceMessageCount}`,
      `覆盖到 sequence：${previous.coveredUntilSequence}`,
      '使用方式：把它当作背景记忆，不要逐字复述；如果和最近原文冲突，以最近原文为准。',
      '',
      summary,
    ].join('\n');
  }
}

/**
 * 将 memory 记录转换成前端可展示的压缩状态。
 *
 * @param memory - 持久化 memory
 * @param reason - 可覆盖记录里的原因
 * @returns 前端状态事件
 */
function toMemoryState(memory: ConversationMemory, reason?: string): ConversationMemoryState {
  return {
    conversationId: memory.conversationId,
    status: memory.status,
    summaryTokens: memory.tokenEstimate,
    coveredUntilSequence: memory.coveredUntilSequence,
    sourceMessageCount: memory.sourceMessageCount,
    reason: reason ?? memory.compressionReason,
    error: memory.lastError,
    updatedAt: memory.updatedAt,
  };
}

/**
 * 判断消息是否适合进入稳定历史压缩。
 *
 * @param message - 候选消息
 * @returns 是否是已完成文本消息
 */
function isStableTextMessage(message: ChatMessage): boolean {
  return message.type === 'text' && Boolean(message.content.trim()) && message.status !== 'streaming';
}

/**
 * 将内部 role 转成中文摘要标签。
 *
 * @param role - 消息角色
 * @returns 摘要中使用的角色名
 */
function formatRole(role: ChatMessage['role']): string {
  if (role === 'user') return '用户';
  if (role === 'assistant') return '助手';
  if (role === 'tool') return '工具';
  return role;
}
