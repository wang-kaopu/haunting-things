import type { TeamTask } from '@shared/types';

/** 团队任务服务依赖的持久化接口。 */
export interface TaskRepositoryPort {
  createTask(task: TeamTask): TeamTask;
  updateTask(task: TeamTask): void;
  getTask(id: string): TeamTask | null;
  listTasks(teamId: string): TeamTask[];
}
