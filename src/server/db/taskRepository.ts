import type { TeamTask } from '@shared/types';
import type { Db } from '@server/db/connection';
import type { DatabaseRow } from '@server/db/mappers';
import { rowToTask } from '@server/db/mappers';

/** 负责团队任务的持久化，供 Agent 间协作和任务状态展示使用。 */
export class TaskRepository {
  constructor(private readonly db: Db) {}

  /** 创建团队任务，并保留创建者、指派者和完成者等协作元数据。 */
  createTask(task: TeamTask): TeamTask {
    this.db
      .prepare(
        'INSERT INTO tasks (id, team_id, title, description, status, created_by_slot_id, assigned_slot_id, completed_by_slot_id, completion_summary, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        task.id,
        task.teamId,
        task.title,
        task.description ?? null,
        task.status,
        task.createdBySlotId ?? null,
        task.assignedSlotId ?? null,
        task.completedBySlotId ?? null,
        task.completionSummary ?? null,
        task.createdAt,
        task.updatedAt,
        task.completedAt ?? null
      );
    return task;
  }

  /** 更新任务可变字段，包括完成相关元数据。 */
  updateTask(task: TeamTask): void {
    this.db
      .prepare(
        'UPDATE tasks SET title = ?, description = ?, status = ?, created_by_slot_id = ?, assigned_slot_id = ?, completed_by_slot_id = ?, completion_summary = ?, updated_at = ?, completed_at = ? WHERE id = ?'
      )
      .run(
        task.title,
        task.description ?? null,
        task.status,
        task.createdBySlotId ?? null,
        task.assignedSlotId ?? null,
        task.completedBySlotId ?? null,
        task.completionSummary ?? null,
        task.updatedAt,
        task.completedAt ?? null,
        task.id
      );
  }

  /** 按任务标识读取单条任务，用于更新前校验和状态回显。 */
  getTask(id: string): TeamTask | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as DatabaseRow | undefined;
    return row ? rowToTask(row) : null;
  }

  /** 列出团队内任务，按最近更新优先显示。 */
  listTasks(teamId: string): TeamTask[] {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE team_id = ? ORDER BY updated_at DESC').all(teamId) as DatabaseRow[];
    return rows.map(rowToTask);
  }
}
