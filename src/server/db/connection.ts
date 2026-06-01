import Database from 'better-sqlite3';
import { initializeSchema } from './schema';

export type Db = Database.Database;

export function openDatabase(dbPath: string): Db {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  initializeSchema(db);
  return db;
}
