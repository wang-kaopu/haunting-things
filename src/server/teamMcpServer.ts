import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Repository } from './db';
import type { MailboxMessage, Team, TeamAgent } from '../shared/types';

type TcpRequest = {
  authToken?: string;
  tool?: string;
  args?: Record<string, unknown>;
  fromSlotId?: string;
};

export type StdioMcpConfig = {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
};

export class TeamMcpServer {
  private server: net.Server | null = null;
  private port = 0;
  private readonly authToken = crypto.randomUUID();

  constructor(
    private readonly team: Team,
    private readonly repo: Repository,
    private readonly wakeAgent: (slotId: string) => Promise<void>
  ) {}

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

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
    this.port = 0;
  }

  getStdioConfig(slotId: string): StdioMcpConfig {
    return {
      name: `haunting-souls-team-${this.team.id}`,
      command: 'node',
      args: [resolveTeamMcpStdioPath()],
      env: {
        TEAM_MCP_PORT: String(this.port),
        TEAM_MCP_TOKEN: this.authToken,
        TEAM_AGENT_SLOT_ID: slotId,
      },
    };
  }

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

  private async callTool(tool: string, args: Record<string, unknown>, fromSlotId?: string): Promise<string> {
    switch (tool) {
      case 'team_members':
        return this.team.agents.map(formatAgent).join('\n');
      case 'team_send_message':
        return this.sendMessage(args, fromSlotId);
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private async sendMessage(args: Record<string, unknown>, fromSlotId?: string): Promise<string> {
    const to = String(args.to || '');
    const content = String(args.message || '');
    const target = this.resolveTarget(to);
    if (!target) throw new Error(`Teammate not found: ${to}`);
    const message: MailboxMessage = {
      id: crypto.randomUUID(),
      teamId: this.team.id,
      toAgentId: target.slotId,
      fromAgentId: fromSlotId || this.team.leaderSlotId,
      content,
      summary: args.summary ? String(args.summary) : undefined,
      read: false,
      createdAt: Date.now(),
    };
    this.repo.writeMailbox(message);
    await this.wakeAgent(target.slotId);
    return `Message sent to ${target.name}`;
  }

  private resolveTarget(nameOrSlotId: string): TeamAgent | null {
    const normalized = nameOrSlotId.trim().toLowerCase();
    return (
      this.team.agents.find(
        (agent) => agent.slotId === nameOrSlotId || agent.name.trim().toLowerCase() === normalized
      ) ?? null
    );
  }
}

function formatAgent(agent: TeamAgent): string {
  return `- ${agent.name} (${agent.role}, ${agent.backend}, ${agent.status})`;
}

function writeTcpMessage(socket: net.Socket, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
}

function resolveTeamMcpStdioPath(): string {
  const current = fileURLToPath(import.meta.url);
  const built = path.join(path.dirname(current), 'teamMcpStdio.js');
  return built;
}
