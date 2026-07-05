import type { AgentBackend, ChatMessage, Conversation } from '@shared/types';
import { createId } from '@server/id';
import { AcpRuntime } from '@server/runtime/acpRuntime';
import { InputBudgetService } from '@server/services/inputBudgetService';

const MODEL_SUMMARY_SOURCE_TOKENS = 96_000;
const MODEL_SUMMARY_MESSAGE_TOKENS = 700;
const MODEL_SUMMARY_TIMEOUT_MS = 120_000;

export type MemorySummaryModelInput = {
  conversation: Conversation;
  workspacePath: string;
  reason: string;
  ruleSummary: string;
  coveredUntilSequence: number;
  sourceMessageCount: number;
  messages: ChatMessage[];
};

export interface MemorySummaryModelPort {
  summarize(input: MemorySummaryModelInput): Promise<string>;
}

/** 使用独立 ACP session 为规则压缩结果生成质量更高的模型摘要。 */
export class AcpMemorySummaryModelService implements MemorySummaryModelPort {
  constructor(
    private readonly budget: InputBudgetService,
    private readonly createRuntime = (input: ConstructorParameters<typeof AcpRuntime>[0]) => new AcpRuntime(input)
  ) {}

  /**
   * 在后台独立 session 中生成稳定历史摘要。
   *
   * @param input - 需要摘要的会话历史和规则摘要
   * @returns 可写入 `conversation_memories.summary` 的模型摘要
   */
  async summarize(input: MemorySummaryModelInput): Promise<string> {
    const prompt = this.buildPrompt(input);
    const runtime = this.createRuntime({
      conversationId: `${input.conversation.id}:memory-summary:${createId()}`,
      backend: input.conversation.backend,
      workspacePath: input.workspacePath,
      model: input.conversation.currentModelId ?? input.conversation.model,
      mcpServers: [],
    });
    let content = '';
    let finishStatus: string | null = null;

    runtime.on('message', (message) => {
      if (message.role === 'assistant' && message.type === 'text') {
        content = message.content;
      }
    });
    runtime.on('permission', (request) => {
      runtime.respondPermission(request.callId, { outcome: { outcome: 'cancelled' } });
    });
    runtime.on('finish', (status) => {
      finishStatus = status;
    });

    try {
      await withTimeout(runtime.send({ text: prompt, attachments: [] }), MODEL_SUMMARY_TIMEOUT_MS);
    } finally {
      runtime.stop('idle');
    }

    const summary = content.trim();
    if (finishStatus !== 'idle' || !summary) {
      throw new Error(`模型摘要失败：${finishStatus ?? 'unknown'}`);
    }
    return summary;
  }

  /**
   * 生成给后台 summarizer 的约束 prompt。
   *
   * @param input - 规则摘要和原始稳定消息
   * @returns 后台模型摘要 prompt
   */
  private buildPrompt(input: MemorySummaryModelInput): string {
    const source = this.budget.tailClipToTokens(this.formatSourceMessages(input.messages), MODEL_SUMMARY_SOURCE_TOKENS);
    return [
      '你是对话记忆压缩器。请把较早的稳定对话历史压缩成后续对话可用的中文记忆。',
      '',
      '要求：',
      '- 保留用户目标、已确认决策、架构约束、重要文件路径、待办和风险。',
      '- 删除寒暄、重复日志和已经失效的中间尝试。',
      '- 如果历史里有互相冲突的信息，说明冲突，并偏向更新的消息。',
      '- 不要编造历史里没有的信息。',
      '- 输出只包含摘要正文，不要加解释性前言。',
      '',
      `压缩原因：${input.reason}`,
      `覆盖消息数：${input.sourceMessageCount}`,
      `覆盖到 sequence：${input.coveredUntilSequence}`,
      '',
      '[规则摘要兜底]',
      input.ruleSummary,
      '',
      '[原始稳定消息节选]',
      source,
    ].join('\n');
  }

  /**
   * 将稳定消息格式化为模型可读的压缩素材。
   *
   * @param messages - 已筛选的稳定历史消息
   * @returns 带 sequence 和角色的历史文本
   */
  private formatSourceMessages(messages: ChatMessage[]): string {
    return messages
      .map((message) => {
        const snippet = this.budget.tailClipToTokens(message.content.trim(), MODEL_SUMMARY_MESSAGE_TOKENS);
        return `#${message.sequence} ${formatRole(message.role)}: ${snippet}`;
      })
      .join('\n\n');
  }
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

/**
 * 为后台模型摘要增加超时保护，避免长期占用压缩状态。
 *
 * @param promise - 待限制的异步任务
 * @param timeoutMs - 超时时间
 * @returns 原任务结果
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`模型摘要超时：${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
