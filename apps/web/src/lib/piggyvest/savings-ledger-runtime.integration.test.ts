import { describe, expect, it, vi } from 'vitest';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { createSavingsLedger } from './savings-ledger';
import { readPiggyvestSavingsView } from './savings-view';
import { savingsViewFixture } from './savings-view.test-support';

vi.mock('server-only', () => ({}));

describe.skipIf(process.env.PIGGYVEST_RUN_LOCAL_POSTGRES !== '1')(
  'durable internal ledger and savings policy',
  () => {
    it('deduplicates confirmed contributions, excludes accrual, reserves once and restores purchasing power on release', async () => {
      const fixture = savingsViewFixture();
      fixture.goal.identity.customerId = '22222222-2222-4222-8222-222222222221';
      fixture.configuration.allowlistedCustomerIds = [
        fixture.goal.identity.customerId,
      ];
      const configuration = {
        environment: 'staging',
        transport: 'local_test',
        socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
        database: 'piggyvest_local',
        password: 'synthetic-local-only',
        role: 'piggyvest_staging_ledger_worker',
        port: 55443,
      };
      const execute = createPiggyvestPostgresExecutor(configuration);
      const ledger = createSavingsLedger(fixture.goal.identity, execute);
      const command = (
        suffix: string,
        kind: string,
        principalKobo = 0,
        interestKobo = 0,
        referenceId: string | null = null
      ) => ({
        operationId: `77777777-7777-4777-8777-${suffix.padStart(12, '0')}`,
        kind,
        principalKobo,
        interestKobo,
        evidenceId: `synthetic-ledger-${suffix}`,
        referenceId,
      });
      const principal = command('1', 'credit_principal', 9500);
      await Promise.all([ledger.apply(principal), ledger.apply(principal)]);
      await ledger.apply(command('2', 'record_pending_interest', 0, 500));
      const view = () =>
        readPiggyvestSavingsView({
          configuration: fixture.configuration,
          resolveAuthenticatedGoal: async () => fixture.goal,
          execute,
        });
      expect(await view()).toMatchObject({
        status: 'ready',
        decision: {
          purchasingPowerKobo: 9500,
          readiness: 'continue_saving',
          purchaseAction: 'blocked',
        },
      });
      await ledger.apply(command('3', 'credit_eligible_paid_interest', 0, 500));
      expect(await view()).toMatchObject({
        status: 'ready',
        decision: {
          purchasingPowerKobo: 10000,
          readiness: 'ready_for_review',
          purchaseAction: 'requires_customer_confirmation',
        },
      });
      const purchase = command('4', 'reserve_purchase', 9500, 500);
      await ledger.apply(purchase);
      await expect(
        ledger.apply(command('5', 'reserve_refund', 9500))
      ).rejects.toThrow('Internal savings ledger unavailable');
      expect((await ledger.snapshot()).activeReservation).toMatchObject({
        kind: 'reserve_purchase',
        principalKobo: 9500,
        interestKobo: 500,
      });
      await ledger.apply(
        command('6', 'release_purchase', 0, 0, purchase.operationId)
      );
      expect(await view()).toMatchObject({
        status: 'ready',
        decision: { purchasingPowerKobo: 10000 },
      });
      await expect(
        ledger.apply({ ...principal, principalKobo: 10000 })
      ).rejects.toThrow('Internal savings ledger unavailable');
      const wrongRole = createSavingsLedger(
        fixture.goal.identity,
        createPiggyvestPostgresExecutor({
          ...configuration,
          role: 'piggyvest_staging_intake',
        })
      );
      await expect(
        wrongRole.apply(command('7', 'credit_principal', 100))
      ).rejects.toThrow('Internal savings ledger unavailable');
      const anotherCustomer = createSavingsLedger(
        {
          ...fixture.goal.identity,
          customerId: '22222222-2222-4222-8222-222222222222',
        },
        execute
      );
      await expect(anotherCustomer.snapshot()).rejects.toThrow(
        'Internal savings ledger unavailable'
      );
    });
  }
);
