import type { Repository } from './db';

export type TeamRepository = Pick<Repository, 'createTeam' | 'updateTeam' | 'getTeam' | 'listTeams' | 'deleteTeam'>;
