import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelLeftIcon } from 'lucide-react';
import type { PermissionRequest, PermissionResponse, TeamAgent, Workspace } from '@shared/types';
import { ChatLayout } from '@renderer/features/chat/ChatLayout';
import { SettingsDialog } from '@renderer/features/settings/components/SettingsDialog';
import { Sidebar } from '@renderer/features/teams/Sidebar';
import { AddAgentDialog } from '@renderer/features/teams/dialogs/AddAgentDialog';
import { CreateTeamDialog } from '@renderer/features/teams/dialogs/CreateTeamDialog';
import { WorkspacePickerDialog } from '@renderer/features/workspace/WorkspacePickerDialog';
import { bridge } from '@renderer/shared/bridgeClient';
import { Button } from '@renderer/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/shared/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@renderer/shared/components/ui/radio-group';
import { useActiveTeam } from '@renderer/shared/hooks/useActiveTeam';
import { useConversationStream } from '@renderer/shared/hooks/useConversationStream';
import { useNotifications } from '@renderer/shared/hooks/useNotifications';
import { useRuntimeSnapshots } from '@renderer/shared/hooks/useRuntimeSnapshots';
import { useServerInfo } from '@renderer/shared/hooks/useServerInfo';
import { useTeams } from '@renderer/shared/hooks/useTeams';
import type { AddAgentInput, ChatNotification, CreateTeamInput } from '@renderer/shared/types/ui';
import { normalizePermissionRequest, normalizeWorkspace } from '@renderer/shared/utils/backendData';

