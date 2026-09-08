import type { User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STOREFRONT_AGENT_ROUTES } from '@/config/storefront-agent-routes';
import { STOREFRONT_FEED_ROUTES } from '@/config/storefront-feed-routes';
import {
  getCustomDomainForSlug,
  getSlugForCustomDomain,
} from '@/lib/domain-cache-simple';
import { checkRateLimit } from '@/lib/rate-limit';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { resolveStorefrontBlogListingStatus } from '@/lib/storefront-blog-listing-status';
import { resolveStorefrontBlogPostStatus } from '@/lib/storefront-blog-post-status';
import { resolveStorefrontCompareHubStatus } from '@/lib/storefront-compare-hub-status';
import { getStorefrontProductCanonicalRedirectResult } from '@/lib/storefront-product-canonical-redirect';
import { resolveStorefrontProductSlugResolution } from '@/lib/storefront-product-slug-membership';
import { updateSession } from '@/lib/supabase/middleware';
import { STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM } from './config/storefront-metadata-cache-bots';
import { config, proxy } from './proxy';

const AUTHENTICATED_USER: User = {
  app_metadata: {},
  aud: 'authenticated',
  created_at: '2026-03-23T00:00:00.000Z',
  id: 'merchant-user-id',
  user_metadata: {},
};
const MACHINE_READABLE_TEST_PATHS = [
  ...Object.values(STOREFRONT_AGENT_ROUTES),
  ...Object.values(STOREFRONT_FEED_ROUTES),
];

// Mock dependencies
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: vi.fn().mockResolvedValue({
    supabaseResponse: NextResponse.next(),
    user: null, // Simulate unauthenticated by default
  }),
}));

vi.mock('@/lib/domain-cache-simple', () => ({
  getCustomDomainForSlug: vi.fn().mockResolvedValue(null),
  getSlugForCustomDomain: vi.fn().mockResolvedValue('ogabassey'),
}));

// Retired-slug alias resolution. Defaults to null ("not a retired alias") so it
// is a no-op for existing tests; individual tests override it.
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
}));

// Mock env
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://example.supabase.co',
  getSupabaseAnonKey: () => 'anon-key',
  getInternalApiSecret: () => 'test-internal-secret',
}));

// Mock the crawl-budget product-slug membership check (PR-B §3.2). Defaults to
// "present" so it is a no-op for existing tests; individual tests override it.
vi.mock('@/lib/storefront-product-slug-membership', () => ({
  resolveStorefrontProductSlugResolution: vi
    .fn()
    .mockResolvedValue({ kind: 'present-or-unknown' }),
}));

// Mock the canonical PDP redirect lookup. Defaults to "already canonical" so
// existing rewrite/404 tests only opt into redirects when explicitly needed.
vi.mock('@/lib/storefront-product-canonical-redirect', () => ({
  getStorefrontProductCanonicalRedirectResult: vi
    .fn()
    .mockResolvedValue({ kind: 'unknown' }),
}));

vi.mock('@/lib/storefront-blog-post-status', () => ({
  resolveStorefrontBlogPostStatus: vi
    .fn()
    .mockResolvedValue({ kind: 'present-or-unknown' }),
}));

// Mock the empty-compare-hub preflight. Defaults to renderable-or-unknown so
// it is a no-op for existing tests; empty-hub tests override it.
vi.mock('@/lib/storefront-compare-hub-status', () => ({
  resolveStorefrontCompareHubStatus: vi
    .fn()
    .mockResolvedValue({ kind: 'renderable-or-unknown' }),
}));

vi.mock('@/lib/storefront-blog-listing-status', () => ({
  resolveStorefrontBlogListingStatus: vi
    .fn()
    .mockResolvedValue({ kind: 'noop' }),
}));

// Mock rate limit
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetTime: Date.now() + 60000,
  }),
  createRateLimitResponse: vi
    .fn()
    .mockReturnValue(new NextResponse('Too Many Requests', { status: 429 })),
}));

function assertNonceHeadersForwarded(
  forwardedRequest: NextRequest | undefined,
  response: NextResponse
) {
  if (!forwardedRequest) {
    throw new Error('expected updateSession to receive a forwarded request');
  }

  const nonce = forwardedRequest.headers.get('x-nonce');
  const forwardedCsp = forwardedRequest.headers.get('Content-Security-Policy');
  const responseCsp = response.headers.get('Content-Security-Policy');

  if (!nonce) {
    throw new Error('missing x-nonce header');
  }
  if (!forwardedCsp) {
    throw new Error('missing forwarded Content-Security-Policy header');
  }
  if (!responseCsp) {
    throw new Error('missing response Content-Security-Policy header');
  }

  expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(forwardedCsp).toContain(`'nonce-${nonce}'`);
  expect(responseCsp).toContain(`'nonce-${nonce}'`);
  expect(responseCsp).toContain(`script-src 'self' 'nonce-${nonce}'`);
  expect(responseCsp).not.toContain('script-src-elem');
  expect(responseCsp).toContain("script-src-attr 'none'");
  expect(responseCsp).toBe(forwardedCsp);
}

