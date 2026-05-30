import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { AgentBackend, ChatMessage, Conversation } from '../shared/types';
import type { Repository } from './db';
import type { EventBus } from './events';
import { AcpRuntime } from './acpRuntime';

export class ConversationService {
  private readonly runtimes = new Map<string, AcpRuntime>();
  private readonly mcpServers = new Map<string, any[]>();

  constructor(
    private readonly repo: Repository,
    private readonly events: EventBus,
    private readonly dataDir: string
  ) {}

  create(input: { backend: AgentBackend; workspace?: string; name?: string; mcpServers?: any[] }): Conversation {
    const now = Date.now();
    const workspace = input.workspace?.trim() || path.join(this.dataDir, 'workspaces', crypto.randomUUID());
    mkdirSync(workspace, { recursive: true });
    const conversation = this.repo.createConversation({
      id: crypto.randomUUID(),
      backend: input.backend,
      name: input.name || `${input.backend} conversation`,
      workspace,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    });
    if (input.mcpServers) this.mcpServers.set(conversation.id, input.mcpServers);
    return conversation;
  }

  setMcpServers(conversationId: string, mcpServers: any[]): void {
    this.mcpServers.set(conversationId, mcpServers);
  }

  list(): Conversation[] {
    return this.repo.listConversations();
  }

  messages(conversationId: string): ChatMessage[] {
    return this.repo.listMessages(conversationId);
  }

  async sendMessage(input: { conversationId: string; content: string; files?: string[] }): Promise<void> {
    const conversation = this.repo.getConversation(input.conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${input.conversationId}`);

    const userMessage = this.repo.addMessage({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: 'user',
      content: input.content,
      createdAt: Date.now(),
      status: 'done',
    });
    this.events.emit('conversation.stream', { conversationId: conversation.id, message: userMessage });

    const runtime = this.getRuntime(conversation);
    await runtime.send(input.content);
  }

  confirmPermission(input: { conversationId: string; callId: string; optionId: string }): void {
    this.runtimes.get(input.conversationId)?.confirmPermission(input.callId, input.optionId);
  }

  stop(conversationId: string): void {
    this.runtimes.get(conversationId)?.stop();
    this.runtimes.delete(conversationId);
  }

  private getRuntime(conversation: Conversation): AcpRuntime {
    const existing = this.runtimes.get(conversation.id);
    if (existing) return existing;

    const runtime = new AcpRuntime({
      conversationId: conversation.id,
      backend: conversation.backend,
      workspace: conversation.workspace,
      mcpServers: this.mcpServers.get(conversation.id),
    });
    runtime.on('message', (message) => {
      const known = this.repo.listMessages(message.conversationId).some((item) => item.id === message.id);
      if (known) this.repo.updateMessage(message);
      else this.repo.addMessage(message);
      this.events.emit('conversation.stream', { conversationId: conversation.id, message });
    });
    runtime.on('permission', (request) => this.events.emit('conversation.permission', request));
    runtime.on('status', (status, error) => {
      this.repo.updateConversationStatus(conversation.id, status);
      this.events.emit('conversation.status', { conversationId: conversation.id, status, error });
    });
    runtime.on('finish', (status) => this.events.emit('conversation.finish', { conversationId: conversation.id, status }));
    this.runtimes.set(conversation.id, runtime);
    return runtime;
  }
}
