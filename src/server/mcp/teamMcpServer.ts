import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentBackend, ConversationCommands, MailboxMessage, Team, TeamAgent, TeamTask } from '@shared/types';
import { createId } from '@server/id';
import { createLogger } from '@server/utils/logger';

/** stdio MCP 代理发往本地 TCP bridge 的请求载荷。 */
type TcpRequest = {
  authToken?: string;
  tool?: string;
  args?: Record<string, unknown>;
  fromSlotId?: string;
};

/** Agent 侧 stdio MCP 代理连接 Team TCP bridge 所需的启动配置。 */
export type StdioMcpConfig = {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
};

/** Team MCP bridge 调用 TeamService 所需的业务回调。 */
type TeamCallbacks = {
  addAgent: (input: { teamId: string; name: string; backend: AgentBackend; model?: string }) => Promise<TeamAgent>;
  taskCreate: (input: {
    teamId: string;
    title: string;
    description?: string;
    assignedSlotId?: string;
    createdBySlotId?: string;
  }) => Promise<TeamTask>;
  removeAgent: (input: { teamId: string; slotId: string }) => Promise<{ removed: true }>;
  finishTask: (input: { teamId: string; summary: string; taskId?: string; fromSlotId?: string }) => Promise<{
    finished: true;
  }>;
  sendMailboxMessage: (message: MailboxMessage) => Promise<void>;
  getCommands?: (conversationId: string) => ConversationCommands | null;
};

/**
 * 将 Team 操作暴露给各 Agent MCP stdio server 的本地 TCP bridge。
 *
 * 每个 Team 都会得到一个仅监听回环地址的 TCP server 和随机认证 token。
 * 代理进程通过 `teamMcpStdio.ts` 连接，并把 MCP tool call 转换成带长度前缀的 TCP 请求。
 */
export class TeamMcpServer {
  private readonly logger = createLogger('team.mcp');
  private server: net.Server | null = null;
  private port = 0;
  private readonly authToken = crypto.randomBytes(32).toString('base64url');

  constructor(
    private readonly teamId: string,
    private readonly getTeam: () => Team | null,
    private readonly callbacks: TeamCallbacks
  ) { }

