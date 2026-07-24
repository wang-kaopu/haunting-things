import { describe, expect, it } from 'vitest';
import { classifyAgentEvent } from '@server/agentEventPolicy';

describe('classifyAgentEvent', () => {
  it('marks streaming and update events according to the logging policy', () => {
    expect(classifyAgentEvent({ type: 'agent.reply.delta' } as unknown)).toMatchObject({
      persist: false,
      realtime: true,
      activity: false,
    });
    expect(classifyAgentEvent({ type: 'agent.thinking' } as unknown)).toMatchObject({
      persist: false,
      realtime: true,
      activity: true,
    });
    expect(classifyAgentEvent({ type: 'agent.tool.update', status: 'running' } as unknown)).toMatchObject({
      persist: false,
      realtime: true,
      activity: true,
    });
    expect(classifyAgentEvent({ type: 'agent.tool.update', status: 'completed' } as unknown)).toMatchObject({
      persist: true,
      realtime: true,
      activity: true,
    });
    expect(classifyAgentEvent({ type: 'agent.reply.done' } as unknown)).toMatchObject({
      persist: true,
      realtime: true,
      activity: false,
    });
  });
});
