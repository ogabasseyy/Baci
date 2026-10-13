import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDashboardStoreUrl } from './dashboard-store-url';

describe('buildDashboardStoreUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns # when the merchant has no slug', () => {
    expect(buildDashboardStoreUrl(null)).toBe('#');
    expect(buildDashboardStoreUrl(undefined)).toBe('#');
    expect(buildDashboardStoreUrl({ slug: null })).toBe('#');
  });

  it('returns a relative path in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(buildDashboardStoreUrl({ slug: 'acme' })).toBe('/acme');
  });

  it('prefers the custom domain in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(
      buildDashboardStoreUrl({ slug: 'acme', custom_domain: 'shop.acme.com' })
    ).toBe('https://shop.acme.com');
  });

  it('falls back to the subdomain URL in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'usebaci.com');
    expect(buildDashboardStoreUrl({ slug: 'acme' })).toBe(
      'https://acme.usebaci.com'
    );
  });
});
