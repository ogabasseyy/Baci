import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockResolveCustomerSavingsContext = vi.fn();
const mockGetCustomerSavingsFeatureSettings = vi.fn();
const mockExecutePiggyvestPostgres = vi.fn();
const mockEnsurePiggyvestPlanFunding = vi.fn();
const mockRetrievePiggyvestStagingFundingAccounts = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
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
vi.mock('@/lib/piggyvest/postgres-executor', () => ({
  createPiggyvestPostgresExecutor: vi.fn(() => mockExecutePiggyvestPostgres),
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

import { PIGGYVEST_POSTGRES_STATEMENTS } from '@/lib/piggyvest/postgres-statements';
import { piggyvestStagingConfigurationSchema } from '@/schemas/piggyvest-staging-configuration';
import { GET } from './route';

const merchantId = '10000000-0000-4000-8000-000000000001';
const customerId = '20000000-0000-4000-8000-000000000001';
const goalId = '30000000-0000-4000-8000-000000000001';
const integrationId = '40000000-0000-4000-8000-000000000001';

function get(query = `goalId=${goalId}&merchantId=${merchantId}`) {
  return new NextRequest(
    `http://localhost/api/storefront/customer/savings/funding?${query}`
  );
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
  vi.stubEnv('PIGGYVEST_SAVINGS_FUNDING_INTEGRATION_ID', integrationId);
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
  mockGetCustomerSavingsFeatureSettings.mockResolvedValue({
    savingsEnabled: true,
  });
  mockResolveCustomerSavingsContext.mockResolvedValue({
    customer: { id: customerId },
    merchant: { id: merchantId },
    supabase: {
      from: vi.fn(() =>
        goalQuery({ id: goalId, status: 'active', source_mode: 'manual' })
      ),
    },
  });
  mockExecutePiggyvestPostgres.mockResolvedValue({
    rows: [
      {
        provider_wallet_id: 'synthetic-wallet',
        provider_customer_id: 'synthetic-customer',
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

describe('/api/storefront/customer/savings/funding GET', () => {
  it('returns 401 before reading a mapping when unauthenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({ error: 'Unauthorized' });

    const response = await GET(get());

    expect(response.status).toBe(401);
    expect(mockExecutePiggyvestPostgres).not.toHaveBeenCalled();
    expect(mockRetrievePiggyvestStagingFundingAccounts).not.toHaveBeenCalled();
  });

  it('rejects malformed query input without reading a mapping', async () => {
    const response = await GET(get(`goalId=bad&merchantId=${merchantId}`));

    expect(response.status).toBe(400);
    expect(mockExecutePiggyvestPostgres).not.toHaveBeenCalled();
  });

  it('returns 404 without reading a mapping for a foreign goal', async () => {
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: customerId },
      merchant: { id: merchantId },
      supabase: { from: vi.fn(() => goalQuery(null)) },
    });

    const response = await GET(get());

    expect(response.status).toBe(404);
    expect(mockExecutePiggyvestPostgres).not.toHaveBeenCalled();
  });

  it('reads the exact scoped mapping and returns its verified accounts', async () => {
    const response = await GET(get());

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
    expect(mockExecutePiggyvestPostgres).toHaveBeenCalledWith(
      PIGGYVEST_POSTGRES_STATEMENTS.readScopedWalletMapping.text,
      [integrationId, merchantId, customerId, goalId]
    );
    const [fundingArguments] =
      mockRetrievePiggyvestStagingFundingAccounts.mock.calls[0];
    expect(
      piggyvestStagingConfigurationSchema.safeParse(
        fundingArguments.configuration
      ).success
    ).toBe(true);
    expect(fundingArguments.configuration).toEqual({
      apiBaseUrl: 'https://staging.piggyvest.business',
      apiSecret: 'synthetic-secret',
      expectedBusinessId: 'synthetic-business',
      expectedCurrency: 'NGN',
      timeoutMs: 5000,
      maxResponseBytes: 65536,
    });
    await expect(fundingArguments.resolveTrustedIdentity()).resolves.toEqual({
      environment: 'staging',
      integrationId,
      merchantId,
      customerId,
      goalId,
      providerWalletId: 'synthetic-wallet',
      providerCustomerId: 'synthetic-customer',
    });
    expect(mockEnsurePiggyvestPlanFunding).not.toHaveBeenCalled();
  });

  it('returns MAPPING_PENDING without calling the provider when no mapping exists', async () => {
    mockExecutePiggyvestPostgres.mockResolvedValue({ rows: [] });

    const response = await GET(get());

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      status: 'pending',
      code: 'MAPPING_PENDING',
    });
    expect(mockRetrievePiggyvestStagingFundingAccounts).not.toHaveBeenCalled();
    expect(mockEnsurePiggyvestPlanFunding).not.toHaveBeenCalled();
  });

  it('refuses an authenticated customer outside the staging allowlist before mapping access', async () => {
    vi.stubEnv(
      'PIGGYVEST_SAVINGS_FUNDING_CUSTOMER_ALLOWLIST',
      '20000000-0000-4000-8000-000000000099'
    );

    const response = await GET(get());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'unavailable',
      code: 'NOT_CONFIGURED',
    });
    expect(mockExecutePiggyvestPostgres).not.toHaveBeenCalled();
    expect(mockRetrievePiggyvestStagingFundingAccounts).not.toHaveBeenCalled();
  });
});
