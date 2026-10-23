import { describe, expect, it } from 'vitest';
import { parseDraftRetryKey } from './idempotency';

describe('draft retry identity', () => {
  it('requires a stable caller-supplied UUID and never invents a retry after uncertainty', () => {
    const key = '20000000-0000-4000-8000-000000000001';
    expect(parseDraftRetryKey(key)).toBe(key);
    for (const value of [undefined, null, '', 7, 'random retry'])
      expect(() => parseDraftRetryKey(value)).toThrow();
  });
});
