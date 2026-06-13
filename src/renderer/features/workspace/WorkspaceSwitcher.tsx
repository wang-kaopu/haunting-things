import type React from 'react';
import { FolderPlusIcon, MessageSquarePlusIcon } from 'lucide-react';
import type { Workspace } from '@shared/types';
import { Button } from '@renderer/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/shared/components/ui/select';

const ALL_WORKSPACES_VALUE = '__all_workspaces__';

/** 工作区过滤器的可选工作区、当前选择和创建入口。 */
export type WorkspaceSwitcherProps = {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (workspaceId: string | null) => void;
  onOpenDirectoryPicker: () => void;
  onCreateTemporaryWorkspace: () => Promise<void>;
};

/** 切换当前会话列表使用的工作区过滤条件。 */
export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onOpenDirectoryPicker,
  onCreateTemporaryWorkspace,
}: WorkspaceSwitcherProps): React.ReactElement {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span className="font-medium">Workspaces</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-[#175cd3]"
          onClick={onOpenDirectoryPicker}
        >
          <FolderPlusIcon aria-hidden="true" className="size-3.5" />
          选择
        </Button>
      </div>

      <Select
        value={activeWorkspaceId ?? ALL_WORKSPACES_VALUE}
        onValueChange={(value) => onSelectWorkspace(value === ALL_WORKSPACES_VALUE ? null : value)}
      >
        <SelectTrigger aria-label="工作区" className="h-8 bg-muted px-2 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_WORKSPACES_VALUE}>全部工作区</SelectItem>
          {workspaces.map((workspace) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              {workspace.isTemporary ? '对话' : workspace.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 justify-start gap-2 rounded-lg px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
        onClick={() => void onCreateTemporaryWorkspace()}
      >
        <MessageSquarePlusIcon aria-hidden="true" className="size-3.5" />
        创建对话
      </Button>
    </section>
  );
}
