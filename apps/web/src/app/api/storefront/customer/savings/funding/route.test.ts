import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockResolveCustomerSavingsContext = vi.fn();
const mockGetCustomerSavingsFeatureSettings = vi.fn();
const mockEnsurePiggyvestPlanFunding = vi.fn();
const mockRetrievePiggyvestStagingFundingAccounts = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));
vi.mock('@/app/api/storefront/customer/savings/shared', () => ({
  getCustomerSavingsFeatureSettings: (...args: unknown[]) =>
    mockGetCustomerSavingsFeatureSettings(...args),
  getSavingsIdentifierParams: (searchParams: URLSearchParams) => ({
    merchantId: searchParams.get('merchantId') ?? undefined,
    merchantSlug: searchParams.get('merchantSlug') ?? undefined,
  }),
  resolveCustomerSavingsContext: (...args: unknown[]) =>
    mockResolveCustomerSavingsContext(...args),
}));
vi.mock('@/lib/piggyvest/customer-plan-funding-ensure', () => ({
  ensurePiggyvestPlanFunding: (...args: unknown[]) =>
    mockEnsurePiggyvestPlanFunding(...args),
}));
vi.mock('@/lib/piggyvest/funding-accounts', () => ({
  PiggyvestStagingFundingAccountsError: class PiggyvestStagingFundingAccountsError extends Error {},
  retrievePiggyvestStagingFundingAccounts: (...args: unknown[]) =>
    mockRetrievePiggyvestStagingFundingAccounts(...args),
}));

import { POST } from './route';

const merchantId = '10000000-0000-4000-8000-000000000001';
const customerId = '20000000-0000-4000-8000-000000000001';
const goalId = '30000000-0000-4000-8000-000000000001';
const endpoint = `http://localhost/api/storefront/customer/savings/funding?merchantId=${merchantId}`;
const fundingBody = { goalId, bvn: '00000000000' };

