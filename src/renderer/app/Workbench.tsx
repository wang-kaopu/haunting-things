import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import type { PermissionRequest, TeamAgent } from '../../shared/types';
import { bridge } from '../shared/bridgeClient';
import { ChatLayout } from '../features/chat/ChatLayout';
import { Sidebar } from '../features/teams/Sidebar';
import { TeamDrawer } from '../features/teams/TeamDrawer';
import { AddAgentDialog } from '../features/teams/dialogs/AddAgentDialog';
import { CreateTeamDialog } from '../features/teams/dialogs/CreateTeamDialog';
import { NotificationCenter } from '../features/notifications/components/NotificationCenter';
import { useActiveTeam } from '../shared/hooks/useActiveTeam';
import { useConversationStream } from '../shared/hooks/useConversationStream';
import { useNotifications } from '../shared/hooks/useNotifications';
import { useRuntimeSnapshots } from '../shared/hooks/useRuntimeSnapshots';
import { useServerInfo } from '../shared/hooks/useServerInfo';
import { useTeamDrawer } from '../shared/hooks/useTeamDrawer';
import { useTeams } from '../shared/hooks/useTeams';
import { RemoteAccessPanel } from '../features/settings/components/RemoteAccessPanel';
import type { AddAgentInput, CreateTeamInput } from '../shared/types/ui';
import { normalizePermissionRequest } from '../shared/utils/backendData';

export type WorkbenchProps = {
  user: { id: string; username: string };
  onLogout: () => void;
};

export function Workbench({ user, onLogout }: WorkbenchProps): React.ReactElement {
  const teamsState = useTeams();
  const active = useActiveTeam({ teams: teamsState.teams });
  const drawer = useTeamDrawer();
  const conversation = useConversationStream({
    activeTeam: active.activeTeam,
    activeAgent: active.activeAgent,
  });
  const snapshots = useRuntimeSnapshots({ activeAgent: active.activeAgent });
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);

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
    const unsubPermission = bridge.on('conversation.permission', (payload) => {
      const request = normalizePermissionRequest(payload);
      if (request) setPermission(request);
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

  return (
    <main className={drawer.open ? 'app-shell drawer-open' : 'app-shell drawer-collapsed'}>
      <Sidebar
        username={user.username}
        teams={teamsState.teams}
        activeTeamId={active.activeTeamId}
        onCreateTeamClick={() => setCreateTeamOpen(true)}
        onSelectTeam={active.selectTeam}
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
        onAddAgentClick={() => setAddAgentOpen(true)}
        onSendMessage={conversation.sendTeamMessage}
        onSetModel={setModel}
      />
      <TeamDrawer
        open={drawer.open}
        team={active.activeTeam}
        activeSlotId={active.activeSlotId}
        phases={conversation.phaseByConversation}
        commandsByConversation={snapshots.commandsByConversation}
        modeByConversation={snapshots.modeByConversation}
        onToggle={drawer.toggle}
        onSelectAgent={active.selectAgent}
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
          permission={permission}
          onRespond={(optionId) => {
            void bridge.invoke('conversation.confirmPermission', {
              conversationId: permission.conversationId,
              callId: permission.callId,
              optionId,
            });
            setPermission(null);
          }}
          onDismiss={() => setPermission(null)}
        />
      ) : null}
      {settingsOpen ? (
        <div className="modal-backdrop">
          <div className="modal settings-dialog">
            <div className="modal-header">
              <h2>设置</h2>
              <button type="button" onClick={() => setSettingsOpen(false)}>
                关闭
              </button>
            </div>

            <RemoteAccessPanel
              serverInfo={serverInfo}
              loading={serverInfoLoading}
              error={serverInfoError}
              onSetRemoteAccess={setRemoteAccess}
            />
          </div>
        </div>
      ) : null}
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
      <div className="permission-dialog panel">
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
              {opt.label}
              {opt.description ? <span className="permission-desc"> - {opt.description}</span> : null}
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
