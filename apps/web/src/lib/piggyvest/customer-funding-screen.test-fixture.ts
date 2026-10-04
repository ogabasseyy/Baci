import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { vi } from 'vitest';
import { createPiggyvestCustomerFundingScreen } from './customer-funding-screen';

export function createFundingScreenFixture() {
  const identity = {
    environment: 'staging' as const,
    integrationId: '40000000-0000-4000-8000-000000000001',
    merchantId: '10000000-0000-4000-8000-000000000001',
    customerId: '20000000-0000-4000-8000-000000000001',
    goalId: '30000000-0000-4000-8000-000000000001',
    providerWalletId: 'synthetic-wallet',
    providerCustomerId: 'synthetic-customer',
  };
  const actorId = '90000000-0000-4000-8000-000000000001';
  const revisionId = '70000000-0000-4000-8000-000000000001';
  const terms = {
    version: 'synthetic-v1',
    text: 'Synthetic terms only.',
    hash: createHash('sha256').update('Synthetic terms only.').digest('hex'),
  };
  const policy = {
    revisionId,
    command: {
      revisionId,
      expectedGoalUpdatedAt: '2026-09-12T00:00:00Z',
      productId: '50000000-0000-4000-8000-000000000001',
      variantId: null,
      termsVersion: terms.version,
      termsHash: terms.hash,
      quoteId: 'synthetic-quote',
      quoteKobo: 100000,
      quoteExpiresAt: '2099-01-01T00:00:00Z',
      guarantee: null,
      lifecycle: 'draft',
      collectionPaused: true,
    },
    device: {
      name: 'Synthetic phone',
      condition: 'New',
      variantId: null,
      variantLabel: null,
      selectionStatus: 'exact',
    },
    actorId: actorId as string | null,
    acceptedAt: '2026-09-12T01:00:00Z' as string | null,
    durationMonths: 1,
  };
  const ledgerSnapshot = {
    ledger: {
      confirmedPrincipalKobo: 0,
      paidEligibleInterestKobo: 0,
      pendingInterestKobo: 0,
      reservedPrincipalKobo: 0,
      reservedPaidInterestKobo: 0,
    },
    activeReservation: null,
    fundingReversed: false,
  };
  const rows: Record<string, unknown> = {
    merchants: { id: identity.merchantId },
    customers: {
      id: identity.customerId,
      merchant_id: identity.merchantId,
      user_id: actorId,
    },
    customer_savings_goals: {
      id: identity.goalId,
      merchant_id: identity.merchantId,
      customer_id: identity.customerId,
    },
  };
  const getUser = vi.fn(async () => ({
    data: { user: { id: actorId } },
    error: null,
  }));
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: rows[table], error: null })),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    return query;
  });
  const configuration = {
    environment: 'staging',
    transport: 'local_test',
    integrationId: identity.integrationId,
    merchantId: identity.merchantId,
    expectedBusinessId: 'synthetic-business',
    expectedProjectId: 'synthetic-project',
    actualProjectId: 'synthetic-project',
    allowlistedMerchantIds: [identity.merchantId],
    allowlistedCustomerIds: [identity.customerId],
  };
  const fundingConfiguration = {
    apiSecret: 'synthetic-secret',
    expectedBusinessId: configuration.expectedBusinessId,
    environment: 'staging',
    integrationId: identity.integrationId,
    expectedMerchantId: identity.merchantId,
    expectedProjectId: configuration.expectedProjectId,
    actualProjectId: configuration.actualProjectId,
    allowlistedCustomerIds: [identity.customerId],
    provisioningApproved: true,
    syntheticIdentityApproved: true,
    fingerprintKey: 'synthetic-fingerprint-key-0000000000',
    fundingDisplayEnabled: true,
  };
  const execute = vi.fn(async () => ({ rows: [{ result: policy }] }));
  const fundingExecute = vi.fn(
    async (): Promise<{ rows: unknown }> => ({
      rows: [{ result: { policy, ledgerSnapshot, identity } }],
    })
  );
  const mappingExecute = vi.fn(async () => ({
    rows: [
      {
        merchant_id: identity.merchantId,
        customer_id: identity.customerId,
        goal_id: identity.goalId,
      },
    ],
  }));
  const fetchImplementation = vi
    .fn<typeof fetch>()
    .mockImplementation((url) => {
      if (String(url).endsWith('/accounts'))
        return Promise.resolve(
          Response.json({
            status: true,
            data: [
              {
                account_number: '0001234567',
                account_name: 'Synthetic account',
                bank_name: 'Synthetic bank',
                paypoint_id: null,
                paypoint_name: null,
              },
            ],
          })
        );
      return Promise.resolve(
        Response.json({
          status: true,
          data: {
            id: identity.providerWalletId,
            business_id: configuration.expectedBusinessId,
            currency: 'NGN',
            status: 'active',
            balance: 999999999,
          },
        })
      );
    });
  const options = {
    supabase: { auth: { getUser }, from } as unknown as SupabaseClient,
    goalId: identity.goalId,
    configuration,
    termsDocument: terms,
    execute,
    checkCsrfProtection: vi.fn(async () => ({ valid: true })),
    fundingConfiguration,
    fundingExecute,
    mappingExecute,
    fetchImplementation,
  };
  return {
    options,
    identity,
    policy,
    ledgerSnapshot,
    rows,
    getUser,
    from,
    execute,
    fundingExecute,
    mappingExecute,
    fetchImplementation,
    read: () =>
      createPiggyvestCustomerFundingScreen(options).readScreen(
        new NextRequest(`http://localhost/policy?goalId=${identity.goalId}`)
      ),
  };
}
