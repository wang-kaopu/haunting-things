import type { AgentBackend } from '../../../shared/types';
import { healthAgent, listAgents } from '../../runtime/agentRegistry';
import type { ConversationService } from '../../services/conversationService';
import type { TeamService } from '../../services/teamService';
import type { WebBridge } from './webBridge';

export function registerBridgeHandlers(input: {
  bridge: WebBridge;
  conversations: ConversationService;
  teams: TeamService;
  serverInfo: () => {
    host: string;
    port: number;
    allowRemote: boolean;
    urls: string[];
  };
}): void {
  const { bridge, conversations, teams } = input;

  bridge.register('agent.list', () => listAgents());
  bridge.register('agent.health', ({ backend }: { backend: AgentBackend }) => healthAgent(backend));
  bridge.register('conversation.create', (params) => conversations.create(params));
  bridge.register('conversation.setModel', (params) => conversations.setModel(params));
  bridge.register('conversation.list', () => conversations.list());
  bridge.register('conversation.messages', ({ conversationId }) => conversations.messages(conversationId));
  bridge.register('conversation.agentEvents', ({ conversationId, limit }) =>
    conversations.agentEvents(conversationId, limit)
  );
  bridge.register('conversation.commands', ({ conversationId }) => conversations.commands(conversationId));
  bridge.register('conversation.models', ({ conversationId }) => conversations.models(conversationId));
  bridge.register('conversation.mode', ({ conversationId }) => conversations.mode(conversationId));
  bridge.register('conversation.sendMessage', async (params) => {
    await conversations.sendMessage(params);
    return { accepted: true };
  });
  bridge.register('conversation.confirmPermission', (params) => {
    conversations.confirmPermission(params);
    return { accepted: true };
  });
  bridge.register('team.create', (params) => teams.create(params));
  bridge.register('team.delete', ({ teamId }) => teams.delete(teamId));
  bridge.register('team.addAgent', (params) => teams.addAgent(params));
  bridge.register('team.removeAgent', (params) => teams.removeAgent(params));
  bridge.register('team.setAgentModel', (params) => teams.setAgentModel(params));
  bridge.register('team.finishTask', (params) => teams.finishTask(params));
  bridge.register('team.taskCreate', (params) => teams.taskCreate(params));
  bridge.register('team.tasks', ({ teamId }) => teams.tasks(teamId));
  bridge.register('team.get', ({ teamId }) => teams.get(teamId));
  bridge.register('team.list', () => teams.list());
  bridge.register('team.sendMessage', async (params) => {
    await teams.sendMessage(params);
    return { accepted: true };
  });
  bridge.register('team.sendMessageToAgent', async (params) => {
    await teams.sendMessageToAgent(params);
    return { accepted: true };
  });
  bridge.register('team.timeline', ({ teamId }) => teams.timeline(teamId));
  bridge.register('team.stop', async ({ teamId }) => {
    await teams.stop(teamId);
    return { stopped: true };
  });
  bridge.register('server.info', input.serverInfo);
}