/** 主工作台接收的登录用户与退出回调。 */
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
  const [createTeamWorkspaceId, setCreateTeamWorkspaceId] = useState<string | null>(null);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [permissionQueue, setPermissionQueue] = useState<PermissionRequest[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [, setActiveWorkspaceId] = useState<string | null>(null);
  const permission = permissionQueue[0] ?? null;

  const {
    serverInfo,
    loading: serverInfoLoading,
    error: serverInfoError,
    setRemoteAccess,
  } = useServerInfo();

  const agentsByConversation = useMemo(() => {
    const map: Record<string, { teamId: string; slotId: string; agent: TeamAgent } | undefined> = {};
    for (const team of teamsState.teams) {
      for (const agent of team.agents ?? []) {
        map[agent.conversationId] = { teamId: team.id, slotId: agent.slotId, agent };
      }
    }
    return map;
  }, [teamsState.teams]);
  const notifications = useNotifications({
    activeTeamId: active.activeTeamId,
    activeSlotId: active.activeSlotId,
    activeConversationId: active.activeAgent?.conversationId,
    agentsByConversation,
  });

  useEffect(() => {
    console.info('[diag] workbench mounted', {
      userId: user.id,
      at: new Date().toISOString(),
    });
  }, [user.id]);

  const refreshWorkspaces = useCallback(async () => {
    const result = await bridge.invoke('workspace.list', undefined);
    const next = result.map(normalizeWorkspace).filter((workspace): workspace is Workspace => workspace !== null);
    setWorkspaces(next);
    setActiveWorkspaceId((current) => (current && next.some((workspace) => workspace.id === current) ? current : null));
  }, []);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  useEffect(() => {
    if (active.activeTeam?.workspaceId) setActiveWorkspaceId(active.activeTeam.workspaceId);
  }, [active.activeTeam?.workspaceId]);

  useEffect(() => {
    const unsubPermission = bridge.on('conversation.permission', (payload) => {
      const request = normalizePermissionRequest(payload);
      if (request) enqueuePermission(request);
    });
    return () => {
      unsubPermission();
    };
  }, []);

  /** 退出当前登录会话，并让应用回到登录页。 */
  async function logout(): Promise<void> {
    await fetch('/logout', { method: 'POST', credentials: 'include' });
    onLogout();
  }

  /** 创建团队后切换到新团队，并刷新工作区列表。 */
  async function createTeam(input: CreateTeamInput): Promise<void> {
    const team = await teamsState.createTeam(input);
    setActiveWorkspaceId(team.workspaceId || null);
    active.selectTeam(team.id);
    setCreateTeamOpen(false);
    setCreateTeamWorkspaceId(null);
    await refreshWorkspaces();
    notifications.push({ title: '团队已创建', message: team.name, level: 'success' });
  }

  /** 打开创建 Team 弹窗；不传 workspaceId 时创建普通对话分组。 */
  function openCreateTeam(workspaceId?: string): void {
    setCreateTeamWorkspaceId(workspaceId ?? null);
    setCreateTeamOpen(true);
  }

  /** 打开局部 Chat 通知指向的团队成员，并关闭该通知。 */
  function openChatNotificationTarget(item: ChatNotification): void {
    const context = item.conversationId ? agentsByConversation[item.conversationId] : undefined;
    const teamId = item.teamId ?? context?.teamId;
    const slotId = item.slotId ?? context?.slotId;
    if (teamId) {
      const team = teamsState.teams.find((entry) => entry.id === teamId);
      if (team) setActiveWorkspaceId(team.workspaceId);
      active.selectTeam(teamId);
    }
    if (slotId) active.selectAgent(slotId);
    notifications.removeChat(item.id);
  }

  /**
   * 把当前 Agent 相关的成功反馈显示在 Chat 面板内，避免占用页面全局右上角。
   *
   * @param input - 通知标题和内容
   */
  function pushActiveChatNotification(input: { title: string; message: string }): void {
    notifications.pushChat({
      title: input.title,
      message: input.message,
      level: 'success',
      teamId: active.activeTeam?.id,
      slotId: active.activeAgent?.slotId,
      conversationId: active.activeAgent?.conversationId,
    });
  }

  /** 向当前团队添加 Agent，并立即选中新成员。 */
  async function addAgent(input: AddAgentInput): Promise<void> {
    if (!active.activeTeam) return;
    const agent = await teamsState.addAgent(active.activeTeam.id, input);
    active.selectAgent(agent.slotId);
    setAddAgentOpen(false);
    notifications.push({ title: 'Agent 已添加', message: agent.name, level: 'success' });
  }

  /** 删除团队后刷新工作区派生数据并推送通知。 */
  async function deleteTeam(teamId: string): Promise<void> {
    await teamsState.deleteTeam(teamId);
    await refreshWorkspaces();
    notifications.push({ title: '团队已删除', message: '团队和成员已移除。', level: 'warning' });
  }

  /** 切换当前 Agent 的模型，并同步团队状态。 */
  async function setModel(model: string): Promise<void> {
    if (!active.activeTeam || !active.activeAgent) return;
    if (active.activeAgent.model === model.trim()) return;
    await snapshots.setModel(active.activeTeam.id, active.activeAgent.slotId, model);
    await teamsState.refreshTeams();
    pushActiveChatNotification({ title: '模型已切换', message: model.trim() });
  }

  /** 切换当前 Agent 的权限模式。 */
  async function setMode(mode: string): Promise<void> {
    if (!active.activeAgent?.conversationId) return;
    const nextMode = mode.trim();
    if (!nextMode || snapshots.mode?.mode === nextMode) return;
    await bridge.invoke('conversation.setMode', {
      conversationId: active.activeAgent.conversationId,
      mode: nextMode,
    });
    pushActiveChatNotification({ title: '权限模式已切换', message: nextMode });
  }

  /** 将权限请求加入队列；同一会话和 callId 的请求会被更新。 */
  function enqueuePermission(request: PermissionRequest): void {
    setPermissionQueue((current) => {
      const index = current.findIndex((item) => item.conversationId === request.conversationId && item.callId === request.callId);
      if (index < 0) return [...current, request];
      const next = [...current];
      next[index] = request;
      return next;
    });
  }

  /** 从队列中移除已经处理或关闭的权限请求。 */
  function removePermission(request: PermissionRequest): void {
    setPermissionQueue((current) =>
      current.filter((item) => item.conversationId !== request.conversationId || item.callId !== request.callId)
    );
  }

  /** 将用户选择提交给后端，并根据结果关闭或保留权限提示。 */
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
    <main className="relative grid h-[100dvh] w-screen grid-cols-1 overflow-hidden bg-background md:grid-cols-[300px_minmax(0,1fr)]">
      {!mobileSidebarOpen && !active.activeTeam ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="fixed left-3 top-3 z-30 size-9 md:hidden"
          aria-label="打开侧边栏"
          title="打开侧边栏"
          onClick={() => setMobileSidebarOpen(true)}
        >
          <PanelLeftIcon aria-hidden="true" className="size-4" />
        </Button>
      ) : null}
      {mobileSidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 cursor-pointer border-0 bg-black/28 p-0 md:hidden"
          aria-label="关闭侧边栏"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}
      <Sidebar
        teams={teamsState.teams}
        activeTeam={active.activeTeam}
        activeTeamId={active.activeTeamId}
        activeSlotId={active.activeSlotId}
        phases={conversation.phaseByConversation}
        workspaces={workspaces}
        onAddAgentClick={() => setAddAgentOpen(true)}
        onOpenDirectoryPicker={() => setDirectoryPickerOpen(true)}
        onCreateTeamInWorkspace={openCreateTeam}
        onSelectTeam={(teamId) => {
          const team = teamsState.teams.find((item) => item.id === teamId);
          if (team) setActiveWorkspaceId(team.workspaceId);
          active.selectTeam(teamId);
          setMobileSidebarOpen(false);
        }}
        onSelectAgent={(slotId) => {
          active.selectAgent(slotId);
          setMobileSidebarOpen(false);
        }}
        onDeleteTeam={deleteTeam}
        onSettingsClick={() => setSettingsOpen(true)}
        mobileOpen={mobileSidebarOpen}
      />
      <ChatLayout
        team={active.activeTeam}
        activeAgent={active.activeAgent}
        messages={conversation.messages}
        activePhase={conversation.activePhase}
        usage={snapshots.usage}
        memory={snapshots.memory}
        commands={snapshots.commands}
        models={snapshots.models}
        mode={snapshots.mode}
        onOpenSidebar={() => setMobileSidebarOpen(true)}
        onSendMessage={conversation.sendTeamMessage}
        onCancelTurn={conversation.cancelCurrentTurn}
        onSetModel={setModel}
        onSetMode={setMode}
        chatNotifications={notifications.chatItems}
        onDismissChatNotification={notifications.removeChat}
        onOpenChatNotification={openChatNotificationTarget}
      />
      <CreateTeamDialog
        open={createTeamOpen}
        defaultWorkspaceId={createTeamWorkspaceId}
        onClose={() => {
          setCreateTeamOpen(false);
          setCreateTeamWorkspaceId(null);
        }}
        onSubmit={createTeam}
      />
      {directoryPickerOpen ? (
        <WorkspacePickerDialog
          open={directoryPickerOpen}
          onOpenChange={setDirectoryPickerOpen}
          onSelect={(workspace) => {
            setWorkspaces((current) => [workspace, ...current.filter((item) => item.id !== workspace.id)]);
            setActiveWorkspaceId(workspace.id);
            notifications.push({ title: '工作区已新建', message: workspace.name, level: 'success' });
          }}
        />
      ) : null}
      <AddAgentDialog
        open={addAgentOpen}
        disabled={!active.activeTeam}
        defaultBackend={active.activeAgent?.backend === 'claude' ? 'codex' : 'claude'}
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
        onLogout={() => void logout()}
      />
      {teamsState.error ? (
        <div
          className="fixed left-1/2 top-3 z-[70] -translate-x-1/2 rounded-full border border-border bg-background px-3 py-2 text-xs text-destructive shadow-[0_8px_24px_rgba(15,23,42,0.16)]"
          role="alert"
        >
          {teamsState.error}
        </div>
      ) : null}
      {teamsState.loading ? (
        <div className="fixed left-1/2 top-3 z-[70] -translate-x-1/2 rounded-full border border-border bg-background px-3 py-2 text-xs shadow-[0_8px_24px_rgba(15,23,42,0.16)]">
          加载团队...
        </div>
      ) : null}
    </main>
  );
}

