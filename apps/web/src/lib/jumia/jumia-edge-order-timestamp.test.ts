import { describe, expect, it } from 'vitest';
import { formatJumiaOrderTimestamp } from '../../../../../supabase/functions/_shared/jumia-order-timestamp';

describe('Jumia Edge order timestamp formatting', () => {
  it('normalizes legacy millisecond cursors before sending them to Jumia', () => {
    expect(formatJumiaOrderTimestamp('2026-08-12T07:37:12.423Z')).toBe(
      '2026-08-12T07:37:12Z'
    );
  });

  it('rejects an invalid stored cursor', () => {
    expect(() => formatJumiaOrderTimestamp('invalid')).toThrow(
      'Cannot format an invalid Jumia order timestamp'
    );
  });
});
