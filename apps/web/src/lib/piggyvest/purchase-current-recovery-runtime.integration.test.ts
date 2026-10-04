import { describe, expect, it, vi } from 'vitest';
import { client, server } from './customer-purchase-http.fixture';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { PIGGYVEST_POSTGRES_STATEMENTS } from './postgres-statements';
import { createPurchaseCurrentRecovery } from './purchase-current-recovery';
import { PURCHASE_CURRENT_RECOVERY_STATEMENTS } from './purchase-current-recovery-statements';
import {
  actorId,
  configuration,
  customerId,
  database,
  goal,
  merchantId,
  query,
} from './purchase-pricing-runtime.fixture';

vi.mock('server-only', () => ({}));
describe.skipIf(
  process.env.PIGGYVEST_RUN_PURCHASE_CURRENT_RECOVERY_EXECUTOR !== '1'
)('registered standard executor plus current purchase HTTP recovery', () => {
  const config = () => ({
    environment: 'staging',
    transport: 'local_test',
    integrationId: configuration().integrationId,
    merchantId,
    customerId,
    goalId: goal(207),
    expectedBusinessId: 'synthetic-business',
    actorId,
  });
  it('requires the real parent-registered catalog, with no test catalog substitute', () => {
    expect(Object.values(PIGGYVEST_POSTGRES_STATEMENTS)).toContainEqual(
      PURCHASE_CURRENT_RECOVERY_STATEMENTS.purchaseCurrentRecovery
    );
  });
  it('reads coherent retained history and current recorded surplus through actual restricted executor', async () => {
    const read = createPurchaseCurrentRecovery({
      configuration: config(),
      execute: createPiggyvestPostgresExecutor(database()),
    });
    const result = await read({ operationId: goal(9207) });
    expect(result).toMatchObject({
      status: 'purchase_pending',
      surplusKobo: 1000,
      current: {
        status: 'observed',
        reservation: 'retained',
        balances: {
          unreservedPrincipalKobo: 700,
          unreservedPaidInterestKobo: 1000,
          pendingInterestKobo: 300,
        },
        fundsUse: 'not_authorized',
        retry: 'not_authorized',
      },
    });
  });
  it('denies actor or goal mismatch and restricts the statement role', async () => {
    const execute = createPiggyvestPostgresExecutor(database());
    for (const patch of [{ actorId: goal(999) }, { goalId: goal(208) }]) {
      const read = createPurchaseCurrentRecovery({
        configuration: { ...config(), ...patch },
        execute,
      });
      expect(await read({ operationId: goal(9207) })).toMatchObject({
        status: 'unavailable',
      });
    }
    const denied = createPiggyvestPostgresExecutor({
      ...database(),
      role: 'piggyvest_staging_ledger_worker',
    });
    await expect(
      denied(
        PURCHASE_CURRENT_RECOVERY_STATEMENTS.purchaseCurrentRecovery.text,
        [
          configuration().integrationId,
          merchantId,
          customerId,
          goal(207),
          'synthetic-business',
          actorId,
          goal(9207),
        ]
      )
    ).rejects.toThrow('PiggyVest database unavailable');
  });
  it('composes actual HTTP status with unchanged receipt and no ledger writes after restart', async () => {
    const before = await query(
      'harness_admin',
      'SELECT count(*)::int AS count FROM piggyvest_savings_ledger.operations'
    );
    const running = await server(207);
    try {
      const call = await client(running.origin);
      const response = await call(
        `/purchase/status?goalId=${goal(207)}&operationId=${goal(9207)}`
      );
      expect(response.status).toBe(200);
      const { current, goalId, ...receipt } = await response.json();
      const stored = await query(
        'harness_admin',
        'SELECT receipt FROM piggyvest_purchase_preparation.intents WHERE operation_id=$1',
        [goal(9207)]
      );
      expect(goalId).toBe(goal(207));
      expect(receipt).toEqual(stored.rows[0].receipt);
      expect(current).toMatchObject({
        status: 'observed',
        reservation: 'retained',
        balances: {
          unreservedPrincipalKobo: 700,
          unreservedPaidInterestKobo: 1000,
          pendingInterestKobo: 300,
        },
      });
    } finally {
      await running.close();
    }
    const after = await query(
      'harness_admin',
      'SELECT count(*)::int AS count FROM piggyvest_savings_ledger.operations'
    );
    expect(after.rows).toEqual(before.rows);
  });
});
