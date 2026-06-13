import React from 'react';

/** Team 侧栏展开状态和控制方法。 */
export type UseTeamDrawerResult = {
  open: boolean;
  toggle: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
};

/**
 * 管理 Team 侧栏展开/折叠状态。
 */
export function useTeamDrawer(): UseTeamDrawerResult {
  const [open, setOpen] = React.useState(false);

  return {
    open,
    toggle: () => setOpen((value) => !value),
    openDrawer: () => setOpen(true),
    closeDrawer: () => setOpen(false),
  };
}
