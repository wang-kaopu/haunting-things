import { useCallback, useEffect, useState } from 'react';
import type { Team, TeamAgent } from '../../../shared/types';
import { bridge } from '../bridgeClient';
import type { AddAgentInput, CreateTeamInput } from '../types/ui';
import { normalizeTeam, normalizeTeamAgent, normalizeTeamAgentStatusEvent, normalizeTeamList } from '../utils/backendData';

/** Team 列表和成员变更操作状态。 */
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

/**
 * 同步 Team 列表并处理成员状态事件。
 *
 * 创建、删除和添加成员后都会刷新列表；运行中状态则通过 bridge 事件局部更新。
 */
export function useTeams(): UseTeamsResult {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshTeams = useCallback(async () => {
    try {
      setError('');
      const next = await bridge.invoke('team.list', undefined);
      setTeams(normalizeTeamList(next));
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
    const unsubStatus = bridge.on('team.agent.status', (payload) => {
      const event = normalizeTeamAgentStatusEvent(payload);
      if (!event) return;
      setTeams((current) =>
        current.map((team) =>
          team.id === event.teamId
            ? {
                ...team,
                agents: (team.agents ?? []).map((agent) =>
                  agent.slotId === event.slotId ? { ...agent, status: event.status } : agent
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
      const team = normalizeTeam(await bridge.invoke('team.create', input));
      if (!team) throw new Error('团队创建响应格式无效');
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
      const agent = normalizeTeamAgent(await bridge.invoke('team.addAgent', { teamId, ...input }));
      if (!agent) throw new Error('Agent 创建响应格式无效');
      await refreshTeams();
      return agent;
    },
    [refreshTeams]
  );

  const updateTeam = useCallback((team: Team) => {
    const nextTeam = normalizeTeam(team);
    if (!nextTeam) return;
    setTeams((current) => current.map((item) => (item.id === nextTeam.id ? nextTeam : item)));
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
