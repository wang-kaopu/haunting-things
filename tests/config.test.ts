import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPackageRoot, loadRendererDist } from '@server/config';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalRendererDist = process.env.HAUNTING_RENDERER_DIST;

afterEach(() => {
  if (originalRendererDist === undefined) {
    delete process.env.HAUNTING_RENDERER_DIST;
    return;
  }

  process.env.HAUNTING_RENDERER_DIST = originalRendererDist;
});

describe('server config', () => {
  it('resolves packaged renderer assets independently from the current directory', () => {
    expect(loadPackageRoot()).toBe(projectRoot);
    expect(loadRendererDist()).toBe(path.join(projectRoot, 'dist/renderer'));
  });

  it('allows overriding the renderer asset directory for custom deployments', () => {
    process.env.HAUNTING_RENDERER_DIST = 'custom-renderer';

    expect(loadRendererDist()).toBe(path.resolve('custom-renderer'));
  });
});
