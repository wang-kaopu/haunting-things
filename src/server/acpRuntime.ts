import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import type {
  AgentBackend,
  AgentEvent,
  AgentTurnPhase,
  ChatMessage,
  ConversationStatus,
  PermissionRequest,
} from '../shared/types';
import { getBridgePackageVersioned } from './agentRegistry';
import { ndjsonFromChildProcess } from './ndjsonTransport';

type AcpRuntimeEvents = {
  message: [ChatMessage];
  agentEvent: [AgentEvent];
  permission: [PermissionRequest];
  status: [ConversationStatus, string?];
  finish: [ConversationStatus];
};

type AcpRuntimeAgentEventInput =
  | { type: 'agent.turn.started'; backend: AgentBackend }
  | { type: 'agent.thinking' }
  | { type: 'agent.reply.delta'; messageId: string; delta: string }
  | { type: 'agent.reply.done'; messageId: string; content: string }
  | {
      type: 'agent.tool.call';
      toolCallId: string;
      toolName: string;
      title?: string;
      input?: unknown;
    }
  | {
      type: 'agent.tool.result';
      toolCallId: string;
      toolName?: string;
      output?: unknown;
      isError?: boolean;
    }
  | {
      type: 'agent.permission.request';
      callId: string;
      title: string;
      body?: string;
      options: PermissionRequest['options'];
    }
  | {
      type: 'agent.error';
      source: 'runtime' | 'model' | 'tool' | 'permission' | 'transport';
      message: string;
      detail?: unknown;
    }
  | { type: 'agent.done'; status: ConversationStatus };

/** ACP SDK 要求的 MCP server 配置格式（env 为 {name,value}[] 数组）。 */
type McpServer = {
  name: string;
  command: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
};

/** 追踪单条 SDK 请求，用于进程退出时批量 reject。 */
type PendingRequest = {
  settled: boolean;
  reject: (error: unknown) => void;
};

/**
 * 管理单个 Agent（Claude / Codex）的完整生命周期：
 * 进程启动、ACP 握手、消息流转、权限请求响应、进程退出清理。
 *
 * 通过 `@agentclientprotocol/sdk` 的 `ClientSideConnection` 与代理进程通信，
 * 以事件形式向上层（`ConversationService`）暴露消息流和权限请求。
 *
 * 事件：
 * - `message`    — 收到新的或更新的 `ChatMessage`（含流式累加）
 * - `permission` — Agent 请求用户授权，含可选选项列表
 * - `status`     — 对话状态变更（running / idle / failed / stopped）
 * - `finish`     — 一轮 prompt 结束（idle）或异常终止（failed / stopped）
 */
export class AcpRuntime extends EventEmitter<AcpRuntimeEvents> {
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: ClientSideConnection | null = null;
  private sessionId: string | null = null;
  private assistantMessage: ChatMessage | null = null;
  private activePrompt = false;
  private activeTurnId: string | null = null;
  private turnFinalized = false;
  private turnPhase: AgentTurnPhase = 'queued';
  private hasReplyStarted = false;
  private readonly toolCalls = new Map<string, { toolName: string; title: string }>();

  /** 所有正在等待响应的 SDK 请求，进程退出时统一 reject。 */
  private readonly pendingRequests = new Set<PendingRequest>();
  /** callId → resolve 函数，等待用户确认权限后调用。 */
  private readonly pendingPermissions = new Map<
    string,
    (response: RequestPermissionResponse) => void
  >();

  constructor(
    private readonly input: {
      conversationId: string;
      backend: AgentBackend;
      workspace: string;
      mcpServers?: McpServer[];
    }
  ) {
    super();
  }

