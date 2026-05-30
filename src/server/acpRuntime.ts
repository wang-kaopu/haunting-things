import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { AgentBackend, ChatMessage, ConversationStatus, PermissionRequest } from '../shared/types';
import { getBridgePackage } from './agentRegistry';

type AcpRuntimeEvents = {
  message: [ChatMessage];
  permission: [PermissionRequest];
  status: [ConversationStatus, string?];
  finish: [ConversationStatus];
};

type JsonRpcMessage = {
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
};

export class AcpRuntime extends EventEmitter<AcpRuntimeEvents> {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private sessionId: string | null = null;
  private nextId = 1;
  private assistantMessage: ChatMessage | null = null;

  constructor(
    private readonly input: {
      conversationId: string;
      backend: AgentBackend;
      workspace: string;
      mcpServers?: Array<{ name: string; command: string; args: string[]; env?: Record<string, string> }>;
    }
  ) {
    super();
  }

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

    await this.request('session/prompt', {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text: content }],
    });
  }

  confirmPermission(callId: string, optionId: string): void {
    void this.request('session/permission_response', { sessionId: this.sessionId, callId, optionId }).catch((error) => {
      this.emit('status', 'failed', error instanceof Error ? error.message : String(error));
    });
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
    this.emit('status', 'stopped');
  }

  private async ensureStarted(): Promise<void> {
    if (this.child) return;

    const bridgePackage = getBridgePackage(this.input.backend);
    this.child = spawn('npx', ['-y', bridgePackage], {
      cwd: this.input.workspace || process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout.on('data', (chunk) => this.onStdout(chunk.toString()));
    this.child.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.warn(`[ACP ${this.input.backend}] ${text}`);
    });
    this.child.on('exit', (code, signal) => {
      this.child = null;
      const status = code === 0 || signal === 'SIGTERM' ? 'stopped' : 'failed';
      this.emit('status', status, code === 0 ? undefined : `ACP exited with code ${code ?? signal}`);
      this.emit('finish', status);
    });

    await this.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'haunting-souls', version: '0.1.0' },
      clientCapabilities: {},
    });

    const session = await this.request('session/new', {
      cwd: path.resolve(this.input.workspace || process.cwd()),
      mcpServers: this.input.mcpServers ?? [],
    });
    this.sessionId = session?.sessionId ?? session?.id ?? crypto.randomUUID();
  }

  private async request(method: string, params: any): Promise<any> {
    if (!this.child) throw new Error('ACP process not started');
    const id = this.nextId++;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    this.child.stdin.write(`${message}\n`);
    return undefined;
  }

  private onStdout(text: string): void {
    this.buffer += text;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) this.handleMessage(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleMessage(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    const params = message.params ?? message.result ?? {};
    const method = message.method ?? '';
    const text = extractText(params);
    if (text && this.assistantMessage) {
      this.assistantMessage = {
        ...this.assistantMessage,
        content: this.assistantMessage.content + text,
      };
      this.emit('message', this.assistantMessage);
    }

    if (method.includes('permission') || params.options) {
      this.emit('permission', {
        conversationId: this.input.conversationId,
        callId: String(params.callId ?? params.id ?? crypto.randomUUID()),
        title: String(params.title ?? 'Permission requested'),
        body: params.body ? String(params.body) : undefined,
        options: Array.isArray(params.options)
          ? params.options.map((option: any) => ({
              id: String(option.id),
              label: String(option.label ?? option.name ?? option.id),
              description: option.description ? String(option.description) : undefined,
            }))
          : [
              { id: 'allow', label: 'Allow' },
              { id: 'deny', label: 'Deny' },
            ],
      });
    }

    if (method.includes('finish') || params.stopReason || params.finished) {
      if (this.assistantMessage) {
        this.assistantMessage = { ...this.assistantMessage, status: 'done' };
        this.emit('message', this.assistantMessage);
      }
      this.emit('status', 'idle');
      this.emit('finish', 'idle');
    }
  }
}

function extractText(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.content)) return value.content.map(extractText).join('');
  if (typeof value.delta === 'string') return value.delta;
  if (value.delta) return extractText(value.delta);
  return '';
}
