import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { vi } from 'vitest';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function cancellationRecoveryFixture(
  database?: PiggyvestProvisioningExecutor
) {
  const goalId = '30000000-0000-4000-8000-000000000101';
  const operationId = '80000000-0000-4000-8000-000000000101';
  const actorId = '90000000-0000-4000-8000-000000000001';
  const merchantId = '10000000-0000-4000-8000-000000000001';
  const customerId = '20000000-0000-4000-8000-000000000001';
  const rows: Record<string, unknown> = {
    merchants: { id: merchantId },
    customers: { id: customerId, merchant_id: merchantId, user_id: actorId },
    customer_savings_goals: {
      id: goalId,
      merchant_id: merchantId,
      customer_id: customerId,
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
  const prepared = {
    goalId,
    requestedOperationId: operationId,
    operationId,
    retry: 'not_authorized',
    dispatch: 'contract_gap',
    status: 'prepared',
    reservation: 'retained',
    interestDisposition: 'unresolved',
    originalDisclosure: {
      revisionId: '70000000-0000-4000-8000-000000000101',
      termsVersion: 'synthetic-v1',
      termsHash: 'a'.repeat(64),
      consentVersion: '2026-09-11',
      principalKobo: 100,
      paidInterestKobo: 7,
      pendingInterestKobo: 3,
    },
  };
  const execute = vi.fn<PiggyvestProvisioningExecutor>(
    database ?? (async () => ({ rows: [{ result: prepared }] }))
  );
  const options = {
    supabase: { auth: { getUser }, from } as unknown as SupabaseClient,
    goalId,
    configuration: {
      environment: 'staging',
      transport: 'local_test',
      merchantId,
      integrationId: '40000000-0000-4000-8000-000000000001',
      expectedBusinessId: 'synthetic-business',
      expectedProjectId: 'synthetic',
      actualProjectId: 'synthetic',
      allowlistedMerchantIds: [merchantId],
      allowlistedCustomerIds: [customerId],
    },
    execute,
  };
  const request = (query = `goalId=${goalId}&operationId=${operationId}`) =>
    new NextRequest(`http://localhost/recovery?${query}`);
  return {
    options,
    getUser,
    from,
    rows,
    prepared,
    request,
    execute,
    actorId,
    goalId,
    operationId,
  };
}
