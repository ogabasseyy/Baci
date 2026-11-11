import { describe, expect, it } from 'vitest';
import { cartNoticeHealthSchema } from './cart-notice-health';

describe('cartNoticeHealthSchema', () => {
  it('accepts the health reading and drops unknown keys', () => {
    const parsed = cartNoticeHealthSchema.parse({
      healthy: false,
      staleUndelivered: 3,
      deadLettered24h: 0,
      extra: 'ignored',
    });
    expect(parsed).toEqual({
      healthy: false,
      staleUndelivered: 3,
      deadLettered24h: 0,
    });
  });

  it.each([
    null,
    'ok',
    { healthy: true },
    { healthy: 'true', staleUndelivered: 0, deadLettered24h: 0 },
    { healthy: true, staleUndelivered: -1, deadLettered24h: 0 },
    { healthy: true, staleUndelivered: 1.5, deadLettered24h: 0 },
    { healthy: true, staleUndelivered: 0, deadLettered24h: '0' },
  ])('rejects a malformed reading: %j', (value) => {
    expect(cartNoticeHealthSchema.safeParse(value).success).toBe(false);
  });
});