describe('Middleware Proxy', () => {
  const ROOT_DOMAIN = 'usebaci.com';

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks resets call history but not implementations; restore the
    // crawl-budget membership mock to its "present" default so a per-test
    // override does not leak into unrelated custom-domain tests.
    vi.mocked(resolveStorefrontProductSlugResolution).mockResolvedValue({
      kind: 'present-or-unknown',
    });
    vi.mocked(getStorefrontProductCanonicalRedirectResult).mockResolvedValue({
      kind: 'unknown',
    });
    vi.mocked(resolveStorefrontBlogPostStatus).mockResolvedValue({
      kind: 'present-or-unknown',
    });
    vi.mocked(resolveStorefrontCompareHubStatus).mockResolvedValue({
      kind: 'renderable-or-unknown',
    });
    // Default: not a retired alias, so a per-test override cannot leak a spurious
    // 301 into unrelated subdomain/custom-domain tests.
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue(null);
  });

  it('should apply security headers to API routes', async () => {
    const req = new NextRequest(`https://${ROOT_DOMAIN}/api/products`);
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(res.headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin'
    );
    expect(res.headers.get('Permissions-Policy')).toContain('camera=()');

    // API specific CSP
    const csp = res.headers.get('Content-Security-Policy') || '';
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('should apply security headers to storefront routes', async () => {
    const req = new NextRequest(`https://ogabassey.${ROOT_DOMAIN}/products`);
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

    const res = await proxy(req);

    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');

    // Non-checkout storefront pages must NOT expose camera/microphone — the
    // delegation is scoped to the checkout flow only.
    const permissionsPolicy = res.headers.get('Permissions-Policy') || '';
    expect(permissionsPolicy).toContain('camera=()');
    expect(permissionsPolicy).toContain('microphone=()');
    expect(permissionsPolicy).not.toContain('creditdirect');

    // Storefront specific CSP
    const csp = res.headers.get('Content-Security-Policy') || '';
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it('delegates camera/microphone to Credit Direct on storefront checkout', async () => {
    const req = new NextRequest(`https://ogabassey.${ROOT_DOMAIN}/checkout`);
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

    const res = await proxy(req);

    // Credit Direct BNPL runs camera-based identity verification in an in-page
    // iframe. Per the Permissions Policy spec, cross-origin delegation requires
    // `self` in the allowlist (otherwise the embedding document can't delegate),
    // alongside the live + test verification origins.
    const permissionsPolicy = res.headers.get('Permissions-Policy') || '';
    expect(permissionsPolicy).toContain(
      'camera=(self "https://checkout.creditdirect.ng" "https://app.creditdirect.ng" "https://cdl.test.lendastack.io")'
    );
    expect(permissionsPolicy).toContain(
      'microphone=(self "https://checkout.creditdirect.ng" "https://app.creditdirect.ng" "https://cdl.test.lendastack.io")'
    );
  });

  it('allows Klump checkout hosts on storefront CSP', async () => {
    const req = new NextRequest(`https://ogabassey.${ROOT_DOMAIN}/products`);
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

    const res = await proxy(req);
    const csp = res.headers.get('Content-Security-Policy') || '';
    const directives = Object.fromEntries(
      csp
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [name, ...values] = entry.split(/\s+/);
          return [name, values.join(' ')];
        })
    );

    expect(directives['script-src']).toContain('https://js.useklump.com');
    expect(directives['script-src']).toContain('https://asset.useklump.com');
    expect(directives['connect-src']).toContain(
      'https://checkout.useklump.com'
    );
    expect(directives['connect-src']).toContain(
      'https://checkout-v2.useklump.com'
    );
    expect(directives['connect-src']).toContain(
      'https://directdebit.useklump.com'
    );
    expect(directives['frame-src']).toContain('https://asset.useklump.com');
    expect(directives['frame-src']).toContain('https://checkout.useklump.com');
    expect(directives['frame-src']).toContain(
      'https://checkout-v2.useklump.com'
    );
    expect(directives['frame-src']).toContain(
      'https://directdebit.useklump.com'
    );
  });

  it('allows Cloudflare Insights beacon hosts on storefront CSP', async () => {
    const req = new NextRequest(`https://ogabassey.${ROOT_DOMAIN}/products`);
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

    const res = await proxy(req);
    const csp = res.headers.get('Content-Security-Policy') || '';
    const directives = Object.fromEntries(
      csp
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [name, ...values] = entry.split(/\s+/);
          return [name, values.join(' ')];
        })
    );

    expect(directives['script-src']).toContain(
      'https://static.cloudflareinsights.com'
    );
    expect(directives['connect-src']).toContain(
      'https://cloudflareinsights.com'
    );
  });

  it('does not allow unsafe-eval on production storefront routes', async () => {
    const req = new NextRequest(`https://ogabassey.${ROOT_DOMAIN}/products`);
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

    const res = await proxy(req);
    const csp = res.headers.get('Content-Security-Policy') || '';

    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('allows unsafe-eval on localhost storefront routes for dev tooling', async () => {
    const req = new NextRequest('http://localhost:3001/products');
    req.headers.set('host', 'localhost:3001');

    const res = await proxy(req);
    const csp = res.headers.get('Content-Security-Policy') || '';

    expect(csp).toContain("'unsafe-eval'");
  });

  it('allows unsafe-eval on localhost dashboard routes for dev React tooling', async () => {
    const req = new NextRequest('http://localhost:3001/dashboard/orders');
    req.headers.set('host', 'localhost:3001');

    const res = await proxy(req);
    const csp = res.headers.get('Content-Security-Policy') || '';

    expect(csp).toContain("'unsafe-eval'");
  });

  it('does not allow unsafe-eval on production dashboard routes', async () => {
    vi.mocked(updateSession).mockResolvedValueOnce({
      supabaseResponse: NextResponse.next(),
      user: AUTHENTICATED_USER,
    });

    const req = new NextRequest(`https://${ROOT_DOMAIN}/dashboard/orders`);
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);
    const csp = res.headers.get('Content-Security-Policy') || '';

    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('forwards auth route CSP and nonce headers for Next script nonces', async () => {
    const req = new NextRequest(`https://${ROOT_DOMAIN}/login`);
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);
    expect(updateSession).toHaveBeenCalledTimes(1);
    const [forwardedRequest] = vi.mocked(updateSession).mock.calls[0] ?? [];

    assertNonceHeadersForwarded(forwardedRequest, res);
  });

  it('forwards admin route CSP and nonce headers before auth rendering', async () => {
    vi.mocked(updateSession).mockResolvedValueOnce({
      supabaseResponse: NextResponse.next(),
      user: AUTHENTICATED_USER,
    });

    const req = new NextRequest(`https://${ROOT_DOMAIN}/admin/merchants`);
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);
    expect(updateSession).toHaveBeenCalledTimes(1);
    const [forwardedRequest] = vi.mocked(updateSession).mock.calls[0] ?? [];

    assertNonceHeadersForwarded(forwardedRequest, res);
  });

  it('forwards nonce headers for public onboarding renders', async () => {
    const req = new NextRequest(`https://${ROOT_DOMAIN}/onboarding`);
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);
    const nonce = res.headers.get('x-nonce');
    const csp = res.headers.get('Content-Security-Policy');

    expect(updateSession).not.toHaveBeenCalled();
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}'`);
    expect(csp).not.toContain("'nonce-undefined'");
    const directives = Object.fromEntries(
      (csp ?? '')
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [name, ...values] = entry.split(/\s+/);
          return [name, values.join(' ')];
        })
    );
    expect(directives['script-src']).not.toContain("'unsafe-inline'");
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(
      res.headers.get('x-middleware-request-content-security-policy')
    ).toBe(csp);
  });

  it('generates unique CSP nonces for repeated auth renders', async () => {
    const nonces: string[] = [];

    for (let index = 0; index < 3; index += 1) {
      const req = new NextRequest(`https://${ROOT_DOMAIN}/login`);
      req.headers.set('host', ROOT_DOMAIN);

      await proxy(req);
      const forwardedRequest = vi.mocked(updateSession).mock.calls[index]?.[0];
      const nonce = forwardedRequest?.headers.get('x-nonce');

      expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
      if (nonce) {
        nonces.push(nonce);
      }
    }

    expect(new Set(nonces).size).toBe(nonces.length);
  });

  it('falls back to a safe nonce when random byte generation fails', async () => {
    const getRandomValuesSpy = vi
      .spyOn(crypto, 'getRandomValues')
      .mockImplementationOnce(() => {
        throw new Error('entropy unavailable');
      });

    const req = new NextRequest(`https://${ROOT_DOMAIN}/login`);
    req.headers.set('host', ROOT_DOMAIN);

    try {
      const res = await proxy(req);
      expect(updateSession).toHaveBeenCalledTimes(1);
      const [forwardedRequest] = vi.mocked(updateSession).mock.calls[0] ?? [];

      assertNonceHeadersForwarded(forwardedRequest, res);
    } finally {
      getRandomValuesSpy.mockRestore();
    }
  });

  it('redirects unauthenticated admin requests to login with the canonical redirect key', async () => {
    const req = new NextRequest(`https://${ROOT_DOMAIN}/admin`);
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);
    const location = res.headers.get('location');

    expect(res.status).toBe(307);
    if (!location) {
      throw new Error('expected location header');
    }

    const redirected = new URL(location);
    expect(redirected.pathname).toBe('/login');
    expect(redirected.searchParams.get('redirect')).toBe('/admin');
    expect(redirected.searchParams.has('redirectTo')).toBe(false);
  });

  it('preserves admin subpaths in canonical login redirects', async () => {
    const req = new NextRequest(
      `https://${ROOT_DOMAIN}/admin/merchants?health=at_risk`
    );
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);
    const location = res.headers.get('location');

    expect(res.status).toBe(307);
    if (!location) {
      throw new Error('expected location header');
    }

    const redirected = new URL(location);
    expect(redirected.pathname).toBe('/login');
    expect(redirected.searchParams.get('redirect')).toBe(
      '/admin/merchants?health=at_risk'
    );
  });

  it('redirects authenticated login requests using canonical redirect before legacy redirectTo', async () => {
    vi.mocked(updateSession).mockResolvedValueOnce({
      supabaseResponse: NextResponse.next(),
      user: AUTHENTICATED_USER,
    });

    const req = new NextRequest(
      `https://${ROOT_DOMAIN}/login?redirect=%2Fadmin&redirectTo=%2Fdashboard`
    );
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`https://${ROOT_DOMAIN}/admin`);
  });

  it('keeps legacy redirectTo login compatibility for authenticated users', async () => {
    vi.mocked(updateSession).mockResolvedValueOnce({
      supabaseResponse: NextResponse.next(),
      user: AUTHENTICATED_USER,
    });

    const req = new NextRequest(
      `https://${ROOT_DOMAIN}/login?redirectTo=%2Fadmin`
    );
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`https://${ROOT_DOMAIN}/admin`);
  });

  describe('login redirect path sanitization', () => {
    // Each case proves the proxy's `redirect` param sanitizer prevents an
    // open-redirect or header-injection vector for an authenticated user
    // landing on `/login`. The expected behavior is either a clean
    // local-only path on the same origin, or a fallback to /dashboard —
    // never a redirect to a foreign origin and never a header-injection
    // payload reflected into the Location header.
    it.each([
      // Protocol-relative URL — must NOT exfiltrate to evil.com
      ['//evil.com', `https://${ROOT_DOMAIN}/dashboard`],
      // Backslash-prefixed authority — WHATWG normalizes `\` to `/` under
      // an HTTPS scheme, so `/\evil.com` parses to host=evil.com. Reject.
      ['/\\evil.com', `https://${ROOT_DOMAIN}/dashboard`],
      // Multiple leading backslashes — also an authority-switch attempt
      ['/\\\\evil.com', `https://${ROOT_DOMAIN}/dashboard`],
      // Backslash anywhere in the path — reject to be safe; legitimate
      // local paths never contain backslashes
      ['/admin\\users', `https://${ROOT_DOMAIN}/dashboard`],
      ['/admin\\evil.com', `https://${ROOT_DOMAIN}/dashboard`],
      [
        '/path\\with\\multiple\\backslashes',
        `https://${ROOT_DOMAIN}/dashboard`,
      ],
      // data: URI scheme — must be rejected
      [
        'data:text/html,<script>alert(1)</script>',
        `https://${ROOT_DOMAIN}/dashboard`,
      ],
      // javascript: URI scheme — must be rejected
      ['javascript:void(0)', `https://${ROOT_DOMAIN}/dashboard`],
      // Absolute http(s) URL — must be rejected
      ['https://evil.com/path', `https://${ROOT_DOMAIN}/dashboard`],
      // ASCII tab between leading `/` and `/evil.com` — WHATWG strips the
      // tab, making the parser see `//evil.com` and switch authority to
      // evil.com. The defense-in-depth host check catches this.
      ['/\t/evil.com', `https://${ROOT_DOMAIN}/dashboard`],
      ['/\n/evil.com', `https://${ROOT_DOMAIN}/dashboard`],
      ['/\r/evil.com', `https://${ROOT_DOMAIN}/dashboard`],
    ])('sanitizes malicious redirect param %s to safe target %s', async (rawRedirect, expectedLocation) => {
      vi.mocked(updateSession).mockResolvedValueOnce({
        supabaseResponse: NextResponse.next(),
        user: AUTHENTICATED_USER,
      });

      const req = new NextRequest(
        `https://${ROOT_DOMAIN}/login?redirect=${encodeURIComponent(rawRedirect)}`
      );
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(307);
      expect(location).toBe(expectedLocation);
    });

    it('never reflects CRLF header-injection payloads into the Location header', async () => {
      vi.mocked(updateSession).mockResolvedValueOnce({
        supabaseResponse: NextResponse.next(),
        user: AUTHENTICATED_USER,
      });

      // A raw CRLF + bogus header in the redirect param. The redirect target
      // must (a) stay on the same origin and (b) emit a Location value with
      // no embedded CR/LF characters, since reflecting either into the
      // response would smuggle a forged response header.
      const req = new NextRequest(
        `https://${ROOT_DOMAIN}/login?redirect=${encodeURIComponent('/admin\r\nx-test:1')}`
      );
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(307);
      expect(location).toBeTruthy();
      const parsed = new URL(location ?? '');
      expect(parsed.origin).toBe(`https://${ROOT_DOMAIN}`);
      expect(location ?? '').not.toContain('\r');
      expect(location ?? '').not.toContain('\n');
    });
  });

  it('should not rewrite API routes on subdomains (pass-through)', async () => {
    const req = new NextRequest(
      `https://ogabassey.${ROOT_DOMAIN}/api/storefront/products`
    );
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

    const res = await proxy(req);

    // If it was rewritten, the response would typically imply a rewrite in Next.js internals
    // But since we returned NextResponse.next(), it's a pass-through.
    // We verify that we got a valid response with security headers.
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');

    // Verify it didn't redirect (which would happen if /api was in MAIN_APP_ROUTES)
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(308);
  });

  it('passes PostHog relay requests through on merchant subdomains', async () => {
    const req = new NextRequest(
      `https://ogabassey.${ROOT_DOMAIN}/baci-relay/e/capture/`
    );
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

    const res = await proxy(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('passes PostHog relay requests through on custom domains', async () => {
    const req = new NextRequest('https://ogabassey.com/baci-relay/e/capture/');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(getSlugForCustomDomain).not.toHaveBeenCalled();
  });

  it('passes /auth/confirm through on custom domains so tokens reach the verifier', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/auth/confirm?token_hash=abc&type=magiclink&next=%2F'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    // Passed through (NextResponse.next), not storefront-rewritten to /<domain>/auth/confirm.
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('does not pass /auth/confirm through for unregistered custom domains', async () => {
    // Apex request: one slug lookup (no www to strip → no www fallback), null.
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce(null);
    const req = new NextRequest(
      'https://attacker.example/auth/confirm?token_hash=abc&type=magiclink&next=%2F'
    );
    req.headers.set('host', 'attacker.example');

    const res = await proxy(req);

    expect(getSlugForCustomDomain).toHaveBeenCalledWith('attacker.example');
    expect(res.headers.get('x-middleware-rewrite')).toContain(
      '/attacker.example/auth/confirm'
    );
  });

  it('passes /auth/confirm through for a www request when only www is registered', async () => {
    // Request is on www.example.com: apex lookup is null, www counterpart resolves.
    vi.mocked(getSlugForCustomDomain)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('ogabassey');
    const req = new NextRequest(
      'https://www.example.com/auth/confirm?token_hash=abc&type=magiclink&next=%2F'
    );
    req.headers.set('host', 'www.example.com');

    const res = await proxy(req);

    expect(getSlugForCustomDomain).toHaveBeenCalledWith('www.example.com');
    // Passed through (not storefront-rewritten).
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('does not pass /auth/confirm through on the apex when only www is registered', async () => {
    // Request is on the APEX example.com (no www to strip). The www counterpart
    // must NOT be used to promote this unregistered host to an auth-confirm
    // origin — it stays storefront-rewritten.
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce(null);
    const req = new NextRequest(
      'https://example.com/auth/confirm?token_hash=abc&type=magiclink&next=%2F'
    );
    req.headers.set('host', 'example.com');

    const res = await proxy(req);

    expect(res.headers.get('x-middleware-rewrite')).toContain(
      '/example.com/auth/confirm'
    );
  });

  it('still storefront-rewrites other /auth paths on custom domains (scoping)', async () => {
    const req = new NextRequest('https://ogabassey.com/auth/login');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    // Only /auth/confirm is exempted; /auth/login falls through to the
    // storefront rewrite (proving the passthrough is narrowly scoped).
    expect(res.headers.get('x-middleware-rewrite')).toContain(
      '/ogabassey.com/auth/login'
    );
  });

  it('strips app credentials from PostHog relay requests', async () => {
    const req = new NextRequest(
      `https://ogabassey.${ROOT_DOMAIN}/baci-relay/e/capture/`
    );
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);
    req.headers.set('user-agent', 'PostHog Test Agent');
    req.headers.set('cookie', 'sb-auth-token=secret');
    req.headers.set('authorization', 'Bearer secret');
    req.headers.set('proxy-authorization', 'Bearer proxy-secret');
    req.headers.set(
      'referer',
      `https://ogabassey.${ROOT_DOMAIN}/checkout?email=buyer@example.com`
    );
    req.headers.set('x-csrf-token', 'csrf-secret');
    req.headers.set('x-supabase-auth-token', 'supabase-secret');

    const res = await proxy(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-request-cookie')).toBeNull();
    expect(res.headers.get('x-middleware-request-authorization')).toBeNull();
    expect(
      res.headers.get('x-middleware-request-proxy-authorization')
    ).toBeNull();
    expect(res.headers.get('x-middleware-request-referer')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-csrf-token')).toBeNull();
    expect(
      res.headers.get('x-middleware-request-x-supabase-auth-token')
    ).toBeNull();
    expect(res.headers.get('x-middleware-request-user-agent')).toBe(
      'PostHog Test Agent'
    );
  });

  it('matches PostHog relay static assets so rewrites cannot bypass header stripping', () => {
    expect(config.matcher).toContain('/baci-relay/:path*');
  });

  it('does not force no-cache on default PostHog relay static assets', async () => {
    const req = new NextRequest(
      `https://ogabassey.${ROOT_DOMAIN}/baci-relay/static/recorder.js`
    );
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

    const res = await proxy(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('Cache-Control')).not.toBe(
      'no-cache, must-revalidate, max-age=0'
    );
  });

  it('does not match every static chunk for custom relay assets', () => {
    const legacyCatchAllMatcher = '/((?:.+/)?(?:static|array)/.*)';
    const customRelayStaticMatcher = config.matcher.find((matcher) =>
      matcher?.includes('(?:static|array)')
    );
    if (!customRelayStaticMatcher) {
      throw new Error('Custom relay static matcher is missing');
    }

    const regex = new RegExp(`^${customRelayStaticMatcher}`);
    const matchesNextStaticChunk = regex.test('/_next/static/chunks/app.js');
    const matchesCustomRelayAsset = regex.test(
      '/baci-observe/static/recorder.js'
    );

    expect(config.matcher).not.toContain(legacyCatchAllMatcher);
    expect(matchesNextStaticChunk).toBe(false);
    expect(matchesCustomRelayAsset).toBe(true);
  });

  it('strips app credentials from custom PostHog relay static asset paths', async () => {
    const originalRelayPath = process.env.NEXT_PUBLIC_POSTHOG_PROXY_PATH;
    process.env.NEXT_PUBLIC_POSTHOG_PROXY_PATH = '/baci-observe';

    try {
      vi.resetModules();
      const { config: configWithCustomRelay, proxy: proxyWithCustomRelay } =
        await import('./proxy');

      expect(configWithCustomRelay.matcher).toContain(
        '/((?!_next/static(?:/|$))(?:.+/)?(?:static|array)/.*)'
      );

      const req = new NextRequest(
        `https://ogabassey.${ROOT_DOMAIN}/baci-observe/static/recorder.js`
      );
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);
      req.headers.set('cookie', 'sb-auth-token=secret');
      req.headers.set('authorization', 'Bearer secret');
      req.headers.set(
        'referer',
        `https://ogabassey.${ROOT_DOMAIN}/checkout?email=buyer@example.com`
      );

      const res = await proxyWithCustomRelay(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('x-middleware-request-cookie')).toBeNull();
      expect(res.headers.get('x-middleware-request-authorization')).toBeNull();
      expect(res.headers.get('x-middleware-request-referer')).toBeNull();
      expect(res.headers.get('Cache-Control')).not.toBe(
        'no-cache, must-revalidate, max-age=0'
      );
    } finally {
      if (originalRelayPath === undefined) {
        delete process.env.NEXT_PUBLIC_POSTHOG_PROXY_PATH;
      } else {
        process.env.NEXT_PUBLIC_POSTHOG_PROXY_PATH = originalRelayPath;
      }
      vi.resetModules();
    }
  });

  it('falls back to the default PostHog relay path for reserved route prefixes', async () => {
    const originalRelayPath = process.env.NEXT_PUBLIC_POSTHOG_PROXY_PATH;
    process.env.NEXT_PUBLIC_POSTHOG_PROXY_PATH = '/api';

    try {
      vi.resetModules();
      const { proxy: proxyWithReservedRelayPath } = await import('./proxy');

      const req = new NextRequest(`https://${ROOT_DOMAIN}/api/products`);
      req.headers.set('host', ROOT_DOMAIN);
      req.headers.set('user-agent', 'Reserved Relay Test Agent');

      const res = await proxyWithReservedRelayPath(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('x-middleware-request-user-agent')).toBeNull();
    } finally {
      if (originalRelayPath === undefined) {
        delete process.env.NEXT_PUBLIC_POSTHOG_PROXY_PATH;
      } else {
        process.env.NEXT_PUBLIC_POSTHOG_PROXY_PATH = originalRelayPath;
      }
      vi.resetModules();
    }
  });

  it('should rewrite storefront checkout routes on merchant subdomains', async () => {
    const req = new NextRequest(`https://ogabassey.${ROOT_DOMAIN}/checkout`);
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

    const res = await proxy(req);

    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      `https://ogabassey.${ROOT_DOMAIN}/ogabassey/checkout`
    );
    expect(res.headers.get('x-middleware-request-x-merchant-slug')).toBe(
      'ogabassey'
    );
  });

  describe('crawl-budget PDP hard-404 (PR-B §3.2)', () => {
    const resolutionMock = vi.mocked(resolveStorefrontProductSlugResolution);
    const mockMissing = (missing: boolean) =>
      resolutionMock.mockResolvedValue(
        missing ? { kind: 'missing' } : { kind: 'present-or-unknown' }
      );

    const canonicalRedirectMock = vi.mocked(
      getStorefrontProductCanonicalRedirectResult
    );
    const compareHubStatusMock = vi.mocked(resolveStorefrontCompareHubStatus);

    it('hard-rejects repeated percent-encoding before storefront lookups on every merchant URL shape', async () => {
      const unsafeProductPath = `/smartphones/phone${'%2525252525'.repeat(30)}`;
      const merchantUrls = [
        `https://ogabassey.com${unsafeProductPath}`,
        `https://ogabassey.${ROOT_DOMAIN}${unsafeProductPath}`,
        `https://${ROOT_DOMAIN}/ogabassey${unsafeProductPath}`,
      ];

      for (const url of merchantUrls) {
        const request = new NextRequest(url);
        request.headers.set('host', new URL(url).host);

        const response = await proxy(request);

        expect(response.status).toBe(404);
        expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
        expect(response.headers.get('Cache-Control')).toContain('no-store');
      }

      expect(canonicalRedirectMock).not.toHaveBeenCalled();
      expect(resolutionMock).not.toHaveBeenCalled();
      expect(getSlugForCustomDomain).not.toHaveBeenCalled();
    });

    it('does not reject a non-GET storefront request solely because its path is over-encoded', async () => {
      const unsafeProductPath = `/smartphones/phone${'%2525252525'.repeat(30)}`;
      const request = new NextRequest(
        `https://ogabassey.com${unsafeProductPath}`,
        { method: 'POST' }
      );
      request.headers.set('host', 'ogabassey.com');

      const response = await proxy(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('X-Robots-Tag')).toBeNull();
    });

    it('passes through a safely encoded two-segment PDP GET without the path gate 404', async () => {
      // Arrange
      const request = new NextRequest(
        'https://ogabassey.com/smartphones/dell-%E2%80%93-xps'
      );
      request.headers.set('host', 'ogabassey.com');

      // Act
      const response = await proxy(request);

      // Assert
      expect(response.status).not.toBe(404);
      expect(response.headers.get('X-Robots-Tag')).toBeNull();
    });

    it('normalizes recoverable encoded punctuation before the PDP hard-404 gate', async () => {
      // Arrange
      const recoverableProductPath = `/smartphones/phone${'%E2%80%93'.repeat(57)}case`;
      const request = new NextRequest(
        `https://ogabassey.com${recoverableProductPath}`
      );
      request.headers.set('host', 'ogabassey.com');

      // Act
      const response = await proxy(request);
      const location = response.headers.get('location');

      // Assert
      expect(response.status).toBe(308);
      expect(location).toBeTruthy();
      expect(new URL(location || '').pathname).toBe('/smartphones/phone-case');
      expect(canonicalRedirectMock).not.toHaveBeenCalled();
      expect(resolutionMock).not.toHaveBeenCalled();
    });

    it('passes an unsafe category with a safe product through to canonical routing', async () => {
      // Arrange
      const unsafeCategory = `phones${'%2525252525'.repeat(30)}`;
      const request = new NextRequest(
        `https://ogabassey.com/${unsafeCategory}/phone`
      );
      request.headers.set('host', 'ogabassey.com');

      // Act
      const response = await proxy(request);

      // Assert
      expect(response.status).not.toBe(404);
      expect(response.headers.get('X-Robots-Tag')).toBeNull();
      expect(resolutionMock).toHaveBeenCalled();
    });

    it('passes through an over-encoded reserved first-segment GET without the path gate 404', async () => {
      // Arrange
      const unsafeSlug = `login${'%2525252525'.repeat(30)}`;
      const request = new NextRequest(
        `https://ogabassey.com/account/${unsafeSlug}`
      );
      request.headers.set('host', 'ogabassey.com');

      // Act
      const response = await proxy(request);

      // Assert
      expect(response.status).not.toBe(404);
      expect(response.headers.get('X-Robots-Tag')).toBeNull();
    });

    it('passes RSC requests with over-encoded PDP paths through without an HTML hard 404', async () => {
      // Arrange
      const unsafeProductPath = `/smartphones/phone${'%2525252525'.repeat(30)}`;
      const request = new NextRequest(
        `https://ogabassey.com${unsafeProductPath}`
      );
      request.headers.set('host', 'ogabassey.com');
      request.headers.set('rsc', '1');

      // Act
      const response = await proxy(request);

      // Assert
      expect(response.status).not.toBe(404);
      expect(response.headers.get('X-Robots-Tag')).toBeNull();
    });

    it('hard-rejects an over-encoded PDP path on the plain localhost slug-prefix shape', async () => {
      // Arrange
      const unsafeProductPath = `/smartphones/phone${'%2525252525'.repeat(30)}`;
      const request = new NextRequest(
        `http://localhost:3000/ogabassey${unsafeProductPath}`
      );
      request.headers.set('host', 'localhost:3000');

      // Act
      const response = await proxy(request);

      // Assert
      expect(response.status).toBe(404);
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    });

    it('does not treat a reserved platform subdomain as a custom-domain PDP', async () => {
      // Arrange
      const unsafeProductPath = `/smartphones/phone${'%2525252525'.repeat(30)}`;
      const request = new NextRequest(
        `https://support.${ROOT_DOMAIN}${unsafeProductPath}`
      );
      request.headers.set('host', `support.${ROOT_DOMAIN}`);

      // Act
      const response = await proxy(request);

      // Assert
      expect(response.status).not.toBe(404);
      expect(response.headers.get('X-Robots-Tag')).toBeNull();
    });

    it('308-redirects stale custom-domain category aliases before the App Router streams a 200 shell', async () => {
      canonicalRedirectMock.mockResolvedValue({
        kind: 'redirect',
        redirectPath: '/smartphones/tecno-spark-40',
      });
      resolutionMock.mockResolvedValue({ kind: 'missing' });
      const req = new NextRequest('https://ogabassey.com/tecno/tecno-spark-40');
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe(
        'https://ogabassey.com/smartphones/tecno-spark-40'
      );
      expect(canonicalRedirectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'tecno',
          identifier: 'ogabassey',
          productSlug: 'tecno-spark-40',
          secret: 'test-internal-secret',
        })
      );
      expect(resolutionMock).not.toHaveBeenCalled();
    });

    it('308-redirects UUID-shaped PDP aliases before the App Router renders a duplicate 200', async () => {
      canonicalRedirectMock.mockResolvedValue({
        kind: 'redirect',
        redirectPath: '/smartphones/google-pixel-10',
      });
      resolutionMock.mockResolvedValue({ kind: 'missing' });
      const req = new NextRequest(
        'https://ogabassey.com/smartphones/123e4567-e89b-12d3-a456-426614174000'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe(
        'https://ogabassey.com/smartphones/google-pixel-10'
      );
      expect(canonicalRedirectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'smartphones',
          identifier: 'ogabassey',
          productSlug: '123e4567-e89b-12d3-a456-426614174000',
        })
      );
      expect(resolutionMock).not.toHaveBeenCalled();
    });

    it('preserves attribution query params on pre-streaming canonical redirects', async () => {
      canonicalRedirectMock.mockResolvedValue({
        kind: 'redirect',
        redirectPath: '/smartphones/tecno-spark-40',
      });
      resolutionMock.mockResolvedValue({ kind: 'missing' });
      const req = new NextRequest(
        'https://ogabassey.com/tecno/tecno-spark-40?utm_source=email&gclid=abc123'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe(
        'https://ogabassey.com/smartphones/tecno-spark-40?utm_source=email&gclid=abc123'
      );
      expect(canonicalRedirectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'tecno',
          identifier: 'ogabassey',
          productSlug: 'tecno-spark-40',
        })
      );
      expect(resolutionMock).not.toHaveBeenCalled();
    });

    it('308-redirects stale category aliases on merchant subdomains before the storefront rewrite', async () => {
      canonicalRedirectMock.mockResolvedValue({
        kind: 'redirect',
        redirectPath: '/smartphones/tecno-spark-40',
      });
      resolutionMock.mockResolvedValue({ kind: 'missing' });
      const req = new NextRequest(
        `https://ogabassey.${ROOT_DOMAIN}/tecno/tecno-spark-40`
      );
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe(
        `https://ogabassey.${ROOT_DOMAIN}/smartphones/tecno-spark-40`
      );
      expect(canonicalRedirectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'tecno',
          identifier: 'ogabassey',
          productSlug: 'tecno-spark-40',
          secret: 'test-internal-secret',
        })
      );
      expect(resolutionMock).not.toHaveBeenCalled();
    });

    it('308-redirects archived variant slugs on root-domain slug paths while preserving the merchant prefix', async () => {
      canonicalRedirectMock.mockResolvedValue({
        kind: 'redirect',
        redirectPath: '/smartphones/samsung-galaxy-z-fold-6',
      });
      const req = new NextRequest(
        'https://usebaci.com/ogabassey/smartphones/samsung-galaxy-z-fold-6-12gb-256gb'
      );
      req.headers.set('host', 'usebaci.com');

      const res = await proxy(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe(
        'https://usebaci.com/ogabassey/smartphones/samsung-galaxy-z-fold-6'
      );
      expect(canonicalRedirectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'smartphones',
          identifier: 'ogabassey',
          productSlug: 'samsung-galaxy-z-fold-6-12gb-256gb',
        })
      );
    });

    it('does not run the canonical redirect lookup for RSC/prefetch navigations', async () => {
      canonicalRedirectMock.mockResolvedValue({
        kind: 'redirect',
        redirectPath: '/smartphones/tecno-spark-40',
      });
      const req = new NextRequest('https://ogabassey.com/tecno/tecno-spark-40');
      req.headers.set('host', 'ogabassey.com');
      req.headers.set('RSC', '1');

      const res = await proxy(req);

      expect(res.status).not.toBe(308);
      expect(canonicalRedirectMock).not.toHaveBeenCalled();
    });

    it('skips the slug membership lookup when canonical preflight proves the PDP is already canonical', async () => {
      canonicalRedirectMock.mockResolvedValue({ kind: 'checked-no-redirect' });
      resolutionMock.mockResolvedValue({ kind: 'missing' });
      const req = new NextRequest(
        'https://ogabassey.com/smartphones/tecno-spark-40'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(res.headers.get('x-middleware-rewrite')).toContain(
        '/smartphones/tecno-spark-40'
      );
      expect(resolutionMock).not.toHaveBeenCalled();
    });

    it('returns a hard 404 for a confirmed-missing product slug on a custom domain', async () => {
      mockMissing(true);
      const req = new NextRequest(
        'https://ogabassey.com/smartphones/totally-made-up'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(404);
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(res.headers.get('Cache-Control')).toContain('no-store');
      expect(res.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
      expect(res.headers.get('CDN-Cache-Control')).toBeNull();
      expect(res.headers.get('Vercel-Cache-Tag')).toBeNull();
      expect(res.headers.get('Content-Type')).toContain('text/html');
      // Header-level noindex so HEAD / non-HTML-parsing crawlers still see it.
      expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
      expect(resolutionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'ogabassey',
          productSlug: 'totally-made-up',
        })
      );
    });

    it('returns a header-only hard 404 (no body) for HEAD requests to confirmed-missing products', async () => {
      mockMissing(true);
      const req = new NextRequest(
        'https://ogabassey.com/smartphones/totally-made-up',
        { method: 'HEAD' }
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(404);
      // HEAD must not carry a body (RFC 9110); the noindex travels in the header.
      expect(await res.text()).toBe('');
      expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
      expect(res.headers.get('Cache-Control')).toContain('no-store');
      expect(res.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
      expect(res.headers.get('CDN-Cache-Control')).toBeNull();
    });

    it('returns a real 308 for a redirectable archived product slug before the PDP route streams', async () => {
      resolutionMock.mockResolvedValue({
        kind: 'redirect',
        redirectPath: '/smartphones/iphone-15-pro-max',
      });
      const req = new NextRequest(
        'https://ogabassey.com/smartphones/iphone-15-pro-max-8gb-256gb'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe(
        'https://ogabassey.com/smartphones/iphone-15-pro-max'
      );
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(resolutionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'ogabassey',
          productSlug: 'iphone-15-pro-max-8gb-256gb',
        })
      );
    });

    it('preserves attribution query params when redirecting a legacy product alias', async () => {
      resolutionMock.mockResolvedValue({
        kind: 'redirect',
        redirectPath: '/smartphones/iphone-15-pro-max',
      });
      const req = new NextRequest(
        'https://ogabassey.com/smartphones/iphone-15-pro-max-8gb-256gb?utm_source=email&gclid=abc123'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe(
        'https://ogabassey.com/smartphones/iphone-15-pro-max?utm_source=email&gclid=abc123'
      );
    });

    it('does not hard-404 query-param product URLs even when the slug is reported missing', async () => {
      mockMissing(true);
      const req = new NextRequest(
        'https://ogabassey.com/smartphones/totally-made-up?utm_source=email'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
    });

    it('falls through (rewrite, not 404) when the product slug exists', async () => {
      mockMissing(false);
      const req = new NextRequest(
        'https://ogabassey.com/smartphones/iphone-15'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(res.headers.get('x-middleware-rewrite')).toContain(
        '/ogabassey.com/smartphones/iphone-15'
      );
    });

    it('does not run the check for RSC/prefetch navigations', async () => {
      mockMissing(true);
      const req = new NextRequest(
        'https://ogabassey.com/smartphones/totally-made-up'
      );
      req.headers.set('host', 'ogabassey.com');
      req.headers.set('RSC', '1');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(resolutionMock).not.toHaveBeenCalled();
    });

    it.each([
      ['blog', 'https://ogabassey.com/blog/my-post'],
      ['account', 'https://ogabassey.com/account/login'],
      ['pages', 'https://ogabassey.com/pages/rewards'],
    ])('does not hard-404 reserved first-segment route /%s/... (real App Router page)', async (_segment, url) => {
      mockMissing(true);
      const req = new NextRequest(url);
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(resolutionMock).not.toHaveBeenCalled();
    });

    it('hard-404s a confirmed-missing categoryless /products/{slug} PDP (getProductUrl fallback)', async () => {
      mockMissing(true);
      const req = new NextRequest('https://ogabassey.com/products/not-real');
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(404);
      expect(resolutionMock).toHaveBeenCalledWith(
        expect.objectContaining({ productSlug: 'not-real' })
      );
    });

    it('does not hard-404 an existing /products/{slug} PDP', async () => {
      mockMissing(false);
      const req = new NextRequest('https://ogabassey.com/products/iphone-15');
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
    });

    it('does not hard-404 the singular /product/{slug} legacy redirect route', async () => {
      mockMissing(true);
      const req = new NextRequest('https://ogabassey.com/product/whatever');
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(resolutionMock).not.toHaveBeenCalled();
    });

    it('does not hard-404 a UUID product URL (resolved by the page id lookup)', async () => {
      mockMissing(true);
      const req = new NextRequest(
        'https://ogabassey.com/smartphones/6b5cb8a4-5575-456c-b936-8cdfae30db74'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(resolutionMock).not.toHaveBeenCalled();
    });

    it('does not hard-404 the 2-segment /{category}/compare hub (real listing route, not a PDP)', async () => {
      mockMissing(true);
      const req = new NextRequest('https://ogabassey.com/smartphones/compare');
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(res.headers.get('x-middleware-rewrite')).toContain(
        '/ogabassey.com/smartphones/compare'
      );
      expect(resolutionMock).not.toHaveBeenCalled();
      expect(canonicalRedirectMock).not.toHaveBeenCalled();
    });

    it('does not hard-404 the /{category}/compare hub on a merchant subdomain', async () => {
      mockMissing(true);
      const req = new NextRequest(
        `https://ogabassey.${ROOT_DOMAIN}/smartphones/compare`
      );
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(res.headers.get('x-middleware-rewrite')).toContain(
        '/ogabassey/smartphones/compare'
      );
      expect(resolutionMock).not.toHaveBeenCalled();
      expect(canonicalRedirectMock).not.toHaveBeenCalled();
    });

    it('does not hard-404 the /{category}/compare hub on a root-domain slug path', async () => {
      // Third serving mode: usebaci.com/{slug}/... strips the merchant slug
      // before segment classification, so the hub guard must fire there too.
      mockMissing(true);
      const req = new NextRequest(
        `https://${ROOT_DOMAIN}/ogabassey/smartphones/compare`
      );
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(res.status).not.toBe(308);
      expect(resolutionMock).not.toHaveBeenCalled();
      expect(canonicalRedirectMock).not.toHaveBeenCalled();
    });

    it('case-normalizes the hub segment: /{category}/Compare also skips the PDP preflights', async () => {
      // Pins the guard's .toLowerCase(): mixed-case variants fall through to
      // the App Router (fail-open) instead of resolving as a product slug.
      mockMissing(true);
      const req = new NextRequest('https://ogabassey.com/smartphones/Compare');
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(resolutionMock).not.toHaveBeenCalled();
      expect(canonicalRedirectMock).not.toHaveBeenCalled();
    });

    it('never 308s the compare hub away even if an archived alias is slugged "compare"', async () => {
      canonicalRedirectMock.mockResolvedValue({
        kind: 'redirect',
        redirectPath: '/smartphones/some-old-product',
      });
      mockMissing(true);
      const req = new NextRequest('https://ogabassey.com/smartphones/compare');
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(308);
      expect(res.status).not.toBe(404);
      expect(res.headers.get('x-middleware-rewrite')).toContain(
        '/ogabassey.com/smartphones/compare'
      );
      expect(canonicalRedirectMock).not.toHaveBeenCalled();
    });

    it('hard-404s a confirmed-empty /{category}/compare hub on a custom domain', async () => {
      compareHubStatusMock.mockResolvedValue({ kind: 'empty' });
      const req = new NextRequest('https://ogabassey.com/printers/compare');
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(404);
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex, follow');
      expect(compareHubStatusMock).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'ogabassey',
          categorySlug: 'printers',
          secret: 'test-internal-secret',
        })
      );
      expect(resolutionMock).not.toHaveBeenCalled();
    });

    it('hard-404s a confirmed-empty compare hub on a merchant subdomain', async () => {
      compareHubStatusMock.mockResolvedValue({ kind: 'empty' });
      const req = new NextRequest(
        `https://ogabassey.${ROOT_DOMAIN}/printers/compare`
      );
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);

      expect(res.status).toBe(404);
      expect(compareHubStatusMock).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'ogabassey',
          categorySlug: 'printers',
        })
      );
    });

    it('hard-404s a confirmed-empty compare hub on a root-domain slug path', async () => {
      compareHubStatusMock.mockResolvedValue({ kind: 'empty' });
      const req = new NextRequest(
        `https://${ROOT_DOMAIN}/ogabassey/printers/compare`
      );
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);

      expect(res.status).toBe(404);
      expect(compareHubStatusMock).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'ogabassey',
          categorySlug: 'printers',
        })
      );
    });

    it('does not hard-404 an empty hub on param URLs and skips the status lookup entirely', async () => {
      compareHubStatusMock.mockResolvedValue({ kind: 'empty' });
      const req = new NextRequest(
        'https://ogabassey.com/printers/compare?utm_source=email'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(compareHubStatusMock).not.toHaveBeenCalled();
    });

    it('falls through when the hub status is renderable-or-unknown (fail-open default)', async () => {
      const req = new NextRequest('https://ogabassey.com/smartphones/compare');
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(compareHubStatusMock).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'ogabassey',
          categorySlug: 'smartphones',
        })
      );
    });

    it('still hard-404s a confirmed-missing categoryless /products/compare (fallback PDP, not a hub)', async () => {
      mockMissing(true);
      const req = new NextRequest('https://ogabassey.com/products/compare');
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(404);
      expect(resolutionMock).toHaveBeenCalledWith(
        expect.objectContaining({ productSlug: 'compare' })
      );
      expect(compareHubStatusMock).not.toHaveBeenCalled();
    });

    it('still hard-404s a bare /{category}/best-under path (no 2-segment route exists there)', async () => {
      mockMissing(true);
      const req = new NextRequest(
        'https://ogabassey.com/smartphones/best-under'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(404);
    });

    it('does not hard-404 the /my-account/[...path] catch-all (non-PDP first segment)', async () => {
      mockMissing(true);
      const req = new NextRequest('https://ogabassey.com/my-account/orders');
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(resolutionMock).not.toHaveBeenCalled();
    });

    it('decodes a percent-encoded product slug before the membership check', async () => {
      mockMissing(false);
      // `cafe%cc%81` is `cafe` + a combining acute accent — the DB slug stores
      // the decoded form, so the proxy must compare decoded, not the raw bytes.
      const req = new NextRequest(
        'https://ogabassey.com/smartphones/cafe%cc%81'
      );
      req.headers.set('host', 'ogabassey.com');

      await proxy(req);

      expect(resolutionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          productSlug: decodeURIComponent('cafe%cc%81'),
        })
      );
    });

    it('returns a hard 404 for a confirmed-missing product slug on a subdomain', async () => {
      mockMissing(true);
      const req = new NextRequest(
        'https://ogabassey.usebaci.com/smartphones/totally-made-up'
      );
      req.headers.set('host', 'ogabassey.usebaci.com');

      const res = await proxy(req);

      expect(res.status).toBe(404);
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(resolutionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'ogabassey',
          productSlug: 'totally-made-up',
        })
      );
    });

    it('returns a hard 404 for a confirmed-missing slug on a root-domain slug path', async () => {
      // getCustomDomainForSlug defaults to null, so the slug is served in
      // path-mode (no 301 to a custom domain) and the platform host strips the
      // leading slug, leaving `{category}/{product}` for the check.
      mockMissing(true);
      const req = new NextRequest(
        'https://usebaci.com/ogabassey/smartphones/totally-made-up'
      );
      req.headers.set('host', 'usebaci.com');

      const res = await proxy(req);

      expect(res.status).toBe(404);
      expect(resolutionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'ogabassey',
          productSlug: 'totally-made-up',
        })
      );
    });

    it('keeps the storefront slug prefix when redirecting a legacy product alias on the root domain', async () => {
      resolutionMock.mockResolvedValue({
        kind: 'redirect',
        redirectPath: '/smartphones/iphone-15-pro-max',
      });
      const req = new NextRequest(
        'https://usebaci.com/ogabassey/smartphones/iphone-15-pro-max-8gb-256gb?utm_source=email'
      );
      req.headers.set('host', 'usebaci.com');

      const res = await proxy(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe(
        'https://usebaci.com/ogabassey/smartphones/iphone-15-pro-max?utm_source=email'
      );
      expect(resolutionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'ogabassey',
          productSlug: 'iphone-15-pro-max-8gb-256gb',
        })
      );
    });

    it('exempts an AUTHENTICATED internal slug-set call from the public rate limiter', async () => {
      const req = new NextRequest(
        'https://ogabassey.com/api/internal/slug-set/ogabassey.com?slug=x'
      );
      req.headers.set('host', 'ogabassey.com');
      req.headers.set('Authorization', 'Bearer test-internal-secret');

      await proxy(req);

      expect(checkRateLimit).not.toHaveBeenCalled();
    });

    it('exempts an internal call authenticated via the custom x-baci-internal-auth header', async () => {
      // The cache-eligible preflight self-fetches drop Authorization (which would
      // make the response uncacheable) for this custom header, so the rate-limit
      // exemption must recognize it too or the self-fetches would fail open.
      const req = new NextRequest(
        'https://ogabassey.com/api/internal/slug-set/ogabassey.com?slug=x'
      );
      req.headers.set('host', 'ogabassey.com');
      req.headers.set('x-baci-internal-auth', 'test-internal-secret');

      await proxy(req);

      expect(checkRateLimit).not.toHaveBeenCalled();
    });

    it('still rate-limits an UNAUTHENTICATED request to the internal route (anti-flood)', async () => {
      const req = new NextRequest(
        'https://ogabassey.com/api/internal/slug-set/ogabassey.com'
      );
      req.headers.set('host', 'ogabassey.com');

      await proxy(req);

      // No valid bearer → must NOT be exempt, or the secret could be
      // flood-guessed without ever tripping the limiter.
      expect(checkRateLimit).toHaveBeenCalled();
    });

    it('still rate-limits an internal request bearing the WRONG secret', async () => {
      const req = new NextRequest(
        'https://ogabassey.com/api/internal/slug-set/ogabassey.com'
      );
      req.headers.set('host', 'ogabassey.com');
      req.headers.set('Authorization', 'Bearer wrong-secret');

      await proxy(req);

      expect(checkRateLimit).toHaveBeenCalled();
    });
  });

  describe('crawl-budget blog listing hard status', () => {
    const blogListingMock = vi.mocked(resolveStorefrontBlogListingStatus);

    beforeEach(() => {
      blogListingMock.mockResolvedValue({ kind: 'noop' });
    });

    it('308-redirects a known ?category= to the clean category route', async () => {
      blogListingMock.mockResolvedValueOnce({
        kind: 'redirect',
        redirectPath: '/blog/category/smartphones',
        status: 308,
      });
      const req = new NextRequest(
        'https://ogabassey.com/blog?category=Smartphones'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe(
        'https://ogabassey.com/blog/category/smartphones'
      );
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(blogListingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'ogabassey',
          intent: { kind: 'category-query', category: 'Smartphones' },
          secret: 'test-internal-secret',
        })
      );
    });

    it('307-redirects out-of-range ?page= to the clamped page', async () => {
      blogListingMock.mockResolvedValueOnce({
        kind: 'redirect',
        redirectPath: '/blog?page=3',
        status: 307,
      });
      const req = new NextRequest('https://ogabassey.com/blog?page=99');
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe(
        'https://ogabassey.com/blog?page=3'
      );
      expect(blogListingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: { kind: 'listing-page', page: 99 },
        })
      );
    });

    it('returns a hard 404 for a known author with no published posts', async () => {
      blogListingMock.mockResolvedValueOnce({ kind: 'notFound' });
      const req = new NextRequest(
        'https://ogabassey.com/blog/author/bassey-john'
      );
      req.headers.set('host', 'ogabassey.com');
      req.headers.set('user-agent', 'Googlebot/2.1');

      const res = await proxy(req);

      expect(res.status).toBe(404);
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
      expect(blogListingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: { kind: 'author', authorSlug: 'bassey-john', page: 1 },
        })
      );
    });

    it('does not preflight a plain /blog request with no actionable query', async () => {
      const req = new NextRequest('https://ogabassey.com/blog');
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(blogListingMock).not.toHaveBeenCalled();
    });

    it('does not preflight listing/category routes when ?search= is present', async () => {
      const req = new NextRequest(
        'https://ogabassey.com/blog?search=iphone&page=99'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(blogListingMock).not.toHaveBeenCalled();
    });

    it('still runs the author preflight even with a stray ?search= param', async () => {
      blogListingMock.mockResolvedValueOnce({ kind: 'notFound' });
      const req = new NextRequest(
        'https://ogabassey.com/blog/author/bassey-john?search=iphone'
      );
      req.headers.set('host', 'ogabassey.com');
      req.headers.set('user-agent', 'Googlebot/2.1');

      const res = await proxy(req);

      expect(res.status).toBe(404);
      expect(blogListingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: { kind: 'author', authorSlug: 'bassey-john', page: 1 },
        })
      );
    });

    it('sends a query-category page clamp as a listing-page intent with category', async () => {
      const req = new NextRequest(
        'https://ogabassey.com/blog?category=Smartphones&page=99'
      );
      req.headers.set('host', 'ogabassey.com');

      await proxy(req);

      expect(blogListingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: { kind: 'listing-page', page: 99, category: 'Smartphones' },
        })
      );
    });

    it('307-redirects an out-of-range clean-category page to the clamped page', async () => {
      blogListingMock.mockResolvedValueOnce({
        kind: 'redirect',
        redirectPath: '/blog?category=Smartphones&page=3',
        status: 307,
      });
      const req = new NextRequest(
        'https://ogabassey.com/blog/category/smartphones?page=99'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(307);
      expect(blogListingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: {
            kind: 'category-page',
            categorySlug: 'smartphones',
            page: 99,
          },
        })
      );
    });

    it('preserves repeated non-filter params on the preflight redirect', async () => {
      blogListingMock.mockResolvedValueOnce({
        kind: 'redirect',
        redirectPath: '/blog/category/smartphones',
        status: 308,
      });
      const req = new NextRequest(
        'https://ogabassey.com/blog?category=Smartphones&tag=a&tag=b'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(308);
      const location = new URL(res.headers.get('location') ?? '');
      expect(location.searchParams.getAll('tag')).toEqual(['a', 'b']);
    });

    it('clamps ?page= above the route cap to 10000 in the intent', async () => {
      const req = new NextRequest('https://ogabassey.com/blog?page=100000');
      req.headers.set('host', 'ogabassey.com');

      await proxy(req);

      expect(blogListingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: { kind: 'listing-page', page: 10000 },
        })
      );
    });

    it('preserves non-filter params (utm_*) on the preflight redirect', async () => {
      blogListingMock.mockResolvedValueOnce({
        kind: 'redirect',
        redirectPath: '/blog/category/smartphones',
        status: 308,
      });
      const req = new NextRequest(
        'https://ogabassey.com/blog?category=Smartphones&utm_source=newsletter'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe(
        'https://ogabassey.com/blog/category/smartphones?utm_source=newsletter'
      );
    });
  });

  describe('crawl-budget blog post hard status', () => {
    const blogStatusMock = vi.mocked(resolveStorefrontBlogPostStatus);

    it('returns a hard 404 for confirmed-missing custom-domain blog posts before the App Router streams', async () => {
      blogStatusMock.mockResolvedValue({ kind: 'missing' });
      const req = new NextRequest(
        'https://ogabassey.com/blog/totally-missing-post'
      );
      req.headers.set('host', 'ogabassey.com');
      req.headers.set('user-agent', 'Googlebot/2.1');

      const res = await proxy(req);

      expect(res.status).toBe(404);
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(res.headers.get('Cache-Control')).toContain('no-store');
      expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
      expect(blogStatusMock).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'ogabassey',
          postSlug: 'totally-missing-post',
          secret: 'test-internal-secret',
        })
      );
    });

    it('308-redirects retired custom-domain blog posts before storefront rewrite', async () => {
      blogStatusMock.mockResolvedValue({
        kind: 'redirect',
        redirectPath: '/blog/canonical-post',
      });
      const req = new NextRequest(
        'https://ogabassey.com/blog/retired-post?utm_source=email'
      );
      req.headers.set('host', 'ogabassey.com');

      const res = await proxy(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe(
        'https://ogabassey.com/blog/canonical-post?utm_source=email'
      );
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    });

    it('keeps root-domain merchant prefixes when redirecting retired blog posts', async () => {
      blogStatusMock.mockResolvedValue({
        kind: 'redirect',
        redirectPath: '/blog/canonical-post',
      });
      const req = new NextRequest(
        'https://usebaci.com/merchant-demo/blog/retired-post'
      );
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe(
        'https://usebaci.com/merchant-demo/blog/canonical-post'
      );
      expect(blogStatusMock).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'merchant-demo',
          postSlug: 'retired-post',
        })
      );
    });

    it('keeps root-domain merchant prefixes in missing blog post recovery links', async () => {
      blogStatusMock.mockResolvedValue({ kind: 'missing' });
      const req = new NextRequest(
        'https://usebaci.com/merchant-demo/blog/missing-post'
      );
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);

      expect(res.status).toBe(404);
      expect(await res.text()).toContain('href="/merchant-demo"');
      expect(blogStatusMock).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'merchant-demo',
          postSlug: 'missing-post',
        })
      );
    });

    it('does not run the blog status check for sitemap or RSC requests', async () => {
      blogStatusMock.mockResolvedValue({ kind: 'missing' });
      const sitemapReq = new NextRequest(
        'https://ogabassey.com/blog/sitemap.xml'
      );
      sitemapReq.headers.set('host', 'ogabassey.com');

      const sitemapRes = await proxy(sitemapReq);
      expect(sitemapRes.status).not.toBe(404);
      expect(blogStatusMock).not.toHaveBeenCalled();

      const rscReq = new NextRequest(
        'https://ogabassey.com/blog/totally-missing-post'
      );
      rscReq.headers.set('host', 'ogabassey.com');
      rscReq.headers.set('RSC', '1');

      const rscRes = await proxy(rscReq);
      expect(rscRes.status).not.toBe(404);
      expect(blogStatusMock).not.toHaveBeenCalled();
    });

    it('does not hard-404 draft-mode blog previews before the page can render drafts', async () => {
      blogStatusMock.mockResolvedValue({ kind: 'missing' });
      const req = new NextRequest('https://ogabassey.com/blog/draft-post', {
        headers: {
          cookie: '__prerender_bypass=preview-token',
          host: 'ogabassey.com',
        },
      });

      const res = await proxy(req);

      expect(res.status).not.toBe(404);
      expect(res.headers.get('x-middleware-rewrite')).toContain(
        '/blog/draft-post'
      );
      expect(blogStatusMock).not.toHaveBeenCalled();
    });
  });

  it('does not treat root checkout as a merchant slug redirect candidate', async () => {
    const req = new NextRequest(`https://${ROOT_DOMAIN}/checkout`);
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(getCustomDomainForSlug).not.toHaveBeenCalled();
  });

  it('rewrites the legacy analytics conversion alias to the canonical API handler on the root domain', async () => {
    const req = new NextRequest(
      `https://${ROOT_DOMAIN}/analytics/conversion?event=purchase`,
      {
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          Origin: `https://${ROOT_DOMAIN}`,
        },
        method: 'POST',
      }
    );
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(res.status).not.toBe(403);
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      `https://${ROOT_DOMAIN}/api/analytics/conversion?event=purchase`
    );
    expect(res.headers.get('Cache-Control')).toBe(
      'no-cache, must-revalidate, max-age=0'
    );
    expect(res.headers.get('x-pathname')).toBe('/api/analytics/conversion');
  });

  it('rewrites the legacy analytics conversion alias before custom-domain storefront routing', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/analytics/conversion?event=purchase',
      {
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://ogabassey.com',
        },
        method: 'POST',
      }
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(getSlugForCustomDomain).toHaveBeenCalledTimes(1);
    expect(getSlugForCustomDomain).toHaveBeenCalledWith('ogabassey.com');
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://ogabassey.com/api/analytics/conversion?event=purchase'
    );
    expect(res.headers.get('x-pathname')).toBe('/api/analytics/conversion');
  });

  it('rewrites trailing-slash legacy analytics conversion POSTs without redirecting the body', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/analytics/conversion/?event=purchase',
      {
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://ogabassey.com',
        },
        method: 'POST',
      }
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(308);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://ogabassey.com/api/analytics/conversion?event=purchase'
    );
    expect(res.headers.get('x-pathname')).toBe('/api/analytics/conversion');
  });

  it('rewrites the legacy analytics conversion alias before subdomain storefront routing', async () => {
    const req = new NextRequest(
      `https://ogabassey.${ROOT_DOMAIN}/analytics/conversion?event=purchase`,
      {
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          Origin: `https://ogabassey.${ROOT_DOMAIN}`,
        },
        method: 'POST',
      }
    );
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

    const res = await proxy(req);

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(getCustomDomainForSlug).not.toHaveBeenCalled();
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      `https://ogabassey.${ROOT_DOMAIN}/api/analytics/conversion?event=purchase`
    );
    expect(res.headers.get('x-pathname')).toBe('/api/analytics/conversion');
  });

  it('keeps a GET legacy analytics-shaped URL in custom-domain storefront routing', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/analytics/conversion?ref=organic'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    const rewriteUrl = new URL(res.headers.get('x-middleware-rewrite') ?? '');

    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(rewriteUrl.origin).toBe('https://ogabassey.com');
    expect(rewriteUrl.pathname).toBe('/ogabassey.com/analytics/conversion');
    expect(rewriteUrl.searchParams.get('ref')).toBe('organic');
    expect(rewriteUrl.searchParams.get('__baci_metadata_cache_bucket')).toBe(
      'streaming'
    );
    expect(res.headers.get('x-pathname')).toBe('/analytics/conversion');
    expect(res.headers.get('Cache-Control')).not.toBe(
      'no-cache, must-revalidate, max-age=0'
    );
  });

  it('keeps a GET legacy analytics-shaped URL in subdomain storefront routing', async () => {
    const req = new NextRequest(
      `https://ogabassey.${ROOT_DOMAIN}/analytics/conversion?ref=organic`
    );
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

    const res = await proxy(req);

    const rewriteUrl = new URL(res.headers.get('x-middleware-rewrite') ?? '');

    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(getCustomDomainForSlug).toHaveBeenCalledWith('ogabassey');
    expect(rewriteUrl.origin).toBe(`https://ogabassey.${ROOT_DOMAIN}`);
    expect(rewriteUrl.pathname).toBe('/ogabassey/analytics/conversion');
    expect(rewriteUrl.searchParams.get('ref')).toBe('organic');
    expect(rewriteUrl.searchParams.get('__baci_metadata_cache_bucket')).toBe(
      'streaming'
    );
    expect(res.headers.get('x-pathname')).toBe('/analytics/conversion');
    expect(res.headers.get('Cache-Control')).not.toBe(
      'no-cache, must-revalidate, max-age=0'
    );
  });

  it('applies API payload size protection to the legacy analytics conversion alias', async () => {
    const req = new NextRequest(`https://${ROOT_DOMAIN}/analytics/conversion`, {
      body: '{}',
      headers: {
        'Content-Length': String(2 * 1024 * 1024 + 1),
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({
      error: 'Payload too large',
      maxSize: '2MB',
    });
  });

  it('applies API Origin protection to the legacy analytics conversion alias', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce(null);
    const req = new NextRequest(`https://${ROOT_DOMAIN}/analytics/conversion`, {
      body: '{}',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example',
      },
      method: 'POST',
    });
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(getSlugForCustomDomain).toHaveBeenCalledWith('attacker.example');
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Cross-origin request blocked',
    });
  });

  it('allows attribution POSTs from www custom domains registered at the apex', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('ogabassey');
    const req = new NextRequest('https://www.example.com/api/attr', {
      body: 'gclid=test-click-id',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://www.example.com',
      },
      method: 'POST',
    });
    req.headers.set('host', 'www.example.com');

    const res = await proxy(req);

    expect(getSlugForCustomDomain).toHaveBeenCalledWith('example.com');
    expect(res.status).not.toBe(403);
  });

  it('does not promote apex API origins via a www-only custom-domain registration', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce(null);
    const req = new NextRequest('https://example.com/api/attr', {
      body: 'gclid=test-click-id',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://example.com',
      },
      method: 'POST',
    });
    req.headers.set('host', 'example.com');

    const res = await proxy(req);

    expect(getSlugForCustomDomain).toHaveBeenCalledWith('example.com');
    expect(getSlugForCustomDomain).not.toHaveBeenCalledWith('www.example.com');
    expect(res.status).toBe(403);
  });

  it.each([
    '/wc-api/klp_wc_payment_webhook',
    '/wc-api/klp_wc_payment_webhook/',
  ])('returns 410 for retired legacy Klump WooCommerce webhook path %s', async (path) => {
    const req = new NextRequest(`https://ogabassey.com${path}?source=klump`, {
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(410);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(getSlugForCustomDomain).not.toHaveBeenCalled();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('x-pathname')).toBe('/api/payments/klump/webhook');
    await expect(res.json()).resolves.toEqual({
      error: 'Legacy Klump WooCommerce webhook endpoint retired',
    });
  });

  it.each([
    'GET',
    'HEAD',
  ])('returns 410 for %s requests to the retired legacy Klump WooCommerce webhook path', async (method) => {
    const req = new NextRequest(
      'https://ogabassey.com/wc-api/klp_wc_payment_webhook/',
      { method }
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(410);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(getSlugForCustomDomain).not.toHaveBeenCalled();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('x-pathname')).toBe('/api/payments/klump/webhook');
  });

  it('retires legacy Klump payment webhooks before Origin checks block external providers', async () => {
    const getSlugForCustomDomainMock = vi.mocked(getSlugForCustomDomain);
    getSlugForCustomDomainMock.mockResolvedValue(null);
    const req = new NextRequest(
      'https://ogabassey.com/wc-api/klp_wc_payment_webhook/',
      {
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://checkout.useklump.com',
        },
        method: 'POST',
      }
    );
    req.headers.set('host', 'ogabassey.com');

    try {
      const res = await proxy(req);

      expect(res.status).toBe(410);
      expect(getSlugForCustomDomain).not.toHaveBeenCalled();
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    } finally {
      getSlugForCustomDomainMock.mockResolvedValue('ogabassey');
    }
  });

  it('does not block direct payment webhook API routes with an external Origin header', async () => {
    const getSlugForCustomDomainMock = vi.mocked(getSlugForCustomDomain);
    getSlugForCustomDomainMock.mockResolvedValue(null);
    const req = new NextRequest(
      `https://${ROOT_DOMAIN}/api/payments/klump/webhook`,
      {
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://checkout.useklump.com',
        },
        method: 'POST',
      }
    );
    req.headers.set('host', ROOT_DOMAIN);

    try {
      const res = await proxy(req);

      expect(res.status).toBe(200);
      expect(getSlugForCustomDomain).not.toHaveBeenCalled();
      expect(res.headers.get('x-pathname')).toBe('/api/payments/klump/webhook');
    } finally {
      getSlugForCustomDomainMock.mockResolvedValue('ogabassey');
    }
  });

  it('preserves no-trailing-slash redirects for ordinary storefront paths', async () => {
    const req = new NextRequest('https://ogabassey.com/products/');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://ogabassey.com/products');
  });

  it('preserves no-trailing-slash redirects for storefront paths with dots in slugs', async () => {
    const req = new NextRequest('https://ogabassey.com/products/iphone-v1.0/');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/products/iphone-v1.0'
    );
  });

  it('should fall back to domain when slug lookup returns null', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce(null);
    const req = new NextRequest(
      'https://unknown-merchant.com/blog/sitemap.xml'
    );
    req.headers.set('host', 'unknown-merchant.com');

    const res = await proxy(req);

    expect(getSlugForCustomDomain).toHaveBeenCalledWith('unknown-merchant.com');
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://unknown-merchant.com/unknown-merchant.com/blog/sitemap.xml'
    );
  });

  it('should rewrite custom-domain blog sitemaps with the merchant slug', async () => {
    const req = new NextRequest('https://ogabassey.com/blog/sitemap.xml');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(getSlugForCustomDomain).toHaveBeenCalledWith('ogabassey.com');
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://ogabassey.com/ogabassey/blog/sitemap.xml'
    );
  });

  it('rewrites custom-domain root sitemaps to the explicit root sitemap route', async () => {
    const req = new NextRequest('https://ogabassey.com/sitemap.xml');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(getSlugForCustomDomain).toHaveBeenCalledWith('ogabassey.com');
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://ogabassey.com/ogabassey/sitemap/root.xml'
    );
    expect(res.headers.get('x-middleware-request-x-merchant-domain')).toBe(
      'ogabassey.com'
    );
    expect(res.headers.get('x-middleware-request-x-merchant-slug')).toBe(
      'ogabassey'
    );
  });

  it('rewrites subdomain root sitemaps to the explicit root sitemap route', async () => {
    const req = new NextRequest(`https://ogabassey.${ROOT_DOMAIN}/sitemap.xml`);
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

    const res = await proxy(req);

    expect(res.headers.get('x-middleware-rewrite')).toBe(
      `https://ogabassey.${ROOT_DOMAIN}/ogabassey/sitemap/root.xml`
    );
    expect(res.headers.get('x-middleware-request-x-merchant-slug')).toBe(
      'ogabassey'
    );
  });

  it('rewrites custom-domain favicon.ico requests to the dynamic favicon route', async () => {
    const req = new NextRequest('https://ogabassey.com/favicon.ico');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(getSlugForCustomDomain).toHaveBeenCalledWith('ogabassey.com');
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://ogabassey.com/ogabassey/favicon.ico'
    );
    expect(res.headers.get('x-middleware-request-x-merchant-domain')).toBe(
      'ogabassey.com'
    );
    expect(res.headers.get('x-middleware-request-x-merchant-slug')).toBe(
      'ogabassey'
    );
  });

  it('rewrites subdomain favicon.ico requests to the dynamic favicon route without custom domain redirect', async () => {
    const req = new NextRequest(`https://ogabassey.${ROOT_DOMAIN}/favicon.ico`);
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

    const res = await proxy(req);

    expect(res.headers.get('x-middleware-rewrite')).toBe(
      `https://ogabassey.${ROOT_DOMAIN}/ogabassey/favicon.ico`
    );
    expect(res.headers.get('x-middleware-request-x-merchant-slug')).toBe(
      'ogabassey'
    );
    expect(res.status).not.toBe(301);
  });

  it('passes through platform root favicon.ico requests unmodified', async () => {
    const req = new NextRequest(`https://${ROOT_DOMAIN}/favicon.ico`);
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).toBe(200);
  });

  it('passes custom-domain IndexNow key files through to the public key file', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/0751d5c882ab3d7c013ecbfe9e624d71.txt'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(getSlugForCustomDomain).toHaveBeenCalledWith('ogabassey.com');
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-middleware-request-x-custom-domain')).toBe(
      'ogabassey.com'
    );
    expect(res.headers.get('x-middleware-request-x-merchant-domain')).toBe(
      'ogabassey.com'
    );
    expect(res.headers.get('x-middleware-request-x-merchant-slug')).toBe(
      'ogabassey'
    );
  });

  it('does not pass through IndexNow key files for unregistered custom domains', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce(null);
    const req = new NextRequest(
      'https://unregistered.example/0751d5c882ab3d7c013ecbfe9e624d71.txt'
    );
    req.headers.set('host', 'unregistered.example');

    const res = await proxy(req);

    expect(getSlugForCustomDomain).toHaveBeenCalledWith('unregistered.example');
    expect(res.headers.get('x-middleware-next')).toBeNull();
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://unregistered.example/unregistered.example/0751d5c882ab3d7c013ecbfe9e624d71.txt'
    );
  });

  it('keeps normal custom-domain browsers in the streaming metadata bucket', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/smartphones/samsung-galaxy-a37-5g'
    );
    req.headers.set('host', 'ogabassey.com');
    req.headers.set(
      'user-agent',
      'Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0 Safari/537.36'
    );

    const res = await proxy(req);

    const rewriteUrl = new URL(
      res.headers.get('x-middleware-rewrite') as string
    );
    expect(rewriteUrl.origin).toBe('https://ogabassey.com');
    expect(rewriteUrl.pathname).toBe(
      '/ogabassey.com/smartphones/samsung-galaxy-a37-5g'
    );
    expect(
      rewriteUrl.searchParams.get(STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM)
    ).toBe('streaming');
    expect(
      res.headers.get('x-middleware-request-x-baci-metadata-cache-bucket')
    ).toBe('streaming');
    expect(res.headers.get('Vary')).toBe('x-baci-metadata-cache-bucket');
  });

  it('separates empty user-agent streamed shells from browser metadata buckets', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/smartphones/samsung-galaxy-a37-5g'
    );
    req.headers.set('host', 'ogabassey.com');
    req.headers.set('user-agent', '');

    const res = await proxy(req);
    const rewriteUrl = new URL(
      res.headers.get('x-middleware-rewrite') as string
    );

    expect(
      res.headers.get('x-middleware-request-x-baci-metadata-cache-bucket')
    ).toBe('streaming');
    expect(
      rewriteUrl.searchParams.get(STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM)
    ).toBe('streaming');
  });

  it('overwrites spoofed metadata cache buckets for metadata-blocking bots', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/smartphones/samsung-galaxy-a37-5g'
    );
    req.headers.set('host', 'ogabassey.com');
    req.headers.set('user-agent', 'Twitterbot/1.0');
    req.headers.set('x-baci-metadata-cache-bucket', 'streaming');

    const res = await proxy(req);
    const rewriteUrl = new URL(
      res.headers.get('x-middleware-rewrite') as string
    );

    expect(
      res.headers.get('x-middleware-request-x-baci-metadata-cache-bucket')
    ).toBe('metadata-blocking');
    expect(
      rewriteUrl.searchParams.get(STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM)
    ).toBe('metadata-blocking');
    expect(res.headers.get('Vary')).toBe('x-baci-metadata-cache-bucket');
  });

  it('puts Next PPR DOM bots in the metadata-blocking cache bucket', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/smartphones/samsung-galaxy-a37-5g'
    );
    req.headers.set('host', 'ogabassey.com');
    req.headers.set('user-agent', 'Googlebot/2.1');

    const res = await proxy(req);

    expect(
      res.headers.get('x-middleware-request-x-baci-metadata-cache-bucket')
    ).toBe('metadata-blocking');
    expect(res.headers.get('Vary')).toBe('x-baci-metadata-cache-bucket');
  });

  it('forwards an HTML-limited annotated user-agent for blocking bots Next would render as humans', async () => {
    // Regression: Semrush audit 2026-07-07 — compare pages served the raw
    // application/x-nextjs-pre-render postponed state to SemrushBot/AhrefsBot
    // because Next's hardcoded getBotType() does not know them. The proxy must
    // forward an annotated UA so the origin does a full blocking HTML render.
    const userAgent =
      'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)';
    const req = new NextRequest(
      'https://ogabassey.com/laptops/compare/macbook-air-m2-vs-macbook-pro-14'
    );
    req.headers.set('host', 'ogabassey.com');
    req.headers.set('user-agent', userAgent);

    const res = await proxy(req);

    expect(res.headers.get('x-middleware-request-user-agent')).toBe(
      `${userAgent} googleweblight`
    );
    expect(
      res.headers.get('x-middleware-request-x-baci-metadata-cache-bucket')
    ).toBe('metadata-blocking');
  });

  it.each([
    [
      'Googlebot (Next DOM bot)',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    ],
    [
      'bingbot (Next HTML-limited bot)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    ],
    [
      'a normal browser',
      'Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
    ],
  ])('forwards the original user-agent unchanged for %s', async (_label, userAgent) => {
    const req = new NextRequest(
      'https://ogabassey.com/laptops/compare/macbook-air-m2-vs-macbook-pro-14'
    );
    req.headers.set('host', 'ogabassey.com');
    req.headers.set('user-agent', userAgent);

    const res = await proxy(req);

    expect(res.headers.get('x-middleware-request-user-agent')).toBe(userAgent);
  });

  it.each([
    ['Googlebot', 'Googlebot/2.1'],
    ['SemrushBot', 'SemrushBot/7~bl'],
  ])('keeps custom-domain blog post metadata in the blocking bucket for %s', async (_label, userAgent) => {
    const req = new NextRequest(
      'https://ogabassey.com/blog/infinix-hot-70-pro-420200-6000mah-144hz-5g-checks-1783286195'
    );
    req.headers.set('host', 'ogabassey.com');
    req.headers.set('user-agent', userAgent);

    const res = await proxy(req);
    const rewriteUrl = new URL(
      res.headers.get('x-middleware-rewrite') as string
    );

    expect(rewriteUrl.pathname).toBe(
      '/ogabassey.com/blog/infinix-hot-70-pro-420200-6000mah-144hz-5g-checks-1783286195'
    );
    expect(
      rewriteUrl.searchParams.get(STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM)
    ).toBe('metadata-blocking');
    expect(
      res.headers.get('x-middleware-request-x-baci-metadata-cache-bucket')
    ).toBe('metadata-blocking');
    expect(res.headers.get('Vary')).toBe('x-baci-metadata-cache-bucket');
  });

  it('applies streaming cache partitioning to merchant subdomain browsers', async () => {
    const req = new NextRequest(
      `https://ogabassey.${ROOT_DOMAIN}/smartphones/samsung-galaxy-a37-5g`
    );
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);
    req.headers.set(
      'user-agent',
      'Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0 Safari/537.36'
    );

    const res = await proxy(req);
    const rewriteUrl = new URL(
      res.headers.get('x-middleware-rewrite') as string
    );

    expect(
      res.headers.get('x-middleware-request-x-baci-metadata-cache-bucket')
    ).toBe('streaming');
    expect(
      rewriteUrl.searchParams.get(STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM)
    ).toBe('streaming');
    expect(res.headers.get('Vary')).toBe('x-baci-metadata-cache-bucket');
  });

  it('applies hidden streaming cache partitioning to root-domain PDP browser routes', async () => {
    const req = new NextRequest(
      `https://${ROOT_DOMAIN}/merchant-demo/products/samsung-galaxy-a37-5g`
    );
    req.headers.set('host', ROOT_DOMAIN);
    req.headers.set(
      'user-agent',
      'Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0 Safari/537.36'
    );

    const res = await proxy(req);
    const rewriteUrl = new URL(
      res.headers.get('x-middleware-rewrite') as string
    );

    expect(rewriteUrl.origin).toBe(`https://${ROOT_DOMAIN}`);
    expect(rewriteUrl.pathname).toBe(
      '/merchant-demo/products/samsung-galaxy-a37-5g'
    );
    expect(
      rewriteUrl.searchParams.get(STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM)
    ).toBe('streaming');
    expect(
      res.headers.get('x-middleware-request-x-baci-metadata-cache-bucket')
    ).toBe('streaming');
    expect(res.headers.get('Vary')).toBe('x-baci-metadata-cache-bucket');
  });

  it.each([
    ['terms-and-conditions', '/terms-and-conditions'],
    ['terms-of-service', '/terms-of-service'],
  ])('redirects custom-domain legacy %s URLs to the canonical /terms page before storefront rewrite', async (_label, legacyPathname) => {
    const req = new NextRequest(
      `https://ogabassey.com${legacyPathname}?utm_source=email`
    );
    req.headers.set('host', 'ogabassey.com');
    req.headers.set('user-agent', 'Googlebot/2.1');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/terms?utm_source=email'
    );
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('redirects custom-domain legacy terms aliases for HEAD requests', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/terms-and-conditions?utm_source=email',
      { method: 'HEAD' }
    );
    req.headers.set('host', 'ogabassey.com');
    req.headers.set('user-agent', 'Googlebot/2.1');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/terms?utm_source=email'
    );
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('does not 301 non-idempotent legacy terms alias requests', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/terms-and-conditions?utm_source=email',
      { method: 'POST' }
    );
    req.headers.set('host', 'ogabassey.com');
    req.headers.set('user-agent', 'Googlebot/2.1');

    const res = await proxy(req);

    expect(res.status).not.toBe(301);
    expect(res.headers.get('location')).toBeNull();
  });

  it('does not redirect the canonical custom-domain /terms URL to itself', async () => {
    const req = new NextRequest('https://ogabassey.com/terms?utm_source=email');
    req.headers.set('host', 'ogabassey.com');
    req.headers.set('user-agent', 'Googlebot/2.1');

    const res = await proxy(req);
    const rewriteUrl = new URL(
      res.headers.get('x-middleware-rewrite') as string
    );

    expect(res.status).not.toBe(301);
    expect(res.headers.get('location')).toBeNull();
    expect(rewriteUrl.pathname).toBe('/ogabassey.com/terms');
    expect(
      rewriteUrl.searchParams.get(STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM)
    ).toBe('metadata-blocking');
  });

  it('redirects merchant subdomain legacy terms aliases to /terms without adding a slug-prefixed duplicate', async () => {
    const req = new NextRequest(
      `https://merchant-demo.${ROOT_DOMAIN}/terms-and-conditions?ref=legal`
    );
    req.headers.set('host', `merchant-demo.${ROOT_DOMAIN}`);
    req.headers.set('user-agent', 'Googlebot/2.1');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      `https://merchant-demo.${ROOT_DOMAIN}/terms?ref=legal`
    );
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('collapses custom-domain slug-prefixed legacy terms aliases directly to /terms', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/terms-and-conditions?utm_source=email'
    );
    req.headers.set('host', 'ogabassey.com');
    req.headers.set('user-agent', 'Googlebot/2.1');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/terms?utm_source=email'
    );
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('collapses root-domain slug-prefixed legacy terms aliases to one custom-domain canonical hop', async () => {
    vi.mocked(getCustomDomainForSlug).mockResolvedValueOnce('ogabassey.com');
    const req = new NextRequest(
      `https://${ROOT_DOMAIN}/ogabassey/terms-and-conditions?utm_source=email`
    );
    req.headers.set('host', ROOT_DOMAIN);
    req.headers.set('user-agent', 'Googlebot/2.1');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/terms?utm_source=email'
    );
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it.each([
    [
      'custom-domain storefront home',
      'https://ogabassey.com/',
      '/ogabassey.com',
      'metadata-blocking',
      'Googlebot/2.1',
    ],
    [
      'custom-domain products index',
      'https://ogabassey.com/products',
      '/ogabassey.com/products',
      'metadata-blocking',
      'Googlebot/2.1',
    ],
    [
      'custom-domain category listing',
      'https://ogabassey.com/gaming-laptops',
      '/ogabassey.com/gaming-laptops',
      'metadata-blocking',
      'Googlebot/2.1',
    ],
    [
      'custom-domain blog post',
      'https://ogabassey.com/blog/the-ultimate-checklist-for-buying-a-used-iphone-in-2025',
      '/ogabassey.com/blog/the-ultimate-checklist-for-buying-a-used-iphone-in-2025',
      'metadata-blocking',
      'Googlebot/2.1',
    ],
    [
      'subdomain category listing',
      `https://ogabassey.${ROOT_DOMAIN}/gaming-laptops`,
      '/ogabassey/gaming-laptops',
      'streaming',
      'Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
    ],
    [
      'subdomain storefront home',
      `https://ogabassey.${ROOT_DOMAIN}/`,
      '/ogabassey',
      'streaming',
      'Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
    ],
    [
      'root-domain slug-prefixed category listing',
      `https://${ROOT_DOMAIN}/merchant-demo/gaming-laptops`,
      '/merchant-demo/gaming-laptops',
      'streaming',
      'Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
    ],
    [
      'root-domain slug-prefixed storefront home',
      `https://${ROOT_DOMAIN}/merchant-demo`,
      '/merchant-demo',
      'streaming',
      'Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
    ],
    [
      'root-domain slug-prefixed blog post',
      `https://${ROOT_DOMAIN}/merchant-demo/blog/the-ultimate-checklist-for-buying-a-used-iphone-in-2025`,
      '/merchant-demo/blog/the-ultimate-checklist-for-buying-a-used-iphone-in-2025',
      'streaming',
      'Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
    ],
  ])('applies hidden metadata cache partitioning to public %s', async (_label, url, expectedPathname, expectedBucket, userAgent) => {
    const req = new NextRequest(url);
    req.headers.set('host', new URL(url).host);
    req.headers.set('user-agent', userAgent);

    const res = await proxy(req);
    expect(res.headers.get('x-middleware-rewrite')).not.toBeNull();
    const rewriteUrl = new URL(
      res.headers.get('x-middleware-rewrite') as string
    );

    expect(rewriteUrl.pathname).toBe(expectedPathname);
    expect(
      rewriteUrl.searchParams.get(STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM)
    ).toBe(expectedBucket);
    expect(
      res.headers.get('x-middleware-request-x-baci-metadata-cache-bucket')
    ).toBe(expectedBucket);
    expect(res.headers.get('Vary')).toBe('x-baci-metadata-cache-bucket');
  });

  it.each([
    `https://${ROOT_DOMAIN}/pricing`,
    `https://${ROOT_DOMAIN}/checkout`,
    `https://${ROOT_DOMAIN}/blog`,
    `https://${ROOT_DOMAIN}/terms`,
  ])('does not add storefront metadata cache partitioning to platform route %s', async (url) => {
    const req = new NextRequest(url);
    req.headers.set('host', new URL(url).host);
    req.headers.set('user-agent', 'Googlebot/2.1');

    const res = await proxy(req);

    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it.each([
    'https://ogabassey.com/smartphones/samsung-galaxy-z-fold-4',
    'https://ogabassey.com/products/samsung-galaxy-z-fold-4',
    'https://ogabassey.com/new-category/new-product',
    `https://ogabassey.${ROOT_DOMAIN}/smartphones/samsung-galaxy-z-fold-4`,
    `https://${ROOT_DOMAIN}/ogabassey/smartphones/samsung-galaxy-z-fold-4`,
  ])('uses durable purge-backed 30-minute downstream PDP freshness for %s', async (url) => {
    const req = new NextRequest(url);
    req.headers.set('host', new URL(url).host);

    const res = await proxy(req);

    // The Next resume-mismatch that previously required no-store on PDP HTML is
    // fixed via patches/next@16.2.9.patch (PR #2436), so the prerendered PDP
    // shell is safe to cache/replay at the edge for the LCP win. Ops-2 layers
    // the freshness per tier: bfcache-safe browser value + split CDN headers
    // (config/storefront-cdn-cache-control.ts).
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=0, must-revalidate'
    );
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe(
      'max-age=300, stale-while-revalidate=86400'
    );
    expect(res.headers.get('CDN-Cache-Control')).toBe(
      'max-age=1800, stale-while-revalidate=86400, stale-if-error=86400'
    );
    expect(res.headers.get('Vary') ?? '').not.toContain('Cookie');
  });

  it.each([
    'https://ogabassey.com/',
    `https://ogabassey.${ROOT_DOMAIN}/`,
    `https://${ROOT_DOMAIN}/ogabassey`,
    'https://ogabassey.com/products',
    'https://ogabassey.com/smartphones',
    'https://ogabassey.com/blog',
    'https://ogabassey.com/blog/the-ultimate-checklist-for-buying-a-used-iphone-in-2025',
    'https://ogabassey.com/blog/author/bassey-john',
  ])('CDN-caches anonymous public storefront documents for %s', async (url) => {
    const req = new NextRequest(url);
    req.headers.set('host', new URL(url).host);

    const res = await proxy(req);

    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=0, must-revalidate'
    );
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe(
      'max-age=300, stale-while-revalidate=86400'
    );
    expect(res.headers.get('CDN-Cache-Control')).toBe(
      'max-age=3600, stale-while-revalidate=86400, stale-if-error=86400'
    );
  });

  it.each([
    'https://ogabassey.com/about',
    'https://ogabassey.com/contact',
    'https://ogabassey.com/faq',
    'https://ogabassey.com/privacy',
    'https://ogabassey.com/returns',
    'https://ogabassey.com/shipping',
    'https://ogabassey.com/terms',
    'https://ogabassey.com/warranty',
  ])('keeps mutable storefront trust content on the five-minute downstream TTL for %s', async (url) => {
    const req = new NextRequest(url);
    req.headers.set('host', new URL(url).host);

    const res = await proxy(req);

    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=0, must-revalidate'
    );
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe(
      'max-age=300, stale-while-revalidate=86400'
    );
    expect(res.headers.get('CDN-Cache-Control')).toBe(
      'max-age=300, stale-while-revalidate=86400, stale-if-error=86400'
    );
  });

  it('keeps a storefront without a public purge policy on Vercel-only caching', async () => {
    const req = new NextRequest(`https://${ROOT_DOMAIN}/merchant-demo`);
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=0, must-revalidate'
    );
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe(
      'max-age=300, stale-while-revalidate=86400'
    );
    expect(res.headers.get('CDN-Cache-Control')).toBeNull();
  });

  it.each([
    ['custom-domain home', 'https://ogabassey.com/', 'ph:ogabassey.com'],
    [
      'custom-domain nested listing',
      'https://ogabassey.com/smartphones/compare/iphone-15-vs-samsung-s24',
      'ph:ogabassey.com',
    ],
    [
      'merchant subdomain home',
      `https://merchant-demo.${ROOT_DOMAIN}/`,
      'ps:merchant-demo',
    ],
    [
      'root-domain merchant path',
      `https://${ROOT_DOMAIN}/merchant-demo`,
      'ps:merchant-demo',
    ],
    [
      'preview merchant path',
      'https://baci-preview-team.vercel.app/merchant-demo',
      'ps:merchant-demo',
    ],
  ])('tags cacheable %s documents for publication eviction', async (_label, url, expectedTag) => {
    const req = new NextRequest(url);
    req.headers.set('host', new URL(url).host);

    const res = await proxy(req);

    expect(res.headers.get('Vercel-Cache-Tag')).toBe(expectedTag);
  });

  it.each([
    ['reserved checkout route', `https://${ROOT_DOMAIN}/checkout`],
    ['platform API route', `https://${ROOT_DOMAIN}/api`],
    ['invalid IP custom-domain host', 'https://203.0.113.10/'],
  ])('omits publication tags for %s', async (_label, url) => {
    const req = new NextRequest(url);
    req.headers.set('host', new URL(url).host);

    const res = await proxy(req);

    expect(res.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it.each([
    {
      headers: { cookie: 'sb-auth-token=legacy-session' },
      url: 'https://ogabassey.com/smartphones',
    },
    {
      headers: {
        cookie:
          'sb-example-project-auth-token.0=chunk-a; sb-example-project-auth-token.1=chunk-b',
      },
      url: 'https://ogabassey.com/smartphones/samsung-galaxy-z-fold-4',
    },
    {
      headers: { 'x-supabase-auth-token': 'session-token' },
      url: 'https://ogabassey.com/smartphones/best-under/under-500k',
    },
    {
      headers: { authorization: 'Bearer session-token' },
      url: `https://ogabassey.${ROOT_DOMAIN}/smartphones/compare/iphone-15-vs-samsung-s24`,
    },
  ])('keeps authenticated storefront documents out of the CDN cache for $url', async ({
    headers,
    url,
  }) => {
    const requestHeaders = new Headers({ host: new URL(url).host });
    for (const [name, value] of Object.entries(headers)) {
      requestHeaders.set(name, value);
    }
    const req = new NextRequest(url, { headers: requestHeaders });

    const res = await proxy(req);

    expect(res.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0, must-revalidate'
    );
    expect(res.headers.get('Cache-Control')).not.toContain('s-maxage');
    expect(res.headers.get('Vary')).toContain('Cookie');
    expect(res.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it.each([
    'POST',
    'PUT',
  ])('never CDN-caches a %s storefront document', async (method) => {
    const url = 'https://ogabassey.com/smartphones';
    const req = new NextRequest(url, {
      headers: { host: 'ogabassey.com' },
      method,
    });

    const res = await proxy(req);

    expect(res.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0, must-revalidate'
    );
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
    expect(res.headers.get('CDN-Cache-Control')).toBeNull();
    expect(res.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it.each([
    // Main storefront-document branch → Ops-2 layered split headers.
    { edgeCached: true, url: 'https://ogabassey.com/smartphones' },
    {
      downstreamCacheControl:
        'max-age=1800, stale-while-revalidate=86400, stale-if-error=86400',
      edgeCached: true,
      url: 'https://ogabassey.com/smartphones/samsung-galaxy-z-fold-4',
    },
    // Nested SEO listing subroutes keep their own (legacy) cacheable header.
    {
      edgeCached: false,
      url: 'https://ogabassey.com/smartphones/best-under/under-500k',
    },
    {
      edgeCached: false,
      url: `https://ogabassey.${ROOT_DOMAIN}/smartphones/compare/iphone-15-vs-samsung-s24`,
    },
  ])('keeps anonymous storefront documents publicly cacheable for $url', async ({
    downstreamCacheControl = 'max-age=3600, stale-while-revalidate=86400, stale-if-error=86400',
    edgeCached,
    url,
  }) => {
    const req = new NextRequest(url);
    req.headers.set('host', new URL(url).host);

    const res = await proxy(req);

    const cacheControl = res.headers.get('Cache-Control') ?? '';
    expect(cacheControl).not.toContain('no-store');
    expect(cacheControl).not.toContain('private');
    if (edgeCached) {
      expect(cacheControl).toBe('public, max-age=0, must-revalidate');
      expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe(
        'max-age=300, stale-while-revalidate=86400'
      );
      expect(res.headers.get('CDN-Cache-Control')).toBe(downstreamCacheControl);
    } else {
      expect(cacheControl).toBe('s-maxage=300, stale-while-revalidate=86400');
    }
  });

  it.each([
    // Per-user / authenticated route groups must NEVER be edge-cached.
    'https://ogabassey.com/account/orders',
    'https://ogabassey.com/my-account/profile',
    'https://ogabassey.com/receipts/abc-123',
    'https://ogabassey.com/order-success/abc-123',
    'https://ogabassey.com/checkout/success',
    'https://ogabassey.com/cart/review',
    // Unknown single-segment storefront routes are not cacheable by default.
    'https://ogabassey.com/steam-deck',
    // Singular legacy redirect-only route must stay no-store.
    'https://ogabassey.com/product/samsung-galaxy-z-fold-4',
    // Param / non-canonical PDP URLs (e.g. invalid variant streams a redirect)
    // must not be cached as a non-canonical shell.
    'https://ogabassey.com/smartphones/samsung-galaxy-z-fold-4?storage=128GB',
    'https://ogabassey.com/smartphones/samsung-galaxy-z-fold-4?variantId=x',
    'https://ogabassey.com/smartphones/best-under/under-500k?utm_source=newsletter',
    'https://ogabassey.com/blog?utm_source=newsletter',
  ])('keeps non-public / non-canonical storefront documents out of the CDN cache for %s', async (url) => {
    const req = new NextRequest(url);
    req.headers.set('host', new URL(url).host);

    const res = await proxy(req);

    expect(res.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0, must-revalidate'
    );
    expect(res.headers.get('Cache-Control')).not.toContain('s-maxage');
    // The Ops-2 split headers must never leak onto non-cacheable documents —
    // a stray CDN-Cache-Control here would edge-cache private content.
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
    expect(res.headers.get('CDN-Cache-Control')).toBeNull();
    expect(res.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it('does not vary anonymous query-string nested listings by Cookie', async () => {
    const url =
      'https://ogabassey.com/smartphones/best-under/under-500k?utm_source=newsletter';
    const req = new NextRequest(url);
    req.headers.set('host', new URL(url).host);

    const res = await proxy(req);

    expect(res.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0, must-revalidate'
    );
    expect(res.headers.get('Vary') || '').not.toContain('Cookie');
  });

  it.each([
    'https://ogabassey.com/smartphones/best-under/under-500k',
    'https://ogabassey.com/smartphones/compare/iphone-15-vs-samsung-s24',
    `https://${ROOT_DOMAIN}/ogabassey/smartphones/best-under/under-500k`,
    `https://${ROOT_DOMAIN}/ogabassey/smartphones/compare/iphone-15-vs-samsung-s24`,
  ])('keeps SEO listing subroutes cacheable for %s', async (url) => {
    const req = new NextRequest(url);
    req.headers.set('host', new URL(url).host);

    const res = await proxy(req);

    expect(res.headers.get('Cache-Control')).toBe(
      's-maxage=300, stale-while-revalidate=86400'
    );
    expect(res.headers.get('Vercel-Cache-Tag')).toBe(
      url.includes(ROOT_DOMAIN) ? 'ps:ogabassey' : 'ph:ogabassey.com'
    );
  });

  it.each([
    `https://${ROOT_DOMAIN}/dashboard/analytics/compare/monthly`,
    `https://${ROOT_DOMAIN}/dashboard/settings/profile`,
    `https://${ROOT_DOMAIN}/api/products/123`,
  ])('does not apply storefront CDN caching to app routes for %s', async (url) => {
    const req = new NextRequest(url);
    req.headers.set('host', new URL(url).host);

    const res = await proxy(req);

    expect(res.headers.get('Cache-Control')).toBe(
      'no-cache, must-revalidate, max-age=0'
    );
    expect(res.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it.each(
    MACHINE_READABLE_TEST_PATHS
  )('passes custom-domain machine-readable path %s to the app route', async (path) => {
    const req = new NextRequest(`https://ogabassey.com${path}`);
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(getSlugForCustomDomain).toHaveBeenCalledWith('ogabassey.com');
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-middleware-request-x-custom-domain')).toBe(
      'ogabassey.com'
    );
    expect(res.headers.get('x-middleware-request-x-merchant-domain')).toBe(
      'ogabassey.com'
    );
  });

  it.each(
    MACHINE_READABLE_TEST_PATHS
  )('passes platform machine-readable path %s to the app route', async (path) => {
    const req = new NextRequest(`https://${ROOT_DOMAIN}${path}`);
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('strips spoofed merchant slug headers from unresolved custom-domain machine-readable requests', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce(null);
    const req = new NextRequest('https://unknown.example/agent-trust.json');
    req.headers.set('host', 'unknown.example');
    req.headers.set('x-merchant-slug', 'target-store');

    const res = await proxy(req);

    expect(getSlugForCustomDomain).toHaveBeenCalledWith('unknown.example');
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-middleware-request-x-merchant-slug')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-custom-domain')).toBe(
      'unknown.example'
    );
    expect(res.headers.get('x-middleware-request-x-merchant-domain')).toBe(
      'unknown.example'
    );
  });

  it.each([
    '/auth.md',
    '/openapi.json',
    '/agent-commerce.json',
    '/agent-trust.json',
    '/.well-known/acp.json',
    '/.well-known/agent-native-commerce',
    '/.well-known/agent-skills/index.json',
    '/.well-known/agent-skills/baci-storefront/SKILL.md',
    '/.well-known/api-catalog',
    '/.well-known/mcp/server-card.json',
    '/.well-known/ucp',
    '/feeds/google-merchant.xml',
    '/feeds/openai.jsonl',
    '/feeds/agent-products.jsonl',
  ])('does not canonicalize custom-domain machine-readable path %s when the merchant slug is feeds', async (path) => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('feeds');
    const req = new NextRequest(`https://shop.example${path}`);
    req.headers.set('host', 'shop.example');

    const res = await proxy(req);

    expect(getSlugForCustomDomain).toHaveBeenCalledWith('shop.example');
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-middleware-request-x-merchant-slug')).toBe(
      'feeds'
    );
  });

  it('strips spoofed custom-domain headers from subdomain machine-readable requests', async () => {
    const req = new NextRequest(
      `https://ogabassey.${ROOT_DOMAIN}/agent-trust.json`
    );
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);
    req.headers.set('x-custom-domain', 'target-store.example');
    req.headers.set('x-merchant-domain', 'target-store.example');

    const res = await proxy(req);

    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-middleware-request-x-merchant-slug')).toBe(
      'ogabassey'
    );
    expect(res.headers.get('x-middleware-request-x-custom-domain')).toBeNull();
    expect(
      res.headers.get('x-middleware-request-x-merchant-domain')
    ).toBeNull();
  });

  it.each([
    '/agent-commerce.json',
    '/agent-trust.json',
    '/.well-known/agent-native-commerce',
    '/.well-known/ucp',
    '/feeds/google-merchant.xml',
    '/feeds/openai.jsonl',
    '/feeds/agent-products.jsonl',
  ])('passes subdomain machine-readable path %s to the app route', async (path) => {
    const req = new NextRequest(`https://ogabassey.${ROOT_DOMAIN}${path}`);
    req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

    const res = await proxy(req);

    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-middleware-request-x-merchant-slug')).toBe(
      'ogabassey'
    );
  });

  it.each([
    ['/index.html.md', '/api/llm/ogabassey'],
    ['/about.md', '/api/llm/ogabassey/about'],
    [
      '/laptops/hp-probook-440-g8.md',
      '/api/llm/ogabassey/laptops/hp-probook-440-g8',
    ],
  ])('rewrites custom-domain markdown mirror %s to %s', async (path, expectedPath) => {
    const req = new NextRequest(`https://ogabassey.com${path}`);
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);
    const rewrite = res.headers.get('x-middleware-rewrite');

    expect(rewrite).not.toBeNull();
    expect(new URL(rewrite as string, 'https://ogabassey.com').pathname).toBe(
      expectedPath
    );
  });

  it('routes localhost subdomain markdown mirrors through the subdomain handler', async () => {
    const req = new NextRequest('http://ogabassey.localhost:3000/about.md');
    req.headers.set('host', 'ogabassey.localhost:3000');

    const res = await proxy(req);
    const rewrite = res.headers.get('x-middleware-rewrite');

    expect(rewrite).not.toBeNull();
    expect(
      new URL(rewrite as string, 'http://ogabassey.localhost:3000').pathname
    ).toBe('/api/llm/ogabassey/about');
  });

  it('redirects custom-domain slug-prefixed products path to slugless canonical URL', async () => {
    const req = new NextRequest('https://ogabassey.com/ogabassey/products');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://ogabassey.com/products');
  });

  it('redirects custom-domain slug-prefixed repair path to slugless canonical URL', async () => {
    const req = new NextRequest('https://ogabassey.com/ogabassey/repair');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://ogabassey.com/repair');
  });

  it('keeps slug-prefixed sitemap paths out of product-route canonicalization', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/sitemap/products.xml'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/sitemap/products.xml'
    );
    expect(res.headers.get('location')).not.toBe(
      'https://ogabassey.com/products/products.xml'
    );
  });

  it('redirects slug-prefixed legacy category product URLs to /products/{slug}', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/dell/dell-alienware-m16-r3-rtx-5070-ti'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/products/dell-alienware-m16-r3-rtx-5070-ti'
    );
  });

  it('preserves slug-prefixed category support routes when stripping the merchant prefix', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/smartphones/best-under/under-500k'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/smartphones/best-under/under-500k'
    );
  });

  it('redirects mixed-case custom-domain slug-prefixed product URLs to the slugless canonical route', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('OgaBassey');
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/dell/dell-alienware-m16-r3-rtx-5070-ti'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/products/dell-alienware-m16-r3-rtx-5070-ti'
    );
  });

  it('does not strip a retired-slug prefix that collides with a live storefront route on a custom domain', async () => {
    // "blog" is a real storefront route AND, hypothetically, a retired alias for
    // this domain's merchant. The live /blog route must win — never strip to /my-post.
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('zorvexa');
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest('https://ogabassey.com/blog/my-post');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.headers.get('location')).not.toBe(
      'https://ogabassey.com/my-post'
    );
    // The route-collision guard short-circuits BEFORE any alias lookup.
    expect(getCurrentSlugForAlias).not.toHaveBeenCalledWith('blog');
  });

  it('strips a genuine retired-slug prefix (non-route) to the slugless custom-domain URL', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('zorvexa');
    vi.mocked(getCurrentSlugForAlias).mockImplementation(async (s: string) =>
      s === 'yodhashop' ? 'zorvexa' : null
    );
    const req = new NextRequest('https://ogabassey.com/yodhashop/summer-sale');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    // 302 (temporary) so a reversible rename-back can't loop a browser-cached 301.
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/summer-sale'
    );
  });

  it('strips a GRANDFATHERED reserved-name retired-slug prefix on a custom domain', async () => {
    // A merchant that held 'support' as a slug before it was reserved could have
    // retired it — custom.example/support/... must still strip to the slugless URL.
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('zorvexa');
    vi.mocked(getCurrentSlugForAlias).mockImplementation(async (s: string) =>
      s === 'support' ? 'zorvexa' : null
    );
    const req = new NextRequest('https://ogabassey.com/support/summer-sale');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/summer-sale'
    );
  });

  it('does not strip a retired-slug prefix that is a platform app route (auth) on a custom domain', async () => {
    // A merchant whose retired slug was literally "auth": the live /auth/confirm
    // magic-link route must win, never 301-strip to /confirm.
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('zorvexa');
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest('https://ogabassey.com/auth/confirm?token=x');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.headers.get('location')).not.toBe(
      'https://ogabassey.com/confirm?token=x'
    );
    // The app-route guard short-circuits before any alias lookup.
    expect(getCurrentSlugForAlias).not.toHaveBeenCalledWith('auth');
  });

  it('does not strip a retired-slug prefix that is a feeds app route on a custom domain', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('zorvexa');
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest('https://ogabassey.com/feeds/openai.jsonl');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.headers.get('location')).not.toBe(
      'https://ogabassey.com/openai.jsonl'
    );
    expect(getCurrentSlugForAlias).not.toHaveBeenCalledWith('feeds');
  });

  it('internally rewrites a retired-alias-prefixed custom-domain API request (any method) to /api', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('zorvexa');
    vi.mocked(getCurrentSlugForAlias).mockImplementation(async (s: string) =>
      s === 'yodhashop' ? 'zorvexa' : null
    );
    const req = new NextRequest(
      'https://ogabassey.com/yodhashop/api/storefront/customer',
      { method: 'POST' }
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    // A 301 would drop the POST body; must be an internal rewrite to the
    // slugless /api path so the body + method survive.
    expect(res.status).not.toBe(301);
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://ogabassey.com/api/storefront/customer'
    );
  });

  it('rewrites a GRANDFATHERED reserved-name alias-prefixed custom-domain API request to /api', async () => {
    // A merchant that held 'support' before it was reserved could have retired it —
    // custom.example/support/api/... must still rewrite (checkout/auth calls from the
    // old prefixed URL keep working). The merchant-scoped alias check gates it.
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('zorvexa');
    vi.mocked(getCurrentSlugForAlias).mockImplementation(async (s: string) =>
      s === 'support' ? 'zorvexa' : null
    );
    const req = new NextRequest(
      'https://ogabassey.com/support/api/storefront/customer',
      { method: 'POST' }
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).not.toBe(301);
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://ogabassey.com/api/storefront/customer'
    );
  });

  it('does not rewrite an alias-prefixed API path when the alias belongs to a different merchant', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('zorvexa');
    vi.mocked(getCurrentSlugForAlias).mockImplementation(async (s: string) =>
      s === 'otherslug' ? 'someone-else' : null
    );
    const req = new NextRequest(
      'https://ogabassey.com/otherslug/api/storefront/customer',
      { method: 'POST' }
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.headers.get('x-middleware-rewrite')).not.toBe(
      'https://ogabassey.com/api/storefront/customer'
    );
  });

  it('rewrites (not 301s) a retired-alias-prefixed custom-domain API GET, updating stale slug query params', async () => {
    // A GET /oldSlug/api/... must NOT 301 (which would preserve ?merchant_slug=old);
    // it internally rewrites to the slugless /api path with the query param updated.
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('zorvexa');
    vi.mocked(getCurrentSlugForAlias).mockImplementation(async (s: string) =>
      s === 'yodhashop' ? 'zorvexa' : null
    );
    const req = new NextRequest(
      'https://ogabassey.com/yodhashop/api/storefront/orders/track-order?merchant_slug=yodhashop&order=9',
      { method: 'GET' }
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).not.toBe(301);
    const rewrite = res.headers.get('x-middleware-rewrite');
    expect(rewrite).not.toBeNull();
    expect(rewrite).toContain('/api/storefront/orders/track-order');
    expect(rewrite).toContain('merchant_slug=zorvexa');
    expect(rewrite).not.toContain('merchant_slug=yodhashop');
    expect(rewrite).toContain('order=9');
  });

  it('same-origin-rewrites (not 301s) a GET API call on a retired subdomain, correcting stale slug query params', async () => {
    // A cross-origin 301 would drop the customer's same-origin auth cookies, so
    // GET stays SAME-ORIGIN (like non-GET): internal rewrite with ?merchant_slug
    // corrected. Host-verified routes resolve via the alias table, not a redirect.
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest(
      'https://yodhashop.usebaci.com/api/feed/openai?merchant_slug=yodhashop&x=1',
      { method: 'GET' }
    );
    req.headers.set('host', 'yodhashop.usebaci.com');

    const res = await proxy(req);

    expect(res.status).not.toBe(301);
    const rewrite = res.headers.get('x-middleware-rewrite');
    expect(rewrite).not.toBeNull();
    expect(rewrite).toContain('merchant_slug=zorvexa');
    expect(rewrite).not.toContain('merchant_slug=yodhashop');
    expect(rewrite).toContain('x=1');
  });

  it('same-origin-rewrites a live subdomain API call that still carries a retired merchant slug query value', async () => {
    // Checkout resume/BNPL URLs can preserve ?merchant_slug=<old> across the
    // retired-subdomain redirect. Once the browser is on the live subdomain, the
    // host itself is no longer an alias, so query values must be checked too.
    vi.mocked(getCurrentSlugForAlias).mockImplementation(
      async (slug: string) => (slug === 'yodhashop' ? 'zorvexa' : null)
    );
    const req = new NextRequest(
      'https://zorvexa.usebaci.com/api/storefront/orders/resume?merchant_slug=yodhashop&order=123',
      { method: 'GET' }
    );
    req.headers.set('host', 'zorvexa.usebaci.com');

    const res = await proxy(req);

    expect(res.status).not.toBe(301);
    const rewrite = res.headers.get('x-middleware-rewrite');
    expect(rewrite).not.toBeNull();
    expect(rewrite).toContain('merchant_slug=zorvexa');
    expect(rewrite).not.toContain('merchant_slug=yodhashop');
    expect(rewrite).toContain('order=123');
    expect(getCurrentSlugForAlias).toHaveBeenCalledWith('yodhashop');
  });

  it('same-origin-rewrites a non-idempotent API call on a retired subdomain, correcting stale slug query params', async () => {
    // POST body must survive -> internal rewrite (not a 301) with the slug query
    // params corrected to the current slug.
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest(
      'https://yodhashop.usebaci.com/api/storefront/orders?merchant_slug=yodhashop&order=123',
      { method: 'POST' }
    );
    req.headers.set('host', 'yodhashop.usebaci.com');

    const res = await proxy(req);

    expect(res.status).not.toBe(301);
    const rewrite = res.headers.get('x-middleware-rewrite');
    expect(rewrite).not.toBeNull();
    expect(rewrite).toContain('merchant_slug=zorvexa');
    expect(rewrite).not.toContain('merchant_slug=yodhashop');
    expect(rewrite).toContain('order=123');
  });

  it('does NOT rewrite a bare `slug` query param on a retired subdomain (product slugs collide)', async () => {
    // Only unambiguous MERCHANT params are corrected. The generic `slug` key also
    // carries product/resource slugs (e.g. the product membership/canonical
    // preflight), so a live product whose slug equals a retired storefront slug
    // must reach the handler unchanged, not be rewritten to the merchant slug.
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest(
      'https://yodhashop.usebaci.com/api/storefront/product?slug=yodhashop&x=1',
      { method: 'GET' }
    );
    req.headers.set('host', 'yodhashop.usebaci.com');

    const res = await proxy(req);

    const rewrite = res.headers.get('x-middleware-rewrite');
    // If the request is rewritten at all, the `slug` value must be left intact.
    if (rewrite) {
      expect(rewrite).toContain('slug=yodhashop');
      expect(rewrite).not.toContain('slug=zorvexa');
    }
  });

  it('still 302-redirects a RESERVED-infra subdomain that is a GRANDFATHERED retired alias', async () => {
    // A merchant that held 'support' before it was reserved could have retired it via
    // a rename — support.usebaci.com must still 302 to the current store, not fall
    // through to infra handling (the alias table keeps such slugs resolvable).
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest('https://support.usebaci.com/products/x');
    req.headers.set('host', 'support.usebaci.com');

    const res = await proxy(req);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('zorvexa');
  });

  it('redirects main app paths on a RESERVED-name retired-alias subdomain to the root domain', async () => {
    // Reserved aliases skip the normal non-reserved subdomain branch. Main app
    // paths must still follow the platform redirect path, not fall through on
    // support.usebaci.com.
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest('https://support.usebaci.com/login');
    req.headers.set('host', 'support.usebaci.com');

    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`https://${ROOT_DOMAIN}/login`);
  });

  it('same-origin-rewrites an /api call on a RESERVED-name retired-alias subdomain', async () => {
    // support.usebaci.com/api/... for a grandfathered retired alias: a 301 would drop
    // the stale XHR's cookies/body and keep the retired slug, so it gets the same
    // alias-aware same-origin /api handling as a non-reserved retired subdomain.
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest(
      'https://support.usebaci.com/api/storefront/orders?merchant_slug=support&x=1',
      { method: 'POST' }
    );
    req.headers.set('host', 'support.usebaci.com');

    const res = await proxy(req);

    expect(res.status).not.toBe(301);
    const rewrite = res.headers.get('x-middleware-rewrite');
    expect(rewrite).not.toBeNull();
    expect(rewrite).toContain('merchant_slug=zorvexa');
    expect(rewrite).not.toContain('merchant_slug=support');
  });

  it('302-redirects a RESERVED-name retired alias on the ROOT-DOMAIN path (usebaci.com/support/...)', async () => {
    // The also-supported root-slug URL for a grandfathered reserved alias must forward
    // too — the main root-path block skips reserved segments, so this is handled by the
    // dedicated reserved-alias check before it.
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest(`https://${ROOT_DOMAIN}/support/products`);
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('zorvexa');
  });

  it('does NOT 301 an /api call on a subdomain that has a custom domain (same-origin instead)', async () => {
    // A cross-origin 301 on an XHR/POST drops cookies + body. Even when the
    // subdomain has a custom domain (stale cache can still map a retired slug to
    // one), /api must fall through to the same-origin API handler, not be
    // canonical-redirected to the custom domain.
    vi.mocked(getCustomDomainForSlug).mockResolvedValueOnce('ogabassey.com');
    const req = new NextRequest(
      'https://ogabassey.usebaci.com/api/storefront/orders?merchant_slug=ogabassey',
      { method: 'POST' }
    );
    req.headers.set('host', 'ogabassey.usebaci.com');

    const res = await proxy(req);

    expect(res.status).not.toBe(301);
    expect(res.headers.get('location')).not.toBe(
      'https://ogabassey.com/api/storefront/orders?merchant_slug=ogabassey'
    );
  });

  it('does NOT 301 a non-GET POST to a page route on a subdomain with a custom domain', async () => {
    // A storefront server action / form POST to a page route must not be canonical-
    // redirected to the custom domain — a cross-origin 301 turns the POST into a GET
    // and drops its body. Canonicalization is a GET/HEAD (SEO) concern only.
    vi.mocked(getCustomDomainForSlug).mockResolvedValueOnce('ogabassey.com');
    const req = new NextRequest('https://ogabassey.usebaci.com/cart/checkout', {
      method: 'POST',
    });
    req.headers.set('host', 'ogabassey.usebaci.com');

    const res = await proxy(req);

    expect(res.status).not.toBe(301);
    expect(res.headers.get('location')).not.toBe(
      'https://ogabassey.com/cart/checkout'
    );
  });

  it('DOES 301 a GET to the canonical custom domain on a subdomain (unchanged)', async () => {
    vi.mocked(getCustomDomainForSlug).mockResolvedValueOnce('ogabassey.com');
    const req = new NextRequest('https://ogabassey.usebaci.com/products', {
      method: 'GET',
    });
    req.headers.set('host', 'ogabassey.usebaci.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://ogabassey.com/products');
  });

  it('same-origin-rewrites a root-path /reservedAlias/api call on a retired alias', async () => {
    // Root-path reserved aliases are excluded from the non-reserved root-path
    // branch, so they need the same API stripping path as ordinary aliases.
    vi.mocked(getCurrentSlugForAlias).mockImplementation(
      async (slug: string) => (slug === 'support' ? 'zorvexa' : null)
    );
    const req = new NextRequest(
      `https://${ROOT_DOMAIN}/support/api/vtu/history?merchantSlug=support`,
      { method: 'GET' }
    );
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(res.status).not.toBe(301);
    expect(res.status).not.toBe(302);
    const rewrite = res.headers.get('x-middleware-rewrite');
    expect(rewrite).not.toBeNull();
    expect(rewrite).toContain('/api/vtu/history');
    expect(rewrite).not.toContain('/support/api');
    expect(rewrite).toContain('merchantSlug=zorvexa');
    expect(rewrite).not.toContain('merchantSlug=support');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('same-origin-rewrites a root-path /oldSlug/api call on a retired alias (no cross-origin 302)', async () => {
    // usebaci.com/<oldSlug>/api/... in path mode after a rename: a 302 to the
    // current subdomain would drop the caller's Bearer/cookies/body, so strip the
    // prefix and rewrite SAME-ORIGIN to /api/... with the merchant-slug query
    // corrected to the current slug.
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest(
      `https://${ROOT_DOMAIN}/yodhashop/api/vtu/history?merchantSlug=yodhashop`,
      { method: 'GET' }
    );
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(res.status).not.toBe(301);
    expect(res.status).not.toBe(302);
    const rewrite = res.headers.get('x-middleware-rewrite');
    expect(rewrite).not.toBeNull();
    expect(rewrite).toContain('/api/vtu/history');
    expect(rewrite).not.toContain('/yodhashop/api');
    expect(rewrite).toContain('merchantSlug=zorvexa');
    expect(rewrite).not.toContain('merchantSlug=yodhashop');
    // Proxy security headers must be applied (matching the other API branches).
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('runs a CONFIRMED retired-alias-prefixed /oldSlug/api call through the API security guard', async () => {
    // The /<oldSlug>/api/... rewrite must NOT let a request skip the rate-limit /
    // CSRF / body-size guard (which keys off the pathname). A bad Content-Type on a
    // POST proves the guard evaluated the EFFECTIVE /api path: 415, not a fall-through.
    // Guard only applies when the prefix is a CONFIRMED retired alias.
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest(
      `https://${ROOT_DOMAIN}/yodhashop/api/storefront/customer`,
      { method: 'POST', headers: { 'content-type': 'text/plain' } }
    );
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(res.status).toBe(415);
  });

  it('runs a RESERVED-name alias-prefixed /support/api call through the API security guard', async () => {
    // The custom-domain/root rewrites resolve grandfathered reserved-name aliases
    // (`support`, `cdn`), so the pre-rewrite guard must cover them too — otherwise
    // POST /support/api/... would bypass rate-limit/CSRF/content-type. 415 proves it.
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest(
      `https://${ROOT_DOMAIN}/support/api/storefront/customer`,
      { method: 'POST', headers: { 'content-type': 'text/plain' } }
    );
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(res.status).toBe(415);
  });

  it('does NOT force a storefront /<segment>/api page through the API guard when the segment is not a retired alias', async () => {
    // getCurrentSlugForAlias resolves nothing -> not a retired alias -> the request
    // is a normal storefront page, not an API call, and must NOT be rate-limited /
    // CSRF / content-type checked (would 429/415 crawler-hit storefront URLs).
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue(null);
    const req = new NextRequest(`https://${ROOT_DOMAIN}/shoes/api?x=1`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
    });
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    // Not treated as an API mutation — no 415/413/429 from the API guard.
    expect(res.status).not.toBe(415);
    expect(res.status).not.toBe(413);
    expect(res.status).not.toBe(429);
  });

  it('rate-limits an alias-SHAPED /<segment>/api request BEFORE the alias DB lookup', async () => {
    // The rate limiter must run on the SHAPE before the (DB-hitting) alias
    // confirmation, so rotating the first path segment can't force un-rate-limited
    // getCurrentSlugForAlias lookups. When rate-limited, the alias lookup never runs.
    const { checkRateLimit } = await import('@/lib/rate-limit');
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      limit: 100,
      remaining: 0,
      resetTime: Date.now() + 60000,
    });
    const req = new NextRequest(`https://${ROOT_DOMAIN}/randomprobe/api/x`, {
      method: 'GET',
    });
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(res.status).toBe(429);
    expect(getCurrentSlugForAlias).not.toHaveBeenCalledWith('randomprobe');
  });

  it('does NOT force a MERCHANT SUBDOMAIN /<segment>/api storefront page through the API guard', async () => {
    // On a merchant subdomain, /<segment>/api is always a storefront page (there is
    // no prefixed-alias rewrite), so it must never be treated as an API call — even
    // if the segment happens to be some merchant's retired alias.
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest('https://shop.usebaci.com/shoes/api', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
    });
    req.headers.set('host', 'shop.usebaci.com');

    const res = await proxy(req);

    expect(res.status).not.toBe(415);
  });

  it('does not hijack a MAIN_APP_ROUTE on a retired subdomain with the storefront redirect', async () => {
    // old.usebaci.com/login (an app/auth route) must NOT be 302'd to the merchant
    // storefront/current-slug subdomain (which would 404), preserving old admin/auth
    // bookmarks after a rename. App routes bypass the retired-slug storefront redirect.
    // Without the fix, this would 302 to zorvexa.usebaci.com/login.
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest('https://old.usebaci.com/login');
    req.headers.set('host', 'old.usebaci.com');

    const res = await proxy(req);

    // The retired-slug redirect must NOT have hijacked this app route to the store.
    expect(res.headers.get('location') ?? '').not.toContain('zorvexa');
  });

  it('does not hijack a platform AUTH route (/signup) on a retired subdomain', async () => {
    // /signup, /forgot-password, etc. are platform auth pages (not in MAIN_APP_ROUTES
    // before, so they slipped into the retired-slug redirect). old.usebaci.com/signup
    // must go to the platform, NOT the current store's /signup (404).
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest('https://old.usebaci.com/signup');
    req.headers.set('host', 'old.usebaci.com');

    const res = await proxy(req);

    expect(res.headers.get('location')).toBe(`https://${ROOT_DOMAIN}/signup`);
    expect(res.headers.get('location')).not.toContain('zorvexa');
  });

  it('treats /staff-picks on a subdomain as a storefront path, not the /staff platform route', async () => {
    // Boundary-aware MAIN_APP_ROUTES: `/staff` matches `/staff` + `/staff/...` but a
    // storefront category `/staff-picks` must NOT be redirected to usebaci.com/staff-picks.
    const req = new NextRequest('https://shop.usebaci.com/staff-picks');
    req.headers.set('host', 'shop.usebaci.com');

    const res = await proxy(req);

    // Not redirected off the subdomain to the platform.
    expect(res.headers.get('location')).not.toBe(
      `https://${ROOT_DOMAIN}/staff-picks`
    );
    // Served as a storefront path (rewritten to /<slug>/staff-picks).
    const rewrite = res.headers.get('x-middleware-rewrite');
    if (rewrite) {
      expect(rewrite).toContain('/shop/staff-picks');
    }
  });

  it('does not alias-redirect the platform /signup auth route on the root domain', async () => {
    // 'signup' is a platform auth page, not a storefront alias. Even if it resolved
    // as a retired alias, the platform-segment guard must skip the alias lookup so
    // the auth page is served — never 302'd to a merchant storefront.
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');
    const req = new NextRequest(`https://${ROOT_DOMAIN}/signup`);
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);

    expect(res.status).not.toBe(302);
    expect(getCurrentSlugForAlias).not.toHaveBeenCalledWith('signup');
  });

  it('rewrites a stale slug query param on a slugless custom-domain API call after a rename', async () => {
    // Open custom-domain tab calls root-relative /api?merchant=old (no prefix)
    // after a rename; the param must be corrected to the current slug so query-
    // based handlers resolve the store.
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('zorvexa');
    vi.mocked(getCurrentSlugForAlias).mockImplementation(async (s: string) =>
      s === 'yodhashop' ? 'zorvexa' : null
    );
    const req = new NextRequest(
      'https://ogabassey.com/api/storefront/customer/wallet?merchant=yodhashop&x=1',
      { method: 'GET' }
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    const rewrite = res.headers.get('x-middleware-rewrite');
    expect(rewrite).not.toBeNull();
    expect(rewrite).toContain('merchant=zorvexa');
    expect(rewrite).not.toContain('merchant=yodhashop');
    expect(rewrite).toContain('x=1');
  });

  it.each([
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
  ])('internally rewrites slug-prefixed custom-domain API requests on non-idempotent method %s', async (method) => {
    // Arrange: a slug-prefixed API URL on a custom domain, using a method
    // whose body must not be dropped by a GET-replay after a 301.
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/api/checkout/create-order',
      { method }
    );
    req.headers.set('host', 'ogabassey.com');

    // Act
    const res = await proxy(req);

    // Assert: the canonicalizing redirect branch must be skipped so the
    // request reaches the API with its body intact. Instead of a 301, the
    // proxy must emit an internal rewrite pointing at the stripped API
    // path (`/api/checkout/create-order`) on the custom domain.
    expect(res.status).not.toBe(301);
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://ogabassey.com/api/checkout/create-order'
    );
  });

  it('returns 410 for legacy WordPress admin probes under /blog', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/blog/wp-admin/post.php?post=7446&action=edit'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(410);
  });

  it.each([
    '/blog/wp-admin',
    '/blog/wp-login.php',
    '/blog/xmlrpc.php',
  ])('returns 410 for exact WordPress probe path %s', async (path) => {
    const req = new NextRequest(`https://ogabassey.com${path}`);
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(410);
  });

  it.each([
    '/blog/wp-admin-guide',
    '/blog/wp-login-security-tips',
    '/blog/xmlrpc-explained',
  ])('does not block legitimate post slugs that share WP probe prefixes: %s', async (path) => {
    const req = new NextRequest(`https://ogabassey.com${path}`);
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    // Legitimate post slugs must never be punted to the 410 WP-probe trap,
    // and must not short-circuit with any other client/server error either
    // — they should flow through the proxy to the storefront handler.
    expect(res.status).not.toBe(410);
    expect(res.status).toBeLessThan(400);
  });

  it.each([
    '/someshop/blog/wp-admin',
    '/someshop/blog/wp-admin/post.php?post=7446&action=edit',
    '/someshop/blog/wp-login.php',
    '/someshop/blog/xmlrpc.php',
  ])('returns 410 for merchant-scoped WordPress probe path %s', async (path) => {
    const req = new NextRequest(`https://ogabassey.com${path}`);
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(410);
  });

  it.each([
    '/someshop/blog/wp-admin-guide',
    '/someshop/blog/wp-login-tips',
  ])('does not block legitimate merchant-scoped post slugs sharing WP probe prefixes: %s', async (path) => {
    const req = new NextRequest(`https://ogabassey.com${path}`);
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    // Same as the platform-scope case: legitimate merchant-scoped slugs
    // must pass through without any 4xx/5xx short-circuit from the proxy.
    expect(res.status).not.toBe(410);
    expect(res.status).toBeLessThan(400);
  });

  it('redirects legacy /blog/{category}/{slug} URLs to canonical /blog/{slug}', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/blog/gadgets/how-to-maintain-your-iphone-battery-health-at-85-and-beyond'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/blog/how-to-maintain-your-iphone-battery-health-at-85-and-beyond'
    );
  });

  it.each([
    'opengraph-image',
    'opengraph-image.png',
    'twitter-image',
    'twitter-image.jpg',
  ])('does not flatten blog post %s metadata routes as legacy category URLs', async (metadataRoute) => {
    const req = new NextRequest(
      `https://ogabassey.com/blog/airpods-max/${metadataRoute}`
    );
    req.headers.set('host', 'ogabassey.com');
    req.headers.set('accept', 'image/avif,image/webp,image/*,*/*;q=0.8');
    req.headers.set('sec-fetch-dest', 'image');

    const res = await proxy(req);

    expect(res.status).not.toBe(301);
    expect(res.headers.get('location')).toBeNull();
    expect(getSlugForCustomDomain).toHaveBeenCalledWith('ogabassey.com');
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      `https://ogabassey.com/ogabassey.com/blog/airpods-max/${metadataRoute}`
    );
  });

  it.each([
    'opengraph-image',
    'twitter-image',
  ])('does not flatten one-word post slug metadata routes: %s', async (metadataRoute) => {
    const req = new NextRequest(
      `https://ogabassey.com/blog/long/${metadataRoute}`
    );
    req.headers.set('host', 'ogabassey.com');
    req.headers.set('accept', 'image/avif,image/webp,image/*,*/*;q=0.8');
    req.headers.set('sec-fetch-dest', 'image');

    const res = await proxy(req);

    expect(res.status).not.toBe(301);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      `https://ogabassey.com/ogabassey.com/blog/long/${metadataRoute}`
    );
  });

  it.each([
    'opengraph-image',
    'twitter-image',
  ])('redirects legacy category paths to canonical post URLs for HTML navigation when slug is %s', async (postSlug) => {
    const req = new NextRequest(
      `https://ogabassey.com/blog/gadgets/${postSlug}`
    );
    req.headers.set('host', 'ogabassey.com');
    req.headers.set(
      'accept',
      'text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8'
    );
    req.headers.set('sec-fetch-dest', 'document');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      `https://ogabassey.com/blog/${postSlug}`
    );
  });

  it.each([
    '/blog/page/2',
    '/blog/tag/iphone',
    '/blog/author/jane',
  ])('does not flatten reserved blog archive routes: %s', async (inputPath) => {
    const req = new NextRequest(`https://ogabassey.com${inputPath}`);
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    // Reserved archive paths must not trigger any 301, including a
    // wasteful self-redirect to the same path. Locking this to "no 301"
    // is the strongest expression of the invariant.
    expect(res.status).not.toBe(301);
  });

  it.each([
    ['_thumbnail_id=1819&ref=mail'],
    ['thumbnail_id=1819&ref=mail'],
    ['_thumbnail_id=1819&thumbnail_id=1820&ref=mail'],
  ])('drops thumbnail query noise on blog post URLs: %s', async (queryString) => {
    const req = new NextRequest(
      `https://ogabassey.com/blog/iphone/the-iphone-15-what-we-know-so-far?${queryString}`
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);
    const location = res.headers.get('location');

    // A single 301 must collapse the legacy category prefix AND drop the
    // thumbnail noise together — chaining two 301s wastes a round-trip and
    // counts against crawler redirect-chain budgets.
    expect(res.status).toBe(301);
    expect(location).toBeTruthy();
    expect(new URL(location ?? '').pathname).toBe(
      '/blog/the-iphone-15-what-we-know-so-far'
    );
    expect(location).toContain('ref=mail');
    expect(location).not.toContain('_thumbnail_id');
    expect(location).not.toContain('thumbnail_id=');
  });

  it('redirects custom-domain slug-prefixed repair path to slugless canonical URL', async () => {
    const req = new NextRequest('https://ogabassey.com/ogabassey/repair');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://ogabassey.com/repair');
  });

  it('redirects slug-prefixed legacy category product URLs to /products/{slug}', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/dell/dell-alienware-m16-r3-rtx-5070-ti'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/products/dell-alienware-m16-r3-rtx-5070-ti'
    );
  });

  it('preserves merchant category compare subroutes on custom domains', async () => {
    // /{merchantSlug}/{category}/compare/{comparisonSlug} must NOT collapse to
    // /products/{comparisonSlug}; the category subroute is a real page at
    // apps/web/src/app/(storefront)/[slug]/(catalog)/[category]/compare/[comparisonSlug].
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/smartphones/compare/iphone-15-vs-samsung-s24'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/smartphones/compare/iphone-15-vs-samsung-s24'
    );
  });

  it('preserves merchant category best-under subroutes on custom domains', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/laptops/best-under/500000'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/laptops/best-under/500000'
    );
  });

  it('preserves slug-prefixed legacy /category/{slug} paths on custom domains', async () => {
    // `/category/{slug}` is a legacy category root (see
    // storefront-link-normalization.ts). It must NOT collapse to
    // `/products/{slug}`, which would 301 merchants to a non-existent PDP.
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/category/smartphones'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/category/smartphones'
    );
  });

  it('preserves slug-prefixed legacy /product-category/{slug} paths on custom domains', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/product-category/laptops'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/product-category/laptops'
    );
  });

  it('returns 410 for legacy WordPress admin probes under /blog', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/blog/wp-admin/post.php?post=7446&action=edit'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(410);
  });

  it('redirects legacy /blog/{category}/{slug} URLs to canonical /blog/{slug}', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/blog/gadgets/how-to-maintain-your-iphone-battery-health-at-85-and-beyond'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/blog/how-to-maintain-your-iphone-battery-health-at-85-and-beyond'
    );
  });

  it('drops thumbnail_id query noise on blog URLs', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/blog/iphone/the-iphone-15-what-we-know-so-far?thumbnail_id=1819'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/blog/the-iphone-15-what-we-know-so-far'
    );
  });

  it('drops _thumbnail_id query noise on blog URLs', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/blog/iphone/the-iphone-15-what-we-know-so-far?_thumbnail_id=1819'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/blog/the-iphone-15-what-we-know-so-far'
    );
  });

  it('does not redirect unrecognized-domain products paths', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce(null);
    const req = new NextRequest('https://ogabassey.com/products');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);
    const rewriteUrl = new URL(
      res.headers.get('x-middleware-rewrite') as string
    );

    expect(res.status).not.toBe(301);
    expect(rewriteUrl.pathname).toBe('/ogabassey.com/products');
    expect(
      rewriteUrl.searchParams.get(STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM)
    ).toBe('streaming');
    expect(res.headers.get('x-middleware-rewrite')).toBe(rewriteUrl.toString());
  });

  it('does not 410 legitimate blog slugs that merely start with a wp-admin token', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/blog/wp-admin-guide-for-developers'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).not.toBe(410);
  });

  it('does not 410 legitimate blog slugs that merely start with a spam token', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/blog/shopdetail-roundup-2026'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).not.toBe(410);
  });

  it.each([
    ['/api/blog/posts', 'thumbnail_id=123'],
    ['/dashboard/blog', 'thumbnail_id=foo'],
    ['/admin/blog/analytics', '_thumbnail_id=bar'],
  ])('does NOT strip thumbnail params on reserved top-level paths with /blog children: %s?%s', async (inputPath, queryString) => {
    const req = new NextRequest(
      `https://${ROOT_DOMAIN}${inputPath}?${queryString}`
    );
    req.headers.set('host', ROOT_DOMAIN);

    const res = await proxy(req);
    const location = res.headers.get('location');

    expect(res.status).not.toBe(301);
    if (location) {
      const thumbnailKey = queryString.split('=')[0];
      expect(location).toContain(thumbnailKey);
    }
  });

  describe('URL normalization: prefix-only case fixing', () => {
    it('lowercases /API prefix but preserves case-sensitive tail', async () => {
      const req = new NextRequest(
        `https://${ROOT_DOMAIN}/API/paystack/virtual-terminal/ABC123`
      );
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(308);
      expect(location).toBeTruthy();
      expect(new URL(location || '').pathname).toBe(
        '/api/paystack/virtual-terminal/ABC123'
      );
    });

    it('lowercases /TRACK prefix but preserves tracking number case', async () => {
      const req = new NextRequest(`https://${ROOT_DOMAIN}/TRACK/AbC123xYz`);
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(308);
      expect(location).toBeTruthy();
      expect(new URL(location || '').pathname).toBe('/track/AbC123xYz');
    });

    it('lowercases /_NEXT prefix but preserves build ID case', async () => {
      const req = new NextRequest(
        `https://${ROOT_DOMAIN}/_NEXT/data/BuildId/page.json`
      );
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(308);
      expect(location).toBeTruthy();
      expect(new URL(location || '').pathname).toBe(
        '/_next/data/BuildId/page.json'
      );
    });

    it('lowercases /FAVICON.ICO prefix but preserves case', async () => {
      const req = new NextRequest(`https://${ROOT_DOMAIN}/FAVICON.ICO`);
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(308);
      expect(location).toBeTruthy();
      expect(new URL(location || '').pathname).toBe('/favicon.ico');
    });

    it('does not redirect already-lowercase prefix paths', async () => {
      const req = new NextRequest(`https://${ROOT_DOMAIN}/api/products`);
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);

      // Should not be a redirect — passes through to normal handling
      expect(res.status).not.toBe(308);
    });
  });

  describe('URL normalization: storefront full-path lowercase', () => {
    it('redirects uppercase storefront path to lowercase', async () => {
      const req = new NextRequest(`https://ogabassey.${ROOT_DOMAIN}/Phones`);
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(308);
      expect(location).toBeTruthy();
      expect(new URL(location || '').pathname).toBe('/phones');
    });

    it('redirects uppercase /CHECKOUT/SUCCESS to lowercase', async () => {
      const req = new NextRequest(
        `https://ogabassey.${ROOT_DOMAIN}/CHECKOUT/SUCCESS`
      );
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(308);
      expect(location).toBeTruthy();
      expect(new URL(location || '').pathname).toBe('/checkout/success');
    });

    it('does not redirect already-lowercase storefront paths', async () => {
      const req = new NextRequest(`https://ogabassey.${ROOT_DOMAIN}/products`);
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);

      expect(res.status).not.toBe(308);
    });

    it('does not redirect /.well-known paths', async () => {
      const req = new NextRequest(
        `https://${ROOT_DOMAIN}/.well-known/assetlinks.json`
      );
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);

      // .well-known passthrough returns 200 (NextResponse.next())
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('does not redirect /llms.txt', async () => {
      const req = new NextRequest(`https://${ROOT_DOMAIN}/llms.txt`);
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('does not redirect static .avif files', async () => {
      const req = new NextRequest(`https://${ROOT_DOMAIN}/images/Hero.avif`);
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);

      // Static files should not trigger a lowercase redirect
      expect(res.status).not.toBe(308);
    });

    it('redirects trailing slash static asset variants to canonical asset URLs', async () => {
      const req = new NextRequest(`https://${ROOT_DOMAIN}/favicon.ico/`);
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(308);
      expect(location).toBeTruthy();
      expect(new URL(location || '').pathname).toBe('/favicon.ico');
    });

    it('does not redirect trailing slash /.well-known paths', async () => {
      const req = new NextRequest(
        `https://${ROOT_DOMAIN}/.well-known/assetlinks.json/`
      );
      req.headers.set('host', ROOT_DOMAIN);

      const res = await proxy(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('does not redirect when only percent-encoded octets differ in case', async () => {
      const req = new NextRequest(
        `https://ogabassey.${ROOT_DOMAIN}/laptop/hp-omnibook-x-copilot%2B-pc`
      );
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);

      expect(res.status).not.toBe(308);
      expect(res.headers.get('location')).toBeNull();
    });

    it('does not redirect lowercase percent-encoded non-Latin slugs without unsafe punctuation', async () => {
      const req = new NextRequest(
        `https://ogabassey.${ROOT_DOMAIN}/search/%d1%82%d0%b5%d0%bb%d0%b5%d1%84%d0%be%d0%bd-case`
      );
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);

      expect(res.status).not.toBe(308);
      expect(res.headers.get('location')).toBeNull();
    });

    it('does not collapse ordinary double hyphens without unsafe punctuation', async () => {
      const req = new NextRequest(
        `https://ogabassey.${ROOT_DOMAIN}/accessories/iphone--case`
      );
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);

      expect(res.status).not.toBe(308);
      expect(res.headers.get('location')).toBeNull();
    });

    it('redirects smart-quote storefront slugs before remote cache handling', async () => {
      const req = new NextRequest(
        `https://ogabassey.${ROOT_DOMAIN}/smartphones/15%E2%80%9D-macbook-air-2023-16gb-512gb-m3`
      );
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(308);
      expect(location).toBeTruthy();
      expect(new URL(location || '').pathname).toBe(
        '/smartphones/15-macbook-air-2023-16gb-512gb-m3'
      );
    });

    it('redirects typographic-dash storefront slugs to cache-safe ASCII', async () => {
      const req = new NextRequest(
        `https://ogabassey.${ROOT_DOMAIN}/laptops/dell-alienware-x14-r2-%E2%80%93-14%E2%80%9D`
      );
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(308);
      expect(location).toBeTruthy();
      expect(new URL(location || '').pathname).toBe(
        '/laptops/dell-alienware-x14-r2-14'
      );
    });

    it('preserves encoded reserved path separators while normalizing smart punctuation', async () => {
      const req = new NextRequest(
        `https://ogabassey.${ROOT_DOMAIN}/collections/phones%2Fandroid%E2%80%9D`
      );
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(308);
      expect(location).toBeTruthy();
      expect(new URL(location || '').pathname).toBe(
        '/collections/phones%2Fandroid'
      );
    });

    it('preserves encoded literal percent signs while normalizing smart punctuation', async () => {
      const req = new NextRequest(
        `https://ogabassey.${ROOT_DOMAIN}/products/100%25-cotton%E2%80%9D`
      );
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(308);
      expect(location).toBeTruthy();
      expect(new URL(location || '').pathname).toBe('/products/100%25-cotton');
    });

    it('redirects non-breaking-space storefront slugs to cache-safe ASCII', async () => {
      const req = new NextRequest(
        `https://ogabassey.${ROOT_DOMAIN}/accessories/iphone%C2%A0case`
      );
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(308);
      expect(location).toBeTruthy();
      expect(new URL(location || '').pathname).toBe('/accessories/iphone-case');
    });

    it('preserves non-Latin route bytes instead of erasing them', async () => {
      const req = new NextRequest(
        `https://ogabassey.${ROOT_DOMAIN}/search/%D1%82%D0%B5%D0%BB%D0%B5%D1%84%D0%BE%D0%BD%E2%80%9D-case`
      );
      req.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const res = await proxy(req);
      const location = res.headers.get('location');

      expect(res.status).toBe(308);
      expect(location).toBeTruthy();
      expect(new URL(location || '').pathname).toBe(
        '/search/%D1%82%D0%B5%D0%BB%D0%B5%D1%84%D0%BE%D0%BD-case'
      );

      const followUpReq = new NextRequest(location || '');
      followUpReq.headers.set('host', `ogabassey.${ROOT_DOMAIN}`);

      const followUpRes = await proxy(followUpReq);

      expect(followUpRes.status).not.toBe(308);
      expect(followUpRes.headers.get('location')).toBeNull();
    });
  });

  describe('config.matcher', () => {
    it('includes machine-readable agent JSON routes in middleware matching', () => {
      expect(config.matcher).toEqual(
        expect.arrayContaining(['/agent-commerce.json', '/agent-trust.json'])
      );
    });

    it('excludes .avif files from middleware matching', () => {
      // The matcher regex should not match .avif files (they bypass middleware)
      const matcherPattern = config.matcher.find((matcher) =>
        matcher?.includes('_next/image')
      );
      if (!matcherPattern) throw new Error('Static asset matcher is missing');
      const regex = new RegExp(matcherPattern);

      // .avif should NOT match (excluded from middleware)
      expect(regex.test('/images/hero.avif')).toBe(false);
    });

    it('includes trailing slash asset variants so proxy can canonicalize them', () => {
      const matcherPattern = config.matcher.find((matcher) =>
        matcher?.includes('_next/image')
      );
      if (!matcherPattern) throw new Error('Static asset matcher is missing');
      const regex = new RegExp(matcherPattern);

      expect(regex.test('/favicon.ico')).toBe(true);
      expect(regex.test('/favicon.ico/')).toBe(true);
      expect(regex.test('/images/some-icon.ico')).toBe(false);
      expect(regex.test('/robots.txt')).toBe(false);
      expect(regex.test('/robots.txt/')).toBe(true);
      expect(regex.test('/manifest.webmanifest')).toBe(false);
      expect(regex.test('/manifest.webmanifest/')).toBe(true);
      expect(regex.test('/_next/static/chunks/app.js')).toBe(false);
      expect(regex.test('/_next/static/chunks/app.js/')).toBe(true);
    });
  });
});