function post(body: unknown) {
  return new NextRequest(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function goalQuery(goal: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: goal, error: null }),
          }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PIGGYVEST_SAVINGS_FUNDING_DISPLAY_ENABLED', 'true');
  vi.stubEnv('PIGGYVEST_SAVINGS_FUNDING_API_SECRET', 'synthetic-secret');
  vi.stubEnv('PIGGYVEST_SAVINGS_FUNDING_BUSINESS_ID', 'synthetic-business');
  vi.stubEnv(
    'PIGGYVEST_SAVINGS_FUNDING_INTEGRATION_ID',
    '40000000-0000-4000-8000-000000000001'
  );
  vi.stubEnv('PIGGYVEST_SAVINGS_FUNDING_MERCHANT_ID', merchantId);
  vi.stubEnv('PIGGYVEST_SAVINGS_FUNDING_PROJECT_ID', 'synthetic-project');
  vi.stubEnv('PIGGYVEST_SAVINGS_FUNDING_CUSTOMER_ALLOWLIST', customerId);
  vi.stubEnv(
    'PIGGYVEST_SAVINGS_FUNDING_FINGERPRINT_KEY',
    'synthetic-fingerprint-key-0000000000'
  );
  vi.stubEnv('PIGGYVEST_SAVINGS_FUNDING_DB_HOST', 'db.example.test');
  vi.stubEnv('PIGGYVEST_SAVINGS_FUNDING_DB_PORT', '5432');
  vi.stubEnv('PIGGYVEST_SAVINGS_FUNDING_DB_NAME', 'piggyvest_staging');
  vi.stubEnv('PIGGYVEST_SAVINGS_FUNDING_DB_PASSWORD', 'synthetic-password');
  mockAuthenticateApiRequest.mockResolvedValue({
    error: null,
    supabase: {},
    user: { id: 'actor' },
  });
  mockCheckCsrfProtection.mockResolvedValue({ valid: true });
  mockGetCustomerSavingsFeatureSettings.mockResolvedValue({
    savingsEnabled: true,
  });
  mockResolveCustomerSavingsContext.mockResolvedValue({
    customer: {
      id: customerId,
      first_name: 'Synthetic',
      last_name: 'Customer',
      email: 'synthetic@example.test',
      phone: '+2340000000000',
    },
    merchant: { id: merchantId },
    supabase: {
      from: vi.fn(() => goalQuery({ id: goalId, status: 'active', source_mode: 'manual' })),
    },
  });
  mockEnsurePiggyvestPlanFunding.mockResolvedValue({
    status: 'ready',
    accounts: [
      {
        accountNumber: '0001234567',
        accountName: 'Synthetic account',
        bankName: 'Synthetic bank',
      },
    ],
  });
  mockRetrievePiggyvestStagingFundingAccounts.mockResolvedValue({
    status: 'ready',
    accounts: [
      {
        account_number: '0001234567',
        account_name: 'Synthetic account',
        bank_name: 'Synthetic bank',
      },
    ],
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('/api/storefront/customer/savings/funding POST', () => {
  it.each([
    'cancelled',
    'completed',
    'spent',
    'paused',
    null,
  ])('refuses provisioning for a non-active goal (%s)', async (status) => {
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: customerId },
      merchant: { id: merchantId },
      supabase: { from: vi.fn(() => goalQuery({ id: goalId, status })) },
    });
    const response = await POST(post(fundingBody));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'SAVINGS_GOAL_NOT_ACTIVE',
      error: 'Only active savings plans can be funded',
    });
    expect(mockEnsurePiggyvestPlanFunding).not.toHaveBeenCalled();
  });
  it('returns 401 before touching funding when unauthenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({ error: 'Unauthorized' });

    const response = await POST(post(fundingBody));

    expect(response.status).toBe(401);
    expect(mockEnsurePiggyvestPlanFunding).not.toHaveBeenCalled();
  });

  it('rejects malformed funding input without provisioning', async () => {
    const response = await POST(post({ goalId, bvn: 'short' }));

    expect(response.status).toBe(400);
    expect(mockEnsurePiggyvestPlanFunding).not.toHaveBeenCalled();
  });

  it('returns mapped accounts with verified customer identity', async () => {
    const response = await POST(post(fundingBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ready',
      accounts: [
        {
          accountNumber: '0001234567',
          accountName: 'Synthetic account',
          bankName: 'Synthetic bank',
        },
      ],
    });
    expect(mockEnsurePiggyvestPlanFunding).toHaveBeenCalledOnce();
    const call = mockEnsurePiggyvestPlanFunding.mock.calls[0][0];
    expect(call.customer).toMatchObject({
      merchantId,
      customerId,
      goalId,
      bvn: '00000000000',
      name: 'Synthetic Customer',
      email: 'synthetic@example.test',
      phone: '+2340000000000',
    });
    expect(call.options).toMatchObject({ reserveVirtualAccount: true });
    expect(typeof call.execute).toBe('function');
    expect(call.fetchImplementation).toBe(fetch);
  });

  it('forwards the interest opt-in to provisioning when requested', async () => {
    const response = await POST(
      post({ ...fundingBody, enableInterestAccrual: true })
    );

    expect(response.status).toBe(200);
    expect(
      mockEnsurePiggyvestPlanFunding.mock.calls[0][0].options
    ).toMatchObject({ enableInterestAccrual: true });
  });

  it('returns 202 while provisioning is still in flight', async () => {
    mockEnsurePiggyvestPlanFunding.mockResolvedValue({
      status: 'pending',
      code: 'PROVISIONING_IN_PROGRESS',
    });

    const response = await POST(post(fundingBody));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      status: 'pending',
      code: 'PROVISIONING_IN_PROGRESS',
    });
  });

  it('returns 404 when the goal belongs to another customer', async () => {
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: 'other-customer' },
      merchant: { id: merchantId },
      supabase: { from: vi.fn(() => goalQuery(null)) },
    });

    const response = await POST(post(fundingBody));

    expect(response.status).toBe(404);
    expect(mockEnsurePiggyvestPlanFunding).not.toHaveBeenCalled();
  });

  it('returns 422 without provisioning when customer identity is incomplete', async () => {
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: customerId, first_name: null, last_name: null },
      merchant: { id: merchantId },
      supabase: {
        from: vi.fn(() => goalQuery({ id: goalId, status: 'active', source_mode: 'manual' })),
      },
    });

    const response = await POST(post(fundingBody));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      status: 'unavailable',
      code: 'IDENTITY_INCOMPLETE',
    });
    expect(mockEnsurePiggyvestPlanFunding).not.toHaveBeenCalled();
  });

  it('returns 503 when the funding display switch is off', async () => {
    vi.stubEnv('PIGGYVEST_SAVINGS_FUNDING_DISPLAY_ENABLED', 'false');

    const response = await POST(post(fundingBody));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'unavailable',
      code: 'NOT_CONFIGURED',
    });
    expect(mockEnsurePiggyvestPlanFunding).not.toHaveBeenCalled();
  });
});
