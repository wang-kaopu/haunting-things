import type { Team } from '../../shared/types';
import type { Db } from './connection';
import { rowToTeam } from './mappers';

export class TeamRepository {
  constructor(private readonly db: Db) {}

  createTeam(team: Team): Team {
    this.db
      .prepare(
        'INSERT INTO teams (id, name, workspace, leader_slot_id, agents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(team.id, team.name, team.workspace, team.leaderSlotId, JSON.stringify(team.agents), team.createdAt, team.updatedAt);
    return team;
  }

  updateTeam(team: Team): void {
    this.db
      .prepare('UPDATE teams SET name = ?, workspace = ?, leader_slot_id = ?, agents = ?, updated_at = ? WHERE id = ?')
      .run(team.name, team.workspace, team.leaderSlotId, JSON.stringify(team.agents), Date.now(), team.id);
  }

  getTeam(id: string): Team | null {
    const row = this.db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as any;
    return row ? rowToTeam(row) : null;
  }

  listTeams(): Team[] {
    const rows = this.db.prepare('SELECT * FROM teams ORDER BY updated_at DESC').all() as any[];
    return rows.map(rowToTeam);
  }

  deleteTeam(id: string): void {
    this.db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  }
}

export type TeamRepositoryPort = Pick<TeamRepository, 'createTeam' | 'updateTeam' | 'getTeam' | 'listTeams' | 'deleteTeam'>;
