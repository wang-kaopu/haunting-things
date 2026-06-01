import { describe, expect, it } from 'vitest';
import type { RequestPermissionRequest, SessionNotification } from '@agentclientprotocol/sdk';
import { AcpRuntime } from '../src/server/runtime/acpRuntime';
import type { AgentEvent, ConversationModels, ConversationMode, PermissionRequest } from '../src/shared/types';

function createRuntime(): AcpRuntime {
  const runtime = new AcpRuntime({
    conversationId: 'conv-1',
    backend: 'claude',
    workspace: '/tmp/workspace',
  });

  (runtime as any).activeTurnId = 'turn-1';
  return runtime;
}

describe('AcpRuntime plan and mode mappings', () => {
  it('maps plan updates and current mode updates to standard snapshots', () => {
    const runtime = createRuntime();

    const agentEvents: AgentEvent[] = [];
    const modes: ConversationMode[] = [];
    const models: ConversationModels[] = [];
    runtime.on('agentEvent', (event) => agentEvents.push(event));
    runtime.on('mode', (snapshot) => modes.push(snapshot));
    runtime.on('models', (snapshot) => models.push(snapshot));

    runtime['handleSessionUpdate']({
      update: {
        sessionUpdate: 'plan',
        entries: ['inspect', 'fix'],
      },
    } as SessionNotification);

    runtime['handleSessionUpdate']({
      update: {
        sessionUpdate: 'current_mode_update',
        mode: 'review',
      },
    } as SessionNotification);

    runtime['handleSessionUpdate']({
      update: {
        sessionUpdate: 'config_option_update',
        configId: 'model',
        value: 'sonnet-4',
      },
    } as SessionNotification);

    expect(agentEvents.at(0)).toMatchObject({
      type: 'agent.plan',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      entries: ['inspect', 'fix'],
    });
    expect(modes.at(0)).toMatchObject({
      conversationId: 'conv-1',
      mode: 'review',
    });
    expect(models.at(0)).toMatchObject({
      conversationId: 'conv-1',
      currentModelId: 'sonnet-4',
      models: [],
    });
    expect(runtime.getModeSnapshot()).toEqual(modes.at(0));
    expect(runtime.getModelsSnapshot()).toEqual(models.at(0));
  });

  it('maps tool call progress updates to update/result events', () => {
    const runtime = createRuntime();

    const agentEvents: AgentEvent[] = [];
    runtime.on('agentEvent', (event) => agentEvents.push(event));

    runtime['handleSessionUpdate']({
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Read file',
        kind: 'read_file',
        input: { path: 'src/index.ts' },
      },
    } as SessionNotification);

    runtime['handleSessionUpdate']({
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        title: 'Read file',
        kind: 'read_file',
        status: 'running',
        content: 'progress',
      },
    } as SessionNotification);

    runtime['handleSessionUpdate']({
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        title: 'Read file',
        kind: 'read_file',
        status: 'completed',
        output: { ok: true },
      },
    } as SessionNotification);

    runtime['handleSessionUpdate']({
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-2',
        title: 'Write file',
        kind: 'write_file',
        status: 'failed',
        error: { message: 'boom' },
      },
    } as SessionNotification);

    expect(agentEvents[0]).toMatchObject({
      type: 'agent.tool.call',
      toolCallId: 'tool-1',
      toolName: 'read_file',
      title: 'Read file',
      kind: 'read_file',
      input: { path: 'src/index.ts' },
    });
    expect(agentEvents[1]).toMatchObject({
      type: 'agent.tool.update',
      toolCallId: 'tool-1',
      title: 'Read file',
      kind: 'read_file',
      status: 'running',
      content: 'progress',
    });
    expect(agentEvents[2]).toMatchObject({
      type: 'agent.tool.result',
      toolCallId: 'tool-1',
      title: 'Read file',
      kind: 'read_file',
      status: 'completed',
      isError: false,
      output: { ok: true },
    });
    expect(agentEvents[3]).toMatchObject({
      type: 'agent.tool.result',
      toolCallId: 'tool-2',
      title: 'Write file',
      kind: 'write_file',
      status: 'failed',
      isError: true,
    });
    expect(agentEvents[4]).toMatchObject({
      type: 'agent.error',
      source: 'tool',
      message: 'boom',
    });
  });

  it('preserves raw tool permission payloads', async () => {
    const runtime = createRuntime();

    const permissions: PermissionRequest[] = [];
    runtime.on('permission', (request) => permissions.push(request));

    const responsePromise = runtime['handlePermissionRequest']({
      options: [
        {
          optionId: 'allow',
          name: 'Allow',
        },
      ],
      toolCall: {
        toolCallId: 'call-1',
        title: 'Open file',
        rawInput: { path: 'src/index.ts' },
      },
    } as RequestPermissionRequest);
    runtime.confirmPermission('call-1', 'allow');
    const response = await responsePromise;

    expect(permissions[0]).toMatchObject({
      conversationId: 'conv-1',
      callId: 'call-1',
      title: 'Open file',
      toolCall: {
        toolCallId: 'call-1',
        title: 'Open file',
        rawInput: { path: 'src/index.ts' },
      },
      rawInput: { path: 'src/index.ts' },
    });
    expect(permissions[0].body).toContain('"path": "src/index.ts"');
    expect(response).toBeDefined();
  });
});
