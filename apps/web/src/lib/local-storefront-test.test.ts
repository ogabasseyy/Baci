// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLocalStorefrontTest } from './local-storefront-test';

describe('isLocalStorefrontTest', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is true only with LOCAL_STOREFRONT=1', () => {
    vi.stubEnv('LOCAL_STOREFRONT', '1');
    expect(isLocalStorefrontTest()).toBe(true);
    vi.stubEnv('LOCAL_STOREFRONT', '0');
    expect(isLocalStorefrontTest()).toBe(false);
    vi.unstubAllEnvs();
    delete process.env.LOCAL_STOREFRONT;
    expect(isLocalStorefrontTest()).toBe(false);
  });
});
