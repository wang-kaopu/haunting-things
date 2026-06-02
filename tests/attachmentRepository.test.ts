import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AttachmentRepository } from '../src/server/db/attachmentRepository';
import { openDatabase } from '../src/server/db/connection';
import { AttachmentService } from '../src/server/services/attachmentService';

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l6Rj2wAAAABJRU5ErkJggg==';

describe('AttachmentRepository', () => {
  it('stores uploaded image metadata and resolves message relations in order', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'Haunting-things-attachments-'));
    const db = openDatabase(path.join(dir, 'test.sqlite'));
    const repo = new AttachmentRepository(db);
    const service = new AttachmentService(path.join(dir, 'attachments'));

    const first = repo.createAttachment(
      await service.saveImage({
        fileName: 'first.png',
        mimeType: 'image/png',
        dataBase64: PNG_1X1_BASE64,
      })
    );
    const second = repo.createAttachment(
      await service.saveImage({
        fileName: '.jpg',
        mimeType: 'image/jpeg',
        dataBase64: `data:image/png;base64,${PNG_1X1_BASE64}`,
      })
    );

    repo.linkMessageAttachments('message-1', [second.id, first.id]);
    repo.linkMailboxAttachments('mailbox-1', [first.id]);

    expect(repo.listAttachments([second.id, first.id]).map((item) => item.id)).toEqual([second.id, first.id]);
    expect(repo.listMessageAttachments('message-1').map((item) => item.id)).toEqual([second.id, first.id]);
    expect(repo.listMailboxAttachments('mailbox-1')).toMatchObject([
      {
        id: first.id,
        kind: 'image',
        name: 'first.png',
        mimeType: 'image/png',
        url: expect.stringContaining('/api/attachments/'),
      },
    ]);
    expect(second.name).toBe('image.jpg');

    const deleted = repo.deleteMessage('message-1');
    await service.deleteStoredFiles(deleted);
    expect(repo.getAttachment(second.id)).toBeNull();
    expect(existsSync(path.dirname(second.path))).toBe(false);
    expect(repo.getAttachment(first.id)).toMatchObject({ id: first.id });

    db.close();
  });

  it('removes team-related unreferenced attachment files', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'Haunting-things-team-attachments-'));
    const db = openDatabase(path.join(dir, 'test.sqlite'));
    const repo = new AttachmentRepository(db);
    const service = new AttachmentService(path.join(dir, 'attachments'));
    const now = Date.now();

    db.prepare(
      `INSERT INTO teams (id, name, workspace, leader_slot_id, agents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('team-1', 'Alpha', dir, 'leader', '[]', now, now);
    db.prepare(
      `INSERT INTO conversations (id, backend, name, workspace, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('conversation-1', 'codex', 'Alpha', dir, 'idle', now, now);
    db.prepare(
      `INSERT INTO mailbox (id, team_id, to_agent_id, from_agent_id, content, read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('mailbox-1', 'team-1', 'leader', 'user', 'hello', 0, now);
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
    ).run('message-1', 'conversation-1', 'user', 'hello', 'done', now);

    const attachment = repo.createAttachment(
      await service.saveImage({
        fileName: 'image.png',
        mimeType: 'image/png',
        dataBase64: PNG_1X1_BASE64,
      })
    );
    repo.linkMailboxAttachments('mailbox-1', [attachment.id]);
    repo.linkMessageAttachments('message-1', [attachment.id]);

    const deleted = repo.deleteTeamAttachments('team-1', ['conversation-1']);
    await service.deleteStoredFiles(deleted);

    expect(repo.getAttachment(attachment.id)).toBeNull();
    expect(existsSync(path.dirname(attachment.path))).toBe(false);

    db.close();
  });
});
