import React from 'react';

export type UseTeamDrawerResult = {
  open: boolean;
  toggle: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
};

export function useTeamDrawer(): UseTeamDrawerResult {
  const [open, setOpen] = React.useState(true);

  return {
    open,
    toggle: () => setOpen((value) => !value),
    openDrawer: () => setOpen(true),
    closeDrawer: () => setOpen(false),
  };
}
