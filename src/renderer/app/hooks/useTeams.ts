import { useCallback, useEffect, useState } from 'react';
import type { Team, TeamAgent } from '../../../shared/types';
import { bridge } from '../../bridgeClient';
import type { AddAgentInput, CreateTeamInput } from '../types/ui';

export type UseTeamsResult = {
  teams: Team[];
  loading: boolean;
  error: string;
  refreshTeams: () => Promise<void>;
  createTeam: (input: CreateTeamInput) => Promise<Team>;
  deleteTeam: (teamId: string) => Promise<void>;
  addAgent: (teamId: string, input: AddAgentInput) => Promise<TeamAgent>;
  updateTeam: (team: Team) => void;
};

export function useTeams(): UseTeamsResult {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshTeams = useCallback(async () => {
    try {
      setError('');
      const next = await bridge.invoke('team.list', undefined);
      setTeams(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTeams();

    const unsubAdded = bridge.on('team.agent.added', () => {
      void refreshTeams();
    });
    const unsubRemoved = bridge.on('team.agent.removed', () => {
      void refreshTeams();
    });
    const unsubStatus = bridge.on('team.agent.status', ({ teamId, slotId, status }) => {
      setTeams((current) =>
        current.map((team) =>
          team.id === teamId
            ? {
                ...team,
                agents: team.agents.map((agent) =>
                  agent.slotId === slotId ? { ...agent, status } : agent
                ),
              }
            : team
        )
      );
    });

    return () => {
      unsubAdded();
      unsubRemoved();
      unsubStatus();
    };
  }, [refreshTeams]);

  const createTeam = useCallback(
    async (input: CreateTeamInput) => {
      const team = await bridge.invoke('team.create', input);
      await refreshTeams();
      return team;
    },
    [refreshTeams]
  );

  const deleteTeam = useCallback(
    async (teamId: string) => {
      await bridge.invoke('team.delete', { teamId });
      await refreshTeams();
    },
    [refreshTeams]
  );

  const addAgent = useCallback(
    async (teamId: string, input: AddAgentInput) => {
      const agent = await bridge.invoke('team.addAgent', { teamId, ...input });
      await refreshTeams();
      return agent;
    },
    [refreshTeams]
  );

  const updateTeam = useCallback((team: Team) => {
    setTeams((current) => current.map((item) => (item.id === team.id ? team : item)));
  }, []);

  return {
    teams,
    loading,
    error,
    refreshTeams,
    createTeam,
    deleteTeam,
    addAgent,
    updateTeam,
  };
}
