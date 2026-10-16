import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ServerModule = typeof import('next/server');

type MutationRecord = {
  filters: [string, unknown][];
  payload: Record<string, unknown>;
};

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  checkCsrfProtection: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  hasPermission: vi.fn(),
  mutations: [] as MutationRecord[],
  revalidateMerchantFeed: vi.fn(),
  requireMerchantFeatureAccess: vi.fn(),
  triggerDomainEdgeConfigSync: vi.fn(),
  vercelVerifyDomain: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({}),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<ServerModule>();
  return { ...actual, after: mocks.after };
});

vi.mock('@/lib/api-auth', () => ({
  hasPermission: (...args: unknown[]) => mocks.hasPermission(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) =>
    mocks.checkCsrfProtection(...args),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateMerchantFeed: (...args: unknown[]) =>
    mocks.revalidateMerchantFeed(...args),
}));

vi.mock('@/lib/edge-config-sync', () => ({
  triggerDomainEdgeConfigSync: (...args: unknown[]) =>
    mocks.triggerDomainEdgeConfigSync(...args),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mocks.getMerchantForApiRequest(...args),
  toUserAccess: vi.fn(() => ({})),
}));

vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: (...args: unknown[]) =>
    mocks.requireMerchantFeatureAccess(...args),
}));

vi.mock('@/lib/vercel', () => ({
  vercel: {
    verifyDomain: (...args: unknown[]) => mocks.vercelVerifyDomain(...args),
  },
}));

function createMutationQuery(payload: Record<string, unknown>) {
  const mutation: MutationRecord = { filters: [], payload };
  mocks.mutations.push(mutation);

  type MutationQuery = Promise<{ error: null }> & {
    eq: (column: string, value: unknown) => MutationQuery;
  };

  const query = Promise.resolve({ error: null }) as MutationQuery;
  query.eq = (column: string, value: unknown) => {
    mutation.filters.push([column, value]);
    return query;
  };

  return query;
}

function createSupabase() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table !== 'domains') {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'domain-1',
                  verification_token: 'old-token',
                },
                error: null,
              }),
            })),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) =>
          createMutationQuery(payload)
        ),
      };
    }),
  };
}

let supabase: ReturnType<typeof createSupabase>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => supabase),
}));

const { POST } = await import('./route');

function createRequest() {
  return new NextRequest('http://localhost/api/domains/shop.com/verify', {
    method: 'POST',
  });
}

function createParams() {
  return { params: Promise.resolve({ domain: 'shop.com' }) };
}

describe('POST /api/domains/[domain]/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutations.length = 0;
    supabase = createSupabase();
    mocks.checkCsrfProtection.mockResolvedValue({ valid: true });
    mocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
    });
    mocks.hasPermission.mockReturnValue(true);
    mocks.requireMerchantFeatureAccess.mockResolvedValue(null);
  });

  it('scopes the verified-domain status update to the authenticated merchant', async () => {
    mocks.vercelVerifyDomain.mockResolvedValue({ verified: true });

    const response = await POST(createRequest(), createParams());

    expect(response.status).toBe(200);
    expect(mocks.mutations).toHaveLength(1);
    expect(mocks.mutations[0].payload).toMatchObject({
      ssl_status: 'active',
      status: 'active',
    });
    expect(mocks.mutations[0].filters).toEqual([
      ['id', 'domain-1'],
      ['merchant_id', 'merchant-1'],
    ]);
    expect(mocks.revalidateMerchantFeed).toHaveBeenCalledWith('merchant-1');
  });

  it('scopes TXT verification-token refreshes to the authenticated merchant', async () => {
    mocks.vercelVerifyDomain.mockResolvedValue({
      verification: [
        {
          domain: '_vercel.shop.com',
          reason: 'Missing TXT record',
          type: 'TXT',
          value: 'new-token',
        },
      ],
      verified: false,
    });

    const response = await POST(createRequest(), createParams());

    expect(response.status).toBe(400);
    expect(mocks.mutations).toHaveLength(1);
    expect(mocks.mutations[0].payload).toEqual({
      verification_token: 'new-token',
    });
    expect(mocks.mutations[0].filters).toEqual([
      ['id', 'domain-1'],
      ['merchant_id', 'merchant-1'],
    ]);
  });

  it('returns 402 before Vercel verification when custom domains are locked', async () => {
    mocks.requireMerchantFeatureAccess.mockResolvedValueOnce(
      Response.json(
        {
          code: 'requires_upgrade',
          error: 'Custom domains require Baci Pro',
        },
        { status: 402 }
      )
    );

    const response = await POST(createRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.code).toBe('requires_upgrade');
    expect(mocks.vercelVerifyDomain).not.toHaveBeenCalled();
    expect(mocks.mutations).toHaveLength(0);
  });
});