  /**
   * 向 Agent 发送一条用户消息，等待本轮 prompt 完成。
   *
   * 首次调用时会自动启动代理进程并完成 ACP 握手。
   * 流式文本块通过 `message` 事件逐步推送，轮次结束后 emit `finish`。
   *
   * @param content - 用户消息的纯文本内容
   */
  async send(content: string): Promise<void> {
    await this.ensureStarted();
    this.activeTurnId = crypto.randomUUID();
    this.turnFinalized = false;
    this.turnPhase = 'thinking';
    this.hasReplyStarted = false;
    this.toolCalls.clear();
    this.emit('status', 'running');
    this.emitAgentEvent({ type: 'agent.turn.started', backend: this.input.backend });
    this.emitAgentEvent({ type: 'agent.thinking' });

    this.assistantMessage = {
      id: crypto.randomUUID(),
      conversationId: this.input.conversationId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      status: 'streaming',
    };
    this.emit('message', this.assistantMessage);

    this.activePrompt = true;
    try {
      await this.runConnectionRequest(() =>
        this.connection!.prompt({
          sessionId: this.sessionId!,
          prompt: [{ type: 'text', text: content }],
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (!this.turnFinalized) {
        if (this.assistantMessage) {
          this.assistantMessage = { ...this.assistantMessage, status: 'error' };
          this.emit('message', this.assistantMessage);
        }
        this.turnPhase = 'failed';
        this.emitAgentEvent({
          type: 'agent.error',
          source: 'runtime',
          message,
          detail: err,
        });
        this.emit('status', 'failed', message);
        this.emitAgentEvent({ type: 'agent.done', status: 'failed' });
        this.turnFinalized = true;
        this.turnPhase = 'done';
        this.activeTurnId = null;
        this.emit('finish', 'failed');
      }
      return;
    } finally {
      this.activePrompt = false;
    }

    if (this.assistantMessage) {
      this.assistantMessage = { ...this.assistantMessage, status: 'done' };
      this.emit('message', this.assistantMessage);
      this.emitAgentEvent({
        type: 'agent.reply.done',
        messageId: this.assistantMessage.id,
        content: this.assistantMessage.content,
      });
    }
    this.turnPhase = 'done';
    this.emit('status', 'idle');
    this.emitAgentEvent({ type: 'agent.done', status: 'idle' });
    this.turnFinalized = true;
    this.activeTurnId = null;
    this.emit('finish', 'idle');
  }

  /**
   * 响应一条挂起的权限请求。
   *
   * 对应 `permission` 事件中的 `callId`，用户选择 `optionId` 后调用此方法，
   * 内部 Promise 被 resolve，ACP 协议层随即收到响应并继续执行。
   *
   * @param callId   - 权限请求的唯一标识（来自 `PermissionRequest.callId`）
   * @param optionId - 用户选中的选项 ID（来自 `PermissionOption.id`）
   */
  confirmPermission(callId: string, optionId: string): void {
    const resolve = this.pendingPermissions.get(callId);
    if (resolve) {
      this.pendingPermissions.delete(callId);
      resolve({ outcome: { outcome: 'selected', optionId } });
    }
  }

  /**
   * 强制停止代理进程，清理所有状态。
   * 未完成的权限请求会以 `cancelled` 响应，pending SDK 请求会被 reject。
   */
  stop(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.connection = null;
    this.emit('status', 'stopped');
  }

  /**
   * 确保代理进程已启动并完成 ACP 握手，幂等。
   *
   * 流程：
   * 1. `npx -y <bridge-package>` 启动代理子进程
   * 2. Promise.race(initialize, 启动失败监视器) — 进程提前退出则抛出
   * 3. `session/new` 创建会话并记录 `sessionId`
   * 4. 注册进程退出清理：reject 所有 pending 请求 + cancel 所有 pending 权限
   */
  private async ensureStarted(): Promise<void> {
    if (this.connection) return;

    const bridgePackage = getBridgePackageVersioned(this.input.backend);
    const cwd = path.resolve(this.input.workspace || process.cwd());

    const child = spawn('npx', ['-y', bridgePackage], {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    this.child = child;

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.warn(`[ACP ${this.input.backend} stderr] ${text}`);
    });

    // 启动失败监视器：initialize 完成前进程退出则 reject
    const startupFailure = new Promise<never>((_, reject) => {
      child.once('exit', (code, signal) => {
        reject(new Error(`ACP process exited during startup (code=${code ?? signal})`));
      });
    });

    // 进程正常退出后的清理逻辑
    child.once('exit', (code, signal) => {
      const wasClean = code === 0 || signal === 'SIGTERM';
      this.child = null;
      this.connection = null;
      const error = new Error(`ACP exited (code=${code ?? signal})`);
      this.rejectPendingRequests(error);
      for (const resolve of this.pendingPermissions.values()) {
        resolve({ outcome: { outcome: 'cancelled' } });
      }
      this.pendingPermissions.clear();
      const status: ConversationStatus = wasClean ? 'stopped' : 'failed';
      if (this.activeTurnId && !this.turnFinalized) {
        if (!wasClean) {
          this.turnPhase = 'failed';
          this.emitAgentEvent({
            type: 'agent.error',
            source: 'transport',
            message: error.message,
            detail: { code, signal },
          });
        }
        this.emitAgentEvent({ type: 'agent.done', status });
        this.turnFinalized = true;
        this.turnPhase = 'done';
        this.activeTurnId = null;
      }
      this.emit('status', status, wasClean ? undefined : error.message);
      this.emit('finish', status);
    });

    const stream = ndjsonFromChildProcess(child);
    const connection = new ClientSideConnection(
      (_agent) => ({
        /** Agent 推送流式更新（文本块、工具调用等）。 */
        sessionUpdate: async (params: SessionNotification) => {
          this.handleSessionUpdate(params);
        },
        /** Agent 请求用户对某个工具调用进行授权。 */
        requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
          return this.handlePermissionRequest(params);
        },
        /** Agent 读取工作区内的文本文件。 */
        readTextFile: async ({ path: filePath }) => {
          const content = await readFile(filePath, 'utf8');
          return { content };
        },
        /** Agent 向工作区写入文本文件。 */
        writeTextFile: async ({ path: filePath, content }) => {
          await writeFile(filePath, content, 'utf8');
          return {};
        },
      }),
      stream
    );
    this.connection = connection;

    let initResult: Awaited<ReturnType<typeof connection.initialize>>;
    try {
      initResult = await Promise.race([
        this.runConnectionRequest(() =>
          connection.initialize({
            clientInfo: { name: 'haunting-souls', version: '0.1.0' },
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
          })
        ),
        startupFailure,
      ]);
    } catch (err) {
      this.child?.kill();
      this.child = null;
      this.connection = null;
      throw err;
    }

    void initResult;

    const sessionResult = await this.runConnectionRequest(() =>
      connection.newSession({
        cwd,
        mcpServers: (this.input.mcpServers ?? []).map((s) => ({ ...s, args: s.args ?? [], env: s.env ?? [] })),
      })
    );
    this.sessionId = sessionResult.sessionId;
  }

  /**
   * 处理来自 Agent 的 `sessionUpdate` 通知。
   *
   * 第一阶段只关心文本流；第二阶段开始把 tool call / tool result / thinking
   * 的原始更新标准化成统一的 AgentEvent。
   */
  private handleSessionUpdate(notification: SessionNotification): void {
    const update = notification.update as Record<string, unknown> & { sessionUpdate?: string };
    const updateType = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : 'unknown';

    switch (updateType) {
      case 'agent_message_chunk':
        this.handleAgentMessageChunk(update);
        return;
      case 'agent_thought_chunk':
      case 'thinking':
      case 'reasoning':
        this.handleThinkingUpdate();
        return;
      case 'tool_call':
      case 'agent_tool_call':
      case 'tool_call_started':
        this.handleToolCallUpdate(update);
        return;
      case 'tool_call_update':
      case 'tool_call_completed':
      case 'tool_call_result':
        this.handleToolResultUpdate(update);
        return;
      default:
        console.debug('[ACP sessionUpdate ignored]', updateType, update);
    }
  }

  private handleAgentMessageChunk(update: Record<string, unknown>): void {
    const content = update.content as { type?: unknown; text?: unknown } | undefined;
    const text = content?.type === 'text' ? String(content.text ?? '') : '';
    if (text && this.assistantMessage) {
      this.turnPhase = 'replying';
      this.hasReplyStarted = true;
      this.assistantMessage = {
        ...this.assistantMessage,
        content: this.assistantMessage.content + text,
      };
      this.emit('message', this.assistantMessage);
      this.emitAgentEvent({
        type: 'agent.reply.delta',
        messageId: this.assistantMessage.id,
        delta: text,
      });
    }
  }

  private handleThinkingUpdate(): void {
    if (this.turnPhase !== 'thinking') {
      this.turnPhase = 'thinking';
      this.emitAgentEvent({ type: 'agent.thinking' });
    }
  }

  private handleToolCallUpdate(update: Record<string, unknown>): void {
    const toolCallId = this.getToolCallId(update);
    const toolName = this.getToolName(update);
    const title = this.getToolTitle(update, toolName);
    const input = this.getToolInput(update);

    this.toolCalls.set(toolCallId, { toolName, title });
    this.turnPhase = 'tool_calling';
    this.emitAgentEvent({
      type: 'agent.tool.call',
      toolCallId,
      toolName,
      title,
      input,
    });
  }

  private handleToolResultUpdate(update: Record<string, unknown>): void {
    const toolCallId = this.getToolCallId(update);
    const known = this.toolCalls.get(toolCallId);
    const output = this.getToolOutput(update);
    const isError = this.getToolIsError(update);

    this.turnPhase = isError ? 'failed' : 'tool_calling';
    this.emitAgentEvent({
      type: 'agent.tool.result',
      toolCallId,
      toolName: known?.toolName ?? this.getToolName(update),
      output,
      isError,
    });

    if (isError) {
      this.emitAgentEvent({
        type: 'agent.error',
        source: 'tool',
        message: this.getToolErrorMessage(update),
        detail: update,
      });
    }
  }

  private getToolCallId(update: Record<string, unknown>): string {
    const candidate =
      update.toolCallId ??
      update.tool_call_id ??
      update.id ??
      update.callId ??
      update.call_id ??
      crypto.randomUUID();
    return String(candidate);
  }

  private getToolName(update: Record<string, unknown>): string {
    const candidate =
      update.toolName ??
      update.tool_name ??
      update.name ??
      update.title ??
      'unknown_tool';
    return String(candidate);
  }

  private getToolTitle(update: Record<string, unknown>, toolName: string): string {
    const candidate = update.title ?? toolName;
    return String(candidate);
  }

  private getToolInput(update: Record<string, unknown>): unknown {
    return update.rawInput ?? update.input ?? update.args ?? update.content ?? undefined;
  }

  private getToolOutput(update: Record<string, unknown>): unknown {
    return update.rawOutput ?? update.output ?? update.result ?? update.content ?? undefined;
  }

  private getToolIsError(update: Record<string, unknown>): boolean {
    const status = update.status;
    if (status === 'failed') return true;
    if (update.isError === true) return true;
    if (update.error != null) return true;
    return false;
  }

  private getToolErrorMessage(update: Record<string, unknown>): string {
    const error = update.error ?? update.rawOutput ?? update.output ?? update.result ?? 'Tool call failed';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    return JSON.stringify(error);
  }

  /**
   * 将 ACP SDK 的权限请求转换为应用层 `PermissionRequest`，
   * 挂起等待用户通过 `confirmPermission()` 作出选择。
   *
   * @returns 在用户确认后 resolve 的 Promise，供 SDK 层等待
   */
  private handlePermissionRequest(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const callId = params.toolCall?.toolCallId ?? crypto.randomUUID();

    const permissionRequest: PermissionRequest = {
      conversationId: this.input.conversationId,
      callId,
      title: params.toolCall?.title ?? 'Permission requested',
      body: params.toolCall?.rawInput != null ? JSON.stringify(params.toolCall.rawInput) : undefined,
      options: params.options.map((opt) => ({
        id: opt.optionId,
        label: opt.name,
      })),
    };
    this.turnPhase = 'waiting_permission';
    this.emitAgentEvent({
      type: 'agent.permission.request',
      callId,
      title: permissionRequest.title,
      body: permissionRequest.body,
      options: permissionRequest.options,
    });

    return new Promise<RequestPermissionResponse>((resolve) => {
      this.pendingPermissions.set(callId, resolve);
      this.emit('permission', permissionRequest);
    });
  }

  /**
   * 包装每一条 SDK 调用，追踪其 pending 状态。
   * 进程退出时，`rejectPendingRequests` 会统一 reject 所有未完成的请求，
   * 避免调用方永久挂起。
   */
  private runConnectionRequest<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = { settled: false, reject };
      this.pendingRequests.add(pending);

      const finish = (fn: () => void) => {
        if (pending.settled) return;
        pending.settled = true;
        this.pendingRequests.delete(pending);
        fn();
      };

      Promise.resolve()
        .then(run)
        .then(
          (value) => finish(() => resolve(value)),
          (error) => finish(() => reject(error))
        );
    });
  }

  /**
   * 将所有未 settled 的 pending 请求以给定错误 reject。
   * 在进程退出回调中调用，防止调用方挂起。
   */
  private rejectPendingRequests(error: unknown): void {
    for (const pending of this.pendingRequests) {
      if (pending.settled) continue;
      pending.settled = true;
      this.pendingRequests.delete(pending);
      pending.reject(error);
    }
  }

  private emitAgentEvent(event: AcpRuntimeAgentEventInput): void {
    if (!this.activeTurnId) return;
    this.emit('agentEvent', {
      id: crypto.randomUUID(),
      conversationId: this.input.conversationId,
      turnId: this.activeTurnId,
      at: Date.now(),
      ...event,
    } as AgentEvent);
  }
}