  /**
   * 启动本地 TCP bridge，供 Team 内 Agent 的 MCP stdio 代理连接。
   */
  async start(): Promise<void> {
    if (this.server) return;
    this.server = net.createServer((socket) => this.handleSocket(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (address && typeof address === 'object') this.port = address.port;
        resolve();
      });
    });
  }

  /** 停止接收 MCP bridge 请求并释放端口。 */
  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
    this.port = 0;
  }

  /**
   * 为指定团队成员生成 stdio MCP server 的启动命令和环境变量。
   */
  getStdioConfig(slotId: string): StdioMcpConfig {
    const team = this.resolveTeam();
    const invocation = resolveTeamMcpStdioInvocation();
    const config = {
      name: `Haunting-things-team-${team.id}`,
      command: invocation.command,
      args: invocation.args,
      env: {
        TEAM_MCP_PORT: String(this.port),
        TEAM_MCP_TOKEN: this.authToken,
        TEAM_AGENT_SLOT_ID: slotId,
      },
    };
    this.logger.info('stdio_config', {
      teamId: team.id,
      slotId,
      name: config.name,
      command: config.command,
      args: config.args,
      env: {
        ...config.env,
        TEAM_MCP_TOKEN: `***${this.authToken.slice(-6)}`,
      },
    });
    return config;
  }

  /** 解析最新 Team 快照；若 Team 已删除则抛错。 */
  private resolveTeam(): Team {
    const team = this.getTeam();
    if (!team) throw new Error(`Team not found: ${this.teamId}`);
    return team;
  }

  /** 从单个 TCP socket 读取带长度前缀的 JSON 请求。 */
  private handleSocket(socket: net.Socket): void {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (buffer.length < length + 4) return;
        const body = buffer.subarray(4, 4 + length).toString('utf8');
        buffer = buffer.subarray(4 + length);
        void this.handleRequest(socket, body);
      }
    });
    socket.on('error', () => socket.destroy());
    socket.setTimeout(600_000, () => socket.destroy());
  }

  /** 认证并分发单条 TCP 请求。 */
  private async handleRequest(socket: net.Socket, body: string): Promise<void> {
    try {
      const request = JSON.parse(body) as TcpRequest;
      if (request.authToken !== this.authToken) throw new Error('Unauthorized');
      const result = await this.callTool(request.tool || '', request.args || {}, request.fromSlotId);
      writeTcpMessage(socket, { result });
    } catch (error) {
      writeTcpMessage(socket, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      socket.end();
    }
  }

  /** 将已校验的 MCP tool 名分发到对应 Team 操作。 */
  private async callTool(tool: string, args: Record<string, unknown>, fromSlotId?: string): Promise<string> {
    switch (tool) {
      case 'team_members':
        return this.resolveTeam().agents.map((agent) => this.formatAgent(agent)).join('\n');
      case 'team_send_message':
        return this.sendMessage(args, fromSlotId);
      case 'team_add_agent':
        return this.addAgent(args);
      case 'team_remove_agent':
        return this.removeAgent(args);
      case 'team_finish_task':
        return this.finishTask(args, fromSlotId);
      case 'team_delegate_task':
        return this.delegateTask(args, fromSlotId);
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  /** 将一个团队成员发给另一个成员的消息写入 mailbox 队列。 */
  private async sendMessage(args: Record<string, unknown>, fromSlotId?: string): Promise<string> {
    const team = this.resolveTeam();
    const to = String(args.to || '');
    const content = String(args.message || '');
    const target = this.resolveTarget(team, to);
    if (!target) throw new Error(`Teammate not found: ${to}`);

    const sender = fromSlotId
      ? team.agents.find((agent) => agent.slotId === fromSlotId)
      : team.agents.find((agent) => agent.role === 'leader') ?? team.agents[0];

    const message: MailboxMessage = {
      id: createId(),
      teamId: team.id,
      toAgentId: target.slotId,
      fromAgentId: sender?.slotId ?? team.leaderSlotId,
      content,
      summary: args.summary ? String(args.summary) : undefined,
      read: false,
      createdAt: Date.now(),
    };
    await this.callbacks.sendMailboxMessage(message);
    return `Message queued for ${target.name}`;
  }

  /** 处理 team_add_agent 工具调用并返回新成员摘要。 */
  private async addAgent(args: Record<string, unknown>): Promise<string> {
    const name = String(args.name || '').trim();
    const backend = String(args.backend || '').trim();
    if (!name) throw new Error('name is required');
    if (!backend) throw new Error('backend is required');

    const team = this.resolveTeam();
    const agent = await this.callbacks.addAgent({
      teamId: team.id,
      name,
      backend: parseAgentBackend(backend),
      model: parseOptionalModel(args),
    });
    return `Added teammate ${agent.name} (${agent.slotId})`;
  }

  /** 按名称或 slot id 移除已有 teammate。 */
  private async removeAgent(args: Record<string, unknown>): Promise<string> {
    const team = this.resolveTeam();
    const agentRef = String(args.agent || '').trim();
    if (!agentRef) throw new Error('agent is required');
    const target = this.resolveTarget(team, agentRef);
    if (!target) throw new Error(`Teammate not found: ${agentRef}`);
    await this.callbacks.removeAgent({ teamId: team.id, slotId: target.slotId });
    return `Removed teammate ${target.name}`;
  }

  /** 标记任务完成并通知 leader。 */
  private async finishTask(args: Record<string, unknown>, fromSlotId?: string): Promise<string> {
    const team = this.resolveTeam();
    const summary = String(args.summary || '').trim();
    if (!summary) throw new Error('summary is required');
    const taskId = args.task_id ? String(args.task_id).trim() : undefined;
    await this.callbacks.finishTask({ teamId: team.id, summary, taskId, fromSlotId });
    return taskId ? `Task ${taskId} marked finished` : 'Task marked finished';
  }

  /** 创建或复用 teammate，创建任务并发送分配消息。 */
  private async delegateTask(args: Record<string, unknown>, fromSlotId?: string): Promise<string> {
    const team = this.resolveTeam();
    const backend = parseAgentBackend(args.backend);
    const taskBody = String(args.task || '').trim();
    const summary = args.summary ? String(args.summary).trim() : '';
    const name = String(args.name || '').trim();
    const model = parseOptionalModel(args);
    if (!taskBody) throw new Error('task is required');

    let target =
      team.agents.find(
        (agent) =>
          agent.role === 'teammate' &&
          agent.backend === backend &&
          (!model || agent.model === model)
      ) ?? null;
    let createdAgent = false;
    if (!target) {
      target = await this.callbacks.addAgent({
        teamId: team.id,
        name: name || defaultDelegateName(backend),
        backend,
        model,
      });
      createdAgent = true;
    }

    const task = await this.callbacks.taskCreate({
      teamId: team.id,
      title: summary || taskBody,
      description: taskBody,
      assignedSlotId: target.slotId,
      createdBySlotId: fromSlotId,
    });
    const sender = fromSlotId
      ? team.agents.find((agent) => agent.slotId === fromSlotId)
      : team.agents.find((agent) => agent.role === 'leader') ?? team.agents[0];
    const message: MailboxMessage = {
      id: createId(),
      teamId: team.id,
      toAgentId: target.slotId,
      fromAgentId: sender?.slotId ?? team.leaderSlotId,
      content: [`Task: ${summary || taskBody}`, taskBody, `Task ID: ${task.id}`].join('\n\n'),
      summary: summary || taskBody,
      read: false,
      createdAt: Date.now(),
    };
    await this.callbacks.sendMailboxMessage(message);
    return createdAgent
      ? `Delegated task to ${target.name} (${target.slotId}). The teammate has been started if it did not already exist.`
      : `Delegated task to ${target.name} (${target.slotId}).`;
  }

  /** 根据展示名称或稳定 slot id 解析 teammate。 */
  private resolveTarget(team: Team, nameOrSlotId: string): TeamAgent | null {
    const normalized = nameOrSlotId.trim().toLowerCase();
    return (
      team.agents.find(
        (agent) => agent.slotId === nameOrSlotId || agent.name.trim().toLowerCase() === normalized
      ) ?? null
    );
  }

  /** 将单个 teammate 格式化为 `team_members` MCP tool 的响应文本。 */
  private formatAgent(agent: TeamAgent): string {
    const modelPart = agent.model ? `, model=${agent.model}` : '';
    const commands = this.callbacks.getCommands?.(agent.conversationId);
    const commandNames = commands?.commands.slice(0, 8).map((command) => command.name).join(', ');
    const commandsPart = commandNames ? `, commands=${commandNames}` : '';
    return `- ${agent.name} (${agent.role}, ${agent.backend}${modelPart}, ${agent.status}${commandsPart})`;
  }
}

/** 从 MCP tool 参数中解析可选 model id。 */
function parseOptionalModel(args: Record<string, unknown>): string | undefined {
  const model = typeof args.model === 'string' ? args.model.trim() : '';
  return model || undefined;
}

/** 校验外部 MCP tool call 传入的 backend 字符串。 */
function parseAgentBackend(value: unknown): AgentBackend {
  if (value === 'claude' || value === 'codex') return value;
  throw new Error('backend must be exactly "claude" or "codex"');
}

/** 当 delegate 调用未提供名称时选择可读的 teammate 名。 */
function defaultDelegateName(backend: AgentBackend): string {
  return backend === 'claude' ? 'Claude Code' : 'Codex Agent';
}

/** 向 TCP socket 写入一条带长度前缀的 JSON payload。 */
function writeTcpMessage(socket: net.Socket, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
}

/** 为源码模式（`tsx`）和构建模式（`node`）解析 stdio MCP launcher。 */
export function resolveTeamMcpStdioInvocation(currentModuleUrl: string = import.meta.url): {
  command: string;
  args: string[];
} {
  const current = fileURLToPath(currentModuleUrl);
  const isBuilt = current.includes(`${path.sep}dist-server${path.sep}`);
  if (isBuilt) {
    return {
      command: 'node',
      args: [path.join(path.dirname(current), 'teamMcpStdio.js')],
    };
  }
  return {
    command: process.execPath,
    args: ['--import', 'tsx', path.join(path.dirname(current), 'teamMcpStdio.ts')],
  };
}
