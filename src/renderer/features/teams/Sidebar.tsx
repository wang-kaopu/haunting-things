import type React from 'react';
import { LogOutIcon, PlusIcon, SettingsIcon } from 'lucide-react';
import type { AgentTurnPhase, Team, Workspace } from '@shared/types';
import { SidebarAgentList } from '@renderer/features/teams/components/SidebarAgentList';
import { TeamList } from '@renderer/features/teams/components/TeamList';
import { Button } from '@renderer/shared/components/ui/button';
import { cn } from '@renderer/shared/lib/utils';

/** 左侧导航栏输入——成员状态、团队列表和全局入口。 */
export type SidebarProps = {
  username?: string;
  teams: Team[];
  activeTeam: Team | null;
  activeTeamId: string | null;
  activeSlotId: string | null;
  phases?: Record<string, AgentTurnPhase>;
  workspaces: Workspace[];
  onAddAgentClick: () => void;
  onOpenDirectoryPicker: () => void;
  onCreateTeamInWorkspace: (workspaceId?: string) => void;
  onSelectTeam: (teamId: string) => void;
  onSelectAgent: (slotId: string) => void;
  onDeleteTeam: (teamId: string) => Promise<void>;
  onSettingsClick: () => void;
  onLogout: () => void;
  mobileOpen?: boolean;
};

/**
 * 左侧导航栏。
 *
 * 从上到下：品牌 → 成员状态 → 团队列表 → 设置/退出。
 * 成员状态置顶，打开页面第一眼就能看到"谁空闲、谁忙碌"。
 */
export function Sidebar({
  username,
  teams,
  activeTeam,
  activeTeamId,
  activeSlotId,
  phases,
  workspaces,
  onAddAgentClick,
  onOpenDirectoryPicker,
  onCreateTeamInWorkspace,
  onSelectTeam,
  onSelectAgent,
  onDeleteTeam,
  onSettingsClick,
  onLogout,
  mobileOpen,
}: SidebarProps): React.ReactElement {
  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[300px] min-w-0 flex-col overflow-hidden border-r border-border bg-[#f9f9f9] p-3 transition-transform md:static md:z-auto md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}
    >
      <div className="grid gap-1 px-2 pb-3 pt-1">
        <strong className="truncate text-[15px] font-semibold">Haunting Things</strong>
        {username ? <span className="truncate text-xs text-muted-foreground">{username}</span> : null}
      </div>

      <section className="mb-4 grid max-h-[220px] flex-none gap-1.5 overflow-hidden">
        <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span className="font-medium">Members</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-[#175cd3]"
            disabled={!activeTeam}
            onClick={onAddAgentClick}
          >
            <PlusIcon aria-hidden="true" className="size-3.5" />
            添加
          </Button>
        </div>

        <SidebarAgentList
          agents={activeTeam?.agents ?? []}
          activeSlotId={activeSlotId}
          phases={phases}
          onSelectAgent={onSelectAgent}
        />
      </section>

      <section className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-1.5">
        <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span className="text-[13px] font-medium text-foreground">Teams</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-[#175cd3]"
            onClick={onOpenDirectoryPicker}
          >
            <PlusIcon aria-hidden="true" className="size-3.5" />
            新建工作区
          </Button>
        </div>

        <TeamList
          teams={teams}
          workspaces={workspaces}
          activeTeamId={activeTeamId}
          onCreateTeamInWorkspace={onCreateTeamInWorkspace}
          onSelectTeam={onSelectTeam}
          onDeleteTeam={onDeleteTeam}
        />
      </section>

      <div className="mt-auto grid gap-1 border-t border-border pt-2">
        <Button
          type="button"
          variant="ghost"
          className="h-9 justify-start gap-2 px-2 text-sm font-normal"
          onClick={onSettingsClick}
        >
          <SettingsIcon aria-hidden="true" className="size-4" />
          设置
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 justify-start gap-2 px-2 text-sm font-normal"
          onClick={onLogout}
        >
          <LogOutIcon aria-hidden="true" className="size-4" />
          退出登录
        </Button>
      </div>
    </aside>
  );
}
