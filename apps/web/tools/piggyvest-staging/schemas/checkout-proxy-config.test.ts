import { describe, expect, it } from 'vitest';
import { checkoutProxyConfigSchema } from './checkout-proxy-config';

describe('checkout proxy config schema', () => {
  it('accepts an explicit version-three route list', () => {
    expect(
      checkoutProxyConfigSchema.safeParse({
        version: 3,
        routes: [{ handle: 'filesystem' }],
      }).success
    ).toBe(true);
  });

  it.each([
    null,
    { version: 3, routes: [] },
    { version: 2, routes: [{}] },
    { version: 3, routes: [{}], rewrites: [] },
    { version: 3, routes: Array.from({ length: 101 }, () => ({})) },
  ])('refuses unreviewed config shape: %j', (input) => {
    expect(checkoutProxyConfigSchema.safeParse(input).success).toBe(false);
  });
});
