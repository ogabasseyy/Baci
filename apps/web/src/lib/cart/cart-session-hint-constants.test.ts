import { describe, expect, it } from 'vitest';
import { CART_SESSION_HINT_TTL_SECONDS } from './cart-session-hint-constants';

describe('CART_SESSION_HINT_TTL_SECONDS', () => {
  it('defines 1-hour empty and 30-day active cookie TTLs', () => {
    expect(CART_SESSION_HINT_TTL_SECONDS.empty).toBe(3600);
    expect(CART_SESSION_HINT_TTL_SECONDS.active).toBe(2_592_000);
  });
});
