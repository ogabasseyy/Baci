import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ServerModule = typeof import('next/server');

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  authenticateApiRequest: vi.fn(),
  checkCsrfProtection: vi.fn(),
  getMerchantIdForApiUser: vi.fn(),
  revalidateMerchantFeed: vi.fn(),
  triggerDomainEdgeConfigSync: vi.fn(),
  vercelAddDomain: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<ServerModule>();
  return { ...actual, after: mocks.after };
});

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mocks.authenticateApiRequest(...args),
  getMerchantIdForApiUser: (...args: unknown[]) =>
    mocks.getMerchantIdForApiUser(...args),
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

vi.mock('@/lib/vercel', () => ({
  vercel: {
    addDomain: (...args: unknown[]) => mocks.vercelAddDomain(...args),
  },
}));

const { POST } = await import('./route');

function createInsertQuery() {
  return {
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({
        data: {
          domain: 'shop.example.com',
          id: 'domain-1',
          is_primary: true,
          status: 'active',
        },
        error: null,
      }),
    })),
  };
}

function createMerchantQuery(planTier = 'pro') {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'merchant-1',
            plan_expires_at: null,
            plan_tier: planTier,
            premium_features: [],
          },
          error: null,
        }),
      })),
    })),
  };
}

function createSupabase(planTier = 'pro') {
  return {
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        return createMerchantQuery(planTier);
      }

      if (table !== 'domains') {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        insert: vi.fn(() => createInsertQuery()),
      };
    }),
  };
}

function createRequest() {
  return new NextRequest('http://localhost/api/domains', {
    method: 'POST',
    body: JSON.stringify({
      domain: 'shop.example.com',
      isPrimary: true,
    }),
  });
}

describe('POST /api/domains', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkCsrfProtection.mockResolvedValue({ valid: true });
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: createSupabase(),
      user: { id: 'user-1' },
    });
    mocks.getMerchantIdForApiUser.mockResolvedValue('merchant-1');
    mocks.vercelAddDomain.mockResolvedValue({
      verified: true,
      verification: [],
    });
  });

  it('returns 402 before adding a Vercel domain when custom domains are not enabled', async () => {
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: createSupabase('free'),
      user: { id: 'user-1' },
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      code: 'requires_upgrade',
      error: 'Custom domains require Baci Starter or higher',
    });
    expect(mocks.vercelAddDomain).not.toHaveBeenCalled();
  });

  it('revalidates the merchant feed when adding a domain succeeds', async () => {
    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(mocks.revalidateMerchantFeed).toHaveBeenCalledWith('merchant-1');
    expect(mocks.after).toHaveBeenCalled();
  });
});
