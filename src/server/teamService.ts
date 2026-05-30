import type { AgentBackend, MailboxMessage, Team, TeamAgent } from '../shared/types';
import type { Repository } from './db';
import type { ConversationService } from './conversations';
import type { EventBus } from './events';
import { TeamMcpServer } from './teamMcpServer';

type TeamSession = {
  team: Team;
  mcpServer: TeamMcpServer;
};

export class TeamService {
  private readonly sessions = new Map<string, TeamSession>();

  constructor(
    private readonly repo: Repository,
    private readonly conversations: ConversationService,
    private readonly events: EventBus
  ) {}

  async create(input: { name: string; workspace?: string; leaderBackend: AgentBackend }): Promise<Team> {
    const leaderConversation = this.conversations.create({
      backend: input.leaderBackend,
      workspace: input.workspace,
      name: `${input.name} - Leader`,
    });
    const leader: TeamAgent = {
      slotId: `slot-${crypto.randomUUID().slice(0, 8)}`,
      conversationId: leaderConversation.id,
      role: 'leader',
      backend: input.leaderBackend,
      name: 'Leader',
      status: 'idle',
    };
    const now = Date.now();
    const team = this.repo.createTeam({
      id: crypto.randomUUID(),
      name: input.name,
      workspace: leaderConversation.workspace,
      leaderSlotId: leader.slotId,
      agents: [leader],
      createdAt: now,
      updatedAt: now,
    });
    await this.ensureSession(team.id);
    return team;
  }

  list(): Team[] {
    return this.repo.listTeams();
  }

  get(teamId: string): Team | null {
    return this.repo.getTeam(teamId);
  }

  async addAgent(input: { teamId: string; name: string; backend: AgentBackend }): Promise<TeamAgent> {
    const team = this.requireTeam(input.teamId);
    const conversation = this.conversations.create({
      backend: input.backend,
      workspace: team.workspace,
      name: `${team.name} - ${input.name}`,
    });
    const agent: TeamAgent = {
      slotId: `slot-${crypto.randomUUID().slice(0, 8)}`,
      conversationId: conversation.id,
      role: 'teammate',
      backend: input.backend,
      name: input.name,
      status: 'idle',
    };
    const updated = { ...team, agents: [...team.agents, agent], updatedAt: Date.now() };
    this.repo.updateTeam(updated);
    await this.restartSession(updated);
    this.events.emit('team.agent.added', { teamId: updated.id, agent });
    return agent;
  }

  async sendMessage(input: { teamId: string; content: string; files?: string[] }): Promise<void> {
    const team = this.requireTeam(input.teamId);
    await this.deliver({
      teamId: team.id,
      toAgentId: team.leaderSlotId,
      fromAgentId: 'user',
      content: input.content,
      read: false,
      createdAt: Date.now(),
      id: crypto.randomUUID(),
    });
  }

  async sendMessageToAgent(input: { teamId: string; slotId: string; content: string; files?: string[] }): Promise<void> {
    const team = this.requireTeam(input.teamId);
    if (!team.agents.some((agent) => agent.slotId === input.slotId)) {
      throw new Error(`Agent not found: ${input.slotId}`);
    }
    await this.deliver({
      teamId: team.id,
      toAgentId: input.slotId,
      fromAgentId: 'user',
      content: input.content,
      read: false,
      createdAt: Date.now(),
      id: crypto.randomUUID(),
    });
  }

  async stop(teamId: string): Promise<void> {
    const session = this.sessions.get(teamId);
    if (session) {
      await session.mcpServer.stop();
      this.sessions.delete(teamId);
    }
    const team = this.repo.getTeam(teamId);
    if (team) {
      for (const agent of team.agents) {
        this.conversations.stop(agent.conversationId);
      }
    }
  }

  private async deliver(message: MailboxMessage): Promise<void> {
    this.repo.writeMailbox(message);
    await this.wakeAgent(message.teamId, message.toAgentId);
  }

  private async wakeAgent(teamId: string, slotId: string): Promise<void> {
    const team = this.requireTeam(teamId);
    const agent = team.agents.find((item) => item.slotId === slotId);
    if (!agent) throw new Error(`Agent not found: ${slotId}`);
    this.events.emit('team.agent.status', { teamId, slotId, status: 'active' });
    const messages = this.repo.readUnreadAndMark(teamId, slotId);
    const content = formatMailbox(messages, team);
    try {
      await this.conversations.sendMessage({ conversationId: agent.conversationId, content });
      this.events.emit('team.turn.finished', { teamId, slotId });
      this.events.emit('team.agent.status', { teamId, slotId, status: 'idle' });
    } catch (error) {
      this.events.emit('team.agent.status', {
        teamId,
        slotId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async ensureSession(teamId: string): Promise<TeamSession> {
    const existing = this.sessions.get(teamId);
    if (existing) return existing;
    const team = this.requireTeam(teamId);
    return this.restartSession(team);
  }

  private async restartSession(team: Team): Promise<TeamSession> {
    await this.sessions.get(team.id)?.mcpServer.stop();
    const mcpServer = new TeamMcpServer(team, this.repo, (slotId) => this.wakeAgent(team.id, slotId));
    await mcpServer.start();
    for (const agent of team.agents) {
      this.conversations.setMcpServers(agent.conversationId, [mcpServer.getStdioConfig(agent.slotId)]);
    }
    const session = { team, mcpServer };
    this.sessions.set(team.id, session);
    return session;
  }

  private requireTeam(teamId: string): Team {
    const team = this.repo.getTeam(teamId);
    if (!team) throw new Error(`Team not found: ${teamId}`);
    return team;
  }
}

function formatMailbox(messages: MailboxMessage[], team: Team): string {
  if (messages.length === 0) return 'No unread team messages.';
  const names = new Map(team.agents.map((agent) => [agent.slotId, agent.name]));
  return messages
    .map((message) => {
      const from = message.fromAgentId === 'user' ? 'user' : names.get(message.fromAgentId) || message.fromAgentId;
      return `Message from ${from}:\n${message.content}`;
    })
    .join('\n\n');
}
