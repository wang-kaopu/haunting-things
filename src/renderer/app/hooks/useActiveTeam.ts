import { useEffect, useMemo, useState } from 'react';
import type { Team, TeamAgent } from '../../../shared/types';

export type UseActiveTeamInput = {
  teams: Team[];
};

export type UseActiveTeamResult = {
  activeTeamId: string | null;
  activeSlotId: string | null;
  activeTeam: Team | null;
  activeAgent: TeamAgent | null;
  setActiveTeamId: (teamId: string | null) => void;
  setActiveSlotId: (slotId: string | null) => void;
  selectTeam: (teamId: string) => void;
  selectAgent: (slotId: string) => void;
};

export function useActiveTeam({ teams }: UseActiveTeamInput): UseActiveTeamResult {
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);

  const activeTeam = useMemo(() => {
    return teams.find((team) => team.id === activeTeamId) ?? teams[0] ?? null;
  }, [activeTeamId, teams]);

  const activeAgent = useMemo(() => {
    if (!activeTeam) return null;
    const agents = activeTeam.agents ?? [];
    return agents.find((agent) => agent.slotId === activeSlotId) ?? agents[0] ?? null;
  }, [activeSlotId, activeTeam]);

  useEffect(() => {
    if (teams.length === 0) {
      setActiveTeamId(null);
      setActiveSlotId(null);
      return;
    }

    setActiveTeamId((current) => {
      if (current && teams.some((team) => team.id === current)) return current;
      return teams[0].id;
    });
  }, [teams]);

  useEffect(() => {
    if (!activeTeam) return;
    setActiveSlotId((current) => {
      const agents = activeTeam.agents ?? [];
      if (current && agents.some((agent) => agent.slotId === current)) return current;
      return agents.find((agent) => agent.role === 'leader')?.slotId ?? agents[0]?.slotId ?? null;
    });
  }, [activeTeam]);

  return {
    activeTeamId: activeTeam?.id ?? activeTeamId,
    activeSlotId: activeAgent?.slotId ?? activeSlotId,
    activeTeam,
    activeAgent,
    setActiveTeamId,
    setActiveSlotId,
    selectTeam: (teamId) => setActiveTeamId(teamId),
    selectAgent: (slotId) => setActiveSlotId(slotId),
  };
}
