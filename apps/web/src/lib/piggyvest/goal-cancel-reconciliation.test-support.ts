import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { createGoalCancelEvidenceStore } from './goal-cancel-reconciliation';

export const integrationId = '11111111-1111-4111-8111-111111111111';
export const operationId = '66666666-6666-4666-8666-666666666666';
export const goalId = '55555555-5555-4555-8555-555555555555';
export const reference = `pvb-cancel-${goalId}`;
export const reservation = {
  operationId,
  goalId,
  amountKobo: 250000,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'main-wallet',
  reference,
  businessId: 'business',
  providerCustomerId: 'customer',
};
export const providerId = createHash('sha256')
  .update('s6-provider-id')
  .digest('hex');
export function record(status: 'successful' | 'failed', overrides = {}) {
  return {
    status: true,
    message: 'ok',
    data: {
      id: providerId,
      reference: providerId,
      internal_reference: providerId,
      third_party_reference: reference,
      status,
      amount: 250000,
      fee: 0,
      source_wallet: 'goal-wallet',
      destination_wallet: 'main-wallet',
      customer_id: 'customer',
      business_id: 'business',
      ...overrides,
    },
  };
}
export function setup(rows: unknown[]) {
  const execute = vi.fn();
  for (const row of rows)
    execute.mockResolvedValueOnce({ rows: [{ result: row }] });
  const store = createGoalCancelEvidenceStore({
    integrationId,
    environment: 'staging',
    execute,
  });
  return { execute, store };
}

export const inflowConfiguration = {
  integrationId,
  environment: 'staging',
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_primary_evidence',
    password: createHash('sha256').update('s6-evidence-db').digest('hex'),
    certificateAuthority: 'test-ca',
  },
};
export const token = createHash('sha256')
  .update('s6-outflow-token')
  .digest('hex');

/** A goal wallet answer that matches the dispatched reservation. */
export function goalWallet(balance: number, overrides = {}) {
  return {
    id: reservation.sourceWalletId,
    api_customer_id: reservation.providerCustomerId,
    business_id: reservation.businessId,
    currency: 'NGN',
    status: 'active',
    balance,
    ...overrides,
  };
}
