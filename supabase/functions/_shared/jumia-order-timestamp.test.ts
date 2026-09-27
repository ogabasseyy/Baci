import { describe, expect, it } from 'vitest';
import { formatJumiaOrderTimestamp } from './jumia-order-timestamp';

describe('formatJumiaOrderTimestamp', () => {
  it('normalizes a stored millisecond cursor to Jumia second precision', () => {
    expect(formatJumiaOrderTimestamp('2026-08-12T07:37:12.423Z')).toBe(
      '2026-08-12T07:37:12Z'
    );
  });

  it('rejects invalid stored cursors', () => {
    expect(() => formatJumiaOrderTimestamp('not-a-date')).toThrow(
      'Cannot format an invalid Jumia order timestamp'
    );
  });
});
