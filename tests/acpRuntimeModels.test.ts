import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationMode, ConversationModels } from '@shared/types';

const { spawnMock, connectionMock } = vi.hoisted(() => {
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
    loadSession: vi.fn(async () => ({})),
    unstable_resumeSession: vi.fn(async () => ({})),
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

vi.mock('@server/runtime/agentRegistry', () => ({
  getBridgePackageVersioned: () => 'mock-bridge',
}));

vi.mock('@server/runtime/ndjsonTransport', () => ({
  ndjsonFromChildProcess: () => ({}),
}));

vi.mock('@agentclientprotocol/sdk', () => ({
  PROTOCOL_VERSION: 'test-protocol',
  ClientSideConnection: vi.fn(function ClientSideConnection() {
    return connectionMock;
  }),
}));

import { AcpRuntime } from '@server/runtime/acpRuntime';

describe('AcpRuntime models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionMock.initialize.mockResolvedValue({});
    connectionMock.newSession.mockResolvedValue({
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
    });
    connectionMock.loadSession.mockResolvedValue({});
    connectionMock.unstable_resumeSession.mockResolvedValue({});
  });

  it('applies the configured model then switches Claude startup mode to default', async () => {
    const runtime = new AcpRuntime({
      conversationId: 'conv-1',
      backend: 'claude',
      workspacePath: process.cwd(),
      model: 'sonnet-4',
    });

    let modelSnapshot: ConversationModels | undefined;
    let modeSnapshot: ConversationMode | undefined;
    runtime.on('models', (snapshot) => {
      modelSnapshot = snapshot;
    });
    runtime.on('mode', (snapshot) => {
      modeSnapshot = snapshot;
    });

    await (runtime as unknown).ensureStarted();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(connectionMock.initialize).toHaveBeenCalledTimes(1);
    expect(connectionMock.newSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: process.cwd(),
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
    expect(modelSnapshot).toMatchObject({
      conversationId: 'conv-1',
      currentModelId: 'sonnet-4',
      models: expect.arrayContaining([
        expect.objectContaining({ id: 'sonnet-4', name: 'Sonnet 4' }),
      ]),
    });
    expect(modeSnapshot).toMatchObject({
      conversationId: 'conv-1',
      mode: 'default',
    });
    expect(runtime.getModelsSnapshot()).toEqual(modelSnapshot);
    expect(runtime.getModeSnapshot()).toEqual(modeSnapshot);
  });

  it('switches session mode and emits a local snapshot', async () => {
    const runtime = new AcpRuntime({
      conversationId: 'conv-1',
      backend: 'claude',
      workspacePath: process.cwd(),
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

  it('loads a persisted ACP session when the agent supports session/load', async () => {
    connectionMock.initialize.mockResolvedValue({
      agentCapabilities: {
        loadSession: true,
      },
    });
    const runtime = new AcpRuntime({
      conversationId: 'conv-1',
      backend: 'claude',
      workspacePath: process.cwd(),
      resumeSessionId: 'session-old',
    });

    const sessions: string[] = [];
    runtime.on('session', (event) => sessions.push(event.sessionId));

    await (runtime as unknown).ensureStarted();

    expect(connectionMock.loadSession).toHaveBeenCalledWith({
      cwd: process.cwd(),
      mcpServers: [],
      sessionId: 'session-old',
    });
    expect(connectionMock.newSession).not.toHaveBeenCalled();
    expect(connectionMock.setSessionMode).toHaveBeenCalledWith({
      sessionId: 'session-old',
      modeId: 'default',
    });
    expect(sessions).toEqual(['session-old']);
  });

  it('creates a new ACP session when the persisted session is missing remotely', async () => {
    connectionMock.initialize.mockResolvedValue({
      agentCapabilities: {
        loadSession: true,
      },
    });
    connectionMock.loadSession.mockRejectedValue(new Error('Resource not found'));
    connectionMock.newSession.mockResolvedValue({
      sessionId: 'session-new',
    });
    const runtime = new AcpRuntime({
      conversationId: 'conv-1',
      backend: 'claude',
      workspacePath: process.cwd(),
      resumeSessionId: 'session-old',
    });

    const sessions: string[] = [];
    runtime.on('session', (event) => sessions.push(event.sessionId));

    await (runtime as unknown).ensureStarted();

    expect(connectionMock.loadSession).toHaveBeenCalledWith({
      cwd: process.cwd(),
      mcpServers: [],
      sessionId: 'session-old',
    });
    expect(connectionMock.newSession).toHaveBeenCalledWith({
      cwd: process.cwd(),
      mcpServers: [],
    });
    expect(connectionMock.setSessionMode).toHaveBeenCalledWith({
      sessionId: 'session-new',
      modeId: 'default',
    });
    expect(sessions).toEqual(['session-new']);
  });

  it('resumes a persisted ACP session when only session/resume is available', async () => {
    connectionMock.initialize.mockResolvedValue({
      agentCapabilities: {
        sessionCapabilities: {
          resume: {},
        },
      },
    });
    const runtime = new AcpRuntime({
      conversationId: 'conv-1',
      backend: 'claude',
      workspacePath: process.cwd(),
      resumeSessionId: 'session-old',
    });

    await (runtime as unknown).ensureStarted();

    expect(connectionMock.unstable_resumeSession).toHaveBeenCalledWith({
      cwd: process.cwd(),
      mcpServers: [],
      sessionId: 'session-old',
    });
    expect(connectionMock.newSession).not.toHaveBeenCalled();
    expect(connectionMock.setSessionMode).toHaveBeenCalledWith({
      sessionId: 'session-old',
      modeId: 'default',
    });
  });
});
