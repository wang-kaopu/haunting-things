import { describe, expect, it, vi } from 'vitest';
import { registerBridgeHandlers } from '@server/app/bridge/registerBridgeHandlers';
import type { Workspace } from '@shared/types';

describe('workspace automatic deletion', () => {
  it('prunes workspaces without teams or conversations when listing workspaces', async () => {
    const bridge = createBridgeHarness();
    const workspaces = createWorkspaceHarness([
      createWorkspace('empty-workspace'),
      createWorkspace('team-workspace'),
      createWorkspace('conversation-workspace'),
    ]);

    registerBridgeHandlers({
      bridge: bridge as unknown,
      attachments: {} as unknown,
      attachmentService: {} as unknown,
      conversations: {
        countByWorkspace: (workspaceId: string) => (workspaceId === 'conversation-workspace' ? 1 : 0),
      } as unknown,
      teams: {
        countByWorkspace: (workspaceId: string) => (workspaceId === 'team-workspace' ? 1 : 0),
      } as unknown,
      workspaces: workspaces as unknown,
      serverInfo: vi.fn(),
      setRemoteAccess: vi.fn(),
    });

    const result = await bridge.invoke('workspace.list', undefined) as Workspace[];

    expect(result.map((workspace: Workspace) => workspace.id)).toEqual([
      'team-workspace',
      'conversation-workspace',
    ]);
    expect(workspaces.deleteIfUnreferenced).toHaveBeenCalledWith({
      workspaceId: 'empty-workspace',
      teamCount: 0,
      conversationCount: 0,
    });
  });

  it('checks whether the workspace can be removed after deleting a team', async () => {
    const bridge = createBridgeHarness();
    const workspaces = createWorkspaceHarness([createWorkspace('workspace-a')]);
    const teamDelete = vi.fn(async () => ({ deleted: true }));

    registerBridgeHandlers({
      bridge: bridge as unknown,
      attachments: {} as unknown,
      attachmentService: {} as unknown,
      conversations: { countByWorkspace: vi.fn(() => 0) } as unknown,
      teams: {
        get: vi.fn(() => ({ id: 'team-a', workspaceId: 'workspace-a' })),
        delete: teamDelete,
        countByWorkspace: vi.fn(() => 0),
      } as unknown,
      workspaces: workspaces as unknown,
      serverInfo: vi.fn(),
      setRemoteAccess: vi.fn(),
    });

    await expect(bridge.invoke('team.delete', { teamId: 'team-a' })).resolves.toEqual({ deleted: true });

    expect(teamDelete).toHaveBeenCalledWith('team-a');
    expect(workspaces.deleteIfUnreferenced).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      teamCount: 0,
      conversationCount: 0,
    });
  });

});

/** 创建一个只记录 bridge handler 的测试桩。 */
function createBridgeHarness(): {
  register: (name: string, handler: (params: unknown) => unknown) => void;
  registerAfterResponse: (
    name: string,
    handler: (params: unknown) => { data: unknown; afterResponseSent?: () => void | Promise<void> } | Promise<{ data: unknown; afterResponseSent?: () => void | Promise<void> }>
  ) => void;
  invoke: (name: string, params: unknown) => Promise<unknown>;
} {
  const handlers = new Map<string, (params: unknown) => unknown>();

  return {
    register(name, handler) {
      handlers.set(name, handler);
    },
    registerAfterResponse(name, handler) {
      handlers.set(name, async (params) => (await handler(params)).data);
    },
    async invoke(name, params) {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`Unknown handler: ${name}`);
      return handler(params);
    },
  };
}

/** 创建可被自动清理逻辑修改的工作区服务测试桩。 */
function createWorkspaceHarness(initialWorkspaces: Workspace[]): {
  list: () => Workspace[];
  deleteIfUnreferenced: ReturnType<typeof vi.fn>;
} {
  let workspaces = [...initialWorkspaces];
  const deleteIfUnreferenced = vi.fn(
    (input: { workspaceId: string; teamCount: number; conversationCount: number }) => {
      if (input.teamCount > 0 || input.conversationCount > 0) return { deleted: false };
      workspaces = workspaces.filter((workspace) => workspace.id !== input.workspaceId);
      return { deleted: true };
    }
  );

  return {
    list: () => [...workspaces],
    deleteIfUnreferenced,
  };
}

/** 创建最小工作区对象。 */
function createWorkspace(id: string): Workspace {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    kind: 'server',
    isTemporary: false,
    existsOnDisk: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
