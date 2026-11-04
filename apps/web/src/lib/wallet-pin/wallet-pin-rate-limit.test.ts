// @vitest-environment node
import { NextRequest, type NextResponse } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST as setRoute } from '@/app/api/storefront/customer/wallet-pin/set/route';
import { GET as statusRoute } from '@/app/api/storefront/customer/wallet-pin/status/route';
import {
  getApiSecurityContext,
  runApiSecurityStage,
} from '@/lib/proxy/api-security';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/wallet-pin/wallet-pin-customer-limit', () => ({
  chargeWalletPinCustomerLimit: async () => null,
}));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  limit: vi.fn(),
  runtime: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.limit,
  createRateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: async () => ({ valid: true }),
}));
vi.mock('@/lib/piggyvest/primary-wallet-runtime', () => ({
  readPrimaryWalletRuntime: mocks.runtime,
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: async () => null,
}));
vi.mock('@/lib/reverse-domain-cache', () => ({
  isRecentlyUnmappedCustomDomain: () => false,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue({
    allowed: true,
    limit: 10,
    remaining: 9,
    resetTime: 0,
  });
  mocks.auth.mockResolvedValue({
    error: null,
    user: { id: 'u' },
    supabase: {},
  });
  mocks.runtime.mockReturnValue(null);
});

async function throughProxyThenRoute(
  request: NextRequest,
  route: (r: NextRequest) => Promise<NextResponse> | NextResponse
) {
  const { pathname } = request.nextUrl;
  const context = getApiSecurityContext(pathname, 'localhost', request.method);
  expect(await runApiSecurityStage(request, context)).toBeNull();
  return route(request);
}

it('charges the limiter once per mutation, from the proxy only', async () => {
  const request = new NextRequest(
    'http://localhost/api/storefront/customer/wallet-pin/set',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '482915' }),
    }
  );
  await throughProxyThenRoute(request, setRoute);
  expect(mocks.limit).toHaveBeenCalledTimes(1);
  expect(mocks.limit.mock.calls[0][1]).toBe(
    '/api/storefront/customer/wallet-pin/set'
  );
});

it('charges the limiter once per status read', async () => {
  const request = new NextRequest(
    'http://localhost/api/storefront/customer/wallet-pin/status'
  );
  await throughProxyThenRoute(request, statusRoute);
  expect(mocks.limit).toHaveBeenCalledTimes(1);
});
