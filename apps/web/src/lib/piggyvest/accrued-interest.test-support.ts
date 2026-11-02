import { vi } from 'vitest';

/** Trusted-identity, mapping and provider doubles for the accrual reader suites. */

export const identity = {
  environment: 'staging',
  integrationId: '00000000-0000-4000-8000-000000000001',
  merchantId: '00000000-0000-4000-8000-000000000002',
  customerId: '00000000-0000-4000-8000-000000000003',
  goalId: '00000000-0000-4000-8000-000000000004',
  providerWalletId: 'synthetic-wallet',
  providerCustomerId: 'synthetic-customer',
};
export const configuration = {
  apiSecret: 'synthetic-secret',
  expectedBusinessId: 'synthetic-business',
  environment: 'staging',
  integrationId: identity.integrationId,
  expectedMerchantId: identity.merchantId,
  expectedProjectId: 'synthetic-project',
  actualProjectId: 'synthetic-project',
  allowlistedCustomerIds: [identity.customerId],
  provisioningApproved: true,
  syntheticIdentityApproved: true,
  fingerprintKey: 'synthetic-fingerprint-key-0000000000',
};
export const mapping = {
  merchant_id: identity.merchantId,
  customer_id: identity.customerId,
  goal_id: identity.goalId,
  restriction_status: 'ready',
};
export const wallet = {
  id: identity.providerWalletId,
  business_id: configuration.expectedBusinessId,
  currency: 'NGN',
  status: 'active',
  balance: 0,
};
export const edge = {
  id: 'synthetic-interest',
  business_id: configuration.expectedBusinessId,
  wallet_id: identity.providerWalletId,
  wallet_name: 'Synthetic wallet',
  amount: 0.123,
  balance: 123.456,
  percentage: 8,
  interest_date: '2026-09-01',
  interest_date_timestamp: '1788220800',
  interest_type: 'original',
  differential_wallet_id: null,
  differential_wallet_name: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};
export const pageInfo = {
  hasNextPage: true,
  endCursor: 'opaque +/&=?',
  previousCursor: null,
};
export const query = {
  start_date: '2026-09-01',
  end_date: '2026-09-12',
  limit: 2,
};
export function response(edges: unknown[] = [edge], pagination = pageInfo) {
  return {
    status: true,
    data: { paginatedPayload: { edges, pageInfo: pagination } },
  };
}
export function dependencies() {
  return {
    configuration,
    query,
    resolveTrustedIdentity: vi.fn(async () => identity),
    execute: vi.fn(async () => ({ rows: [mapping] })),
    fetchImplementation: vi.fn<typeof fetch>(),
  };
}
