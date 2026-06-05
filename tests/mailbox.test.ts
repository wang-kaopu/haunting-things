import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { openDatabase } from '@server/db/connection';
import { MailboxRepository } from '@server/db/mailboxRepository';
import { TeamRepository } from '@server/db/teamRepository';

describe('mailbox repository', () => {
  test('readUnreadAndMark returns unread messages once', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'Haunting-things-test-'));
    const db = openDatabase(path.join(dir, 'test.sqlite'));
    const teamsRepo = new TeamRepository(db);
    const mailboxRepo = new MailboxRepository(db);
    db.prepare(
      `INSERT INTO workspaces (id, name, path, kind, is_temporary, exists_on_disk, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('workspace-1', 'Test Team', dir, 'server', 0, 1, 1, 1);
    teamsRepo.createTeam({
      id: 'team-1',
      name: 'Test Team',
      workspaceId: 'workspace-1',
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

    mailboxRepo.writeMailbox({
      id: 'm1',
      teamId: 'team-1',
      toAgentId: 'agent-1',
      fromAgentId: 'user',
      content: 'hello',
      read: false,
      createdAt: 1,
    });

    const firstRead = mailboxRepo.readUnreadAndMark('team-1', 'agent-1');
    const secondRead = mailboxRepo.readUnreadAndMark('team-1', 'agent-1');

    expect(firstRead).toHaveLength(1);
    expect(firstRead[0].content).toBe('hello');
    expect(secondRead).toHaveLength(0);

    db.close();
  });

  test('openDatabase migrates legacy mailbox tables before creating unread index', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'Haunting-things-test-'));
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

  test('openDatabase rejects legacy team workspace schema instead of migrating it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'Haunting-things-test-'));
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

    expect(() => openDatabase(dbPath)).toThrow('legacy workspace TEXT column detected');
  });
});
