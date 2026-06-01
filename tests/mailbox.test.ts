import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';
import { openDatabase, Repository } from '../src/server/db/db';

describe('mailbox repository', () => {
  test('readUnreadAndMark returns unread messages once', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'haunting-souls-test-'));
    const db = openDatabase(path.join(dir, 'test.sqlite'));
    const repo = new Repository(db);
    repo.createTeam({
      id: 'team-1',
      name: 'Test Team',
      workspace: dir,
      leaderSlotId: 'agent-1',
      agents: [
        {
          slotId: 'agent-1',
          conversationId: 'conversation-1',
          role: 'leader',
          backend: 'claude',
          name: 'Leader',
          status: 'idle',
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    });

    repo.writeMailbox({
      id: 'm1',
      teamId: 'team-1',
      toAgentId: 'agent-1',
      fromAgentId: 'user',
      content: 'hello',
      read: false,
      createdAt: 1,
    });

    const firstRead = repo.readUnreadAndMark('team-1', 'agent-1');
    const secondRead = repo.readUnreadAndMark('team-1', 'agent-1');

    expect(firstRead).toHaveLength(1);
    expect(firstRead[0].content).toBe('hello');
    expect(secondRead).toHaveLength(0);

    db.close();
  });

  test('openDatabase migrates legacy mailbox tables before creating unread index', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'haunting-souls-test-'));
    const dbPath = path.join(dir, 'legacy.sqlite');
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE mailbox (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        from_agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    legacyDb.close();

    const db = openDatabase(dbPath);
    const columns = db.prepare('PRAGMA table_info(mailbox)').all() as Array<{ name: string }>;

    expect(columns.some((column) => column.name === 'summary')).toBe(true);
    expect(columns.some((column) => column.name === 'read')).toBe(true);

    db.close();
  });

  test('openDatabase migrates legacy team tables with missing agents json', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'haunting-souls-test-'));
    const dbPath = path.join(dir, 'legacy-team.sqlite');
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        workspace TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO teams (id, name, workspace, created_at, updated_at)
      VALUES ('team-1', 'Legacy Team', '${dir.replaceAll("'", "''")}', 1, 1);
    `);
    legacyDb.close();

    const db = openDatabase(dbPath);
    const repo = new Repository(db);
    const teams = repo.listTeams();

    expect(teams).toHaveLength(1);
    expect(teams[0].leaderSlotId).toBe('leader');
    expect(teams[0].agents).toEqual([]);

    db.close();
  });
});
