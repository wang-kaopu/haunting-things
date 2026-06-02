import Database from 'better-sqlite3';
import { initializeSchema } from './schema';

export type Db = Database.Database;

/**
 * 打开 SQLite 数据库并确保 schema 已迁移到当前版本。
 */
export function openDatabase(dbPath: string): Db {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  initializeSchema(db);
  return db;
}
