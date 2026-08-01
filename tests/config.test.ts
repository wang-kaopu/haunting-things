import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRendererDist } from '@server/config';

const originalRendererDist = process.env.HAUNTING_RENDERER_DIST;

afterEach(() => {
  if (originalRendererDist === undefined) {
    delete process.env.HAUNTING_RENDERER_DIST;
    return;
  }

  process.env.HAUNTING_RENDERER_DIST = originalRendererDist;
});

describe('server config', () => {
  it('allows overriding the renderer asset directory for custom deployments', () => {
    process.env.HAUNTING_RENDERER_DIST = 'custom-renderer';

    expect(loadRendererDist()).toBe(path.resolve('custom-renderer'));
  });
});
