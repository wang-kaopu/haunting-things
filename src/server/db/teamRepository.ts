import type { Team, TeamWithWorkspace } from '@shared/types';
import type { Db } from '@server/db/connection';
import type { DatabaseRow } from '@server/db/mappers';
import { rowToTeam, rowToTeamWithWorkspace } from '@server/db/mappers';

/** 负责团队配置的持久化读写，团队成员列表以 JSON 快照保存。 */
export class TeamRepository {
  constructor(private readonly db: Db) {}

  /** 创建新的团队记录并返回业务对象，供服务层继续初始化成员会话。 */
  createTeam(team: Team): Team {
    this.db
      .prepare(
        'INSERT INTO teams (id, name, workspace_id, leader_slot_id, agents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(team.id, team.name, team.workspaceId, team.leaderSlotId, JSON.stringify(team.agents), team.createdAt, team.updatedAt);
    return team;
  }

  /** 保存团队名称、工作区、负责人和成员配置的最新快照。 */
  updateTeam(team: Team): void {
    this.db
      .prepare('UPDATE teams SET name = ?, workspace_id = ?, leader_slot_id = ?, agents = ?, updated_at = ? WHERE id = ?')
      .run(team.name, team.workspaceId, team.leaderSlotId, JSON.stringify(team.agents), Date.now(), team.id);
  }

  /** 按团队标识读取团队配置，找不到时返回空值便于服务层做权限判断。 */
  getTeam(id: string): Team | null {
    const row = this.db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as DatabaseRow | undefined;
    return row ? rowToTeam(row) : null;
  }

  /** 按最近更新时间列出团队，匹配侧边栏的默认排序。 */
  listTeams(): Team[] {
    const rows = this.db.prepare('SELECT * FROM teams ORDER BY updated_at DESC').all() as DatabaseRow[];
    return rows.map(rowToTeam);
  }

  /** 统计某个工作区下的团队数量，用于判断工作区是否可自动清理。 */
  countTeamsByWorkspace(workspaceId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM teams WHERE workspace_id = ?').get(workspaceId) as { count: number } | undefined;
    return Number(row?.count ?? 0);
  }

  /** 按 ID 读取带工作区详情的团队视图。 */
  getTeamWithWorkspace(id: string): TeamWithWorkspace | null {
    const row = this.db.prepare(teamWithWorkspaceSql('WHERE t.id = ?')).get(id) as DatabaseRow | undefined;
    return row ? rowToTeamWithWorkspace(row) : null;
  }

  /** 列出带工作区详情的团队视图。 */
  listTeamsWithWorkspace(): TeamWithWorkspace[] {
    const rows = this.db.prepare(teamWithWorkspaceSql('ORDER BY t.updated_at DESC')).all() as DatabaseRow[];
    return rows.map(rowToTeamWithWorkspace);
  }

  /** 删除团队本身；关联会话和附件清理由服务层统一编排。 */
  deleteTeam(id: string): void {
    this.db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  }
}

/** 构造团队与工作区 join 查询，避免多个读取方法重复列清单。 */
function teamWithWorkspaceSql(tail: string): string {
  return `
    SELECT
      t.*,
      w.id AS workspace__id,
      w.name AS workspace__name,
      w.path AS workspace__path,
      w.kind AS workspace__kind,
      w.is_temporary AS workspace__is_temporary,
      w.exists_on_disk AS workspace__exists_on_disk,
      w.last_opened_at AS workspace__last_opened_at,
      w.created_at AS workspace__created_at,
      w.updated_at AS workspace__updated_at
    FROM teams t
    JOIN workspaces w ON w.id = t.workspace_id
    ${tail}
  `;
}
