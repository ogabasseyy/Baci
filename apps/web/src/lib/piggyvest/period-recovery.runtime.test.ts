// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createPeriodRecovery } from './period-recovery';
import { createPiggyvestPostgresExecutor } from './postgres-executor';

vi.mock('server-only', () => ({}));
it.skipIf(process.env.PIGGYVEST_RUN_PERIOD_RECOVERY !== '1')(
  'standard executor retains canonical pending/reversed history after restart and lost metadata ACK',
  async () => {
    const configuration = {
      environment: 'staging',
      transport: 'local_test',
      integrationId: '40000000-0000-4000-8000-000000000001',
      merchantId: '10000000-0000-4000-8000-000000000001',
      customerId: '20000000-0000-4000-8000-000000000001',
      goalId: '30000000-0000-4000-8000-000000000001',
      actorId: '90000000-0000-4000-8000-000000000001',
      expectedBusinessId: 'synthetic-business',
    };
    const database = createPiggyvestPostgresExecutor({
      environment: 'staging',
      transport: 'local_test',
      socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
      database: 'piggyvest_local',
      role: 'piggyvest_staging_policy_writer',
      password: 'synthetic-local-only',
      port: 55459,
    });
    const store = createPeriodRecovery({ configuration, execute: database });
    const input = { ledgerOperationId: 'b0000000-0000-4000-8000-000000000001' };
    const initial = await store.read(input);
    expect(initial).toMatchObject({
      periodStatus: 'unknown',
      coveredPeriod: null,
      disposition: 'unresolved',
      fundsUse: 'not_authorized',
      canonical: {
        originalCreditKobo: 70,
        reversalOperationId: 'b0000000-0000-4000-8000-000000000007',
      },
    });
    const lost = createPeriodRecovery({
      configuration,
      execute: async (statement, parameters) => {
        await database(statement, parameters);
        throw new Error('Synthetic lost metadata ACK');
      },
    });
    expect(await lost.record(input)).toMatchObject({
      status: 'unconfirmed',
      readbackRequired: true,
    });
    expect((await store.read(input)).record).toEqual(initial.record);
    expect(await store.record(input)).toEqual({
      status: 'recorded_metadata',
      receipt: initial.record,
    });
    expect(
      await store.read({
        ledgerOperationId: 'b0000000-0000-4000-8000-000000000002',
      })
    ).toMatchObject({
      canonical: { kind: 'record_pending_interest', originalCreditKobo: 30 },
      fundsUse: 'not_authorized',
    });
    const fresh = { ledgerOperationId: 'b0000000-0000-4000-8000-000000000010' };
    expect((await store.read(fresh)).record).toBeNull();
    const concurrent = await Promise.all([
      store.record(fresh),
      store.record(fresh),
    ]);
    expect(concurrent[0]).toEqual(concurrent[1]);
    expect(concurrent[0].status).toBe('recorded_metadata');
    await expect(
      createPeriodRecovery({
        configuration: {
          ...configuration,
          actorId: '90000000-0000-4000-8000-000000000002',
        },
        execute: database,
      }).read(input)
    ).rejects.toThrow('Period recovery unavailable');
  }
);
