import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { PermissionRequest, PermissionResponse, TeamAgent } from '@shared/types';
import { ChatLayout } from '@renderer/features/chat/ChatLayout';
import { NotificationCenter } from '@renderer/features/notifications/components/NotificationCenter';
import { SettingsDialog } from '@renderer/features/settings/components/SettingsDialog';
import { Sidebar } from '@renderer/features/teams/Sidebar';
import { AddAgentDialog } from '@renderer/features/teams/dialogs/AddAgentDialog';
import { CreateTeamDialog } from '@renderer/features/teams/dialogs/CreateTeamDialog';
import { bridge } from '@renderer/shared/bridgeClient';
import { useActiveTeam } from '@renderer/shared/hooks/useActiveTeam';
import { useConversationStream } from '@renderer/shared/hooks/useConversationStream';
import { useNotifications } from '@renderer/shared/hooks/useNotifications';
import { useRuntimeSnapshots } from '@renderer/shared/hooks/useRuntimeSnapshots';
import { useServerInfo } from '@renderer/shared/hooks/useServerInfo';
import { useTeams } from '@renderer/shared/hooks/useTeams';
import type { AddAgentInput, CreateTeamInput } from '@renderer/shared/types/ui';
import { normalizePermissionRequest } from '@renderer/shared/utils/backendData';

export type WorkbenchProps = {
  user: { id: string; username: string };
  onLogout: () => void;
};

/**
 * 新 风格主工作台。
 *
 * 桌面端两栏布局，移动端 Sidebar 改为 fixed 抽屉（通过 ☰ 按钮打开）。
 */