describe('blog subdomain migration redirects', () => {
  beforeEach(() => {
    // This is a top-level describe, so it does not inherit the outer suite's
    // clearAllMocks — reset call history here to stay isolated if this file's
    // tests are ever reordered or run in parallel.
    vi.clearAllMocks();
    // blog.ogabassey.com is not a merchant custom domain — without this the
    // suite-wide default mock resolves every hostname to 'ogabassey' and the
    // request never reaches the blog migration branch.
    vi.mocked(getSlugForCustomDomain).mockResolvedValue(null);
  });

  it('301s dated WordPress permalinks straight to the canonical post URL', async () => {
    const req = new NextRequest(
      'https://blog.ogabassey.com/2025/04/14/5-things-you-didnt-know-your-ipad-can-do'
    );
    req.headers.set('host', 'blog.ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/blog/5-things-you-didnt-know-your-ipad-can-do'
    );
  });

  it('301s trailing-slash dated permalinks to the canonical post URL in one hop', async () => {
    const req = new NextRequest(
      'https://blog.ogabassey.com/2025/04/14/5-things-you-didnt-know-your-ipad-can-do/'
    );
    req.headers.set('host', 'blog.ogabassey.com');

    const res = await proxy(req);

    // Single 301 (not a 308 trailing-slash strip first): the blog host is
    // exempted from the generic trailing-slash redirect.
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/blog/5-things-you-didnt-know-your-ipad-can-do'
    );
  });

  it('301s trailing-slash non-dated blog paths to a slashless target in one hop', async () => {
    const req = new NextRequest(
      'https://blog.ogabassey.com/chip-unlocked-what-they-wont-tell-you/'
    );
    req.headers.set('host', 'blog.ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/blog/chip-unlocked-what-they-wont-tell-you'
    );
  });

  it('301s non-dated legacy blog paths with their path preserved', async () => {
    const req = new NextRequest(
      'https://blog.ogabassey.com/chip-unlocked-what-they-wont-tell-you'
    );
    req.headers.set('host', 'blog.ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/blog/chip-unlocked-what-they-wont-tell-you'
    );
  });

  it('301s the blog subdomain root to the blog index', async () => {
    const req = new NextRequest('https://blog.ogabassey.com/');
    req.headers.set('host', 'blog.ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://ogabassey.com/blog');
  });

  it('does not collapse paths that only resemble partial date permalinks', async () => {
    const req = new NextRequest('https://blog.ogabassey.com/2024/03');
    req.headers.set('host', 'blog.ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/blog/2024/03'
    );
  });
});
