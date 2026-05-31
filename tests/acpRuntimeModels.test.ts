import { describe, expect, it, vi } from 'vitest';
import type { ConversationModels } from '../src/shared/types';

const { spawnMock, connectionMock, childMock } = vi.hoisted(() => {
  const childMock = {
    stderr: { on: vi.fn() },
    once: vi.fn(),
    kill: vi.fn(),
  };

  const connectionMock = {
    initialize: vi.fn(async () => ({})),
    newSession: vi.fn(async () => ({
      sessionId: 'session-1',
      models: {
        availableModels: [
          { modelId: 'sonnet-4', name: 'Sonnet 4', description: 'Fast and capable' },
          { modelId: 'haiku-3', name: 'Haiku 3', description: 'Cheap and fast' },
        ],
        currentModelId: 'sonnet-4',
      },
    })),
    unstable_setSessionModel: vi.fn(async () => ({})),
    prompt: vi.fn(async () => ({})),
  };

  const spawnMock = vi.fn(() => childMock);
  return { spawnMock, connectionMock, childMock };
});

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('../src/server/agentRegistry', () => ({
  getBridgePackageVersioned: () => 'mock-bridge',
}));

vi.mock('../src/server/ndjsonTransport', () => ({
  ndjsonFromChildProcess: () => ({}),
}));

vi.mock('@agentclientprotocol/sdk', () => ({
  PROTOCOL_VERSION: 'test-protocol',
  ClientSideConnection: vi.fn(function ClientSideConnection() {
    return connectionMock;
  }),
}));

import { AcpRuntime } from '../src/server/acpRuntime';

describe('AcpRuntime models', () => {
  it('applies the configured model after newSession and emits the model snapshot', async () => {
    const runtime = new AcpRuntime({
      conversationId: 'conv-1',
      backend: 'claude',
      workspace: '/tmp/workspace',
      model: 'sonnet-4',
    });

    const snapshots: ConversationModels[] = [];
    runtime.on('models', (snapshot) => {
      snapshots.push(snapshot);
    });

    await (runtime as any).ensureStarted();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(connectionMock.initialize).toHaveBeenCalledTimes(1);
    expect(connectionMock.newSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/workspace',
        mcpServers: [],
      })
    );
    expect(connectionMock.unstable_setSessionModel).toHaveBeenCalledWith({
      sessionId: 'session-1',
      modelId: 'sonnet-4',
    });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({
      conversationId: 'conv-1',
      currentModelId: 'sonnet-4',
      models: expect.arrayContaining([
        expect.objectContaining({ id: 'sonnet-4', name: 'Sonnet 4' }),
      ]),
    });
    expect(snapshots[1]).toMatchObject({
      conversationId: 'conv-1',
      currentModelId: 'sonnet-4',
      models: expect.arrayContaining([
        expect.objectContaining({ id: 'sonnet-4', name: 'Sonnet 4' }),
      ]),
    });
    expect(runtime.getModelsSnapshot()).toEqual(snapshots[1]);
  });
});