/** 展示单个权限请求，并允许用户选择授权选项或关闭。 */
function PermissionDialog({
  permission,
  onRespond,
  onDismiss,
}: {
  permission: PermissionRequest;
  onRespond: (optionId: string) => void;
  onDismiss: () => void;
}): React.ReactElement {
  const meta = getPermissionMeta(permission);
  const formattedInput = formatPermissionInput(permission);
  const [selected, setSelected] = useState(() => getDefaultPermissionOption(permission.options));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent className="gap-0 p-0">
        <DialogHeader className="grid grid-cols-[34px_minmax(0,1fr)] gap-3 border-b-0 pb-3">
          <div className="grid size-[34px] place-items-center rounded-[10px] bg-primary text-base text-primary-foreground" aria-hidden="true">
            ⌘
          </div>
          <div className="min-w-0">
            <DialogDescription className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              需要授权
            </DialogDescription>
            <DialogTitle className="text-xl leading-tight">
              {meta.displayTitle}
            </DialogTitle>
          </div>
        </DialogHeader>

        {formattedInput ? (
          <section className="mx-6 mb-4 overflow-hidden rounded-[18px] border border-border bg-muted">
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>Tool arguments</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  void navigator.clipboard.writeText(formattedInput).catch((err) => {
                    console.warn('[permission] failed to copy tool arguments', err);
                  });
                }}
              >
                Copy
              </Button>
            </div>
            <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-foreground">
              {formattedInput}
            </pre>
          </section>
        ) : null}

        <RadioGroup
          className="mx-6 mb-5 gap-1"
          value={selected}
          aria-label="权限选项"
          onValueChange={setSelected}
        >
          {permission.options.map((opt) => {
            const checked = selected === opt.id;
            const optionId = `permission-option-${opt.id}`;

            return (
              <label
                key={opt.id}
                htmlFor={optionId}
                className={[
                  'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm text-foreground transition-colors',
                  checked ? 'bg-muted' : 'hover:bg-muted/70',
                ].join(' ')}
              >
                <RadioGroupItem
                  id={optionId}
                  value={opt.id}
                />
                <span className="min-w-0 truncate font-medium">{opt.label}</span>
              </label>
            );
          })}
        </RadioGroup>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            onClick={() => onRespond(selected)}
            disabled={!selected}
          >
            确认
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onDismiss}
          >
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 权限弹窗展示标题所需的工具名元数据。 */
type PermissionMeta = {
  toolName: string;
  displayTitle: string;
};