export function Workbench({ user, onLogout }: WorkbenchProps): React.ReactElement {
  const teamsState = useTeams();
  const active = useActiveTeam({ teams: teamsState.teams });
  const conversation = useConversationStream({
    activeTeam: active.activeTeam,
    activeAgent: active.activeAgent,
  });
  const snapshots = useRuntimeSnapshots({ activeAgent: active.activeAgent });
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [permissionQueue, setPermissionQueue] = useState<PermissionRequest[]>([]);
  const permission = permissionQueue[0] ?? null;

  const {
    serverInfo,
    loading: serverInfoLoading,
    error: serverInfoError,
    setRemoteAccess,
  } = useServerInfo();

  const activeAgentsByConversation = useMemo(() => {
    const map: Record<string, TeamAgent | undefined> = {};
    for (const team of teamsState.teams) {
      for (const agent of team.agents ?? []) {
        map[agent.conversationId] = agent;
      }
    }
    return map;
  }, [teamsState.teams]);
  const notifications = useNotifications({ activeAgentsByConversation });

  useEffect(() => {
    console.info('[diag] workbench mounted', {
      userId: user.id,
      at: new Date().toISOString(),
    });
  }, [user.id]);

  useEffect(() => {
    const unsubPermission = bridge.on('conversation.permission', (payload) => {
      const request = normalizePermissionRequest(payload);
      if (request) enqueuePermission(request);
    });
    return () => {
      unsubPermission();
    };
  }, []);

  async function logout(): Promise<void> {
    await fetch('/logout', { method: 'POST', credentials: 'include' });
    onLogout();
  }

  async function createTeam(input: CreateTeamInput): Promise<void> {
    const team = await teamsState.createTeam(input);
    active.selectTeam(team.id);
    setCreateTeamOpen(false);
    notifications.push({ title: '团队已创建', message: team.name, level: 'success' });
  }

  async function addAgent(input: AddAgentInput): Promise<void> {
    if (!active.activeTeam) return;
    const agent = await teamsState.addAgent(active.activeTeam.id, input);
    active.selectAgent(agent.slotId);
    setAddAgentOpen(false);
    notifications.push({ title: 'Agent 已添加', message: agent.name, level: 'success' });
  }

  async function deleteTeam(teamId: string): Promise<void> {
    await teamsState.deleteTeam(teamId);
    notifications.push({ title: '团队已删除', message: '团队和成员已移除。', level: 'warning' });
  }

  async function setModel(model: string): Promise<void> {
    if (!active.activeTeam || !active.activeAgent) return;
    if (active.activeAgent.model === model.trim()) return;
    await snapshots.setModel(active.activeTeam.id, active.activeAgent.slotId, model);
    await teamsState.refreshTeams();
    notifications.push({ title: '模型已切换', message: model.trim(), level: 'success' });
  }

  async function setMode(mode: string): Promise<void> {
    if (!active.activeAgent?.conversationId) return;
    const nextMode = mode.trim();
    if (!nextMode || snapshots.mode?.mode === nextMode) return;
    await bridge.invoke('conversation.setMode', {
      conversationId: active.activeAgent.conversationId,
      mode: nextMode,
    });
    notifications.push({ title: '权限模式已切换', message: nextMode, level: 'success' });
  }

  function enqueuePermission(request: PermissionRequest): void {
    setPermissionQueue((current) => {
      const index = current.findIndex((item) => item.conversationId === request.conversationId && item.callId === request.callId);
      if (index < 0) return [...current, request];
      const next = [...current];
      next[index] = request;
      return next;
    });
  }

  function removePermission(request: PermissionRequest): void {
    setPermissionQueue((current) =>
      current.filter((item) => item.conversationId !== request.conversationId || item.callId !== request.callId)
    );
  }

  async function respondToPermission(request: PermissionRequest, response: PermissionResponse): Promise<void> {
    try {
      const result = await bridge.invoke('conversation.respondPermission', {
        conversationId: request.conversationId,
        callId: request.callId,
        ...response,
      });
      if (!result.accepted) {
        notifications.push({
          title: '权限响应失败',
          message: result.error ?? '权限请求已失效。',
          level: 'warning',
        });
      }
      removePermission(request);
    } catch (error) {
      notifications.push({
        title: '权限响应失败',
        message: error instanceof Error ? error.message : String(error),
        level: 'error',
      });
    }
  }

  return (
    <main className={mobileSidebarOpen ? 'app-shell mobile-sidebar-open' : 'app-shell'}>
      {mobileSidebarOpen ? (
        <button
          type="button"
          className="mobile-sidebar-backdrop"
          aria-label="关闭侧边栏"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}
      <Sidebar
        username={user.username}
        teams={teamsState.teams}
        activeTeam={active.activeTeam}
        activeTeamId={active.activeTeamId}
        activeSlotId={active.activeSlotId}
        phases={conversation.phaseByConversation}
        onCreateTeamClick={() => setCreateTeamOpen(true)}
        onAddAgentClick={() => setAddAgentOpen(true)}
        onSelectTeam={(teamId) => {
          active.selectTeam(teamId);
          setMobileSidebarOpen(false);
        }}
        onSelectAgent={(slotId) => {
          active.selectAgent(slotId);
          setMobileSidebarOpen(false);
        }}
        onDeleteTeam={deleteTeam}
        onSettingsClick={() => setSettingsOpen(true)}
        onLogout={() => void logout()}
      />
      <ChatLayout
        team={active.activeTeam}
        activeAgent={active.activeAgent}
        messages={conversation.messages}
        activePhase={conversation.activePhase}
        usage={snapshots.usage}
        commands={snapshots.commands}
        models={snapshots.models}
        mode={snapshots.mode}
        onOpenSidebar={() => setMobileSidebarOpen(true)}
        onSendMessage={conversation.sendTeamMessage}
        onCancelTurn={conversation.cancelCurrentTurn}
        onSetModel={setModel}
        onSetMode={setMode}
      />
      <NotificationCenter items={notifications.items} onRemove={notifications.remove} />
      <CreateTeamDialog open={createTeamOpen} onClose={() => setCreateTeamOpen(false)} onSubmit={createTeam} />
      <AddAgentDialog
        open={addAgentOpen}
        disabled={!active.activeTeam}
        defaultBackend={active.activeAgent?.backend === 'claude' ? 'codex' : 'claude'}
        defaultModel={snapshots.models?.currentModelId ?? active.activeAgent?.model ?? ''}
        onClose={() => setAddAgentOpen(false)}
        onSubmit={addAgent}
      />
      {permission ? (
        <PermissionDialog
          key={`${permission.conversationId}:${permission.callId}`}
          permission={permission}
          onRespond={(optionId) => {
            void respondToPermission(permission, { outcome: { outcome: 'selected', optionId } });
          }}
          onDismiss={() => {
            void respondToPermission(permission, { outcome: { outcome: 'cancelled' } });
          }}
        />
      ) : null}
      <SettingsDialog
        open={settingsOpen}
        serverInfo={serverInfo}
        loading={serverInfoLoading}
        error={serverInfoError}
        onClose={() => setSettingsOpen(false)}
        onSetRemoteAccess={setRemoteAccess}
      />
      {teamsState.error ? (
        <div className="load-error" role="alert">
          {teamsState.error}
        </div>
      ) : null}
      {teamsState.loading ? <div className="loading-strip">加载团队...</div> : null}
    </main>
  );
}

function PermissionDialog({
  permission,
  onRespond,
  onDismiss,
}: {
  permission: PermissionRequest;
  onRespond: (optionId: string) => void;
  onDismiss: () => void;
}): React.ReactElement {
  const [selected, setSelected] = useState(permission.options[0]?.id ?? '');
  return (
    <div className="permission-overlay">
      <div className="permission-dialog">
        <h3>{permission.title}</h3>
        {permission.body ? <pre className="permission-body">{permission.body}</pre> : null}
        <div className="permission-options">
          {permission.options.map((opt) => (
            <label key={opt.id} className="permission-option">
              <input
                type="radio"
                name="permission"
                value={opt.id}
                checked={selected === opt.id}
                onChange={() => setSelected(opt.id)}
              />
              <span className="permission-option-content">
                <strong>{opt.label}</strong>
                {opt.description ? (
                  <span className="permission-desc">{opt.description}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
        <div className="permission-actions">
          <button type="button" onClick={() => onRespond(selected)} disabled={!selected}>
            确认
          </button>
          <button type="button" className="secondary" onClick={onDismiss}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
