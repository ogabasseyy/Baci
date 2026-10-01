import { describe, expect, it } from 'vitest';
import { createProductImageRateLimiter } from './product-image-rate-limit';

describe('product image rate limit', () => {
  it('bounds image requests independently and resets after a minute', () => {
    const check = createProductImageRateLimiter();
    for (let count = 0; count < 240; count++) {
      expect(check('client', 1000).allowed).toBe(true);
    }
    expect(check('client', 1000)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(check('other-client', 1000).allowed).toBe(true);
    expect(check('client', 61_000).allowed).toBe(true);
  });
});
