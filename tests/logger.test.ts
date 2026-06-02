import { describe, expect, it } from 'vitest';
import { formatValue } from '../src/server/utils/logger';

describe('logger formatting', () => {
  it('keeps long string values complete', () => {
    const value = 'x'.repeat(300);

    expect(formatValue(value)).toBe(JSON.stringify(value));
  });

  it('keeps long object values complete', () => {
    const value = { text: 'x'.repeat(300), items: Array.from({ length: 20 }, (_, index) => index) };

    expect(formatValue(value)).toBe(JSON.stringify(value));
  });
});
