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
import type { AgentBackend, ChatMessage, ConversationStatus, PermissionRequest } from '../shared/types';
import { getBridgePackageVersioned } from './agentRegistry';
import { ndjsonFromChildProcess } from './ndjsonTransport';

type AcpRuntimeEvents = {
  message: [ChatMessage];
  permission: [PermissionRequest];
  status: [ConversationStatus, string?];
  finish: [ConversationStatus];
};

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
    this.emit('status', 'running');

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
      if (this.assistantMessage) {
        this.assistantMessage = { ...this.assistantMessage, status: 'error' };
        this.emit('message', this.assistantMessage);
      }
      this.emit('status', 'failed', err instanceof Error ? err.message : String(err));
      this.emit('finish', 'failed');
      return;
    } finally {
      this.activePrompt = false;
    }

    if (this.assistantMessage) {
      this.assistantMessage = { ...this.assistantMessage, status: 'done' };
      this.emit('message', this.assistantMessage);
    }
    this.emit('status', 'idle');
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
   * 当前仅处理 `agent_message_chunk`（文本流），将文本累加到
   * `assistantMessage` 并触发 `message` 事件。其他更新类型（tool_call、
   * config updates 等）在 v1 中暂时忽略。
   */
  private handleSessionUpdate(notification: SessionNotification): void {
    const update = notification.update;
    const updateType = update.sessionUpdate;

    if (updateType === 'agent_message_chunk') {
      const chunk = update as { sessionUpdate: string; content?: { type: string; text?: string }; messageId?: string };
      const text = chunk.content?.type === 'text' ? (chunk.content.text ?? '') : '';
      if (text && this.assistantMessage) {
        this.assistantMessage = {
          ...this.assistantMessage,
          content: this.assistantMessage.content + text,
        };
        this.emit('message', this.assistantMessage);
      }
    }
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
}