/** 从权限标题中提取更适合展示的工具名。 */
function getPermissionMeta(permission: PermissionRequest): PermissionMeta {
  const title = permission.title.trim();
  const parts = title.split('__').filter(Boolean);
  const toolName = parts.at(-1) ?? title;

  return {
    toolName,
    displayTitle: `允许调用 ${toolName}？`,
  };
}

/** 优先展示结构化工具参数，避免把双重转义后的正文直接暴露给用户。 */
function formatPermissionInput(permission: PermissionRequest): string {
  if (permission.rawInput !== undefined) {
    return JSON.stringify(permission.rawInput, null, 2) ?? String(permission.rawInput);
  }

  if (!permission.body) return '';

  try {
    return JSON.stringify(JSON.parse(permission.body), null, 2) ?? permission.body;
  } catch {
    return permission.body;
  }
}

/** 权限确认默认偏保守：优先选择单次允许，避免默认永久授权。 */
function getDefaultPermissionOption(options: PermissionRequest['options']): string {
  const allowOnce = options.find((option) => {
    const label = option.label.toLowerCase();
    const originalLabel = option.label;
    const isAlways =
      label.includes('always') ||
      originalLabel.includes('永久') ||
      originalLabel.includes('总是') ||
      originalLabel.includes('始终');
    const isAllow = label.includes('allow') || originalLabel.includes('允许');

    return isAllow && !isAlways;
  });

  return allowOnce?.id ?? options[0]?.id ?? '';
}
