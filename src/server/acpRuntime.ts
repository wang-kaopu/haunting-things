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
  AcpAvailableCommand,
  AcpModelInfo,
  AgentTurnPhase,
  ChatMessage,
  ConversationStatus,
  ConversationCommands,
  ConversationModels,
  ConversationMode,
  ConversationUsage,
  PermissionRequest,
} from '../shared/types';
import { getBridgePackageVersioned } from './agentRegistry';
import { ndjsonFromChildProcess } from './ndjsonTransport';

type AcpRuntimeEvents = {
  message: [ChatMessage];
  agentEvent: [AgentEvent];
  usage: [ConversationUsage];
  commands: [ConversationCommands];
  models: [ConversationModels];
  mode: [ConversationMode];
  permission: [PermissionRequest];
  status: [ConversationStatus, string?];
  finish: [ConversationStatus];
};

type AcpRuntimeAgentEventInput =
  | { type: 'agent.turn.started'; backend: AgentBackend }
  | { type: 'agent.thinking' }
  | { type: 'agent.plan'; entries: string[]; raw?: unknown }
  | { type: 'agent.reply.delta'; messageId: string; delta: string }
  | { type: 'agent.reply.done'; messageId: string; content: string }
  | {
      type: 'agent.tool.call';
      toolCallId: string;
      toolName: string;
      title?: string;
      kind?: string;
      status?: string;
      input?: unknown;
      raw?: unknown;
    }
  | {
      type: 'agent.tool.update';
      toolCallId: string;
      toolName?: string;
      title?: string;
      kind?: string;
      status?: string;
      content?: unknown;
      raw?: unknown;
    }
  | {
      type: 'agent.tool.result';
      toolCallId: string;
      toolName?: string;
      title?: string;
      kind?: string;
      status?: string;
      output?: unknown;
      isError?: boolean;
      raw?: unknown;
    }
  | {
      type: 'agent.permission.request';
      callId: string;
      title: string;
      body?: string;
      options: PermissionRequest['options'];
      toolCall?: unknown;
      rawInput?: unknown;
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
  private usageSnapshot: ConversationUsage | null = null;
  private lastUsageEmitAt = 0;
  private availableCommandsSnapshot: ConversationCommands | null = null;
  private modelsSnapshot: ConversationModels | null = null;
  private modeSnapshot: ConversationMode | null = null;
  private readonly toolCalls = new Map<string, { toolName: string; title?: string; kind?: string }>();

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
      model?: string;
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

  getUsageSnapshot(): ConversationUsage | null {
    return this.usageSnapshot;
  }

  getAvailableCommandsSnapshot(): ConversationCommands | null {
    return this.availableCommandsSnapshot;
  }

  getModelsSnapshot(): ConversationModels | null {
    return this.modelsSnapshot;
  }

  getModeSnapshot(): ConversationMode | null {
    return this.modeSnapshot;
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
    this.handleNewSessionModels(sessionResult);
    if (this.input.model?.trim()) {
      await this.setSessionModel(this.input.model.trim());
    }
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
      case 'plan':
        this.handlePlanUpdate(update);
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
        this.handleToolCallProgressUpdate(update);
        return;
      case 'usage_update':
        this.handleUsageUpdate(update);
        return;
      case 'available_commands_update':
        this.handleAvailableCommandsUpdate(update);
        return;
      case 'current_mode_update':
        this.handleCurrentModeUpdate(update);
        return;
      case 'config_option_update':
        this.handleConfigOptionUpdate(update);
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

  private handlePlanUpdate(update: Record<string, unknown>): void {
    const entries = this.extractPlanEntries(update);
    this.turnPhase = 'planning';
    this.emitAgentEvent({
      type: 'agent.plan',
      entries,
      raw: update,
    });
  }

  private handleToolCallUpdate(update: Record<string, unknown>): void {
    const toolCallId = this.readToolCallId(update);
    const title = this.readToolTitle(update);
    const kind = this.readToolKind(update);
    const status = this.readToolStatus(update);
    const toolName =
      this.readString(update.toolName) ??
      this.readString(update.tool_name) ??
      this.readString(update.name) ??
      kind ??
      title ??
      'unknown_tool';
    const input = update.input ?? update.rawInput ?? update.args ?? update.content;

    this.toolCalls.set(toolCallId, { toolName, title, kind });
    this.turnPhase = 'tool_calling';
    this.emitAgentEvent({
      type: 'agent.tool.call',
      toolCallId,
      toolName,
      title,
      kind,
      status,
      input,
      raw: update,
    });
  }

  private handleToolCallProgressUpdate(update: Record<string, unknown>): void {
    if (this.isCompletedToolUpdate(update)) {
      this.emitToolResult(update, false);
      return;
    }

    if (this.isFailedToolUpdate(update)) {
      this.emitToolResult(update, true);
      this.emitAgentEvent({
        type: 'agent.error',
        source: 'tool',
        message: this.extractToolErrorMessage(update),
        detail: update,
      });
      return;
    }

    const toolCallId = this.readToolCallId(update);
    const known = this.toolCalls.get(toolCallId);

    this.turnPhase = 'tool_calling';
    this.emitAgentEvent({
      type: 'agent.tool.update',
      toolCallId,
      toolName:
        this.readString(update.toolName) ??
        this.readString(update.tool_name) ??
        this.readString(update.name) ??
        known?.toolName,
      title: this.readToolTitle(update) ?? known?.title,
      kind: this.readToolKind(update) ?? known?.kind,
      status: this.readToolStatus(update),
      content: update.content ?? update.output ?? update.result,
      raw: update,
    });
  }

  private emitToolResult(update: Record<string, unknown>, isError: boolean): void {
    const toolCallId = this.readToolCallId(update);
    const known = this.toolCalls.get(toolCallId);
    const toolName =
      this.readString(update.toolName) ??
      this.readString(update.tool_name) ??
      this.readString(update.name) ??
      known?.toolName;

    this.turnPhase = isError ? 'failed' : 'tool_calling';
    this.emitAgentEvent({
      type: 'agent.tool.result',
      toolCallId,
      toolName,
      title: this.readToolTitle(update) ?? known?.title,
      kind: this.readToolKind(update) ?? known?.kind,
      status: this.readToolStatus(update),
      output: update.output ?? update.result ?? update.content,
      isError,
      raw: update,
    });

    if (isError) {
      this.emitAgentEvent({ type: 'agent.error', source: 'tool', message: this.extractToolErrorMessage(update), detail: update });
    }
  }

  private readToolCallId(update: Record<string, unknown>): string {
    const candidate =
      update.toolCallId ??
      update.tool_call_id ??
      update.id ??
      update.callId ??
      update.call_id ??
      crypto.randomUUID();
    return String(candidate);
  }

  private readToolTitle(update: Record<string, unknown>): string | undefined {
    return (
      this.readString(update.title) ??
      this.readString(update.name) ??
      this.readString(update.toolName) ??
      this.readString(update.tool_name) ??
      this.readString(update.kind)
    );
  }

  private readToolKind(update: Record<string, unknown>): string | undefined {
    return this.readString(update.kind) ?? this.readString(update.toolKind);
  }

  private readToolStatus(update: Record<string, unknown>): string | undefined {
    return this.readString(update.status)?.toLowerCase();
  }

  private isCompletedToolUpdate(update: Record<string, unknown>): boolean {
    const status = this.readToolStatus(update);
    return (
      status === 'completed' ||
      status === 'complete' ||
      status === 'succeeded' ||
      status === 'success' ||
      status === 'done' ||
      update.done === true
    );
  }

  private isFailedToolUpdate(update: Record<string, unknown>): boolean {
    const status = update.status;
    const normalized = this.readToolStatus(update);
    if (normalized === 'failed') return true;
    if (normalized === 'error') return true;
    if (normalized === 'errored') return true;
    if (normalized === 'cancelled') return true;
    if (normalized === 'canceled') return true;
    if (status === 'failed') return true;
    if (update.isError === true) return true;
    if (update.error != null) return true;
    return false;
  }

  private extractToolErrorMessage(update: Record<string, unknown>): string {
    const error = update.error ?? update.rawOutput ?? update.output ?? update.result ?? 'Tool call failed';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object') {
      const raw = error as Record<string, unknown>;
      if (typeof raw.message === 'string') return raw.message;
    }
    const title = this.readToolTitle(update);
    if (title) return `Tool failed: ${title}`;
    return JSON.stringify(error);
  }

  private handleCurrentModeUpdate(update: Record<string, unknown>): void {
    const mode =
      this.readString(update.mode) ??
      this.readString(update.currentMode) ??
      this.readString(update.current_mode) ??
      this.readString(update.name);

    if (!mode) return;

    const snapshot: ConversationMode = {
      conversationId: this.input.conversationId,
      mode,
      updatedAt: Date.now(),
    };

    this.modeSnapshot = snapshot;
    this.emit('mode', snapshot);
  }

  private handleConfigOptionUpdate(update: Record<string, unknown>): void {
    const configId =
      this.readString(update.configId) ??
      this.readString(update.config_id) ??
      this.readString(update.id) ??
      this.readString(update.name);

    if (configId !== 'model') return;

    const modelId =
      this.readString(update.value) ??
      this.readString(update.modelId) ??
      this.readString(update.model_id) ??
      this.readString(update.currentModelId);

    if (!modelId) return;

    const previous = this.modelsSnapshot;
    const snapshot: ConversationModels = {
      conversationId: this.input.conversationId,
      currentModelId: modelId,
      models: previous?.models ?? [],
      updatedAt: Date.now(),
    };

    this.modelsSnapshot = snapshot;
    this.emit('models', snapshot);
  }

  private extractPlanEntries(update: Record<string, unknown>): string[] {
    const entries: string[] = [];
    const push = (value: unknown): void => {
      const text = this.planEntryToText(value);
      if (text) entries.push(text);
    };

    if (Array.isArray(update.entries)) {
      update.entries.forEach(push);
    } else if (Array.isArray(update.steps)) {
      update.steps.forEach(push);
    } else if (Array.isArray(update.plan)) {
      update.plan.forEach(push);
    } else {
      push(update.content);
      push(update.text);
      push(update.message);
    }

    return entries;
  }

  private planEntryToText(item: unknown): string {
    if (typeof item === 'string') return item.trim();

    if (item && typeof item === 'object') {
      const raw = item as Record<string, unknown>;
      const text =
        this.readString(raw.text) ??
        this.readString(raw.content) ??
        this.readString(raw.title) ??
        this.readString(raw.label) ??
        this.readString(raw.name);
      if (text) return text;
    }

    return '';
  }

  private handleUsageUpdate(update: Record<string, unknown>): void {
    const size = this.readUsageNumber(update.size);
    const used = this.readUsageNumber(update.used);

    if (size == null || used == null || size <= 0) {
      return;
    }

    const now = Date.now();
    const snapshot: ConversationUsage = {
      conversationId: this.input.conversationId,
      size,
      used,
      ratio: used / size,
      updatedAt: now,
    };

    this.usageSnapshot = snapshot;
    if (now - this.lastUsageEmitAt < 1000) {
      return;
    }

    this.lastUsageEmitAt = now;
    this.emit('usage', snapshot);
  }

  private readUsageNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private handleAvailableCommandsUpdate(update: Record<string, unknown>): void {
    const rawCommands = Array.isArray(update.availableCommands) ? update.availableCommands : [];

    const commands = rawCommands
      .map((item): AcpAvailableCommand | null => {
        if (!item || typeof item !== 'object') return null;

        const raw = item as Record<string, unknown>;
        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        if (!name) return null;

        return {
          name,
          description: typeof raw.description === 'string' ? raw.description : undefined,
          input: raw.input ?? null,
        };
      })
      .filter((item): item is AcpAvailableCommand => item !== null);

    const snapshot: ConversationCommands = {
      conversationId: this.input.conversationId,
      commands,
      updatedAt: Date.now(),
    };

    this.availableCommandsSnapshot = snapshot;
    this.emit('commands', snapshot);
  }

  private handleNewSessionModels(sessionResult: unknown): void {
    const raw = sessionResult as Record<string, unknown> | null;
    const modelsState = raw?.models;
    if (modelsState == null) return;

    let rawModels: unknown[] = [];
    let currentModelId: string | undefined;

    if (Array.isArray(modelsState)) {
      rawModels = modelsState;
    } else if (modelsState && typeof modelsState === 'object') {
      const state = modelsState as Record<string, unknown>;
      rawModels = Array.isArray(state.availableModels) ? state.availableModels : [];
      currentModelId = this.readString(state.currentModelId) ?? this.readString(state.modelId);
    } else {
      return;
    }

    const models = rawModels
      .map((item): AcpModelInfo | null => {
        if (!item || typeof item !== 'object') return null;
        const rawModel = item as Record<string, unknown>;
        const id = this.readString(rawModel.id) ?? this.readString(rawModel.modelId);
        if (!id) return null;
        return {
          id,
          name: this.readString(rawModel.name) ?? this.readString(rawModel.label),
          description: this.readString(rawModel.description),
        };
      })
      .filter((item): item is AcpModelInfo => item !== null);

    const snapshot: ConversationModels = {
      conversationId: this.input.conversationId,
      currentModelId: currentModelId ?? this.input.model?.trim() ?? undefined,
      models,
      updatedAt: Date.now(),
    };

    this.modelsSnapshot = snapshot;
    this.emit('models', snapshot);
  }

  private async setSessionModel(modelId: string): Promise<void> {
    if (!this.connection || !this.sessionId) return;

    const connection = this.connection as ClientSideConnection & {
      unstable_setSessionModel?: (params: { sessionId: string; modelId: string }) => Promise<unknown>;
    };

    if (typeof connection.unstable_setSessionModel !== 'function') {
      console.warn(`[ACP ${this.input.backend}] session model selection is not supported`);
      return;
    }

    await this.runConnectionRequest(() =>
      connection.unstable_setSessionModel!({
        sessionId: this.sessionId!,
        modelId,
      })
    );

    const snapshot: ConversationModels = {
      conversationId: this.input.conversationId,
      currentModelId: modelId,
      models: this.modelsSnapshot?.models ?? [],
      updatedAt: Date.now(),
    };

    this.modelsSnapshot = snapshot;
    this.emit('models', snapshot);
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
      body: params.toolCall?.rawInput != null ? JSON.stringify(params.toolCall.rawInput, null, 2) : undefined,
      options: params.options.map((opt) => ({
        id: opt.optionId,
        label: opt.name,
      })),
      toolCall: params.toolCall,
      rawInput: params.toolCall?.rawInput,
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
