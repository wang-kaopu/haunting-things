import type { AgentBackend, ServerInfo } from '@shared/types';
import type { AttachmentRepositoryPort } from '@server/port/attachmentRepositoryPort';
import { toAttachmentRef } from '@server/db/mappers';
import { healthAgent, listAgents } from '@server/runtime/agentRegistry';
import type { AttachmentService } from '@server/services/attachmentService';
import type { ConversationService } from '@server/services/conversationService';
import type { TeamService } from '@server/services/teamService';
import type { WorkspaceService } from '@server/services/workspaceService';
import type { WebBridge } from '@server/app/bridge/webBridge';

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
  workspaces: WorkspaceService;
  serverInfo: () => ServerInfo;
  setRemoteAccess: (params: { allowRemote: boolean }) => ServerInfo;
}): void {
  const { bridge, attachments, attachmentService, conversations, teams, workspaces } = input;

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
  bridge.register('workspace.root', () => workspaces.getRoot());
  bridge.register('workspace.browse', (params) => workspaces.browse(params));
  bridge.register('workspace.selectDirectory', (params) => workspaces.selectDirectory(params));
  bridge.register('workspace.createTemporary', (params) => workspaces.createTemporary(params));
  bridge.register('workspace.list', () => {
    cleanupEmptyWorkspaces();
    return workspaces.list();
  });
  bridge.register('workspace.get', ({ workspaceId }) => workspaces.get(workspaceId));
  bridge.register('workspace.tree', (params) => workspaces.tree(params));
  bridge.register('workspace.readTextFile', (params) => workspaces.readTextFile(params));
  bridge.register('workspace.writeTextFile', (params) => workspaces.writeTextFile(params));
  bridge.register('workspace.mkdir', (params) => workspaces.mkdir(params));
  bridge.register('workspace.rename', (params) => workspaces.rename(params));
  bridge.register('workspace.deleteEntry', (params) => workspaces.deleteEntry(params));
  bridge.register('workspace.openPath', (params) => workspaces.openPath(params));
  bridge.register('workspace.revealPath', (params) => workspaces.revealPath(params));
  bridge.register('conversation.create', (params) => conversations.create(params));
  bridge.register('conversation.setWorkspace', (params) => conversations.setConversationWorkspace(params));
  bridge.register('conversation.setModel', (params) => conversations.setModel(params));
  bridge.register('conversation.setMode', (params) => conversations.setMode(params));
  bridge.register('conversation.list', (params) => conversations.list(params ?? {}));
  bridge.register('conversation.get', ({ conversationId }) => conversations.get(conversationId));
  bridge.register('conversation.messages', ({ conversationId }) => conversations.messages(conversationId));
  bridge.register('conversation.agentEvents', ({ conversationId, limit }) =>
    conversations.agentEvents(conversationId, limit)
  );
  bridge.register('conversation.commands', ({ conversationId }) => conversations.commands(conversationId));
  bridge.register('conversation.models', ({ conversationId }) => conversations.models(conversationId));
  bridge.register('conversation.mode', ({ conversationId }) => conversations.mode(conversationId));
  bridge.register('conversation.memory', ({ conversationId }) => conversations.memory(conversationId));
  bridge.register('conversation.compressMemory', (params) => conversations.compressMemory(params));
  bridge.register('conversation.sendMessage', async (params) => {
    await conversations.sendMessage(params);
    return { accepted: true };
  });
  bridge.register('conversation.cancel', (params) => conversations.cancelCurrentTurn(params));
  bridge.register('conversation.confirmPermission', (params) => conversations.confirmPermission(params));
  bridge.register('conversation.respondPermission', (params) => conversations.respondPermission(params));
  bridge.register('conversation.deleteMessage', (params) => conversations.deleteMessage(params));
  bridge.register('conversation.deleteMessageAttachment', (params) => conversations.deleteMessageAttachment(params));
  bridge.register('team.create', (params) => teams.create(params));
  bridge.register('team.delete', async ({ teamId }) => {
    const team = teams.get(teamId);
    const result = await teams.delete(teamId);
    if (team?.workspaceId) cleanupEmptyWorkspace(team.workspaceId);
    return result;
  });
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

  /** 删除没有任何 Team/Conversation 引用的工作区记录。 */
  function cleanupEmptyWorkspace(workspaceId: string): void {
    workspaces.deleteIfUnreferenced({
      workspaceId,
      teamCount: teams.countByWorkspace(workspaceId),
      conversationCount: conversations.countByWorkspace(workspaceId),
    });
  }

  /** 每次列出工作区前做一次轻量清理，避免空工作区在侧边栏长期残留。 */
  function cleanupEmptyWorkspaces(): void {
    for (const workspace of workspaces.list()) {
      cleanupEmptyWorkspace(workspace.id);
    }
  }
}
