import { beforeEach, describe, expect, it, vi } from 'vitest';

const oauthRouteMocks = vi.hoisted(() => ({
  getMerchantByIdentifier: vi.fn(),
  signInWithOAuth: vi.fn(),
  verifiedDomains: [] as string[],
  merchant: {
    business_name: 'Baci Store',
    id: 'merchant-1',
    is_published: true,
    custom_domain: 'ogabassey.com',
    slug: 'ogabassey',
  },
}));

vi.mock('@/env', () => ({
  getAppUrl: () => 'https://usebaci.com',
  getRootDomain: () => 'usebaci.com',
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve({})),
}));

// The route resolves merchants through the alias-aware helper. Mock that
// boundary so this route test never reaches Supabase or the alias cache.
vi.mock('@/lib/get-merchant-by-identifier-or-alias', () => ({
  getMerchantByIdentifierOrAlias: oauthRouteMocks.getMerchantByIdentifier,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      signInWithOAuth: oauthRouteMocks.signInWithOAuth,
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            not: async () => ({
              data: oauthRouteMocks.verifiedDomains.map((domain) => ({
                domain,
              })),
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}));

function makeRequest(body: Record<string, unknown>) {
  return new Request('https://usebaci.com/api/storefront/auth/google', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

describe('POST /api/storefront/auth/google', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    oauthRouteMocks.verifiedDomains = [];
    oauthRouteMocks.getMerchantByIdentifier.mockResolvedValue(
      oauthRouteMocks.merchant
    );
    oauthRouteMocks.signInWithOAuth.mockResolvedValue({
      data: { url: 'https://supabase.example/oauth/google' },
      error: null,
    });
  });

  it('returns 404 when the merchant cannot be resolved', async () => {
    oauthRouteMocks.getMerchantByIdentifier.mockResolvedValue(null);
    const { POST } = await import('./route');

    const response = await POST(makeRequest({ merchantSlug: 'unknown-store' }));
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json).toEqual({ error: 'Store not found' });
    expect(oauthRouteMocks.signInWithOAuth).not.toHaveBeenCalled();
  });

  it('returns 403 when the merchant store is not published', async () => {
    oauthRouteMocks.getMerchantByIdentifier.mockResolvedValue({
      ...oauthRouteMocks.merchant,
      is_published: false,
    });
    const { POST } = await import('./route');

    const response = await POST(makeRequest({ merchantSlug: 'ogabassey' }));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json).toEqual({ error: 'Store is not available' });
    expect(oauthRouteMocks.signInWithOAuth).not.toHaveBeenCalled();
  });

  it('resolves the merchant by identifier (slug or custom domain)', async () => {
    const { POST } = await import('./route');

    await POST(makeRequest({ merchantSlug: 'ogabassey' }));

    expect(oauthRouteMocks.getMerchantByIdentifier).toHaveBeenCalledWith(
      'ogabassey'
    );
  });

  it('returns 200 with the OAuth URL when the merchant is found and published', async () => {
    const { POST } = await import('./route');

    const response = await POST(makeRequest({ merchantSlug: 'ogabassey' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      url: 'https://supabase.example/oauth/google',
    });
    expect(oauthRouteMocks.signInWithOAuth).toHaveBeenCalled();
  });

  it('rejects cross-origin redirect URLs before starting OAuth', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      makeRequest({
        merchantSlug: 'ogabassey',
        redirectUrl: 'https://evil.example/account',
      })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      code: 'INVALID_REDIRECT_URL',
      error: 'Invalid redirectUrl',
    });
    expect(oauthRouteMocks.signInWithOAuth).not.toHaveBeenCalled();
  });

  it('allows merchant subdomain redirect URLs after merchant verification', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      makeRequest({
        merchantSlug: 'ogabassey',
        redirectUrl: 'https://ogabassey.usebaci.com/account/callback',
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(oauthRouteMocks.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          redirectTo: 'https://ogabassey.usebaci.com/account/callback',
        }),
      })
    );
  });

  it('allows merchant custom-domain redirect URLs after merchant verification', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      makeRequest({
        merchantSlug: 'ogabassey',
        redirectUrl: 'https://ogabassey.com/account/callback',
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(oauthRouteMocks.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          redirectTo: 'https://ogabassey.com/account/callback',
        }),
      })
    );
  });

  it('allows explicitly verified alias origins and rejects unverified www siblings', async () => {
    const { POST } = await import('./route');

    const rejected = await POST(
      makeRequest({
        merchantSlug: 'ogabassey',
        redirectUrl: 'https://www.ogabassey.com/account/callback',
      })
    );
    expect(rejected.status).toBe(400);

    oauthRouteMocks.verifiedDomains = ['www.ogabassey.com'];
    const allowed = await POST(
      makeRequest({
        merchantSlug: 'ogabassey',
        redirectUrl: 'https://www.ogabassey.com/account/callback',
      })
    );
    expect(allowed.status).toBe(200);
    expect(oauthRouteMocks.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          redirectTo: 'https://www.ogabassey.com/account/callback',
        }),
      })
    );
  });

  it('normalizes relative redirect URLs to the configured app origin', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      makeRequest({
        merchantSlug: 'ogabassey',
        redirectUrl: '/account?tab=orders',
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(oauthRouteMocks.signInWithOAuth).toHaveBeenCalledWith({
      options: {
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
        redirectTo: 'https://usebaci.com/account?tab=orders',
      },
      provider: 'google',
    });
  });
});
