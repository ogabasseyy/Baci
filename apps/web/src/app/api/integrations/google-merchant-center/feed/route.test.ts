import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.fn();
const mockResolveFeedMerchant = vi.fn();

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ from: mockFrom }),
}));

vi.mock('@/lib/feed-identifier', () => {
  class _MerchantNotFoundError extends Error {
    constructor(identifier: string) {
      super(`Merchant not found: ${identifier}`);
      this.name = 'MerchantNotFoundError';
    }
  }

  return {
    MerchantNotFoundError: _MerchantNotFoundError,
    resolveFeedMerchant: (...args: unknown[]) =>
      mockResolveFeedMerchant(...args),
  };
});

import { MerchantNotFoundError } from '@/lib/feed-identifier';

function makeRequest(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers });
}

function mockDomainLookup(result: { data: unknown; error: unknown }) {
  const mockStatusEq = vi.fn(() => ({
    maybeSingle: () => Promise.resolve(result),
  }));
  const mockDomainEq = vi.fn(() => ({
    eq: mockStatusEq,
  }));

  mockFrom.mockReturnValue({
    select: () => ({
      eq: mockDomainEq,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_ROOT_DOMAIN;

  mockResolveFeedMerchant.mockResolvedValue({
    id: 'merchant-1',
    slug: 'ogabassey',
  });
});

describe('GET /api/integrations/google-merchant-center/feed', () => {
  it('redirects custom-domain requests to the canonical public feed URL', async () => {
    mockDomainLookup({
      data: { merchant_id: 'merchant-1', domain: 'ogabassey.com' },
      error: null,
    });
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest(
        'https://ogabassey.com/api/integrations/google-merchant-center/feed',
        { host: 'ogabassey.com' }
      )
    );

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(
      'https://ogabassey.com/api/feed/google-merchant?merchant_slug=ogabassey'
    );
    expect(mockResolveFeedMerchant).toHaveBeenCalledWith('merchant-1', false);
  });

  it('rejects a mismatched database authority instead of redirecting to another active domain', async () => {
    mockDomainLookup({
      data: { merchant_id: 'merchant-1', domain: 'other-store.example' },
      error: null,
    });
    const { GET } = await import('./route');
    const response = await GET(
      makeRequest(
        'https://ogabassey.com/api/integrations/google-merchant-center/feed',
        { host: 'ogabassey.com' }
      )
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('location')).toBeNull();
  });

  it('redirects managed subdomain requests without querying domains', async () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest(
        'https://ogabassey.usebaci.com/api/integrations/google-merchant-center/feed',
        { host: 'ogabassey.usebaci.com' }
      )
    );

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(
      'https://ogabassey.usebaci.com/api/feed/google-merchant?merchant_slug=ogabassey'
    );
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockResolveFeedMerchant).toHaveBeenCalledWith('ogabassey', true);
  });

  it('prefers host over x-forwarded-host to avoid spoofing', async () => {
    mockDomainLookup({ data: null, error: null });
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest(
        'https://internal.baci.app/api/integrations/google-merchant-center/feed',
        {
          host: 'internal.baci.app',
          'x-forwarded-host': 'ogabassey.com:443',
        }
      )
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Merchant not found');
    expect(mockResolveFeedMerchant).not.toHaveBeenCalled();
  });

  it('falls back to x-forwarded-host when host is missing and strips ports', async () => {
    mockDomainLookup({
      data: { merchant_id: 'merchant-1', domain: 'ogabassey.com' },
      error: null,
    });
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest(
        'https://internal.baci.app/api/integrations/google-merchant-center/feed',
        {
          'x-forwarded-host': 'ogabassey.com:443',
        }
      )
    );

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(
      'https://ogabassey.com/api/feed/google-merchant?merchant_slug=ogabassey'
    );
    expect(mockResolveFeedMerchant).toHaveBeenCalledWith('merchant-1', false);
  });

  it('always redirects to the verified https feed URL', async () => {
    mockDomainLookup({
      data: { merchant_id: 'merchant-1', domain: 'ogabassey.com' },
      error: null,
    });
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest(
        'https://internal.baci.app/api/integrations/google-merchant-center/feed',
        {
          host: 'ogabassey.com',
          'x-forwarded-host': 'attacker.example',
          'x-forwarded-proto': 'http',
        }
      )
    );

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(
      'https://ogabassey.com/api/feed/google-merchant?merchant_slug=ogabassey'
    );
  });

  it('returns 404 when the host cannot be mapped to a merchant', async () => {
    mockDomainLookup({ data: null, error: null });
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest(
        'https://unknown-store.com/api/integrations/google-merchant-center/feed',
        { host: 'unknown-store.com' }
      )
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Merchant not found');
  });

  it('returns 500 when domain lookup fails', async () => {
    mockDomainLookup({
      data: null,
      error: { message: 'db offline' },
    });
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest(
        'https://ogabassey.com/api/integrations/google-merchant-center/feed',
        { host: 'ogabassey.com' }
      )
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to resolve merchant for legacy feed URL');
  });

  it('returns 404 when merchant resolution fails after a domain lookup', async () => {
    mockDomainLookup({
      data: { merchant_id: 'merchant-1', domain: 'ogabassey.com' },
      error: null,
    });
    mockResolveFeedMerchant.mockRejectedValue(
      new MerchantNotFoundError('merchant-1')
    );
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest(
        'https://ogabassey.com/api/integrations/google-merchant-center/feed',
        { host: 'ogabassey.com' }
      )
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Merchant not found');
  });

  it('returns 404 when the verified domain is not a safe hostname', async () => {
    mockDomainLookup({
      data: { merchant_id: 'merchant-1', domain: 'evil.com/path' },
      error: null,
    });
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest(
        'https://ogabassey.com/api/integrations/google-merchant-center/feed',
        { host: 'ogabassey.com' }
      )
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Merchant not found');
    expect(mockResolveFeedMerchant).not.toHaveBeenCalled();
  });

  describe('open-redirect hardening (CodeScanning #1397)', () => {
    it('rejects attacker-controlled Host headers not present in the domains table', async () => {
      mockDomainLookup({ data: null, error: null });
      const { GET } = await import('./route');

      const response = await GET(
        makeRequest(
          'https://evil.com/api/integrations/google-merchant-center/feed',
          { host: 'evil.com' }
        )
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Merchant not found');
      // The attacker host must never appear in a Location header.
      expect(response.headers.get('location')).toBeNull();
    });

    it('rejects a confusable subdomain that pretends to be a managed Baci domain', async () => {
      mockDomainLookup({ data: null, error: null });
      const { GET } = await import('./route');

      const response = await GET(
        makeRequest(
          'https://evil.usebaci.com.attacker.tld/api/integrations/google-merchant-center/feed',
          { host: 'evil.usebaci.com.attacker.tld' }
        )
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Merchant not found');
      expect(mockResolveFeedMerchant).not.toHaveBeenCalled();
    });

    it('normalizes Host header case and still redirects to the canonical lower-case host', async () => {
      process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
      const { GET } = await import('./route');

      const response = await GET(
        makeRequest(
          'https://OGABASSEY.usebaci.com/api/integrations/google-merchant-center/feed',
          { host: 'OGABASSEY.usebaci.com' }
        )
      );

      expect(response.status).toBe(308);
      expect(response.headers.get('location')).toBe(
        'https://ogabassey.usebaci.com/api/feed/google-merchant?merchant_slug=ogabassey'
      );
    });

    it('rejects hosts with leading whitespace that would be unsafe to redirect to', async () => {
      mockDomainLookup({ data: null, error: null });
      const { GET } = await import('./route');

      const response = await GET(
        makeRequest(
          'https://example.test/api/integrations/google-merchant-center/feed',
          { host: '  evil.com' }
        )
      );
      const body = await response.json();

      // normalizeHost trims, but the DB lookup for `evil.com` returns null.
      expect(response.status).toBe(404);
      expect(body.error).toBe('Merchant not found');
    });

    it('rejects DB rows whose domain column embeds a path (unsafe hostname)', async () => {
      // Defence-in-depth: a malformed/poisoned row must never produce a
      // redirect. `isSafeHostname` filters out anything with a path,
      // scheme, or non-hostname character. (We already test the
      // `evil.com/path` case in the original suite — this test pins the
      // failure mode behind the new allow-list as well.)
      mockDomainLookup({
        data: { merchant_id: 'merchant-1', domain: 'evil.com//api/feed' },
        error: null,
      });
      const { GET } = await import('./route');

      const response = await GET(
        makeRequest(
          'https://ogabassey.com/api/integrations/google-merchant-center/feed',
          { host: 'ogabassey.com' }
        )
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Merchant not found');
      expect(response.headers.get('location')).toBeNull();
    });

    it('rejects a verified-host domain with a trailing dot (FQDN variant)', async () => {
      mockDomainLookup({
        data: { merchant_id: 'merchant-1', domain: 'ogabassey.com.' },
        error: null,
      });
      const { GET } = await import('./route');

      const response = await GET(
        makeRequest(
          'https://ogabassey.com/api/integrations/google-merchant-center/feed',
          { host: 'ogabassey.com' }
        )
      );
      const body = await response.json();

      // Trailing dot is not a safe hostname per HOSTNAME_PATTERN.
      expect(response.status).toBe(404);
      expect(body.error).toBe('Merchant not found');
      expect(mockResolveFeedMerchant).not.toHaveBeenCalled();
    });
  });
});
