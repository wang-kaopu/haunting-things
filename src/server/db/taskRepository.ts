import type { TeamTask } from '../../shared/types';
import type { Db } from './connection';
import { rowToTask } from './mappers';

export class TaskRepository {
  constructor(private readonly db: Db) {}

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

  getTask(id: string): TeamTask | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    return row ? rowToTask(row) : null;
  }

  listTasks(teamId: string): TeamTask[] {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE team_id = ? ORDER BY updated_at DESC').all(teamId) as any[];
    return rows.map(rowToTask);
  }
}

export type TaskRepositoryPort = Pick<TaskRepository, 'createTask' | 'updateTask' | 'getTask' | 'listTasks'>;
