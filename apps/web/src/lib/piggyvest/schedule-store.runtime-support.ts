import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import { createAuthenticatedScheduleStore } from './schedule-store-authenticated';

export function scheduleStoreRuntimeFixture(
  sequence = 101,
  injected?: PiggyvestProvisioningExecutor
) {
  const goalId = `30000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  const merchantId = '10000000-0000-4000-8000-000000000001';
  const customerId = '20000000-0000-4000-8000-000000000001';
  const actorId = '90000000-0000-4000-8000-000000000001';
  const configuration = {
    environment: 'staging',
    transport: 'local_test',
    merchantId,
    integrationId: '40000000-0000-4000-8000-000000000001',
    expectedBusinessId: 'synthetic-business',
    expectedProjectId: 'synthetic',
    actualProjectId: 'synthetic',
    allowlistedMerchantIds: [merchantId],
    allowlistedCustomerIds: [customerId],
  };
  const getUser = vi
    .fn()
    .mockResolvedValue({ data: { user: { id: actorId } }, error: null });
  const rows: Record<string, unknown> = {
    merchants: { id: merchantId },
    customers: { id: customerId, merchant_id: merchantId, user_id: actorId },
    customer_savings_goals: {
      id: goalId,
      merchant_id: merchantId,
      customer_id: customerId,
    },
  };
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: rows[table], error: null }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    return query;
  });
  const database =
    injected ??
    createPiggyvestPostgresExecutor({
      environment: 'staging',
      transport: 'local_test',
      socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
      database: 'piggyvest_local',
      role: 'piggyvest_staging_policy_writer',
      password: 'synthetic-local-only',
      port: 55449,
    });
  const execute = vi.fn<PiggyvestProvisioningExecutor>(database);
  const options = {
    configuration,
    goalId,
    supabase: { auth: { getUser }, from } as unknown as SupabaseClient,
    execute,
  };
  return {
    store: createAuthenticatedScheduleStore(options),
    options,
    execute,
    database,
    getUser,
    from,
    goalId,
    actorId,
  };
}
