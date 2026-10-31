import { vi } from 'vitest';

/** Deterministic doubles for onboardPiggyvestPrimaryWallet suites. */

// Uppercase Crockford ULIDs, the shape PiggyVest wallet ids read back as.
export const PAYOUT_WALLET_ID = '01JBZ8Q5W3X9R2K4M6N8P0T2V4';
export const OTHER_WALLET_ID = '01JBZ8Q5W3X9R2K4M6N8P0T2V5';

export function routedWallet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wallet-fixture',
    api_customer_id: 'customer-fixture',
    business_id: 'business-fixture',
    interest_enabled: true,
    interest_payout_wallet: PAYOUT_WALLET_ID,
    ...overrides,
  };
}

// Our idempotency identifier for the fixture scope.
export const THIRD_PARTY_IDENTIFIER =
  'baci:d91d9e87-8e0d-44de-9b84-1e1d709633d2:e648eb14-928a-427b-9719-b105f6d4b8b4';

export function customerListing(
  ids: string[],
  { hasNextPage = false, identifier = THIRD_PARTY_IDENTIFIER } = {}
) {
  return {
    paginatedPayload: {
      edges: ids.map((id) => ({ id, third_party_identifier: identifier })),
      pageInfo: { hasNextPage },
    },
  };
}

export function onboardingFixture() {
  return {
    configuration: {
      environment: 'production',
      merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
      businessId: 'business-fixture',
      businessBindingVerified: true,
      fingerprintKey: 'test-only-fingerprint-key-not-a-real-secret',
      interestPayoutWalletId: PAYOUT_WALLET_ID as string | undefined,
    },
    verifiedIdentity: {
      merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      customerId: 'e648eb14-928a-427b-9719-b105f6d4b8b4',
      userId: 'f4f01e61-691f-494a-a895-872f17f8e55e',
      email: 'TEST@example.com',
      emailVerified: true,
      name: 'Test Customer',
      phone: '08000000000',
    },
    request: { consent: true, bvn: '00000000000' },
    storage: {
      claim: vi.fn().mockResolvedValue({
        status: 'claimed',
        intentId: 'intent',
        claimToken: 'claim',
      }),
      recordAccepted: vi.fn().mockResolvedValue(true),
      recordUncertain: vi.fn().mockResolvedValue(undefined),
      recordRoutingPending: vi.fn().mockResolvedValue(true),
      resolveRoutingPending: vi.fn().mockResolvedValue(true),
      recordRejected: vi.fn().mockResolvedValue(undefined),
      releaseIntent: vi.fn().mockResolvedValue(true),
    },
    createCustomer: vi.fn().mockResolvedValue({
      customer_id: 'customer-fixture',
      wallet_id: 'wallet-fixture',
      new_customer: true,
    }),
    retrieveWallet: vi.fn().mockResolvedValue(routedWallet()),
    // A reclaim first asks PiggyVest whether the customer already exists;
    // by default it finds the one the earlier dispatch created.
    findCustomers: vi
      .fn()
      .mockResolvedValue(customerListing(['customer-fixture'])),
  };
}
