import type { AgentBackend, ServerInfo } from '../../../shared/types';
import type { AttachmentRepositoryPort } from '../../db/attachmentRepository';
import { toAttachmentRef } from '../../db/mappers';
import { healthAgent, listAgents } from '../../runtime/agentRegistry';
import type { AttachmentService } from '../../services/attachmentService';
import type { ConversationService } from '../../services/conversationService';
import type { TeamService } from '../../services/teamService';
import type { WebBridge } from './webBridge';

/**
 * 注册 renderer 可调用的 bridge RPC。
 *
 * 这里只做协议层参数分发；图片上传、消息发送和 Team 操作的业务约束保留在对应 Service 中。
 */
export function registerBridgeHandlers(input: {
  bridge: WebBridge;
  attachments: AttachmentRepositoryPort;
  attachmentService: AttachmentService;
  conversations: ConversationService;
  teams: TeamService;
  serverInfo: () => ServerInfo;
  setRemoteAccess: (params: { allowRemote: boolean }) => ServerInfo;
}): void {
  const { bridge, attachments, attachmentService, conversations, teams } = input;

  bridge.register('attachment.upload', async (params) => {
    const saved = await attachmentService.saveImage(params);
    const stored = attachments.createAttachment(saved);
    return toAttachmentRef(stored);
  });
  bridge.register('attachment.delete', async ({ attachmentId }) => {
    const deleted = attachments.deleteAttachment(attachmentId);
    await attachmentService.deleteStoredFiles(deleted);
    return { deleted: true };
  });
  bridge.register('agent.list', () => listAgents());
  bridge.register('agent.health', ({ backend }: { backend: AgentBackend }) => healthAgent(backend));
  bridge.register('conversation.create', (params) => conversations.create(params));
  bridge.register('conversation.setModel', (params) => conversations.setModel(params));
  bridge.register('conversation.setMode', (params) => conversations.setMode(params));
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
  bridge.register('conversation.confirmPermission', (params) => conversations.confirmPermission(params));
  bridge.register('conversation.respondPermission', (params) => conversations.respondPermission(params));
  bridge.register('conversation.deleteMessage', (params) => conversations.deleteMessage(params));
  bridge.register('conversation.deleteMessageAttachment', (params) => conversations.deleteMessageAttachment(params));
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
  bridge.register('server.setRemoteAccess', input.setRemoteAccess);
}
