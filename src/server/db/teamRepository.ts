import type { Team } from '@shared/types';
import type { Db } from '@server/db/connection';
import { rowToTeam } from '@server/db/mappers';

/** 负责团队配置的持久化读写，团队成员列表以 JSON 快照保存。 */
export class TeamRepository {
  constructor(private readonly db: Db) {}

  /** 创建新的团队记录并返回业务对象，供服务层继续初始化成员会话。 */
  createTeam(team: Team): Team {
    this.db
      .prepare(
        'INSERT INTO teams (id, name, workspace, leader_slot_id, agents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(team.id, team.name, team.workspace, team.leaderSlotId, JSON.stringify(team.agents), team.createdAt, team.updatedAt);
    return team;
  }

  /** 保存团队名称、工作区、负责人和成员配置的最新快照。 */
  updateTeam(team: Team): void {
    this.db
      .prepare('UPDATE teams SET name = ?, workspace = ?, leader_slot_id = ?, agents = ?, updated_at = ? WHERE id = ?')
      .run(team.name, team.workspace, team.leaderSlotId, JSON.stringify(team.agents), Date.now(), team.id);
  }

  /** 按团队标识读取团队配置，找不到时返回空值便于服务层做权限判断。 */
  getTeam(id: string): Team | null {
    const row = this.db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as any;
    return row ? rowToTeam(row) : null;
  }

  /** 按最近更新时间列出团队，匹配侧边栏的默认排序。 */
  listTeams(): Team[] {
    const rows = this.db.prepare('SELECT * FROM teams ORDER BY updated_at DESC').all() as any[];
    return rows.map(rowToTeam);
  }

  /** 删除团队本身；关联会话和附件清理由服务层统一编排。 */
  deleteTeam(id: string): void {
    this.db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  }
}

export type TeamRepositoryPort = Pick<TeamRepository, 'createTeam' | 'updateTeam' | 'getTeam' | 'listTeams' | 'deleteTeam'>;
