import type { Repository } from './db';

export type TaskRepository = Pick<Repository, 'createTask' | 'updateTask' | 'getTask' | 'listTasks'>;
