import type { Team, TeamWithWorkspace } from '@shared/types';

/** 团队服务依赖的持久化接口。 */
export interface TeamRepositoryPort {
  createTeam(team: Team): Team;
  updateTeam(team: Team): void;
  getTeam(id: string): Team | null;
  listTeams(): Team[];
  countTeamsByWorkspace(workspaceId: string): number;
  getTeamWithWorkspace(id: string): TeamWithWorkspace | null;
  listTeamsWithWorkspace(): TeamWithWorkspace[];
  deleteTeam(id: string): void;
}
