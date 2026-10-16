import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ServerModule = typeof import('next/server');

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  authenticateApiRequest: vi.fn(),
  checkCsrfProtection: vi.fn(),
  getUserAccess: vi.fn(),
  hasPermission: vi.fn(),
  revalidateMerchantFeed: vi.fn(),
  requireMerchantFeatureAccess: vi.fn(),
  triggerDomainEdgeConfigSync: vi.fn(),
  vercelRemoveDomain: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<ServerModule>();
  return { ...actual, after: mocks.after };
});

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mocks.authenticateApiRequest(...args),
  getUserAccess: (...args: unknown[]) => mocks.getUserAccess(...args),
  hasPermission: (...args: unknown[]) => mocks.hasPermission(...args),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateMerchantFeed: (...args: unknown[]) =>
    mocks.revalidateMerchantFeed(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) =>
    mocks.checkCsrfProtection(...args),
}));

vi.mock('@/lib/edge-config-sync', () => ({
  triggerDomainEdgeConfigSync: (...args: unknown[]) =>
    mocks.triggerDomainEdgeConfigSync(...args),
}));

vi.mock('@/lib/go54', () => ({
  getDomainInformation: vi.fn(),
  getDomainLock: vi.fn(),
  getDomainNameservers: vi.fn(),
  updateDomainLock: vi.fn(),
  updateDomainNameservers: vi.fn(),
}));

vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: (...args: unknown[]) =>
    mocks.requireMerchantFeatureAccess(...args),
}));

vi.mock('@/lib/vercel', () => ({
  vercel: {
    removeDomain: (...args: unknown[]) => mocks.vercelRemoveDomain(...args),
  },
}));

const { DELETE, POST } = await import('./route');

function createDeleteQuery() {
  type DeleteQuery = Promise<{ error: null }> & {
    eq: (column: string, value: unknown) => DeleteQuery;
  };

  const query = Promise.resolve({ error: null }) as DeleteQuery;
  query.eq = vi.fn(() => query);

  return query;
}

function createSupabase() {
  return {
    from: vi.fn((table: string) => {
      if (table !== 'domains') {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        delete: vi.fn(() => createDeleteQuery()),
      };
    }),
  };
}

function createRequest() {
  return new NextRequest('http://localhost/api/domains/shop.example.com', {
    method: 'DELETE',
  });
}

function createPostRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/domains/shop.example.com', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DELETE /api/domains/[domain]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkCsrfProtection.mockResolvedValue({ valid: true });
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: createSupabase(),
      user: { id: 'user-1' },
    });
    mocks.getUserAccess.mockResolvedValue({ merchantId: 'merchant-1' });
    mocks.hasPermission.mockReturnValue(true);
    mocks.requireMerchantFeatureAccess.mockResolvedValue(null);
    mocks.vercelRemoveDomain.mockResolvedValue(undefined);
  });

  it('revalidates the merchant feed when deleting a domain succeeds', async () => {
    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ domain: 'shop.example.com' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.revalidateMerchantFeed).toHaveBeenCalledWith('merchant-1');
    expect(mocks.after).toHaveBeenCalled();
  });
});

describe('POST /api/domains/[domain]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkCsrfProtection.mockResolvedValue({ valid: true });
    mocks.hasPermission.mockReturnValue(true);
    mocks.requireMerchantFeatureAccess.mockResolvedValue(
      Response.json(
        {
          code: 'requires_upgrade',
          error: 'Custom domains require Baci Pro',
        },
        { status: 402 }
      )
    );
  });

  it('returns 402 before reading domain details when custom domains are locked', async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error('domain lookup should not run');
      }),
    };
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });
    mocks.getUserAccess.mockResolvedValue({ merchantId: 'merchant-1' });

    const response = await POST(
      createPostRequest({ action: 'update_lock', data: { lock: true } }),
      {
        params: Promise.resolve({ domain: 'shop.example.com' }),
      }
    );
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.code).toBe('requires_upgrade');
    expect(mocks.requireMerchantFeatureAccess).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'custom_domain'
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
