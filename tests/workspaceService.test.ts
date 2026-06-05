import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@server/db/connection';
import { openDatabase } from '@server/db/connection';
import { WorkspaceRepository } from '@server/db/workspaceRepository';
import { WorkspaceRootService, resolveInsideRoot } from '@server/services/workspaceRootService';
import { resolveInsideWorkspace, WorkspaceService } from '@server/services/workspaceService';

describe('WorkspaceService', () => {
  let rootDir: string;
  let dataDir: string;
  let projectDir: string;
  let db: Db;
  let service: WorkspaceService;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'haunting-root-'));
    dataDir = mkdtempSync(path.join(tmpdir(), 'haunting-data-'));
    projectDir = path.join(rootDir, 'project');
    mkdirSync(projectDir);
    mkdirSync(path.join(rootDir, 'node_modules'));
    writeFileSync(path.join(projectDir, 'README.md'), '# Demo');

    db = openDatabase(':memory:');
    service = new WorkspaceService(
      new WorkspaceRepository(db),
      new WorkspaceRootService(rootDir),
      dataDir
    );
  });

  afterEach(() => {
    db.close();
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('exposes the project root and browses project directories', async () => {
    expect(service.getRoot()).toEqual({
      id: 'project-root',
      name: path.basename(rootDir),
      path: path.resolve(rootDir),
    });

    const listing = await service.browse({});
    expect(listing.absolutePath).toBe(path.resolve(rootDir));
    expect(listing.parentRelativePath).toBeUndefined();
    expect(listing.entries.some((entry) => entry.name === 'node_modules')).toBe(false);
    expect(listing.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'project',
          relativePath: 'project',
          isDir: true,
        }),
      ])
    );

    const childListing = await service.browse({ relativePath: 'project' });
    expect(childListing.absolutePath).toBe(path.resolve(projectDir));
    expect(childListing.parentRelativePath).toBe('.');
  });

  it('selects a server directory and reuses the existing workspace path', async () => {
    const first = await service.selectDirectory({ relativePath: 'project' });
    const second = await service.selectDirectory({ relativePath: './project' });

    expect(first.id).toBe(second.id);
    expect(first.kind).toBe('server');
    expect(first.isTemporary).toBe(false);
    expect(first.path).toBe(path.resolve(projectDir));
  });

  it('creates temporary workspaces outside the browsed server roots', () => {
    const workspace = service.createTemporary();

    expect(workspace.kind).toBe('temporary');
    expect(workspace.isTemporary).toBe(true);
    expect(existsSync(workspace.path)).toBe(true);
    expect(service.resolveOrCreate({ workspaceId: workspace.id }).id).toBe(workspace.id);
  });

  it('rejects paths escaping roots and workspace directories', () => {
    expect(() => resolveInsideRoot(rootDir, '../outside')).toThrow('Path escapes project root');
    expect(() => resolveInsideWorkspace(projectDir, '../outside.txt')).toThrow('Path escapes workspace');
  });
});
