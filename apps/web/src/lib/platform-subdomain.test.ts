import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractPlatformSubdomainSlug } from './platform-subdomain';

describe('extractPlatformSubdomainSlug', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('extracts single-label subdomains for the configured root domain and localhost', () => {
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'usebaci.com');

    expect(extractPlatformSubdomainSlug('ogabassey.usebaci.com')).toBe(
      'ogabassey'
    );
    expect(extractPlatformSubdomainSlug('shop.localhost')).toBe('shop');
  });

  it('returns null for custom domains, root domains, and nested subdomains', () => {
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'usebaci.com');

    expect(extractPlatformSubdomainSlug('ogabassey.com')).toBeNull();
    expect(extractPlatformSubdomainSlug('usebaci.com')).toBeNull();
    expect(extractPlatformSubdomainSlug('a.b.usebaci.com')).toBeNull();
    expect(extractPlatformSubdomainSlug('a.b.localhost')).toBeNull();
  });
});
