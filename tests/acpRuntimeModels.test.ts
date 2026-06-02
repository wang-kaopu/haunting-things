import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationMode, ConversationModels } from '../src/shared/types';

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
      modes: {
        availableModes: [
          { modeId: 'default', name: 'Default' },
          { modeId: 'auto', name: 'Auto' },
        ],
        currentModeId: 'default',
      },
    })),
    unstable_setSessionModel: vi.fn(async () => ({})),
    setSessionMode: vi.fn(async () => ({})),
    prompt: vi.fn(async () => ({})),
  };

  const spawnMock = vi.fn(() => childMock);
  return { spawnMock, connectionMock, childMock };
});

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('../src/server/runtime/agentRegistry', () => ({
  getBridgePackageVersioned: () => 'mock-bridge',
}));

vi.mock('../src/server/runtime/ndjsonTransport', () => ({
  ndjsonFromChildProcess: () => ({}),
}));

vi.mock('@agentclientprotocol/sdk', () => ({
  PROTOCOL_VERSION: 'test-protocol',
  ClientSideConnection: vi.fn(function ClientSideConnection() {
    return connectionMock;
  }),
}));

import { AcpRuntime } from '../src/server/runtime/acpRuntime';

describe('AcpRuntime models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies the configured model then switches Claude startup mode to default', async () => {
    const runtime = new AcpRuntime({
      conversationId: 'conv-1',
      backend: 'claude',
      workspace: '/tmp/workspace',
      model: 'sonnet-4',
    });

    const snapshots: ConversationModels[] = [];
    const modes: ConversationMode[] = [];
    runtime.on('models', (snapshot) => {
      snapshots.push(snapshot);
    });
    runtime.on('mode', (snapshot) => {
      modes.push(snapshot);
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
    expect(connectionMock.setSessionMode).toHaveBeenCalledWith({
      sessionId: 'session-1',
      modeId: 'default',
    });
    expect(connectionMock.unstable_setSessionModel.mock.invocationCallOrder[0]).toBeLessThan(
      connectionMock.setSessionMode.mock.invocationCallOrder[0]
    );
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
    expect(modes).toHaveLength(2);
    expect(modes[0]).toMatchObject({
      conversationId: 'conv-1',
      mode: 'default',
    });
    expect(modes[1]).toMatchObject({
      conversationId: 'conv-1',
      mode: 'default',
    });
    expect(runtime.getModelsSnapshot()).toEqual(snapshots[1]);
    expect(runtime.getModeSnapshot()).toEqual(modes[1]);
  });

  it('switches session mode and emits a local snapshot', async () => {
    const runtime = new AcpRuntime({
      conversationId: 'conv-1',
      backend: 'claude',
      workspace: '/tmp/workspace',
    });

    const modes: ConversationMode[] = [];
    runtime.on('mode', (snapshot) => {
      modes.push(snapshot);
    });

    const snapshot = await runtime.setSessionMode('plan');

    expect(connectionMock.setSessionMode).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      modeId: 'plan',
    });
    expect(snapshot).toMatchObject({
      conversationId: 'conv-1',
      mode: 'plan',
    });
    expect(modes.at(-1)).toEqual(snapshot);
    expect(runtime.getModeSnapshot()).toEqual(snapshot);
  });
});
