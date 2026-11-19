import { afterEach, describe, expect, it } from 'vitest';
import { buildLauncherScopedPath } from './build-launcher-scoped-path';

describe('buildLauncherScopedPath', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('keeps the storefront prefix the launcher was served under', () => {
    window.history.replaceState(null, '', '/shop/checkout/bnpl?orderId=1');

    expect(buildLauncherScopedPath('/order-success')).toBe(
      '/shop/order-success'
    );
  });

  it('returns the target unchanged when the launcher has no prefix', () => {
    window.history.replaceState(null, '', '/checkout/bnpl');

    expect(buildLauncherScopedPath('/order-success')).toBe('/order-success');
  });
});
